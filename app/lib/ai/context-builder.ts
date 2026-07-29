import { AIError } from "./errors";
import { A_MATRIX_STABLE_SYSTEM_INSTRUCTION } from "./prompts/core";
import type {
  BuildAIContextInput,
  BuiltAIContext,
  ChatMessage,
  CompactProductContext,
} from "./types";

export function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(text.length / 4);
}

function compactProduct(
  product: CompactProductContext,
): CompactProductContext {
  const summary = product.keySpecifications.catalogueSummary;
  return {
    ...product,
    keySpecifications: summary
      ? { catalogueSummary: summary.slice(0, 180) }
      : product.keySpecifications,
  };
}

function createContextContents(
  input: BuildAIContextInput,
  recentMessages: ChatMessage[],
  products: CompactProductContext[],
) {
  const contextSections = [
    `WORKFLOW\n${input.workflowContext ?? ""}`,
    `CONVERSATION STATE\n${JSON.stringify(input.conversationState)}`,
    products.length
      ? `CURRENT CATALOGUE PRODUCTS\n${JSON.stringify(products)}`
      : "CURRENT CATALOGUE PRODUCTS\nNone supplied. Do not claim a catalogue match.",
  ];

  return [
    {
      role: "user" as const,
      parts: [{ text: contextSections.join("\n\n") }],
    },
    ...recentMessages.map((message) => ({
      role: message.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: message.content }],
    })),
    {
      role: "user" as const,
      parts: [{ text: input.currentMessage }],
    },
  ];
}

export function buildAIContext(
  input: BuildAIContextInput,
  budgets: {
    targetInputTokens: number;
    maximumInputTokens: number;
    maximumHistoryMessages?: number;
  },
): BuiltAIContext {
  let recentMessages = input.recentMessages.slice(
    -(budgets.maximumHistoryMessages ?? 4),
  );
  let products = (input.retrievedProducts ?? []).slice(0, 5);
  const decisions: string[] = [];

  const calculate = () => {
    const contents = createContextContents(input, recentMessages, products);
    return {
      contents,
      tokens:
        estimateTokens(A_MATRIX_STABLE_SYSTEM_INSTRUCTION) +
        estimateTokens(contents),
    };
  };

  let built = calculate();

  while (
    built.tokens > budgets.targetInputTokens &&
    recentMessages.length > 2
  ) {
    recentMessages = recentMessages.slice(1);
    decisions.push("Removed the oldest conversation turn.");
    built = calculate();
  }

  while (built.tokens > budgets.targetInputTokens && products.length > 3) {
    products = products.slice(0, -1);
    decisions.push("Reduced catalogue context to the strongest matches.");
    built = calculate();
  }

  if (built.tokens > budgets.targetInputTokens && products.length > 0) {
    products = products.map(compactProduct);
    decisions.push("Shortened catalogue summaries.");
    built = calculate();
  }

  while (built.tokens > budgets.maximumInputTokens && recentMessages.length > 0) {
    recentMessages = recentMessages.slice(1);
    decisions.push("Removed additional history to stay within the hard budget.");
    built = calculate();
  }

  while (built.tokens > budgets.maximumInputTokens && products.length > 1) {
    products = products.slice(0, -1);
    decisions.push("Reduced product context to protect the hard token budget.");
    built = calculate();
  }

  if (built.tokens > budgets.maximumInputTokens) {
    throw new AIError(
      "TOKEN_BUDGET_EXCEEDED",
      `Estimated input ${built.tokens} exceeds ${budgets.maximumInputTokens}.`,
    );
  }

  if (decisions.length > 0) {
    console.info("A-Matrix context truncation", {
      route: input.route,
      estimatedInputTokens: built.tokens,
      decisions,
    });
  }

  return {
    systemInstruction: A_MATRIX_STABLE_SYSTEM_INSTRUCTION,
    contents: built.contents,
    estimatedInputTokens: built.tokens,
    includedProductIds: products.map((product) => product.id),
    includedDocumentChunkIds: [],
    truncationApplied: decisions.length > 0,
    truncationDecisions: decisions,
  };
}
