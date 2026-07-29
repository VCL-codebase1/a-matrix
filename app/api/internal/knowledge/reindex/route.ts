import { NextRequest, NextResponse } from "next/server";

import { loadAIConfig } from "../../../../lib/ai/config";
import { verifiedCatalogueProducts } from "../../../../lib/catalog-snapshot";
import { indexCatalogueProducts } from "../../../../lib/db/knowledge";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const config = loadAIConfig();
  if (
    !config.adminToken ||
    request.headers.get("authorization") !== `Bearer ${config.adminToken}`
  ) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const result = await indexCatalogueProducts(
    verifiedCatalogueProducts(),
    config,
  );
  return NextResponse.json(
    {
      ...result,
      embeddingModel: config.embeddingModel,
      dimensions: 768,
    },
    { status: result.indexed > 0 ? 200 : 503 },
  );
}
