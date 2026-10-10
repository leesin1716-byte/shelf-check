// 사전 계산한 에이전트 실행을 시나리오 지문(fingerprint)으로 저장·재생한다(키 없는 심사 기간 데모용)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ScenarioInput } from "../domain/types";
import { PROMPT_VERSION } from "./prompt";
import { PlanSchema } from "./plan";
import type { AgentRun } from "./run";

export const CACHE_DIR = path.join(process.cwd(), "data", "agent-cache");

/** Stable JSON: sorted keys so the same input always hashes the same. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export function fingerprint(input: ScenarioInput): string {
  const essence = {
    v: PROMPT_VERSION,
    moment: input.moment,
    scan: { concerns: input.scan.concerns, skinType: input.scan.skinType, tone: input.scan.tone, at: input.scan.capturedAt },
    previous: input.previousScan ? { concerns: input.previousScan.concerns, at: input.previousScan.capturedAt } : null,
    shelf: input.shelf,
    cart: input.cart ?? [],
    profile: input.profile,
  };
  // Mask URLs change between recordings and do not change the decision.
  const json = stable(essence).replace(/"maskUrl":"[^"]*",?/g, "");
  return createHash("sha256").update(json).digest("hex").slice(0, 16);
}

export interface CachedRun extends AgentRun {
  scenarioId: string;
  fingerprint: string;
}

export function readCachedRun(scenarioId: string, input: ScenarioInput): CachedRun | null {
  const file = path.join(CACHE_DIR, `${scenarioId}.json`);
  if (!existsSync(file)) return null;
  const run = JSON.parse(readFileSync(file, "utf8")) as CachedRun;
  if (run.fingerprint !== fingerprint(input)) return null;
  if (!PlanSchema.safeParse(run.plan).success) return null;
  return run;
}

export function writeCachedRun(scenarioId: string, input: ScenarioInput, run: AgentRun): string {
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${scenarioId}.json`);
  const cached: CachedRun = { ...run, scenarioId, fingerprint: fingerprint(input) };
  writeFileSync(file, JSON.stringify(cached, null, 2) + "\n", "utf8");
  return file;
}
