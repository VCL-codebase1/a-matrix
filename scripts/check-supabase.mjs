import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL?.trim();
const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();

if (!url || !secretKey) {
  console.error("Supabase is not configured.");
  process.exitCode = 1;
} else {
  const supabase = createClient(new URL(url).origin, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const checks = await Promise.all([
    supabase
      .from("chat_sessions")
      .select("session_id,conversation_state,last_intent")
      .limit(1),
    supabase
      .from("chat_messages")
      .select("session_id,request_id,role")
      .limit(1),
    supabase
      .from("knowledge_documents")
      .select("id,source_url,content_hash")
      .limit(1),
    supabase
      .from("knowledge_chunks")
      .select("id,document_id,embedding_model")
      .limit(1),
    supabase
      .from("catalog_products")
      .select("id,source_site,source_external_id,name")
      .limit(1),
    supabase
      .from("catalog_product_specs")
      .select("id,product_id,name,value")
      .limit(1),
    supabase.rpc("match_knowledge_chunks", {
      query_embedding: Array.from({ length: 768 }, () => 0),
      match_threshold: 2,
      match_count: 1,
    }),
    supabase.rpc("search_catalog_products", {
      search_query: "bushing tap adapter",
      result_limit: 1,
    }),
  ]);
  const checkNames = [
    "chat_sessions",
    "chat_messages",
    "knowledge_documents",
    "knowledge_chunks",
    "catalog_products",
    "catalog_product_specs",
    "match_knowledge_chunks",
    "search_catalog_products",
  ];
  const failures = checks
    .map((result, index) => ({
      name: checkNames[index],
      error: result.error,
    }))
    .filter((result) => result.error);
  const error = failures[0]?.error;

  if (!error) {
    console.log(
      "Supabase connection, editable catalogue, conversation tables, and pgvector retrieval are ready.",
    );

    const [sessions, messages, documents, chunks, products, specs] =
      await Promise.all([
      supabase
        .from("chat_sessions")
        .select("session_id", { head: true, count: "exact" }),
      supabase
        .from("chat_messages")
        .select("id", { head: true, count: "exact" }),
      supabase
        .from("knowledge_documents")
        .select("id", { head: true, count: "exact" }),
      supabase
        .from("knowledge_chunks")
        .select("id", { head: true, count: "exact" }),
      supabase
        .from("catalog_products")
        .select("id", { head: true, count: "exact" }),
      supabase
        .from("catalog_product_specs")
        .select("id", { head: true, count: "exact" }),
    ]);
    console.log(
      `Stored rows: ${sessions.count ?? 0} sessions, ${
        messages.count ?? 0
      } messages, ${documents.count ?? 0} documents, ${
        chunks.count ?? 0
      } vector chunks, ${products.count ?? 0} catalogue products, and ${
        specs.count ?? 0
      } editable specifications.`,
    );

    const { data: seededChunk, error: chunkError } = await supabase
      .from("knowledge_chunks")
      .select("embedding")
      .not("embedding", "is", null)
      .limit(1)
      .maybeSingle();
    if (chunkError) throw chunkError;
    if (seededChunk?.embedding) {
      const { data: vectorMatches, error: vectorError } = await supabase.rpc(
        "match_knowledge_chunks",
        {
          query_embedding: seededChunk.embedding,
          match_threshold: 0.99,
          match_count: 1,
        },
      );
      if (vectorError) throw vectorError;
      if (!vectorMatches?.length) {
        throw new Error("The seeded vector did not match itself.");
      }
      console.log("Seeded pgvector similarity search is operational.");
    }

    const sessionId = process.env.SUPABASE_CHECK_SESSION_ID?.trim();
    if (sessionId) {
      const { count: persistedMessages, error: persistenceError } =
        await supabase
          .from("chat_messages")
          .select("id", { head: true, count: "exact" })
          .eq("session_id", sessionId);
      if (persistenceError) throw persistenceError;
      if (persistedMessages !== 2) {
        throw new Error(
          `Expected two persisted messages for the test session, found ${
            persistedMessages ?? 0
          }.`,
        );
      }
      console.log("The requested chat exchange is durably persisted.");
    }
  } else if (
    error.code === "PGRST205" ||
    error.code === "PGRST202" ||
    error.code === "42P01" ||
    error.code === "42883"
  ) {
    console.error(
      "Supabase is reachable, but the A-Matrix migration has not been applied.",
    );
    console.error(
      `Unavailable schema objects: ${failures
        .map((failure) => failure.name)
        .join(", ")}.`,
    );
    process.exitCode = 2;
  } else {
    console.error(`Supabase check failed (${error.code || "unknown"}).`);
    process.exitCode = 1;
  }
}
