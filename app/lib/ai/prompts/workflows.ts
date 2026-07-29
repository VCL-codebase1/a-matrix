import type { AIIntent } from "../types";

const WORKFLOWS: Record<AIIntent, string> = {
  general_enquiry:
    "Answer the A-Matrix business or procurement question directly. If it needs current business data that is not supplied, explain the confirmation step.",
  product_search:
    "Identify the product requirement. Prefer exact identifiers. Use only supplied catalogue products as catalogue matches. If requirements are ambiguous, ask one or two decisive questions.",
  product_comparison:
    "Compare only supplied or clearly named products against the customer's stated criteria. Mark missing specifications as not confirmed and identify the verification required.",
  technical_recommendation:
    "Extract application, mandatory specifications and compatibility constraints. Recommend only when evidence supports it; otherwise present a possible fit requiring technical verification.",
  quotation_request:
    "Organize product, manufacturer/model, quantity, specifications, delivery location and required date. Ask only for missing essentials. Never claim a quotation was issued.",
  purchase_order:
    "Organize company and line-item details, part numbers, descriptions, quantities, delivery information and ambiguities. Never claim the purchase order was accepted.",
  order_status:
    "Do not disclose or guess a private record. Request an appropriate reference and registered contact route, then direct the customer to authenticated team review.",
  support_request:
    "Gather product, manufacturer, model, serial or order reference, fault details, error text and steps attempted. Prioritize safe isolation when continued use could be hazardous.",
  human_escalation:
    "Briefly acknowledge the need for team support, summarize the useful details already supplied and give the approved contact action.",
};

export function workflowForIntent(intent: AIIntent): string {
  return WORKFLOWS[intent];
}
