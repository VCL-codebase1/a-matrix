import type { ChatOutcome } from "./ai/orchestrator";

export type ChatStreamEvent =
  | {
      type: "answer_delta";
      text: string;
    }
  | {
      type: "complete";
      products: ChatOutcome["products"];
      conversationState: ChatOutcome["conversationState"];
      intent: ChatOutcome["intent"];
      nextAction: ChatOutcome["nextAction"];
    };

function answerChunks(answer: string): string[] {
  const words = answer.match(/\S+\s*/g) ?? [answer];
  const chunks: string[] = [];

  for (let index = 0; index < words.length; index += 2) {
    chunks.push(words.slice(index, index + 2).join(""));
  }

  return chunks;
}

function encodeEvent(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

export function createChatEventStream(
  outcome: ChatOutcome,
  options: {
    signal?: AbortSignal;
    intervalMs?: number;
    productRevealDelayMs?: number;
  } = {},
): ReadableStream<Uint8Array> {
  const intervalMs = options.intervalMs ?? 30;
  const productRevealDelayMs = options.productRevealDelayMs ?? 180;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          for (const text of answerChunks(outcome.answer)) {
            if (options.signal?.aborted) {
              controller.close();
              return;
            }

            controller.enqueue(encodeEvent({ type: "answer_delta", text }));
            if (intervalMs > 0) {
              await new Promise((resolve) =>
                setTimeout(resolve, intervalMs),
              );
            }
          }

          if (!options.signal?.aborted) {
            if (productRevealDelayMs > 0 && outcome.products.length > 0) {
              await new Promise((resolve) =>
                setTimeout(resolve, productRevealDelayMs),
              );
            }
            controller.enqueue(
              encodeEvent({
                type: "complete",
                products: outcome.products,
                conversationState: outcome.conversationState,
                intent: outcome.intent,
                nextAction: outcome.nextAction,
              }),
            );
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      })();
    },
  });
}
