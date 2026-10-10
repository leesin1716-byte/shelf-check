// API 라우트가 쓰는 YouCam 서비스 계층: 키가 있으면 실호출(유닛 가드·IP 제한), 없거나 페르소나면 픽스처 태스크
import { YouCamClient, YouCamError } from "./client";
import {
  buildMakeupRequest,
  buildSimulationRequest,
  buildSkinAnalysisRequest,
  buildSkinToneRequest,
  FULL_HD_SCAN,
  sourceRef,
  type LookSpec,
} from "./requests";
import { normalizeSkinAnalysis, normalizeSkinTone, resultImageUrl } from "./normalize";
import { unitCost, type SkinAnalysisJsonResults, type SkinToneResults, type TaskKind } from "./types";
import type { Concern, SkinScan, SkinTone } from "../domain/types";
import { getPersona, personaImages, personaScan, personaTone } from "../fixtures/personas";

export const TASK_KINDS: TaskKind[] = ["skin-analysis", "skin-simulation", "skin-tone-analysis", "makeup-vto"];

export function liveClient(): YouCamClient | null {
  const key = process.env.YOUCAM_API_KEY;
  return key ? new YouCamClient({ apiKey: key, baseUrl: process.env.YOUCAM_BASE_URL || undefined }) : null;
}

export interface CreateTaskRequest {
  kind: TaskKind;
  persona?: string;
  fileId?: string;
  simulation?: { concern: Concern; intensity: number }[];
  look?: LookSpec;
  /** Which recorded look to show for personas ("everyday" | "statement"). */
  lookName?: string;
}

export interface TaskView {
  status: "running" | "success" | "error";
  mode: "fixture" | "live";
  scan?: SkinScan;
  tone?: SkinTone;
  imageUrl?: string | null;
  error?: string;
}

const FIXTURE_DELAY_MS = 1200;

// ---- Fixture tasks -------------------------------------------------------

export function fixtureTaskId(kind: TaskKind, persona: string, variant = "default", now = Date.now()): string {
  return ["fx", kind, persona, variant, String(now)].join(".");
}

export function readFixtureTask(id: string, now = Date.now()): TaskView {
  const [fx, kind, personaId, variant, issued] = id.split(".");
  const persona = getPersona(personaId);
  if (fx !== "fx" || !persona || !TASK_KINDS.includes(kind as TaskKind)) {
    return { status: "error", mode: "fixture", error: "Unknown fixture task" };
  }
  if (now - Number(issued) < FIXTURE_DELAY_MS) return { status: "running", mode: "fixture" };
  const images = personaImages(persona);
  switch (kind as TaskKind) {
    case "skin-analysis":
      return { status: "success", mode: "fixture", scan: personaScan(persona, variant === "previous" ? "previous" : "current") };
    case "skin-tone-analysis":
      return { status: "success", mode: "fixture", tone: personaTone(persona) };
    case "skin-simulation":
      return { status: "success", mode: "fixture", imageUrl: images.simulation ?? null };
    case "makeup-vto":
      return { status: "success", mode: "fixture", imageUrl: images.looks?.[variant] ?? null };
  }
}

// ---- Live tasks ------------------------------------------------------------

const RECENT = new Map<string, number[]>();
/** Live scans per client IP per hour; protects the hackathon's 1,000 units from a single visitor. */
export const LIVE_SCANS_PER_HOUR = 4;

export function allowLiveScan(ip: string, now = Date.now()): boolean {
  const hour = 3600_000;
  const list = (RECENT.get(ip) ?? []).filter((t) => now - t < hour);
  if (list.length >= LIVE_SCANS_PER_HOUR) {
    RECENT.set(ip, list);
    return false;
  }
  list.push(now);
  RECENT.set(ip, list);
  return true;
}

export function liveRequestBody(req: CreateTaskRequest): { body: object; units: number } {
  const src = sourceRef({ fileId: req.fileId });
  switch (req.kind) {
    case "skin-analysis":
      return { body: buildSkinAnalysisRequest(src, FULL_HD_SCAN), units: unitCost("skin-analysis", FULL_HD_SCAN.length, true) };
    case "skin-tone-analysis":
      return { body: buildSkinToneRequest(src), units: unitCost("skin-tone-analysis") };
    case "skin-simulation": {
      const body = buildSimulationRequest(src, req.simulation ?? []);
      return { body, units: unitCost("skin-simulation", (req.simulation ?? []).length) };
    }
    case "makeup-vto":
      if (!req.look) throw new YouCamError("A makeup task needs a look", 400, "InvalidParameters");
      return { body: buildMakeupRequest(src, req.look), units: unitCost("makeup-vto") };
  }
}

export async function createLiveTask(client: YouCamClient, req: CreateTaskRequest): Promise<{ taskId: string; units: number }> {
  const { body, units } = liveRequestBody(req);
  const reserve = Number(process.env.YOUCAM_UNIT_RESERVE ?? 300);
  if (req.kind === "skin-analysis" || req.kind === "skin-tone-analysis") {
    const balance = await client.getUnits();
    if (balance - units < reserve) {
      throw new YouCamError(
        `The demo's YouCam unit reserve is reached (${Math.floor(balance)} left). Try a demo persona instead.`,
        429,
        "UnitReserve",
      );
    }
  }
  const taskId = await client.createTask(req.kind, body);
  return { taskId, units };
}

export async function readLiveTask(client: YouCamClient, kind: TaskKind, taskId: string): Promise<TaskView> {
  const state = await client.getTask(kind, taskId);
  if (state.status === "running") return { status: "running", mode: "live" };
  if (state.status === "error") return { status: "error", mode: "live", error: state.errorMessage || state.error || "Task failed" };
  switch (kind) {
    case "skin-analysis":
      return {
        status: "success",
        mode: "live",
        scan: normalizeSkinAnalysis(state.results as SkinAnalysisJsonResults, {
          id: `live-${taskId.slice(0, 12)}`,
          capturedAt: new Date().toISOString(),
          source: "live",
        }),
      };
    case "skin-tone-analysis":
      return { status: "success", mode: "live", tone: normalizeSkinTone(state.results as SkinToneResults) };
    default:
      return { status: "success", mode: "live", imageUrl: resultImageUrl(state.results) };
  }
}
