// 사용자가 이미 가진 제품마다 계속·격일·일시중지·정리 판정을 내리고 그 근거(스캔 고민·충돌)를 붙인다
import type { Concern, Profile, ShelfItem, SkinScan } from "../domain/types";
import { mustProduct, type Product } from "../catalog/products";
import { concernsAt, prioritize, severityMap, type Severity } from "./analysis";
import { isAcid, sessionConflicts, shelfRisks, type Conflict } from "./conflicts";

export type ShelfAction = "keep" | "alternate" | "pause" | "drop";

export interface ShelfVerdict {
  productId: string;
  action: ShelfAction;
  reason: string;
  /** Flagged concerns this product addresses. */
  evidence: Concern[];
}

export interface ShelfAudit {
  verdicts: ShelfVerdict[];
  conflicts: Conflict[];
  flagged: Concern[];
}

const FOUNDATIONAL = new Set(["cleanser", "moisturizer", "sunscreen"]);

export function auditShelf(scan: SkinScan, shelf: ShelfItem[], profile: Profile): ShelfAudit {
  const priorities = prioritize(scan);
  const severity = severityMap(scan);
  const flagged = concernsAt(priorities, "act", "watch");
  const products = shelf.map((s) => mustProduct(s.productId));
  const risks = shelfRisks(products, { severity, profile });
  const verdicts = new Map<string, ShelfVerdict>();
  const relevance = (p: Product) => p.targets.filter((t) => flagged.includes(t));
  const rank: Record<ShelfAction, number> = { keep: 0, alternate: 1, drop: 2, pause: 3 };
  const set = (p: Product, action: ShelfAction, reason: string) => {
    const prev = verdicts.get(p.id);
    if (!prev || prev.action === "keep") {
      verdicts.set(p.id, { productId: p.id, action, reason, evidence: relevance(p) });
      return;
    }
    // Several findings on one product: keep the strongest action and every reason.
    if (prev.reason.includes(reason)) return;
    verdicts.set(p.id, {
      ...prev,
      action: rank[action] > rank[prev.action] ? action : prev.action,
      reason: `${prev.reason} ${reason}`,
    });
  };

  for (const p of products) {
    const rel = relevance(p);
    if (rel.length) set(p, "keep", `Targets ${rel.map(humanize).join(", ")}, which your scan flags.`);
    else if (FOUNDATIONAL.has(p.category)) set(p, "keep", "A basic every routine needs.");
    else set(p, "drop", "Nothing it targets is flagged on your scan, so it is spend without a job.");
  }

  for (const risk of risks) {
    const involved = risk.productIds.map(mustProduct);
    switch (risk.kind) {
      case "retinoid_in_pregnancy":
        involved.forEach((p) => set(p, "pause", risk.message + " " + risk.fix));
        break;
      case "over_exfoliation": {
        // Pause the harshest, least relevant strong active.
        const victim = [...involved].sort(
          (a, b) => b.irritation - a.irritation || relevance(a).length - relevance(b).length,
        )[0];
        set(victim, "pause", `${risk.message} ${risk.fix}`);
        break;
      }
      case "fragrance_on_reactive_skin":
        if (risk.severity !== "low") involved.forEach((p) => set(p, "drop", `${risk.message} ${risk.fix}`));
        break;
      case "occlusive_on_breakouts":
        involved.forEach((p) => set(p, "pause", `${risk.message} ${risk.fix}`));
        break;
      case "duplicate_active": {
        const ranked = [...involved].sort(
          (a, b) => relevance(b).length - relevance(a).length || a.irritation - b.irritation || a.priceUsd - b.priceUsd,
        );
        ranked.slice(1).forEach((p) =>
          set(p, "drop", `Same main active as ${ranked[0].brand} ${ranked[0].name}; one is enough.`),
        );
        break;
      }
    }
  }

  // Whatever is still active at night: a retinoid and an acid can coexist only on alternate nights.
  const activeAtNight = products.filter((p) => {
    const v = verdicts.get(p.id)!;
    return (v.action === "keep" || v.action === "alternate") && p.time !== "am";
  });
  for (const c of sessionConflicts(activeAtNight)) {
    if (c.kind === "retinoid_with_acid") {
      c.productIds.map(mustProduct).forEach((p) => {
        if (verdicts.get(p.id)!.action === "keep") {
          set(p, "alternate", `${c.message} ${c.fix}`);
        }
      });
    }
    if (c.kind === "stacked_exfoliants") {
      const acids = c.productIds.map(mustProduct).filter(isAcid).sort((a, b) => b.irritation - a.irritation);
      acids.slice(0, -1).forEach((p) => set(p, "pause", `${c.message} ${c.fix}`));
    }
  }

  return { verdicts: products.map((p) => verdicts.get(p.id)!), conflicts: risks, flagged };
}

export function activeAfterAudit(audit: ShelfAudit): string[] {
  return audit.verdicts.filter((v) => v.action === "keep" || v.action === "alternate").map((v) => v.productId);
}

function humanize(c: Concern) {
  return c.replace(/_/g, " ");
}

export type { Severity };
