import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearResponseCache } from "../app/lib/ai/cache";
import type { AIResponseGenerator } from "../app/lib/ai/client";
import {
  customerMessageForError,
  AIError,
} from "../app/lib/ai/errors";
import { clearIdempotencyEntries } from "../app/lib/ai/idempotency";
import { orchestrateChat } from "../app/lib/ai/orchestrator";
import { clearRateLimits } from "../app/lib/ai/rate-limit";
import type { AMatrixChatRequest } from "../app/lib/ai/types";
import { clearUsage } from "../app/lib/ai/usage";
import { modelResponse, testConfig, testProduct } from "./helpers";

function request(
  message: string,
  overrides: Partial<AMatrixChatRequest> = {},
): AMatrixChatRequest {
  return {
    sessionId: "session-12345",
    requestId: `request-${Math.random().toString(36).slice(2)}`,
    message,
    recentMessages: [],
    conversationState: { version: 0 },
    ...overrides,
  };
}

function mockGenerator(
  onCall?: Parameters<typeof vi.fn>[0],
): AIResponseGenerator {
  return vi.fn(async (input) => {
    if (onCall) onCall(input);
    return {
      response: modelResponse({
        intent:
          input.route === "complex_ai"
            ? "product_comparison"
            : "product_search",
      }),
      usage: {
        inputTokens: input.context.estimatedInputTokens,
        outputTokens: 80,
        thoughtTokens: 0,
        cachedTokens: 0,
        totalTokens: input.context.estimatedInputTokens + 80,
      },
      retryCount: 0,
      latencyMs: 12,
    };
  });
}

const emptyCatalog = async () => ({
  query: null,
  products: [],
  retrievedAt: null,
});

beforeEach(() => {
  clearResponseCache();
  clearIdempotencyEntries();
  clearRateLimits();
  clearUsage();
});

describe("zero-model workflows", () => {
  it("handles greetings and business hours without generation", async () => {
    const generate = mockGenerator();
    const greeting = await orchestrateChat(
      { request: request("Hello"), ip: "127.0.0.1", config: testConfig() },
      { searchCatalog: emptyCatalog, generate },
    );
    const hours = await orchestrateChat(
      {
        request: request("What are your business hours?", {
          sessionId: "session-hours",
        }),
        ip: "127.0.0.2",
        config: testConfig(),
      },
      { searchCatalog: emptyCatalog, generate },
    );
    expect(greeting.route).toBe("no_model");
    expect(hours.route).toBe("no_model");
    expect(generate).not.toHaveBeenCalled();
  });

  it("handles an exact SKU lookup without generation", async () => {
    const generate = mockGenerator();
    const result = await orchestrateChat(
      {
        request: request("Do you have ABC-123?"),
        ip: "127.0.0.1",
        config: testConfig(),
      },
      {
        searchCatalog: async () => ({
          query: "ABC-123",
          products: [testProduct],
          retrievedAt: new Date("2026-01-01").toISOString(),
          exactIdentifier: "ABC-123",
        }),
        generate,
      },
    );
    expect(result.route).toBe("no_model");
    expect(result.products).toHaveLength(1);
    expect(generate).not.toHaveBeenCalled();
  });

  it("requires authenticated review for private order status", async () => {
    const generate = mockGenerator();
    const result = await orchestrateChat(
      {
        request: request("Where is my order ABC-123?"),
        ip: "127.0.0.1",
        config: testConfig(),
      },
      { searchCatalog: emptyCatalog, generate },
    );
    expect(result.route).toBe("no_model");
    expect(result.answer).toContain("For privacy");
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("single-call model workflows", () => {
  it("uses one routine call for an ambiguous product search", async () => {
    const generate = mockGenerator();
    const searchKnowledge = vi.fn(async () => []);
    const result = await orchestrateChat(
      {
        request: request(
          "I need a laboratory meter for checking water samples.",
        ),
        ip: "127.0.0.1",
        config: testConfig(),
      },
      {
        searchCatalog: async () => ({
          query: "laboratory meter water samples",
          products: [testProduct],
          retrievedAt: new Date().toISOString(),
        }),
        searchKnowledge,
        generate,
      },
    );
    expect(result.route).toBe("routine_ai");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(searchKnowledge).not.toHaveBeenCalled();
  });

  it("uses one complex call for comparison and RFQ interpretation", async () => {
    const generate = mockGenerator();
    const comparison = await orchestrateChat(
      {
        request: request("Compare ABC-123 and XYZ-456", {
          sessionId: "session-compare",
        }),
        ip: "127.0.0.3",
        config: testConfig(),
      },
      {
        searchCatalog: async () => ({
          query: "ABC-123",
          products: [testProduct],
          retrievedAt: new Date().toISOString(),
        }),
        generate,
      },
    );
    const rfq = await orchestrateChat(
      {
        request: request(
          "Interpret this RFQ: 5 laboratory meters for delivery to Lagos.",
          { sessionId: "session-rfq" },
        ),
        ip: "127.0.0.4",
        config: testConfig(),
      },
      { searchCatalog: emptyCatalog, generate },
    );
    expect(comparison.route).toBe("complex_ai");
    expect(rfq.route).toBe("complex_ai");
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("removes sensitive details before generation", async () => {
    let sentContext = "";
    const generate = mockGenerator((input) => {
      sentContext = JSON.stringify(input.context.contents);
    });
    await orchestrateChat(
      {
        request: request(
          "Find a water meter and email me at jane@example.com or call +234 803 123 4567.",
        ),
        ip: "127.0.0.5",
        config: testConfig(),
      },
      { searchCatalog: emptyCatalog, generate },
    );
    expect(sentContext).not.toContain("jane@example.com");
    expect(sentContext).not.toContain("803 123 4567");
    expect(sentContext).toContain("[email removed]");
  });

  it("compresses oversized active history before generation", async () => {
    let historyCount = 0;
    let wasTruncated = false;
    const generate = mockGenerator((input) => {
      historyCount = input.context.contents.length - 2;
      wasTruncated = input.context.truncationApplied;
    });
    await orchestrateChat(
      {
        request: request("Find a laboratory meter for routine water testing.", {
          recentMessages: [
            { role: "user", content: "old requirement ".repeat(300) },
            { role: "assistant", content: "old response ".repeat(300) },
            { role: "user", content: "new requirement ".repeat(300) },
            { role: "assistant", content: "new response ".repeat(300) },
          ],
        }),
        ip: "127.0.0.8",
        config: testConfig({
          routineTargetInputTokens: 1800,
          routineInputBudget: 3000,
        }),
      },
      { searchCatalog: emptyCatalog, generate },
    );
    expect(wasTruncated).toBe(true);
    expect(historyCount).toBeLessThan(4);
  });

  it("maps an invalid structured result to a safe customer fallback", async () => {
    const generate: AIResponseGenerator = async () => {
      throw new AIError(
        "INVALID_MODEL_RESPONSE",
        "Gemini returned invalid JSON",
      );
    };
    let caught: unknown;
    try {
      await orchestrateChat(
        {
          request: request("Explain options for a laboratory water meter.", {
            sessionId: "session-invalid",
          }),
          ip: "127.0.0.9",
          config: testConfig(),
        },
        { searchCatalog: emptyCatalog, generate },
      );
    } catch (error) {
      caught = error;
    }
    const fallback = customerMessageForError(caught);
    expect(fallback).not.toMatch(
      /\b(?:Gemini|Google|language model|model provider|API)\b/i,
    );
    expect(fallback).toContain("could not verify");
  });

  it("deduplicates repeated in-progress model requests", async () => {
    let calls = 0;
    const generate: AIResponseGenerator = async (input) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        response: modelResponse(),
        usage: {
          inputTokens: input.context.estimatedInputTokens,
          outputTokens: 50,
          thoughtTokens: 0,
          cachedTokens: 0,
          totalTokens: input.context.estimatedInputTokens + 50,
        },
        retryCount: 0,
        latencyMs: 20,
      };
    };
    const shared = request("Find a basic laboratory water meter.");
    const [first, second] = await Promise.all([
      orchestrateChat(
        { request: shared, ip: "127.0.0.6", config: testConfig() },
        { searchCatalog: emptyCatalog, generate },
      ),
      orchestrateChat(
        { request: shared, ip: "127.0.0.6", config: testConfig() },
        { searchCatalog: emptyCatalog, generate },
      ),
    ]);
    expect(calls).toBe(1);
    expect(first.answer).toBe(second.answer);
  });
});
