// 판정 뒤 남은 선반이 못 덮는 고민(갭)을 찾고, 충돌 없는 최소 구매안과 「고민마다 하나씩 파는」 순진한 장바구니를 계산한다
import { CONCERN_LABEL, type Concern, type Profile, type SkinScan } from "../domain/types";
import { PRODUCTS, getProduct, isSkincare, mustProduct, type Category, type Product } from "../catalog/products";
import { concernsAt, prioritize, severityMap } from "./analysis";
import { DUPLICATE_ACTIVES, sessionConflicts, shelfRisks } from "./conflicts";

export type Gap =
  | { kind: "concern"; concern: Concern; undertreated?: boolean }
  | { kind: "basic"; category: Category; why: string };

const WEEK_MS = 7 * 24 * 3600 * 1000;

/**
 * Gaps the remaining shelf leaves open. A flagged concern counts as a gap when nothing treats it,
 * or when everything that treats it has already had its full trial period without lifting it out of "act".
 */
export function findGaps(
  scan: SkinScan,
  activeIds: string[],
  profile: Profile,
  startedAt: Record<string, string | undefined> = {},
): Gap[] {
  const active = activeIds.map(mustProduct);
  const severity = severityMap(scan);
  const gaps: Gap[] = [];
  const risks = shelfRisks(active, { severity, profile });
  if (risks.some((r) => r.kind === "missing_sunscreen")) {
    gaps.push({ kind: "basic", category: "sunscreen", why: risks.find((r) => r.kind === "missing_sunscreen")!.message });
  }
  if (!active.some((p) => p.category === "moisturizer")) {
    gaps.push({ kind: "basic", category: "moisturizer", why: "No moisturizer is left on the routine." });
  }
  if (!active.some((p) => p.category === "cleanser")) {
    gaps.push({ kind: "basic", category: "cleanser", why: "No cleanser on the shelf." });
  }
  const now = Date.parse(scan.capturedAt);
  for (const c of concernsAt(prioritize(scan), "act")) {
    const treating = active.filter((p) => p.targets.includes(c));
    if (!treating.length) {
      gaps.push({ kind: "concern", concern: c });
      continue;
    }
    const allTried = treating.every((p) => {
      const since = startedAt[p.id];
      return since !== undefined && (now - Date.parse(since)) / WEEK_MS >= (p.weeksToSee ?? 8);
    });
    if (allTried) gaps.push({ kind: "concern", concern: c, undertreated: true });
  }
  return gaps;
}

export interface SearchQuery {
  concern?: Concern;
  category?: Category;
  maxPriceUsd?: number;
}

/** Catalog search that already respects the user's shelf, scan and profile. */
export function searchCatalog(
  q: SearchQuery,
  ctx: { scan: SkinScan; activeIds: string[]; profile: Profile; excludeIds?: string[] },
): { product: Product; covers: Concern[]; conflictsWithShelf: string[] }[] {
  const severity = severityMap(ctx.scan);
  const flagged = concernsAt(prioritize(ctx.scan), "act", "watch");
  const reactive = severity.redness === "act" || severity.moisture === "act";
  const active = ctx.activeIds.map(mustProduct);
  const exclude = new Set([...(ctx.excludeIds ?? []), ...ctx.activeIds]);
  const oilyOrBreakout = severity.acne === "act" || severity.oiliness === "act";
  return PRODUCTS.filter(isSkincare)
    .filter((p) => !exclude.has(p.id))
    .filter((p) => (q.concern ? p.targets.includes(q.concern) : true))
    .filter((p) => (q.category ? p.category === q.category : true))
    .filter((p) => (q.maxPriceUsd ? p.priceUsd <= q.maxPriceUsd : true))
    .filter((p) => !(ctx.profile.pregnantOrNursing && p.actives.includes("retinoid")))
    .filter((p) => !p.actives.includes("fragrance") || !(ctx.profile.fragranceSensitive || severity.redness !== "fine"))
    .filter((p) => !(reactive && p.irritation >= 2))
    .filter((p) => !(oilyOrBreakout && p.occlusive))
    .map((p) => {
      const sameSession = active.filter((a) => a.time === p.time || a.time === "both" || p.time === "both");
      const conflicts = sessionConflicts([...sameSession, p])
        .filter((c) => c.productIds.includes(p.id))
        .flatMap((c) => c.productIds.filter((id) => id !== p.id));
      return { product: p, covers: p.targets.filter((t) => flagged.includes(t)), conflictsWithShelf: [...new Set(conflicts)] };
    })
    .sort(
      (a, b) =>
        a.conflictsWithShelf.length - b.conflictsWithShelf.length ||
        b.covers.length - a.covers.length ||
        a.product.irritation - b.product.irritation ||
        a.product.priceUsd - b.product.priceUsd,
    );
}

export interface BuyPick {
  productId: string;
  fills: string;
  covers: Concern[];
}

/** The smallest purchase that closes the gaps: basics first, then at most one product for flagged concerns. */
export function minimalBuy(
  scanIn: SkinScan,
  activeIds: string[],
  profile: Profile,
  startedAt: Record<string, string | undefined> = {},
  maxItems = 2,
): BuyPick[] {
  const gaps = findGaps(scanIn, activeIds, profile, startedAt);
  const picks: BuyPick[] = [];
  const taken = [...activeIds];
  const budget = profile.budgetUsd ?? Infinity;
  let spent = 0;
  const concernGaps = gaps.filter((g): g is Extract<Gap, { kind: "concern" }> => g.kind === "concern").map((g) => g.concern);
  for (const g of gaps.filter((g): g is Extract<Gap, { kind: "basic" }> => g.kind === "basic")) {
    const hit = searchCatalog({ category: g.category }, { scan: scanIn, activeIds: taken, profile })
      .filter((r) => r.conflictsWithShelf.length === 0)
      .sort((a, b) => coverScore(b.covers, concernGaps) - coverScore(a.covers, concernGaps))[0];
    if (hit && picks.length < maxItems && spent + hit.product.priceUsd <= budget) {
      picks.push({ productId: hit.product.id, fills: g.why, covers: hit.covers });
      taken.push(hit.product.id);
      spent += hit.product.priceUsd;
    }
  }
  const undertreated = new Set(
    gaps.filter((g) => g.kind === "concern" && g.undertreated).map((g) => (g as { concern: Concern }).concern),
  );
  const coveredByNewPicks = new Set(picks.map((p) => mustProduct(p.productId)).flatMap((p) => p.targets));
  const coveredNow = new Set(activeIds.map(mustProduct).flatMap((p) => p.targets));
  const remaining = concernGaps.filter(
    (c) => !coveredByNewPicks.has(c) && (!coveredNow.has(c) || undertreated.has(c)),
  );
  if (remaining.length && picks.length < maxItems) {
    const best = searchCatalog({}, { scan: scanIn, activeIds: taken, profile })
      .filter((r) => r.conflictsWithShelf.length === 0 && !["sunscreen", "cleanser"].includes(r.product.category))
      .map((r) => ({ r, hits: r.product.targets.filter((t) => remaining.includes(t)).length }))
      .filter((x) => x.hits > 0 && spent + x.r.product.priceUsd <= budget)
      .sort(
        (a, b) =>
          b.hits - a.hits ||
          preferred(b.r.product, remaining) - preferred(a.r.product, remaining) ||
          b.r.covers.length - a.r.covers.length ||
          a.r.product.irritation - b.r.product.irritation ||
          a.r.product.priceUsd - b.r.product.priceUsd,
      )[0];
    if (best) {
      picks.push({
        productId: best.r.product.id,
        fills: (() => {
          const hit = best.r.product.targets.filter((t) => remaining.includes(t));
          const label = hit.map((t) => CONCERN_LABEL[t]).join(", ");
          return hit.every((t) => undertreated.has(t))
            ? `${label} is still flagged after a full trial of what you use for it; this changes the approach.`
            : `Covers ${label.toLowerCase()}, which nothing on your shelf treats.`;
        })(),
        covers: best.r.covers,
      });
    }
  }
  return picks;
}

/** Dehydration is fixed by the moisturizer step, not by stacking another serum. */
const PREFERRED_CATEGORY: Partial<Record<Concern, Category>> = { moisture: "moisturizer" };

function preferred(p: Product, concerns: Concern[]) {
  return concerns.some((c) => PREFERRED_CATEGORY[c] === p.category) ? 1 : 0;
}

function coverScore(covers: Concern[], gaps: Concern[]) {
  return covers.filter((c) => gaps.includes(c)).length * 2 + covers.length;
}

/** What a concern-by-concern recommender would sell: one product per flagged concern, ignoring the shelf. */
export function naiveCart(scanIn: SkinScan): { productIds: string[]; totalUsd: number; conflicts: number } {
  const flagged = concernsAt(prioritize(scanIn), "act", "watch");
  const ids: string[] = [];
  for (const c of flagged) {
    // A "matches your concern" engine: the most-featured product for each concern, one per concern.
    const p = PRODUCTS.filter(isSkincare)
      .filter((x) => x.targets.includes(c) && x.category !== "cleanser" && !ids.includes(x.id))
      .sort((a, b) => b.targets.length - a.targets.length || b.priceUsd - a.priceUsd)[0];
    if (p) ids.push(p.id);
  }
  const products = ids.map(mustProduct);
  const nightly = products.filter((p) => p.time !== "am");
  return {
    productIds: ids,
    totalUsd: products.reduce((s, p) => s + p.priceUsd, 0),
    conflicts: sessionConflicts(nightly).length,
  };
}

export function priceOf(ids: string[]) {
  return ids.reduce((s, id) => s + (getProduct(id)?.priceUsd ?? 0), 0);
}

export type CartDecision = "buy" | "skip" | "wait";

export interface CartVerdict {
  productId: string;
  decision: CartDecision;
  reason: string;
  covers: Concern[];
}

/** Judges items the user is about to buy against their scan and shelf. */
export function evaluateCart(
  cart: string[],
  scanIn: SkinScan,
  activeIds: string[],
  profile: Profile,
  startedAt: Record<string, string | undefined> = {},
): CartVerdict[] {
  const priorities = prioritize(scanIn);
  const act = concernsAt(priorities, "act");
  const watch = concernsAt(priorities, "watch");
  const gaps = findGaps(scanIn, activeIds, profile, startedAt);
  const openConcerns = gaps.flatMap((g) => (g.kind === "concern" ? [g.concern] : []));
  const openBasics = gaps.flatMap((g) => (g.kind === "basic" ? [g.category] : []));
  const active = activeIds.map(mustProduct);
  return cart.map((id) => {
    const p = mustProduct(id);
    const covers = p.targets.filter((t) => act.includes(t) || watch.includes(t));
    const clash = sessionConflicts([...active.filter((a) => a.time === p.time || a.time === "both" || p.time === "both"), p])
      .filter((c) => c.productIds.includes(p.id));
    const sameActive = active.find(
      (a) =>
        !["cleanser", "eye", "moisturizer", "sunscreen"].includes(a.category) &&
        a.actives.some((x) => DUPLICATE_ACTIVES.includes(x) && p.actives.includes(x)),
    );
    if (clash.length) return { productId: id, decision: "skip", reason: `${clash[0].message} ${clash[0].fix}`, covers };
    if (profile.pregnantOrNursing && p.actives.includes("retinoid")) {
      return { productId: id, decision: "skip", reason: "Retinoids are generally avoided during pregnancy and breastfeeding.", covers };
    }
    if (openBasics.includes(p.category) || p.targets.some((t) => openConcerns.includes(t))) {
      return { productId: id, decision: "buy", reason: "It fills a real gap on your shelf.", covers };
    }
    if (sameActive) {
      return {
        productId: id,
        decision: "skip",
        reason: `You already use ${sameActive.brand} ${sameActive.name} for the same active.`,
        covers,
      };
    }
    if (!covers.length) {
      return { productId: id, decision: "skip", reason: "Your scan does not flag anything it targets.", covers };
    }
    const actHits = covers.filter((c) => act.includes(c));
    if (!actHits.length) {
      const worst = priorities.find((x) => x.topical && x.severity === "act");
      return {
        productId: id,
        decision: "wait",
        reason: `It targets ${covers.join(", ").replace(/_/g, " ")}, which are only watch-level${worst ? `; ${worst.label.toLowerCase()} (${worst.raw}) is the bigger lever right now` : ""}.`,
        covers,
      };
    }
    return { productId: id, decision: "buy", reason: `It targets ${actHits.join(", ").replace(/_/g, " ")}.`, covers };
  });
}
