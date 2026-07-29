import { NextRequest, NextResponse } from "next/server";

import { loadAIConfig } from "../../../lib/ai/config";
import { getUsageSnapshot } from "../../../lib/ai/usage";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = loadAIConfig();
  if (
    !config.adminToken ||
    request.headers.get("authorization") !== `Bearer ${config.adminToken}`
  ) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json({
    usage: getUsageSnapshot(),
    configuration: {
      models: {
        routine: config.routineModel,
        complex: config.complexModel,
      },
      tokenBudgets: {
        routineInput: config.routineInputBudget,
        routineOutput: config.routineMaxOutputTokens,
        complexInput: config.complexInputBudget,
        complexOutput: config.complexMaxOutputTokens,
      },
      rateLimits: {
        anonymousPerHour: config.anonymousRequestsPerHour,
        anonymousPerDay: config.anonymousRequestsPerDay,
        concurrentPerSession: config.maxConcurrentRequestsPerUser,
      },
    },
  });
}
