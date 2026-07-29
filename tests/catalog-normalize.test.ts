import { describe, expect, it } from "vitest";

import {
  extractSpecifications,
  normalizeAssetPageProducts,
  normalizeAssetProduct,
  normalizeWooProduct,
  productEmbeddingText,
} from "../scripts/catalog/normalize.mjs";

describe("catalogue normalization", () => {
  it("normalizes WooCommerce products and structured attributes", () => {
    const product = normalizeWooProduct({
      id: 42,
      name: "Pressure Transmitter",
      permalink: "https://a-matrix.ng/product/pressure-transmitter/",
      sku: "PT-42",
      description:
        "<h3>Technical data</h3><table><tr><th>Range</th><td>0–10 bar</td></tr></table>",
      short_description: "<p>Industrial pressure measurement.</p>",
      attributes: [
        { name: "Manufacturer", terms: ["Acme Controls"] },
        { name: "Model", terms: ["PX-10"] },
      ],
      categories: [{ name: "Instrumentation" }],
      images: [
        {
          src: "https://a-matrix.ng/media/pressure.jpg",
          alt: "Pressure transmitter",
        },
      ],
      prices: {
        price: "125000",
        currency_symbol: "₦",
        currency_minor_unit: 2,
      },
      is_in_stock: true,
    });

    expect(product).not.toBeNull();
    expect(product?.manufacturer).toBe("Acme Controls");
    expect(product?.model).toBe("PX-10");
    expect(product?.sku).toBe("PT-42");
    expect(product?.specifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Range", value: "0–10 bar" }),
      ]),
    );
  });

  it("extracts editable specifications from tables and labelled text", () => {
    const specifications = extractSpecifications(`
      <h3>Specifications</h3>
      <table><tr><td>Accuracy</td><td>±0.1%</td></tr></table>
      <p>Operating temperature: -20 to 80 °C</p>
    `);

    expect(specifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Accuracy", value: "±0.1%" }),
        expect.objectContaining({
          name: "Operating temperature",
          value: "-20 to 80 °C",
        }),
      ]),
    );
  });

  it("normalizes Asset Matrix custom products", () => {
    const product = normalizeAssetProduct({
      id: 9,
      slug: "water-softener",
      link: "https://assetmatrixenergy.com/water-softener/",
      modified_gmt: "2026-07-20T10:00:00",
      title: { rendered: "Industrial Water Softener" },
      excerpt: { rendered: "<p>Removes hardness from process water.</p>" },
      content: {
        rendered:
          "<h3>Technical details</h3><p>Flow rate: 20 m³/h</p>",
      },
      _embedded: {
        "wp:term": [
          [{ name: "Water Treatment", taxonomy: "product-cat" }],
        ],
      },
    });

    expect(product?.name).toBe("Industrial Water Softener");
    expect(product?.categories).toContain("Water Treatment");
    expect(product?.specifications[0]).toEqual(
      expect.objectContaining({ name: "Flow rate", value: "20 m³/h" }),
    );
  });

  it("splits specification-rich pages into product records", () => {
    const products = normalizeAssetPageProducts({
      id: 10,
      slug: "test-equipment",
      link: "https://assetmatrixenergy.com/test-equipment/",
      title: { rendered: "Test Equipment" },
      content: {
        rendered: `
          <h2 id="tap-kit">Bushing Tap Adapter Kit</h2>
          <p>For capacitance and tan delta testing on transformer bushings.</p>
          <p>Model: BTA-500</p>
          <table><tr><th>Lead length</th><td>2 m</td></tr></table>
          <h2>Contact us</h2><p>Sales contact information.</p>
        `,
      },
    });

    expect(products).toHaveLength(1);
    expect(products[0]).toEqual(
      expect.objectContaining({
        name: "Bushing Tap Adapter Kit",
        model: "BTA-500",
        sourceUrl:
          "https://assetmatrixenergy.com/test-equipment/#tap-kit",
      }),
    );
    expect(productEmbeddingText(products[0])).toContain("Lead length: 2 m");
  });
});
