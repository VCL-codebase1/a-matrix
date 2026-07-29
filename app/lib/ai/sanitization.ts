const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?<![\w-])\+?\d[\d\s().-]{7,}\d(?![\w-])/g;
const PAYMENT_CARD_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;
const API_KEY_PATTERN =
  /\b(?:AIza[0-9A-Za-z_-]{20,}|AQ\.[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z_-]{20,})\b/g;
const CREDENTIAL_PATTERN =
  /\b(password|passcode|pin|otp|one[- ]time code|access token|auth token|database password|api key)\s*[:=]\s*\S+/gi;
const BANK_PATTERN =
  /\b(?:account number|bank account|routing number|sort code)\s*[:=]\s*[A-Z0-9 -]{5,}\b/gi;

export type SanitizationResult = {
  text: string;
  redactions: string[];
  containsSensitiveData: boolean;
};

export function sanitizeForModel(value: string): SanitizationResult {
  const redactions: string[] = [];
  let text = value;

  const replace = (pattern: RegExp, label: string) => {
    text = text.replace(pattern, () => {
      redactions.push(label);
      return `[${label} removed]`;
    });
  };

  replace(API_KEY_PATTERN, "credential");
  replace(CREDENTIAL_PATTERN, "credential");
  replace(PAYMENT_CARD_PATTERN, "payment card");
  replace(BANK_PATTERN, "bank detail");
  replace(EMAIL_PATTERN, "email");
  replace(PHONE_PATTERN, "phone");

  return {
    text: text.trim(),
    redactions: [...new Set(redactions)],
    containsSensitiveData: redactions.length > 0,
  };
}

export function sanitizeMessagesForModel<T extends { content: string }>(
  messages: T[],
): { messages: T[]; redactions: string[] } {
  const redactions: string[] = [];
  return {
    messages: messages.map((message) => {
      const sanitized = sanitizeForModel(message.content);
      redactions.push(...sanitized.redactions);
      return { ...message, content: sanitized.text };
    }),
    redactions: [...new Set(redactions)],
  };
}
