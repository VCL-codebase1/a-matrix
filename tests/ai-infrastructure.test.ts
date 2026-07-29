import { describe, expect, it } from "vitest";

import {
  clearResponseCache,
  createResponseCacheKey,
  getCachedResponse,
  setCachedResponse,
} from "../app/lib/ai/cache";
import {
  customerMessageForError,
  AIError,
} from "../app/lib/ai/errors";
import {
  clearIdempotencyEntries,
  createIdempotencyKey,
  runIdempotent,
} from "../app/lib/ai/idempotency";
import {
  acquireSessionConcurrency,
  assertWithinRateLimits,
  clearRateLimits,
} from "../app/lib/ai/rate-limit";

describe("response caching", () => {
  it("creates stable normalized keys and honors cache values", () => {
    clearResponseCache();
    const first = createResponseCacheKey({
      query: "  ABC-123 Meter ",
      intent: "product_search",
      selectedProductIds: ["2", "1"],
    });
    const second = createResponseCacheKey({
      query: "abc-123   meter",
      intent: "product_search",
      selectedProductIds: ["1", "2"],
    });
    expect(first).toBe(second);
    setCachedResponse(first, { answer: "cached" }, 60);
    expect(getCachedResponse(first)).toEqual({ answer: "cached" });
  });
});

describe("idempotency", () => {
  it("returns one in-progress result for duplicate requests", async () => {
    clearIdempotencyEntries();
    const key = createIdempotencyKey({
      sessionId: "session-123",
      message: "Find ABC-123",
      stateVersion: 0,
      now: 1000,
    });
    let calls = 0;
    const factory = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "done";
    };
    const [first, second] = await Promise.all([
      runIdempotent(key, factory),
      runIdempotent(key, factory),
    ]);
    expect(calls).toBe(1);
    expect(first.value).toBe("done");
    expect(second.value).toBe("done");
    expect([first.duplicate, second.duplicate]).toContain(true);
  });
});

describe("application quota protection", () => {
  it("enforces rate and concurrent request limits", () => {
    clearRateLimits();
    assertWithinRateLimits({
      ip: "127.0.0.1",
      sessionId: "session-a",
      hourlyLimit: 1,
      dailyLimit: 5,
      now: 1000,
    });
    expect(() =>
      assertWithinRateLimits({
        ip: "127.0.0.1",
        sessionId: "session-b",
        hourlyLimit: 1,
        dailyLimit: 5,
        now: 1100,
      }),
    ).toThrowError(AIError);

    clearRateLimits();
    const release = acquireSessionConcurrency("session-a", 1);
    expect(() => acquireSessionConcurrency("session-a", 1)).toThrowError(
      AIError,
    );
    release();
    expect(() => acquireSessionConcurrency("session-a", 1)).not.toThrow();
  });

  it("maps internal failures without provider terminology", () => {
    const message = customerMessageForError(
      new AIError("RATE_LIMITED", "Gemini API returned 429"),
    );
    expect(message).not.toMatch(/\b(?:Gemini|Google|model|API)\b/i);
    expect(message).toContain("high number of requests");
  });
});
