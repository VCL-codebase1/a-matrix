import { randomUUID } from "node:crypto";

import { BUSINESS_DETAILS } from "../business";
import type {
  CatalogProduct,
  CatalogSearchResult,
} from "../catalog";
import {
  createResponseCacheKey,
  getCachedResponse,
  setCachedResponse,
} from "./cache";
import type {
  AIResponseGenerator,
  GenerateStructuredResponseResult,
} from "./client";
import { generateStructuredResponse } from "./client";
import type { AIConfig } from "./config";
import {
  normalizeConversationState,
  updateConversationState,
} from "./conversation-state";
import { buildAIContext } from "./context-builder";
import { AIError } from "./errors";
import {
  createIdempotencyKey,
  runIdempotent,
} from "./idempotency";
import { identifiersEqual, normalizeIdentifier } from "./identifiers";
import { serializeProductsForAI } from "./product-serializer";
import {
  acquireSessionConcurrency,
  assertWithinRateLimits,
} from "./rate-limit";
import { routeRequest } from "./router";
import {
  removeProviderTerminology,
} from "./response-schema";
import {
  sanitizeForModel,
  sanitizeMessagesForModel,
} from "./sanitization";
import type {
  AIIntent,
  AMatrixChatRequest,
  AINextAction,
  AMatrixAIResponse,
  CompactKnowledgeChunk,
  ConversationState,
} from "./types";
import {
  recordAIUsage,
  recordDuplicateRequest,
  recordNoModelResponse,
} from "./usage";
import { workflowForIntent } from "./prompts/workflows";

export type ChatOutcome = {
  answer: string;
  intent: AIIntent;
  nextAction: AINextAction;
  products: CatalogProduct[];
  conversationState: ConversationState;
  route: "no_model" | "routine_ai" | "complex_ai";
};

export type OrchestratorDependencies = {
  searchCatalog: (message: string) => Promise<CatalogSearchResult>;
  searchKnowledge?: (message: string) => Promise<CompactKnowledgeChunk[]>;
  generate?: AIResponseGenerator;
};

export type OrchestratorInput = {
  request: AMatrixChatRequest;
  ip: string;
  config: AIConfig;
};

const PRODUCT_INTENTS = new Set<AIIntent>([
  "product_search",
  "product_comparison",
  "technical_recommendation",
  "quotation_request",
]);

function noModelOutcome(input: {
  answer: string;
  intent: AIIntent;
  nextAction: AINextAction;
  state: ConversationState;
  products?: CatalogProduct[];
}): ChatOutcome {
  recordNoModelResponse();
  return {
    answer: removeProviderTerminology(input.answer),
    intent: input.intent,
    nextAction: input.nextAction,
    products: input.products ?? [],
    conversationState: {
      ...input.state,
      currentIntent: input.intent,
      version: input.state.version + 1,
    },
    route: "no_model",
  };
}

function exactProductMatch(
  products: CatalogProduct[],
  identifiers: string[],
): CatalogProduct | null {
  return (
    products.find((product) =>
      identifiers.some(
        (identifier) =>
          (product.sku && identifiersEqual(product.sku, identifier)) ||
          normalizeIdentifier(product.name).includes(
            normalizeIdentifier(identifier),
          ),
      ),
    ) ?? null
  );
}

function directProductAnswer(
  product: CatalogProduct,
  retrievedAt: string | null,
): string {
  const sku = product.sku ? `, SKU ${product.sku}` : "";
  const retrieval = retrievedAt
    ? ` This catalogue information was retrieved ${new Date(retrievedAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}.`
    : "";
  return `I found ${product.name}${sku} in our online catalogue. The website lists ${product.listedPrice} and ${product.availability.toLowerCase()}.${retrieval} Final price, tax, delivery and availability still require confirmation. Open the product below or email ${BUSINESS_DETAILS.salesEmail} with the required quantity and delivery location.`;
}

function cacheableRequest(input: {
  sanitized: ReturnType<typeof sanitizeForModel>;
  request: AMatrixChatRequest;
  intent: AIIntent;
}): boolean {
  return (
    !input.sanitized.containsSensitiveData &&
    (input.request.recentMessages?.length ?? 0) === 0 &&
    (input.request.conversationState?.version ?? 0) === 0 &&
    [
      "general_enquiry",
      "product_search",
      "product_comparison",
      "technical_recommendation",
    ].includes(input.intent)
  );
}

export async function orchestrateChat(
  input: OrchestratorInput,
  dependencies: OrchestratorDependencies,
): Promise<ChatOutcome> {
  const request = input.request;
  const state = normalizeConversationState(request.conversationState);
  const decision = routeRequest(
    request.message,
    request.attachmentIds?.length ?? 0,
  );

  if (decision.route === "static_response" && decision.staticResponse) {
    return noModelOutcome({
      answer: decision.staticResponse.answer,
      intent: decision.intent,
      nextAction: decision.staticResponse.nextAction,
      state,
    });
  }

  if (decision.route === "business_operation") {
    return noModelOutcome({
      answer: `For privacy, live order, quotation, payment, return and warranty details must be checked by our team using your reference and registered contact information. Email ${BUSINESS_DETAILS.salesEmail} or call ${BUSINESS_DETAILS.telephonePrimary}.`,
      intent: decision.intent,
      nextAction: "check_order",
      state,
    });
  }

  if (decision.route === "human_escalation") {
    return noModelOutcome({
      answer: `Our sales or technical team can review this with you. Email ${BUSINESS_DETAILS.salesEmail} or call ${BUSINESS_DETAILS.telephonePrimary}, including the product, model or reference and the outcome you need.`,
      intent: "human_escalation",
      nextAction:
        /\btechnical|unsafe|fault|damaged\b/i.test(request.message)
          ? "escalate_to_technical"
          : "escalate_to_sales",
      state,
    });
  }

  const emptyCatalog: CatalogSearchResult = {
    query: null,
    products: [],
    retrievedAt: null,
  };
  const searchCatalog = () =>
    dependencies.searchCatalog(request.message).catch((error) => {
      console.error("A-Matrix catalogue retrieval failed", error);
      return emptyCatalog;
    });

  if (decision.route === "direct_database") {
    const catalog = await searchCatalog();
    const exact = exactProductMatch(
      catalog.products,
      decision.exactIdentifiers,
    );
    if (exact) {
      return noModelOutcome({
        answer: directProductAnswer(exact, catalog.retrievedAt),
        intent: "product_search",
        nextAction: "show_products",
        state,
        products: [exact],
      });
    }

    return noModelOutcome({
      answer: `I could not confirm that exact identifier in the current online catalogue. A-Matrix may still be able to source it. Email ${BUSINESS_DETAILS.salesEmail} with the manufacturer, identifier, quantity, delivery location and required date for manual review.`,
      intent: "product_search",
      nextAction: "escalate_to_sales",
      state,
    });
  }

  if (decision.route !== "routine_ai" && decision.route !== "complex_ai") {
    throw new AIError("UNKNOWN_AI_ERROR", "Unsupported request route.");
  }
  const aiRoute: "routine_ai" | "complex_ai" = decision.route;
  const isProductIntent = PRODUCT_INTENTS.has(decision.intent);
  const catalog = isProductIntent
    ? await searchCatalog()
    : emptyCatalog;
  const shouldSearchKnowledge =
    Boolean(dependencies.searchKnowledge) &&
    (!isProductIntent || catalog.products.length === 0);
  const knowledge = shouldSearchKnowledge
    ? await dependencies.searchKnowledge!(request.message).catch((error) => {
        console.error("A-Matrix vector retrieval failed", error);
        return [];
      })
    : [];

  const sanitizedCurrent = sanitizeForModel(request.message);
  const sanitizedHistory = sanitizeMessagesForModel(
    request.recentMessages ?? [],
  );
  const compactProducts = serializeProductsForAI(
    catalog.products,
    catalog.retrievedAt,
  );
  const context = buildAIContext(
    {
      route: aiRoute,
      intent: decision.intent,
      conversationState: state,
      recentMessages: sanitizedHistory.messages,
      retrievedProducts: compactProducts,
      retrievedKnowledge: knowledge,
      workflowContext: workflowForIntent(decision.intent),
      currentMessage: sanitizedCurrent.text,
    },
    aiRoute === "routine_ai"
      ? {
          targetInputTokens: input.config.routineTargetInputTokens,
          maximumInputTokens: input.config.routineInputBudget,
          maximumHistoryMessages: input.config.maxHistoryMessages,
        }
      : {
          targetInputTokens: input.config.complexTargetInputTokens,
          maximumInputTokens: input.config.complexInputBudget,
          maximumHistoryMessages: input.config.maxHistoryMessages,
        },
  );

  const cacheKey = createResponseCacheKey({
    query: sanitizedCurrent.text,
    intent: decision.intent,
    selectedProductIds: context.includedProductIds,
  });
  const canCache = cacheableRequest({
    sanitized: sanitizedCurrent,
    request,
    intent: decision.intent,
  });
  const cached = canCache ? getCachedResponse<ChatOutcome>(cacheKey) : null;
  if (cached) {
    recordNoModelResponse();
    recordAIUsage({
      id: randomUUID(),
      sessionId: request.sessionId,
      requestId: request.requestId,
      modelAlias: aiRoute === "complex_ai" ? "complex" : "routine",
      route: aiRoute,
      intent: decision.intent,
      inputTokens: 0,
      outputTokens: 0,
      thoughtTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      selectedProductCount: context.includedProductIds.length,
      selectedDocumentChunkCount: context.includedDocumentChunkIds.length,
      historyMessageCount: 0,
      latencyMs: 0,
      retryCount: 0,
      cacheHit: true,
      truncated: context.truncationApplied,
      success: true,
      createdAt: new Date(),
    });
    return cached;
  }

  const idempotencyKey = createIdempotencyKey({
    sessionId: request.sessionId,
    message: sanitizedCurrent.text,
    stateVersion: state.version,
  });
  const generator = dependencies.generate ?? generateStructuredResponse;

  const idempotent = await runIdempotent(idempotencyKey, async () => {
    assertWithinRateLimits({
      ip: input.ip,
      sessionId: request.sessionId,
      hourlyLimit: input.config.anonymousRequestsPerHour,
      dailyLimit: input.config.anonymousRequestsPerDay,
    });
    const release = acquireSessionConcurrency(
      request.sessionId,
      input.config.maxConcurrentRequestsPerUser,
    );
    const usageId = randomUUID();
    const startedAt = Date.now();

    try {
      const generated = await generator({
        config: input.config,
        route: aiRoute,
        context,
      });
      const allowedIds = new Set(context.includedProductIds);
      const safeResponse: AMatrixAIResponse = {
        ...generated.response,
        selectedProductIds: generated.response.selectedProductIds.filter((id) =>
          allowedIds.has(id),
        ),
      };

      recordGenerationUsage({
        generated,
        id: usageId,
        request,
        decision,
        context,
        success: true,
      });

      return {
        answer: safeResponse.answer,
        intent: safeResponse.intent,
        nextAction: safeResponse.nextAction,
        products: catalog.products,
        conversationState: updateConversationState(state, safeResponse),
        route: aiRoute,
      } satisfies ChatOutcome;
    } catch (error) {
      recordAIUsage({
        id: usageId,
        sessionId: request.sessionId,
        requestId: request.requestId,
        modelAlias:
          aiRoute === "complex_ai" ? "complex" : "routine",
        route: aiRoute,
        intent: decision.intent,
        inputTokens: context.estimatedInputTokens,
        outputTokens: 0,
        thoughtTokens: 0,
        cachedTokens: 0,
        totalTokens: context.estimatedInputTokens,
        selectedProductCount: context.includedProductIds.length,
        selectedDocumentChunkCount: context.includedDocumentChunkIds.length,
        historyMessageCount: sanitizedHistory.messages.length,
        latencyMs: Date.now() - startedAt,
        retryCount: 0,
        cacheHit: false,
        truncated: context.truncationApplied,
        success: false,
        errorCode:
          error instanceof AIError ? error.code : "UNKNOWN_AI_ERROR",
        createdAt: new Date(),
      });
      throw error;
    } finally {
      release();
    }
  });

  if (idempotent.duplicate) recordDuplicateRequest();
  if (canCache && !idempotent.duplicate) {
    setCachedResponse(
      cacheKey,
      idempotent.value,
      input.config.responseCacheTtlSeconds,
    );
  }
  return idempotent.value;
}

function recordGenerationUsage(input: {
  generated: GenerateStructuredResponseResult;
  id: string;
  request: AMatrixChatRequest;
  decision: ReturnType<typeof routeRequest>;
  context: ReturnType<typeof buildAIContext>;
  success: boolean;
}) {
  recordAIUsage({
    id: input.id,
    sessionId: input.request.sessionId,
    requestId: input.request.requestId,
    modelAlias:
      input.decision.route === "complex_ai" ? "complex" : "routine",
    route:
      input.decision.route === "complex_ai" ? "complex_ai" : "routine_ai",
    intent: input.decision.intent,
    inputTokens: input.generated.usage.inputTokens,
    outputTokens: input.generated.usage.outputTokens,
    thoughtTokens: input.generated.usage.thoughtTokens,
    cachedTokens: input.generated.usage.cachedTokens,
    totalTokens: input.generated.usage.totalTokens,
    selectedProductCount: input.context.includedProductIds.length,
    selectedDocumentChunkCount: input.context.includedDocumentChunkIds.length,
    historyMessageCount: input.request.recentMessages?.length ?? 0,
    latencyMs: input.generated.latencyMs,
    retryCount: input.generated.retryCount,
    cacheHit: false,
    truncated: input.context.truncationApplied,
    success: input.success,
    createdAt: new Date(),
  });
}
