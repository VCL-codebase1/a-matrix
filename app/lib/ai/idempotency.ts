import { createHash } from "node:crypto";

import { normalizeCacheQuery } from "./cache";

type IdempotencyEntry<T> = {
  promise: Promise<T>;
  expiresAt: number;
};

type GlobalIdempotency = typeof globalThis & {
  __aMatrixIdempotency?: Map<string, IdempotencyEntry<unknown>>;
};

const globalIdempotency = globalThis as GlobalIdempotency;
const entries =
  globalIdempotency.__aMatrixIdempotency ??
  (globalIdempotency.__aMatrixIdempotency = new Map());

export function createIdempotencyKey(input: {
  sessionId: string;
  message: string;
  stateVersion: number;
  now?: number;
}): string {
  const window = Math.floor((input.now ?? Date.now()) / (5 * 60 * 1000));
  return createHash("sha256")
    .update(
      [
        input.sessionId,
        normalizeCacheQuery(input.message),
        input.stateVersion,
        window,
      ].join("|"),
    )
    .digest("hex");
}

export async function runIdempotent<T>(
  key: string,
  factory: () => Promise<T>,
  ttlMs = 5 * 60 * 1000,
): Promise<{ value: T; duplicate: boolean }> {
  const existing = entries.get(key) as IdempotencyEntry<T> | undefined;
  if (existing && existing.expiresAt > Date.now()) {
    return { value: await existing.promise, duplicate: true };
  }

  const promise = factory();
  entries.set(key, { promise, expiresAt: Date.now() + ttlMs });

  try {
    return { value: await promise, duplicate: false };
  } catch (error) {
    entries.delete(key);
    throw error;
  }
}

export function clearIdempotencyEntries(): void {
  entries.clear();
}
