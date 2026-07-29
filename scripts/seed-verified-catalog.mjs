import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL?.trim();
const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
if (!url || !secretKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
}

const supabase = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const sourceUrl =
  "https://assetmatrixenergy.com/power-factor-tan-delta-test-set/";
const sourceSnapshot = {
  provenance: "verified-public-catalogue-snapshot",
  capturedFrom: sourceUrl,
  name: "Bushing Tap Adapter Kit Capacitance And Tan Delta Test",
  compatibility: [
    "ISA STS 5000 TD 5000",
    "ISA STS 4000 TD 5000",
    "ISA TDX 5000",
  ],
  application: "Power transformer bushing testing",
};
const sourceHash = createHash("sha256")
  .update(JSON.stringify(sourceSnapshot))
  .digest("hex");
const now = new Date().toISOString();
const { data: product, error: productError } = await supabase
  .from("catalog_products")
  .upsert(
    {
      source_site: "assetmatrixenergy.com",
      source_external_id: "verified:bushing-tap-adapter-kit",
      source_url: sourceUrl,
      source_hash: sourceHash,
      source_snapshot: sourceSnapshot,
      slug: "bushing-tap-adapter-kit",
      name: "Bushing Tap Adapter Kit Capacitance And Tan Delta Test",
      summary:
        "Adapter kit for capacitance and tan delta tests on power-transformer bushings. Compatible with ISA STS 5000 TD 5000, STS 4000 TD 5000 and TDX 5000 test sets.",
      description:
        "The published kit includes male-to-female and female-to-female adapters, 2.5 cm and 1.9 cm tap adapters, a bushing adapter probe, three hot-collar straps, a mini bushing tap adapter set, 1 m and 2 m non-insulated leads, a bushing tap adapter and a thermo-hygrometer.",
      technical_details: {
        compatibleTestSets: [
          "ISA STS 5000 TD 5000",
          "ISA STS 4000 TD 5000",
          "ISA TDX 5000",
        ],
      },
      applications: ["Power transformer bushing testing"],
      categories: ["Transformer Testing", "Power Factor/Tan Delta Test Set"],
      image_url: "/products/bushing-tap-adapter-kit.jpg",
      image_alt: "Bushing Tap Adapter Kit",
      status: "published",
      last_seen_at: now,
      last_synced_at: now,
      updated_at: now,
    },
    { onConflict: "source_site,source_external_id" },
  )
  .select("id")
  .single();
if (productError || !product?.id) {
  throw productError ?? new Error("Verified product upsert failed.");
}

const specifications = [
  ["Compatibility", "Compatible test set", "ISA STS 5000 TD 5000"],
  ["Compatibility", "Compatible test set", "ISA STS 4000 TD 5000"],
  ["Compatibility", "Compatible test set", "ISA TDX 5000"],
  ["Kit contents", "Tap adapter", "2.5 cm"],
  ["Kit contents", "Tap adapter", "1.9 cm"],
  ["Kit contents", "Non-insulated lead", "1 m"],
  ["Kit contents", "Non-insulated lead", "2 m"],
].map(([section, name, value], sortOrder) => ({
  product_id: product.id,
  sync_key: createHash("sha1")
    .update(`${section}\u0000${name}\u0000${value}`)
    .digest("hex"),
  section,
  name,
  value,
  sort_order: sortOrder,
  source_managed: true,
  updated_at: now,
}));
const { error: specificationError } = await supabase
  .from("catalog_product_specs")
  .upsert(specifications, { onConflict: "product_id,sync_key" });
if (specificationError) throw specificationError;

const { error: knowledgeError } = await supabase
  .from("knowledge_documents")
  .update({ product_id: product.id, updated_at: now })
  .eq("source_url", sourceUrl);
if (knowledgeError) throw knowledgeError;

console.log("Verified catalogue snapshot linked to the editable catalogue.");
