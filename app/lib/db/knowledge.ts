import "server-only";

import { createHash } from "node:crypto";

import { GoogleGenAI } from "@google/genai";

import type { AIConfig } from "../ai/config";
import { sanitizeForModel } from "../ai/sanitization";
import type { CompactKnowledgeChunk } from "../ai/types";
import type { CatalogProduct } from "../catalog";
import { loadSupabaseConfig } from "./config";
import { getSupabaseAdmin } from "./supabase";

const EMBEDDING_DIMENSIONS = 768;

type KnowledgeCapabilityState = {
  available: boolean;
  expiresAt: number;
};

type KnowledgeGlobal = typeof globalThis & {
  __aMatrixKnowledgeCapability?: KnowledgeCapabilityState;
};

const knowledgeGlobal = globalThis as KnowledgeGlobal;

type KnowledgeRpcRow = {
  chunk_id?: string;
  title?: string;
  source_url?: string;
  content?: string;
  similarity?: number;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "Unknown database error";
}

async function knowledgeSchemaAvailable(): Promise<boolean> {
  const cached = knowledgeGlobal.__aMatrixKnowledgeCapability;
  if (cached && cached.expiresAt > Date.now()) return cached.available;

  const supabase = getSupabaseAdmin();
  if (!supabase) return false;
  const { error } = await supabase.rpc("match_knowledge_chunks", {
    query_embedding: Array.from(
      { length: EMBEDDING_DIMENSIONS },
      () => 0,
    ),
    match_threshold: 2,
    match_count: 1,
  });
  const available = !error;
  knowledgeGlobal.__aMatrixKnowledgeCapability = {
    available,
    expiresAt: Date.now() + (available ? 300_000 : 30_000),
  };
  return available;
}

async function generateEmbedding(input: {
  text: string;
  title?: string;
  taskType: "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT";
  config: AIConfig;
}): Promise<number[]> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.min(input.config.requestTimeoutMs, 10_000),
  );

  try {
    const client = new GoogleGenAI({ apiKey: input.config.apiKey });
    const response = await client.models.embedContent({
      model: input.config.embeddingModel,
      contents: input.text,
      config: {
        taskType: input.taskType,
        ...(input.title ? { title: input.title } : {}),
        outputDimensionality: EMBEDDING_DIMENSIONS,
        abortSignal: controller.signal,
        httpOptions: {
          timeout: Math.min(input.config.requestTimeoutMs, 10_000),
        },
      },
    });
    const embedding = response.embeddings?.[0]?.values;
    if (
      !embedding ||
      embedding.length !== EMBEDDING_DIMENSIONS ||
      embedding.some((value) => !Number.isFinite(value))
    ) {
      throw new Error("Embedding response had an unexpected shape.");
    }
    return embedding;
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchKnowledgeBase(
  message: string,
  aiConfig: AIConfig,
): Promise<CompactKnowledgeChunk[]> {
  const supabaseConfig = loadSupabaseConfig();
  const supabase = getSupabaseAdmin();
  if (!supabaseConfig || !supabase) return [];
  if (!(await knowledgeSchemaAvailable())) return [];

  const query = sanitizeForModel(message).text.slice(0, 2000);
  if (!query) return [];

  try {
    const embedding = await generateEmbedding({
      text: query,
      taskType: "RETRIEVAL_QUERY",
      config: aiConfig,
    });
    const { data, error } = await supabase.rpc("match_knowledge_chunks", {
      query_embedding: embedding,
      match_threshold: 0.58,
      match_count: 4,
    });
    if (error) throw error;

    return ((data ?? []) as KnowledgeRpcRow[])
      .filter(
        (row) =>
          typeof row.chunk_id === "string" &&
          typeof row.title === "string" &&
          typeof row.source_url === "string" &&
          typeof row.content === "string" &&
          typeof row.similarity === "number",
      )
      .map((row) => ({
        id: row.chunk_id!,
        title: row.title!.slice(0, 180),
        sourceUrl: row.source_url!,
        content: row.content!.slice(0, 1200),
        similarity: Number(row.similarity!.toFixed(4)),
      }));
  } catch (error) {
    console.error("A-Matrix knowledge search failed", {
      detail: errorMessage(error),
    });
    return [];
  }
}

function productKnowledgeContent(product: CatalogProduct): string {
  return [
    `Product: ${product.name}`,
    product.sku ? `Part number: ${product.sku}` : "",
    product.categories.length
      ? `Categories: ${product.categories.join(", ")}`
      : "",
    product.summary,
    `Commercial status: ${product.listedPrice}; ${product.availability}.`,
    `Source: ${product.url}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function indexCatalogueProducts(
  products: CatalogProduct[],
  aiConfig: AIConfig,
): Promise<{ indexed: number; failed: number }> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  let indexed = 0;
  let failed = 0;

  for (const product of products) {
    try {
      const content = productKnowledgeContent(product);
      const contentHash = createHash("sha256").update(content).digest("hex");
      const embedding = await generateEmbedding({
        text: content,
        title: product.name,
        taskType: "RETRIEVAL_DOCUMENT",
        config: aiConfig,
      });

      const { data: document, error: documentError } = await supabase
        .from("knowledge_documents")
        .upsert(
          {
            source_url: product.url,
            title: product.name,
            source_type: "catalogue",
            content_hash: contentHash,
            metadata: {
              productId: product.id,
              categories: product.categories,
            },
            last_crawled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "source_url" },
        )
        .select("id")
        .single();
      if (documentError || !document?.id) {
        throw documentError ?? new Error("Knowledge document was not returned.");
      }

      const { error: chunkError } = await supabase
        .from("knowledge_chunks")
        .upsert(
          {
            document_id: document.id,
            chunk_index: 0,
            content,
            token_count: Math.ceil(content.length / 4),
            embedding,
            embedding_model: aiConfig.embeddingModel,
            metadata: {
              productId: product.id,
              productUrl: product.url,
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "document_id,chunk_index" },
        );
      if (chunkError) throw chunkError;
      indexed += 1;
    } catch (error) {
      failed += 1;
      console.error("A-Matrix knowledge indexing failed", {
        productId: product.id,
        detail: errorMessage(error),
      });
    }
  }

  return { indexed, failed };
}
