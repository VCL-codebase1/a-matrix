import { readdir, readFile } from "node:fs/promises";

import pg from "pg";

const connectionString = process.env.SUPABASE_DB_URL?.trim();
const host = process.env.SUPABASE_DB_HOST?.trim();
const user = process.env.SUPABASE_DB_USER?.trim();
const password = process.env.SUPABASE_DB_PASSWORD;
const port = Number(process.env.SUPABASE_DB_PORT ?? 5432);
if (!connectionString && (!host || !user || !password)) {
  console.error(
    "SUPABASE_DB_URL or separate SUPABASE_DB_HOST, SUPABASE_DB_USER and SUPABASE_DB_PASSWORD values are required.",
  );
  process.exitCode = 1;
} else {
  const migrationsDirectory = new URL(
    "../supabase/migrations/",
    import.meta.url,
  );
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const client = new pg.Client({
    ...(connectionString
      ? { connectionString }
      : {
          host,
          user,
          password,
          port,
          database: "postgres",
        }),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
    query_timeout: 60_000,
  });

  try {
    await client.connect();
    for (const migrationFile of migrationFiles) {
      const migration = await readFile(
        new URL(migrationFile, migrationsDirectory),
        "utf8",
      );
      await client.query(migration);
      console.log(`Applied ${migrationFile}.`);
    }
    const verification = await client.query(`
      select
        exists (
          select 1 from pg_extension where extname = 'vector'
        ) as vector_enabled,
        to_regclass('public.chat_sessions') is not null as chat_sessions,
        to_regclass('public.chat_messages') is not null as chat_messages,
        to_regclass('public.knowledge_documents') is not null
          as knowledge_documents,
        to_regclass('public.knowledge_chunks') is not null
          as knowledge_chunks,
        to_regclass('public.catalog_products') is not null
          as catalog_products,
        to_regclass('public.catalog_product_specs') is not null
          as catalog_product_specs,
        to_regprocedure(
          'public.match_knowledge_chunks(vector,double precision,integer)'
        ) is not null as match_function,
        to_regprocedure(
          'public.search_catalog_products(text,integer)'
        ) is not null as catalog_search_function
    `);
    const status = verification.rows[0];
    const ready = Object.values(status).every(Boolean);
    if (!ready) {
      throw new Error("Migration verification did not find every schema object.");
    }
    console.log("A-Matrix Supabase migration applied and verified.");
  } catch (error) {
    console.error(
      `A-Matrix migration failed: ${
        error instanceof Error ? error.message : "unknown database error"
      }`,
    );
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}
