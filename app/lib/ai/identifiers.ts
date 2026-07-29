const IDENTIFIER_PATTERN =
  /\b(?=[a-z0-9._/-]{4,}\b)(?=[a-z0-9._/-]*[a-z])(?=[a-z0-9._/-]*\d)[a-z0-9][a-z0-9._/-]*\b/gi;

export function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function extractExactIdentifiers(message: string): string[] {
  return [...message.matchAll(IDENTIFIER_PATTERN)]
    .map((match) => match[0])
    .filter(
      (value, index, values) =>
        values.findIndex(
          (candidate) =>
            normalizeIdentifier(candidate) === normalizeIdentifier(value),
        ) === index,
    )
    .slice(0, 5);
}

export function identifierVariants(value: string): string[] {
  const trimmed = value.trim();
  const compact = trimmed.replace(/[-_\s/]+/g, "");
  return [trimmed, compact].filter(
    (variant, index, variants) =>
      variant &&
      variants.findIndex(
        (candidate) =>
          candidate.toLowerCase() === variant.toLowerCase(),
      ) === index,
  );
}

export function identifiersEqual(left: string, right: string): boolean {
  return normalizeIdentifier(left) === normalizeIdentifier(right);
}
