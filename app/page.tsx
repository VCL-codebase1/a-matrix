"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const STARTERS = [
  {
    number: "01",
    label: "Find a product",
    detail: "Identify the right model, part or specification.",
    prompt:
      "I need help identifying a technical product. Please ask me for the most important details.",
  },
  {
    number: "02",
    label: "Request a quotation",
    detail: "Prepare the details our sales team will need.",
    prompt:
      "I would like to request a quotation. Help me organize the product, quantity and delivery details.",
  },
  {
    number: "03",
    label: "Source an alternative",
    detail: "Match a replacement or an unlisted item.",
    prompt:
      "I need a replacement or alternative for an existing product. Help me identify the mandatory specifications.",
  },
  {
    number: "04",
    label: "Order or technical support",
    detail: "Get help with an order, product or equipment issue.",
    prompt:
      "I need help with an existing order or a technical support issue. Please ask for the right reference and product details.",
  },
];

const DOMAINS = [
  "Laboratory",
  "Chemicals & reagents",
  "Instrumentation",
  "Automation",
  "Industrial supply",
];

function ArrowIcon() {
  return <span aria-hidden="true">↑</span>;
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 176)}px`;
  }, [prompt]);

  async function sendMessage(rawPrompt?: string) {
    const content = (rawPrompt ?? prompt).trim();
    if (!content || isThinking) return;

    const userMessage: ChatMessage = {
      role: "user",
      content,
    };
    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
    setPrompt("");
    setError("");
    setIsThinking(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content: text }) => ({
            role,
            content: text,
          })),
        }),
      });

      const data = (await response.json()) as {
        answer?: string;
        error?: string;
      };

      if (!response.ok || !data.answer) {
        throw new Error(data.error || "We couldn’t complete that request.");
      }

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: data.answer!,
        },
      ]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The conversation was interrupted. Please try again.",
      );
    } finally {
      setIsThinking(false);
      window.setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }

  function startNewEnquiry() {
    setMessages([]);
    setPrompt("");
    setError("");
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
          <span className="brand-descriptor">
            Technical product supply
          </span>
        </Link>

        <div className="header-actions">
          {messages.length > 0 && (
            <button
              className="new-enquiry"
              onClick={startNewEnquiry}
              type="button"
            >
              New enquiry
            </button>
          )}
          <a className="header-email" href="mailto:sales@a-matrix.ng">
            sales@a-matrix.ng
          </a>
          <div className="availability" aria-label="A-Matrix support is online">
            <span className="status-dot" />
            support online
          </div>
        </div>
      </header>

      <section
        className={`conversation ${messages.length ? "has-messages" : ""}`}
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="empty-state">
            <p className="eyebrow">Product · Procurement · Support</p>
            <h1>
              What can we help
              <br />
              you source<span>?</span>
            </h1>
            <p className="intro">
              Find technical products, clarify specifications, prepare a
              quotation request, or get support with an existing order.
            </p>

            <div className="starters" aria-label="Support options">
              {STARTERS.map((starter) => (
                <button
                  className="starter"
                  key={starter.number}
                  onClick={() => void sendMessage(starter.prompt)}
                  type="button"
                >
                  <span className="starter-number">{starter.number}</span>
                  <span className="starter-copy">
                    <strong>{starter.label}</strong>
                    <small>{starter.detail}</small>
                  </span>
                  <span className="starter-arrow" aria-hidden="true">
                    ↗
                  </span>
                </button>
              ))}
            </div>

            <div className="domain-strip" aria-label="Product categories">
              <span>We support</span>
              <div>
                {DOMAINS.map((domain) => (
                  <span key={domain}>{domain}</span>
                ))}
              </div>
            </div>

            <div className="contact-strip">
              <p>
                Need a product specialist?
                <span>Monday–Friday, 9:00–17:00 WAT</span>
              </p>
              <div>
                <a href="tel:+2347069176001">+234 706 917 6001</a>
                <a href="mailto:sales@a-matrix.ng">Email sales</a>
              </div>
            </div>
          </div>
        ) : (
          <div className="thread">
            <div className="thread-heading">
              <p>Customer support enquiry</p>
              <span>Details stay in this conversation</span>
            </div>

            {messages.map((message, messageIndex) => (
              <article
                className={`message ${message.role}`}
                key={`${message.role}-${messageIndex}`}
              >
                <p className="speaker">
                  {message.role === "assistant" ? "A-Matrix support" : "You"}
                </p>
                <div className="message-copy">
                  {message.content.split("\n").map((line, index, lines) => (
                    <span key={`${message.role}-${messageIndex}-${index}`}>
                      {line || "\u00A0"}
                      {index < lines.length - 1 && <br />}
                    </span>
                  ))}
                </div>
              </article>
            ))}

            {isThinking && (
              <article className="message assistant thinking">
                <p className="speaker">A-Matrix support</p>
                <div className="thinking-dots" aria-label="A-Matrix is thinking">
                  <span />
                  <span />
                  <span />
                </div>
              </article>
            )}
            <div ref={threadEndRef} />
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
            placeholder="Describe the product, part number, order or support issue…"
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
            <ArrowIcon />
          </button>
        </form>
        <p className="composer-note">
          Do not share passwords or payment-card details
          <span>·</span>
          Enter to send
        </p>
      </div>
    </main>
  );
}
