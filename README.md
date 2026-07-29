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
3. Search the public Asset Matrix Energy WordPress product catalogue only for
   product-related intents.
4. Prefer exact SKU, model and part-number variants before keyword ranking.
5. Retrieve relevant A-Matrix knowledge through Supabase pgvector when the
   database and embedding model are configured.
6. Sanitize sensitive data before constructing model context or persistence.
7. Build a compact context from a stable core instruction, one workflow module,
   structured state, at most five products, bounded knowledge chunks, four
   recent turns and the current message.
8. Enforce route-specific input and output budgets.
9. Stream the validated answer first, reveal products afterward and persist the
   exchange to Supabase without making database availability customer-critical.

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

## Catalogue retrieval and sync

The private Supabase database is the only catalogue source used during a chat
request. The chat searches normalized product names, manufacturers, models,
SKUs, descriptions and specification values. It never waits on either public
website. No more than five compact records are sent to generation.

`npm run catalog:sync` crawls both authoritative public sources:

- `a-matrix.ng` through its WooCommerce Store API, with product-sitemap and
  HTML parsing fallback.
- `assetmatrixenergy.com` through its custom product collection and
  specification-rich WordPress pages, with sitemap fallback.

Each run upserts structured products, replaces only source-managed
specifications and embeds changed catalogue content into pgvector. It is safe
to rerun:

```bash
npm run catalog:sync
npm run catalog:sync -- --source=a-matrix.ng
npm run catalog:sync -- --source=assetmatrixenergy.com
npm run catalog:sync -- --limit=20
npm run catalog:sync -- --skip-embeddings
npm run catalog:embed
```

Set `sync_locked=true` on a product before editing its main fields manually;
future crawls will retain those edits. Add a specification with
`source_managed=false` to preserve it across syncs. The latest normalized
source payload remains in `source_snapshot` for comparison and manual merging.
Price and availability labels remain indicative unless an authenticated
commercial system supplies them.

If Gemini reaches its embedding quota, the product/specification sync can
finish with `--skip-embeddings`. Run `npm run catalog:embed` after quota
resets; it reads from Supabase and embeds only products that do not already
have a knowledge document.

## Conversation state

The browser sends a random session ID, request ID, up to four recent turns and
compact structured state. Full conversation history is never resent
indefinitely. Starting over creates a new session and clears the state.

When Supabase is configured, each sanitized user/assistant exchange and compact
conversation state is persisted in `chat_sessions` and `chat_messages`.
Application rate limits, idempotency entries, response caching and aggregate
usage counters remain warm-instance memory and should move to a distributed
store before high-volume production use.

## Supabase and pgvector

Apply the ordered SQL files in
[`supabase/migrations`](supabase/migrations) in the Supabase SQL Editor or run
`node scripts/apply-migration.mjs` with the session-pooler connection
environment variables. The migrations:

- Enables the `vector` extension.
- Creates private conversation and message tables.
- Creates knowledge-document and 768-dimensional knowledge-chunk tables.
- Adds an HNSW cosine index.
- Adds the server-only `match_knowledge_chunks` retrieval function.
- Enables RLS with no browser-facing policies.
- Creates editable catalogue products, specification rows and sync-run audit
  records.
- Adds trigram indexes and the server-only `search_catalog_products` function.

After applying the migration, set `AI_ADMIN_TOKEN`, start the app and index the
verified catalogue snapshot:

```bash
curl -X POST http://localhost:3000/api/internal/knowledge/reindex \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

The indexing endpoint embeds catalogue content with
`GEMINI_EMBEDDING_MODEL`, stores it in pgvector and can be called again safely
when approved source content changes.

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
GEMINI_ROUTINE_MODEL=gemini-3.1-flash-lite
GEMINI_COMPLEX_MODEL=gemini-3.1-flash-lite
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your_server_only_secret
```

Model identifiers are deliberately not hard-coded. Choose currently eligible
models for the project in Google AI Studio, then change the environment values
without editing application code. `GEMINI_MODEL` remains a temporary backwards-
compatibility fallback for existing local environments.

Use the project origin for `SUPABASE_URL`, not its `/rest/v1/` endpoint. See
`.env.example` for token budgets, thinking controls, throttling, timeouts,
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
operations, distributed rate limiting and bot verification. Configure the same
server-only Supabase and Gemini variables in Vercel; never expose the Supabase
secret through a `NEXT_PUBLIC_` variable.
