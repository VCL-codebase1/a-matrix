import { GoogleGenAI, type Content } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import {
  searchPublishedCatalog,
  type CatalogProduct,
} from "../../lib/catalog";
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

function buildCatalogContext(
  products: CatalogProduct[],
  query: string | null,
  retrievedAt: string | null,
): string {
  return [
    "VERIFIED A-MATRIX ONLINE CATALOGUE RESULTS",
    `Search query: ${query ?? "Not available"}`,
    `Retrieved: ${retrievedAt ?? "Not available"}`,
    "Use only the fields below as verified website catalogue data. The listed price is not a final quotation, and website availability still requires commercial confirmation.",
    JSON.stringify(
      products.map((product) => ({
        name: product.name,
        sku: product.sku,
        summary: product.summary,
        listedPrice: product.listedPrice,
        availability: product.availability,
        categories: product.categories,
        url: product.url,
      })),
    ),
  ].join("\n");
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

    const latestPrompt = messages[messages.length - 1].content;
    const catalog = await searchPublishedCatalog(latestPrompt).catch((error) => {
      console.error("A-Matrix catalogue search error", error);
      return { query: null, products: [], retrievedAt: null };
    });

    const contents: Content[] = messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

    if (catalog.products.length > 0) {
      contents[contents.length - 1].parts?.push({
        text: buildCatalogContext(
          catalog.products,
          catalog.query,
          catalog.retrievedAt,
        ),
      });
    }

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

    return NextResponse.json({
      answer,
      products: catalog.products,
      catalogQuery: catalog.query,
      catalogRetrievedAt: catalog.retrievedAt,
    });
  } catch (error) {
    console.error("a-matrix chat error", error);
    return NextResponse.json(
      { error: "Something interrupted the conversation. Please try again." },
      { status: 500 },
    );
  }
}
