"use client";
// 재스캔 비교: 고민별 raw 점수 변화(±4 노이즈 표시)와 새로 시작한 제품별 효과 판정
import type { Product } from "@/lib/catalog/products";
import { CONCERN_LABEL, type ShelfItem, type SkinScan } from "@/lib/domain/types";
import { compareScans, NOISE_BAND } from "@/lib/rules/progress";

const VERDICT_LABEL = {
  working: "working",
  too_early: "too early",
  no_change_yet: "no change yet",
  not_working: "not working",
  irritating: "irritating",
} as const;
const VERDICT_PILL = { working: "keep", too_early: "alternate", no_change_yet: "alternate", not_working: "drop", irritating: "pause" } as const;

export default function ProgressView({
  before,
  after,
  shelf,
  byId,
}: {
  before: SkinScan;
  after: SkinScan;
  shelf: ShelfItem[];
  byId: Map<string, Product>;
}) {
  const report = compareScans(before, after, shelf);
  return (
    <div className="grid-even">
      <div className="card">
        <div className="sev fine" style={{ marginBottom: 8 }}>
          {before.capturedAt.slice(0, 10)} → {after.capturedAt.slice(0, 10)} · {report.weeksBetween} weeks
        </div>
        <table className="progress">
          <thead>
            <tr>
              <th>Concern</th>
              <th className="n">Before</th>
              <th className="n">Now</th>
              <th className="n">Change</th>
            </tr>
          </thead>
          <tbody>
            {report.deltas.map((d) => (
              <tr key={d.concern}>
                <td>{CONCERN_LABEL[d.concern]}</td>
                <td className="n">{d.before}</td>
                <td className="n">{d.after}</td>
                <td className={`n ${d.delta >= NOISE_BAND ? "up" : d.delta <= -NOISE_BAND ? "down" : "noise"}`}>
                  {d.delta > 0 ? "+" : ""}
                  {d.delta}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Grey changes are inside ±{NOISE_BAND} points, which a rescan can show from lighting alone.
        </p>
      </div>
      <div className="card">
        <div className="sev watch" style={{ marginBottom: 8 }}>
          Products you started since the first scan
        </div>
        <div className="verdicts">
          {report.products.length === 0 && <p className="muted">Nothing new was started since the first scan.</p>}
          {report.products.map((p) => (
            <div className="verdict" key={p.productId}>
              <span className={`pill ${VERDICT_PILL[p.verdict]}`}>{VERDICT_LABEL[p.verdict]}</span>
              <div>
                <div className="nm">
                  {byId.get(p.productId)?.brand} {byId.get(p.productId)?.name}
                </div>
                <p>{p.why}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
