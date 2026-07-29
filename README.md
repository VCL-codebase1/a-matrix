# A-Matrix Support

A minimal customer-support assistant for A-Matrix Technical Product Supply,
built with Next.js App Router and the Google Gen AI SDK.

## What it does

- Helps customers identify technical products and requirements.
- Prepares quotation and custom-sourcing details.
- Guides replacement-product and compatibility conversations.
- Handles order and technical-support enquiries without inventing live data.
- Searches the public A-Matrix WooCommerce catalogue without using model tokens.
- Renders verified catalogue matches directly inside the conversation.
- Keeps the Gemini API key on the server.

This version has no database. It can read published product data from the
A-Matrix website, but it is not connected to authenticated inventory,
quotation, customer, or order-management systems.

## Catalogue search

For each customer message, the server:

1. Removes common conversational words and sensitive patterns.
2. Builds up to three deterministic product-search queries.
3. Searches the public WooCommerce Store API.
4. Deduplicates and ranks the results without AI.
5. Sends only four compact product records to Gemini for explanation.
6. Renders the verified records as product cards independently of Gemini.

Published catalogue searches are cached for five minutes. Website prices and
availability are shown with a confirmation notice because they are not binding
quotations or warehouse commitments.

## Local development

Requirements:

- Node.js 20.9 or newer
- A Gemini API key

Install dependencies:

```bash
npm install
```

Create `.env.local` from `.env.example` and add your key:

```env
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-3.5-flash-lite
```

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production checks

```bash
npm run lint
npm run build
```

## Deploying to Vercel

1. Push the repository to your Git provider.
2. Import the repository into Vercel.
3. Keep the automatically detected **Next.js** framework preset.
4. Add these environment variables for Production and Preview:

   - `GEMINI_API_KEY` — required and secret.
   - `GEMINI_MODEL` — optional; defaults to `gemini-3.5-flash-lite`.

5. Deploy. No custom build command or output directory is required.

Do not prefix the Gemini key with `NEXT_PUBLIC_`; that would expose it to the
browser.
