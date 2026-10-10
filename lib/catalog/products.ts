// 데모 상품 카탈로그(가상 브랜드, 실제 성분·농도 관행 기반) — 스킨케어와 VTO용 메이크업 셰이드
import type { Concern } from "../domain/types";

// Brand names are fictional so the demo carries no third-party trademarks.

export type Category =
  | "cleanser"
  | "toner"
  | "exfoliant"
  | "serum"
  | "treatment"
  | "eye"
  | "moisturizer"
  | "sunscreen"
  | "foundation"
  | "lip"
  | "blush";

export type Active =
  | "retinoid"
  | "aha"
  | "bha"
  | "pha"
  | "benzoyl_peroxide"
  | "vitamin_c"
  | "niacinamide"
  | "azelaic_acid"
  | "tranexamic_acid"
  | "ceramides"
  | "hyaluronic_acid"
  | "peptides"
  | "centella"
  | "caffeine"
  | "squalane"
  | "zinc"
  | "hydrocolloid"
  | "spf"
  | "fragrance";

export interface Product {
  id: string;
  brand: string;
  name: string;
  category: Category;
  priceUsd: number;
  actives: Active[];
  /** Concerns the product is formulated for. */
  targets: Concern[];
  time: "am" | "pm" | "both";
  /** 0 = gentle .. 3 = strong. */
  irritation: 0 | 1 | 2 | 3;
  occlusive?: boolean;
  /** Typical weeks before a visible change, used for check-ins and previews. */
  weeksToSee?: number;
  shade?: { hex: string; undertone: "cool" | "neutral" | "warm"; label: string };
  texture?: "matte" | "satin" | "sheer" | "gloss";
}

const P = (p: Product) => p;

export const PRODUCTS: Product[] = [
  // Cleansers
  P({ id: "velin-gel-cleanser", brand: "Velin", name: "Gentle Gel Cleanser", category: "cleanser", priceUsd: 14, actives: [], targets: [], time: "both", irritation: 0 }),
  P({ id: "kestra-clarifying-wash", brand: "Kestra", name: "Clarifying Foam Wash (0.5% salicylic acid)", category: "cleanser", priceUsd: 16, actives: ["bha"], targets: ["acne", "oiliness", "pore"], time: "both", irritation: 1, weeksToSee: 6 }),
  P({ id: "oramel-milk-cleanser", brand: "Oramel", name: "Ceramide Milk Cleanser", category: "cleanser", priceUsd: 18, actives: ["ceramides"], targets: ["moisture"], time: "both", irritation: 0 }),
  // Toners and exfoliants
  P({ id: "kestra-bha-liquid", brand: "Kestra", name: "2% BHA Liquid Exfoliant", category: "exfoliant", priceUsd: 29, actives: ["bha"], targets: ["acne", "pore", "texture", "oiliness"], time: "pm", irritation: 2, weeksToSee: 6 }),
  P({ id: "pallu-glycolic-pads", brand: "Pallu", name: "10% Glycolic Peel Pads", category: "exfoliant", priceUsd: 34, actives: ["aha"], targets: ["texture", "radiance", "age_spot"], time: "pm", irritation: 3, weeksToSee: 6 }),
  P({ id: "velin-pha-toner", brand: "Velin", name: "PHA Gentle Toner", category: "toner", priceUsd: 22, actives: ["pha"], targets: ["texture", "moisture"], time: "both", irritation: 1, weeksToSee: 6 }),
  // Serums
  P({ id: "oramel-retinol-03", brand: "Oramel", name: "Retinol 0.3% Serum", category: "serum", priceUsd: 38, actives: ["retinoid"], targets: ["wrinkle", "texture", "acne", "age_spot", "pore"], time: "pm", irritation: 2, weeksToSee: 12 }),
  P({ id: "velin-retinal-01", brand: "Velin", name: "Retinal 0.1% Night Serum", category: "serum", priceUsd: 52, actives: ["retinoid"], targets: ["wrinkle", "firmness", "age_spot", "texture"], time: "pm", irritation: 2, weeksToSee: 12 }),
  P({ id: "kestra-niacinamide-10", brand: "Kestra", name: "Niacinamide 10% + Zinc Serum", category: "serum", priceUsd: 12, actives: ["niacinamide", "zinc"], targets: ["oiliness", "pore", "acne", "redness"], time: "both", irritation: 1, weeksToSee: 8 }),
  P({ id: "pallu-niacinamide-5", brand: "Pallu", name: "Niacinamide 5% Balancing Serum", category: "serum", priceUsd: 19, actives: ["niacinamide"], targets: ["redness", "pore", "age_spot", "moisture"], time: "both", irritation: 0, weeksToSee: 8 }),
  P({ id: "oramel-vitc-15", brand: "Oramel", name: "Vitamin C 15% Serum", category: "serum", priceUsd: 42, actives: ["vitamin_c"], targets: ["radiance", "age_spot"], time: "am", irritation: 1, weeksToSee: 8 }),
  P({ id: "velin-ha-serum", brand: "Velin", name: "Hyaluronic Hydration Serum", category: "serum", priceUsd: 24, actives: ["hyaluronic_acid"], targets: ["moisture"], time: "both", irritation: 0, weeksToSee: 2 }),
  P({ id: "kestra-azelaic-10", brand: "Kestra", name: "Azelaic Acid 10% Gel", category: "treatment", priceUsd: 27, actives: ["azelaic_acid"], targets: ["redness", "acne", "age_spot"], time: "both", irritation: 1, weeksToSee: 8 }),
  P({ id: "pallu-tranexamic-3", brand: "Pallu", name: "Tranexamic Acid 3% Serum", category: "serum", priceUsd: 36, actives: ["tranexamic_acid"], targets: ["age_spot"], time: "both", irritation: 0, weeksToSee: 8 }),
  P({ id: "oramel-peptide-firming", brand: "Oramel", name: "Multi-Peptide Firming Serum", category: "serum", priceUsd: 68, actives: ["peptides"], targets: ["firmness", "wrinkle"], time: "both", irritation: 0, weeksToSee: 12 }),
  P({ id: "velin-centella-serum", brand: "Velin", name: "Centella Calming Serum", category: "serum", priceUsd: 26, actives: ["centella"], targets: ["redness", "moisture"], time: "both", irritation: 0, weeksToSee: 4 }),
  // Treatments
  P({ id: "kestra-bp-spot", brand: "Kestra", name: "Benzoyl Peroxide 2.5% Spot Gel", category: "treatment", priceUsd: 11, actives: ["benzoyl_peroxide"], targets: ["acne"], time: "am", irritation: 2, weeksToSee: 4 }),
  P({ id: "pallu-pimple-patches", brand: "Pallu", name: "Hydrocolloid Pimple Patches", category: "treatment", priceUsd: 9, actives: ["hydrocolloid"], targets: ["acne"], time: "both", irritation: 0, weeksToSee: 1 }),
  // Eye
  P({ id: "velin-caffeine-eye", brand: "Velin", name: "Caffeine Eye Serum", category: "eye", priceUsd: 21, actives: ["caffeine"], targets: ["eye_bag", "dark_circle"], time: "am", irritation: 0, weeksToSee: 4 }),
  P({ id: "oramel-rich-eye", brand: "Oramel", name: "Rich Peptide Eye Cream", category: "eye", priceUsd: 45, actives: ["peptides"], targets: ["dark_circle", "wrinkle", "tear_trough"], time: "both", irritation: 0, occlusive: true, weeksToSee: 8 }),
  // Moisturizers
  P({ id: "velin-ceramide-cream", brand: "Velin", name: "Ceramide Barrier Cream", category: "moisturizer", priceUsd: 19, actives: ["ceramides"], targets: ["moisture", "redness"], time: "both", irritation: 0, weeksToSee: 2 }),
  P({ id: "kestra-oilfree-gel", brand: "Kestra", name: "Oil-Free Gel Moisturizer", category: "moisturizer", priceUsd: 17, actives: ["hyaluronic_acid"], targets: ["moisture"], time: "both", irritation: 0, weeksToSee: 2 }),
  P({ id: "pallu-rose-cream", brand: "Pallu", name: "Rose Absolute Rich Cream", category: "moisturizer", priceUsd: 48, actives: ["fragrance"], targets: ["moisture"], time: "both", irritation: 1, occlusive: true, weeksToSee: 2 }),
  P({ id: "oramel-squalane-balm", brand: "Oramel", name: "Squalane Night Balm", category: "moisturizer", priceUsd: 39, actives: ["squalane"], targets: ["moisture", "firmness"], time: "pm", irritation: 0, occlusive: true, weeksToSee: 2 }),
  // Sunscreen
  P({ id: "velin-spf50-fluid", brand: "Velin", name: "Daily Fluid SPF 50", category: "sunscreen", priceUsd: 24, actives: ["spf"], targets: ["age_spot", "wrinkle", "redness"], time: "am", irritation: 0 }),
  P({ id: "kestra-mineral-spf40", brand: "Kestra", name: "Matte Mineral SPF 40", category: "sunscreen", priceUsd: 22, actives: ["spf", "zinc"], targets: ["age_spot", "oiliness"], time: "am", irritation: 0 }),
  // Foundation shades (Pallu Second Skin Tint)
  ...(
    [
      ["110C", "Porcelain", "#F3D9CB", "cool"],
      ["130N", "Light", "#E8C4A8", "neutral"],
      ["150W", "Light Warm", "#E3BC94", "warm"],
      ["220N", "Medium", "#D2A27F", "neutral"],
      ["240W", "Medium Warm", "#C99A6E", "warm"],
      ["310C", "Tan Cool", "#B07F66", "cool"],
      ["330W", "Tan Warm", "#A9774E", "warm"],
      ["420N", "Deep", "#7E5640", "neutral"],
      ["450W", "Deep Warm", "#6E4A30", "warm"],
      ["510N", "Rich", "#4E3426", "neutral"],
    ] as const
  ).map(([code, label, hex, undertone]) =>
    P({
      id: `pallu-tint-${code.toLowerCase()}`,
      brand: "Pallu",
      name: `Second Skin Tint ${code} ${label}`,
      category: "foundation",
      priceUsd: 32,
      actives: [],
      targets: [],
      time: "am",
      irritation: 0,
      shade: { hex, undertone, label: `${code} ${label}` },
    }),
  ),
  // Lip tints (Velin)
  ...(
    [
      ["rosewood", "Rosewood", "#A65E62", "satin"],
      ["nude-rose", "Nude Rose", "#C08378", "satin"],
      ["coral", "Coral Wash", "#E06A55", "sheer"],
      ["brick", "Brick", "#A2493A", "matte"],
      ["berry", "Berry", "#8E3550", "matte"],
      ["plum", "Plum", "#6B2E45", "matte"],
    ] as const
  ).map(([id, label, hex, texture]) =>
    P({
      id: `velin-lip-${id}`,
      brand: "Velin",
      name: `Soft Lip Tint ${label}`,
      category: "lip",
      priceUsd: 18,
      actives: [],
      targets: [],
      time: "am",
      irritation: 0,
      texture,
      shade: { hex, undertone: "neutral", label },
    }),
  ),
  // Blush (Kestra)
  ...(
    [
      ["peach", "Peach", "#F2A07B", "warm"],
      ["rose", "Rose", "#D97A8A", "cool"],
      ["terracotta", "Terracotta", "#C46A4C", "warm"],
    ] as const
  ).map(([id, label, hex, undertone]) =>
    P({
      id: `kestra-blush-${id}`,
      brand: "Kestra",
      name: `Cream Blush ${label}`,
      category: "blush",
      priceUsd: 20,
      actives: [],
      targets: [],
      time: "am",
      irritation: 0,
      shade: { hex, undertone, label },
    }),
  ),
];

const BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));

export function getProduct(id: string): Product | undefined {
  return BY_ID.get(id);
}

export function mustProduct(id: string): Product {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`Unknown product id: ${id}`);
  return p;
}

export const SKINCARE_CATEGORIES: Category[] = [
  "cleanser",
  "toner",
  "exfoliant",
  "serum",
  "treatment",
  "eye",
  "moisturizer",
  "sunscreen",
];

export function isSkincare(p: Product) {
  return SKINCARE_CATEGORIES.includes(p.category);
}

export function productLabel(p: Product) {
  return `${p.brand} ${p.name}`;
}
