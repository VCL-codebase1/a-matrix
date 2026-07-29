import "server-only";

import {
  extractExactIdentifiers,
  identifierVariants,
  identifiersEqual,
} from "./ai/identifiers";

const CATALOG_ORIGIN = "https://a-matrix.ng";
const PRODUCTS_ENDPOINT = `${CATALOG_ORIGIN}/wp-json/wc/store/v1/products`;
const MAX_RESULTS = 4;

const STOP_WORDS = new Set([
  "a",
  "about",
  "am",
  "an",
  "and",
  "any",
  "are",
  "ask",
  "assist",
  "assistance",
  "available",
  "can",
  "catalogue",
  "could",
  "current",
  "details",
  "do",
  "existing",
  "find",
  "for",
  "from",
  "get",
  "give",
  "goodbye",
  "have",
  "hello",
  "help",
  "hi",
  "how",
  "identify",
  "identifying",
  "i",
  "im",
  "in",
  "information",
  "is",
  "it",
  "item",
  "like",
  "looking",
  "me",
  "my",
  "need",
  "of",
  "on",
  "or",
  "order",
  "please",
  "price",
  "product",
  "products",
  "quotation",
  "quote",
  "request",
  "right",
  "search",
  "show",
  "some",
  "something",
  "source",
  "support",
  "tell",
  "thanks",
  "thank",
  "technical",
  "that",
  "the",
  "this",
  "to",
  "want",
  "we",
  "what",
  "when",
  "where",
  "who",
  "why",
  "with",
  "you",
  "your",
  "yourself",
]);

type StoreApiPrice = {
  price?: string;
  currency_code?: string;
  currency_symbol?: string;
  currency_minor_unit?: number;
  currency_prefix?: string;
  currency_suffix?: string;
};

type StoreApiProduct = {
  id?: number;
  name?: string;
  permalink?: string;
  sku?: string;
  summary?: string;
  short_description?: string;
  prices?: StoreApiPrice;
  is_in_stock?: boolean;
  is_purchasable?: boolean;
  categories?: Array<{ name?: string }>;
  images?: Array<{
    src?: string;
    thumbnail?: string;
    alt?: string;
    name?: string;
  }>;
};

export type CatalogProduct = {
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

export type CatalogSearchResult = {
  query: string | null;
  products: CatalogProduct[];
  retrievedAt: string | null;
  exactIdentifier?: string | null;
};

function decodeText(value: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&quot;": '"',
    "&#039;": "'",
    "&apos;": "'",
    "&lt;": "<",
    "&gt;": ">",
    "&nbsp;": " ",
    "&times;": "×",
  };

  return value
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(amp|quot|#039|apos|lt|gt|nbsp|times);/g,
      (entity) => entities[entity] ?? entity,
    )
    .replace(/&#(\d+);/g, (_, code: string) => {
      const codePoint = Number(code);
      return Number.isInteger(codePoint) &&
        codePoint >= 0 &&
        codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function safeCatalogUrl(value?: string): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    const isCatalogHost =
      url.hostname === "a-matrix.ng" ||
      url.hostname.endsWith(".a-matrix.ng");

    return url.protocol === "https:" && isCatalogHost ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatPrice(prices?: StoreApiPrice): string {
  const rawPrice = Number(prices?.price);
  const minorUnit = prices?.currency_minor_unit ?? 2;

  if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
    return "Quotation required";
  }

  const amount = rawPrice / 10 ** minorUnit;
  const currency = prices?.currency_code;

  if (currency) {
    try {
      return new Intl.NumberFormat("en", {
        style: "currency",
        currency,
        minimumFractionDigits: minorUnit,
        maximumFractionDigits: minorUnit,
      }).format(amount);
    } catch {
      // Fall through to the catalogue's own currency formatting.
    }
  }

  return `${prices?.currency_prefix ?? prices?.currency_symbol ?? ""}${amount.toLocaleString("en", {
    minimumFractionDigits: minorUnit,
    maximumFractionDigits: minorUnit,
  })}${prices?.currency_suffix ?? ""}`.trim();
}

function extractSearchQueries(prompt: string): {
  displayQuery: string | null;
  queries: string[];
  tokens: string[];
} {
  const quoted = prompt.match(/[“"]([^”"]{2,100})[”"]/u)?.[1]?.trim();
  const identifier = extractExactIdentifiers(prompt)[0];

  const sanitized = prompt
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b\S+@\S+\.\S+\b/g, " ")
    .replace(/\+?\d[\d\s()\-]{7,}\d/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9._/+%-]+/g, " ");

  const tokens = sanitized
    .split(/\s+/)
    .map((token) => token.replace(/^[._/+%-]+|[._/+%-]+$/g, ""))
    .filter(
      (token) =>
        token.length >= 2 &&
        token.length <= 40 &&
        !STOP_WORDS.has(token) &&
        !/^\d+$/.test(token),
    )
    .slice(0, 10);

  const compact = tokens.join(" ").slice(0, 100).trim();
  const queries = [
    ...(identifier ? identifierVariants(identifier) : []),
    quoted,
    compact,
    tokens.slice(0, 3).join(" "),
    tokens.length > 1 ? tokens[tokens.length - 1] : null,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim())
    .filter(
      (value, index, values) =>
        values.findIndex(
          (candidate) => candidate.toLowerCase() === value.toLowerCase(),
        ) === index,
    )
    .slice(0, 3);

  return {
    displayQuery: (identifier ?? quoted ?? compact) || null,
    queries,
    tokens,
  };
}

async function fetchProducts(query: string): Promise<StoreApiProduct[]> {
  const url = new URL(PRODUCTS_ENDPOINT);
  url.searchParams.set("search", query);
  url.searchParams.set("per_page", "8");
  url.searchParams.set("catalog_visibility", "visible");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "A-Matrix-Support/1.0",
    },
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Catalogue request failed with ${response.status}`);
  }

  const data: unknown = await response.json();
  return Array.isArray(data) ? (data as StoreApiProduct[]) : [];
}

function normalizeProduct(product: StoreApiProduct): CatalogProduct | null {
  if (
    typeof product.id !== "number" ||
    typeof product.name !== "string" ||
    !product.name.trim()
  ) {
    return null;
  }

  const url = safeCatalogUrl(product.permalink);
  if (!url) return null;

  const firstImage = product.images?.[0];
  const imageUrl = safeCatalogUrl(firstImage?.thumbnail ?? firstImage?.src);
  const summary = decodeText(
    product.summary ?? product.short_description ?? "",
  ).slice(0, 280);

  return {
    id: product.id,
    name: decodeText(product.name),
    url,
    sku:
      typeof product.sku === "string" && product.sku.trim()
        ? product.sku.trim()
        : null,
    summary,
    listedPrice: formatPrice(product.prices),
    availability: product.is_in_stock
      ? "Website status: in stock"
      : product.is_purchasable
        ? "Availability requires confirmation"
        : "Quotation or availability check required",
    image:
      imageUrl && firstImage
        ? {
            url: imageUrl,
            alt:
              decodeText(firstImage.alt ?? firstImage.name ?? product.name) ||
              product.name,
          }
        : null,
    categories: (product.categories ?? [])
      .map((category) =>
        typeof category.name === "string" ? decodeText(category.name) : "",
      )
      .filter(Boolean)
      .slice(0, 3),
  };
}

function scoreProduct(
  product: CatalogProduct,
  tokens: string[],
  displayQuery: string | null,
): number {
  const name = product.name.toLowerCase();
  const sku = product.sku?.toLowerCase() ?? "";
  const summary = product.summary.toLowerCase();
  let score = 0;

  if (displayQuery && name.includes(displayQuery.toLowerCase())) score += 50;
  if (displayQuery && sku && identifiersEqual(sku, displayQuery)) score += 1000;

  for (const token of tokens) {
    if (name.includes(token)) score += 12;
    if (sku.includes(token)) score += 24;
    if (summary.includes(token)) score += 2;
  }

  return score;
}

export async function searchPublishedCatalog(
  prompt: string,
): Promise<CatalogSearchResult> {
  const { displayQuery, queries, tokens } = extractSearchQueries(prompt);

  if (!displayQuery || queries.length === 0) {
    return {
      query: null,
      products: [],
      retrievedAt: null,
      exactIdentifier: null,
    };
  }

  const responses = await Promise.allSettled(
    queries.map((query) => fetchProducts(query)),
  );

  const productsById = new Map<number, CatalogProduct>();
  let successfulRequest = false;

  for (const response of responses) {
    if (response.status !== "fulfilled") continue;
    successfulRequest = true;

    for (const rawProduct of response.value) {
      const product = normalizeProduct(rawProduct);
      if (product) productsById.set(product.id, product);
    }
  }

  const products = [...productsById.values()]
    .sort(
      (left, right) =>
        scoreProduct(right, tokens, displayQuery) -
        scoreProduct(left, tokens, displayQuery),
    )
    .slice(0, MAX_RESULTS);

  return {
    query: displayQuery,
    products,
    retrievedAt: successfulRequest ? new Date().toISOString() : null,
    exactIdentifier: extractExactIdentifiers(prompt)[0] ?? null,
  };
}
