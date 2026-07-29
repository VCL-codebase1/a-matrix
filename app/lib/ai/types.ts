import type { Content } from "@google/genai";

export type AIRequestRoute =
  | "static_response"
  | "direct_database"
  | "business_operation"
  | "routine_ai"
  | "complex_ai"
  | "human_escalation";

export type RequestComplexity = "routine" | "complex";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type AIIntent =
  | "general_enquiry"
  | "product_search"
  | "product_comparison"
  | "technical_recommendation"
  | "quotation_request"
  | "purchase_order"
  | "order_status"
  | "support_request"
  | "human_escalation";

export type AINextAction =
  | "show_products"
  | "ask_requirement"
  | "request_quote"
  | "submit_purchase_order"
  | "check_order"
  | "escalate_to_sales"
  | "escalate_to_technical"
  | "none";

export interface ExtractedRequirements {
  productName?: string;
  manufacturer?: string;
  model?: string;
  partNumber?: string;
  application?: string;
  quantity?: number;
  deliveryLocation?: string;
  requiredDate?: string;
  specifications?: Record<string, string>;
}

export interface AMatrixAIResponse {
  answer: string;
  intent: AIIntent;
  extractedRequirements: ExtractedRequirements;
  missingRequirements: string[];
  selectedProductIds: string[];
  confidence: "high" | "medium" | "low";
  nextAction: AINextAction;
}

export interface ConversationState {
  currentIntent?: string;
  application?: string;
  manufacturer?: string;
  model?: string;
  partNumber?: string;
  quantity?: number;
  deliveryLocation?: string;
  requiredDate?: string;
  requiredSpecifications?: Record<string, string>;
  productsConsidered?: string[];
  missingRequirements?: string[];
  lastSummary?: string;
  version: number;
}

export type CompactProductContext = {
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
  partNumber?: string;
  category?: string;
  applications?: string[];
  keySpecifications: Record<string, string>;
  priceStatus: "confirmed" | "indicative" | "quote_required" | "unavailable";
  stockStatus:
    | "in_stock"
    | "limited"
    | "out_of_stock"
    | "back_order"
    | "special_order"
    | "unknown";
  leadTime?: string;
  productUrl?: string;
  sourceUpdatedAt?: string;
};

export interface BuildAIContextInput {
  route: "routine_ai" | "complex_ai";
  intent: AIIntent;
  conversationState: ConversationState;
  recentMessages: ChatMessage[];
  retrievedProducts?: CompactProductContext[];
  workflowContext?: string;
  currentMessage: string;
}

export interface BuiltAIContext {
  systemInstruction: string;
  contents: Content[];
  estimatedInputTokens: number;
  includedProductIds: string[];
  includedDocumentChunkIds: string[];
  truncationApplied: boolean;
  truncationDecisions: string[];
}

export interface AIUsageRecord {
  id: string;
  sessionId: string;
  requestId: string;
  modelAlias: "routine" | "complex";
  route: "routine_ai" | "complex_ai";
  intent: string;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  cachedTokens: number;
  totalTokens: number;
  selectedProductCount: number;
  selectedDocumentChunkCount: number;
  historyMessageCount: number;
  latencyMs: number;
  retryCount: number;
  cacheHit: boolean;
  truncated: boolean;
  success: boolean;
  errorCode?: string;
  createdAt: Date;
}

export interface AMatrixChatRequest {
  sessionId: string;
  requestId: string;
  message: string;
  recentMessages?: ChatMessage[];
  conversationState?: Partial<ConversationState>;
  attachmentIds?: string[];
  website?: string;
}
