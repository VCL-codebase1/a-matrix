import "server-only";

export type SupabaseConfig = {
  url: string;
  secretKey: string;
  requestTimeoutMs: number;
};

function normalizeProjectUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".supabase.co")
    ) {
      return null;
    }
    return `${url.origin}`;
  } catch {
    return null;
  }
}

function timeoutFromEnvironment(): number {
  const value = Number(process.env.SUPABASE_REQUEST_TIMEOUT_MS ?? 2500);
  return Number.isFinite(value)
    ? Math.min(10_000, Math.max(500, Math.floor(value)))
    : 2500;
}

export function loadSupabaseConfig(): SupabaseConfig | null {
  const urlValue = process.env.SUPABASE_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!urlValue || !secretKey) return null;

  const url = normalizeProjectUrl(urlValue);
  if (!url || !secretKey.startsWith("sb_secret_")) {
    console.error("A-Matrix Supabase configuration is invalid.");
    return null;
  }

  return {
    url,
    secretKey,
    requestTimeoutMs: timeoutFromEnvironment(),
  };
}

export function normalizeSupabaseProjectUrl(value: string): string | null {
  return normalizeProjectUrl(value);
}
