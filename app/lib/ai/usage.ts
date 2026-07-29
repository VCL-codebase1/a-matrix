import type { AIUsageRecord } from "./types";

type UsageCounters = {
  noModelResponses: number;
  duplicateRequests: number;
  rateLimitEvents: number;
};

type GlobalUsage = typeof globalThis & {
  __aMatrixUsageRecords?: AIUsageRecord[];
  __aMatrixUsageCounters?: UsageCounters;
};

const globalUsage = globalThis as GlobalUsage;
const records =
  globalUsage.__aMatrixUsageRecords ??
  (globalUsage.__aMatrixUsageRecords = []);
const counters =
  globalUsage.__aMatrixUsageCounters ??
  (globalUsage.__aMatrixUsageCounters = {
    noModelResponses: 0,
    duplicateRequests: 0,
    rateLimitEvents: 0,
  });

export function recordAIUsage(record: AIUsageRecord): void {
  records.push(record);
  if (records.length > 5000) records.splice(0, records.length - 5000);

  const warnings: string[] = [];
  if (record.route === "routine_ai" && record.inputTokens > 6000) {
    warnings.push("Routine input exceeded 6,000 tokens.");
  }
  if (record.route === "routine_ai" && record.outputTokens > 500) {
    warnings.push("Routine output exceeded 500 tokens.");
  }
  if (record.route === "complex_ai" && record.inputTokens > 15_000) {
    warnings.push("Complex input exceeded 15,000 tokens.");
  }
  if (record.thoughtTokens > Math.max(1000, record.outputTokens * 3)) {
    warnings.push("Reasoning-token usage is unusually high.");
  }
  if (warnings.length) {
    console.warn("A-Matrix usage alert", {
      requestId: record.requestId,
      warnings,
    });
  }
}

export function recordNoModelResponse(): void {
  counters.noModelResponses += 1;
}

export function recordDuplicateRequest(): void {
  counters.duplicateRequests += 1;
}

export function recordRateLimitEvent(): void {
  counters.rateLimitEvents += 1;
}

export function getUsageSnapshot() {
  const today = new Date().toISOString().slice(0, 10);
  const todaysRecords = records.filter(
    (record) => record.createdAt.toISOString().slice(0, 10) === today,
  );
  const total = todaysRecords.length;
  const totalTokens = todaysRecords.reduce(
    (sum, record) => sum + record.totalTokens,
    0,
  );
  const cacheHits = todaysRecords.filter((record) => record.cacheHit).length;
  const failed = todaysRecords.filter((record) => !record.success).length;
  const routine = todaysRecords.filter(
    (record) => record.route === "routine_ai",
  ).length;
  const complex = total - routine;

  const byIntent = Object.values(
    todaysRecords.reduce<
      Record<string, { intent: string; requests: number; tokens: number }>
    >((aggregate, record) => {
      const current = aggregate[record.intent] ?? {
        intent: record.intent,
        requests: 0,
        tokens: 0,
      };
      current.requests += 1;
      current.tokens += record.totalTokens;
      aggregate[record.intent] = current;
      return aggregate;
    }, {}),
  );

  return {
    date: today,
    requests: total,
    totalTokens,
    averageInputTokens: total
      ? Math.round(
          todaysRecords.reduce((sum, record) => sum + record.inputTokens, 0) /
            total,
        )
      : 0,
    averageOutputTokens: total
      ? Math.round(
          todaysRecords.reduce((sum, record) => sum + record.outputTokens, 0) /
            total,
        )
      : 0,
    routine,
    complex,
    cacheHitRate: total ? cacheHits / total : 0,
    failed,
    ...counters,
    byIntent,
    topSessions: Object.values(
      todaysRecords.reduce<
        Record<string, { sessionId: string; tokens: number; requests: number }>
      >((aggregate, record) => {
        const current = aggregate[record.sessionId] ?? {
          sessionId: record.sessionId,
          tokens: 0,
          requests: 0,
        };
        current.tokens += record.totalTokens;
        current.requests += 1;
        aggregate[record.sessionId] = current;
        return aggregate;
      }, {}),
    )
      .sort((left, right) => right.tokens - left.tokens)
      .slice(0, 10),
  };
}

export function clearUsage(): void {
  records.splice(0);
  counters.noModelResponses = 0;
  counters.duplicateRequests = 0;
  counters.rateLimitEvents = 0;
}
