// 같은 시간대에 함께 쓰면 안 되는 성분 조합과 선반 수준의 위험(과각질·향료·임신 중 레티노이드 등)을 찾는다
import type { Profile } from "../domain/types";
import type { Active, Product } from "../catalog/products";
import type { Severity } from "./analysis";
import type { Concern } from "../domain/types";

export type ConflictKind =
  | "retinoid_with_acid"
  | "retinoid_with_benzoyl_peroxide"
  | "stacked_exfoliants"
  | "over_exfoliation"
  | "fragrance_on_reactive_skin"
  | "occlusive_on_breakouts"
  | "duplicate_active"
  | "retinoid_in_pregnancy"
  | "missing_sunscreen";

export interface Conflict {
  kind: ConflictKind;
  productIds: string[];
  severity: "high" | "medium" | "low";
  message: string;
  fix: string;
}

const ACIDS: Active[] = ["aha", "bha"];
/** Actives where doubling up adds irritation or cost but no benefit. */
export const DUPLICATE_ACTIVES: Active[] = [
  "retinoid",
  "aha",
  "bha",
  "niacinamide",
  "vitamin_c",
  "azelaic_acid",
  "tranexamic_acid",
  "benzoyl_peroxide",
];
const DUPLICATE_CATEGORIES = ["toner", "exfoliant", "serum", "treatment"];
const has = (p: Product, a: Active) => p.actives.includes(a);
const isAcid = (p: Product) => ACIDS.some((a) => has(p, a)) && (p.category === "exfoliant" || p.irritation >= 2);
const flagged = (s: Severity | undefined) => s === "act" || s === "watch";
const isStrongActive = (p: Product) => has(p, "retinoid") || isAcid(p) || has(p, "benzoyl_peroxide");

/** Conflicts between products applied in the same session (same morning or same night). */
export function sessionConflicts(products: Product[]): Conflict[] {
  const out: Conflict[] = [];
  const retinoids = products.filter((p) => has(p, "retinoid"));
  const acids = products.filter(isAcid);
  const bp = products.filter((p) => has(p, "benzoyl_peroxide"));
  if (retinoids.length && acids.length) {
    out.push({
      kind: "retinoid_with_acid",
      productIds: [...retinoids, ...acids].map((p) => p.id),
      severity: "high",
      message: "A retinoid and an exfoliating acid in the same night multiplies irritation and barrier damage.",
      fix: "Use them on alternate nights.",
    });
  }
  if (retinoids.length && bp.length) {
    out.push({
      kind: "retinoid_with_benzoyl_peroxide",
      productIds: [...retinoids, ...bp].map((p) => p.id),
      severity: "medium",
      message: "Benzoyl peroxide can degrade many retinoids and both are drying.",
      fix: "Benzoyl peroxide in the morning, retinoid at night.",
    });
  }
  if (acids.length >= 2) {
    out.push({
      kind: "stacked_exfoliants",
      productIds: acids.map((p) => p.id),
      severity: "high",
      message: "Two exfoliating acids in one session is over-exfoliation.",
      fix: "Keep one acid; drop or alternate the other.",
    });
  }
  return out;
}

export interface ShelfContext {
  severity: Partial<Record<Concern, Severity>>;
  profile: Profile;
}

/** Risks that exist across the whole shelf regardless of scheduling. */
export function shelfRisks(products: Product[], ctx: ShelfContext): Conflict[] {
  const out: Conflict[] = [];
  const reactive = ctx.severity.redness === "act" || ctx.severity.moisture === "act";
  const strong = products.filter(isStrongActive);
  if (reactive && strong.length >= 3) {
    out.push({
      kind: "over_exfoliation",
      productIds: strong.map((p) => p.id),
      severity: "high",
      message: `${strong.length} strong actives on skin that already shows ${ctx.severity.redness === "act" ? "redness" : "dehydration"}.`,
      fix: "Pause the harshest active until redness and hydration recover.",
    });
  }
  const fragranced = products.filter((p) => has(p, "fragrance"));
  if (fragranced.length && (flagged(ctx.severity.redness) || ctx.profile.fragranceSensitive)) {
    out.push({
      kind: "fragrance_on_reactive_skin",
      productIds: fragranced.map((p) => p.id),
      severity: ctx.severity.redness === "act" || ctx.profile.fragranceSensitive ? "high" : "low",
      message: "Added fragrance is a common irritant for skin that shows redness.",
      fix: "Swap for a fragrance-free equivalent.",
    });
  }
  const occlusives = products.filter((p) => p.occlusive && p.category !== "eye");
  if (occlusives.length && (ctx.severity.acne === "act" || ctx.severity.oiliness === "act")) {
    out.push({
      kind: "occlusive_on_breakouts",
      productIds: occlusives.map((p) => p.id),
      severity: "medium",
      message: "Heavy occlusive creams can make breakout-prone, oily skin worse.",
      fix: "Use a light gel moisturizer while breakouts are active.",
    });
  }
  const byActive = new Map<string, Product[]>();
  for (const p of products) {
    if (!DUPLICATE_CATEGORIES.includes(p.category)) continue;
    for (const a of p.actives.filter((x) => DUPLICATE_ACTIVES.includes(x))) {
      byActive.set(a, [...(byActive.get(a) ?? []), p]);
    }
  }
  for (const [active, ps] of byActive) {
    if (ps.length >= 2) {
      out.push({
        kind: "duplicate_active",
        productIds: ps.map((p) => p.id),
        severity: "low",
        message: `${ps.length} products deliver the same active (${active.replace(/_/g, " ")}).`,
        fix: "Keep the one that also covers your other flagged concerns.",
      });
    }
  }
  if (ctx.profile.pregnantOrNursing) {
    const r = products.filter((p) => has(p, "retinoid"));
    if (r.length) {
      out.push({
        kind: "retinoid_in_pregnancy",
        productIds: r.map((p) => p.id),
        severity: "high",
        message: "Retinoids are generally avoided during pregnancy and breastfeeding.",
        fix: "Pause it and ask your clinician; azelaic acid is a common alternative.",
      });
    }
  }
  const photosensitizing = products.filter((p) => has(p, "retinoid") || isAcid(p));
  if (!products.some((p) => p.category === "sunscreen") && (photosensitizing.length || flagged(ctx.severity.age_spot))) {
    out.push({
      kind: "missing_sunscreen",
      productIds: photosensitizing.map((p) => p.id),
      severity: photosensitizing.length ? "high" : "medium",
      message: photosensitizing.length
        ? "Retinoids and acids make skin more sun-sensitive, and there is no sunscreen on the shelf."
        : "Dark spots will not fade without daily sunscreen.",
      fix: "Add a daily SPF 30+ in the morning.",
    });
  }
  return out;
}

export { isAcid, isStrongActive };
