// API 라우트·서비스 테스트: 픽스처 태스크 생성·폴링, 라이브 꺼짐 응답, IP 제한, 에이전트 라우트 입력 검증
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as createTask } from "@/app/api/youcam/tasks/route";
import { GET as pollTask } from "@/app/api/youcam/tasks/[kind]/[id]/route";
import { POST as upload } from "@/app/api/youcam/upload/route";
import { POST as agent } from "@/app/api/agent/route";
import { GET as status } from "@/app/api/status/route";
import { allowLiveScan, fixtureTaskId, liveRequestBody, readFixtureTask, LIVE_SCANS_PER_HOUR } from "@/lib/youcam/service";
import { personaInput } from "@/lib/agent/resolve";

const post = (body: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const poll = (kind: string, id: string) => pollTask(new Request("http://x"), { params: Promise.resolve({ kind, id: encodeURIComponent(id) }) });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("fixture tasks", () => {
  it("run briefly, then return the persona's normalized scan", () => {
    const id = fixtureTaskId("skin-analysis", "maya", "default", 1000);
    expect(readFixtureTask(id, 1500).status).toBe("running");
    const done = readFixtureTask(id, 5000);
    expect(done.status).toBe("success");
    expect(done.scan?.concerns.acne?.raw).toBe(38.2);
    expect(readFixtureTask(fixtureTaskId("skin-analysis", "lena", "previous", 0), 5000).scan?.capturedAt).toMatch(/^2026-08-27/);
  });

  it("returns no image until a live recording exists", () => {
    expect(readFixtureTask(fixtureTaskId("makeup-vto", "jun", "everyday", 0), 5000)).toMatchObject({ status: "success", imageUrl: null });
  });

  it("are created and polled through the routes without a YouCam key", async () => {
    vi.stubEnv("YOUCAM_API_KEY", "");
    const res = await createTask(post({ kind: "skin-tone-analysis", persona: "jun" }));
    const { taskId, mode } = await res.json();
    expect(mode).toBe("fixture");
    vi.useFakeTimers({ now: Date.now() + 5000 });
    const view = await (await poll("skin-tone-analysis", taskId)).json();
    expect(view).toMatchObject({ status: "success", tone: { skinHex: "#E2B89A" } });
  });
});

describe("live endpoints without a key", () => {
  it("refuse uploads and live tasks with a clear message", async () => {
    vi.stubEnv("YOUCAM_API_KEY", "");
    const up = await upload(new Request("http://x", { method: "POST", body: new Uint8Array([1]), headers: { "content-type": "image/jpeg" } }));
    expect(up.status).toBe(503);
    const t = await createTask(post({ kind: "skin-analysis", fileId: "abc" }));
    expect(t.status).toBe(503);
    const s = await (await status()).json();
    expect(s).toMatchObject({ youcam: "fixture", units: null });
  });

  it("validate the task body", async () => {
    const bad = await createTask(post({ kind: "hair-dye", persona: "maya" }));
    expect(bad.status).toBe(400);
    const tooStrong = await createTask(post({ kind: "skin-simulation", persona: "maya", simulation: [{ concern: "acne", intensity: 0.9 }] }));
    expect(tooStrong.status).toBe(400);
  });
});

describe("live request guards", () => {
  it("limits live scans per IP per hour", () => {
    const ip = `test-${Math.random()}`;
    for (let i = 0; i < LIVE_SCANS_PER_HOUR; i++) expect(allowLiveScan(ip, 1000)).toBe(true);
    expect(allowLiveScan(ip, 2000)).toBe(false);
    expect(allowLiveScan(ip, 1000 + 3600_001)).toBe(true);
  });

  it("prices each live request from the docs' unit tables", () => {
    expect(liveRequestBody({ kind: "skin-analysis", fileId: "f" }).units).toBe(22);
    expect(liveRequestBody({ kind: "skin-tone-analysis", fileId: "f" }).units).toBe(20);
    expect(liveRequestBody({ kind: "skin-simulation", fileId: "f", simulation: [{ concern: "acne", intensity: 0.3 }] }).units).toBe(4);
    expect(liveRequestBody({ kind: "makeup-vto", fileId: "f", look: { lip: { hex: "#A65E62", texture: "satin", intensity: 50 } } }).units).toBe(1);
  });
});

describe("agent route", () => {
  it("serves a demo scenario without any key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const r = await (await agent(post({ scenarioId: "maya" }))).json();
    expect(["cached", "offline"]).toContain(r.source);
    expect(r.plan.verdicts).toHaveLength(8);
  });

  it("plans a custom scan sent by the browser", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const input = personaInput("jun");
    const r = await (await agent(post({ input: { ...input, scan: { ...input.scan, source: "live" } } }))).json();
    expect(r.source).toBe("offline");
    expect(r.plan.cart[0].decision).toBe("wait");
  });

  it("rejects unknown products and scenarios", async () => {
    const input = personaInput("jun");
    expect((await agent(post({ input: { ...input, shelf: [{ productId: "fake" }] } }))).status).toBe(400);
    expect((await agent(post({ scenarioId: "nobody" }))).status).toBe(404);
  });
});
