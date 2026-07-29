import { describe, expect, it } from "vitest";

import {
  createChatEventStream,
  type ChatStreamEvent,
} from "../app/lib/chat-stream";
import { testProduct } from "./helpers";

describe("chat response stream", () => {
  it("streams the answer before emitting product metadata", async () => {
    const answer =
      "I found the matching bushing tap adapter kit in the catalogue.";
    let persistenceFinished = false;
    const stream = createChatEventStream(
      {
        answer,
        intent: "product_search",
        nextAction: "show_products",
        products: [testProduct],
        conversationState: { version: 1 },
        route: "routine_ai",
      },
      {
        intervalMs: 0,
        productRevealDelayMs: 0,
        beforeComplete: async () => {
          persistenceFinished = true;
        },
      },
    );
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let body = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();

    const events = body
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as ChatStreamEvent);
    const deltas = events.filter(
      (event): event is Extract<ChatStreamEvent, { type: "answer_delta" }> =>
        event.type === "answer_delta",
    );

    expect(deltas.map((event) => event.text).join("")).toBe(answer);
    expect(events.at(-1)).toMatchObject({
      type: "complete",
      products: [{ id: testProduct.id }],
    });
    expect(
      events.slice(0, -1).every((event) => event.type === "answer_delta"),
    ).toBe(true);
    expect(persistenceFinished).toBe(true);
  });
});
