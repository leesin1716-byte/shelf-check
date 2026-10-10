// 실제 YouCam 호출을 녹화한 페르소나 결과(scripts/record-youcam.ts 가 덮어쓴다). 비어 있으면 합성 샘플을 쓴다
import type { SkinAnalysisOutputItem, SkinToneResults } from "../youcam/types";

export interface RecordedPersona {
  recordedAt: string;
  /** Public path of the selfie that was analysed, e.g. /fixtures/maya/selfie.jpg */
  selfie: string;
  analysis: { output: SkinAnalysisOutputItem[] };
  previousAnalysis?: { output: SkinAnalysisOutputItem[] };
  tone: SkinToneResults["color"];
  /** Public path of the Skin Simulation result. */
  simulation?: string;
  /** Makeup VTO results keyed by look name ("everyday", "statement"). */
  looks?: Record<string, string>;
}

export const RECORDED: Record<string, RecordedPersona | undefined> = {};
