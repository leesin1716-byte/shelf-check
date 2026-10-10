// 피부 스캔·선반·순간(moment)·프로필 등 앱 전체가 공유하는 도메인 타입
// Core domain types shared by the YouCam client, the rules engine, the agent and the UI.

export const CONCERNS = [
  "acne",
  "pore",
  "texture",
  "wrinkle",
  "redness",
  "oiliness",
  "moisture",
  "radiance",
  "age_spot",
  "dark_circle",
  "eye_bag",
  "firmness",
  "droopy_upper_eyelid",
  "droopy_lower_eyelid",
  "tear_trough",
] as const;
export type Concern = (typeof CONCERNS)[number];

export const CONCERN_LABEL: Record<Concern, string> = {
  acne: "Acne",
  pore: "Pores",
  texture: "Texture",
  wrinkle: "Fine lines",
  redness: "Redness",
  oiliness: "Oiliness",
  moisture: "Hydration",
  radiance: "Radiance",
  age_spot: "Dark spots",
  dark_circle: "Dark circles",
  eye_bag: "Eye bags",
  firmness: "Firmness",
  droopy_upper_eyelid: "Upper eyelid",
  droopy_lower_eyelid: "Lower eyelid",
  tear_trough: "Tear trough",
};

export type SkinTypeLabel =
  | "Normal"
  | "Oily"
  | "Dry"
  | "Combination"
  | "Redness"
  | "Dry & Redness"
  | "Oily & Redness"
  | "Combination & Redness";

export interface ConcernScore {
  /** YouCam raw_score, 1..100, higher = healthier. Used for every decision. */
  raw: number;
  /** YouCam ui_score, 1..100, calibrated to feel encouraging. Shown, never decided on. */
  ui: number;
  regions?: Record<string, { raw: number; ui: number; maskUrl?: string }>;
  maskUrl?: string;
}

export type ScanSource = "live" | "recorded" | "sample";

export interface SkinScan {
  id: string;
  capturedAt: string; // ISO date
  source: ScanSource;
  mode: "hd" | "sd";
  overall: number | null;
  skinAge: number | null;
  skinType: { whole?: SkinTypeLabel; tZone?: SkinTypeLabel; uZone?: SkinTypeLabel };
  concerns: Partial<Record<Concern, ConcernScore>>;
  /** The resized source image returned by YouCam (masks align with it). */
  baseImageUrl?: string;
  tone?: SkinTone;
}

export interface SkinTone {
  skinHex: string;
  lipHex?: string;
  eyeColorName?: string;
  hairColorName?: string;
}

export type Moment = "pre_purchase" | "breakout" | "is_it_working";

export const MOMENT_LABEL: Record<Moment, string> = {
  pre_purchase: "About to buy something",
  breakout: "Just had a breakout",
  is_it_working: "Is my routine working?",
};

export interface Profile {
  /** Pregnant or breastfeeding: retinoids are paused regardless of scan. */
  pregnantOrNursing?: boolean;
  /** Monthly budget for new products in USD. */
  budgetUsd?: number;
  /** Fragrance sensitivity reported by the user. */
  fragranceSensitive?: boolean;
}

export interface ShelfItem {
  productId: string;
  /** ISO date the user started using it (needed for "is it working"). */
  startedAt?: string;
}

export interface ScenarioInput {
  moment: Moment;
  scan: SkinScan;
  previousScan?: SkinScan;
  shelf: ShelfItem[];
  /** Product the user is about to buy (pre_purchase moment). */
  cart?: string[];
  profile: Profile;
}
