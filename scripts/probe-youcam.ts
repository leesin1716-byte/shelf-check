// 얼굴 없는 이미지로 네 가지 YouCam 태스크 요청 형식을 실서버에서 검증한다(엔진 실패 태스크는 유닛이 차감되지 않는다)
//
// npx tsx --env-file=.env.local scripts/probe-youcam.ts <image.png|jpg> [--face] [--only <task-kind>] [--save out.json]
//
// A request with a malformed body is rejected when the task is created (HTTP 400).
// A well-formed request on an image without a face is accepted and then ends in
// task_status "error" (e.g. error_no_face), and YouCam charges no units for failed tasks.
// So "created, then error_no_face" proves the request format without spending units.
// With --face (an image that has a face) the tasks succeed, cost units (about 35), and the
// results go through the app's normalizers, which checks the response shapes as well.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { YouCamClient, YouCamError } from "../lib/youcam/client";
import {
  buildMakeupRequest,
  buildSimulationRequest,
  buildSkinAnalysisRequest,
  buildSkinToneRequest,
} from "../lib/youcam/requests";
import { normalizeSkinAnalysis, normalizeSkinTone, resultImageUrl } from "../lib/youcam/normalize";
import type { SkinAnalysisJsonResults, SkinToneResults, TaskKind } from "../lib/youcam/types";

async function main() {
  const file = process.argv[2];
  const key = process.env.YOUCAM_API_KEY;
  if (!file || !key) throw new Error("Usage: YOUCAM_API_KEY=… tsx scripts/probe-youcam.ts <image>");
  const face = process.argv.includes("--face");
  const saveAt = process.argv.indexOf("--save");
  const saved: Record<string, unknown> = {};
  const client = new YouCamClient({ apiKey: key, baseUrl: process.env.YOUCAM_BASE_URL || undefined });
  const before = await client.getUnits();
  console.log(`units before: ${before}`);

  const type = path.extname(file).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
  const fileId = await client.uploadImage(readFileSync(file), type, path.basename(file));
  console.log("file upload: ok");
  const src = { src_file_id: fileId };

  const probes: [TaskKind, object][] = [
    ["skin-analysis", buildSkinAnalysisRequest(src)],
    ["skin-tone-analysis", buildSkinToneRequest(src)],
    [
      "skin-simulation",
      buildSimulationRequest(src, [
        { concern: "acne", intensity: 0.4 },
        { concern: "redness", intensity: 0.3 },
      ]),
    ],
    [
      "makeup-vto",
      buildMakeupRequest(src, {
        foundation: { hex: "#C99A7E", coverage: 40, glow: 30 },
        lip: { hex: "#B5525C", texture: "gloss", intensity: 60 },
        blush: { hex: "#D9837A", intensity: 40 },
      }),
    ],
  ];

  const onlyAt = process.argv.indexOf("--only");
  const only = onlyAt > 0 ? process.argv[onlyAt + 1] : undefined;
  for (const [kind, body] of probes) {
    if (only && kind !== only) continue;
    try {
      const id = await client.createTask(kind, body);
      const state = await client.waitForTask(kind, id, { intervalMs: 2500, timeoutMs: 120_000 });
      console.log(`${kind}: created, ended ${state.status} ${state.error ?? ""} ${state.errorMessage ?? ""}`.trim());
      if (face && state.status === "success") {
        saved[kind] = state.results;
        if (kind === "skin-analysis") {
          const scan = normalizeSkinAnalysis(state.results as SkinAnalysisJsonResults, { id: "probe", capturedAt: new Date().toISOString(), source: "live" });
          const scores = Object.entries(scan.concerns).map(([c, v]) => `${c}=${(v as { raw: number }).raw}`);
          console.log(`  normalized: mode=${scan.mode} overall=${scan.overall} concerns=${scores.length} ${scores.join(" ")}`);
        } else if (kind === "skin-tone-analysis") {
          console.log(`  normalized: ${JSON.stringify(normalizeSkinTone(state.results as SkinToneResults))}`);
        } else {
          console.log(`  result image: ${resultImageUrl(state.results) ? "found" : "MISSING"}`);
        }
      }
    } catch (err) {
      const e = err as YouCamError;
      console.log(`${kind}: REJECTED status=${e.status ?? "?"} code=${e.code ?? ""} ${e.message}`);
    }
  }
  if (saveAt > 0 && process.argv[saveAt + 1]) writeFileSync(process.argv[saveAt + 1], JSON.stringify(saved, null, 2));
  const after = await client.getUnits();
  console.log(`units after: ${after} (spent ${before - after})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
