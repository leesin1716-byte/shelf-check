// YouCam 응답(JSON 포맷 스킨 분석·색조 분석·이미지 결과)을 앱의 SkinScan·SkinTone 으로 바꾼다
import { CONCERNS, type Concern, type ScanSource, type SkinScan, type SkinTone, type SkinTypeLabel } from "../domain/types";
import type { SkinAnalysisJsonResults, SkinToneResults } from "./types";

const ALIAS: Record<string, Concern> = { dark_circle_v2: "dark_circle" };

function toConcern(type: string): Concern | null {
  const bare = type.replace(/^hd_/, "");
  const key = (ALIAS[bare] ?? bare) as Concern;
  return (CONCERNS as readonly string[]).includes(key) ? key : null;
}

const SKIN_TYPES: SkinTypeLabel[] = [
  "Normal",
  "Oily",
  "Dry",
  "Combination",
  "Redness",
  "Dry & Redness",
  "Oily & Redness",
  "Combination & Redness",
];

function toSkinType(v: string | undefined): SkinTypeLabel | undefined {
  if (!v) return undefined;
  const hit = SKIN_TYPES.find((t) => t.toLowerCase() === v.trim().toLowerCase().replace(/\s+and\s+/, " & "));
  return hit;
}

export function normalizeSkinAnalysis(
  results: SkinAnalysisJsonResults,
  meta: { id: string; capturedAt: string; source: ScanSource },
): SkinScan {
  if (!results || !Array.isArray(results.output)) {
    throw new Error("Skin analysis results must be the format=json shape with an output array");
  }
  const scan: SkinScan = {
    id: meta.id,
    capturedAt: meta.capturedAt,
    source: meta.source,
    mode: results.output.some((o) => o.type.startsWith("hd_")) ? "hd" : "sd",
    overall: null,
    skinAge: null,
    skinType: {},
    concerns: {},
  };
  for (const item of results.output) {
    if (item.type === "all") {
      scan.overall = typeof item.score === "number" ? Math.round(item.score * 10) / 10 : null;
      continue;
    }
    if (item.type === "skin_age") {
      scan.skinAge = typeof item.score === "number" ? Math.round(item.score) : null;
      continue;
    }
    if (item.type === "resize_image") {
      scan.baseImageUrl = item.mask_urls?.[0];
      continue;
    }
    if (item.type === "hd_skin_type" || item.type === "skin_type") {
      const t = toSkinType(item.skin_type);
      if (item.region === "t_zone") scan.skinType.tZone = t;
      else if (item.region === "u_zone") scan.skinType.uZone = t;
      else scan.skinType.whole = t;
      continue;
    }
    const concern = toConcern(item.type);
    if (!concern || typeof item.raw_score !== "number") continue;
    const entry = { raw: round1(item.raw_score), ui: Math.round(item.ui_score ?? item.raw_score), maskUrl: item.mask_urls?.[0] };
    const region = item.region ?? "whole";
    const existing = scan.concerns[concern];
    if (region === "whole") {
      scan.concerns[concern] = { ...entry, regions: existing?.regions };
    } else {
      const base = existing ?? { raw: entry.raw, ui: entry.ui };
      base.regions = { ...(base.regions ?? {}), [region]: entry };
      scan.concerns[concern] = base;
    }
  }
  // A concern with only regional scores (no "whole" row) takes its worst region as the headline.
  for (const c of Object.keys(scan.concerns) as Concern[]) {
    const s = scan.concerns[c]!;
    if (s.regions && !results.output.some((o) => toConcern(o.type) === c && (o.region ?? "whole") === "whole")) {
      const worst = Object.values(s.regions).sort((a, b) => a.raw - b.raw)[0];
      s.raw = worst.raw;
      s.ui = worst.ui;
    }
  }
  return scan;
}

export function normalizeSkinTone(results: SkinToneResults): SkinTone {
  const c = results?.color;
  if (!c?.skin_color) throw new Error("Skin tone result has no skin_color");
  return {
    skinHex: normalizeHex(c.skin_color),
    lipHex: c.lip_color ? normalizeHex(c.lip_color) : undefined,
    eyeColorName: c.eye_color_name,
    hairColorName: c.hair_color_name,
  };
}

/** Image results come back as `{url}` (spec) or `[{download_url}]` (prose); accept both. */
export function resultImageUrl(results: unknown): string {
  const r = results as any;
  const url = r?.url ?? r?.download_url ?? (Array.isArray(r) ? (r[0]?.url ?? r[0]?.download_url) : undefined);
  if (typeof url !== "string") throw new Error("Task result has no image URL");
  return url;
}

export function normalizeHex(hex: string): string {
  const h = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Not a hex color: ${hex}`);
  return `#${h.toUpperCase()}`;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
