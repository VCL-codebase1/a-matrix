import * as cheerio from "cheerio";

import {
  normalizeAssetPageProducts,
  normalizeAssetProduct,
  normalizeHtmlProduct,
  normalizeWooProduct,
} from "./normalize.mjs";

const USER_AGENT =
  "A-Matrix-Catalogue-Sync/1.0 (+https://assetmatrixenergy.com/)";
const REQUEST_TIMEOUT_MS = Number(
  process.env.CATALOG_REQUEST_TIMEOUT_MS ?? 25_000,
);
const REQUEST_DELAY_MS = Number(process.env.CATALOG_REQUEST_DELAY_MS ?? 200);
const PAGE_CONCURRENCY = Math.min(
  5,
  Math.max(1, Number(process.env.CATALOG_PAGE_CONCURRENCY ?? 3)),
);
const START_PAGE = Math.max(
  1,
  Number(process.env.CATALOG_START_PAGE ?? 1),
);
const END_PAGE = Math.max(
  START_PAGE,
  Number(process.env.CATALOG_END_PAGE ?? Number.MAX_SAFE_INTEGER),
);

export class CatalogueAccessError extends Error {
  constructor(site, message, options) {
    super(message, options);
    this.name = "CatalogueAccessError";
    this.site = site;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isChallengePage(text) {
  const prefix = text.slice(0, 4000).toLowerCase();
  return (
    prefix.includes("checking your browser before accessing") ||
    prefix.includes("verifying that you are not a robot") ||
    prefix.includes("/hcdn-cgi/jschallenge")
  );
}

async function request(url, { accept = "application/json" } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: accept,
          "User-Agent": USER_AGENT,
        },
        redirect: "follow",
        signal: controller.signal,
      });
      const text = await response.text();
      if (isChallengePage(text)) {
        throw new CatalogueAccessError(
          new URL(url).hostname,
          "The source returned a browser-verification challenge.",
        );
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${url}`);
      }
      return { response, text };
    } catch (error) {
      lastError = error;
      if (error instanceof CatalogueAccessError) throw error;
      if (attempt < 2) await delay(500 * 2 ** attempt);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new CatalogueAccessError(
    new URL(url).hostname,
    `Could not reach ${url}`,
    { cause: lastError },
  );
}

async function requestJson(url) {
  const { response, text } = await request(url);
  try {
    return { response, data: JSON.parse(text) };
  } catch (error) {
    throw new CatalogueAccessError(
      new URL(url).hostname,
      `The source did not return JSON for ${url}`,
      { cause: error },
    );
  }
}

async function* wordpressCollection({
  endpoint,
  normalize,
  includeEmbedded = true,
  includeStatus = true,
}) {
  const fetchPage = async (page) => {
    const url = new URL(endpoint);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    if (includeStatus) url.searchParams.set("status", "publish");
    if (includeEmbedded) url.searchParams.set("_embed", "1");
    const { response, data } = await requestJson(url);
    if (!Array.isArray(data)) {
      throw new Error(`Unexpected WordPress response from ${url}`);
    }
    return { response, data };
  };
  const normalizePage = (data) =>
    data.flatMap((entry) => {
      const normalized = normalize(entry);
      if (!normalized) return [];
      return Array.isArray(normalized) ? normalized : [normalized];
    });

  const firstPage = await fetchPage(START_PAGE);
  const sourceTotalPages = Number(
    firstPage.response.headers.get("x-wp-totalpages") ?? 1,
  );
  const totalPages = Math.min(sourceTotalPages, END_PAGE);
  yield normalizePage(firstPage.data);

  for (
    let pageStart = START_PAGE + 1;
    pageStart <= totalPages;
    pageStart += PAGE_CONCURRENCY
  ) {
    const pageNumbers = Array.from(
      {
        length: Math.min(
          PAGE_CONCURRENCY,
          totalPages - pageStart + 1,
        ),
      },
      (_, index) => pageStart + index,
    );
    const pages = await Promise.all(pageNumbers.map(fetchPage));
    yield pages.flatMap((page) => normalizePage(page.data));
    if (pageStart + PAGE_CONCURRENCY <= totalPages) {
      await delay(REQUEST_DELAY_MS);
    }
  }
}

async function discoverSitemapUrls(siteOrigin, matcher) {
  const root = `${siteOrigin}/wp-sitemap.xml`;
  const visited = new Set();
  const results = new Set();

  async function visit(url, depth) {
    if (visited.has(url) || depth > 3) return;
    visited.add(url);
    const { text } = await request(url, {
      accept: "application/xml,text/xml,text/html",
    });
    const $ = cheerio.load(text, { xmlMode: true });
    const locations = $("loc")
      .map((_, element) => $(element).text().trim())
      .get()
      .filter(Boolean);
    for (const location of locations) {
      if (location.endsWith(".xml")) {
        await visit(location, depth + 1);
      } else if (matcher(location)) {
        results.add(location);
      }
    }
  }

  await visit(root, 0);
  return [...results];
}

async function* htmlProductFallback({
  siteOrigin,
  sourceSite,
  matcher,
}) {
  const urls = await discoverSitemapUrls(siteOrigin, matcher);
  for (let index = 0; index < urls.length; index += 3) {
    const batchUrls = urls.slice(index, index + 3);
    const products = (
      await Promise.all(
        batchUrls.map(async (sourceUrl) => {
          try {
            const { text } = await request(sourceUrl, {
              accept: "text/html",
            });
            return normalizeHtmlProduct({
              html: text,
              sourceSite,
              sourceExternalId: new URL(sourceUrl).pathname,
              sourceUrl,
            });
          } catch (error) {
            console.error(`Failed to parse ${sourceUrl}: ${error.message}`);
            return null;
          }
        }),
      )
    ).filter(Boolean);
    yield products;
    if (index + 3 < urls.length) await delay(REQUEST_DELAY_MS);
  }
}

export async function* crawlAMatrix() {
  try {
    yield* wordpressCollection({
      endpoint: "https://a-matrix.ng/wp-json/wc/store/v1/products",
      includeEmbedded: false,
      includeStatus: false,
      normalize: normalizeWooProduct,
    });
    return;
  } catch (error) {
    console.warn(
      `A-Matrix Store API unavailable; trying product sitemap: ${error.message}`,
    );
  }

  yield* htmlProductFallback({
    siteOrigin: "https://a-matrix.ng",
    sourceSite: "a-matrix.ng",
    matcher: (url) => new URL(url).pathname.startsWith("/product/"),
  });
}

export async function* crawlAssetMatrixEnergy() {
  let customProductsSucceeded = false;
  try {
    yield* wordpressCollection({
      endpoint:
        "https://assetmatrixenergy.com/wp-json/wp/v2/amel-products",
      normalize: normalizeAssetProduct,
    });
    customProductsSucceeded = true;
  } catch (error) {
    console.warn(`Asset Matrix product API unavailable: ${error.message}`);
  }

  let pagesSucceeded = false;
  try {
    yield* wordpressCollection({
      endpoint: "https://assetmatrixenergy.com/wp-json/wp/v2/pages",
      normalize: normalizeAssetPageProducts,
    });
    pagesSucceeded = true;
  } catch (error) {
    console.warn(`Asset Matrix page API unavailable: ${error.message}`);
  }

  if (customProductsSucceeded || pagesSucceeded) return;

  yield* htmlProductFallback({
    siteOrigin: "https://assetmatrixenergy.com",
    sourceSite: "assetmatrixenergy.com",
    matcher: (url) => {
      const path = new URL(url).pathname;
      return (
        path !== "/" &&
        !path.startsWith("/category/") &&
        !path.startsWith("/author/") &&
        !path.startsWith("/tag/")
      );
    },
  });
}
