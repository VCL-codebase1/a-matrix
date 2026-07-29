import "server-only";

import { GoogleGenAI } from "@google/genai";

import type { AIConfig } from "./config";
import { AIError, toAIError } from "./errors";
import {
  aMatrixResponseJsonSchema,
  parseAIResponse,
} from "./response-schema";
import type {
  AMatrixAIResponse,
  BuiltAIContext,
} from "./types";

type CircuitState = {
  consecutiveFailures: number;
  openUntil: number;
};

type GlobalAIClient = typeof globalThis & {
  __aMatrixCircuit?: CircuitState;
};

const globalAIClient = globalThis as GlobalAIClient;
const circuit =
  globalAIClient.__aMatrixCircuit ??
  (globalAIClient.__aMatrixCircuit = {
    consecutiveFailures: 0,
    openUntil: 0,
  });

export type GenerationUsage = {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  cachedTokens: number;
  totalTokens: number;
};

export type GenerateStructuredResponseInput = {
  config: AIConfig;
  route: "routine_ai" | "complex_ai";
  context: BuiltAIContext;
};

export type GenerateStructuredResponseResult = {
  response: AMatrixAIResponse;
  usage: GenerationUsage;
  retryCount: number;
  latencyMs: number;
};

export type AIResponseGenerator = (
  input: GenerateStructuredResponseInput,
) => Promise<GenerateStructuredResponseResult>;

function assertCircuitAvailable(): void {
  if (circuit.openUntil > Date.now()) {
    throw new AIError(
      "RATE_LIMITED",
      "The model circuit is temporarily open after repeated failures.",
    );
  }
}

function markSuccess(): void {
  circuit.consecutiveFailures = 0;
  circuit.openUntil = 0;
}

function markFailure(error: unknown): void {
  const aiError = toAIError(error);
  if (
    aiError.code === "CONTENT_REJECTED" ||
    aiError.code === "INVALID_MODEL_RESPONSE"
  ) {
    return;
  }
  circuit.consecutiveFailures += 1;
  if (circuit.consecutiveFailures >= 3) {
    circuit.openUntil = Date.now() + 60_000;
  }
}

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (
    message.includes("429") ||
    message.includes("resource_exhausted") ||
    message.includes("rate limit")
  ) {
    return false;
  }
  return (
    message.includes("500") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("unavailable") ||
    message.includes("internal")
  );
}

function waitWithJitter(attempt: number): Promise<void> {
  const delay = Math.min(1200, 250 * 2 ** attempt) + Math.floor(Math.random() * 150);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export const generateStructuredResponse: AIResponseGenerator = async (input) => {
  assertCircuitAvailable();

  const model =
    input.route === "complex_ai"
      ? input.config.complexModel
      : input.config.routineModel;
  const maxOutputTokens =
    input.route === "complex_ai"
      ? input.config.complexMaxOutputTokens
      : input.config.routineMaxOutputTokens;
  const thinkingBudget =
    input.route === "complex_ai"
      ? input.config.complexThinkingBudget
      : input.config.routineThinkingBudget;

  const client = new GoogleGenAI({ apiKey: input.config.apiKey });
  const startedAt = Date.now();
  let retryCount = 0;

  try {
    for (
      let attempt = 0;
      attempt <= input.config.maximumRetries;
      attempt += 1
    ) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        input.config.requestTimeoutMs,
      );

      try {
        const result = await client.models.generateContent({
          model,
          contents: input.context.contents,
          config: {
            systemInstruction: input.context.systemInstruction,
            maxOutputTokens,
            responseMimeType: "application/json",
            responseJsonSchema: aMatrixResponseJsonSchema,
            thinkingConfig: {
              includeThoughts: false,
              thinkingBudget,
            },
            abortSignal: controller.signal,
            httpOptions: { timeout: input.config.requestTimeoutMs },
          },
        });

        const text = result.text?.trim();
        if (!text) {
          throw new AIError(
            "INVALID_MODEL_RESPONSE",
            "The generation response did not include text.",
          );
        }

        let parsed: AMatrixAIResponse;
        try {
          parsed = parseAIResponse(text);
        } catch (error) {
          throw new AIError(
            "INVALID_MODEL_RESPONSE",
            "The structured response failed validation.",
            { cause: error },
          );
        }

        const metadata = result.usageMetadata;
        markSuccess();
        return {
          response: parsed,
          usage: {
            inputTokens:
              metadata?.promptTokenCount ?? input.context.estimatedInputTokens,
            outputTokens: metadata?.candidatesTokenCount ?? 0,
            thoughtTokens: metadata?.thoughtsTokenCount ?? 0,
            cachedTokens: metadata?.cachedContentTokenCount ?? 0,
            totalTokens:
              metadata?.totalTokenCount ??
              (metadata?.promptTokenCount ?? input.context.estimatedInputTokens) +
                (metadata?.candidatesTokenCount ?? 0) +
                (metadata?.thoughtsTokenCount ?? 0),
          },
          retryCount,
          latencyMs: Date.now() - startedAt,
        };
      } catch (error) {
        if (
          attempt < input.config.maximumRetries &&
          isRetryable(error)
        ) {
          retryCount += 1;
          await waitWithJitter(attempt);
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new AIError("UNKNOWN_AI_ERROR", "Generation ended unexpectedly.");
  } catch (error) {
    markFailure(error);
    throw toAIError(error);
  }
};
