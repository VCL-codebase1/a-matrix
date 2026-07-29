import { describe, expect, it } from "vitest";

import { classifyRequestComplexity } from "../app/lib/ai/complexity";
import {
  extractExactIdentifiers,
  identifierVariants,
  identifiersEqual,
} from "../app/lib/ai/identifiers";
import { routeRequest } from "../app/lib/ai/router";
import { matchStaticResponse } from "../app/lib/ai/static-responses";

describe("deterministic request routing", () => {
  it("routes greetings and business hours to static responses", () => {
    expect(routeRequest("Hello!").route).toBe("static_response");
    expect(routeRequest("What are your business hours?").route).toBe(
      "static_response",
    );
  });

  it("routes exact product identifiers to direct retrieval", () => {
    const decision = routeRequest("Do you have ABC-123?");
    expect(decision.route).toBe("direct_database");
    expect(decision.intent).toBe("product_search");
    expect(decision.exactIdentifiers).toContain("ABC-123");
  });

  it("recognizes natural product requests without the word product", () => {
    const decision = routeRequest(
      "I'm looking for a bushing tap adapter kit",
    );
    expect(decision.route).toBe("routine_ai");
    expect(decision.intent).toBe("product_search");
  });

  it("routes private records away from the model", () => {
    expect(routeRequest("Where is my order ABC-123?").route).toBe(
      "business_operation",
    );
  });

  it("uses complex routing only when deterministic signals justify it", () => {
    expect(routeRequest("Compare ABC-123 and XYZ-456").route).toBe(
      "complex_ai",
    );
    expect(routeRequest("I need a replacement for pump ZX-90").route).toBe(
      "complex_ai",
    );
    expect(routeRequest("Here is a long description ".repeat(300)).route).toBe(
      "routine_ai",
    );
  });
});

describe("identifier detection", () => {
  it("extracts, normalizes and creates punctuation variants", () => {
    expect(extractExactIdentifiers("Need model AB-123/4 today")).toContain(
      "AB-123/4",
    );
    expect(identifiersEqual("AB-123", "ab123")).toBe(true);
    expect(identifierVariants("AB-123")).toEqual(["AB-123", "AB123"]);
  });
});

describe("complexity classification", () => {
  it("classifies attachments, compatibility and safety-critical work", () => {
    expect(classifyRequestComplexity("Please review these files", 2)).toBe(
      "complex",
    );
    expect(classifyRequestComplexity("Is this compatible with unit X?")).toBe(
      "complex",
    );
    expect(classifyRequestComplexity("This is for a safety-critical system")).toBe(
      "complex",
    );
  });

  it("does not use message length alone", () => {
    expect(classifyRequestComplexity("standard details ".repeat(1000))).toBe(
      "routine",
    );
  });
});

describe("static FAQ registry", () => {
  it("matches identity, quotation and contact questions", () => {
    expect(matchStaticResponse("Who are you?")?.key).toBe("identity");
    expect(matchStaticResponse("How do I request a quotation?")?.key).toBe(
      "quotation",
    );
    expect(matchStaticResponse("How can I contact A-Matrix?")?.key).toBe(
      "contact",
    );
  });
});
