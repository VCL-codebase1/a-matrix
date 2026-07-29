import { createHash } from "node:crypto";

import * as cheerio from "cheerio";

const GENERIC_HEADINGS = new Set([
  "about us",
  "applications",
  "benefits",
  "contact us",
  "description",
  "features",
  "main features",
  "our products",
  "overview",
  "products",
  "specification",
  "specifications",
  "technical data",
  "technical details",
]);

export function cleanText(value = "") {
  if (value === null || value === undefined) return "";
  return cheerio
    .load(`<body>${String(value)}</body>`)("body")
    .text()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(values, maximum = 30) {
  return [...new Set(values.map(cleanText).filter(Boolean))].slice(0, maximum);
}

function safeUrl(value, baseUrl) {
  if (!value) return null;
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function specKey(section, name, value) {
  return createHash("sha1")
    .update(`${section}\u0000${name}\u0000${value}`)
    .digest("hex");
}

function createSpec(section, name, value, sortOrder) {
  const normalizedSection = cleanText(section) || "Specifications";
  const normalizedName = cleanText(name);
  const normalizedValue = cleanText(value);
  if (!normalizedName || !normalizedValue) return null;
  return {
    syncKey: specKey(normalizedSection, normalizedName, normalizedValue),
    section: normalizedSection.slice(0, 160),
    name: normalizedName.slice(0, 240),
    value: normalizedValue.slice(0, 2000),
    unit: null,
    sortOrder,
  };
}

export function extractSpecifications(html = "") {
  const $ = cheerio.load(html);
  const specifications = [];
  let sortOrder = 0;
  let currentSection = "Specifications";

  $("h2, h3, h4, h5, h6, table tr, dl, p, li").each((_, element) => {
    const tag = element.tagName?.toLowerCase();
    if (/^h[2-6]$/.test(tag)) {
      currentSection = cleanText($(element).text()) || currentSection;
      return;
    }

    if (tag === "tr") {
      const cells = $(element)
        .find("th, td")
        .map((__, cell) => cleanText($(cell).text()))
        .get()
        .filter(Boolean);
      if (cells.length >= 2) {
        const spec = createSpec(
          currentSection,
          cells[0],
          cells.slice(1).join(" | "),
          sortOrder++,
        );
        if (spec) specifications.push(spec);
      }
      return;
    }

    if (tag === "dl") {
      $(element)
        .find("dt")
        .each((__, term) => {
          const definition = $(term).next("dd");
          const spec = createSpec(
            currentSection,
            $(term).text(),
            definition.text(),
            sortOrder++,
          );
          if (spec) specifications.push(spec);
        });
      return;
    }

    const text = cleanText($(element).text());
    const match = text.match(/^([^:]{2,100}):\s*(.{1,1500})$/);
    if (match) {
      const spec = createSpec(
        currentSection,
        match[1],
        match[2],
        sortOrder++,
      );
      if (spec) specifications.push(spec);
    }
  });

  const unique = new Map();
  for (const specification of specifications) {
    unique.set(specification.syncKey, specification);
  }
  return [...unique.values()].slice(0, 250);
}

function findField(attributes, names) {
  const normalizedNames = names.map((name) => name.toLowerCase());
  const attribute = attributes.find((candidate) =>
    normalizedNames.some((name) =>
      cleanText(candidate.name).toLowerCase().includes(name),
    ),
  );
  const values = attribute?.terms ?? attribute?.options ?? [];
  return cleanText(Array.isArray(values) ? values.join(", ") : values) || null;
}

function productHash(product) {
  return createHash("sha256")
    .update(JSON.stringify(product))
    .digest("hex");
}

export function finalizeProduct(product) {
  const normalized = {
    sourceSite: product.sourceSite,
    sourceExternalId: String(product.sourceExternalId),
    sourceUrl: product.sourceUrl,
    sourceModifiedAt: product.sourceModifiedAt ?? null,
    slug: product.slug || null,
    name: cleanText(product.name).slice(0, 500),
    manufacturer: cleanText(product.manufacturer) || null,
    model: cleanText(product.model) || null,
    sku: cleanText(product.sku) || null,
    summary: cleanText(product.summary).slice(0, 3000),
    description: cleanText(product.description).slice(0, 20_000),
    technicalDetails: product.technicalDetails ?? {},
    specifications: product.specifications ?? [],
    features: compact(product.features ?? [], 60),
    applications: compact(product.applications ?? [], 60),
    categories: compact(product.categories ?? [], 30),
    imageUrl: product.imageUrl ?? null,
    imageAlt: cleanText(product.imageAlt) || cleanText(product.name),
    gallery: product.gallery ?? [],
    listedPrice: cleanText(product.listedPrice) || "Quotation required",
    availability:
      cleanText(product.availability) ||
      "Availability requires confirmation",
    rawSource: product.rawSource ?? {},
  };
  return {
    ...normalized,
    sourceHash: productHash(normalized),
  };
}

export function normalizeWooProduct(raw) {
  if (
    !raw ||
    (typeof raw.id !== "number" && typeof raw.id !== "string") ||
    !cleanText(raw.name) ||
    !safeUrl(raw.permalink)
  ) {
    return null;
  }
  const attributes = Array.isArray(raw.attributes) ? raw.attributes : [];
  const descriptionHtml = raw.description ?? "";
  const shortDescriptionHtml = raw.short_description ?? "";
  const images = Array.isArray(raw.images) ? raw.images : [];
  const categories = Array.isArray(raw.categories)
    ? raw.categories.map((category) => category?.name)
    : [];
  const prices = raw.prices ?? {};
  const price =
    prices.price && prices.currency_minor_unit !== undefined
      ? `${prices.currency_symbol ?? prices.currency_code ?? ""}${(
          Number(prices.price) /
          10 ** Number(prices.currency_minor_unit)
        ).toLocaleString("en-NG")}`.trim()
      : "Quotation required";

  return finalizeProduct({
    sourceSite: "a-matrix.ng",
    sourceExternalId: raw.id,
    sourceUrl: raw.permalink,
    sourceModifiedAt: raw.date_modified_gmt ?? null,
    slug: raw.slug,
    name: raw.name,
    manufacturer: findField(attributes, ["manufacturer", "brand", "make"]),
    model: findField(attributes, ["model", "model number"]),
    sku: raw.sku || findField(attributes, ["sku", "part number", "code"]),
    summary: shortDescriptionHtml || descriptionHtml,
    description: descriptionHtml,
    technicalDetails: {
      attributes: attributes.map((attribute) => ({
        name: cleanText(attribute.name),
        values: compact(attribute.terms ?? attribute.options ?? []),
      })),
    },
    specifications: [
      ...attributes.flatMap((attribute, index) => {
        const values = attribute.terms ?? attribute.options ?? [];
        const value = cleanText(
          Array.isArray(values) ? values.join(", ") : values,
        );
        const specification = createSpec(
          "Product attributes",
          attribute.name,
          value,
          index,
        );
        return specification ? [specification] : [];
      }),
      ...extractSpecifications(descriptionHtml),
    ],
    features: [],
    applications: [],
    categories,
    imageUrl: safeUrl(images[0]?.src, raw.permalink),
    imageAlt: images[0]?.alt || raw.name,
    gallery: images
      .map((image) => ({
        url: safeUrl(image?.src, raw.permalink),
        alt: cleanText(image?.alt) || cleanText(raw.name),
      }))
      .filter((image) => image.url),
    listedPrice: price,
    availability: raw.is_in_stock
      ? "Listed as in stock"
      : "Availability requires confirmation",
    rawSource: raw,
  });
}

function embeddedTerms(raw) {
  return (raw?._embedded?.["wp:term"] ?? [])
    .flat()
    .map((term) => term?.name)
    .filter(Boolean);
}

function embeddedImage(raw) {
  const media = raw?._embedded?.["wp:featuredmedia"]?.[0];
  return {
    url:
      media?.media_details?.sizes?.large?.source_url ??
      media?.media_details?.sizes?.medium?.source_url ??
      media?.source_url ??
      null,
    alt: media?.alt_text ?? raw?.title?.rendered ?? "",
  };
}

export function normalizeAssetProduct(raw) {
  if (
    !raw ||
    (typeof raw.id !== "number" && typeof raw.id !== "string") ||
    !cleanText(raw?.title?.rendered) ||
    !safeUrl(raw.link)
  ) {
    return null;
  }
  const contentHtml = raw?.content?.rendered ?? "";
  const excerptHtml = raw?.excerpt?.rendered ?? "";
  const image = embeddedImage(raw);
  return finalizeProduct({
    sourceSite: "assetmatrixenergy.com",
    sourceExternalId: `amel-product:${raw.id}`,
    sourceUrl: raw.link,
    sourceModifiedAt: raw.modified_gmt
      ? `${raw.modified_gmt.replace(" ", "T")}Z`
      : null,
    slug: raw.slug,
    name: raw?.title?.rendered,
    manufacturer: null,
    model: null,
    sku: null,
    summary: excerptHtml || contentHtml,
    description: contentHtml,
    technicalDetails: {},
    specifications: extractSpecifications(contentHtml),
    features: [],
    applications: [],
    categories: embeddedTerms(raw),
    imageUrl: safeUrl(image.url, raw.link),
    imageAlt: image.alt,
    gallery: [],
    rawSource: raw,
  });
}

export function normalizeAssetPageProducts(raw) {
  const html = raw?.content?.rendered ?? "";
  const pageUrl = raw?.link;
  if (!html || !pageUrl) return [];
  const headings = [];
  const headingPattern = /<h([2-3])([^>]*)>([\s\S]*?)<\/h\1>/gi;
  for (const match of html.matchAll(headingPattern)) {
    if (match.index === undefined) continue;
    const name = cleanText(match[3]);
    headings.push({
      level: Number(match[1]),
      start: match.index,
      bodyStart: match.index + match[0].length,
      name,
      anchor: match[2].match(/\bid=["']([^"']+)["']/i)?.[1] ?? null,
      eligible:
        name.length >= 4 &&
        !GENERIC_HEADINGS.has(name.toLowerCase()),
    });
  }

  const products = [];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    if (!heading.eligible) continue;
    const nextSibling = headings
      .slice(index + 1)
      .find((candidate) => candidate.level <= heading.level);
    const sectionHtml = html.slice(
      heading.bodyStart,
      nextSibling?.start ?? html.length,
    );
    const sectionText = cleanText(sectionHtml);
    if (sectionText.length < 80) continue;

    const section = cheerio.load(sectionHtml);
    const specifications = extractSpecifications(sectionHtml);
    const imageCandidate =
      section("img").first().attr("data-src") ??
      section("img").first().attr("src") ??
      null;
    const model = specifications.find((specification) =>
      /^(model|model number|type)$/i.test(specification.name),
    )?.value;
    const sku = specifications.find((specification) =>
      /^(part number|part no\.?|sku|product code)$/i.test(
        specification.name,
      ),
    )?.value;
    const sourceUrl = heading.anchor
      ? `${pageUrl}#${encodeURIComponent(heading.anchor)}`
      : `${pageUrl}#product-${index + 1}`;

    products.push(
      finalizeProduct({
        sourceSite: "assetmatrixenergy.com",
        sourceExternalId: `page:${raw.id}:${index}`,
        sourceUrl,
        sourceModifiedAt: raw.modified_gmt
          ? `${raw.modified_gmt.replace(" ", "T")}Z`
          : null,
        slug: `${raw.slug ?? raw.id}-${index}`,
        name: heading.name,
        manufacturer: null,
        model: model ?? null,
        sku: sku ?? null,
        summary: sectionText,
        description: sectionText,
        technicalDetails: {
          parentPage: cleanText(raw?.title?.rendered),
        },
        specifications,
        features: [],
        applications: [],
        categories: compact([
          cleanText(raw?.title?.rendered),
          ...embeddedTerms(raw),
        ]),
        imageUrl: safeUrl(imageCandidate, pageUrl),
        imageAlt: heading.name,
        gallery: [],
        rawSource: {
          pageId: raw.id,
          heading: heading.name,
          sectionHtml,
        },
      }),
    );
  }
  return products;
}

export function normalizeHtmlProduct({
  html,
  sourceSite,
  sourceExternalId,
  sourceUrl,
}) {
  const $ = cheerio.load(html);
  const name = cleanText(
    $("h1.product_title, h1.entry-title, h1").first().text(),
  );
  if (!name) return null;
  const descriptionContainer = $(
    ".woocommerce-product-details__short-description, .woocommerce-Tabs-panel--description, .entry-content, main",
  );
  const descriptionHtml = descriptionContainer.html() ?? "";
  const imageCandidate =
    $(".woocommerce-product-gallery img, article img, main img")
      .first()
      .attr("data-src") ??
    $(".woocommerce-product-gallery img, article img, main img")
      .first()
      .attr("src");
  const sku = cleanText($(".sku").first().text()) || null;
  const categories = $(".posted_in a, .product_meta a")
    .map((_, element) => cleanText($(element).text()))
    .get();
  return finalizeProduct({
    sourceSite,
    sourceExternalId,
    sourceUrl,
    slug: new URL(sourceUrl).pathname.split("/").filter(Boolean).at(-1),
    name,
    manufacturer: null,
    model: null,
    sku,
    summary: descriptionHtml,
    description: descriptionHtml,
    technicalDetails: {},
    specifications: extractSpecifications(descriptionHtml),
    features: [],
    applications: [],
    categories,
    imageUrl: safeUrl(imageCandidate, sourceUrl),
    imageAlt: name,
    gallery: [],
    rawSource: { html },
  });
}

export function productEmbeddingText(product) {
  const specText = product.specifications
    .slice(0, 120)
    .map(
      (specification) =>
        `${specification.section} — ${specification.name}: ${specification.value}${specification.unit ? ` ${specification.unit}` : ""}`,
    )
    .join("\n");
  return [
    `Product: ${product.name}`,
    product.manufacturer ? `Manufacturer: ${product.manufacturer}` : "",
    product.model ? `Model: ${product.model}` : "",
    product.sku ? `SKU or part number: ${product.sku}` : "",
    product.categories.length
      ? `Categories: ${product.categories.join(", ")}`
      : "",
    product.summary,
    product.description,
    specText ? `Technical specifications:\n${specText}` : "",
    product.features.length
      ? `Features: ${product.features.join("; ")}`
      : "",
    product.applications.length
      ? `Applications: ${product.applications.join("; ")}`
      : "",
    `Source: ${product.sourceUrl}`,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 30_000);
}
