// YouCam 클라이언트(업로드·태스크·폴링·429 재시도·유닛)와 요청 빌더·응답 정규화 테스트
import { describe, expect, it } from "vitest";
import { YouCamClient, YouCamError } from "@/lib/youcam/client";
import { buildMakeupRequest, buildSimulationRequest, buildSkinAnalysisRequest, FULL_HD_SCAN } from "@/lib/youcam/requests";
import { normalizeSkinAnalysis, normalizeSkinTone, resultImageUrl } from "@/lib/youcam/normalize";
import { unitCost } from "@/lib/youcam/types";

type Call = { url: string; init: RequestInit };
function fakeFetch(responses: Response[]) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected call ${url}`);
    return next;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const noSleep = async () => {};

describe("YouCamClient", () => {
  it("registers the file, then PUTs bytes to the presigned URL with the given headers", async () => {
    const { fn, calls } = fakeFetch([
      json({
        status: 200,
        data: {
          files: [
            {
              file_id: "FILE123",
              requests: [
                { method: "PUT", url: "https://s3.example/upload?sig", headers: { "Content-Type": "image/jpeg", "Content-Length": 4 } },
              ],
            },
          ],
        },
      }),
      new Response(null, { status: 200 }),
    ]);
    const c = new YouCamClient({ apiKey: "k", fetchImpl: fn, sleep: noSleep });
    const id = await c.uploadImage(new Uint8Array([1, 2, 3, 4]), "image/jpeg", "me.jpg");
    expect(id).toBe("FILE123");
    expect(calls[0].url).toBe("https://yce-api-01.makeupar.com/s2s/v2.0/file");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      files: [{ content_type: "image/jpeg", file_name: "me.jpg", file_size: 4 }],
    });
    expect(calls[1].url).toBe("https://s3.example/upload?sig");
    expect(calls[1].init.method).toBe("PUT");
    expect((calls[1].init.headers as Record<string, string>)["Content-Length"]).toBe("4");
  });

  it("refuses files of 10 MB or more before calling the API", async () => {
    const { fn, calls } = fakeFetch([]);
    const c = new YouCamClient({ apiKey: "k", fetchImpl: fn });
    await expect(c.uploadImage(new Uint8Array(10 * 1024 * 1024), "image/jpeg", "x.jpg")).rejects.toBeInstanceOf(YouCamError);
    expect(calls).toHaveLength(0);
  });

  it("retries 429 with the Retry-After delay, then creates the task on the versioned path", async () => {
    const waits: number[] = [];
    const { fn, calls } = fakeFetch([
      json({ error: "slow down" }, 429, { "retry-after": "2" }),
      json({ status: 200, data: { task_id: "T1" } }),
    ]);
    const c = new YouCamClient({ apiKey: "k", fetchImpl: fn, sleep: async (ms) => void waits.push(ms) });
    expect(await c.createTask("skin-analysis", { a: 1 })).toBe("T1");
    expect(waits).toEqual([2000]);
    expect(calls[1].url).toBe("https://yce-api-01.makeupar.com/s2s/v2.1/task/skin-analysis");
  });

  it("gives up after maxRetries and surfaces the status", async () => {
    const { fn } = fakeFetch([json({}, 503), json({}, 503)]);
    const c = new YouCamClient({ apiKey: "k", fetchImpl: fn, sleep: noSleep, maxRetries: 1 });
    await expect(c.createTask("skin-simulation", {})).rejects.toMatchObject({ status: 503 });
  });

  it("surfaces API error codes such as CreditInsufficiency", async () => {
    const { fn } = fakeFetch([
      json({ status: 400, error: "The operation could not be completed", error_code: "CreditInsufficiency" }, 400),
    ]);
    const c = new YouCamClient({ apiKey: "k", fetchImpl: fn });
    await expect(c.createTask("makeup-vto", {})).rejects.toMatchObject({ status: 400, code: "CreditInsufficiency" });
  });

  it("polls until the task leaves running", async () => {
    const { fn, calls } = fakeFetch([
      json({ status: 200, data: { task_status: "running" } }),
      json({ status: 200, data: { task_status: "success", results: { url: "https://r/x.jpg" } } }),
    ]);
    const c = new YouCamClient({ apiKey: "k", fetchImpl: fn, sleep: noSleep });
    const s = await c.waitForTask("makeup-vto", "ID/1");
    expect(s.status).toBe("success");
    expect(calls[0].url).toBe("https://yce-api-01.makeupar.com/s2s/v2.0/task/makeup-vto/ID%2F1");
    expect(resultImageUrl(s.results)).toBe("https://r/x.jpg");
  });

  it("reports engine errors without throwing", async () => {
    const { fn } = fakeFetch([
      json({ status: 200, data: { task_status: "error", error: "error_src_face_too_small", error_message: "face too small" } }),
    ]);
    const c = new YouCamClient({ apiKey: "k", fetchImpl: fn });
    expect(await c.getTask("skin-analysis", "T")).toMatchObject({ status: "error", error: "error_src_face_too_small" });
  });

  it("sums unit buckets using amount_dec", async () => {
    const { fn } = fakeFetch([json({ status: 200, results: [{ amount_dec: 980.5 }, { amount: 20 }] })]);
    const c = new YouCamClient({ apiKey: "k", fetchImpl: fn });
    expect(await c.getUnits()).toBe(1000.5);
  });
});

describe("request builders", () => {
  it("rejects mixing HD and SD concerns, as the API does", () => {
    expect(() => buildSkinAnalysisRequest({ src_file_id: "f" }, ["hd_acne", "pore"])).toThrow(/cannot mix/);
    expect(() => buildSkinAnalysisRequest({ src_file_id: "f" }, ["abc123" as never])).toThrow(/Not available/);
  });

  it("asks for JSON results with separate masks for the full HD scan", () => {
    const r = buildSkinAnalysisRequest({ src_file_id: "f" });
    expect(r.dst_actions).toHaveLength(16);
    expect(r.format).toBe("json");
    expect(r.miniserver_args?.enable_mask_overlay).toBe(false);
    expect(unitCost("skin-analysis", FULL_HD_SCAN.length, true)).toBe(22);
    expect(unitCost("skin-analysis", 4, false)).toBe(9);
  });

  it("maps concerns to simulation keys and clamps intensity", () => {
    const r = buildSimulationRequest({ src_file_url: "https://x/y.jpg" }, [
      { concern: "age_spot", intensity: 0.42 },
      { concern: "eye_bag", intensity: 3 },
      { concern: "oiliness", intensity: 0.5 },
    ]);
    expect(r).toEqual({ src_file_url: "https://x/y.jpg", spots: 0.42, eye_bags: 1 });
    expect(() => buildSimulationRequest({ src_file_id: "f" }, [{ concern: "acne", intensity: 0 }])).toThrow();
  });

  it("builds makeup effects with the companions each texture requires", () => {
    const r = buildMakeupRequest(
      { src_file_id: "f" },
      {
        foundation: { hex: "#D2A27F", coverage: 40, glow: 30 },
        lip: { hex: "#A65E62", texture: "gloss", intensity: 60 },
        blush: { hex: "#F2A07B", intensity: 30 },
      },
    );
    expect(r.version).toBe("1.0");
    expect(r.effects.map((e) => e.category)).toEqual(["skin_smooth", "foundation", "lip_color", "blush"]);
    const lip = r.effects.find((e) => e.category === "lip_color")!;
    expect(lip.palettes![0]).toMatchObject({ gloss: 50, transparencyIntensity: 50, texture: "gloss" });
    expect(r.effects.find((e) => e.category === "blush")!.pattern).toEqual({ name: "1color1" });
    expect(() => buildMakeupRequest({ src_file_id: "f" }, { lip: { hex: "red", texture: "matte", intensity: 1 } })).toThrow();
  });
});

describe("normalizers", () => {
  // Shape copied from the docs' format_json_success example.
  const docsExample = {
    output: [
      { type: "hd_wrinkle", region: "whole", raw_score: 25.3, ui_score: 25, mask_urls: ["https://m/w.jpg"] },
      { type: "hd_wrinkle", region: "forehead", raw_score: 20.1, ui_score: 20, mask_urls: ["https://m/wf.jpg"] },
      { type: "hd_pore", region: "whole", raw_score: 35.2, ui_score: 35, mask_urls: ["https://m/p.jpg"] },
      { type: "hd_pore", region: "nose", raw_score: 45.7, ui_score: 46, mask_urls: ["https://m/pn.jpg"] },
      { type: "hd_acne", region: "whole", raw_score: 12.5, ui_score: 13, mask_urls: ["https://m/a.jpg"] },
      { type: "hd_skin_type", region: "whole", skin_type: "Combination", mask_urls: [] },
      { type: "hd_skin_type", region: "t_zone", skin_type: "Oily", mask_urls: [] },
      { type: "hd_skin_type", region: "u_zone", skin_type: "Dry & Redness", mask_urls: [] },
      { type: "skin_age", score: 29 },
      { type: "all", score: 28.5 },
      { type: "resize_image", mask_urls: ["https://m/resized.jpg"] },
    ],
  };

  it("turns the documented JSON output into a scan", () => {
    const s = normalizeSkinAnalysis(docsExample, { id: "s", capturedAt: "2026-10-11", source: "live" });
    expect(s.mode).toBe("hd");
    expect(s.skinAge).toBe(29);
    expect(s.overall).toBe(28.5);
    expect(s.baseImageUrl).toBe("https://m/resized.jpg");
    expect(s.skinType).toEqual({ whole: "Combination", tZone: "Oily", uZone: "Dry & Redness" });
    expect(s.concerns.wrinkle).toMatchObject({ raw: 25.3, ui: 25, maskUrl: "https://m/w.jpg" });
    expect(s.concerns.wrinkle?.regions?.forehead).toMatchObject({ raw: 20.1 });
    expect(s.concerns.pore?.regions?.nose?.raw).toBe(45.7);
    expect(s.concerns.acne?.raw).toBe(12.5);
  });

  it("uses the worst region when only regional rows exist", () => {
    const s = normalizeSkinAnalysis(
      {
        output: [
          { type: "hd_pore", region: "nose", raw_score: 30, ui_score: 55 },
          { type: "hd_pore", region: "cheek", raw_score: 60, ui_score: 70 },
        ],
      },
      { id: "s", capturedAt: "x", source: "live" },
    );
    expect(s.concerns.pore?.raw).toBe(30);
  });

  it("accepts SD names and maps dark_circle_v2", () => {
    const s = normalizeSkinAnalysis(
      { output: [{ type: "dark_circle_v2", raw_score: 80.2, ui_score: 76 }, { type: "skin_type", region: "whole", skin_type: "Normal" }] },
      { id: "s", capturedAt: "x", source: "live" },
    );
    expect(s.mode).toBe("sd");
    expect(s.concerns.dark_circle?.raw).toBe(80.2);
    expect(s.skinType.whole).toBe("Normal");
  });

  it("rejects the zip result shape", () => {
    expect(() => normalizeSkinAnalysis("https://zip" as never, { id: "s", capturedAt: "x", source: "live" })).toThrow();
  });

  it("normalizes the tone result and both image result shapes", () => {
    expect(normalizeSkinTone({ color: { skin_color: "#b9947c", lip_color: "#D23245", eye_color_name: "Blue" } })).toEqual({
      skinHex: "#B9947C",
      lipHex: "#D23245",
      eyeColorName: "Blue",
      hairColorName: undefined,
    });
    expect(resultImageUrl({ url: "a" })).toBe("a");
    expect(resultImageUrl([{ download_url: "b" }])).toBe("b");
    expect(() => resultImageUrl({})).toThrow();
  });
});
