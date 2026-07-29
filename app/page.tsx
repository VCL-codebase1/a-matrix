"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { BUSINESS_DETAILS } from "./lib/business";
import type { ConversationState } from "./lib/ai/types";

type ProductMatch = {
  id: number;
  name: string;
  url: string;
  sku: string | null;
  summary: string;
  listedPrice: string;
  availability: string;
  image: {
    url: string;
    alt: string;
  } | null;
  categories: string[];
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  products?: ProductMatch[];
  pending?: boolean;
};

type ChatStreamEvent =
  | {
      type: "answer_delta";
      text: string;
    }
  | {
      type: "complete";
      products?: ProductMatch[];
      conversationState?: ConversationState;
    };

const STARTERS = [
  {
    label: "Find a product",
    detail: "Search by name, model, part number or specification.",
    prompt:
      "I need help identifying a technical product. Please ask me for the most important details.",
  },
  {
    label: "Get a quote",
    detail: "Share the product, quantity and delivery details.",
    prompt:
      "I would like to request a quotation. Help me organize the product, quantity and delivery details.",
  },
  {
    label: "Find a replacement",
    detail: "Match an existing part with a suitable alternative.",
    prompt:
      "I need a replacement or alternative for an existing product. Help me identify the mandatory specifications.",
  },
  {
    label: "Order & technical help",
    detail: "Get support with an order, product or equipment issue.",
    prompt:
      "I need help with an existing order or a technical support issue. Please ask for the right reference and product details.",
  },
];

function ProductImage({ product }: { product: ProductMatch }) {
  const [failed, setFailed] = useState(false);

  if (!product.image || failed) {
    return <span>Image unavailable</span>;
  }

  return (
    <Image
      alt={product.image.alt}
      height={180}
      onError={() => setFailed(true)}
      src={product.image.url}
      unoptimized
      width={180}
    />
  );
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeAssistantRef = useRef<HTMLElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const conversationStateRef = useRef<ConversationState>({
    version: 0,
  });
  const activeRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 176)}px`;
  }, [prompt]);

  async function sendMessage(rawPrompt?: string) {
    const content = (rawPrompt ?? prompt).trim();
    if (!content || isThinking || activeRequestRef.current) return;

    const userMessage: ChatMessage = {
      role: "user",
      content,
    };
    const nextMessages = [...messages, userMessage];
    const assistantMessageIndex = nextMessages.length;

    setMessages([
      ...nextMessages,
      { role: "assistant", content: "", products: [], pending: true },
    ]);
    setPrompt("");
    setError("");
    setIsThinking(true);
    window.requestAnimationFrame(() => {
      activeAssistantRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
    const controller = new AbortController();
    activeRequestRef.current = controller;

    try {
      if (!sessionIdRef.current) {
        const stored = window.sessionStorage.getItem("a-matrix-session-id");
        sessionIdRef.current = stored || crypto.randomUUID();
        window.sessionStorage.setItem(
          "a-matrix-session-id",
          sessionIdRef.current,
        );
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          requestId: crypto.randomUUID(),
          message: content,
          recentMessages: messages.slice(-4),
          conversationState: conversationStateRef.current,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error || "We couldn’t complete that request.");
      }

      if (
        !response.body ||
        !response.headers
          .get("content-type")
          ?.includes("application/x-ndjson")
      ) {
        throw new Error("The response stream could not be read.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let receivedAnswer = false;

      const applyEvent = (event: ChatStreamEvent) => {
        if (event.type === "answer_delta") {
          receivedAnswer = true;
          setMessages((current) =>
            current.map((message, index) =>
              index === assistantMessageIndex
                ? {
                    ...message,
                    content: message.content + event.text,
                  }
                : message,
            ),
          );
          return;
        }

        setMessages((current) =>
          current.map((message, index) =>
            index === assistantMessageIndex
              ? {
                  ...message,
                  products: event.products ?? [],
                  pending: false,
                }
              : message,
          ),
        );
        if (event.conversationState) {
          conversationStateRef.current = event.conversationState;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          applyEvent(JSON.parse(line) as ChatStreamEvent);
        }

        if (done) break;
      }

      if (buffer.trim()) {
        applyEvent(JSON.parse(buffer) as ChatStreamEvent);
      }
      if (!receivedAnswer) {
        throw new Error("The response stream ended before an answer arrived.");
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setMessages((current) =>
        current.filter((_, index) => index !== assistantMessageIndex),
      );
      setError(
        caught instanceof Error
          ? caught.message
          : "The conversation was interrupted. Please try again.",
      );
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
        setIsThinking(false);
        window.setTimeout(() => textareaRef.current?.focus(), 50);
      }
    }
  }

  function startNewEnquiry() {
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    sessionIdRef.current = null;
    conversationStateRef.current = { version: 0 };
    window.sessionStorage.removeItem("a-matrix-session-id");
    setMessages([]);
    setPrompt("");
    setError("");
    setIsThinking(false);
    window.setTimeout(() => textareaRef.current?.focus(), 50);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <main className="app-shell">
      <header className="site-header">
        <Link className="brand-lockup" href="/" aria-label="A-Matrix home">
          <span className="wordmark">
            a-matrix<span>.</span>
          </span>
          <span className="brand-descriptor">Product support</span>
        </Link>

        <div className="header-actions">
          {messages.length > 0 && (
            <button
              className="new-enquiry"
              onClick={startNewEnquiry}
              type="button"
            >
              Start over
            </button>
          )}
          <a
            className="header-contact"
            href={`tel:${BUSINESS_DETAILS.telephonePrimary.replace(/\s/g, "")}`}
          >
            Call us
          </a>
          <a
            className="header-contact primary"
            href={`mailto:${BUSINESS_DETAILS.salesEmail}`}
          >
            Email sales
          </a>
        </div>
      </header>

      <section
        className={`conversation ${messages.length ? "has-messages" : ""}`}
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="empty-state">
            <h1>Hi, how can we help today?</h1>
            <p className="intro">
              Tell us what you’re looking for. A product name, model or part
              number is a great place to start.
            </p>

            <div className="starters" aria-label="Support options">
              {STARTERS.map((starter) => (
                <button
                  className="starter"
                  key={starter.label}
                  onClick={() => void sendMessage(starter.prompt)}
                  type="button"
                >
                  <span className="starter-copy">
                    <strong>{starter.label}</strong>
                    <small>{starter.detail}</small>
                  </span>
                  <span className="starter-arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              ))}
            </div>

            <div className="contact-strip">
              <p>
                Prefer to speak with someone?
                <span>{BUSINESS_DETAILS.hoursShort}</span>
              </p>
              <div>
                <a
                  href={`tel:${BUSINESS_DETAILS.telephonePrimary.replace(/\s/g, "")}`}
                >
                  Call {BUSINESS_DETAILS.telephonePrimary}
                </a>
                <a href={`mailto:${BUSINESS_DETAILS.salesEmail}`}>
                  Email sales
                </a>
              </div>
            </div>
          </div>
        ) : (
          <div className="thread">
            {messages.map((message, messageIndex) => (
              <article
                className={`message ${message.role}${message.pending ? " pending" : ""}`}
                key={`${message.role}-${messageIndex}`}
                ref={
                  message.role === "assistant" && message.pending
                    ? activeAssistantRef
                    : undefined
                }
                aria-busy={message.pending || undefined}
              >
                <p className="speaker">
                  {message.role === "assistant" ? "A-Matrix" : "You"}
                </p>
                {message.content ? (
                  <div className="message-copy">
                    {message.content.split("\n").map((line, index, lines) => (
                      <span key={`${message.role}-${messageIndex}-${index}`}>
                        {line || "\u00A0"}
                        {index < lines.length - 1 && <br />}
                      </span>
                    ))}
                  </div>
                ) : (
                  message.pending && (
                    <div
                      className="thinking-status"
                      aria-label="A-Matrix is preparing a response"
                    >
                      Checking that for you…
                    </div>
                  )
                )}

                {message.role === "assistant" &&
                  message.products &&
                  message.products.length > 0 && (
                    <section
                      className="catalog-results"
                      aria-label="Products from the A-Matrix catalogue"
                    >
                      <div className="catalog-results-heading">
                        <p>Products from our catalogue</p>
                      </div>

                      <div className="product-grid">
                        {message.products.map((product) => (
                          <article className="product-card" key={product.id}>
                            <div className="product-image">
                              <ProductImage product={product} />
                            </div>
                            <div className="product-content">
                              {product.categories.length > 0 && (
                                <p className="product-category">
                                  {product.categories.join(" · ")}
                                </p>
                              )}
                              <h2>{product.name}</h2>
                              {product.sku && (
                                <p className="product-sku">
                                  SKU: {product.sku}
                                </p>
                              )}
                              {product.summary && (
                                <p className="product-summary">
                                  {product.summary}
                                </p>
                              )}
                              <div className="product-meta">
                                <strong>{product.listedPrice}</strong>
                                <span>{product.availability}</span>
                              </div>
                              <a
                                className="product-link"
                                href={product.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                View product
                                <span aria-hidden="true">↗</span>
                              </a>
                            </div>
                          </article>
                        ))}
                      </div>

                      <p className="catalog-disclaimer">
                        Website information is current at retrieval time.
                        Availability, taxes, delivery, and final pricing require
                        confirmation.
                      </p>
                    </section>
                  )}
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="composer-region">
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <form className="composer" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="prompt">
            Message A-Matrix support
          </label>
          <textarea
            autoComplete="off"
            autoFocus
            id="prompt"
            maxLength={12000}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What are you looking for? Add a product name, model or part number…"
            ref={textareaRef}
            rows={1}
            value={prompt}
          />
          <button
            className="send-button"
            disabled={!prompt.trim() || isThinking}
            type="submit"
            aria-label="Send message"
          >
            Send
          </button>
        </form>
        <p className="composer-note">
          We’ll only use the details you share to help with this enquiry.
        </p>
      </div>
    </main>
  );
}
