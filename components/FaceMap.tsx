"use client";
// 사진이 없는 샘플 스캔용 얼굴 지도: 부위별로 가장 나쁜 고민의 심각도를 색으로 칠한다(점수 그대로의 도식)
import { CONCERN_LABEL, type Concern, type SkinScan } from "@/lib/domain/types";
import { severityOf } from "@/lib/rules/analysis";

const COLOR = { act: "#a8432c", watch: "#b98226", fine: "#3d7a5d" } as const;

type Zone = { id: string; label: string; concerns: [Concern, string?][]; shape: React.ReactNode; lx: number; ly: number };

function zoneScore(scan: SkinScan, concerns: [Concern, string?][]) {
  let worst: { concern: Concern; raw: number } | null = null;
  for (const [c, region] of concerns) {
    const s = scan.concerns[c];
    if (!s) continue;
    const raw = region && s.regions?.[region] ? s.regions[region].raw : s.raw;
    if (!worst || raw < worst.raw) worst = { concern: c, raw };
  }
  return worst;
}

export default function FaceMap({ scan }: { scan: SkinScan }) {
  const zones: Zone[] = [
    {
      id: "forehead",
      label: "Forehead",
      concerns: [["wrinkle", "forehead"], ["pore", "forehead"], ["oiliness"], ["texture"]],
      shape: <path d="M70 92 C78 50 202 50 210 92 L206 118 C170 108 110 108 74 118 Z" />,
      lx: 140,
      ly: 86,
    },
    {
      id: "eyes",
      label: "Under-eyes",
      concerns: [["dark_circle"], ["eye_bag"], ["wrinkle", "periocular"]],
      shape: (
        <>
          <ellipse cx="102" cy="166" rx="26" ry="9" />
          <ellipse cx="178" cy="166" rx="26" ry="9" />
        </>
      ),
      lx: 140,
      ly: 152,
    },
    {
      id: "nose",
      label: "Nose",
      concerns: [["pore", "nose"], ["oiliness"]],
      shape: <path d="M128 140 L152 140 L160 214 C150 222 130 222 120 214 Z" />,
      lx: 140,
      ly: 236,
    },
    {
      id: "cheeks",
      label: "Cheeks",
      concerns: [["acne"], ["redness"], ["pore", "cheek"], ["age_spot"], ["moisture"]],
      shape: (
        <>
          <ellipse cx="88" cy="214" rx="28" ry="30" />
          <ellipse cx="192" cy="214" rx="28" ry="30" />
        </>
      ),
      lx: 140,
      ly: 260,
    },
    {
      id: "chin",
      label: "Chin & jaw",
      concerns: [["acne"], ["wrinkle", "marionette"], ["firmness"]],
      shape: <path d="M106 282 C120 300 160 300 174 282 L168 300 C154 316 126 316 112 300 Z" />,
      lx: 140,
      ly: 334,
    },
  ];

  return (
    <div className="facemap">
      <svg viewBox="0 0 280 360" role="img" aria-label="Face map of the worst concern per zone">
        <ellipse cx="140" cy="182" rx="104" ry="140" fill="#efe5d8" stroke="#cfc3b3" />
        {zones.map((z) => {
          const w = zoneScore(scan, z.concerns);
          const sev = w ? severityOf(w.raw) : "fine";
          return (
            <g key={z.id} fill={COLOR[sev]} fillOpacity={sev === "fine" ? 0.18 : 0.42}>
              <title>{w ? `${z.label}: ${CONCERN_LABEL[w.concern]} ${w.raw}` : z.label}</title>
              {z.shape}
            </g>
          );
        })}
        {zones.map((z) => {
          const w = zoneScore(scan, z.concerns);
          return (
            <text key={z.id} x={z.lx} y={z.ly} textAnchor="middle" fontSize="10.5" fill="#57504a">
              {z.label}
              {w ? ` · ${CONCERN_LABEL[w.concern].toLowerCase()} ${w.raw}` : ""}
            </text>
          );
        })}
      </svg>
      <p className="small muted" style={{ margin: "6px 0 0", textAlign: "center" }}>
        Sample scan: each zone shows its worst YouCam score. Scan your own selfie to see the photo with YouCam&apos;s
        detection masks.
      </p>
    </div>
  );
}
