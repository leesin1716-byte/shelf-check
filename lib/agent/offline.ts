// Claude 키가 없을 때 같은 결정론 도구만으로 계획을 조립하는 오프라인 플래너(검증기를 반드시 통과)
import { CONCERN_LABEL, type Concern, type ScenarioInput } from "../domain/types";
import { mustProduct, productLabel } from "../catalog/products";
import { concernsAt, prioritize } from "../rules/analysis";
import { auditShelf, type ShelfVerdict } from "../rules/shelf";
import { evaluateCart, minimalBuy, naiveCart } from "../rules/shopping";
import { buildRoutine } from "../rules/routine";
import { matchFoundation, suggestLook } from "../rules/color";
import { compareScans, previewSettings } from "../rules/progress";
import { isAcid } from "../rules/conflicts";
import type { Plan } from "./plan";

export function offlinePlan(input: ScenarioInput): Plan {
  const { scan, shelf, profile } = input;
  const priorities = prioritize(scan);
  const startedAt = Object.fromEntries(shelf.map((s) => [s.productId, s.startedAt]));
  const audit = auditShelf(scan, shelf, profile);
  const verdicts = new Map<string, ShelfVerdict>(audit.verdicts.map((v) => [v.productId, { ...v }]));

  // Check-in evidence overrides the static audit.
  const progress = input.previousScan ? compareScans(input.previousScan, scan, shelf) : undefined;
  for (const p of progress?.products ?? []) {
    const v = verdicts.get(p.productId)!;
    const product = mustProduct(p.productId);
    if (p.verdict === "working") {
      verdicts.set(p.productId, { ...v, action: v.action === "alternate" ? "alternate" : "keep", reason: `Working: ${p.why}` });
    } else if (p.verdict === "not_working") {
      verdicts.set(p.productId, { ...v, action: "drop", reason: `Not working: ${p.why}` });
    } else if (p.verdict === "irritating") {
      // Keep what is producing results; take away the acid load that stacks on top of it.
      const acids = shelf.map((s) => mustProduct(s.productId)).filter((x) => isAcid(x) && x.id !== product.id);
      for (const a of acids) {
        verdicts.set(a.id, {
          ...verdicts.get(a.id)!,
          action: "pause",
          reason: `${productLabel(product)} is improving your skin but redness rose since you added it. Pausing this acid lowers the irritation load without losing those gains.`,
        });
      }
      verdicts.set(p.productId, { ...v, action: acids.length ? "keep" : "alternate", reason: `Keep, but watch redness: ${p.why}` });
    }
  }

  const activeIds = () => [...verdicts.values()].filter((v) => v.action === "keep" || v.action === "alternate").map((v) => v.productId);
  const cart = evaluateCart(input.cart ?? [], scan, activeIds(), profile, startedAt);
  const cartBuys = cart.filter((c) => c.decision === "buy").map((c) => c.productId);
  const buys = minimalBuy(scan, [...activeIds(), ...cartBuys], profile, startedAt, Math.max(0, 2 - cartBuys.length)).filter(
    (b) => !cartBuys.includes(b.productId),
  );

  // A new moisturizer bought for under-treated dryness replaces the light one that did not work.
  const boughtMoisturizer = buys.find((b) => mustProduct(b.productId).category === "moisturizer");
  if (boughtMoisturizer && concernsAt(priorities, "act").includes("moisture")) {
    for (const id of activeIds()) {
      const p = mustProduct(id);
      if (p.category === "moisturizer" && !p.occlusive) {
        verdicts.set(id, {
          ...verdicts.get(id)!,
          action: "drop",
          reason: `Hydration is still low after a full trial; ${productLabel(mustProduct(boughtMoisturizer.productId))} replaces it.`,
        });
      }
    }
  }

  const routineIds = [...activeIds(), ...cartBuys, ...buys.map((b) => b.productId)];
  const routine = buildRoutine(routineIds);
  if (progress?.products.some((p) => p.verdict === "irritating")) {
    routine.notes.unshift("Redness rose since the last scan: if it stings, drop the retinoid to two nights a week.");
  }

  const tone = scan.tone;
  const foundation = tone ? matchFoundation(tone.skinHex)[0] : undefined;
  const look = suggestLook(tone?.skinHex ?? "#D2A27F", tone?.lipHex);

  const flaggedOrder = priorities.filter((p) => p.topical && p.severity !== "fine").map((p) => p.concern);
  let preview = previewSettings(routineIds, flaggedOrder, 8);
  if (!preview.length) preview = previewSettings(routineIds, priorities.map((p) => p.concern), 8).slice(0, 1);

  const naive = naiveCart(scan);
  const skip = naive.productIds
    .filter((id) => !routineIds.includes(id) && !buys.some((b) => b.productId === id) && !shelf.some((s) => s.productId === id))
    .slice(0, 3)
    .map((id) => {
      const p = mustProduct(id);
      const sameActive = routineIds.map(mustProduct).find((r) => r.actives.some((a) => a !== "fragrance" && p.actives.includes(a)));
      return {
        label: productLabel(p),
        reason: sameActive
            ? `Same job as ${productLabel(sameActive)}, which stays in your routine.`
            : `Targets ${p.targets.filter((t) => flaggedOrder.includes(t)).map((t) => CONCERN_LABEL[t].toLowerCase()).join(", ") || "nothing flagged"}; not the bottleneck right now.`,
      };
    });

  const count = (a: string) => [...verdicts.values()].filter((v) => v.action === a).length;
  const spend = [...cartBuys, ...buys.map((b) => b.productId)].reduce((s, id) => s + mustProduct(id).priceUsd, 0);
  const nBuy = cartBuys.length + buys.length;
  const top = priorities.filter((p) => p.topical && p.severity === "act").slice(0, 2);
  const headline = `Keep ${count("keep") + count("alternate")}, pause ${count("pause")}, drop ${count("drop")}. Buy ${nBuy === 0 ? "nothing" : `${nBuy} ($${spend})`}.`;
  const summaryParts = [
    top.length
      ? `Your scan flags ${top.map((t) => `${t.label.toLowerCase()} (${t.raw})`).join(" and ")} as the ${top.length > 1 ? "priorities" : "priority"}.`
      : "Nothing on your scan is in the act-now range.",
    progress
      ? `Since ${input.previousScan!.capturedAt.slice(0, 10)}: ${progress.products.map((p) => `${productLabel(mustProduct(p.productId))} ${p.verdict.replace(/_/g, " ")}`).join("; ")}.`
      : "",
    nBuy
      ? `The shelf already covers most of it; ${nBuy === 1 ? "one product closes" : "two products close"} the gap.`
      : "The products you own already cover it, so there is nothing to buy.",
    `A concern-by-concern recommender would have sold ${naive.productIds.length} products for $${naive.totalUsd}.`,
  ];

  const structural = priorities.filter((p) => !p.topical && p.severity !== "fine");
  const caveats = [
    "Scores are photo-based estimates. Rescan in the same light and angle so changes mean something.",
    ...(structural.length
      ? [`${structural.map((s) => s.label).join(" and ")} ${structural.length > 1 ? "are" : "is"} structural: creams will not change ${structural.length > 1 ? "them" : "it"}, so nothing is suggested for ${structural.length > 1 ? "them" : "it"}.`]
      : []),
    "This is shopping guidance, not medical advice. See a dermatologist for painful or persistent acne.",
  ];

  const watch = (flaggedOrder.length ? flaggedOrder : priorities.map((p) => p.concern)).slice(0, 3) as Concern[];

  return {
    headline,
    summary: summaryParts.filter(Boolean).join(" "),
    verdicts: shelf.map((s) => {
      const v = verdicts.get(s.productId)!;
      return { product_id: v.productId, action: v.action, reason: v.reason, evidence: v.evidence };
    }),
    cart: cart.map((c) => ({ product_id: c.productId, decision: c.decision, reason: c.reason })),
    buy: buys.map((b) => ({ product_id: b.productId, reason: b.fills, evidence: b.covers })),
    skip,
    routine: {
      am: routine.am.map((s) => ({ product_id: s.productId })),
      pm: routine.pm.map((s) => ({ product_id: s.productId, nights: s.nights ?? [] })),
      notes: routine.notes.slice(0, 5),
    },
    look: {
      foundation_id: foundation?.productId ?? "pallu-tint-220n",
      everyday_lip_id: look.everydayLip.productId,
      statement_lip_id: look.statementLip.productId,
      blush_id: look.blush.productId,
      note: foundation
        ? `${foundation.label} is the closest shade to your measured skin tone (ΔE ${foundation.deltaE}); ${look.undertone} undertone.`
        : "Shade picked without a tone reading; run the tone analysis for a measured match.",
    },
    preview: { horizon_weeks: 8, concerns: preview },
    checkin: {
      after_weeks: 6,
      watch,
      note: "Rescan in the same spot and light. Changes under 4 points are noise.",
    },
    caveats: caveats.slice(0, 4),
  };
}

