import { GoogleGenAI, type Content } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { A_MATRIX_PERSONALITY } from "../../lib/personality";

export const runtime = "nodejs";

type IncomingMessage = {
  role: "user" | "assistant";
  content: string;
};

const MAX_MESSAGES = 40;
const MAX_TOTAL_CHARS = 80_000;

function isValidMessage(value: unknown): value is IncomingMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return (
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    message.content.trim().length > 0
  );
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
    if (!apiKey) {
      return NextResponse.json(
        { error: "a-matrix isn’t connected yet. Please try again shortly." },
        { status: 503 },
      );
    }

    const body = (await request.json()) as { messages?: unknown };
    if (!Array.isArray(body.messages) || !body.messages.every(isValidMessage)) {
      return NextResponse.json(
        { error: "That message could not be read." },
        { status: 400 },
      );
    }

    const messages = body.messages.slice(-MAX_MESSAGES);
    const totalChars = messages.reduce(
      (sum, message) => sum + message.content.length,
      0,
    );

    if (
      messages.length === 0 ||
      messages[messages.length - 1].role !== "user" ||
      totalChars > MAX_TOTAL_CHARS
    ) {
      return NextResponse.json(
        { error: "This conversation is too large for one request." },
        { status: 400 },
      );
    }

    const contents: Content[] = messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: A_MATRIX_PERSONALITY,
        maxOutputTokens: 8192,
      },
    });

    const answer = response.text?.trim();
    if (!answer) {
      return NextResponse.json(
        { error: "I couldn’t form a response. Try phrasing that another way." },
        { status: 502 },
      );
    }

    return NextResponse.json({ answer });
  } catch (error) {
    console.error("a-matrix chat error", error);
    return NextResponse.json(
      { error: "Something interrupted the conversation. Please try again." },
      { status: 500 },
    );
  }
}
