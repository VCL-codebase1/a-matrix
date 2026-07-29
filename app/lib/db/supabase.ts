import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadSupabaseConfig } from "./config";

type SupabaseGlobal = typeof globalThis & {
  __aMatrixSupabaseAdmin?: SupabaseClient;
};

const supabaseGlobal = globalThis as SupabaseGlobal;

export function getSupabaseAdmin(): SupabaseClient | null {
  const config = loadSupabaseConfig();
  if (!config) return null;
  if (supabaseGlobal.__aMatrixSupabaseAdmin) {
    return supabaseGlobal.__aMatrixSupabaseAdmin;
  }

  const client = createClient(config.url, config.secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    db: { schema: "public" },
    global: {
      headers: {
        "X-Client-Info": "a-matrix-support/1.0",
      },
    },
  });
  supabaseGlobal.__aMatrixSupabaseAdmin = client;
  return client;
}
