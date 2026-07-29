import type {
  AMatrixAIResponse,
  ConversationState,
} from "./types";

export function normalizeConversationState(
  value?: Partial<ConversationState>,
): ConversationState {
  return {
    currentIntent: value?.currentIntent,
    application: value?.application,
    manufacturer: value?.manufacturer,
    model: value?.model,
    partNumber: value?.partNumber,
    quantity: value?.quantity,
    deliveryLocation: value?.deliveryLocation,
    requiredDate: value?.requiredDate,
    requiredSpecifications: value?.requiredSpecifications,
    productsConsidered: value?.productsConsidered?.slice(-10),
    missingRequirements: value?.missingRequirements?.slice(0, 12),
    lastSummary: value?.lastSummary?.slice(0, 2000),
    version: Math.max(0, Math.floor(value?.version ?? 0)),
  };
}

export function updateConversationState(
  current: ConversationState,
  response: AMatrixAIResponse,
): ConversationState {
  const extracted = response.extractedRequirements;
  return {
    ...current,
    currentIntent: response.intent,
    application: extracted.application ?? current.application,
    manufacturer: extracted.manufacturer ?? current.manufacturer,
    model: extracted.model ?? current.model,
    partNumber: extracted.partNumber ?? current.partNumber,
    quantity: extracted.quantity ?? current.quantity,
    deliveryLocation:
      extracted.deliveryLocation ?? current.deliveryLocation,
    requiredDate: extracted.requiredDate ?? current.requiredDate,
    requiredSpecifications:
      extracted.specifications ?? current.requiredSpecifications,
    productsConsidered: [
      ...new Set([
        ...(current.productsConsidered ?? []),
        ...response.selectedProductIds,
      ]),
    ].slice(-10),
    missingRequirements: response.missingRequirements,
    version: current.version + 1,
  };
}
