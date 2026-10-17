// 규칙 엔진 테스트: 심각도·충돌·선반 판정·갭·최소 구매·장바구니·루틴·셰이드(ΔE2000)·재스캔 판정
import { describe, expect, it } from "vitest";
import { personaInput } from "@/lib/agent/resolve";
import { severityOf, prioritize } from "@/lib/rules/analysis";
import { sessionConflicts, shelfRisks } from "@/lib/rules/conflicts";
import { auditShelf, activeAfterAudit } from "@/lib/rules/shelf";
import { evaluateCart, findGaps, minimalBuy, naiveCart } from "@/lib/rules/shopping";
import { buildRoutine, routineConflicts } from "@/lib/rules/routine";
import { deltaE2000, hexToLab, matchFoundation, undertoneOf } from "@/lib/rules/color";
import { compareScans, previewSettings, MAX_PREVIEW_INTENSITY } from "@/lib/rules/progress";
import { mustProduct } from "@/lib/catalog/products";
import type { SkinScan } from "@/lib/domain/types";

const started = (input: ReturnType<typeof personaInput>) => Object.fromEntries(input.shelf.map((s) => [s.productId, s.startedAt]));

function scanWith(concerns: SkinScan["concerns"], capturedAt = "2026-10-01T00:00:00Z"): SkinScan {
  return { id: "t", capturedAt, source: "sample", mode: "hd", overall: null, skinAge: null, skinType: {}, concerns };
}

describe("analysis", () => {
  it("bands raw scores and never decides on ui_score", () => {
    expect(severityOf(49.9)).toBe("act");
    expect(severityOf(50)).toBe("watch");
    expect(severityOf(70)).toBe("fine");
    const p = prioritize(scanWith({ acne: { raw: 40, ui: 90 }, moisture: { raw: 90, ui: 40 } }));
    expect(p.map((x) => [x.concern, x.severity])).toEqual([
      ["acne", "act"],
      ["moisture", "fine"],
    ]);
  });

  it("escalates a concern whose worst region is far below the whole-face score", () => {
    const p = prioritize(scanWith({ pore: { raw: 60, ui: 70, regions: { nose: { raw: 30, ui: 58 } } } }));
    expect(p[0]).toMatchObject({ concern: "pore", severity: "act", worstRegion: { name: "nose", raw: 30 } });
  });

  it("marks eyelids and tear troughs as not treatable with skincare", () => {
    const p = prioritize(scanWith({ tear_trough: { raw: 30, ui: 50 } }));
    expect(p[0].topical).toBe(false);
  });
});

describe("conflicts", () => {
  it("flags a retinoid and an acid in the same session, and two acids together", () => {
    const kinds = sessionConflicts(["oramel-retinol-03", "kestra-bha-liquid", "pallu-glycolic-pads"].map(mustProduct)).map((c) => c.kind);
    expect(kinds).toContain("retinoid_with_acid");
    expect(kinds).toContain("stacked_exfoliants");
  });

  it("does not count a 0.5% salicylic wash-off cleanser as an exfoliating acid next to a retinoid", () => {
    expect(sessionConflicts(["oramel-retinol-03", "kestra-clarifying-wash"].map(mustProduct))).toEqual([]);
    const withPads = sessionConflicts(["oramel-retinol-03", "pallu-glycolic-pads"].map(mustProduct)).map((c) => c.kind);
    expect(withPads).toContain("retinoid_with_acid");
  });

  it("pauses retinoids for pregnancy and asks for sunscreen with photosensitizers", () => {
    const kinds = shelfRisks([mustProduct("velin-retinal-01")], { severity: {}, profile: { pregnantOrNursing: true } }).map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(["retinoid_in_pregnancy", "missing_sunscreen"]));
  });

  it("does not call a moisturizer and a serum with the same humectant a duplicate", () => {
    const risks = shelfRisks(["velin-ha-serum", "kestra-oilfree-gel"].map(mustProduct), { severity: {}, profile: {} });
    expect(risks.some((r) => r.kind === "duplicate_active")).toBe(false);
  });
});

describe("Maya: breakout on an over-loaded shelf", () => {
  const input = personaInput("maya");
  const audit = auditShelf(input.scan, input.shelf, input.profile);
  const action = (id: string) => audit.verdicts.find((v) => v.productId === id)?.action;

  it("pauses the harshest acid, the fragranced occlusive cream, and drops the duplicate niacinamide", () => {
    expect(action("pallu-glycolic-pads")).toBe("pause");
    expect(action("pallu-rose-cream")).toBe("pause");
    expect(action("pallu-niacinamide-5")).toBe("drop");
    expect(action("oramel-retinol-03")).toBe("alternate");
    expect(action("kestra-bha-liquid")).toBe("alternate");
  });

  it("buys only sunscreen and a fragrance-free moisturizer, within budget", () => {
    const buy = minimalBuy(input.scan, activeAfterAudit(audit), input.profile, started(input));
    expect(buy.map((b) => mustProduct(b.productId).category)).toEqual(["sunscreen", "moisturizer"]);
    const total = buy.reduce((s, b) => s + mustProduct(b.productId).priceUsd, 0);
    expect(total).toBeLessThanOrEqual(input.profile.budgetUsd!);
    for (const b of buy) expect(mustProduct(b.productId).actives).not.toContain("fragrance");
  });

  it("produces a routine with no same-night conflicts", () => {
    const buy = minimalBuy(input.scan, activeAfterAudit(audit), input.profile, started(input));
    const r = buildRoutine([...activeAfterAudit(audit), ...buy.map((b) => b.productId)]);
    expect(routineConflicts(r)).toEqual([]);
    expect(r.am.at(-1)?.productId).toBe(buy[0].productId); // sunscreen last
  });

  it("shows what a concern-by-concern recommender would have sold", () => {
    const n = naiveCart(input.scan);
    expect(n.productIds.length).toBeGreaterThanOrEqual(4);
    expect(n.totalUsd).toBeGreaterThan(100);
  });
});

describe("Jun: about to buy a firming serum", () => {
  const input = personaInput("jun");
  const active = activeAfterAudit(auditShelf(input.scan, input.shelf, input.profile));

  it("says wait on the firming serum because hydration is the bottleneck", () => {
    const [v] = evaluateCart(input.cart!, input.scan, active, input.profile, started(input));
    expect(v.decision).toBe("wait");
    expect(v.reason).toMatch(/hydration/i);
  });

  it("treats hydration as undertreated after a full trial and buys a moisturizer instead", () => {
    const gaps = findGaps(input.scan, active, input.profile, started(input));
    expect(gaps).toContainEqual({ kind: "concern", concern: "moisture", undertreated: true });
    const buy = minimalBuy(input.scan, active, input.profile, started(input));
    expect(buy).toHaveLength(1);
    expect(mustProduct(buy[0].productId).category).toBe("moisturizer");
  });
});

describe("Lena: is it working?", () => {
  const input = personaInput("lena");
  const report = compareScans(input.previousScan!, input.scan, input.shelf);

  it("only judges products started since the first scan", () => {
    expect(report.products.map((p) => p.productId).sort()).toEqual(["pallu-tranexamic-3", "velin-retinal-01"]);
    expect(report.weeksBetween).toBe(6);
  });

  it("finds tranexamic acid working and the retinal raising redness", () => {
    const v = Object.fromEntries(report.products.map((p) => [p.productId, p.verdict]));
    expect(v["pallu-tranexamic-3"]).toBe("working");
    expect(v["velin-retinal-01"]).toBe("irritating");
  });

  it("treats changes inside the noise band as no change", () => {
    const before = scanWith({ age_spot: { raw: 50, ui: 60 } }, "2026-08-20T00:00:00Z");
    const after = scanWith({ age_spot: { raw: 53, ui: 62 } }, "2026-10-01T00:00:00Z");
    const r = compareScans(before, after, [{ productId: "pallu-tranexamic-3", startedAt: "2026-08-20" }]);
    expect(r.products[0].verdict).toBe("no_change_yet"); // 6 of ~8 weeks, +3 is noise
    const later = scanWith({ age_spot: { raw: 53, ui: 62 } }, "2026-11-01T00:00:00Z");
    expect(compareScans(before, later, [{ productId: "pallu-tranexamic-3", startedAt: "2026-08-20" }]).products[0].verdict).toBe(
      "not_working",
    ); // a fair trial with no change
  });
});

describe("color", () => {
  it("matches the CIEDE2000 reference pair from Sharma et al. (2005)", () => {
    expect(deltaE2000({ L: 50, a: 2.6772, b: -79.7751 }, { L: 50, a: 0, b: -82.7485 })).toBeCloseTo(2.0425, 3);
    expect(deltaE2000({ L: 50, a: 2.5, b: 0 }, { L: 73, a: 25, b: -18 })).toBeCloseTo(27.1492, 3);
  });

  it("converts sRGB white to L=100", () => {
    expect(hexToLab("#FFFFFF").L).toBeCloseTo(100, 1);
  });

  it("picks the closest foundation shade for a measured skin colour", () => {
    const [best] = matchFoundation("#D2A27F");
    expect(best.productId).toBe("pallu-tint-220n");
    expect(best.deltaE).toBeLessThan(1);
    expect(["cool", "neutral", "warm"]).toContain(undertoneOf("#E3BC94"));
  });
});

describe("preview", () => {
  it("never exceeds the honest cap and only previews treated concerns", () => {
    const s = previewSettings(["velin-ceramide-cream", "pallu-tranexamic-3"], ["moisture", "age_spot", "acne"], 16);
    expect(s.map((x) => x.concern)).toEqual(["age_spot"]); // moisture cannot be simulated, acne is untreated
    for (const x of s) expect(x.intensity).toBeLessThanOrEqual(MAX_PREVIEW_INTENSITY);
  });
});
