// 에이전트가 제출하는 계획(Plan)의 스키마와, 카탈로그·스캔·충돌 규칙에 비춘 결정론 검증기
import { z } from "zod";
import { CONCERNS, type ScenarioInput } from "../domain/types";
import { getProduct, isSkincare, mustProduct } from "../catalog/products";
import { NIGHTS, routineConflicts, type Routine } from "../rules/routine";
import { matchFoundation } from "../rules/color";
import { MAX_PREVIEW_INTENSITY } from "../rules/progress";
import { SIMULATION_KEY } from "../youcam/requests";

const concern = z.enum(CONCERNS);

export const PlanSchema = z.object({
  headline: z.string().min(3).max(140),
  summary: z.string().min(10).max(900),
  verdicts: z.array(
    z.object({
      product_id: z.string(),
      action: z.enum(["keep", "alternate", "pause", "drop"]),
      reason: z.string().min(3).max(400),
      evidence: z.array(concern),
    }),
  ),
  cart: z.array(
    z.object({ product_id: z.string(), decision: z.enum(["buy", "skip", "wait"]), reason: z.string().min(3).max(400) }),
  ),
  buy: z
    .array(z.object({ product_id: z.string(), reason: z.string().min(3).max(400), evidence: z.array(concern) }))
    .max(2),
  skip: z.array(z.object({ label: z.string().min(2).max(80), reason: z.string().min(3).max(300) })).max(4),
  routine: z.object({
    am: z.array(z.object({ product_id: z.string() })),
    pm: z.array(z.object({ product_id: z.string(), nights: z.array(z.enum(NIGHTS)) })),
    notes: z.array(z.string().max(300)).max(5),
  }),
  look: z.object({
    foundation_id: z.string(),
    everyday_lip_id: z.string(),
    statement_lip_id: z.string(),
    blush_id: z.string(),
    note: z.string().max(300),
  }),
  preview: z.object({
    horizon_weeks: z.number().int().min(2).max(16),
    concerns: z.array(z.object({ concern, intensity: z.number().min(0).max(1) })).min(1).max(4),
  }),
  checkin: z.object({
    after_weeks: z.number().int().min(2).max(16),
    watch: z.array(concern).min(1).max(4),
    note: z.string().max(300),
  }),
  caveats: z.array(z.string().max(300)).max(4),
});

export type Plan = z.infer<typeof PlanSchema>;

/** Plain JSON Schema for the submit_plan tool, generated from the same zod schema. */
export const PLAN_JSON_SCHEMA = z.toJSONSchema(PlanSchema) as Record<string, unknown>;

export function toRoutine(plan: Plan): Routine {
  return {
    am: plan.routine.am.map((s) => ({ productId: s.product_id })),
    pm: plan.routine.pm.map((s) => ({ productId: s.product_id, nights: s.nights.length ? s.nights : undefined })),
    notes: plan.routine.notes,
  };
}

/**
 * Hard rules the plan must satisfy no matter who wrote it (Claude or the offline planner).
 * Returns human-readable issues; an empty list means the plan is accepted.
 */
export function validatePlan(plan: Plan, input: ScenarioInput): string[] {
  const issues: string[] = [];
  const shelfIds = input.shelf.map((s) => s.productId);
  const scanned = new Set(Object.keys(input.scan.concerns));
  const known = (id: string, where: string) => {
    if (!getProduct(id)) issues.push(`${where}: unknown product_id "${id}".`);
    return !!getProduct(id);
  };

  // Verdicts: exactly one per shelf item.
  const verdictIds = plan.verdicts.map((v) => v.product_id);
  for (const id of shelfIds) if (!verdictIds.includes(id)) issues.push(`verdicts: missing a verdict for shelf item "${id}".`);
  for (const id of verdictIds) {
    if (!shelfIds.includes(id)) issues.push(`verdicts: "${id}" is not on the user's shelf.`);
    if (verdictIds.filter((x) => x === id).length > 1) issues.push(`verdicts: "${id}" appears more than once.`);
  }
  for (const v of plan.verdicts) {
    for (const c of v.evidence) if (!scanned.has(c)) issues.push(`verdicts: evidence "${c}" is not in the scan.`);
  }

  // Cart: one decision per cart item.
  for (const id of input.cart ?? []) {
    if (!plan.cart.some((c) => c.product_id === id)) issues.push(`cart: missing a decision for cart item "${id}".`);
  }
  for (const c of plan.cart) {
    if (!(input.cart ?? []).includes(c.product_id)) issues.push(`cart: "${c.product_id}" is not in the user's cart.`);
  }

  // Purchases: new skincare only, within budget.
  const buyIds = plan.buy.map((b) => b.product_id);
  const cartBuys = plan.cart.filter((c) => c.decision === "buy").map((c) => c.product_id);
  for (const id of buyIds) {
    if (!known(id, "buy")) continue;
    if (shelfIds.includes(id)) issues.push(`buy: "${id}" is already on the shelf.`);
    if (!isSkincare(mustProduct(id))) issues.push(`buy: "${id}" is makeup; the look section covers makeup.`);
  }
  for (const b of plan.buy) for (const c of b.evidence) if (!scanned.has(c)) issues.push(`buy: evidence "${c}" is not in the scan.`);
  const spend = [...new Set([...buyIds, ...cartBuys])].reduce((s, id) => s + (getProduct(id)?.priceUsd ?? 0), 0);
  if (input.profile.budgetUsd !== undefined && spend > input.profile.budgetUsd) {
    issues.push(`buy: total $${spend} exceeds the user's budget of $${input.profile.budgetUsd}.`);
  }
  if (new Set([...buyIds, ...cartBuys]).size > 2) issues.push("buy: at most two new products in total (including cart buys).");

  // Routine: exactly the kept shelf products plus purchases, conflict-free.
  const active = new Set([
    ...plan.verdicts.filter((v) => v.action === "keep" || v.action === "alternate").map((v) => v.product_id),
    ...buyIds,
    ...cartBuys,
  ]);
  const inRoutine = new Set([...plan.routine.am, ...plan.routine.pm].map((s) => s.product_id));
  for (const id of inRoutine) {
    if (!known(id, "routine")) continue;
    if (!active.has(id)) issues.push(`routine: "${id}" is used but was not kept or bought.`);
  }
  for (const id of active) {
    const p = getProduct(id);
    if (p && isSkincare(p) && !inRoutine.has(id)) issues.push(`routine: kept/bought product "${id}" has no routine step.`);
  }
  for (const s of plan.routine.am) {
    const p = getProduct(s.product_id);
    if (p?.time === "pm") issues.push(`routine: "${s.product_id}" is a night-only product but is in the morning.`);
  }
  for (const s of plan.routine.pm) {
    const p = getProduct(s.product_id);
    if (p?.time === "am") issues.push(`routine: "${s.product_id}" is a morning-only product but is at night.`);
  }
  if ([...inRoutine].every((id) => getProduct(id))) {
    for (const c of routineConflicts(toRoutine(plan))) issues.push(`routine conflict: ${c.message} (${c.productIds.join(", ")}). Fix: ${c.fix}`);
    const products = [...inRoutine].map(mustProduct);
    const photosensitizing = products.some((p) => p.actives.includes("retinoid") || p.actives.includes("aha") || p.actives.includes("bha"));
    const amSpf = plan.routine.am.some((s) => mustProduct(s.product_id).category === "sunscreen");
    if (photosensitizing && !amSpf) issues.push("routine: retinoids or acids are used but there is no morning sunscreen.");
    if (input.profile.pregnantOrNursing && products.some((p) => p.actives.includes("retinoid"))) {
      issues.push("routine: the user is pregnant or nursing; no retinoids.");
    }
  }

  // Look: shades must come from the matcher when we know the skin tone.
  const tone = input.scan.tone;
  const cat = (id: string, c: string, where: string) => {
    if (known(id, where) && mustProduct(id).category !== c) issues.push(`${where}: "${id}" is not a ${c}.`);
  };
  cat(plan.look.foundation_id, "foundation", "look.foundation_id");
  cat(plan.look.everyday_lip_id, "lip", "look.everyday_lip_id");
  cat(plan.look.statement_lip_id, "lip", "look.statement_lip_id");
  cat(plan.look.blush_id, "blush", "look.blush_id");
  if (tone) {
    const top = matchFoundation(tone.skinHex).map((m) => m.productId);
    if (!top.includes(plan.look.foundation_id)) issues.push(`look: foundation must be one of the matched shades ${top.join(", ")}.`);
  }

  // Preview: honest intensities, only for concerns the routine treats.
  for (const p of plan.preview.concerns) {
    if (p.intensity > MAX_PREVIEW_INTENSITY) issues.push(`preview: intensity ${p.intensity} for ${p.concern} is above the honest cap of ${MAX_PREVIEW_INTENSITY}.`);
    if (!SIMULATION_KEY[p.concern]) issues.push(`preview: ${p.concern} cannot be simulated.`);
    const treated = [...inRoutine].some((id) => getProduct(id)?.targets.includes(p.concern));
    if (!treated) issues.push(`preview: nothing in the routine treats ${p.concern}.`);
  }
  for (const c of plan.checkin.watch) if (!scanned.has(c)) issues.push(`checkin: "${c}" is not in the scan.`);
  return issues;
}
