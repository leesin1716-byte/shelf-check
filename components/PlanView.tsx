"use client";
// 에이전트 결과 화면: 헤드라인·절약 비교·선반 판정·장바구니·구매·건너뛸 것·아침/저녁 루틴·주의
import type { Plan } from "@/lib/agent/plan";
import type { Product } from "@/lib/catalog/products";
import type { ScenarioInput } from "@/lib/domain/types";
import { CONCERN_LABEL } from "@/lib/domain/types";
import { naiveCart } from "@/lib/rules/shopping";
import { NIGHTS } from "@/lib/rules/routine";
import ProductCard from "./ProductCard";

export default function PlanView({ plan, input, byId }: { plan: Plan; input: ScenarioInput; byId: Map<string, Product> }) {
  const name = (id: string) => {
    const p = byId.get(id);
    return p ? `${p.brand} ${p.name}` : id;
  };
  const naive = naiveCart(input.scan);
  const buyIds = [...new Set([...plan.buy.map((b) => b.product_id), ...plan.cart.filter((c) => c.decision === "buy").map((c) => c.product_id)])];
  const spend = buyIds.reduce((s, id) => s + (byId.get(id)?.priceUsd ?? 0), 0);
  const max = Math.max(naive.totalUsd, spend, 1);
  const owned = naive.productIds.filter((id) => input.shelf.some((s) => s.productId === id)).length;

  return (
    <div>
      <h2 className="headline">{plan.headline}</h2>
      <p className="summary">{plan.summary}</p>

      <div className="compare" aria-label="Spend comparison">
        <div className="row">
          <span>
            <strong>Shelf Check</strong> · {buyIds.length} {buyIds.length === 1 ? "product" : "products"}
          </span>
          <div className="meter">
            <div style={{ width: `${(spend / max) * 100}%`, background: "var(--keep)" }} />
          </div>
          <strong>${spend}</strong>
        </div>
        <div className="row">
          <span className="muted">A product for every flagged concern · {naive.productIds.length}</span>
          <div className="meter">
            <div style={{ width: `${(naive.totalUsd / max) * 100}%`, background: "var(--line-2)" }} />
          </div>
          <span className="muted">${naive.totalUsd}</span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          The second row is what a &quot;matches your skin concerns&quot; recommender would sell from the same catalog
          {owned ? `, including ${owned} product${owned > 1 ? "s" : ""} already on this shelf` : ""}
          {naive.conflicts ? ` and ${naive.conflicts} same-night ingredient clash${naive.conflicts > 1 ? "es" : ""}` : ""}.
        </p>
      </div>

      <h3>Your shelf, product by product</h3>
      <div className="verdicts">
        {plan.verdicts.map((v) => (
          <div className={`verdict ${v.action}`} key={v.product_id}>
            <span className={`pill ${v.action}`}>{v.action}</span>
            <div>
              <div className="nm">{name(v.product_id)}</div>
              <p>{v.reason}</p>
              {v.evidence.length > 0 && (
                <div className="tags ev">
                  {v.evidence.map((c) => (
                    <span className="tag" key={c}>
                      {CONCERN_LABEL[c]} {input.scan.concerns[c]?.raw ?? ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {plan.cart.length > 0 && (
        <>
          <h3>The thing in your cart</h3>
          <div className="verdicts">
            {plan.cart.map((c) => (
              <div className="verdict" key={c.product_id}>
                <span className={`pill ${c.decision}`}>{c.decision}</span>
                <div>
                  <div className="nm">
                    {name(c.product_id)} · ${byId.get(c.product_id)?.priceUsd}
                  </div>
                  <p>{c.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h3>{plan.buy.length ? "Buy only this" : "Buy nothing new"}</h3>
      {plan.buy.length ? (
        <div className="products">
          {plan.buy.map((b) => (
            <ProductCard key={b.product_id} product={byId.get(b.product_id)!} ribbon="Buy" note={b.reason} />
          ))}
        </div>
      ) : (
        <p className="muted">Everything you need is already on your shelf.</p>
      )}

      {plan.skip.length > 0 && (
        <>
          <h3>Don&apos;t buy</h3>
          <ul className="plain">
            {plan.skip.map((s) => (
              <li key={s.label}>
                <strong>{s.label}.</strong> {s.reason}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Your routine</h3>
      <div className="routine">
        <div className="card">
          <div className="sev fine" style={{ marginBottom: 8 }}>
            Morning
          </div>
          <ol>
            {plan.routine.am.map((s) => (
              <li key={s.product_id}>{name(s.product_id)}</li>
            ))}
          </ol>
        </div>
        <div className="card">
          <div className="sev watch" style={{ marginBottom: 8 }}>
            Night
          </div>
          <ol>
            {plan.routine.pm.map((s) => (
              <li key={s.product_id}>
                <div>
                  {name(s.product_id)}
                  <div className="nights" aria-label={s.nights.length ? `Nights: ${s.nights.join(", ")}` : "Every night"}>
                    {NIGHTS.map((n) => (
                      <span key={n} className={!s.nights.length || s.nights.includes(n) ? "on" : ""}>
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
      {plan.routine.notes.length > 0 && (
        <ul className="plain" style={{ marginTop: 12 }}>
          {plan.routine.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <h3>Good to know</h3>
      <ul className="plain">
        {plan.caveats.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </div>
  );
}
