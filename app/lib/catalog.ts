import "server-only";

import {
  extractExactIdentifiers,
  identifierVariants,
  identifiersEqual,
} from "./ai/identifiers";
import { searchVerifiedCatalogueSnapshot } from "./catalog-snapshot";

const CATALOG_ORIGIN = "https://assetmatrixenergy.com";
const PRODUCTS_ENDPOINT = `${CATALOG_ORIGIN}/wp-json/wp/v2/amel-products`;
const PAGES_ENDPOINT = `${CATALOG_ORIGIN}/wp-json/wp/v2/pages`;
const MAX_RESULTS = 4;
const MAX_SEARCH_REQUESTS = 2;

const STOP_WORDS = new Set([
  "a",
  "about",
  "am",
  "an",
  "and",
  "any",
  "are",
  "available",
  "can",
  "catalogue",
  "could",
  "details",
  "do",
  "find",
  "for",
  "from",
  "get",
  "give",
  "have",
  "hello",
  "help",
  "hi",
  "how",
  "i",
  "in",
  "information",
  "is",
  "it",
  "item",
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
  "search",
  "show",
  "some",
  "source",
  "support",
  "tell",
  "thanks",
  "thank",
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
  "with",
  "you",
  "your",
]);

type WordPressRenderedText = {
  rendered?: string;
};

type WordPressTerm = {
  name?: string;
  taxonomy?: string;
};

type WordPressMedia = {
  source_url?: string;
  alt_text?: string;
  media_details?: {
    sizes?: Record<string, { source_url?: string }>;
  };
};

export type AssetMatrixWordPressProduct = {
  id?: number;
  slug?: string;
  link?: string;
  modified_gmt?: string;
  title?: WordPressRenderedText;
  content?: WordPressRenderedText;
  excerpt?: WordPressRenderedText;
  _embedded?: {
    "wp:term"?: WordPressTerm[][];
    "wp:featuredmedia"?: WordPressMedia[];
  };
};

export type AssetMatrixWordPressPage = AssetMatrixWordPressProduct;

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
    "&ndash;": "–",
    "&mdash;": "—",
  };

  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(amp|quot|#039|apos|lt|gt|nbsp|times|ndash|mdash);/g,
      (entity) => entities[entity] ?? entity,
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
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
      url.hostname === "assetmatrixenergy.com" ||
      url.hostname.endsWith(".assetmatrixenergy.com");

    return url.protocol === "https:" && isCatalogHost ? url.toString() : null;
  } catch {
    return null;
  }
}

function extractSearchQueries(prompt: string): {
  displayQuery: string | null;
  queries: string[];
  tokens: string[];
  exactIdentifier: string | null;
} {
  const quoted = prompt.match(/[“"]([^”"]{2,100})[”"]/u)?.[1]?.trim();
  const exactIdentifier = extractExactIdentifiers(prompt)[0] ?? null;
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
    .slice(0, 12);

  const compact = tokens.join(" ").slice(0, 120).trim();
  const queries = [
    ...(exactIdentifier ? identifierVariants(exactIdentifier) : []),
    quoted,
    compact,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim())
    .filter(
      (value, index, values) =>
        values.findIndex(
          (candidate) => candidate.toLowerCase() === value.toLowerCase(),
        ) === index,
    )
    .slice(0, MAX_SEARCH_REQUESTS);

  return {
    displayQuery: exactIdentifier ?? quoted ?? compact ?? null,
    queries,
    tokens,
    exactIdentifier,
  };
}

async function fetchProducts(
  query: string,
): Promise<AssetMatrixWordPressProduct[]> {
  const url = new URL(PRODUCTS_ENDPOINT);
  url.searchParams.set("search", query);
  url.searchParams.set("per_page", "8");
  url.searchParams.set("status", "publish");
  url.searchParams.set("_embed", "1");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "A-Matrix-Support/2.0",
    },
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Catalogue request failed with ${response.status}`);
  }

  const data: unknown = await response.json();
  return Array.isArray(data) ? (data as AssetMatrixWordPressProduct[]) : [];
}

async function fetchPages(
  query: string,
): Promise<AssetMatrixWordPressPage[]> {
  const url = new URL(PAGES_ENDPOINT);
  url.searchParams.set("search", query);
  url.searchParams.set("per_page", "5");
  url.searchParams.set("status", "publish");
  url.searchParams.set("_embed", "1");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "A-Matrix-Support/2.0",
    },
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Catalogue page request failed with ${response.status}`);
  }

  const data: unknown = await response.json();
  return Array.isArray(data) ? (data as AssetMatrixWordPressPage[]) : [];
}

export function normalizeAssetMatrixProduct(
  product: AssetMatrixWordPressProduct,
): CatalogProduct | null {
  const name = decodeText(product.title?.rendered ?? "");
  if (typeof product.id !== "number" || !name) return null;

  const url = safeCatalogUrl(product.link);
  if (!url) return null;

  const terms = (product._embedded?.["wp:term"] ?? [])
    .flat()
    .filter((term) => !term.taxonomy || term.taxonomy === "product-cat");
  const categories = terms
    .map((term) => decodeText(term.name ?? ""))
    .filter(Boolean)
    .slice(0, 3);
  const media = product._embedded?.["wp:featuredmedia"]?.[0];
  const imageCandidate =
    media?.media_details?.sizes?.medium?.source_url ??
    media?.media_details?.sizes?.thumbnail?.source_url ??
    media?.source_url;
  const imageUrl = safeCatalogUrl(imageCandidate);
  const summary = decodeText(
    product.excerpt?.rendered ?? product.content?.rendered ?? "",
  ).slice(0, 320);

  return {
    id: product.id,
    name,
    url,
    sku: null,
    summary,
    listedPrice: "Quotation required",
    availability: "Availability requires confirmation",
    image:
      imageUrl && media
        ? {
            url: imageUrl,
            alt: decodeText(media.alt_text ?? "") || name,
          }
        : null,
    categories,
  };
}

type PageHeading = {
  level: number;
  name: string;
  anchor: string | null;
  start: number;
  bodyStart: number;
};

function sectionScore(
  name: string,
  body: string,
  query: string,
  tokens: string[],
): number {
  const normalizedName = name.toLowerCase();
  const normalizedBody = body.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  let score = 0;

  if (normalizedName === normalizedQuery) score += 200;
  if (normalizedName.includes(normalizedQuery)) score += 120;
  if (normalizedBody.includes(normalizedQuery)) score += 70;
  for (const token of tokens) {
    if (normalizedName.includes(token)) score += 18;
    if (normalizedBody.includes(token)) score += 3;
  }
  return score;
}

function headingAnchor(attributes: string): string | null {
  const match = attributes.match(/\bid=["']([^"']+)["']/i)?.[1];
  return match ? encodeURIComponent(match) : null;
}

export function extractProductsFromWordPressPage(
  page: AssetMatrixWordPressPage,
  query: string,
  tokens: string[],
): CatalogProduct[] {
  if (typeof page.id !== "number") return [];
  const pageUrl = safeCatalogUrl(page.link);
  const html = page.content?.rendered ?? "";
  if (!pageUrl || !html) return [];

  const headings: PageHeading[] = [];
  const headingPattern = /<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gi;
  for (const match of html.matchAll(headingPattern)) {
    const name = decodeText(match[3] ?? "");
    if (!name || match.index === undefined) continue;
    headings.push({
      level: Number(match[1]),
      name,
      anchor: headingAnchor(match[2] ?? ""),
      start: match.index,
      bodyStart: match.index + match[0].length,
    });
  }

  const pageTitle = decodeText(page.title?.rendered ?? "");
  const candidates = headings.map((heading, index) => {
    const nextSibling = headings
      .slice(index + 1)
      .find((candidate) => candidate.level <= heading.level);
    const end = nextSibling?.start ?? html.length;
    const bodyHtml = html.slice(heading.bodyStart, end);
    const body = decodeText(bodyHtml);
    return {
      heading,
      body,
      bodyHtml,
      score: sectionScore(heading.name, body, query, tokens),
      index,
    };
  });

  return candidates
    .filter((candidate) => candidate.score >= 18)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((candidate) => {
      const imageCandidate = candidate.bodyHtml.match(
        /<img[^>]+src=["']([^"']+)["']/i,
      )?.[1];
      const imageUrl = safeCatalogUrl(imageCandidate);
      const url = candidate.heading.anchor
        ? `${pageUrl}#${candidate.heading.anchor}`
        : pageUrl;

      return {
        id: page.id! * 100 + candidate.index,
        name: candidate.heading.name,
        url,
        sku: null,
        summary: candidate.body.slice(0, 900),
        listedPrice: "Quotation required",
        availability: "Availability requires confirmation",
        image: imageUrl
          ? { url: imageUrl, alt: candidate.heading.name }
          : null,
        categories:
          pageTitle && pageTitle !== candidate.heading.name
            ? [pageTitle]
            : [],
      };
    });
}

function scoreProduct(
  product: CatalogProduct,
  tokens: string[],
  displayQuery: string | null,
  exactIdentifier: string | null,
): number {
  const name = product.name.toLowerCase();
  const categories = product.categories.join(" ").toLowerCase();
  const summary = product.summary.toLowerCase();
  let score = 0;

  if (displayQuery && name.includes(displayQuery.toLowerCase())) score += 80;
  if (
    exactIdentifier &&
    identifiersEqual(product.name, exactIdentifier)
  ) {
    score += 1000;
  }

  for (const token of tokens) {
    if (name.includes(token)) score += 16;
    if (categories.includes(token)) score += 6;
    if (summary.includes(token)) score += 2;
  }

  if (product.summary) score += 2;
  if (product.categories.length) score += 2;
  return score;
}

export async function searchPublishedCatalog(
  prompt: string,
): Promise<CatalogSearchResult> {
  const { displayQuery, queries, tokens, exactIdentifier } =
    extractSearchQueries(prompt);

  if (!displayQuery || queries.length === 0) {
    return {
      query: null,
      products: [],
      retrievedAt: null,
      exactIdentifier: null,
    };
  }

  const verifiedProducts = searchVerifiedCatalogueSnapshot(prompt);
  if (verifiedProducts.length > 0) {
    return {
      query: displayQuery,
      products: verifiedProducts.slice(0, MAX_RESULTS),
      retrievedAt: new Date().toISOString(),
      exactIdentifier,
    };
  }

  const productsById = new Map<number, CatalogProduct>();
  let successfulRequest = false;

  for (const query of queries) {
    try {
      const pages = await fetchPages(query);
      successfulRequest = true;
      for (const page of pages) {
        for (const product of extractProductsFromWordPressPage(
          page,
          query,
          tokens,
        )) {
          productsById.set(product.id, product);
        }
      }
    } catch {
      // The custom-product collection can still succeed when page search fails.
    }

    if (productsById.size >= MAX_RESULTS) break;

    try {
      const rawProducts = await fetchProducts(query);
      successfulRequest = true;
      for (const rawProduct of rawProducts) {
        const product = normalizeAssetMatrixProduct(rawProduct);
        if (product) productsById.set(product.id, product);
      }
    } catch {
      // A second normalized query may still succeed if this one is rejected.
    }

    if (productsById.size >= MAX_RESULTS) break;
  }

  const products = [...productsById.values()]
    .sort(
      (left, right) =>
        scoreProduct(right, tokens, displayQuery, exactIdentifier) -
        scoreProduct(left, tokens, displayQuery, exactIdentifier),
    )
    .slice(0, MAX_RESULTS);

  return {
    query: displayQuery,
    products,
    retrievedAt: successfulRequest ? new Date().toISOString() : null,
    exactIdentifier,
  };
}
