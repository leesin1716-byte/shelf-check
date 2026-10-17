// 2026-10-18 실서버 YouCam 응답(퍼블릭 도메인 합성 얼굴)으로 정규화기가 실제 응답 형식을 읽는지 고정하는 테스트
import { describe, expect, it } from "vitest";
import live from "./fixtures/youcam-skin-analysis-hd-20261018.json";
import { normalizeSkinAnalysis, normalizeSkinTone, resultImageUrl } from "@/lib/youcam/normalize";
import { FULL_HD_SCAN } from "@/lib/youcam/requests";
import type { SkinAnalysisJsonResults } from "@/lib/youcam/types";

// Recorded from the live API with scripts/probe-youcam.ts on a public-domain GAN face.
// Mask URLs (presigned, 2-hour) were replaced with placeholders; everything else is verbatim.
describe("live YouCam response shapes (2026-10-18)", () => {
  const scan = normalizeSkinAnalysis(live as SkinAnalysisJsonResults, {
    id: "live",
    capturedAt: "2026-10-18T05:54:57Z",
    source: "recorded",
  });

  it("reads every concern of the 16-action HD request, plus overall score, skin age and skin type", () => {
    expect(scan.mode).toBe("hd");
    expect(Object.keys(scan.concerns)).toHaveLength(FULL_HD_SCAN.length - 1); // skin type is not a scored concern
    expect(scan.overall).toBe(80);
    expect(scan.skinAge).toBe(43);
    expect(scan.skinType).toEqual({ whole: "Oily", tZone: "Oily", uZone: "Oily" });
  });

  it("keeps raw and ui scores apart and collects regional scores with their masks", () => {
    expect(scan.concerns.wrinkle).toMatchObject({ raw: 57.2, ui: 68 });
    expect(Object.keys(scan.concerns.wrinkle!.regions!)).toEqual(
      expect.arrayContaining(["forehead", "glabellar", "crowfeet", "periocular", "nasolabial", "marionette"]),
    );
    expect(scan.concerns.pore!.regions!.forehead).toMatchObject({ raw: 70.7, maskUrl: expect.stringContaining("forehead") });
    expect(scan.concerns.redness!.maskUrl).toBeTruthy();
  });

  it("ignores the extra resize_image item the HD engine returns", () => {
    expect(Object.keys(scan.concerns)).not.toContain("resize_image");
  });

  it("reads skin tone and image results in the shape the live API returns", () => {
    const tone = normalizeSkinTone({
      color: { eye_color: "#2c1b14", eye_color_name: "Brown", lip_color: "#ba7165", eyebrow_color: "#825840", skin_color: "#a47e60" },
    } as never);
    expect(tone).toMatchObject({ skinHex: "#A47E60", lipHex: "#BA7165", eyeColorName: "Brown" });
    expect(resultImageUrl({ url: "https://example.invalid/sim.jpg" })).toBe("https://example.invalid/sim.jpg");
  });
});
