"use client";
// Shelf Check 클라이언트 앱: 순간 선택 → 스캔(YouCam) → 선반 → 에이전트(재생/실호출/오프라인) → 미리보기 → 체크인
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Product } from "@/lib/catalog/products";
import { SKINCARE_CATEGORIES } from "@/lib/catalog/products";
import {
  MOMENT_LABEL,
  type Moment,
  type Profile,
  type ScenarioInput,
  type ShelfItem,
  type SkinScan,
} from "@/lib/domain/types";
import type { PlanResult } from "@/lib/agent/resolve";
import type { TraceStep } from "@/lib/agent/run";
import { getStatus, planForInput, planForScenario, prepareSelfie, runTask, uploadSelfie, type Status } from "@/lib/client/api";
import ScanView from "./ScanView";
import ProductCard from "./ProductCard";
import PlanView from "./PlanView";
import PreviewView, { type PreviewImages } from "./PreviewView";
import ProgressView from "./ProgressView";

export interface PersonaCard {
  id: string;
  name: string;
  age: number;
  moment: Moment;
  story: string;
  shelf: ShelfItem[];
  cart: string[];
  profile: Profile;
  hasPrevious: boolean;
}

interface Session {
  kind: "persona" | "custom";
  personaId?: string;
  moment: Moment;
  fileId?: string;
  selfieUrl?: string;
  scan?: SkinScan;
  previousScan?: SkinScan;
  shelf: ShelfItem[];
  cart: string[];
  profile: Profile;
}

const MOMENT_QUESTION: Record<Moment, string> = {
  breakout: "I just broke out. What should I buy?",
  pre_purchase: "Is this serum in my cart worth it?",
  is_it_working: "Is my new routine actually working?",
};
const BASELINE_KEY = "shelfcheck.baseline.v1";

export default function ShelfCheckApp({ personas, catalog }: { personas: PersonaCard[]; catalog: Product[] }) {
  const byId = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);
  const [status, setStatus] = useState<Status | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [scanError, setScanError] = useState<string>();
  const [scanStage, setScanStage] = useState<string>();
  const [result, setResult] = useState<PlanResult | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentError, setAgentError] = useState<string>();
  const [shown, setShown] = useState(0);
  const [preview, setPreview] = useState<PreviewImages>({ looks: {} });
  const workspace = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  const reset = () => {
    setResult(null);
    setAgentError(undefined);
    setShown(0);
    setPreview({ looks: {} });
    setScanError(undefined);
  };

  // ---- Persona flow --------------------------------------------------------
  const startPersona = useCallback(async (p: PersonaCard) => {
    reset();
    setSession({ kind: "persona", personaId: p.id, moment: p.moment, shelf: p.shelf, cart: p.cart, profile: p.profile });
    setTimeout(() => workspace.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    try {
      setScanStage("Running YouCam AI Skin Analysis and Facial Color Tones…");
      const [analysis, tone, previous] = await Promise.all([
        runTask({ kind: "skin-analysis", persona: p.id }),
        runTask({ kind: "skin-tone-analysis", persona: p.id }),
        p.hasPrevious ? runTask({ kind: "skin-analysis", persona: p.id, variant: "previous" }) : Promise.resolve(null),
      ]);
      const scan = { ...analysis.scan!, tone: tone.tone };
      setSession((s) => (s && s.personaId === p.id ? { ...s, scan, previousScan: previous?.scan } : s));
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanStage(undefined);
    }
  }, []);

  // ---- Custom selfie flow ---------------------------------------------------
  const startCustom = useCallback(async (file: File) => {
    reset();
    setSession({ kind: "custom", moment: "breakout", shelf: [], cart: [], profile: { budgetUsd: 60 } });
    setTimeout(() => workspace.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    try {
      setScanStage("Preparing your photo…");
      const prepared = await prepareSelfie(file);
      setSession((s) => s && { ...s, selfieUrl: prepared.url });
      setScanStage("Uploading to YouCam…");
      const fileId = await uploadSelfie(prepared.blob);
      setScanStage("Running YouCam AI Skin Analysis (HD, 16 concerns) and Facial Color Tones…");
      const [analysis, tone] = await Promise.all([
        runTask({ kind: "skin-analysis", fileId }),
        runTask({ kind: "skin-tone-analysis", fileId }).catch(() => null),
      ]);
      const scan = { ...analysis.scan!, tone: tone?.tone };
      let previousScan: SkinScan | undefined;
      try {
        const saved = localStorage.getItem(BASELINE_KEY);
        if (saved) previousScan = JSON.parse(saved) as SkinScan;
      } catch {
        /* storage unavailable */
      }
      setSession((s) => s && { ...s, fileId, scan, previousScan, moment: previousScan ? "is_it_working" : s.moment });
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanStage(undefined);
    }
  }, []);

  const input: ScenarioInput | null = useMemo(() => {
    if (!session?.scan) return null;
    return {
      moment: session.moment,
      scan: session.scan,
      previousScan: session.previousScan,
      shelf: session.shelf,
      cart: session.moment === "pre_purchase" ? session.cart : [],
      profile: session.profile,
    };
  }, [session]);

  // ---- Agent ------------------------------------------------------------------
  const runAgentNow = async () => {
    if (!session || !input) return;
    setAgentBusy(true);
    setAgentError(undefined);
    setResult(null);
    setShown(0);
    setPreview({ looks: {} });
    try {
      const r = session.kind === "persona" ? await planForScenario(session.personaId!) : await planForInput(input);
      setResult(r);
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : "The agent failed");
    } finally {
      setAgentBusy(false);
    }
  };

  // Reveal the recorded tool calls one by one so the reasoning is readable.
  useEffect(() => {
    if (!result) return;
    if (shown >= result.trace.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), 420);
    return () => clearTimeout(t);
  }, [result, shown]);
  const planVisible = !!result && shown >= result.trace.length;

  // ---- Preview (Skin Simulation + Makeup VTO) -------------------------------
  useEffect(() => {
    if (!planVisible || !result || !session) return;
    let cancelled = false;
    const plan = result.plan;
    const src = session.kind === "persona" ? { persona: session.personaId } : { fileId: session.fileId };
    const shade = (id: string) => byId.get(id)?.shade?.hex ?? "#A65E62";
    const lookSpec = (lipId: string) => ({
      foundation: { hex: shade(plan.look.foundation_id), coverage: 35, glow: 40 },
      lip: { hex: shade(lipId), texture: byId.get(lipId)?.texture ?? "satin", intensity: 55 },
      blush: { hex: shade(plan.look.blush_id), intensity: 30 },
      skinSmooth: 15,
    });
    setPreview({ looks: {}, loading: true });
    Promise.all([
      runTask({ kind: "skin-simulation", ...src, simulation: plan.preview.concerns }).catch((e: Error) => ({ error: e.message })),
      runTask({ kind: "makeup-vto", ...src, variant: "everyday", look: lookSpec(plan.look.everyday_lip_id) }).catch(() => null),
      runTask({ kind: "makeup-vto", ...src, variant: "statement", look: lookSpec(plan.look.statement_lip_id) }).catch(() => null),
    ]).then(([sim, every, state]) => {
      if (cancelled) return;
      setPreview({
        simulation: "imageUrl" in sim ? sim.imageUrl : null,
        error: "error" in sim ? sim.error : undefined,
        looks: { everyday: every?.imageUrl ?? null, statement: state?.imageUrl ?? null },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [planVisible, result, session?.kind, session?.personaId, session?.fileId, byId]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = status?.youcam === "live";
  const persona = personas.find((p) => p.id === session?.personaId);

  return (
    <>
      <header className="topbar">
        <div className="wrap">
          <a className="brand" href="#top">
            <span className="brand-mark" aria-hidden>
              ✓
            </span>
            Shelf Check
          </a>
          {session && (
            <nav className="steps" aria-label="Sections">
              <a href="#scan">1 Scan</a>
              {session.previousScan && <a href="#checkin">↻ Check-in</a>}
              <a href="#shelf">2 Shelf</a>
              <a href="#agent">3 Agent</a>
              {planVisible && <a href="#preview">4 Preview</a>}
            </nav>
          )}
          <div className="badges" style={session ? undefined : { marginLeft: "auto" }}>
            <span className={`badge${live ? " live" : ""}`} title="YouCam API mode">
              YouCam {live ? `live${status?.units != null ? ` · ${status.units} units` : ""}` : "sample data"}
            </span>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="hero wrap">
          <p className="eyebrow">YouCam Skin AI × a Claude shopping agent</p>
          <h1>Check your shelf before you buy.</h1>
          <p className="lede">
            YouCam&apos;s AI Skin Analysis reads your skin. A shopping agent reads the products you already own. You keep what
            works, pause what hurts, and buy only what closes the gap — then see the result with YouCam Skin Simulation
            and Makeup Virtual Try-On.
          </p>
          <div className="moments">
            {personas.map((p) => (
              <button
                key={p.id}
                className={`moment${session?.personaId === p.id ? " active" : ""}`}
                onClick={() => startPersona(p)}
              >
                <span className="eyebrow" style={{ margin: 0 }}>
                  {MOMENT_LABEL[p.moment]}
                </span>
                <span className="q">“{MOMENT_QUESTION[p.moment]}”</span>
                <span className="who">
                  {p.name}, {p.age}. {p.story}
                </span>
                <span className="go">Check {p.name}&apos;s shelf →</span>
              </button>
            ))}
          </div>
          <SelfieStart live={live} onFile={startCustom} />
        </section>

        {session && (
          <div ref={workspace}>
            <section className="section wrap" id="scan">
              <div className="section-head">
                <span className="num">1</span>
                <h2>{session.kind === "persona" ? `${persona?.name}'s scan` : "Your scan"}</h2>
                <span className="api">YouCam AI Skin Analysis HD · Facial Color Tones</span>
              </div>
              {scanError ? (
                <div className="card error" role="alert">
                  {scanError}
                </div>
              ) : (
                <ScanView scan={session.scan} selfieUrl={session.selfieUrl} loading={scanStage} />
              )}
            </section>

            {session.scan && session.previousScan && (
              <section className="section wrap" id="checkin">
                <div className="section-head">
                  <span className="num" aria-hidden>↻</span>
                  <h2>Is it working?</h2>
                  <span className="api">Two YouCam scans, compared</span>
                </div>
                <ProgressView before={session.previousScan} after={session.scan} shelf={session.shelf} byId={byId} />
              </section>
            )}

            {session.scan && (
              <section className="section wrap" id="shelf">
                <div className="section-head">
                  <span className="num">2</span>
                  <h2>{session.kind === "persona" ? `What ${persona?.name} already owns` : "What you already own"}</h2>
                </div>
                {session.kind === "custom" ? (
                  <ShelfEditor
                    session={session}
                    catalog={catalog}
                    onChange={(s) => {
                      setSession(s);
                      setResult(null);
                    }}
                    onSaveBaseline={() => {
                      try {
                        localStorage.setItem(BASELINE_KEY, JSON.stringify({ ...session.scan, baseImageUrl: undefined }));
                        return true;
                      } catch {
                        return false;
                      }
                    }}
                  />
                ) : (
                  <div className="products">
                    {session.shelf.map((s) => (
                      <ProductCard
                        key={s.productId}
                        product={byId.get(s.productId)!}
                        note={s.startedAt ? `Using since ${s.startedAt}` : undefined}
                      />
                    ))}
                    {session.cart.map((id) => (
                      <ProductCard key={id} product={byId.get(id)!} ribbon="In cart" dashed />
                    ))}
                  </div>
                )}
                {session.profile.budgetUsd !== undefined && (
                  <p className="small muted">Budget for new skincare this month: ${session.profile.budgetUsd}.</p>
                )}
              </section>
            )}

            {session.scan && (
              <section className="section wrap" id="agent">
                <div className="section-head">
                  <span className="num">3</span>
                  <h2>Ask the shopping agent</h2>
                  <span className="api">Claude · 10 rule-checked tools · validated plan</span>
                </div>
                <div className="run">
                  <button className="btn" onClick={runAgentNow} disabled={agentBusy || (session.kind === "custom" && !session.shelf.length)}>
                    {agentBusy ? "Thinking…" : result ? "Run again" : "Check this shelf"}
                  </button>
                  <span className="source">
                    {session.kind === "custom" && !session.shelf.length
                      ? "Add at least one product you own."
                      : "The agent reads the scan, audits the shelf, searches the catalog and must pass a rule check before you see a plan."}
                  </span>
                </div>
                {agentError && (
                  <p className="error" role="alert">
                    {agentError}
                  </p>
                )}
                {result && <Trace steps={result.trace.slice(0, shown)} result={result} done={planVisible} />}
                {planVisible && input && <PlanView plan={result!.plan} input={input} byId={byId} />}
              </section>
            )}

            {planVisible && session.scan && (
              <section className="section wrap" id="preview">
                <div className="section-head">
                  <span className="num">4</span>
                  <h2>See it before you commit</h2>
                  <span className="api">YouCam Skin Simulation · Makeup Virtual Try-On</span>
                </div>
                <PreviewView
                  plan={result!.plan}
                  scan={session.scan}
                  byId={byId}
                  before={session.scan.baseImageUrl ?? session.selfieUrl}
                  images={preview}
                  live={session.kind === "custom"}
                />
              </section>
            )}

            {planVisible && !session.previousScan && (
              <section className="section wrap">
                <div className="section-head">
                  <span className="num">5</span>
                  <h2>Check in after {result!.plan.checkin.after_weeks} weeks</h2>
                </div>
                <p className="muted" style={{ maxWidth: "70ch" }}>
                  {result!.plan.checkin.note} Shelf Check will compare{" "}
                  {result!.plan.checkin.watch.map((c) => c.replace(/_/g, " ")).join(", ")} and tell you, product by product,
                  whether it is working, too early, or time to stop.
                </p>
              </section>
            )}
          </div>
        )}
      </main>

      <footer>
        <div className="wrap">
          Shelf Check is shopping guidance, not medical advice. Product names in this demo are fictional. Skin data from
          YouCam API by Perfect Corp.; planning by Claude. Selfies are sent to YouCam only when you scan your own photo.
        </div>
      </footer>
    </>
  );
}

function Trace({ steps, result, done }: { steps: TraceStep[]; result: PlanResult; done: boolean }) {
  const label =
    result.source === "cached"
      ? `Replaying a recorded ${result.model ?? "Claude"} run from ${result.createdAt?.slice(0, 10) ?? "earlier"} — the same tools, inputs and validator as a live run.`
      : result.source === "live"
        ? `Live ${result.model ?? "Claude"} run.`
        : "Offline planner: the same rule tools composed without an LLM (no Claude key in this deployment).";
  return (
    <div>
      <p className="source" style={{ marginTop: 14 }}>
        {label}
        {result.note ? ` ${result.note}` : ""}
      </p>
      {result.trace.length > 0 && (
        <div className="trace" aria-live="polite">
          {steps.map((s, i) => (
            <div key={i}>
              <span className={s.isError ? "e" : "t"}>{s.isError ? "✗" : "→"} {s.tool}</span>{" "}
              <span className="r">{s.result.split("\n")[0]}</span>
            </div>
          ))}
          {!done && <span className="spin" />}
        </div>
      )}
    </div>
  );
}

function SelfieStart({ live, onFile }: { live: boolean; onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="own">
      <span>
        <strong>Or scan your own selfie.</strong>{" "}
        {live
          ? "Face the camera in even light, hair off the forehead, no makeup. Your photo goes to YouCam for analysis and is not stored by Shelf Check."
          : "Live scanning turns on when this deployment has a YouCam API key. The demo personas above use sample data in YouCam's exact response format."}
      </span>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png"
        capture="user"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <button className="btn ghost small" disabled={!live} onClick={() => ref.current?.click()}>
        Upload a selfie
      </button>
    </div>
  );
}

function ShelfEditor({
  session,
  catalog,
  onChange,
  onSaveBaseline,
}: {
  session: Session;
  catalog: Product[];
  onChange: (s: Session) => void;
  onSaveBaseline: () => boolean;
}) {
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<boolean | null>(null);
  const skincare = catalog.filter((p) => SKINCARE_CATEGORIES.includes(p.category));
  const owned = new Set(session.shelf.map((s) => s.productId));
  const q = query.trim().toLowerCase();
  const visible = skincare.filter((p) => !q || `${p.brand} ${p.name} ${p.actives.join(" ")}`.toLowerCase().includes(q));
  const toggle = (id: string) =>
    onChange({
      ...session,
      shelf: owned.has(id) ? session.shelf.filter((s) => s.productId !== id) : [...session.shelf, { productId: id }],
      cart: session.cart.filter((c) => c !== id),
    });

  return (
    <div className="grid-2">
      <div className="card">
        <div className="field">
          <label htmlFor="moment">What brings you here?</label>
          <select id="moment" value={session.moment} onChange={(e) => onChange({ ...session, moment: e.target.value as Moment })}>
            {(Object.keys(MOMENT_LABEL) as Moment[]).map((m) => (
              <option key={m} value={m} disabled={m === "is_it_working" && !session.previousScan}>
                {MOMENT_LABEL[m]}
                {m === "is_it_working" && !session.previousScan ? " (save a baseline scan first)" : ""}
              </option>
            ))}
          </select>
        </div>
        {session.moment === "pre_purchase" && (
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="cart">What is in your cart?</label>
            <select
              id="cart"
              value={session.cart[0] ?? ""}
              onChange={(e) => onChange({ ...session, cart: e.target.value ? [e.target.value] : [] })}
            >
              <option value="">Nothing yet</option>
              {skincare
                .filter((p) => !owned.has(p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.brand} {p.name} (${p.priceUsd})
                  </option>
                ))}
            </select>
          </div>
        )}
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="budget">Budget for new skincare (USD)</label>
          <input
            id="budget"
            type="number"
            min={0}
            max={1000}
            value={session.profile.budgetUsd ?? ""}
            onChange={(e) =>
              onChange({ ...session, profile: { ...session.profile, budgetUsd: e.target.value === "" ? undefined : Number(e.target.value) } })
            }
          />
        </div>
        <label className="small" style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input
            type="checkbox"
            checked={!!session.profile.pregnantOrNursing}
            onChange={(e) => onChange({ ...session, profile: { ...session.profile, pregnantOrNursing: e.target.checked } })}
          />
          Pregnant or breastfeeding
        </label>
        <label className="small" style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <input
            type="checkbox"
            checked={!!session.profile.fragranceSensitive}
            onChange={(e) => onChange({ ...session, profile: { ...session.profile, fragranceSensitive: e.target.checked } })}
          />
          Fragrance makes my skin react
        </label>
        <div className="note" style={{ marginTop: 14 }}>
          Save this scan as your baseline, then rescan in a few weeks: Shelf Check will tell you which products are working.
          <div style={{ marginTop: 8 }}>
            <button className="btn ghost small" onClick={() => setSaved(onSaveBaseline())}>
              Save as baseline
            </button>{" "}
            {saved === true && <span className="small">Saved on this device.</span>}
            {saved === false && <span className="small error">This browser blocks storage.</span>}
          </div>
        </div>
      </div>
      <div className="card">
        <div className="field">
          <label htmlFor="q">Tick everything on your shelf ({session.shelf.length})</label>
          <input id="q" placeholder="Search by name or ingredient" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="catalog" style={{ marginTop: 10 }}>
          {SKINCARE_CATEGORIES.map((cat) => {
            const items = visible.filter((p) => p.category === cat);
            if (!items.length) return null;
            return (
              <div key={cat}>
                <div className="group">{cat}</div>
                {items.map((p) => (
                  <label key={p.id}>
                    <input type="checkbox" checked={owned.has(p.id)} onChange={() => toggle(p.id)} />
                    <span>
                      {p.brand} {p.name}
                    </span>
                    <span className="small muted">${p.priceUsd}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
