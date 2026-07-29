import "server-only";

import type { ChatOutcome } from "../ai/orchestrator";
import { sanitizeForModel } from "../ai/sanitization";
import type { AMatrixChatRequest } from "../ai/types";
import { loadSupabaseConfig } from "./config";
import { getSupabaseAdmin } from "./supabase";

export type PersistenceResult = {
  persisted: boolean;
  reason?: "not_configured" | "timeout" | "database_error";
};

type PersistenceGlobal = typeof globalThis & {
  __aMatrixPersistenceUnavailableUntil?: number;
};

const persistenceGlobal = globalThis as PersistenceGlobal;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "Unknown database error";
}

async function withTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Supabase operation timed out.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function persistChatExchange(input: {
  request: AMatrixChatRequest;
  outcome: ChatOutcome;
}): Promise<PersistenceResult> {
  const config = loadSupabaseConfig();
  const supabase = getSupabaseAdmin();
  if (!config || !supabase) return { persisted: false, reason: "not_configured" };
  if (
    (persistenceGlobal.__aMatrixPersistenceUnavailableUntil ?? 0) > Date.now()
  ) {
    return { persisted: false, reason: "database_error" };
  }

  const sanitizedUser = sanitizeForModel(input.request.message);
  const timestamp = new Date().toISOString();

  try {
    const sessionResult = await withTimeout(
      supabase.from("chat_sessions").upsert(
        {
          session_id: input.request.sessionId,
          conversation_state: input.outcome.conversationState,
          last_intent: input.outcome.intent,
          updated_at: timestamp,
        },
        { onConflict: "session_id" },
      ),
      config.requestTimeoutMs,
    );
    if (sessionResult.error) throw sessionResult.error;

    const messageResult = await withTimeout(
      supabase.from("chat_messages").upsert(
        [
          {
            session_id: input.request.sessionId,
            request_id: input.request.requestId,
            role: "user",
            content: sanitizedUser.text,
            intent: input.outcome.intent,
            next_action: null,
            products: [],
            metadata: {
              redactions: sanitizedUser.redactions,
              contentSanitized: sanitizedUser.containsSensitiveData,
            },
          },
          {
            session_id: input.request.sessionId,
            request_id: input.request.requestId,
            role: "assistant",
            content: input.outcome.answer,
            intent: input.outcome.intent,
            next_action: input.outcome.nextAction,
            products: input.outcome.products.map((product) => ({
              id: product.id,
              name: product.name,
              url: product.url,
            })),
            metadata: { route: input.outcome.route },
          },
        ],
        {
          onConflict: "session_id,request_id,role",
          ignoreDuplicates: true,
        },
      ),
      config.requestTimeoutMs,
    );
    if (messageResult.error) throw messageResult.error;

    return { persisted: true };
  } catch (error) {
    const timeout =
      error instanceof Error && error.message.includes("timed out");
    console.error("A-Matrix conversation persistence failed", {
      reason: timeout ? "timeout" : "database_error",
      detail: errorMessage(error),
    });
    persistenceGlobal.__aMatrixPersistenceUnavailableUntil =
      Date.now() + 30_000;
    return {
      persisted: false,
      reason: timeout ? "timeout" : "database_error",
    };
  }
}
