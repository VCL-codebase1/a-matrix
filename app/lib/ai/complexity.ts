import type { RequestComplexity } from "./types";

const COMPLEX_PATTERNS = [
  /\bcompatib(?:le|ility)\b/i,
  /\b(?:replacement|equivalent|substitute|alternative)\b/i,
  /\b(?:safety[- ]critical|life support|surgical|nuclear|aviation)\b/i,
  /\b(?:hazardous|flammable|explosive|toxic|corrosive|biohazard)\b/i,
  /\b(?:conflicting|contradictory)\s+(?:requirements|specifications|specs)\b/i,
  /\b(?:multi[- ]stage|multi[- ]item)\s+(?:procurement|rfq|quotation)\b/i,
  /\b(?:datasheet|technical document|purchase order|rfq)\b/i,
];

const COMPARISON_PATTERN = /\b(?:compare|versus|vs\.?|difference between)\b/i;
const PRODUCT_REFERENCE_PATTERN =
  /\b[a-z]{1,8}[-_/]?[a-z0-9]{1,12}\d[a-z0-9._/-]*\b/gi;

export function classifyRequestComplexity(
  message: string,
  attachmentCount = 0,
): RequestComplexity {
  if (attachmentCount > 1) return "complex";
  if (COMPLEX_PATTERNS.some((pattern) => pattern.test(message))) {
    return "complex";
  }

  if (COMPARISON_PATTERN.test(message)) {
    const references = message.match(PRODUCT_REFERENCE_PATTERN) ?? [];
    const productSeparators = message.match(/\b(?:and|versus|vs\.?)\b/gi) ?? [];
    if (references.length >= 2 || productSeparators.length >= 1) {
      return "complex";
    }
  }

  return "routine";
}
