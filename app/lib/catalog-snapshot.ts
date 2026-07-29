import type { CatalogProduct } from "./catalog";

type VerifiedCatalogueEntry = {
  product: CatalogProduct;
  aliases: string[];
  requiredTerms: string[];
};

/*
 * Deterministic fallback for products verified on Asset Matrix's public site.
 *
 * The live WordPress API remains the primary source for products that are not
 * represented here. This small snapshot prevents the customer experience from
 * collapsing when the public site's bot protection blocks a server-side
 * catalogue request.
 */
const VERIFIED_CATALOGUE: VerifiedCatalogueEntry[] = [
  {
    product: {
      id: 9_000_001,
      name: "Bushing Tap Adapter Kit Capacitance And Tan Delta Test",
      url: "https://assetmatrixenergy.com/power-factor-tan-delta-test-set/",
      sku: null,
      summary:
        "Designed for capacitance and tan delta tests on power-transformer bushings. Compatible with ISA test sets STS 5000 TD 5000, STS 4000 TD 5000 and TDX 5000. The published kit includes male-to-female and female-to-female adapters, 2.5 cm and 1.9 cm tap adapters, a bushing adapter probe, three hot-collar straps, a mini bushing tap adapter set, 1 m and 2 m non-insulated leads, a bushing tap adapter and a thermo-hygrometer. Application: power transformers.",
      listedPrice: "Quotation required",
      availability: "Availability requires confirmation",
      image: {
        url: "/products/bushing-tap-adapter-kit.jpg",
        alt: "Bushing Tap Adapter Kit",
      },
      categories: [
        "Power Factor/Tan Delta Test Set",
        "Transformer Testing",
      ],
    },
    aliases: [
      "bushing tap adapter kit",
      "bushing adapter kit",
      "bushing tap kit",
      "capacitance and tan delta adapter kit",
    ],
    requiredTerms: ["bushing", "tap", "adapter", "kit"],
  },
];

function searchableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchVerifiedCatalogueSnapshot(
  prompt: string,
): CatalogProduct[] {
  const query = searchableText(prompt);
  const queryTerms = new Set(query.split(" ").filter(Boolean));

  return VERIFIED_CATALOGUE.filter((entry) => {
    if (entry.aliases.some((alias) => query.includes(alias))) return true;

    const matchedTerms = entry.requiredTerms.filter((term) =>
      queryTerms.has(term),
    );
    return matchedTerms.length >= 3 && queryTerms.has("bushing");
  }).map((entry) => entry.product);
}
