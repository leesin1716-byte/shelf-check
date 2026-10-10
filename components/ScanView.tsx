"use client";
// 스캔 결과 화면: 셀피와 고민별 마스크 오버레이, raw 점수 막대(심각도 색), 피부 타입·나이·색조
import { useMemo, useState } from "react";
import { CONCERN_LABEL, type Concern, type SkinScan } from "@/lib/domain/types";
import { prioritize } from "@/lib/rules/analysis";
import { undertoneOf } from "@/lib/rules/color";
import FaceMap from "./FaceMap";

const SEV_COLOR = { act: "var(--act)", watch: "var(--watch)", fine: "var(--fine)" } as const;

export default function ScanView({ scan, selfieUrl, loading }: { scan?: SkinScan; selfieUrl?: string; loading?: string }) {
  const priorities = useMemo(() => (scan ? prioritize(scan) : []), [scan]);
  const [selected, setSelected] = useState<Concern | null>(null);
  const base = scan?.baseImageUrl ?? selfieUrl;
  const mask = selected ? scan?.concerns[selected]?.maskUrl : undefined;

  if (!scan) {
    return (
      <div className="card" aria-busy="true">
        <span className="spin" /> {loading ?? "Analyzing with YouCam AI Skin Analysis…"}
      </div>
    );
  }

  return (
    <div className="grid-2">
      <div className="card">
        {base ? (
          <div className="photo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={base} alt="The analysed selfie" />
            {mask && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="mask" src={mask} alt={`${CONCERN_LABEL[selected!]} detection mask`} />
            )}
          </div>
        ) : (
          <FaceMap scan={scan} />
        )}
        {scan.tone && (
          <div className="tone-row small">
            <span className="swatch lg" style={{ background: scan.tone.skinHex }} aria-hidden />
            <div>
              <div>
                Skin tone <strong>{scan.tone.skinHex}</strong> · {undertoneOf(scan.tone.skinHex)} undertone
              </div>
              <div className="muted">
                YouCam Facial Color Tones{scan.tone.lipHex ? ` · lips ${scan.tone.lipHex}` : ""}
                {scan.tone.eyeColorName ? ` · ${scan.tone.eyeColorName.toLowerCase()} eyes` : ""}
              </div>
            </div>
            {scan.tone.lipHex && <span className="swatch" style={{ background: scan.tone.lipHex }} aria-hidden />}
          </div>
        )}
        {base && scan.concerns && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            Tap a concern to overlay its detection mask.
          </p>
        )}
      </div>

      <div className="card">
        <div className="facts">
          <div className="fact">
            <div className="k">Skin type</div>
            <div className="v">{scan.skinType.whole ?? "—"}</div>
          </div>
          <div className="fact">
            <div className="k">T-zone / U-zone</div>
            <div className="v">
              {scan.skinType.tZone ?? "—"} / {scan.skinType.uZone ?? "—"}
            </div>
          </div>
          <div className="fact">
            <div className="k">Skin age · overall</div>
            <div className="v">
              {scan.skinAge ?? "—"} · {scan.overall ?? "—"}
            </div>
          </div>
        </div>
        <div className="bars" role="list">
          {priorities.map((p) => (
            <button
              key={p.concern}
              role="listitem"
              className={`bar${selected === p.concern ? " sel" : ""}`}
              onClick={() => setSelected(selected === p.concern ? null : p.concern)}
              aria-pressed={selected === p.concern}
              title={p.topical ? undefined : "Structural: skincare cannot change this"}
            >
              <span className="name">
                {p.label}
                {!p.topical && <span className="muted"> *</span>}
              </span>
              <span className="track" aria-hidden>
                <span className="fill" style={{ width: `${p.raw}%`, background: SEV_COLOR[p.severity] }} />
              </span>
              <span className="num">
                {p.raw} <span className={`sev ${p.severity}`}>{p.severity}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="legend">
          <span>
            <span className="dot" style={{ background: "var(--act)" }} />
            act &lt; 50
          </span>
          <span>
            <span className="dot" style={{ background: "var(--watch)" }} />
            watch &lt; 70
          </span>
          <span>
            <span className="dot" style={{ background: "var(--fine)" }} />
            fine
          </span>
          <span>* structural, no product can change it</span>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Numbers are YouCam&apos;s <code>raw_score</code> (1–100, higher is healthier). YouCam also returns a friendlier{" "}
          <code>ui_score</code>; Shelf Check shows it but never decides on it.
          {scan.source === "sample" && " Sample data, not a real person."}
        </p>
      </div>
    </div>
  );
}
