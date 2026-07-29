import { createHash } from "node:crypto";

import type { AIIntent } from "./types";

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type GlobalCache = typeof globalThis & {
  __aMatrixResponseCache?: Map<string, CacheEntry<unknown>>;
};

const globalCache = globalThis as GlobalCache;
const responseCache =
  globalCache.__aMatrixResponseCache ??
  (globalCache.__aMatrixResponseCache = new Map());

export function normalizeCacheQuery(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._/-]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function createResponseCacheKey(input: {
  query: string;
  intent: AIIntent;
  selectedProductIds: string[];
  catalogueVersion?: string;
  locale?: string;
}): string {
  const payload = [
    normalizeCacheQuery(input.query),
    input.intent,
    [...input.selectedProductIds].sort().join(","),
    input.catalogueVersion ?? "public-live",
    input.locale ?? "en-NG",
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

export function getCachedResponse<T>(key: string): T | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return entry.value as T;
}

export function setCachedResponse<T>(
  key: string,
  value: T,
  ttlSeconds: number,
): void {
  if (ttlSeconds <= 0) return;
  responseCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

export function clearResponseCache(): void {
  responseCache.clear();
}
