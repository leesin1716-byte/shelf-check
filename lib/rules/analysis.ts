// 스캔 점수(raw_score)로 고민의 심각도와 우선순위를 정한다 — ui_score 는 보여주기만 하고 판단에 쓰지 않는다
import { CONCERN_LABEL, type Concern, type SkinScan } from "../domain/types";

export type Severity = "act" | "watch" | "fine";

/**
 * raw_score is 1..100 with higher = healthier. YouCam calibrates ui_score upward on purpose
 * ("psychological motivator"), so decisions use raw_score. Thresholds are this app's heuristics.
 */
export const ACT_BELOW = 50;
export const WATCH_BELOW = 70;

/** Structural concerns that topical skincare cannot meaningfully change. We never sell for them. */
export const NOT_TOPICAL: Concern[] = ["droopy_upper_eyelid", "droopy_lower_eyelid", "tear_trough"];

export function severityOf(raw: number): Severity {
  if (raw < ACT_BELOW) return "act";
  if (raw < WATCH_BELOW) return "watch";
  return "fine";
}

export interface Priority {
  concern: Concern;
  label: string;
  raw: number;
  ui: number;
  severity: Severity;
  topical: boolean;
  /** Worst sub-region when YouCam reports regions (e.g. pores on the nose). */
  worstRegion?: { name: string; raw: number };
}

export function prioritize(scan: SkinScan): Priority[] {
  const out: Priority[] = [];
  for (const [key, s] of Object.entries(scan.concerns)) {
    const concern = key as Concern;
    if (!s) continue;
    let worstRegion: Priority["worstRegion"];
    if (s.regions) {
      const [name, r] = Object.entries(s.regions).sort((a, b) => a[1].raw - b[1].raw)[0] ?? [];
      if (name && r && r.raw < s.raw) worstRegion = { name, raw: r.raw };
    }
    const decisive = worstRegion ? Math.min(s.raw, worstRegion.raw + 5) : s.raw;
    out.push({
      concern,
      label: CONCERN_LABEL[concern],
      raw: s.raw,
      ui: s.ui,
      severity: severityOf(decisive),
      topical: !NOT_TOPICAL.includes(concern),
      worstRegion,
    });
  }
  return out.sort((a, b) => a.raw - b.raw);
}

export function concernsAt(priorities: Priority[], ...levels: Severity[]): Concern[] {
  return priorities.filter((p) => p.topical && levels.includes(p.severity)).map((p) => p.concern);
}

export function severityMap(scan: SkinScan): Partial<Record<Concern, Severity>> {
  const m: Partial<Record<Concern, Severity>> = {};
  for (const p of prioritize(scan)) m[p.concern] = p.severity;
  return m;
}
