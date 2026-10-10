// 남긴 제품과 살 제품으로 아침·저녁 순서와 격일 야간 스케줄을 만들고, 같은 세션 충돌이 없는지 검사한다
import { mustProduct, type Category, type Product } from "../catalog/products";
import { isAcid, sessionConflicts, type Conflict } from "./conflicts";

export const NIGHTS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type Night = (typeof NIGHTS)[number];

export interface RoutineStep {
  productId: string;
  /** Only for night actives that rotate. Absent = every session. */
  nights?: Night[];
}

export interface Routine {
  am: RoutineStep[];
  pm: RoutineStep[];
  notes: string[];
}

const ORDER: Category[] = ["cleanser", "toner", "exfoliant", "serum", "treatment", "eye", "moisturizer", "sunscreen"];
const RETINOID_NIGHTS: Night[] = ["Mon", "Wed", "Fri"];
const ACID_NIGHTS: Night[] = ["Tue", "Sat"];

function rank(p: Product) {
  // Retinoids sit with serums; vitamin C goes first among AM serums.
  const base = ORDER.indexOf(p.category) * 10;
  return base + (p.actives.includes("vitamin_c") ? -1 : 0);
}

export function buildRoutine(productIds: string[]): Routine {
  const products = [...new Set(productIds)].map(mustProduct);
  const am = products.filter((p) => p.time !== "pm" && p.category !== "exfoliant").sort((a, b) => rank(a) - rank(b));
  const pm = products.filter((p) => p.time !== "am" && p.category !== "sunscreen").sort((a, b) => rank(a) - rank(b));
  const notes: string[] = [];
  const retinoids = pm.filter((p) => p.actives.includes("retinoid"));
  const acids = pm.filter(isAcid);
  const pmSteps: RoutineStep[] = pm.map((p) => {
    if (retinoids.length && acids.length) {
      if (p.actives.includes("retinoid")) return { productId: p.id, nights: RETINOID_NIGHTS };
      if (isAcid(p)) return { productId: p.id, nights: ACID_NIGHTS };
    } else if (retinoids.includes(p)) {
      return { productId: p.id, nights: [...RETINOID_NIGHTS] };
    }
    return { productId: p.id };
  });
  if (retinoids.length) notes.push("Start the retinoid three nights a week; Thursday and Sunday are recovery nights.");
  if (retinoids.length && acids.length) notes.push("Acid nights are Tuesday and Saturday, never the same night as the retinoid.");
  if (am.some((p) => p.category === "sunscreen")) notes.push("Sunscreen is the last morning step, two finger-lengths for face and neck.");
  return { am: am.map((p) => ({ productId: p.id })), pm: pmSteps, notes };
}

/** Conflicts that remain when every step is expanded night by night. */
export function routineConflicts(r: Routine): Conflict[] {
  const out: Conflict[] = [];
  out.push(...sessionConflicts(r.am.map((s) => mustProduct(s.productId))));
  for (const night of NIGHTS) {
    const tonight = r.pm.filter((s) => !s.nights || s.nights.includes(night)).map((s) => mustProduct(s.productId));
    for (const c of sessionConflicts(tonight)) {
      if (!out.some((o) => o.kind === c.kind && o.productIds.join() === c.productIds.join())) out.push(c);
    }
  }
  return out;
}
