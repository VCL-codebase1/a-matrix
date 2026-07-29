import { NextRequest, NextResponse } from "next/server";

import { loadAIConfig } from "../../lib/ai/config";
import {
  customerMessageForError,
  statusForError,
  toAIError,
} from "../../lib/ai/errors";
import { orchestrateChat } from "../../lib/ai/orchestrator";
import { chatRequestSchema } from "../../lib/ai/request-schema";
import { recordRateLimitEvent } from "../../lib/ai/usage";
import { searchPublishedCatalog } from "../../lib/catalog";
import { createChatEventStream } from "../../lib/chat-stream";
import { searchKnowledgeBase } from "../../lib/db/knowledge";
import { persistChatExchange } from "../../lib/db/persistence";

export const runtime = "nodejs";
export const maxDuration = 60;

function requestIp(request: NextRequest): string {
  return (
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "anonymous"
  );
}

export async function POST(request: NextRequest) {
  try {
    if (!request.headers.get("content-type")?.includes("application/json")) {
      return NextResponse.json(
        { error: "That request format could not be read." },
        { status: 415 },
      );
    }

    const config = loadAIConfig();
    const parsed = chatRequestSchema.safeParse(await request.json());
    if (!parsed.success || parsed.data.website) {
      return NextResponse.json(
        { error: "That message could not be read." },
        { status: 400 },
      );
    }
    if (parsed.data.message.length > config.maxMessageCharacters) {
      return NextResponse.json(
        {
          error:
            "That message is too long to review safely at once. Please send the most important product or procurement details first.",
        },
        { status: 400 },
      );
    }

    const outcome = await orchestrateChat(
      {
        request: parsed.data,
        ip: requestIp(request),
        config,
      },
      {
        searchCatalog: searchPublishedCatalog,
        searchKnowledge: (message) => searchKnowledgeBase(message, config),
      },
    );
    const persistence = persistChatExchange({
      request: parsed.data,
      outcome,
    });

    return new Response(
      createChatEventStream(outcome, {
        signal: request.signal,
        beforeComplete: async () => {
          await persistence;
        },
      }),
      {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      },
    );
  } catch (error) {
    const aiError = toAIError(error);
    if (aiError.code === "RATE_LIMITED") recordRateLimitEvent();
    console.error("A-Matrix chat request failed", {
      code: aiError.code,
      detail: aiError.message,
      cause: aiError.cause,
    });
    return NextResponse.json(
      { error: customerMessageForError(aiError) },
      { status: statusForError(aiError) },
    );
  }
}
