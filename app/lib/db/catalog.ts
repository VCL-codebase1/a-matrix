import "server-only";

import { createHash } from "node:crypto";

import type { CatalogProduct } from "../catalog";
import { getSupabaseAdmin } from "./supabase";

type CatalogRpcRow = {
  id?: string;
  source_url?: string;
  name?: string;
  sku?: string | null;
  model?: string | null;
  summary?: string;
  description?: string;
  categories?: string[];
  image_url?: string | null;
  image_alt?: string | null;
  listed_price?: string;
  availability?: string;
  specifications?: Array<{
    section?: string;
    name?: string;
    value?: string;
    unit?: string | null;
  }>;
};

function numericProductId(id: string): number {
  return Number.parseInt(createHash("sha1").update(id).digest("hex").slice(0, 7), 16);
}

function catalogueSummary(row: CatalogRpcRow): string {
  const specifications = (row.specifications ?? [])
    .slice(0, 12)
    .map((specification) =>
      [
        specification.name,
        specification.value,
        specification.unit,
      ]
        .filter(Boolean)
        .join(": "),
    )
    .filter(Boolean)
    .join("; ");
  return [row.summary, row.model ? `Model: ${row.model}.` : "", specifications]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1_500);
}

export async function searchDatabaseCatalog(
  query: string,
): Promise<CatalogProduct[]> {
  const supabase = getSupabaseAdmin();
  const normalizedQuery = query.trim().slice(0, 240);
  if (!supabase || !normalizedQuery) return [];

  const { data, error } = await supabase.rpc("search_catalog_products", {
    search_query: normalizedQuery,
    result_limit: 4,
  });
  if (error) {
    if (
      error.code !== "PGRST202" &&
      !error.message.includes("search_catalog_products")
    ) {
      console.error("A-Matrix database catalogue search failed", {
        detail: error.message,
      });
    }
    return [];
  }

  return ((data ?? []) as CatalogRpcRow[])
    .filter(
      (row) =>
        typeof row.id === "string" &&
        typeof row.source_url === "string" &&
        typeof row.name === "string",
    )
    .map((row) => ({
      id: numericProductId(row.id!),
      name: row.name!.slice(0, 240),
      url: row.source_url!,
      sku: row.sku ?? row.model ?? null,
      summary: catalogueSummary(row),
      listedPrice: row.listed_price || "Quotation required",
      availability:
        row.availability || "Availability requires confirmation",
      image: row.image_url
        ? {
            url: row.image_url,
            alt: row.image_alt || row.name!,
          }
        : null,
      categories: Array.isArray(row.categories)
        ? row.categories.slice(0, 5)
        : [],
    }));
}
