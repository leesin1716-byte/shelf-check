// 데모가 어떤 모드로 도는지(YouCam 실호출/픽스처, 에이전트 실호출/재생)와 남은 유닛을 알려준다
import { liveClient } from "@/lib/youcam/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const client = liveClient();
  let units: number | null = null;
  if (client) {
    try {
      units = Math.floor(await client.getUnits());
    } catch {
      units = null;
    }
  }
  return Response.json({
    youcam: client ? "live" : "fixture",
    units,
    reserve: Number(process.env.YOUCAM_UNIT_RESERVE ?? 300),
    agent: process.env.ANTHROPIC_API_KEY ? "live" : "replay",
  });
}
