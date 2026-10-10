// 쇼핑 에이전트 실행: 데모 시나리오는 녹화본 재생, 새 스캔은 (키가 있으면) Claude 실호출, 없으면 오프라인 플래너
import { z } from "zod";
import { ScenarioInputSchema } from "@/lib/domain/schema";
import { personaInput, resolvePlan, SCENARIO_IDS } from "@/lib/agent/resolve";
import type { ScenarioInput } from "@/lib/domain/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.union([
  z.object({ scenarioId: z.string() }),
  z.object({ input: ScenarioInputSchema }),
]);

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Bad request" }, { status: 400 });
  try {
    if ("scenarioId" in parsed.data) {
      if (!SCENARIO_IDS.includes(parsed.data.scenarioId as never)) return Response.json({ error: "Unknown scenario" }, { status: 404 });
      const input = personaInput(parsed.data.scenarioId);
      // Demo scenarios never spend on a live call: replay, else the offline planner.
      return Response.json(await resolvePlan(input, parsed.data.scenarioId, false));
    }
    return Response.json(await resolvePlan(parsed.data.input as ScenarioInput));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Agent failed" }, { status: 500 });
  }
}
