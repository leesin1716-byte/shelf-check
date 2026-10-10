// YouCam 태스크 상태 폴링: 성공하면 정규화한 스캔·색조·결과 이미지 URL 을 돌려준다
import { YouCamError } from "@/lib/youcam/client";
import { liveClient, readFixtureTask, readLiveTask, TASK_KINDS } from "@/lib/youcam/service";
import type { TaskKind } from "@/lib/youcam/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await ctx.params;
  if (!TASK_KINDS.includes(kind as TaskKind)) return Response.json({ error: "Unknown task kind" }, { status: 404 });
  const taskId = decodeURIComponent(id);
  if (taskId.startsWith("fx.")) return Response.json(readFixtureTask(taskId));
  const client = liveClient();
  if (!client) return Response.json({ error: "Live scanning is off in this deployment." }, { status: 503 });
  try {
    return Response.json(await readLiveTask(client, kind as TaskKind, taskId));
  } catch (err) {
    const status = err instanceof YouCamError ? err.status : 500;
    return Response.json({ status: "error", mode: "live", error: err instanceof Error ? err.message : "Polling failed" }, { status: status >= 400 ? status : 502 });
  }
}
