import { createHash } from "node:crypto";

import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

import {
  productEmbeddingText,
} from "./catalog/normalize.mjs";
import {
  crawlAMatrix,
  crawlAssetMatrixEnergy,
} from "./catalog/sources.mjs";

const EMBEDDING_DIMENSIONS = 768;
const EMBEDDING_BATCH_SIZE = Number(
  process.env.CATALOG_EMBEDDING_BATCH_SIZE ?? 100,
);

function parseArguments() {
  const values = new Map(
    process.argv.slice(2).map((argument) => {
      const [key, value = "true"] = argument.replace(/^--/, "").split("=", 2);
      return [key, value];
    }),
  );
  const source = values.get("source") ?? "all";
  if (!["all", "a-matrix.ng", "assetmatrixenergy.com"].includes(source)) {
    throw new Error(
      "--source must be all, a-matrix.ng, or assetmatrixenergy.com",
    );
  }
  const limit = values.has("limit")
    ? Math.max(1, Number(values.get("limit")))
    : Number.POSITIVE_INFINITY;
  return {
    source,
    limit,
    embed: !values.has("skip-embeddings"),
    embeddingsOnly: values.has("embeddings-only"),
  };
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function chunksOf(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function databaseProduct(product, now) {
  return {
    source_site: product.sourceSite,
    source_external_id: product.sourceExternalId,
    source_url: product.sourceUrl,
    source_modified_at: product.sourceModifiedAt,
    source_hash: product.sourceHash,
    source_snapshot: product.rawSource,
    slug: product.slug,
    name: product.name,
    manufacturer: product.manufacturer,
    model: product.model,
    sku: product.sku,
    summary: product.summary,
    description: product.description,
    technical_details: product.technicalDetails,
    features: product.features,
    applications: product.applications,
    categories: product.categories,
    image_url: product.imageUrl,
    image_alt: product.imageAlt,
    gallery: product.gallery,
    listed_price: product.listedPrice,
    availability: product.availability,
    status: "published",
    last_seen_at: now,
    last_synced_at: now,
    updated_at: now,
  };
}

function splitKnowledgeText(text) {
  const maximum = 8_000;
  if (text.length <= maximum) return [text];
  const paragraphs = text.split(/\n+/);
  const chunks = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 1 > maximum) {
      chunks.push(current);
      current = "";
    }
    if (paragraph.length > maximum) {
      if (current) chunks.push(current);
      for (let index = 0; index < paragraph.length; index += maximum) {
        chunks.push(paragraph.slice(index, index + maximum));
      }
      current = "";
    } else {
      current = current ? `${current}\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function embedBatch(client, model, inputs) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const response = await client.models.embedContent({
        model,
        contents: inputs,
        config: {
          taskType: "RETRIEVAL_DOCUMENT",
          outputDimensionality: EMBEDDING_DIMENSIONS,
          httpOptions: { timeout: 30_000 },
        },
      });
      const embeddings = response.embeddings ?? [];
      if (
        embeddings.length !== inputs.length ||
        embeddings.some(
          (embedding) =>
            !embedding.values ||
            embedding.values.length !== EMBEDDING_DIMENSIONS,
        )
      ) {
        throw new Error("Gemini returned an unexpected embedding batch.");
      }
      return embeddings.map((embedding) => embedding.values);
    } catch (error) {
      lastError = error;
      if (attempt < 7) {
        const message =
          error instanceof Error ? error.message : JSON.stringify(error);
        const retrySeconds = Number(
          message.match(/retry(?:Delay| in)[^0-9]*([0-9.]+)s/i)?.[1],
        );
        const waitMilliseconds = Number.isFinite(retrySeconds)
          ? Math.min(65_000, Math.max(1_000, retrySeconds * 1_000 + 1_000))
          : 1_000 * 2 ** Math.min(attempt, 5);
        console.warn(
          `Embedding request paused for ${Math.ceil(waitMilliseconds / 1_000)} seconds.`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, waitMilliseconds),
        );
      }
    }
  }
  throw lastError;
}

async function replaceSpecifications(supabase, records) {
  if (records.length === 0) return;
  const productIds = records.map((record) => record.id);
  const { error: deleteError } = await supabase
    .from("catalog_product_specs")
    .delete()
    .in("product_id", productIds)
    .eq("source_managed", true);
  if (deleteError) throw deleteError;

  const now = new Date().toISOString();
  const rows = records.flatMap(({ id, product }) =>
    product.specifications.map((specification) => ({
      product_id: id,
      sync_key: specification.syncKey,
      section: specification.section,
      name: specification.name,
      value: specification.value,
      unit: specification.unit,
      sort_order: specification.sortOrder,
      source_managed: true,
      updated_at: now,
    })),
  );
  for (const batch of chunksOf(rows, 250)) {
    const { error } = await supabase
      .from("catalog_product_specs")
      .upsert(batch, { onConflict: "product_id,sync_key" });
    if (error) throw error;
  }
}

async function indexProducts(supabase, gemini, embeddingModel, records) {
  let embedded = 0;
  for (const recordBatch of chunksOf(records, 100)) {
    const now = new Date().toISOString();
    const chunkRecords = recordBatch.flatMap(({ id, product }) =>
      splitKnowledgeText(productEmbeddingText(product)).map(
        (content, index) => ({
          productId: id,
          product,
          content,
          chunkIndex: index,
        }),
      ),
    );
    const vectors = [];
    for (const embeddingBatch of chunksOf(
      chunkRecords,
      EMBEDDING_BATCH_SIZE,
    )) {
      vectors.push(
        ...(await embedBatch(
          gemini,
          embeddingModel,
          embeddingBatch.map((item) => item.content),
        )),
      );
    }

    const { data: documents, error: documentError } = await supabase
      .from("knowledge_documents")
      .upsert(
        recordBatch.map(({ id, product }) => ({
          product_id: id,
          source_url: product.sourceUrl,
          title: product.name,
          source_type: "catalogue",
          content_hash: createHash("sha256")
            .update(productEmbeddingText(product))
            .digest("hex"),
          metadata: {
            sourceSite: product.sourceSite,
            productId: id,
            model: product.model,
            sku: product.sku,
            categories: product.categories,
          },
          last_crawled_at: now,
          updated_at: now,
        })),
        { onConflict: "source_url" },
      )
      .select("id,product_id");
    if (documentError) throw documentError;
    const documentIdByProductId = new Map(
      (documents ?? []).map((document) => [
        document.product_id,
        document.id,
      ]),
    );
    const documentIds = [...documentIdByProductId.values()];
    if (documentIds.length !== recordBatch.length) {
      throw new Error("Not every knowledge document was returned.");
    }

    const { error: cleanupError } = await supabase
      .from("knowledge_chunks")
      .delete()
      .in("document_id", documentIds);
    if (cleanupError) throw cleanupError;
    const chunkRows = chunkRecords.map((item, index) => ({
      document_id: documentIdByProductId.get(item.productId),
      chunk_index: item.chunkIndex,
      content: item.content,
      token_count: Math.ceil(item.content.length / 4),
      embedding: vectors[index],
      embedding_model: embeddingModel,
      metadata: {
        productId: item.productId,
        productUrl: item.product.sourceUrl,
      },
      updated_at: now,
    }));
    for (const chunkBatch of chunksOf(chunkRows, 100)) {
      const { error: chunkError } = await supabase
        .from("knowledge_chunks")
        .insert(chunkBatch);
      if (chunkError) throw chunkError;
    }
    embedded += recordBatch.length;
    console.log(
      `Embedded ${embedded}/${records.length} changed products in this batch.`,
    );
  }
  return embedded;
}

async function processBatch({
  supabase,
  gemini,
  embeddingModel,
  products,
  embed,
}) {
  const deduplicated = [
    ...new Map(
      products.map((product) => [
        `${product.sourceSite}:${product.sourceExternalId}`,
        product,
      ]),
    ).values(),
  ];
  if (deduplicated.length === 0) {
    return { discovered: 0, upserted: 0, embedded: 0, failed: 0 };
  }

  const sourceSite = deduplicated[0].sourceSite;
  const externalIds = deduplicated.map((product) => product.sourceExternalId);
  const { data: existing, error: existingError } = await supabase
    .from("catalog_products")
    .select("id,source_external_id,source_hash,sync_locked")
    .eq("source_site", sourceSite)
    .in("source_external_id", externalIds);
  if (existingError) throw existingError;
  const existingByExternalId = new Map(
    (existing ?? []).map((row) => [row.source_external_id, row]),
  );

  const now = new Date().toISOString();
  const locked = deduplicated.filter(
    (product) =>
      existingByExternalId.get(product.sourceExternalId)?.sync_locked,
  );
  for (const product of locked) {
    const row = existingByExternalId.get(product.sourceExternalId);
    const { error } = await supabase
      .from("catalog_products")
      .update({
        last_seen_at: now,
        source_snapshot: product.rawSource,
      })
      .eq("id", row.id);
    if (error) throw error;
  }

  const changed = deduplicated.filter((product) => {
    const row = existingByExternalId.get(product.sourceExternalId);
    return !row?.sync_locked && row?.source_hash !== product.sourceHash;
  });
  const idByExternalId = new Map(
    (existing ?? []).map((row) => [row.source_external_id, row.id]),
  );
  if (changed.length > 0) {
    const { data: upsertedRows, error: upsertError } = await supabase
      .from("catalog_products")
      .upsert(changed.map((product) => databaseProduct(product, now)), {
        onConflict: "source_site,source_external_id",
      })
      .select("id,source_external_id");
    if (upsertError) throw upsertError;
    for (const row of upsertedRows ?? []) {
      idByExternalId.set(row.source_external_id, row.id);
    }
  }

  const changedRecords = [];
  let failed = 0;
  for (const product of changed) {
    const id = idByExternalId.get(product.sourceExternalId);
    if (!id) {
      failed += 1;
      continue;
    }
    changedRecords.push({ id, product });
  }
  try {
    await replaceSpecifications(supabase, changedRecords);
  } catch (error) {
    failed += changedRecords.length;
    changedRecords.length = 0;
    console.error(`Specification batch sync failed: ${error.message}`);
  }

  const eligibleRecords = deduplicated.flatMap((product) => {
    const existingRow = existingByExternalId.get(product.sourceExternalId);
    const id = idByExternalId.get(product.sourceExternalId);
    return id && !existingRow?.sync_locked ? [{ id, product }] : [];
  });
  const eligibleIds = eligibleRecords.map((record) => record.id);
  let recordsToEmbed = changedRecords;
  if (embed && eligibleIds.length > 0) {
    const { data: indexedDocuments, error: documentLookupError } =
      await supabase
        .from("knowledge_documents")
        .select("product_id")
        .in("product_id", eligibleIds);
    if (documentLookupError) throw documentLookupError;
    const indexedIds = new Set(
      (indexedDocuments ?? [])
        .map((document) => document.product_id)
        .filter(Boolean),
    );
    const missingRecords = eligibleRecords.filter(
      (record) => !indexedIds.has(record.id),
    );
    recordsToEmbed = [
      ...new Map(
        [...changedRecords, ...missingRecords].map((record) => [
          record.id,
          record,
        ]),
      ).values(),
    ];
  }

  let embedded = 0;
  if (embed && recordsToEmbed.length > 0) {
    try {
      embedded = await indexProducts(
        supabase,
        gemini,
        embeddingModel,
        recordsToEmbed,
      );
    } catch (error) {
      failed += recordsToEmbed.length;
      console.error(`Embedding batch failed: ${error.message}`);
    }
  }
  return {
    discovered: deduplicated.length,
    upserted: changedRecords.length,
    embedded,
    failed,
  };
}

async function processBatchWithFallback(options) {
  try {
    return await processBatch(options);
  } catch (error) {
    if (options.products.length <= 50) throw error;
    const midpoint = Math.ceil(options.products.length / 2);
    console.warn(
      `Splitting a ${options.products.length}-product database batch after: ${error.message}`,
    );
    const left = await processBatchWithFallback({
      ...options,
      products: options.products.slice(0, midpoint),
    });
    const right = await processBatchWithFallback({
      ...options,
      products: options.products.slice(midpoint),
    });
    return Object.fromEntries(
      Object.keys(left).map((key) => [key, left[key] + right[key]]),
    );
  }
}

async function runSource({
  sourceSite,
  crawler,
  supabase,
  gemini,
  embeddingModel,
  embed,
  limit,
}) {
  const { data: run, error: runError } = await supabase
    .from("catalog_sync_runs")
    .insert({ source_site: sourceSite })
    .select("id")
    .single();
  if (runError || !run?.id) throw runError ?? new Error("Sync run failed.");

  const totals = { discovered: 0, upserted: 0, embedded: 0, failed: 0 };
  let status = "completed";
  let detail = null;
  try {
    for await (const batch of crawler()) {
      const remaining = limit - totals.discovered;
      if (remaining <= 0) break;
      const result = await processBatchWithFallback({
        supabase,
        gemini,
        embeddingModel,
        products: batch.slice(0, remaining),
        embed,
      });
      for (const key of Object.keys(totals)) totals[key] += result[key];
      console.log(
        `${sourceSite}: ${totals.discovered} discovered, ${totals.upserted} updated, ${totals.embedded} embedded, ${totals.failed} failed.`,
      );
      if (totals.discovered >= limit) break;
    }
    if (totals.discovered === 0) {
      status = "failed";
      detail = "No products could be retrieved from the source.";
    } else if (totals.failed > 0) {
      status = "partial";
    }
  } catch (error) {
    status = totals.discovered > 0 ? "partial" : "failed";
    detail = error.message;
    console.error(`${sourceSite} sync stopped: ${detail}`);
  }

  await supabase
    .from("catalog_sync_runs")
    .update({
      status,
      discovered_count: totals.discovered,
      upserted_count: totals.upserted,
      embedded_count: totals.embedded,
      failed_count: totals.failed,
      details: detail ? { error: detail } : {},
      completed_at: new Date().toISOString(),
    })
    .eq("id", run.id);
  return { sourceSite, status, ...totals, detail };
}

async function collectIndexedProductIds(supabase) {
  const ids = new Set();
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await supabase
      .from("knowledge_documents")
      .select("product_id")
      .not("product_id", "is", null)
      .range(from, from + 999);
    if (error) throw error;
    for (const row of data ?? []) ids.add(row.product_id);
    if ((data ?? []).length < 1_000) break;
  }
  return ids;
}

async function runEmbeddingBackfill({
  supabase,
  gemini,
  embeddingModel,
  source,
  limit,
}) {
  const indexedIds = await collectIndexedProductIds(supabase);
  let scanned = 0;
  let embedded = 0;

  for (let from = 0; embedded < limit; from += 100) {
    let query = supabase
      .from("catalog_products")
      .select(
        "id,source_site,source_external_id,source_url,name,manufacturer,model,sku,summary,description,technical_details,features,applications,categories,image_url,image_alt,gallery,listed_price,availability",
      )
      .eq("status", "published")
      .eq("sync_locked", false)
      .order("created_at", { ascending: true })
      .range(from, from + 99);
    if (source !== "all") query = query.eq("source_site", source);
    const { data: rows, error } = await query;
    if (error) throw error;
    if (!rows?.length) break;
    scanned += rows.length;

    const missingRows = rows.filter((row) => !indexedIds.has(row.id));
    if (missingRows.length === 0) continue;
    const selectedRows = missingRows.slice(0, limit - embedded);
    const ids = selectedRows.map((row) => row.id);
    const { data: specifications, error: specificationError } =
      await supabase
        .from("catalog_product_specs")
        .select(
          "product_id,sync_key,section,name,value,unit,sort_order",
        )
        .in("product_id", ids)
        .order("sort_order", { ascending: true });
    if (specificationError) throw specificationError;
    const specificationsByProductId = new Map();
    for (const specification of specifications ?? []) {
      const list =
        specificationsByProductId.get(specification.product_id) ?? [];
      list.push({
        syncKey: specification.sync_key,
        section: specification.section,
        name: specification.name,
        value: specification.value,
        unit: specification.unit,
        sortOrder: specification.sort_order,
      });
      specificationsByProductId.set(specification.product_id, list);
    }
    const records = selectedRows.map((row) => ({
      id: row.id,
      product: {
        sourceSite: row.source_site,
        sourceExternalId: row.source_external_id,
        sourceUrl: row.source_url,
        name: row.name,
        manufacturer: row.manufacturer,
        model: row.model,
        sku: row.sku,
        summary: row.summary,
        description: row.description,
        technicalDetails: row.technical_details,
        specifications: specificationsByProductId.get(row.id) ?? [],
        features: row.features ?? [],
        applications: row.applications ?? [],
        categories: row.categories ?? [],
        imageUrl: row.image_url,
        imageAlt: row.image_alt,
        gallery: row.gallery ?? [],
        listedPrice: row.listed_price,
        availability: row.availability,
      },
    }));
    try {
      const count = await indexProducts(
        supabase,
        gemini,
        embeddingModel,
        records,
      );
      embedded += count;
      for (const record of records) indexedIds.add(record.id);
      console.log(
        `Embedding backlog: ${embedded} added this run; ${scanned} catalogue products scanned.`,
      );
    } catch (error) {
      console.error(`Embedding backfill paused: ${error.message}`);
      return { status: "partial", scanned, embedded, detail: error.message };
    }
  }
  return { status: "completed", scanned, embedded, detail: null };
}

const args = parseArguments();
const supabase = createClient(
  requiredEnvironment("SUPABASE_URL"),
  requiredEnvironment("SUPABASE_SECRET_KEY"),
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const signal = AbortSignal.timeout(30_000);
        return fetch(input, { ...init, signal });
      },
    },
  },
);
const embeddingModel =
  process.env.GEMINI_EMBEDDING_MODEL?.trim() || "gemini-embedding-001";
const gemini = args.embed || args.embeddingsOnly
  ? new GoogleGenAI({ apiKey: requiredEnvironment("GEMINI_API_KEY") })
  : null;
if (args.embeddingsOnly) {
  const result = await runEmbeddingBackfill({
    supabase,
    gemini,
    embeddingModel,
    source: args.source,
    limit: args.limit,
  });
  console.log(JSON.stringify({ embeddingBackfill: result }, null, 2));
  if (result.status !== "completed") process.exitCode = 2;
  process.exit();
}
const requestedSources = [
  ...(args.source === "all" || args.source === "a-matrix.ng"
    ? [
        {
          sourceSite: "a-matrix.ng",
          crawler: crawlAMatrix,
        },
      ]
    : []),
  ...(args.source === "all" || args.source === "assetmatrixenergy.com"
    ? [
        {
          sourceSite: "assetmatrixenergy.com",
          crawler: crawlAssetMatrixEnergy,
        },
      ]
    : []),
];

const results = [];
for (const source of requestedSources) {
  results.push(
    await runSource({
      ...source,
      supabase,
      gemini,
      embeddingModel,
      embed: args.embed,
      limit: args.limit,
    }),
  );
}
console.log(JSON.stringify({ results }, null, 2));
if (results.some((result) => result.status === "failed")) {
  process.exitCode = 1;
}
