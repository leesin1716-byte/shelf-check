// 에이전트 계층 테스트: 오프라인 계획의 검증 통과, 검증기의 위반 탐지, 가짜 전송으로 도구 루프·반송·재생 캐시
import { describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { offlinePlan } from "@/lib/agent/offline";
import { PlanSchema, validatePlan, type Plan } from "@/lib/agent/plan";
import { personaInput, resolvePlan, SCENARIO_IDS } from "@/lib/agent/resolve";
import { executeTool, TOOLS } from "@/lib/agent/tools";
import { runAgent, summarize } from "@/lib/agent/run";
import { CACHE_DIR, fingerprint, readCachedRun, writeCachedRun } from "@/lib/agent/cache";

describe("offline planner", () => {
  for (const id of SCENARIO_IDS) {
    it(`produces a schema-valid plan that passes every hard rule for ${id}`, () => {
      const input = personaInput(id);
      const plan = offlinePlan(input);
      expect(PlanSchema.safeParse(plan).success).toBe(true);
      expect(validatePlan(plan, input)).toEqual([]);
    });
  }

  it("pauses the acid, not the working retinal, when redness rose (Lena)", () => {
    const plan = offlinePlan(personaInput("lena"));
    const v = Object.fromEntries(plan.verdicts.map((x) => [x.product_id, x.action]));
    expect(v["pallu-glycolic-pads"]).toBe("pause");
    expect(v["velin-retinal-01"]).toBe("keep");
    expect(v["pallu-tranexamic-3"]).toBe("keep");
    expect(plan.buy).toEqual([]);
  });
});

describe("validatePlan", () => {
  const input = personaInput("maya");
  const good = offlinePlan(input);
  const clone = (): Plan => JSON.parse(JSON.stringify(good));

  it("rejects unknown products, missing verdicts and buying what is owned", () => {
    const p = clone();
    p.verdicts.pop();
    p.buy = [{ product_id: "kestra-bha-liquid", reason: "x x x", evidence: ["acne"] }];
    p.routine.am.push({ product_id: "made-up-serum" });
    const issues = validatePlan(p, input).join("\n");
    expect(issues).toMatch(/missing a verdict/);
    expect(issues).toMatch(/already on the shelf/);
    expect(issues).toMatch(/unknown product_id "made-up-serum"/);
  });

  it("rejects a retinoid and an acid on the same night", () => {
    const p = clone();
    for (const s of p.routine.pm) s.nights = [];
    expect(validatePlan(p, input).join("\n")).toMatch(/routine conflict/);
  });

  it("rejects dishonest previews, over-budget buys and wrong shades", () => {
    const p = clone();
    p.preview.concerns[0].intensity = 0.9;
    p.buy.push({ product_id: "oramel-peptide-firming", reason: "x x x", evidence: [] });
    p.look.foundation_id = "pallu-tint-510n";
    const issues = validatePlan(p, input).join("\n");
    expect(issues).toMatch(/honest cap/);
    expect(issues).toMatch(/budget/);
    expect(issues).toMatch(/matched shades/);
  });

  it("rejects routines that drop sunscreen while using retinoids", () => {
    const p = clone();
    p.routine.am = p.routine.am.filter((s) => !s.product_id.includes("spf"));
    expect(validatePlan(p, input).join("\n")).toMatch(/no morning sunscreen|has no routine step/);
  });
});

describe("tools", () => {
  const input = personaInput("jun");
  it("exposes every tool with an object schema", () => {
    for (const t of TOOLS) expect(t.input_schema.type).toBe("object");
    expect(TOOLS.map((t) => t.name)).toContain("submit_plan");
  });

  it("answers read_scan and returns errors for bad ids instead of throwing", () => {
    const scan = JSON.parse(executeTool("read_scan", {}, input).content);
    expect(scan.concerns[0]).toMatchObject({ concern: "moisture", severity: "act" });
    const bad = executeTool("find_gaps", { keep_ids: ["nope"] }, input);
    expect(bad.isError).toBe(true);
    expect(executeTool("compare_scans", {}, input).isError).toBe(true); // Jun has no previous scan
  });

  it("summarizes tool results for the trace", () => {
    const out = executeTool("audit_shelf", {}, personaInput("maya"));
    expect(summarize("audit_shelf", out.content)).toMatch(/pause 2/);
  });
});

function fakeMessages(script: ((req: Anthropic.MessageCreateParamsNonStreaming) => Partial<Anthropic.Message>)[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    requests,
    api: {
      create: async (req: Anthropic.MessageCreateParamsNonStreaming) => {
        requests.push(JSON.parse(JSON.stringify(req)));
        const step = script.shift();
        if (!step) throw new Error("no more scripted turns");
        return {
          id: "m",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          stop_reason: "tool_use",
          usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10 },
          ...step(req),
        } as Anthropic.Message;
      },
    } as unknown as Pick<Anthropic["messages"], "create">,
  };
}

const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input }) as Anthropic.ToolUseBlock;

describe("runAgent", () => {
  it("runs tools, bounces an invalid plan back, and returns the accepted one", async () => {
    const input = personaInput("maya");
    const good = offlinePlan(input);
    const bad = { ...good, buy: [{ product_id: "kestra-bha-liquid", reason: "again", evidence: [] }] };
    const { api, requests } = fakeMessages([
      () => ({ content: [toolUse("a", "read_scan", {}), toolUse("b", "audit_shelf", {})] }),
      () => ({ content: [toolUse("c", "submit_plan", bad)] }),
      () => ({ content: [toolUse("d", "submit_plan", good)] }),
    ]);
    const run = await runAgent(input, { messages: api });
    expect(run.plan).toEqual(good);
    expect(run.turns).toBe(3);
    expect(run.trace.map((t) => t.tool)).toEqual(["read_scan", "audit_shelf", "submit_plan", "submit_plan"]);
    expect(run.trace[2].isError).toBe(true);
    // Both parallel results came back in one user message.
    const second = requests[1].messages.at(-1)!;
    expect(Array.isArray(second.content) && second.content.length).toBe(2);
    // The rejection reasons were sent to the model.
    const third = JSON.stringify(requests[2].messages.at(-1));
    expect(third).toMatch(/already on the shelf/);
    expect(requests[0].model).toBe("claude-opus-5-5");
    expect(requests[0].tool_choice).toEqual({ type: "auto" });
  });

  it("nudges once when the model answers in text, then fails cleanly", async () => {
    const text = () => ({ stop_reason: "end_turn" as const, content: [{ type: "text", text: "Here is my advice", citations: null } as Anthropic.TextBlock] });
    const { api } = fakeMessages([text, text, text]);
    await expect(runAgent(personaInput("jun"), { messages: api })).rejects.toThrow(/without submitting/);
  });
});

describe("cache", () => {
  it("fingerprints inputs stably and replays a stored run only for the same input", async () => {
    const input = personaInput("jun");
    expect(fingerprint(input)).toBe(fingerprint(personaInput("jun")));
    const changed = { ...input, cart: [] };
    expect(fingerprint(changed)).not.toBe(fingerprint(input));

    const id = "test-scenario";
    const file = path.join(CACHE_DIR, `${id}.json`);
    try {
      writeCachedRun(id, input, {
        plan: offlinePlan(input),
        trace: [{ tool: "read_scan", input: {}, result: "ok", isError: false, ms: 1 }],
        model: "claude-opus-5-5",
        turns: 4,
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
        createdAt: "2026-10-11T00:00:00Z",
      });
      expect(readCachedRun(id, input)?.trace).toHaveLength(1);
      expect(readCachedRun(id, changed)).toBeNull();
      const resolved = await resolvePlan(input, id, false);
      expect(resolved.source).toBe("cached");
    } finally {
      if (existsSync(file)) rmSync(file);
    }
  });

  it("falls back to the offline planner without a key or cache", async () => {
    const r = await resolvePlan(personaInput("lena"), "no-such-scenario", false);
    expect(r.source).toBe("offline");
    expect(r.note).toBeUndefined();
  });
});
