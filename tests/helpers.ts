import type { AIConfig } from "../app/lib/ai/config";
import type {
  AMatrixAIResponse,
} from "../app/lib/ai/types";
import type { CatalogProduct } from "../app/lib/catalog";

export function testConfig(overrides: Partial<AIConfig> = {}): AIConfig {
  return {
    apiKey: "test-key",
    routineModel: "routine-model",
    complexModel: "complex-model",
    embeddingModel: undefined,
    routineMaxOutputTokens: 400,
    complexMaxOutputTokens: 900,
    routineTargetInputTokens: 3000,
    routineInputBudget: 6000,
    complexTargetInputTokens: 8000,
    complexInputBudget: 15000,
    routineThinkingLevel: "minimal",
    complexThinkingLevel: "medium",
    requestTimeoutMs: 25000,
    maximumRetries: 1,
    anonymousRequestsPerHour: 10,
    anonymousRequestsPerDay: 50,
    authenticatedRequestsPerHour: 40,
    maxConcurrentRequestsPerUser: 1,
    responseCacheTtlSeconds: 0,
    maxMessageCharacters: 8000,
    maxHistoryMessages: 4,
    maxDocumentPages: 10,
    maxDocumentSizeMb: 10,
    adminToken: undefined,
    ...overrides,
  };
}

export const testProduct: CatalogProduct = {
  id: 42,
  name: "Acme ABC-123 Laboratory Meter",
  url: "https://a-matrix.ng/product/acme-abc-123/",
  sku: "ABC-123",
  summary:
    "Compact laboratory meter with a clear display and configurable measurement modes.",
  listedPrice: "₦125,000.00",
  availability: "Website status: in stock",
  image: null,
  categories: ["Instrumentation"],
};

export function modelResponse(
  overrides: Partial<AMatrixAIResponse> = {},
): AMatrixAIResponse {
  return {
    answer: "Here is the information we could verify. Please confirm the required quantity.",
    intent: "product_search",
    extractedRequirements: {},
    missingRequirements: ["quantity"],
    selectedProductIds: [],
    confidence: "medium",
    nextAction: "ask_requirement",
    ...overrides,
  };
}
