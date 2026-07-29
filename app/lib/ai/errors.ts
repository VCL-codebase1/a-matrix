export type AIErrorCode =
  | "RATE_LIMITED"
  | "TOKEN_BUDGET_EXCEEDED"
  | "MODEL_TIMEOUT"
  | "INVALID_MODEL_RESPONSE"
  | "CONTENT_REJECTED"
  | "RETRIEVAL_FAILED"
  | "CONFIGURATION_ERROR"
  | "DUPLICATE_IN_PROGRESS"
  | "AUTHENTICATION_REQUIRED"
  | "UNKNOWN_AI_ERROR";

export class AIError extends Error {
  constructor(
    public readonly code: AIErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AIError";
  }
}

const CUSTOMER_ERRORS: Record<AIErrorCode, string> = {
  RATE_LIMITED:
    "We are handling a high number of requests at the moment. Please try again shortly or contact our sales team for immediate assistance.",
  TOKEN_BUDGET_EXCEEDED:
    "That request contains more information than we can review safely at once. Please send the most important product, model or specification details first.",
  MODEL_TIMEOUT:
    "The response took longer than expected. Please try again in a moment.",
  INVALID_MODEL_RESPONSE:
    "We could not verify that product information reliably. Please provide the manufacturer or model number, or allow our sales team to review the request.",
  CONTENT_REJECTED:
    "We could not complete that request. Please rephrase it around the product or procurement requirement.",
  RETRIEVAL_FAILED:
    "We could not access the required catalogue information at the moment. Please try again or submit the product details for manual sourcing.",
  CONFIGURATION_ERROR:
    "We could not complete that request at the moment. Please try again or contact our sales team for assistance.",
  DUPLICATE_IN_PROGRESS:
    "That request is already being handled. Please wait a moment for the response.",
  AUTHENTICATION_REQUIRED:
    "For privacy, live order and quotation details must be checked by our team using your reference and registered contact details.",
  UNKNOWN_AI_ERROR:
    "We could not complete that request at the moment. Please try again or contact our sales team for assistance.",
};

export function toAIError(error: unknown): AIError {
  if (error instanceof AIError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes("429") ||
    normalized.includes("resource_exhausted") ||
    normalized.includes("rate limit")
  ) {
    return new AIError("RATE_LIMITED", message, { cause: error });
  }
  if (
    normalized.includes("timeout") ||
    normalized.includes("deadline") ||
    normalized.includes("aborted")
  ) {
    return new AIError("MODEL_TIMEOUT", message, { cause: error });
  }
  if (
    normalized.includes("safety") ||
    normalized.includes("blocked") ||
    normalized.includes("prohibited")
  ) {
    return new AIError("CONTENT_REJECTED", message, { cause: error });
  }

  return new AIError("UNKNOWN_AI_ERROR", message, { cause: error });
}

export function customerMessageForError(error: unknown): string {
  return CUSTOMER_ERRORS[toAIError(error).code];
}

export function statusForError(error: unknown): number {
  switch (toAIError(error).code) {
    case "RATE_LIMITED":
    case "DUPLICATE_IN_PROGRESS":
      return 429;
    case "AUTHENTICATION_REQUIRED":
      return 401;
    case "TOKEN_BUDGET_EXCEEDED":
    case "CONTENT_REJECTED":
      return 400;
    case "CONFIGURATION_ERROR":
      return 503;
    case "MODEL_TIMEOUT":
      return 504;
    default:
      return 502;
  }
}
