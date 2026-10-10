// 브라우저에서 쓰는 API 호출·태스크 폴링·셀피 축소 도우미
import type { TaskKind } from "../youcam/types";
import type { TaskView } from "../youcam/service";
import type { PlanResult } from "../agent/resolve";
import type { ScenarioInput } from "../domain/types";

export class ApiError extends Error {}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error || `Request failed (${res.status})`);
  return body as T;
}

export type Status = { youcam: "live" | "fixture"; units: number | null; reserve: number; agent: "live" | "replay" };
export const getStatus = () => call<Status>("/api/status");

export async function runTask(
  body: Record<string, unknown> & { kind: TaskKind },
  { intervalMs = 1500, timeoutMs = 150_000 } = {},
): Promise<TaskView> {
  const { taskId, mode } = await call<{ taskId: string; mode: string }>("/api/youcam/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const started = Date.now();
  const wait = mode === "live" ? Math.max(intervalMs, 2500) : intervalMs / 2;
  for (;;) {
    await new Promise((r) => setTimeout(r, wait));
    const view = await call<TaskView>(`/api/youcam/tasks/${body.kind}/${encodeURIComponent(taskId)}`);
    if (view.status === "success") return view;
    if (view.status === "error") throw new ApiError(view.error || "YouCam task failed");
    if (Date.now() - started > timeoutMs) throw new ApiError("YouCam took too long. Please try again.");
  }
}

export async function uploadSelfie(file: Blob): Promise<string> {
  const { fileId } = await call<{ fileId: string }>("/api/youcam/upload", {
    method: "POST",
    headers: { "content-type": "image/jpeg" },
    body: file,
  });
  return fileId;
}

export const planForScenario = (scenarioId: string) =>
  call<PlanResult>("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenarioId }) });

export const planForInput = (input: ScenarioInput) =>
  call<PlanResult>("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input }) });

/**
 * HD skin analysis needs the short side >= 1080 px and the request must stay under ~4 MB,
 * so the browser re-encodes the selfie as JPEG with the long side at most 2048 px.
 */
export async function prepareSelfie(file: File): Promise<{ blob: Blob; width: number; height: number; url: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  if (Math.min(width, height) < 1080) {
    throw new ApiError(`This photo is ${width}x${height}. HD skin analysis needs at least 1080 px on the short side.`);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  for (const q of [0.92, 0.85, 0.75]) {
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", q));
    if (blob.size < 3.8 * 1024 * 1024) return { blob, width, height, url: URL.createObjectURL(blob) };
  }
  throw new ApiError("Could not shrink the photo under 4 MB.");
}
