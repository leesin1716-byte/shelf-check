// 데모 페르소나 사진으로 YouCam 을 실제 호출해 결과·마스크·미리보기 이미지를 public/fixtures 와 lib/fixtures/recorded.ts 에 녹화한다
//
// Two phases, because the preview depends on the agent's plan for the recorded scan:
//   1. npm run record:youcam -- scan --photo maya=photos/maya.jpg [--photo lena=… --before lena=…]
//      Skin Analysis HD (16 concerns) + Skin Tone, masks downloaded (result URLs expire after 2 hours).
//   2. npm run precompute -- maya            (the scan changed, so the agent runs again)
//   3. npm run record:youcam -- preview --photo maya=photos/maya.jpg
//      Skin Simulation + two Makeup VTO looks from the agent's plan for that scan.
// Add --dry-run to print the requests and unit cost without calling YouCam. A photo can be a path or a public URL.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { YouCamClient } from "../lib/youcam/client";
import {
  buildMakeupRequest,
  buildSimulationRequest,
  buildSkinAnalysisRequest,
  buildSkinToneRequest,
  FULL_HD_SCAN,
} from "../lib/youcam/requests";
import { resultImageUrl } from "../lib/youcam/normalize";
import { unitCost, type SkinAnalysisJsonResults, type SkinToneResults, type SourceRef, type TaskKind } from "../lib/youcam/types";
import { getPersona } from "../lib/fixtures/personas";
import { RECORDED, type RecordedPersona } from "../lib/fixtures/recorded";
import { personaInput, resolvePlan } from "../lib/agent/resolve";
import { lookSpec } from "../lib/rules/color";

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public", "fixtures");
const RECORDED_FILE = path.join(ROOT, "lib", "fixtures", "recorded.ts");

type Phase = "scan" | "preview";

function parseArgs(argv: string[]) {
  const phase = argv[0] as Phase;
  if (phase !== "scan" && phase !== "preview") throw new Error('First argument must be "scan" or "preview"');
  const photos = new Map<string, string>();
  const befores = new Map<string, string>();
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i];
    if (flag !== "--photo" && flag !== "--before") continue;
    const [id, src] = (argv[++i] ?? "").split(/=(.*)/s);
    if (!id || !src) throw new Error(`${flag} needs persona=path`);
    if (!getPersona(id)) throw new Error(`Unknown persona "${id}"`);
    (flag === "--photo" ? photos : befores).set(id, src);
  }
  if (photos.size === 0) throw new Error("Give at least one --photo persona=path");
  return { phase, photos, befores, dryRun: argv.includes("--dry-run") };
}

const isUrl = (s: string) => /^https?:\/\//i.test(s);

async function sourceFor(client: YouCamClient | null, src: string): Promise<SourceRef> {
  if (isUrl(src)) return { src_file_url: src };
  if (!client) return { src_file_id: `<upload ${path.basename(src)}>` };
  const ext = path.extname(src).toLowerCase();
  const type = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : null;
  if (!type) throw new Error(`${src}: YouCam takes .jpg or .png`);
  return { src_file_id: await client.uploadImage(readFileSync(src), type, path.basename(src)) };
}

async function download(url: string, dir: string, name: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${name}`);
  const type = res.headers.get("content-type") ?? "";
  const ext = type.includes("png") ? ".png" : type.includes("webp") ? ".webp" : ".jpg";
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name + ext);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return "/" + path.relative(path.join(ROOT, "public"), file).split(path.sep).join("/");
}

/** Replaces the 2-hour YouCam mask URLs with files saved under public/fixtures/<id>/<folder>/. */
async function localizeMasks(results: SkinAnalysisJsonResults, id: string, folder: string): Promise<SkinAnalysisJsonResults> {
  const dir = path.join(PUBLIC_DIR, id, folder);
  const output = [];
  for (const item of results.output) {
    const urls = [];
    for (const [i, url] of (item.mask_urls ?? []).entries()) {
      const name = [item.type, item.region, i ? String(i) : ""].filter(Boolean).join("-");
      urls.push(await download(url, dir, name));
    }
    output.push(urls.length ? { ...item, mask_urls: urls } : item);
  }
  return { ...results, output };
}

async function run<R>(client: YouCamClient | null, kind: TaskKind, body: object, units: number, label: string): Promise<R | null> {
  console.log(`  ${label}: ${kind}, ${units} unit(s)`);
  if (!client) {
    console.log("    " + JSON.stringify(body));
    return null;
  }
  const taskId = await client.createTask(kind, body);
  const state = await client.waitForTask<R>(kind, taskId, { intervalMs: 2500, timeoutMs: 180_000 });
  if (state.status !== "success") throw new Error(`${label} failed: ${state.errorMessage || state.error || state.status}`);
  return state.results ?? null;
}

function writeRecorded(all: Record<string, RecordedPersona | undefined>) {
  const header =
    "// 실제 YouCam 호출을 녹화한 페르소나 결과(scripts/record-youcam.ts 가 덮어쓴다). 비어 있으면 합성 샘플을 쓴다\n";
  const src = readFileSync(RECORDED_FILE, "utf8");
  const types = src.slice(src.indexOf("import type"), src.indexOf("export const RECORDED"));
  const body = `export const RECORDED: Record<string, RecordedPersona | undefined> = ${JSON.stringify(all, null, 2)};\n`;
  writeFileSync(RECORDED_FILE, header + types + body);
}

async function main() {
  const { phase, photos, befores, dryRun } = parseArgs(process.argv.slice(2));
  const key = process.env.YOUCAM_API_KEY;
  if (!dryRun && !key) throw new Error("Set YOUCAM_API_KEY (or add --dry-run)");
  const client = dryRun ? null : new YouCamClient({ apiKey: key!, baseUrl: process.env.YOUCAM_BASE_URL || undefined });

  // Unit budget first: nothing is spent unless the whole batch fits.
  let planned = 0;
  for (const id of photos.keys()) {
    if (phase === "scan") {
      planned += unitCost("skin-analysis", FULL_HD_SCAN.length, true) + unitCost("skin-tone-analysis");
      if (getPersona(id)!.previousScan) {
        if (!befores.has(id)) throw new Error(`${id} compares two scans: also give --before ${id}=<earlier photo>`);
        planned += unitCost("skin-analysis", FULL_HD_SCAN.length, true);
      }
    } else {
      planned += unitCost("skin-simulation", 4) + 2 * unitCost("makeup-vto");
    }
  }
  const balance = client ? await client.getUnits() : null;
  console.log(`Phase ${phase}: about ${planned} units planned${balance !== null ? `, ${Math.floor(balance)} available` : " (dry run)"}`);
  if (balance !== null && balance < planned) throw new Error("Not enough YouCam units for this batch");

  const all: Record<string, RecordedPersona | undefined> = { ...RECORDED };
  for (const [id, photo] of photos) {
    console.log(`${id} <- ${photo}`);
    const src = await sourceFor(client, photo);
    const prev = all[id];

    if (phase === "scan") {
      const analysis = await run<SkinAnalysisJsonResults>(
        client, "skin-analysis", buildSkinAnalysisRequest(src), unitCost("skin-analysis", FULL_HD_SCAN.length, true), "analysis",
      );
      const tone = await run<SkinToneResults>(client, "skin-tone-analysis", buildSkinToneRequest(src), unitCost("skin-tone-analysis"), "tone");
      let previous: SkinAnalysisJsonResults | null = null;
      const before = befores.get(id);
      if (before) {
        const beforeSrc = await sourceFor(client, before);
        previous = await run<SkinAnalysisJsonResults>(
          client, "skin-analysis", buildSkinAnalysisRequest(beforeSrc), unitCost("skin-analysis", FULL_HD_SCAN.length, true), "previous analysis",
        );
      }
      if (!client || !analysis || !tone) continue;
      all[id] = {
        recordedAt: new Date().toISOString(),
        selfie: isUrl(photo) ? photo : await copySelfie(id, photo),
        analysis: await localizeMasks(analysis, id, "masks"),
        previousAnalysis: previous ? await localizeMasks(previous, id, "masks-before") : undefined,
        tone: tone.color,
      };
      writeRecorded(all);
      console.log(`  saved. Run "npm run precompute -- ${id}" next, then the preview phase.`);
    } else {
      if (!prev && client) throw new Error(`${id}: record the scan phase first`);
      const resolved = await resolvePlan(personaInput(id), id, false);
      console.log(`  plan source: ${resolved.source}${resolved.source !== "cached" ? " (run npm run precompute first for the agent's own plan)" : ""}`);
      const plan = resolved.plan;
      const sim = await run<unknown>(
        client, "skin-simulation", buildSimulationRequest(src, plan.preview.concerns), unitCost("skin-simulation", plan.preview.concerns.length), "simulation",
      );
      const looks: Record<string, string> = {};
      for (const [name, lip] of [["everyday", plan.look.everyday_lip_id], ["statement", plan.look.statement_lip_id]] as const) {
        const res = await run<unknown>(client, "makeup-vto", buildMakeupRequest(src, lookSpec(plan.look, lip)), unitCost("makeup-vto"), `${name} look`);
        const url = res ? resultImageUrl(res) : null;
        if (url) looks[name] = await download(url, path.join(PUBLIC_DIR, id), `look-${name}`);
      }
      if (!client || !prev) continue;
      const simUrl = sim ? resultImageUrl(sim) : null;
      all[id] = {
        ...prev,
        simulation: simUrl ? await download(simUrl, path.join(PUBLIC_DIR, id), "simulation") : undefined,
        looks,
      };
      writeRecorded(all);
      console.log("  saved.");
    }
  }
  if (client) console.log(`Units left: ${Math.floor(await client.getUnits())}`);
}

async function copySelfie(id: string, file: string): Promise<string> {
  const dir = path.join(PUBLIC_DIR, id);
  mkdirSync(dir, { recursive: true });
  const name = "selfie" + path.extname(file).toLowerCase();
  writeFileSync(path.join(dir, name), readFileSync(file));
  return `/fixtures/${id}/${name}`;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
