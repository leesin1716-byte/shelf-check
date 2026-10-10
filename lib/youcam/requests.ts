// YouCam 태스크 요청 본문을 만들고 문서 제약(HD/SD 혼용 금지·강도 범위·패턴 이름)을 미리 검증한다
import {
  HD_ACTIONS,
  SD_ACTIONS,
  type FaceAngleStrictness,
  type MakeupEffect,
  type MakeupVtoRequest,
  type SimulationKey,
  type SkinAction,
  type SkinAnalysisRequest,
  type SkinSimulationRequest,
  type SkinToneRequest,
  type SourceRef,
} from "./types";
import type { Concern } from "../domain/types";

export function sourceRef(src: { fileId?: string; url?: string }): SourceRef {
  if (src.fileId) return { src_file_id: src.fileId };
  if (src.url) return { src_file_url: src.url };
  throw new Error("A YouCam task needs a file id or a public image URL");
}

/** Every concern we analyse, in HD. 16 actions = 22 units per scan. */
export const FULL_HD_SCAN: SkinAction[] = [...HD_ACTIONS];

export function buildSkinAnalysisRequest(src: SourceRef, actions: SkinAction[] = FULL_HD_SCAN): SkinAnalysisRequest {
  if (actions.length === 0) throw new Error("At least one skin concern is required");
  const hd = actions.filter((a) => (HD_ACTIONS as readonly string[]).includes(a));
  const sd = actions.filter((a) => (SD_ACTIONS as readonly string[]).includes(a));
  if (hd.length + sd.length !== actions.length) {
    const unknown = actions.filter((a) => !hd.includes(a) && !sd.includes(a));
    throw new Error(`Not available dst_action ${unknown.join(", ")}`);
  }
  // The API rejects mixed requests with "cannot mix HD and SD dst_actions".
  if (hd.length && sd.length) throw new Error("cannot mix HD and SD dst_actions");
  return {
    ...src,
    dst_actions: [...new Set(actions)],
    // Separate PNG masks per concern so the UI can toggle each overlay.
    miniserver_args: { enable_mask_overlay: false },
    format: "json",
  };
}

/** Our concern key -> Skin Simulation parameter. Oiliness is left out: its docs describe opposite directions. */
export const SIMULATION_KEY: Partial<Record<Concern, SimulationKey>> = {
  wrinkle: "wrinkle",
  radiance: "radiance",
  acne: "acne",
  eye_bag: "eye_bags",
  dark_circle: "dark_circle",
  age_spot: "spots",
  pore: "pores",
  texture: "texture",
  redness: "redness",
};

export function buildSimulationRequest(
  src: SourceRef,
  settings: { concern: Concern; intensity: number }[],
): SkinSimulationRequest {
  const body: SkinSimulationRequest = { ...src };
  for (const { concern, intensity } of settings) {
    const key = SIMULATION_KEY[concern];
    if (!key) continue;
    const v = Math.round(Math.min(1, Math.max(0, intensity)) * 100) / 100;
    if (v > 0) (body as Record<string, unknown>)[key] = v;
  }
  const count = Object.keys(body).filter((k) => !k.startsWith("src_")).length;
  if (count === 0) throw new Error("Skin Simulation needs at least one concern above 0");
  return body;
}

export function buildSkinToneRequest(src: SourceRef, strictness: FaceAngleStrictness = "medium"): SkinToneRequest {
  return { ...src, face_angle_strictness_level: strictness };
}

/** Pattern labels verified against plugins-media.makeupar.com/wcm-saas/patterns/blush.json and shapes/lipshape.json. */
export const BLUSH_PATTERNS = ["1color1", "1color2", "1color3", "2colors1"] as const;
export const LIP_SHAPES = ["original", "heart-shaped", "m-shaped", "petal", "plump", "pouty", "smile", "vintage"] as const;

const HEX = /^#[0-9a-fA-F]{6}$/;

export interface LookSpec {
  foundation?: { hex: string; coverage: number; glow: number };
  lip?: { hex: string; texture: "matte" | "satin" | "sheer" | "gloss"; intensity: number };
  blush?: { hex: string; intensity: number; pattern?: (typeof BLUSH_PATTERNS)[number] };
  /** Keep skin smoothing low so the preview does not hide the skin the user just analysed. */
  skinSmooth?: number;
}

export function buildMakeupRequest(src: SourceRef, look: LookSpec): MakeupVtoRequest {
  const effects: MakeupEffect[] = [];
  const pct = (n: number) => Math.round(Math.min(100, Math.max(0, n)));
  const check = (hex: string, what: string) => {
    if (!HEX.test(hex)) throw new Error(`${what} color must be #RRGGBB, got ${hex}`);
  };
  const smooth = pct(look.skinSmooth ?? 20);
  effects.push({ category: "skin_smooth", skinSmoothStrength: smooth, skinSmoothColorIntensity: smooth });
  if (look.foundation) {
    check(look.foundation.hex, "Foundation");
    effects.push({
      category: "foundation",
      palettes: [
        {
          color: look.foundation.hex,
          colorIntensity: 50,
          glowIntensity: pct(look.foundation.glow),
          coverageIntensity: pct(look.foundation.coverage),
        },
      ],
    });
  }
  if (look.lip) {
    check(look.lip.hex, "Lip");
    const palette: MakeupEffect["palettes"] = [
      { color: look.lip.hex, texture: look.lip.texture, colorIntensity: pct(look.lip.intensity) },
    ];
    // Required companions per lip_color texture (docs: gloss/sheer need gloss + transparencyIntensity).
    if (look.lip.texture === "gloss" || look.lip.texture === "sheer") {
      palette[0].gloss = 50;
      palette[0].transparencyIntensity = 50;
    }
    effects.push({ category: "lip_color", shape: { name: "original" }, style: { type: "full" }, palettes: palette });
  }
  if (look.blush) {
    check(look.blush.hex, "Blush");
    effects.push({
      category: "blush",
      pattern: { name: look.blush.pattern ?? "1color1" },
      palettes: [{ color: look.blush.hex, texture: "matte", colorIntensity: pct(look.blush.intensity) }],
    });
  }
  return { ...src, effects, version: "1.0" };
}
