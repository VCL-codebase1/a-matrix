import "server-only";

import { AIError } from "./errors";

function numberFromEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.floor(value)))
    : fallback;
}

export type AIConfig = ReturnType<typeof loadAIConfig>;

export function loadAIConfig() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const legacyModel = process.env.GEMINI_MODEL?.trim();
  const routineModel =
    process.env.GEMINI_ROUTINE_MODEL?.trim() || legacyModel || "";
  const complexModel =
    process.env.GEMINI_COMPLEX_MODEL?.trim() || routineModel;

  if (!apiKey || !routineModel || !complexModel) {
    throw new AIError(
      "CONFIGURATION_ERROR",
      "GEMINI_API_KEY, GEMINI_ROUTINE_MODEL and GEMINI_COMPLEX_MODEL are required.",
    );
  }

  return {
    apiKey,
    routineModel,
    complexModel,
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL?.trim() || undefined,
    routineMaxOutputTokens: numberFromEnvironment(
      "GEMINI_ROUTINE_MAX_OUTPUT_TOKENS",
      400,
      100,
      500,
    ),
    complexMaxOutputTokens: numberFromEnvironment(
      "GEMINI_COMPLEX_MAX_OUTPUT_TOKENS",
      900,
      200,
      1200,
    ),
    routineTargetInputTokens: numberFromEnvironment(
      "AI_ROUTINE_TARGET_INPUT_TOKENS",
      3000,
      500,
      6000,
    ),
    routineInputBudget: numberFromEnvironment(
      "AI_ROUTINE_INPUT_BUDGET",
      6000,
      1000,
      8000,
    ),
    complexTargetInputTokens: numberFromEnvironment(
      "AI_COMPLEX_TARGET_INPUT_TOKENS",
      8000,
      1000,
      15000,
    ),
    complexInputBudget: numberFromEnvironment(
      "AI_COMPLEX_INPUT_BUDGET",
      15000,
      2000,
      20000,
    ),
    routineThinkingBudget: numberFromEnvironment(
      "GEMINI_ROUTINE_THINKING_BUDGET",
      0,
      0,
      1024,
    ),
    complexThinkingBudget: numberFromEnvironment(
      "GEMINI_COMPLEX_THINKING_BUDGET",
      512,
      0,
      4096,
    ),
    requestTimeoutMs: numberFromEnvironment(
      "AI_REQUEST_TIMEOUT_MS",
      25_000,
      5_000,
      55_000,
    ),
    maximumRetries: numberFromEnvironment(
      "AI_MAX_RETRIES",
      1,
      0,
      1,
    ),
    anonymousRequestsPerHour: numberFromEnvironment(
      "AI_ANONYMOUS_REQUESTS_PER_HOUR",
      10,
      1,
      1000,
    ),
    anonymousRequestsPerDay: numberFromEnvironment(
      "AI_ANONYMOUS_REQUESTS_PER_DAY",
      50,
      1,
      10_000,
    ),
    authenticatedRequestsPerHour: numberFromEnvironment(
      "AI_AUTHENTICATED_REQUESTS_PER_HOUR",
      40,
      1,
      10_000,
    ),
    maxConcurrentRequestsPerUser: numberFromEnvironment(
      "AI_MAX_CONCURRENT_REQUESTS_PER_USER",
      1,
      1,
      5,
    ),
    responseCacheTtlSeconds: numberFromEnvironment(
      "AI_RESPONSE_CACHE_TTL_SECONDS",
      300,
      0,
      3600,
    ),
    maxMessageCharacters: numberFromEnvironment(
      "AI_MAX_MESSAGE_CHARACTERS",
      8000,
      100,
      20_000,
    ),
    maxHistoryMessages: numberFromEnvironment(
      "AI_MAX_HISTORY_MESSAGES",
      4,
      0,
      8,
    ),
    maxDocumentPages: numberFromEnvironment(
      "AI_MAX_DOCUMENT_PAGES",
      10,
      1,
      50,
    ),
    maxDocumentSizeMb: numberFromEnvironment(
      "AI_MAX_DOCUMENT_SIZE_MB",
      10,
      1,
      25,
    ),
    adminToken: process.env.AI_ADMIN_TOKEN?.trim() || undefined,
  } as const;
}
