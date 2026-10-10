// 데모 페르소나 3명: 문서 형식(format=json)을 따른 합성 스킨 분석 출력·색조·선반·장바구니. 녹화본이 있으면 그것을 쓴다
import type { Moment, Profile, ShelfItem, SkinScan, SkinTone } from "../domain/types";
import type { SkinAnalysisOutputItem, SkinToneResults } from "../youcam/types";
import { normalizeSkinAnalysis, normalizeSkinTone } from "../youcam/normalize";
import { RECORDED } from "./recorded";

type Score = [raw: number, ui: number];
interface SyntheticScan {
  capturedAt: string;
  skinAge: number;
  overall: number;
  skinType: { whole: string; t_zone: string; u_zone: string };
  scores: Record<string, Score>;
  regions?: Record<string, Record<string, Score>>;
}

/** Builds the exact `results.output` array a format=json HD skin analysis returns. */
export function syntheticOutput(s: SyntheticScan): SkinAnalysisOutputItem[] {
  const out: SkinAnalysisOutputItem[] = [];
  for (const [type, [raw, ui]] of Object.entries(s.scores)) {
    out.push({ type: `hd_${type}`, region: "whole", raw_score: raw, ui_score: ui, mask_urls: [] });
    for (const [region, [r, u]] of Object.entries(s.regions?.[type] ?? {})) {
      out.push({ type: `hd_${type}`, region, raw_score: r, ui_score: u, mask_urls: [] });
    }
  }
  for (const [region, label] of Object.entries(s.skinType)) {
    out.push({ type: "hd_skin_type", region: region === "whole" ? "whole" : region, skin_type: label });
  }
  out.push({ type: "skin_age", score: s.skinAge }, { type: "all", score: s.overall });
  return out;
}

export interface Persona {
  id: "maya" | "jun" | "lena";
  name: string;
  age: number;
  moment: Moment;
  story: string;
  scan: SyntheticScan;
  previousScan?: SyntheticScan;
  tone: SkinToneResults["color"];
  shelf: ShelfItem[];
  cart?: string[];
  profile: Profile;
}

export const PERSONAS: Persona[] = [
  {
    id: "maya",
    name: "Maya",
    age: 27,
    moment: "breakout",
    story: "Broke out after adding peel pads to a shelf that was already strong. Wants to know what to buy to fix it.",
    scan: {
      capturedAt: "2026-10-08T09:00:00Z",
      skinAge: 25,
      overall: 66.4,
      skinType: { whole: "Combination & Redness", t_zone: "Oily", u_zone: "Redness" },
      scores: {
        acne: [38.2, 62],
        pore: [46.1, 66],
        oiliness: [41.5, 64],
        redness: [47.3, 66],
        texture: [57.8, 70],
        moisture: [62.4, 73],
        radiance: [70.6, 77],
        wrinkle: [82.3, 84],
        age_spot: [76.1, 79],
        dark_circle: [72.4, 77],
        eye_bag: [80.2, 82],
        firmness: [88.5, 87],
        droopy_upper_eyelid: [84.1, 84],
        droopy_lower_eyelid: [85.3, 85],
        tear_trough: [79.6, 80],
      },
      regions: { pore: { forehead: [55.2, 70], nose: [31.4, 58], cheek: [52.6, 68] } },
    },
    tone: { skin_color: "#D9A88A", lip_color: "#B86A6E", eye_color_name: "Brown", hair_color_name: "Black" },
    shelf: [
      { productId: "kestra-clarifying-wash", startedAt: "2026-06-01" },
      { productId: "kestra-bha-liquid", startedAt: "2026-07-15" },
      { productId: "oramel-retinol-03", startedAt: "2026-08-01" },
      { productId: "pallu-glycolic-pads", startedAt: "2026-09-20" },
      { productId: "kestra-niacinamide-10", startedAt: "2026-06-01" },
      { productId: "pallu-niacinamide-5", startedAt: "2026-09-01" },
      { productId: "kestra-bp-spot", startedAt: "2026-09-25" },
      { productId: "pallu-rose-cream", startedAt: "2026-05-01" },
    ],
    profile: { budgetUsd: 60 },
  },
  {
    id: "jun",
    name: "Jun",
    age: 34,
    moment: "pre_purchase",
    story: "Has a $68 firming serum in the cart after seeing fine lines in a mirror. Asks whether it is worth it.",
    scan: {
      capturedAt: "2026-10-09T08:30:00Z",
      skinAge: 33,
      overall: 68.2,
      skinType: { whole: "Dry", t_zone: "Normal", u_zone: "Dry" },
      scores: {
        moisture: [39.4, 63],
        wrinkle: [64.2, 72],
        radiance: [61.8, 71],
        texture: [60.3, 71],
        redness: [63.5, 73],
        dark_circle: [55.1, 68],
        eye_bag: [71.4, 76],
        firmness: [78.2, 80],
        acne: [85.7, 86],
        pore: [77.3, 80],
        oiliness: [88.1, 87],
        age_spot: [72.6, 77],
        tear_trough: [60.4, 70],
        droopy_upper_eyelid: [80.2, 81],
        droopy_lower_eyelid: [82.4, 82],
      },
      regions: {
        wrinkle: { forehead: [58.6, 69], crowfeet: [66.1, 73], nasolabial: [70.3, 74], periocular: [61.2, 70] },
      },
    },
    tone: { skin_color: "#E2B89A", lip_color: "#C27C7A", eye_color_name: "Brown", hair_color_name: "Black" },
    shelf: [
      { productId: "velin-gel-cleanser", startedAt: "2026-03-01" },
      { productId: "velin-ha-serum", startedAt: "2026-05-01" },
      { productId: "oramel-vitc-15", startedAt: "2026-05-01" },
      { productId: "kestra-oilfree-gel", startedAt: "2026-03-01" },
      { productId: "velin-spf50-fluid", startedAt: "2026-03-01" },
      { productId: "oramel-rich-eye", startedAt: "2026-07-01" },
    ],
    cart: ["oramel-peptide-firming"],
    profile: { budgetUsd: 70 },
  },
  {
    id: "lena",
    name: "Lena",
    age: 41,
    moment: "is_it_working",
    story: "Started a retinal serum and a tranexamic acid serum six weeks ago for dark spots. Rescans to see if they work.",
    previousScan: {
      capturedAt: "2026-08-27T08:00:00Z",
      skinAge: 42,
      overall: 63.1,
      skinType: { whole: "Normal", t_zone: "Normal", u_zone: "Normal" },
      scores: {
        age_spot: [44.2, 64],
        wrinkle: [52.4, 66],
        texture: [57.6, 70],
        radiance: [55.3, 68],
        firmness: [60.2, 71],
        redness: [66.4, 74],
        moisture: [64.1, 73],
        pore: [70.5, 76],
        acne: [88.2, 87],
        oiliness: [75.3, 78],
        dark_circle: [62.4, 72],
        eye_bag: [68.3, 75],
        tear_trough: [63.2, 71],
        droopy_upper_eyelid: [70.1, 75],
        droopy_lower_eyelid: [72.6, 76],
      },
    },
    scan: {
      capturedAt: "2026-10-08T08:00:00Z",
      skinAge: 41,
      overall: 64.9,
      skinType: { whole: "Redness", t_zone: "Normal", u_zone: "Redness" },
      scores: {
        age_spot: [52.5, 68],
        wrinkle: [54.1, 67],
        texture: [62.9, 72],
        radiance: [57.2, 69],
        firmness: [61.0, 71],
        redness: [59.1, 70],
        moisture: [62.8, 72],
        pore: [71.2, 76],
        acne: [87.6, 87],
        oiliness: [76.0, 78],
        dark_circle: [61.7, 72],
        eye_bag: [68.9, 75],
        tear_trough: [63.0, 71],
        droopy_upper_eyelid: [70.4, 75],
        droopy_lower_eyelid: [72.1, 76],
      },
    },
    tone: { skin_color: "#C99A78", lip_color: "#A9625F", eye_color_name: "Brown", hair_color_name: "Brown" },
    shelf: [
      { productId: "oramel-milk-cleanser", startedAt: "2026-01-10" },
      { productId: "velin-retinal-01", startedAt: "2026-08-27" },
      { productId: "pallu-tranexamic-3", startedAt: "2026-08-27" },
      { productId: "pallu-glycolic-pads", startedAt: "2026-04-01" },
      { productId: "oramel-squalane-balm", startedAt: "2026-01-10" },
      { productId: "velin-spf50-fluid", startedAt: "2026-01-10" },
    ],
    profile: { budgetUsd: 50 },
  },
];

export function getPersona(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id);
}

/** The persona's scan: a recorded live YouCam response when one exists, otherwise the synthetic sample. */
export function personaScan(p: Persona, which: "current" | "previous" = "current"): SkinScan | undefined {
  const src = which === "current" ? p.scan : p.previousScan;
  if (!src) return undefined;
  const rec = RECORDED[p.id]?.[which === "current" ? "analysis" : "previousAnalysis"];
  const scan = normalizeSkinAnalysis(
    { output: rec?.output ?? syntheticOutput(src) },
    { id: `${p.id}-${which}`, capturedAt: src.capturedAt, source: rec ? "recorded" : "sample" },
  );
  scan.tone = personaTone(p);
  return scan;
}

export function personaTone(p: Persona): SkinTone {
  return normalizeSkinTone({ color: RECORDED[p.id]?.tone ?? p.tone });
}

export function personaImages(p: Persona): { selfie?: string; simulation?: string; looks?: Record<string, string> } {
  const r = RECORDED[p.id];
  return { selfie: r?.selfie, simulation: r?.simulation, looks: r?.looks };
}
