// YouCam 태스크 생성: 페르소나는 픽스처 태스크, 업로드한 셀피는 실제 태스크(유닛 가드·IP 제한)
import { z } from "zod";
import { CONCERNS } from "@/lib/domain/types";
import { YouCamError } from "@/lib/youcam/client";
import { BLUSH_PATTERNS } from "@/lib/youcam/requests";
import { allowLiveScan, createLiveTask, fixtureTaskId, liveClient, TASK_KINDS } from "@/lib/youcam/service";
import { getPersona } from "@/lib/fixtures/personas";

export const runtime = "nodejs";

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const Body = z.object({
  kind: z.enum(TASK_KINDS as [string, ...string[]]),
  persona: z.string().max(20).optional(),
  variant: z.enum(["default", "previous", "everyday", "statement"]).optional(),
  fileId: z.string().max(300).optional(),
  simulation: z.array(z.object({ concern: z.enum(CONCERNS), intensity: z.number().min(0).max(0.5) })).max(4).optional(),
  look: z
    .object({
      foundation: z.object({ hex, coverage: z.number().min(0).max(100), glow: z.number().min(0).max(100) }).optional(),
      lip: z.object({ hex, texture: z.enum(["matte", "satin", "sheer", "gloss"]), intensity: z.number().min(0).max(100) }).optional(),
      blush: z.object({ hex, intensity: z.number().min(0).max(100), pattern: z.enum(BLUSH_PATTERNS).optional() }).optional(),
      skinSmooth: z.number().min(0).max(100).optional(),
    })
    .optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Bad request" }, { status: 400 });
  const b = parsed.data;
  const kind = b.kind as (typeof TASK_KINDS)[number];

  if (b.persona) {
    if (!getPersona(b.persona)) return Response.json({ error: "Unknown persona" }, { status: 404 });
    return Response.json({ taskId: fixtureTaskId(kind, b.persona, b.variant ?? "default"), mode: "fixture", units: 0 });
  }

  const client = liveClient();
  if (!client) return Response.json({ error: "Live scanning is off in this deployment. Pick a demo persona." }, { status: 503 });
  if (!b.fileId) return Response.json({ error: "Upload a selfie first." }, { status: 400 });
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (kind === "skin-analysis" && !allowLiveScan(ip)) {
    return Response.json({ error: "You have used this demo's live scans for the hour. Try a demo persona." }, { status: 429 });
  }
  try {
    const { taskId, units } = await createLiveTask(client, { kind, fileId: b.fileId, simulation: b.simulation, look: b.look });
    return Response.json({ taskId, mode: "live", units });
  } catch (err) {
    const status = err instanceof YouCamError ? err.status : 500;
    return Response.json({ error: err instanceof Error ? err.message : "Task failed" }, { status: status >= 400 ? status : 502 });
  }
}
