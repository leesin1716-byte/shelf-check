// YouCam API 요청·응답의 타입 정의(docs.perfectcorp.com OpenAPI 번들 기준)
// Shapes follow the OpenAPI bundles at docs.perfectcorp.com/_bundle/reference/*.yaml (fetched 2026-10-11).

export type TaskKind = "skin-analysis" | "skin-simulation" | "skin-tone-analysis" | "makeup-vto";

/** Version segment of the task path for each feature. Skin Analysis v2.1 has the newer engine. */
export const TASK_PATH: Record<TaskKind, string> = {
  "skin-analysis": "/s2s/v2.1/task/skin-analysis",
  "skin-simulation": "/s2s/v2.0/task/skin-simulation",
  "skin-tone-analysis": "/s2s/v2.0/task/skin-tone-analysis",
  "makeup-vto": "/s2s/v2.0/task/makeup-vto",
};

/** Units charged per successful task (docs "Unit Consumption" tables). */
export function unitCost(kind: TaskKind, concernCount = 0, hd = true): number {
  switch (kind) {
    case "skin-analysis": {
      const tier = concernCount <= 4 ? 0 : concernCount <= 8 ? 1 : concernCount <= 12 ? 2 : 3;
      return (hd ? [12, 16, 20, 22] : [9, 12, 14, 16])[tier];
    }
    case "skin-simulation":
      return concernCount <= 4 ? 4 : 6;
    case "skin-tone-analysis":
      return 20;
    case "makeup-vto":
      return 1;
  }
}

export const HD_ACTIONS = [
  "hd_wrinkle",
  "hd_pore",
  "hd_texture",
  "hd_acne",
  "hd_oiliness",
  "hd_radiance",
  "hd_eye_bag",
  "hd_age_spot",
  "hd_dark_circle",
  "hd_droopy_upper_eyelid",
  "hd_droopy_lower_eyelid",
  "hd_firmness",
  "hd_moisture",
  "hd_redness",
  "hd_tear_trough",
  "hd_skin_type",
] as const;

export const SD_ACTIONS = [
  "wrinkle",
  "pore",
  "texture",
  "acne",
  "oiliness",
  "radiance",
  "eye_bag",
  "age_spot",
  "dark_circle_v2",
  "droopy_upper_eyelid",
  "droopy_lower_eyelid",
  "firmness",
  "moisture",
  "redness",
  "tear_trough",
  "skin_type",
] as const;

export type SkinAction = (typeof HD_ACTIONS)[number] | (typeof SD_ACTIONS)[number];

export type SourceRef = { src_file_id: string } | { src_file_url: string };

export interface SkinAnalysisRequest {
  src_file_id?: string;
  src_file_url?: string;
  dst_actions: SkinAction[];
  miniserver_args?: {
    enable_mask_overlay?: boolean;
    enable_dark_background_hd_pore?: boolean;
    color_dark_background_hd_pore?: string;
    opacity_dark_background_hd_pore?: number;
  };
  format: "json" | "zip";
}

/** One entry of `results.output` when format=json. */
export interface SkinAnalysisOutputItem {
  type: string; // e.g. "hd_pore", "skin_age", "all", "resize_image"
  region?: string;
  raw_score?: number;
  ui_score?: number;
  score?: number;
  skin_type?: string;
  mask_urls?: string[];
}

export interface SkinAnalysisJsonResults {
  output: SkinAnalysisOutputItem[];
}

export type SimulationKey =
  | "wrinkle"
  | "radiance"
  | "oiliness"
  | "acne"
  | "eye_bags"
  | "dark_circle"
  | "spots"
  | "pores"
  | "texture"
  | "redness";

export type SkinSimulationRequest = SourceRef & Partial<Record<SimulationKey, number>>;

export type FaceAngleStrictness = "strict" | "high" | "medium" | "low" | "flexible";

export type SkinToneRequest = SourceRef & { face_angle_strictness_level?: FaceAngleStrictness };

export interface SkinToneResults {
  face_quality?: Record<string, unknown>;
  color: {
    eye_color?: string;
    eye_color_name?: string;
    lip_color?: string;
    eyebrow_color?: string;
    skin_color: string;
    hair_color?: string;
    hair_color_name?: string;
  };
}

export interface MakeupPalette {
  color: string;
  texture?: string;
  colorIntensity?: number;
  [extra: string]: string | number | undefined;
}

export interface MakeupEffect {
  category: string;
  pattern?: { name: string };
  shape?: { name: string };
  style?: { type: "full" | "ombre" | "twoTone"; innerRatio?: number; featherStrength?: number };
  palettes?: MakeupPalette[];
  skinSmoothStrength?: number;
  skinSmoothColorIntensity?: number;
}

export type MakeupVtoRequest = SourceRef & { effects: MakeupEffect[]; version: "1.0" };

export type TaskStatus = "running" | "success" | "error";

export interface TaskState<R = unknown> {
  status: TaskStatus;
  results?: R;
  error?: string;
  errorMessage?: string;
}

export interface FileUploadTicket {
  file_id: string;
  requests: { method: string; url: string; headers: Record<string, string | number> }[];
}
