# A-Matrix Support

A Next.js customer-support assistant for A-Matrix Technical Product Supply.
It combines deterministic support logic, live public catalogue retrieval and
one structured server-side generation request when natural-language reasoning
is genuinely needed.

## Current architecture

The main endpoint is `POST /api/chat`. Each request is handled in this order:

1. Validate the request and reject bot honeypot submissions.
2. Route obvious FAQs, private-record requests, exact identifiers and human
   escalation with deterministic rules.
3. Search the public A-Matrix WooCommerce catalogue only for product-related
   intents.
4. Prefer exact SKU, model and part-number variants before keyword ranking.
5. Sanitize sensitive data before constructing model context.
6. Build a compact context from a stable core instruction, one workflow module,
   structured state, at most five products, four recent turns and the current
   message.
7. Enforce route-specific input and output budgets.
8. Return one validated structured response containing the answer, extracted
   requirements and the next action.

Normal customer messages therefore use zero or one generation request. A single
retry is allowed only for a transient server failure; rate-limit responses are
not retried.

## Zero-model paths

The following are handled without generation:

- Greetings and A-Matrix identity
- Business hours, address and contact information
- Standard quotation and purchase-order instructions
- How to request an unlisted product
- Standard order-check and technical-support instructions
- Private order, quotation, payment, return and warranty requests that require
  authenticated team review
- Human escalation
- Exact SKU, model and part-number catalogue lookup

## Catalogue retrieval

The server searches the public WooCommerce Store API. It normalizes product
identifiers, searches punctuation variants, performs keyword retrieval,
deduplicates results, strongly prioritizes exact SKU matches and sends no more
than five compact product records to generation.

Catalogue requests use Next.js' five-minute server cache. Public response
caching also uses a five-minute default. Website price and stock labels remain
indicative; final price, tax, availability and delivery require confirmation.

## Conversation state

The browser sends a random session ID, request ID, up to four recent turns and
compact structured state. Full conversation history is never resent
indefinitely. Starting over creates a new session and clears the state.

This project still has no database. State, rate limits, idempotency entries,
response caching and usage records are warm-instance memory only. That is useful
for local development and duplicate requests hitting the same Vercel function
instance, but it is not a durable cross-instance guarantee. Production should
move those stores to a shared service such as Vercel KV/Redis or a database.

## Privacy and security

- The API key and every generation call remain server-side.
- Email addresses, phone numbers, payment-card patterns, bank details and
  credentials are removed before model context is built.
- Customer-facing responses and errors are scrubbed of provider terminology.
- Live private business records are never guessed or disclosed without an
  authenticated business-system integration.
- One active request per session is allowed by default.
- Per-IP, per-session, hourly and daily application limits protect shared
  quota.
- Duplicate requests reuse the same in-progress or completed result.
- Requests have a strict timeout, at most one transient retry and a circuit
  breaker after repeated failures.

Do not prefix secret variables with `NEXT_PUBLIC_`.

## Environment configuration

Copy `.env.example` to `.env.local` and provide:

```env
GEMINI_API_KEY=your_server_key
GEMINI_ROUTINE_MODEL=your_current_flash_lite_class_model
GEMINI_COMPLEX_MODEL=your_current_flash_class_model
```

Model identifiers are deliberately not hard-coded. Choose currently eligible
models for the project in Google AI Studio, then change the environment values
without editing application code. `GEMINI_MODEL` remains a temporary backwards-
compatibility fallback for existing local environments.

See `.env.example` for token budgets, thinking controls, throttling, timeouts,
cache TTLs, message limits and the optional administrator token.

## Usage monitoring

`GET /api/internal/ai-usage` returns warm-instance aggregate usage, route mix,
token counts, cache hits, failures, rate-limit events and top sessions.

Set `AI_ADMIN_TOKEN`, then call the endpoint with:

```text
Authorization: Bearer <AI_ADMIN_TOKEN>
```

Without a valid token the endpoint returns `404`. API keys are never returned.
For production analytics, replace the in-memory recorder with durable storage.

## Local development

Requirements:

- Node.js 20.9 or newer
- Valid server-side model configuration

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Testing

```bash
npm run test:unit
npm test
```

The unit and integration tests mock generation and do not consume real quota.
`npm test` runs the mocked suite, ESLint and the optimized production build.

## Vercel

Import the repository using the standard Next.js preset and add the environment
variables from `.env.example` for Production and Preview. No custom output
directory or build command is required.

Before public launch, add durable shared storage, authentication for private
operations, distributed rate limiting, bot verification and a persistent usage
pipeline.
