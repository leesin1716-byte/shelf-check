// 「효과가 나면 이 정도」 시뮬레이션 강도(보수 상한)와 재스캔 비교로 제품별 효과를 판정한다
import type { Concern, ShelfItem, SkinScan } from "../domain/types";
import { mustProduct } from "../catalog/products";
import { SIMULATION_KEY } from "../youcam/requests";

/** Skin Simulation is a preview of a realistic outcome, not a promise: we never exceed this intensity. */
export const MAX_PREVIEW_INTENSITY = 0.5;

export interface PreviewSetting {
  concern: Concern;
  intensity: number;
}

/**
 * Intensity grows with how long the routine has been followed relative to how long the
 * product usually takes, capped at MAX_PREVIEW_INTENSITY.
 */
export function previewSettings(productIds: string[], concerns: Concern[], horizonWeeks: number): PreviewSetting[] {
  const out: PreviewSetting[] = [];
  for (const concern of concerns) {
    if (!SIMULATION_KEY[concern]) continue;
    const treating = productIds.map(mustProduct).filter((p) => p.targets.includes(concern));
    if (!treating.length) continue;
    const fastest = Math.min(...treating.map((p) => p.weeksToSee ?? 8));
    const intensity = Math.min(MAX_PREVIEW_INTENSITY, Math.max(0.15, MAX_PREVIEW_INTENSITY * Math.min(1, horizonWeeks / fastest)));
    out.push({ concern, intensity: Math.round(intensity * 100) / 100 });
  }
  return out.slice(0, 4); // 1-4 concerns cost 4 units; keep previews cheap.
}

/** Repeat scans move a few points with light and angle alone. Changes inside this band are noise. */
export const NOISE_BAND = 4;

export type ProductProgress = "working" | "too_early" | "no_change_yet" | "not_working" | "irritating";

export interface ConcernDelta {
  concern: Concern;
  before: number;
  after: number;
  delta: number;
}

export interface ProgressReport {
  weeksBetween: number;
  deltas: ConcernDelta[];
  products: { productId: string; weeksIn: number; verdict: ProductProgress; why: string; evidence: ConcernDelta[] }[];
}

const WEEK_MS = 7 * 24 * 3600 * 1000;

export function compareScans(before: SkinScan, after: SkinScan, shelf: ShelfItem[]): ProgressReport {
  const deltas: ConcernDelta[] = [];
  for (const [k, a] of Object.entries(after.concerns)) {
    const b = before.concerns[k as Concern];
    if (!a || !b) continue;
    deltas.push({ concern: k as Concern, before: b.raw, after: a.raw, delta: Math.round((a.raw - b.raw) * 10) / 10 });
  }
  const weeksBetween = round1((Date.parse(after.capturedAt) - Date.parse(before.capturedAt)) / WEEK_MS);
  const redness = deltas.find((d) => d.concern === "redness");
  // Only products started around or after the first scan have a baseline to compare against.
  const baselineFrom = Date.parse(before.capturedAt) - WEEK_MS;
  const products = shelf
    .filter((s) => s.startedAt && Date.parse(s.startedAt) >= baselineFrom)
    .map((s) => {
      const p = mustProduct(s.productId);
      const weeksIn = round1((Date.parse(after.capturedAt) - Date.parse(s.startedAt!)) / WEEK_MS);
      const evidence = deltas.filter((d) => p.targets.includes(d.concern));
      const mean = evidence.length ? evidence.reduce((x, d) => x + d.delta, 0) / evidence.length : 0;
      const best = evidence.reduce<ConcernDelta | undefined>((m, d) => (!m || d.delta > m.delta ? d : m), undefined);
      const need = p.weeksToSee ?? 8;
      let verdict: ProductProgress;
      let why: string;
      if (p.irritation >= 2 && redness && redness.delta <= -NOISE_BAND) {
        verdict = "irritating";
        why = `Redness got worse by ${Math.abs(redness.delta)} points since you started it${
          best && best.delta >= NOISE_BAND ? `, even though ${best.concern.replace(/_/g, " ")} improved ${best.delta}` : ""
        }.`;
      } else if (weeksIn < need / 2) {
        verdict = "too_early";
        why = `${weeksIn} weeks in; this kind of product usually needs about ${need}.`;
      } else if (best && best.delta >= NOISE_BAND) {
        verdict = "working";
        why = `${best.concern.replace(/_/g, " ")} improved ${best.delta} points (beyond the ±${NOISE_BAND} noise band).`;
      } else if (mean <= -NOISE_BAND) {
        verdict = "not_working";
        why = "Its target concerns got worse beyond the noise band.";
      } else if (weeksIn < need) {
        verdict = "no_change_yet";
        why = `No change beyond noise yet at ${weeksIn} of about ${need} weeks.`;
      } else {
        verdict = "not_working";
        why = `No change beyond noise after ${weeksIn} weeks; it has had a fair trial.`;
      }
      return { productId: p.id, weeksIn, verdict, why, evidence };
    });
  return { weeksBetween, deltas: deltas.sort((a, b) => b.delta - a.delta), products };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
