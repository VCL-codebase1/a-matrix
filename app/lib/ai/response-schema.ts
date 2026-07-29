import { z } from "zod";

import type { AMatrixAIResponse } from "./types";

const intentValues = [
  "general_enquiry",
  "product_search",
  "product_comparison",
  "technical_recommendation",
  "quotation_request",
  "purchase_order",
  "order_status",
  "support_request",
  "human_escalation",
] as const;

const nextActionValues = [
  "show_products",
  "ask_requirement",
  "request_quote",
  "submit_purchase_order",
  "check_order",
  "escalate_to_sales",
  "escalate_to_technical",
  "none",
] as const;

export const aMatrixAIResponseSchema = z.object({
  answer: z.string().trim().min(1).max(6000),
  intent: z.enum(intentValues),
  extractedRequirements: z.object({
    productName: z.string().trim().max(200).optional(),
    manufacturer: z.string().trim().max(120).optional(),
    model: z.string().trim().max(120).optional(),
    partNumber: z.string().trim().max(120).optional(),
    application: z.string().trim().max(500).optional(),
    quantity: z.number().positive().max(1_000_000).optional(),
    deliveryLocation: z.string().trim().max(250).optional(),
    requiredDate: z.string().trim().max(80).optional(),
    specifications: z.record(z.string(), z.string().max(500)).optional(),
  }),
  missingRequirements: z.array(z.string().trim().max(160)).max(12),
  selectedProductIds: z.array(z.string().trim().max(80)).max(5),
  confidence: z.enum(["high", "medium", "low"]),
  nextAction: z.enum(nextActionValues),
});

export const aMatrixResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "answer",
    "intent",
    "extractedRequirements",
    "missingRequirements",
    "selectedProductIds",
    "confidence",
    "nextAction",
  ],
  properties: {
    answer: { type: "string" },
    intent: { type: "string", enum: intentValues },
    extractedRequirements: {
      type: "object",
      additionalProperties: false,
      properties: {
        productName: { type: "string" },
        manufacturer: { type: "string" },
        model: { type: "string" },
        partNumber: { type: "string" },
        application: { type: "string" },
        quantity: { type: "number" },
        deliveryLocation: { type: "string" },
        requiredDate: { type: "string" },
        specifications: {
          type: "object",
          additionalProperties: { type: "string" },
        },
      },
    },
    missingRequirements: {
      type: "array",
      items: { type: "string" },
      maxItems: 12,
    },
    selectedProductIds: {
      type: "array",
      items: { type: "string" },
      maxItems: 5,
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    nextAction: { type: "string", enum: nextActionValues },
  },
} as const;

const PROVIDER_TERMS =
  /\b(?:google|gemini|large language model|language model|artificial intelligence|ai model|model provider|sdk)\b/gi;

export function removeProviderTerminology(value: string): string {
  return value
    .replace(PROVIDER_TERMS, "A-Matrix service")
    .replace(/\s+/g, " ")
    .trim();
}

function recoverJson(value: string): unknown {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("No JSON object was returned.");
  }
}

export function parseAIResponse(value: string): AMatrixAIResponse {
  const parsed = aMatrixAIResponseSchema.parse(recoverJson(value));
  return {
    ...parsed,
    answer: removeProviderTerminology(parsed.answer),
  };
}
