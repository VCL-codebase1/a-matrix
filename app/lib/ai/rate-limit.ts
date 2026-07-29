import { AIError } from "./errors";

type GlobalRateLimits = typeof globalThis & {
  __aMatrixRateLimitEvents?: Map<string, number[]>;
  __aMatrixActiveSessions?: Map<string, number>;
};

const globalRateLimits = globalThis as GlobalRateLimits;
const events: Map<string, number[]> =
  globalRateLimits.__aMatrixRateLimitEvents ??
  (globalRateLimits.__aMatrixRateLimitEvents = new Map());
const activeSessions: Map<string, number> =
  globalRateLimits.__aMatrixActiveSessions ??
  (globalRateLimits.__aMatrixActiveSessions = new Map());

function recentEvents(key: string, windowMs: number, now: number): number[] {
  const cutoff = now - windowMs;
  const current = (events.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
  events.set(key, current);
  return current;
}

export function assertWithinRateLimits(input: {
  ip: string;
  sessionId: string;
  hourlyLimit: number;
  dailyLimit: number;
  now?: number;
}): void {
  const now = input.now ?? Date.now();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  const ipHourKey = `ip-hour:${input.ip}`;
  const sessionHourKey = `session-hour:${input.sessionId}`;
  const ipDayKey = `ip-day:${input.ip}`;

  const ipHour = recentEvents(ipHourKey, hour, now);
  const sessionHour = recentEvents(sessionHourKey, hour, now);
  const ipDay = recentEvents(ipDayKey, day, now);

  if (
    ipHour.length >= input.hourlyLimit ||
    sessionHour.length >= input.hourlyLimit ||
    ipDay.length >= input.dailyLimit
  ) {
    throw new AIError("RATE_LIMITED", "Application request limit reached.");
  }

  ipHour.push(now);
  sessionHour.push(now);
  ipDay.push(now);
}

export function acquireSessionConcurrency(
  sessionId: string,
  maximum = 1,
): () => void {
  const active = activeSessions.get(sessionId) ?? 0;
  if (active >= maximum) {
    throw new AIError(
      "DUPLICATE_IN_PROGRESS",
      "A request is already active for this session.",
    );
  }
  activeSessions.set(sessionId, active + 1);
  return () => {
    const remaining = (activeSessions.get(sessionId) ?? 1) - 1;
    if (remaining <= 0) activeSessions.delete(sessionId);
    else activeSessions.set(sessionId, remaining);
  };
}

export function clearRateLimits(): void {
  events.clear();
  activeSessions.clear();
}
