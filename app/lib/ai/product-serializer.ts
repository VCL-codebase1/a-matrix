import type { CatalogProduct } from "../catalog";
import type { CompactProductContext } from "./types";

function cleanText(value: string, maximumLength: number): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

export function serializeProductForAI(
  product: CatalogProduct,
  sourceUpdatedAt?: string | null,
): CompactProductContext {
  const summary = cleanText(product.summary, 360);
  const priceStatus =
    product.listedPrice === "Quotation required" ? "quote_required" : "indicative";
  const stockStatus = product.availability
    .toLowerCase()
    .includes("in stock")
    ? "in_stock"
    : "unknown";

  return {
    id: String(product.id),
    name: cleanText(product.name, 160),
    ...(product.sku ? { partNumber: cleanText(product.sku, 80) } : {}),
    ...(product.categories[0]
      ? { category: cleanText(product.categories[0], 80) }
      : {}),
    keySpecifications: summary ? { catalogueSummary: summary } : {},
    priceStatus,
    stockStatus,
    productUrl: product.url,
    ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
  };
}

export function serializeProductsForAI(
  products: CatalogProduct[],
  sourceUpdatedAt?: string | null,
): CompactProductContext[] {
  return products
    .slice(0, 5)
    .map((product) => serializeProductForAI(product, sourceUpdatedAt));
}
