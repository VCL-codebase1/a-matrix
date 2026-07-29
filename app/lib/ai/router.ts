import { classifyRequestComplexity } from "./complexity";
import { extractExactIdentifiers } from "./identifiers";
import { matchStaticResponse } from "./static-responses";
import type { AIIntent, AIRequestRoute } from "./types";

export type RequestRoutingDecision = {
  route: AIRequestRoute;
  intent: AIIntent;
  reason: string;
  exactIdentifiers: string[];
  staticResponse: ReturnType<typeof matchStaticResponse>;
};

const PRIVATE_RECORD_PATTERN =
  /\b(?:my|our|this)\s+(?:order|quotation|quote|payment|refund|return|warranty)\b|\b(?:order|quotation|quote|payment|refund|return|warranty)\s+(?:status|number|reference|eligibility)\b/i;
const ESCALATION_PATTERN =
  /\b(?:human|person|representative|sales team|technical team|speak to someone|call me|complaint|unsafe|damaged|serious loss)\b/i;
const PURCHASE_ORDER_PATTERN = /\b(?:purchase order|\bpo\b)\b/i;
const QUOTATION_PATTERN = /\b(?:quotation|quote|rfq)\b/i;
const COMPARISON_PATTERN = /\b(?:compare|versus|vs\.?|difference)\b/i;
const RECOMMENDATION_PATTERN =
  /\b(?:recommend|suitable|application|compatible|replacement|equivalent|alternative)\b/i;
const SUPPORT_PATTERN =
  /\b(?:technical support|repair|maintenance|fault|error message|not working|broken)\b/i;
const PRODUCT_PATTERN =
  /\b(?:product|item|model|part|sku|catalogue|equipment|instrument|chemical|reagent|price|stock|availability|source|find)\b/i;

export function inferIntent(message: string): AIIntent {
  if (PRIVATE_RECORD_PATTERN.test(message)) return "order_status";
  if (PURCHASE_ORDER_PATTERN.test(message)) return "purchase_order";
  if (QUOTATION_PATTERN.test(message)) return "quotation_request";
  if (COMPARISON_PATTERN.test(message)) return "product_comparison";
  if (RECOMMENDATION_PATTERN.test(message)) return "technical_recommendation";
  if (SUPPORT_PATTERN.test(message)) return "support_request";
  if (PRODUCT_PATTERN.test(message)) return "product_search";
  return "general_enquiry";
}

export function routeRequest(
  message: string,
  attachmentCount = 0,
): RequestRoutingDecision {
  const staticResponse = matchStaticResponse(message);
  if (staticResponse) {
    return {
      route: "static_response",
      intent: staticResponse.intent,
      reason: `Matched static response: ${staticResponse.key}`,
      exactIdentifiers: [],
      staticResponse,
    };
  }

  const intent = inferIntent(message);
  const exactIdentifiers = extractExactIdentifiers(message);

  if (PRIVATE_RECORD_PATTERN.test(message)) {
    return {
      route: "business_operation",
      intent,
      reason: "Private business data requires authentication and a live system.",
      exactIdentifiers,
      staticResponse: null,
    };
  }

  if (ESCALATION_PATTERN.test(message)) {
    return {
      route: "human_escalation",
      intent: "human_escalation",
      reason: "Customer requested or requires human escalation.",
      exactIdentifiers,
      staticResponse: null,
    };
  }

  if (
    exactIdentifiers.length > 0 &&
    (intent === "product_search" || intent === "general_enquiry")
  ) {
    return {
      route: "direct_database",
      intent: "product_search",
      reason: "Exact product identifier can be searched deterministically.",
      exactIdentifiers,
      staticResponse: null,
    };
  }

  const complexity = classifyRequestComplexity(message, attachmentCount);
  return {
    route: complexity === "complex" ? "complex_ai" : "routine_ai",
    intent,
    reason:
      complexity === "complex"
        ? "Deterministic complexity rules selected stronger reasoning."
        : "Natural-language interpretation or composition is required.",
    exactIdentifiers,
    staticResponse: null,
  };
}
