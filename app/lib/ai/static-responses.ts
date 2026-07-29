import { BUSINESS_DETAILS, BUSINESS_HOURS_SUMMARY } from "../business";
import type { AIIntent, AINextAction } from "./types";

export type StaticResponseMatch = {
  key: string;
  answer: string;
  intent: AIIntent;
  nextAction: AINextAction;
};

const responses = {
  greeting: `Welcome to A-Matrix. What product or procurement requirement can we help you with?`,
  identity:
    "I’m A-Matrix’s digital product and procurement assistant. I can help you find products, compare specifications, request quotations, submit procurement requirements and connect with our sales or technical team.",
  hours: `Our opening hours are ${BUSINESS_HOURS_SUMMARY}.`,
  contact: `You can reach A-Matrix sales at ${BUSINESS_DETAILS.salesEmail}, ${BUSINESS_DETAILS.telephonePrimary}, or ${BUSINESS_DETAILS.telephoneSecondary}.`,
  address: `Our office is at ${BUSINESS_DETAILS.office}.`,
  quotation:
    "To request a quotation, provide the product name or part number, quantity, required specifications, delivery location and required date. We’ll organize the request for our sales team to confirm.",
  purchaseOrder: `Send your purchase order to ${BUSINESS_DETAILS.salesEmail} with your company details, line items, part numbers, quantities and delivery address. Our team must review it before acceptance is confirmed.`,
  unlistedProduct:
    "A-Matrix may be able to source products beyond the online catalogue. Send the manufacturer, model or part number, key specifications, quantity, delivery location and required date.",
  orderCheck: `For privacy, order status must be verified by our team. Send your order, quotation or purchase-order reference from the registered email address to ${BUSINESS_DETAILS.salesEmail}, or call ${BUSINESS_DETAILS.telephonePrimary}.`,
  technicalSupport: `For technical support, provide the product name, manufacturer, model, serial number, order reference and a clear description of the issue. Email the details to ${BUSINESS_DETAILS.salesEmail} for technical review.`,
} as const;

const RULES: Array<{
  key: keyof typeof responses;
  pattern: RegExp;
  intent: AIIntent;
  nextAction: AINextAction;
}> = [
  {
    key: "identity",
    pattern:
      /^(?:who|what)\s+(?:are|is)\s+(?:you|a-matrix)|^(?:tell me about|what is)\s+a-matrix\b/i,
    intent: "general_enquiry",
    nextAction: "none",
  },
  {
    key: "greeting",
    pattern:
      /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|greetings)[!.,\s]*$/i,
    intent: "general_enquiry",
    nextAction: "ask_requirement",
  },
  {
    key: "hours",
    pattern:
      /\b(?:opening|business|office|working)\s+hours\b|\bwhen\s+(?:are you|do you)\s+open\b|\bopen\s+(?:today|tomorrow|saturday|sunday)\b/i,
    intent: "general_enquiry",
    nextAction: "none",
  },
  {
    key: "address",
    pattern:
      /\b(?:office|business)\s+(?:address|location)\b|\bwhere\s+(?:are you|is a-matrix)\s+(?:located|based)\b/i,
    intent: "general_enquiry",
    nextAction: "none",
  },
  {
    key: "contact",
    pattern:
      /\b(?:contact|phone|telephone|email)\s+(?:details|number|address|sales|a-matrix)\b|\bhow\s+(?:can|do)\s+i\s+(?:contact|call|email)\b/i,
    intent: "general_enquiry",
    nextAction: "escalate_to_sales",
  },
  {
    key: "quotation",
    pattern:
      /^(?:how|what)\b.{0,35}\b(?:request|get|prepare|submit)\b.{0,15}\b(?:a\s+)?(?:quote|quotation)\b/i,
    intent: "quotation_request",
    nextAction: "request_quote",
  },
  {
    key: "purchaseOrder",
    pattern:
      /^(?:how|where|what)\b.{0,40}\b(?:send|submit)\b.{0,15}\b(?:a\s+)?(?:purchase order|po)\b/i,
    intent: "purchase_order",
    nextAction: "submit_purchase_order",
  },
  {
    key: "unlistedProduct",
    pattern:
      /\b(?:product|item)\s+(?:is\s+)?not\s+(?:listed|in the catalogue)\b|\bsource\s+(?:an\s+)?unlisted\b/i,
    intent: "product_search",
    nextAction: "escalate_to_sales",
  },
  {
    key: "orderCheck",
    pattern:
      /\b(?:how|where)\b.{0,20}\b(?:check|track)\b.{0,20}\b(?:an?\s+|my\s+)?(?:order|quotation|quote)(?:\s+(?:status|progress))?\b/i,
    intent: "order_status",
    nextAction: "check_order",
  },
  {
    key: "technicalSupport",
    pattern:
      /^(?:how|where)\b.{0,30}\b(?:get|contact|request)\b.{0,20}\btechnical support\b/i,
    intent: "support_request",
    nextAction: "escalate_to_technical",
  },
];

export function matchStaticResponse(
  message: string,
): StaticResponseMatch | null {
  const normalized = message.trim().replace(/\s+/g, " ");
  const rule = RULES.find((candidate) => candidate.pattern.test(normalized));
  return rule
    ? {
        key: rule.key,
        answer: responses[rule.key],
        intent: rule.intent,
        nextAction: rule.nextAction,
      }
    : null;
}
