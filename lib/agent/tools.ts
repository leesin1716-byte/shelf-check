// 쇼핑 에이전트가 호출하는 도구 정의와 실행기 — 모든 사실은 결정론 규칙 엔진에서 나온다
import type Anthropic from "@anthropic-ai/sdk";
import { CONCERNS, type Concern, type ScenarioInput } from "../domain/types";
import { PRODUCTS, isSkincare, mustProduct, productLabel, type Category } from "../catalog/products";
import { prioritize } from "../rules/analysis";
import { auditShelf } from "../rules/shelf";
import { evaluateCart, findGaps, naiveCart, searchCatalog } from "../rules/shopping";
import { buildRoutine, routineConflicts } from "../rules/routine";
import { matchFoundation, suggestLook } from "../rules/color";
import { compareScans, previewSettings, MAX_PREVIEW_INTENSITY } from "../rules/progress";
import { PLAN_JSON_SCHEMA, PlanSchema, validatePlan, type Plan } from "./plan";

const CATEGORIES: Category[] = ["cleanser", "toner", "exfoliant", "serum", "treatment", "eye", "moisturizer", "sunscreen"];

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "read_scan",
    description:
      "Read the YouCam AI Skin Analysis result: every concern ranked worst-first with raw_score (decide on this), ui_score (display only), severity (act < 50, watch < 70, fine) and whether topical skincare can change it; plus skin type by zone, skin age and the measured skin tone.",
    input_schema: obj({}),
  },
  {
    name: "audit_shelf",
    description:
      "Rule-based audit of the products the user already owns: a baseline keep / alternate / pause / drop verdict per product and every shelf-level risk (over-exfoliation, fragrance on reactive skin, occlusives on breakouts, duplicate actives, missing sunscreen, pregnancy). Start here; you may disagree, but the final plan is validated.",
    input_schema: obj({}),
  },
  {
    name: "compare_scans",
    description:
      "Only when a previous scan exists. Per-concern raw_score change between the two YouCam scans and a per-product verdict (working / too_early / no_change_yet / not_working / irritating) for products started since the first scan. Changes within ±4 are noise.",
    input_schema: obj({}),
  },
  {
    name: "find_gaps",
    description:
      "Given the shelf products you intend to keep, list what is still missing: basics (sunscreen, moisturizer, cleanser) and act-level concerns nothing treats or that stayed flagged after a full trial (undertreated).",
    input_schema: obj({ keep_ids: { type: "array", items: { type: "string" } } }, ["keep_ids"]),
  },
  {
    name: "search_catalog",
    description:
      "Search the store catalog for skincare. Results already exclude what the user owns, products unsafe for their profile, harsh products on reactive skin and occlusives on breakouts, and are ranked by fewest conflicts with the kept shelf, most flagged concerns covered, gentleness and price.",
    input_schema: obj(
      {
        keep_ids: { type: "array", items: { type: "string" } },
        concern: { type: "string", enum: [...CONCERNS] },
        category: { type: "string", enum: CATEGORIES },
        max_price_usd: { type: "number" },
      },
      ["keep_ids"],
    ),
  },
  {
    name: "evaluate_cart",
    description: "Rule-based buy / skip / wait verdict for each product the user is about to buy, given the shelf you intend to keep.",
    input_schema: obj({ keep_ids: { type: "array", items: { type: "string" } } }, ["keep_ids"]),
  },
  {
    name: "build_routine",
    description:
      "Order the given products into AM and PM steps with alternating nights for retinoids and acids, and report any same-session conflicts that remain. Use it to check a routine before you submit.",
    input_schema: obj({ product_ids: { type: "array", items: { type: "string" } } }, ["product_ids"]),
  },
  {
    name: "match_shades",
    description:
      "Foundation shades ranked by CIEDE2000 distance to the skin colour measured by YouCam's Facial Color Tones analysis, plus everyday/statement lip and blush picks for the YouCam Makeup Virtual Try-On.",
    input_schema: obj({}),
  },
  {
    name: "preview_settings",
    description: `Suggested YouCam Skin Simulation intensities (0..${MAX_PREVIEW_INTENSITY}) for concerns the routine treats, scaled by how long the products usually take. The preview sets expectations; it must never promise more than the cap.`,
    input_schema: obj(
      {
        product_ids: { type: "array", items: { type: "string" } },
        concerns: { type: "array", items: { type: "string", enum: [...CONCERNS] } },
        horizon_weeks: { type: "integer" },
      },
      ["product_ids", "concerns", "horizon_weeks"],
    ),
  },
  {
    name: "naive_cart",
    description:
      "What a typical 'matches your concerns' recommender would sell this user: one product per flagged concern, ignoring their shelf. Use it to explain what they do not need to buy.",
    input_schema: obj({}),
  },
  {
    name: "submit_plan",
    description:
      "Submit the final plan. It is validated against the catalog, the scan, the conflict rules, the budget and the honest preview cap. If it is rejected you get the list of issues; fix them and submit again.",
    input_schema: PLAN_JSON_SCHEMA as Anthropic.Tool.InputSchema,
  },
];

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  /** Set when submit_plan was accepted. */
  plan?: Plan;
}

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function checkIds(list: string[]) {
  const bad = list.filter((id) => !PRODUCTS.some((p) => p.id === id));
  if (bad.length) throw new Error(`Unknown product ids: ${bad.join(", ")}`);
}

export function executeTool(name: string, rawInput: unknown, input: ScenarioInput): ToolOutcome {
  const args = (rawInput ?? {}) as Record<string, unknown>;
  const { scan, shelf, profile } = input;
  const startedAt = Object.fromEntries(shelf.map((s) => [s.productId, s.startedAt]));
  const json = (v: unknown): ToolOutcome => ({ content: JSON.stringify(v) });
  try {
    switch (name) {
      case "read_scan":
        return json({
          captured_at: scan.capturedAt,
          source: scan.source,
          skin_type: scan.skinType,
          skin_age: scan.skinAge,
          overall: scan.overall,
          concerns: prioritize(scan).map((p) => ({
            concern: p.concern,
            raw: p.raw,
            ui: p.ui,
            severity: p.severity,
            topical: p.topical,
            worst_region: p.worstRegion,
          })),
          tone: scan.tone ?? null,
          moment: input.moment,
          profile,
          shelf: shelf.map((s) => ({ id: s.productId, name: productLabel(mustProduct(s.productId)), started_at: s.startedAt })),
          cart: (input.cart ?? []).map((id) => ({ id, name: productLabel(mustProduct(id)), price_usd: mustProduct(id).priceUsd })),
          has_previous_scan: !!input.previousScan,
        });
      case "audit_shelf": {
        const a = auditShelf(scan, shelf, profile);
        return json({
          verdicts: a.verdicts.map((v) => ({ ...v, product: describe(v.productId) })),
          risks: a.conflicts,
        });
      }
      case "compare_scans":
        if (!input.previousScan) return { content: "No previous scan for this user.", isError: true };
        return json(compareScans(input.previousScan, scan, shelf));
      case "find_gaps": {
        const keep = ids(args.keep_ids);
        checkIds(keep);
        return json(findGaps(scan, keep, profile, startedAt));
      }
      case "search_catalog": {
        const keep = ids(args.keep_ids);
        checkIds(keep);
        const results = searchCatalog(
          {
            concern: CONCERNS.includes(args.concern as Concern) ? (args.concern as Concern) : undefined,
            category: CATEGORIES.includes(args.category as Category) ? (args.category as Category) : undefined,
            maxPriceUsd: typeof args.max_price_usd === "number" ? args.max_price_usd : undefined,
          },
          { scan, activeIds: keep, profile, excludeIds: shelf.map((s) => s.productId) },
        );
        return json(
          results.slice(0, 6).map((r) => ({ ...describe(r.product.id), covers_flagged: r.covers, conflicts_with_kept: r.conflictsWithShelf })),
        );
      }
      case "evaluate_cart": {
        const keep = ids(args.keep_ids);
        checkIds(keep);
        return json(evaluateCart(input.cart ?? [], scan, keep, profile, startedAt));
      }
      case "build_routine": {
        const list = ids(args.product_ids);
        checkIds(list);
        const r = buildRoutine(list);
        return json({ routine: r, conflicts: routineConflicts(r) });
      }
      case "match_shades": {
        if (!scan.tone) return { content: "No skin tone measurement; pick neutral mid shades.", isError: true };
        return json({ foundation: matchFoundation(scan.tone.skinHex), look: suggestLook(scan.tone.skinHex, scan.tone.lipHex) });
      }
      case "preview_settings": {
        const list = ids(args.product_ids);
        checkIds(list);
        const concerns = ids(args.concerns).filter((c): c is Concern => CONCERNS.includes(c as Concern));
        const weeks = typeof args.horizon_weeks === "number" ? args.horizon_weeks : 8;
        return json(previewSettings(list, concerns, weeks));
      }
      case "naive_cart": {
        const n = naiveCart(scan);
        return json({ ...n, products: n.productIds.map(describe), already_owned: n.productIds.filter((id) => shelf.some((s) => s.productId === id)) });
      }
      case "submit_plan": {
        const parsed = PlanSchema.safeParse(rawInput);
        if (!parsed.success) {
          return { content: `Plan does not match the schema: ${parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, isError: true };
        }
        const issues = validatePlan(parsed.data, input);
        if (issues.length) return { content: `Plan rejected. Fix these and submit again:\n- ${issues.join("\n- ")}`, isError: true };
        return { content: "Plan accepted.", plan: parsed.data };
      }
      default:
        return { content: `Unknown tool ${name}`, isError: true };
    }
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}

function describe(id: string) {
  const p = mustProduct(id);
  return {
    id: p.id,
    name: productLabel(p),
    category: p.category,
    price_usd: p.priceUsd,
    actives: p.actives,
    targets: p.targets,
    time: p.time,
    irritation: p.irritation,
    weeks_to_see: p.weeksToSee ?? null,
    skincare: isSkincare(p),
  };
}
