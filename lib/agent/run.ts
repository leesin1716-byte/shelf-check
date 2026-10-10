// Claude 도구 사용 루프: 도구 실행·submit_plan 검증 반송·호출 기록(trace)을 남기고 계획을 돌려준다
import Anthropic from "@anthropic-ai/sdk";
import type { ScenarioInput } from "../domain/types";
import { SYSTEM_PROMPT, firstMessage } from "./prompt";
import { TOOLS, executeTool } from "./tools";
import type { Plan } from "./plan";

export const AGENT_MODEL = "claude-opus-5-5";

export interface TraceStep {
  tool: string;
  input: unknown;
  /** Short, display-ready result. */
  result: string;
  isError: boolean;
  ms: number;
}

export interface AgentRun {
  plan: Plan;
  trace: TraceStep[];
  model: string;
  turns: number;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number };
  createdAt: string;
}

type MessagesApi = Pick<Anthropic["messages"], "create">;

export interface RunOptions {
  /** Defaults to a client built from the environment (ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL). */
  messages?: MessagesApi;
  model?: string;
  maxTurns?: number;
  onStep?: (step: TraceStep) => void;
}

export class AgentError extends Error {}

export async function runAgent(input: ScenarioInput, opts: RunOptions = {}): Promise<AgentRun> {
  const messagesApi = opts.messages ?? new Anthropic().messages;
  const model = opts.model ?? AGENT_MODEL;
  const maxTurns = opts.maxTurns ?? 14;
  const trace: TraceStep[] = [];
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: firstMessage(input) }];
  let nudges = 0;

  for (let turn = 1; turn <= maxTurns; turn++) {
    const response = await messagesApi.create({
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      tool_choice: { type: "auto" },
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      cache_control: { type: "ephemeral" },
      messages,
    } as Anthropic.MessageCreateParamsNonStreaming);
    usage.input_tokens += response.usage.input_tokens;
    usage.output_tokens += response.usage.output_tokens;
    usage.cache_read_input_tokens += response.usage.cache_read_input_tokens ?? 0;

    if (response.stop_reason === "refusal") throw new AgentError("The model declined this request.");
    if (response.stop_reason === "max_tokens") throw new AgentError("The model ran out of output tokens.");
    messages.push({ role: "assistant", content: response.content });

    const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!calls.length) {
      if (nudges++ >= 2) throw new AgentError("The model stopped without submitting a plan.");
      messages.push({ role: "user", content: "Please finish by calling submit_plan with the complete plan." });
      continue;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    let accepted: Plan | undefined;
    for (const call of calls) {
      const started = Date.now();
      const out = executeTool(call.name, call.input, input);
      const step: TraceStep = {
        tool: call.name,
        input: call.name === "submit_plan" ? "(plan)" : call.input,
        result: summarize(call.name, out.content, out.isError),
        isError: !!out.isError,
        ms: Date.now() - started,
      };
      trace.push(step);
      opts.onStep?.(step);
      results.push({ type: "tool_result", tool_use_id: call.id, content: out.content, is_error: out.isError });
      if (out.plan) accepted = out.plan;
    }
    if (accepted) {
      return { plan: accepted, trace, model: response.model, turns: turn, usage, createdAt: new Date().toISOString() };
    }
    // All results for this turn go back in one user message.
    messages.push({ role: "user", content: results });
  }
  throw new AgentError(`No accepted plan after ${maxTurns} turns.`);
}

/** One display line per tool result, shown in the agent trace. */
export function summarize(tool: string, content: string, isError?: boolean): string {
  if (isError) return content.length > 400 ? content.slice(0, 400) + "…" : content;
  if (tool === "submit_plan") return content;
  let v: any;
  try {
    v = JSON.parse(content);
  } catch {
    return content.slice(0, 160);
  }
  const words = (s: string) => s.replace(/_/g, " ");
  switch (tool) {
    case "read_scan": {
      const flagged = v.concerns.filter((c: any) => c.severity !== "fine" && c.topical);
      return `${v.concerns.length} concerns; flagged: ${flagged.map((c: any) => `${words(c.concern)} ${c.raw}`).join(", ") || "none"}`;
    }
    case "audit_shelf": {
      const counts: Record<string, number> = {};
      for (const x of v.verdicts) counts[x.action] = (counts[x.action] ?? 0) + 1;
      const risks = v.risks.map((r: any) => words(r.kind));
      return `${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(" · ")}${risks.length ? `; risks: ${risks.join(", ")}` : ""}`;
    }
    case "compare_scans":
      return `${v.weeksBetween} weeks apart; ${v.products.map((p: any) => `${p.productId} ${words(p.verdict)}`).join("; ") || "no new products"}`;
    case "find_gaps":
      return v.length ? v.map((g: any) => (g.kind === "basic" ? `no ${g.category}` : `${words(g.concern)}${g.undertreated ? " (undertreated)" : ""}`)).join(", ") : "no gaps";
    case "search_catalog":
      return v.length ? v.slice(0, 3).map((r: any) => `${r.name} $${r.price_usd}`).join(" · ") : "no matches";
    case "evaluate_cart":
      return v.map((c: any) => `${c.productId}: ${c.decision}`).join("; ") || "empty cart";
    case "build_routine":
      return `AM ${v.routine.am.length} steps, PM ${v.routine.pm.length} steps, ${v.conflicts.length} conflict${v.conflicts.length === 1 ? "" : "s"}`;
    case "match_shades":
      return `best foundation ${v.foundation[0]?.label} (ΔE ${v.foundation[0]?.deltaE}); ${v.look.undertone} undertone`;
    case "preview_settings":
      return v.map((s: any) => `${words(s.concern)} ${s.intensity}`).join(", ") || "nothing to preview";
    case "naive_cart":
      return `${v.productIds.length} products for $${v.totalUsd}, ${v.already_owned.length} already owned`;
  }
  return content.slice(0, 160);
}
