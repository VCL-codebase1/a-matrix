import { describe, expect, it } from "vitest";

import {
  buildAIContext,
  estimateTokens,
} from "../app/lib/ai/context-builder";
import { thinkingConfigForLevel } from "../app/lib/ai/client";
import { normalizeAssetMatrixProduct } from "../app/lib/catalog";
import {
  normalizeConversationState,
  updateConversationState,
} from "../app/lib/ai/conversation-state";
import { AIError } from "../app/lib/ai/errors";
import { serializeProductForAI } from "../app/lib/ai/product-serializer";
import {
  parseAIResponse,
  removeProviderTerminology,
} from "../app/lib/ai/response-schema";
import { sanitizeForModel } from "../app/lib/ai/sanitization";
import { modelResponse, testProduct } from "./helpers";

describe("sensitive-data sanitization", () => {
  it("removes contact, payment and credential details", () => {
    const result = sanitizeForModel(
      "Email jane@example.com, call +234 803 123 4567, card 4111 1111 1111 1111, password: secret123 and key AIza123456789012345678901234567890.",
    );

    expect(result.text).not.toContain("jane@example.com");
    expect(result.text).not.toContain("4111");
    expect(result.text).not.toContain("secret123");
    expect(result.text).not.toContain("AIza");
    expect(result.containsSensitiveData).toBe(true);
  });
});

describe("generation configuration", () => {
  it("uses supported thinking levels without a numeric thinking budget", () => {
    const routine = thinkingConfigForLevel("minimal");
    const complex = thinkingConfigForLevel("medium");

    expect(routine.thinkingLevel).toBe("MINIMAL");
    expect(complex.thinkingLevel).toBe("MEDIUM");
    expect(routine).not.toHaveProperty("thinkingBudget");
  });
});

describe("context budgets", () => {
  it("truncates history before products and compacts product summaries", () => {
    const product = serializeProductForAI({
      ...testProduct,
      summary: "technical specification ".repeat(100),
    });
    const result = buildAIContext(
      {
        route: "routine_ai",
        intent: "product_search",
        conversationState: { version: 2 },
        recentMessages: [
          { role: "user", content: "old message ".repeat(150) },
          { role: "assistant", content: "old answer ".repeat(150) },
          { role: "user", content: "newer message ".repeat(150) },
          { role: "assistant", content: "newer answer ".repeat(150) },
        ],
        retrievedProducts: Array.from({ length: 5 }, (_, index) => ({
          ...product,
          id: String(index),
        })),
        workflowContext: "Find the product.",
        currentMessage: "I need a suitable laboratory meter.",
      },
      { targetInputTokens: 1700, maximumInputTokens: 2500 },
    );

    expect(result.truncationApplied).toBe(true);
    expect(result.truncationDecisions[0]).toContain("oldest conversation");
    expect(result.truncationDecisions.some((item) => item.includes("catalogue"))).toBe(
      true,
    );
    expect(result.estimatedInputTokens).toBeLessThanOrEqual(2500);
  });

  it("rejects a request when the customer's core message cannot fit", () => {
    expect(() =>
      buildAIContext(
        {
          route: "routine_ai",
          intent: "general_enquiry",
          conversationState: { version: 0 },
          recentMessages: [],
          currentMessage: "essential requirement ".repeat(5000),
        },
        { targetInputTokens: 1000, maximumInputTokens: 1500 },
      ),
    ).toThrowError(AIError);
  });

  it("uses a stable compact permanent instruction", () => {
    const first = buildAIContext(
      {
        route: "routine_ai",
        intent: "general_enquiry",
        conversationState: { version: 0 },
        recentMessages: [],
        currentMessage: "First question",
      },
      { targetInputTokens: 3000, maximumInputTokens: 6000 },
    );
    const second = buildAIContext(
      {
        route: "routine_ai",
        intent: "product_search",
        conversationState: { version: 3 },
        recentMessages: [],
        currentMessage: "Different question",
      },
      { targetInputTokens: 3000, maximumInputTokens: 6000 },
    );
    expect(first.systemInstruction).toBe(second.systemInstruction);
    expect(estimateTokens(first.systemInstruction)).toBeLessThan(1500);
  });
});

describe("product and response serialization", () => {
  it("normalizes the Asset Matrix Energy WordPress product schema", () => {
    const product = normalizeAssetMatrixProduct({
      id: 714,
      link: "https://assetmatrixenergy.com/amel-products/transformer-meter/",
      title: { rendered: "Transformer &amp; Winding Meter" },
      excerpt: { rendered: "<p>Published product information.</p>" },
      _embedded: {
        "wp:term": [
          [
            {
              name: "Test &amp; Measurement",
              taxonomy: "product-cat",
            },
          ],
        ],
      },
    });

    expect(product).toMatchObject({
      id: 714,
      name: "Transformer & Winding Meter",
      listedPrice: "Quotation required",
      availability: "Availability requires confirmation",
      categories: ["Test & Measurement"],
    });
  });

  it("rejects product links outside assetmatrixenergy.com", () => {
    expect(
      normalizeAssetMatrixProduct({
        id: 1,
        link: "https://a-matrix.ng/product/example/",
        title: { rendered: "Example" },
      }),
    ).toBeNull();
  });

  it("creates a compact product context without raw HTML or null filler", () => {
    const result = serializeProductForAI({
      ...testProduct,
      summary: "<p>Useful <strong>technical</strong> details</p>",
    });
    expect(result.id).toBe("42");
    expect(result.partNumber).toBe("ABC-123");
    expect(JSON.stringify(result)).not.toContain("<p>");
    expect(result.priceStatus).toBe("indicative");
  });

  it("validates structured output and removes provider terminology", () => {
    const parsed = parseAIResponse(
      JSON.stringify(
        modelResponse({
          answer: "Gemini generated this with the Google SDK.",
        }),
      ),
    );
    expect(parsed.answer).not.toMatch(/\b(?:Gemini|Google|SDK)\b/i);
    expect(removeProviderTerminology("I am an AI model")).not.toMatch(
      /\bAI model\b/i,
    );
  });

  it("updates structured conversation state deterministically", () => {
    const initial = normalizeConversationState({ version: 4, quantity: 2 });
    const updated = updateConversationState(
      initial,
      modelResponse({
        extractedRequirements: {
          manufacturer: "Acme",
          partNumber: "ABC-123",
          quantity: 5,
        },
        selectedProductIds: ["42"],
      }),
    );
    expect(updated.version).toBe(5);
    expect(updated.quantity).toBe(5);
    expect(updated.partNumber).toBe("ABC-123");
    expect(updated.productsConsidered).toEqual(["42"]);
  });
});
