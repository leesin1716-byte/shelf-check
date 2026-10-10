"use client";
// 미리보기: YouCam Skin Simulation(보수 상한 강도, 전후 슬라이더)과 Makeup VTO 룩(측정 셰이드·립·블러시)
import { useState } from "react";
import type { Plan } from "@/lib/agent/plan";
import type { Product } from "@/lib/catalog/products";
import { CONCERN_LABEL, type SkinScan } from "@/lib/domain/types";
import { deltaE2000, hexToLab } from "@/lib/rules/color";
import { MAX_PREVIEW_INTENSITY } from "@/lib/rules/progress";

export interface PreviewImages {
  simulation?: string | null;
  looks: Partial<Record<"everyday" | "statement", string | null>>;
  loading?: boolean;
  error?: string;
}

export default function PreviewView({
  plan,
  scan,
  byId,
  before,
  images,
  live,
}: {
  plan: Plan;
  scan: SkinScan;
  byId: Map<string, Product>;
  before?: string;
  images: PreviewImages;
  live: boolean;
}) {
  const [split, setSplit] = useState(50);
  const [look, setLook] = useState<"everyday" | "statement">("everyday");
  const foundation = byId.get(plan.look.foundation_id);
  const lip = byId.get(look === "everyday" ? plan.look.everyday_lip_id : plan.look.statement_lip_id);
  const blush = byId.get(plan.look.blush_id);
  const dE =
    foundation?.shade && scan.tone ? Math.round(deltaE2000(hexToLab(scan.tone.skinHex), hexToLab(foundation.shade.hex)) * 10) / 10 : null;
  const lookImg = images.looks[look];

  return (
    <div className="grid-even">
      <div className="card">
        <div className="sev fine">Skin Simulation · {plan.preview.horizon_weeks} weeks</div>
        <p className="small muted">
          What sticking to this routine could realistically look like. Intensities are capped at {MAX_PREVIEW_INTENSITY} of
          YouCam&apos;s scale so the preview never promises a full correction.
        </p>
        {images.simulation && before ? (
          <div className="compareimg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={images.simulation} alt="Simulated skin after the routine" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={before} alt="Your skin today" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />
            <input
              type="range"
              min={0}
              max={100}
              value={split}
              onChange={(e) => setSplit(Number(e.target.value))}
              aria-label="Compare today and the simulated result"
            />
          </div>
        ) : (
          <div className="placeholder">
            {images.loading ? (
              <span>
                <span className="spin" /> Rendering with YouCam Skin Simulation…
              </span>
            ) : images.error ? (
              <span className="error">{images.error}</span>
            ) : (
              <span>
                {live
                  ? "Preview unavailable for this scan."
                  : "The photo preview renders on a live selfie scan. Demo personas show the settings the agent chose."}
              </span>
            )}
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          {plan.preview.concerns.map((c) => (
            <div className="intensity" key={c.concern}>
              <span>{CONCERN_LABEL[c.concern]}</span>
              <span className="track" aria-hidden>
                <span className="val" style={{ width: `${c.intensity * 100}%` }} />
                <span className="cap" style={{ left: `${MAX_PREVIEW_INTENSITY * 100}%` }} />
              </span>
              <span className="small">{c.intensity}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div className="sev watch">Makeup Virtual Try-On</div>
          <div className="seg" role="group" aria-label="Look">
            <button className={look === "everyday" ? "on" : ""} onClick={() => setLook("everyday")}>
              Everyday
            </button>
            <button className={look === "statement" ? "on" : ""} onClick={() => setLook("statement")}>
              Statement
            </button>
          </div>
        </div>
        <p className="small muted">{plan.look.note}</p>
        {lookImg ? (
          <div className="compareimg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lookImg} alt={`${look} look try-on`} />
          </div>
        ) : (
          <div className="placeholder" style={{ minHeight: 120 }}>
            {images.loading ? (
              <span>
                <span className="spin" /> Applying the look with YouCam Makeup VTO…
              </span>
            ) : (
              <span>{live ? "Try-on unavailable for this scan." : "The try-on renders on a live selfie scan."}</span>
            )}
          </div>
        )}
        <div className="shades" style={{ marginTop: 14 }}>
          {foundation?.shade && (
            <div className="shade">
              {scan.tone && <span className="swatch lg" style={{ background: scan.tone.skinHex }} title="Your measured skin" />}
              <span className="swatch lg" style={{ background: foundation.shade.hex }} title={foundation.shade.label} />
              <span>
                <strong>{foundation.name}</strong>
                <br />
                <span className="muted small">{dE !== null ? `ΔE2000 ${dE} from your measured skin tone · ` : ""}${foundation.priceUsd}</span>
              </span>
            </div>
          )}
          {lip?.shade && (
            <div className="shade">
              <span className="swatch lg" style={{ background: lip.shade.hex }} />
              <span>
                <strong>{lip.name}</strong>
                <br />
                <span className="muted small">
                  {lip.texture} · ${lip.priceUsd}
                </span>
              </span>
            </div>
          )}
          {blush?.shade && (
            <div className="shade">
              <span className="swatch lg" style={{ background: blush.shade.hex }} />
              <span>
                <strong>{blush.name}</strong>
                <br />
                <span className="muted small">${blush.priceUsd}</span>
              </span>
            </div>
          )}
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Makeup is optional and never counted in your skincare spend.
        </p>
      </div>
    </div>
  );
}
