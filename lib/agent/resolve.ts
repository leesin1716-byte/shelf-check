// 계획을 어디서 가져올지 정한다: 녹화된 실행 재생 → (키가 있으면) 실호출 → 오프라인 플래너
import type { ScenarioInput } from "../domain/types";
import { PERSONAS, getPersona, personaScan } from "../fixtures/personas";
import { offlinePlan } from "./offline";
import { validatePlan, type Plan } from "./plan";
import { readCachedRun } from "./cache";
import { runAgent, type TraceStep } from "./run";

export type PlanSource = "cached" | "live" | "offline";

export interface PlanResult {
  plan: Plan;
  source: PlanSource;
  trace: TraceStep[];
  model?: string;
  createdAt?: string;
  note?: string;
}

export function personaInput(id: string): ScenarioInput {
  const p = getPersona(id);
  if (!p) throw new Error(`Unknown persona ${id}`);
  return {
    moment: p.moment,
    scan: personaScan(p)!,
    previousScan: personaScan(p, "previous"),
    shelf: p.shelf,
    cart: p.cart,
    profile: p.profile,
  };
}

export const SCENARIO_IDS = PERSONAS.map((p) => p.id);

export async function resolvePlan(input: ScenarioInput, scenarioId?: string, allowLive = true): Promise<PlanResult> {
  if (scenarioId) {
    const cached = readCachedRun(scenarioId, input);
    if (cached) {
      return { plan: cached.plan, source: "cached", trace: cached.trace, model: cached.model, createdAt: cached.createdAt };
    }
  }
  if (allowLive && process.env.ANTHROPIC_API_KEY) {
    try {
      const run = await runAgent(input);
      return { plan: run.plan, source: "live", trace: run.trace, model: run.model, createdAt: run.createdAt };
    } catch (err) {
      const plan = offlinePlan(input);
      return { plan, source: "offline", trace: [], note: `Live agent failed (${err instanceof Error ? err.message : "error"}); showing the offline planner.` };
    }
  }
  const plan = offlinePlan(input);
  const issues = validatePlan(plan, input);
  return {
    plan,
    source: "offline",
    trace: [],
    note: issues.length ? `Offline plan has ${issues.length} open issue(s): ${issues.join(" ")}` : undefined,
  };
}
