"use client";

import { useActionState, useMemo, useState } from "react";
import { useKeepForm } from "@/components/keep-form";
import { flipCalc, maxBuy, TAX_LABEL, TAX_MODES, TAX_SHORT, type TaxMode } from "@/lib/watches/calc";
import type { Quiz as QuizItem } from "@/lib/watches/lessons";
import { parseEuro, parsePct } from "@/lib/watches/logic";
import { coachAction, dealFromCalcAction, quizAction, type FlipState, type QuizState } from "./actions";

const eur = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "–" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${n.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`);

function Notice({ state }: { state: FlipState }) {
  if (!state) return null;
  return (
    <div className={`notice small ${state.ok ? "notice-ok" : "notice-warn"}`} role="status" data-testid="flip-notice">
      {state.message}
    </div>
  );
}

/**
 * Formular mit Rückmeldung: Bei Fehlern bleiben alle Eingaben stehen; nach dem Speichern zeigt es die gespeicherten
 * Werte (Auswahlfelder springen nicht zurück). `resetOnSuccess` leert es nach Erfolg (z. B. „Preis notieren“).
 */
export function FlipForm({ action, submit, pending: pendingLabel = "Speichert …", testid, children, className = "stack", resetOnSuccess = false }: { action: (s: FlipState, fd: FormData) => Promise<FlipState>; submit: string; pending?: string; testid?: string; children: React.ReactNode; className?: string; resetOnSuccess?: boolean }) {
  const [state, run, pending] = useActionState<FlipState, FormData>(action, null);
  const keep = useKeepForm(state, run, { resetOnSuccess });
  return (
    <form action={run} ref={keep.ref} onSubmit={keep.onSubmit} className={className} data-testid={testid}>
      {children}
      <div>
        <button className="btn btn-primary" type="submit" disabled={pending} aria-busy={pending}>
          {pending ? pendingLabel : submit}
        </button>
      </div>
      <Notice state={state} />
    </form>
  );
}

// ---- Rechner -----------------------------------------------------------------------------------------

type CalcDefaults = { mode?: TaxMode; condition?: "gebraucht" | "neu" };

/**
 * Live-Rechner: vorwärts (Gewinn, Steuer, Rendite, Break-even) und rückwärts (höchster Ankaufspreis für ein
 * Gewinnziel). Unten der Vergleich der drei Steuerarten – damit der Unterschied sichtbar wird.
 */
export function Calculator({ defaults = {} }: { defaults?: CalcDefaults }) {
  const [v, setV] = useState({ condition: defaults.condition ?? "gebraucht", mode: defaults.mode ?? ("privat" as TaxMode), buy: "", costs: "", sell: "", feePct: "", feeFixed: "", shipping: "", days: "", target: "" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  const n = (s: string) => parseEuro(s) ?? 0;
  const input = useMemo(
    () => ({ buy: n(v.buy), costs: n(v.costs), sell: n(v.sell), feePct: parsePct(v.feePct) ?? 0, feeFixed: n(v.feeFixed), shipping: n(v.shipping), days: v.days.trim() ? Number(v.days) || null : null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v.buy, v.costs, v.sell, v.feePct, v.feeFixed, v.shipping, v.days],
  );
  const r = input.sell > 0 ? flipCalc({ mode: v.mode, ...input }) : null;
  const target = n(v.target);
  const mb = input.sell > 0 ? maxBuy({ mode: v.mode, sell: input.sell, costs: input.costs, feePct: input.feePct, feeFixed: input.feeFixed, shipping: input.shipping, targetProfit: target }) : null;
  const field = (k: keyof typeof v, label: string, hint?: string, mode: "decimal" | "numeric" = "decimal") => (
    <div className="field" style={{ minWidth: 0 }}>
      <label className="label small" htmlFor={`c-${k}`}>{label}</label>
      <input className="input" id={`c-${k}`} name={k} inputMode={mode} value={v[k]} onChange={set(k)} autoComplete="off" data-testid={`calc-${k}`} />
      {hint && <span className="small muted">{hint}</span>}
    </div>
  );
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card card-pad stack" data-testid="calc">
        <div className="flip-grid">
          <div className="field">
            <label className="label small" htmlFor="c-condition">Uhr</label>
            <select className="input" id="c-condition" value={v.condition} onChange={(e) => setV((x) => ({ ...x, condition: e.target.value as "gebraucht" | "neu", mode: e.target.value === "neu" && x.mode === "differenz" ? "regel" : x.mode }))} data-testid="calc-condition">
              <option value="gebraucht">gebraucht</option>
              <option value="neu">neu / ungetragen</option>
            </select>
          </div>
          <div className="field" style={{ gridColumn: "span 2", minWidth: 0 }}>
            <label className="label small" htmlFor="c-mode">Steuer</label>
            <select className="input" id="c-mode" value={v.mode} onChange={set("mode")} data-testid="calc-mode">
              {TAX_MODES.map((m) => <option key={m} value={m}>{TAX_LABEL[m]}</option>)}
            </select>
          </div>
          {field("buy", "Ankauf (bzw. Angebot) €")}
          {field("costs", "Nebenkosten €", "Revision, Aufbereitung, Prüfung, Anreise")}
          {field("sell", "Realistischer Verkaufspreis €", "aus verkauften Vergleichen")}
          {field("feePct", "Gebühr in %", "Plattform + Zahlung")}
          {field("feeFixed", "Gebühr fest €")}
          {field("shipping", "Versand an Käufer €", "versichert")}
          {field("days", "Standzeit (Tage)", "Ankauf bis Verkauf", "numeric")}
          {field("target", "Ziel-Gewinn €", "für den Höchstpreis")}
        </div>
        {v.condition === "neu" && v.mode === "differenz" && <div className="notice notice-warn small">Neue Uhren mit Rechnung vom Händler fallen nicht unter § 25a – dann „Regelbesteuerung“ wählen.</div>}
      </section>

      <section className="card card-pad stack" data-testid="calc-result">
        <h2>Ergebnis</h2>
        {!r ? (
          <p className="small muted">Verkaufspreis eintragen – dann rechnet es sofort.</p>
        ) : (
          <>
            <div className="grid-kpi flip-kpis">
              <div className="card card-pad kpi-card"><div className="kpi-label">Gewinn</div><div className={`kpi-value${r.profit < 0 ? " flip-neg" : ""}`} data-testid="calc-profit">{eur(r.profit)}</div><div className="small muted">vor Einkommensteuer</div></div>
              <div className="card card-pad kpi-card"><div className="kpi-label">Marge</div><div className="kpi-value" data-testid="calc-margin">{pct(r.marginPct)}</div><div className="small muted">vom Verkaufspreis</div></div>
              <div className="card card-pad kpi-card"><div className="kpi-label">Rendite</div><div className="kpi-value">{pct(r.roiPct)}</div><div className="small muted">{r.roiPerMonthPct !== null ? `${pct(r.roiPerMonthPct)} je Monat` : "Standzeit eintragen für „je Monat“"}</div></div>
              <div className="card card-pad kpi-card"><div className="kpi-label">Break-even</div><div className="kpi-value" data-testid="calc-breakeven">{eur(r.breakEven)}</div><div className="small muted">Verkaufspreis ohne Verlust</div></div>
            </div>
            <table className="table small">
              <tbody>
                <tr><td>Verkaufspreis</td><td className="num right">{eur(input.sell)}</td></tr>
                <tr><td>− Ankauf</td><td className="num right">{eur(input.buy)}</td></tr>
                <tr><td>− Nebenkosten</td><td className="num right">{eur(input.costs)}</td></tr>
                <tr><td>− Gebühren</td><td className="num right">{eur(r.fees)}</td></tr>
                <tr><td>− Versand</td><td className="num right">{eur(input.shipping)}</td></tr>
                <tr>
                  <td>− Umsatzsteuer ({TAX_SHORT[v.mode]}){v.mode === "differenz" ? ` – 19/119 von ${eur(r.margin25a)} Differenz` : v.mode === "regel" ? " – nach Abzug der Vorsteuer" : ""}</td>
                  <td className="num right" data-testid="calc-vat">{eur(r.vat)}</td>
                </tr>
                <tr><td><strong>= Gewinn</strong></td><td className="num right"><strong>{eur(r.profit)}</strong></td></tr>
              </tbody>
            </table>
            <div className="notice notice-info small" data-testid="calc-maxbuy">
              <strong>Höchster Ankaufspreis</strong> für {target ? `${eur(target)} Gewinn` : "0 € Gewinn (Ziel-Gewinn eintragen)"}: <strong>{mb !== null && mb > 0 ? eur(mb) : "nicht machbar"}</strong>
              {mb !== null && mb > 0 && input.buy > 0 ? (input.buy <= mb ? " – dein Ankauf liegt darunter. ✓" : ` – dein Ankauf liegt ${eur(input.buy - mb)} darüber: nachverhandeln oder Finger weg.`) : ""}
            </div>
            <details>
              <summary className="small" style={{ cursor: "pointer" }}>Vergleich: gleicher Deal mit jeder Steuerart</summary>
              <table className="table small" style={{ marginTop: 6 }} data-testid="calc-compare">
                <tbody>
                  {TAX_MODES.map((m) => {
                    const x = flipCalc({ mode: m, ...input });
                    return <tr key={m}><td>{TAX_SHORT[m]}</td><td className="num right">USt {eur(x.vat)}</td><td className="num right">Gewinn {eur(x.profit)}</td></tr>;
                  })}
                </tbody>
              </table>
              <p className="small muted">Gebühren und Nebenkosten sind so gerechnet, wie bezahlt (eine mögliche Vorsteuer daraus ist nicht abgezogen – vorsichtig). Einkommen- und Gewerbesteuer sind nicht enthalten. Keine Steuerberatung.</p>
            </details>
          </>
        )}
      </section>

      <form action={dealFromCalcAction} className="card card-pad stack" data-testid="calc-to-deal">
        <h2>Als Deal übernehmen</h2>
        <input type="hidden" name="condition" value={v.condition} />
        <input type="hidden" name="taxMode" value={v.mode} />
        <input type="hidden" name="buy" value={v.buy} />
        <input type="hidden" name="costs" value={v.costs} />
        <input type="hidden" name="sell" value={v.sell} />
        <input type="hidden" name="feePct" value={v.feePct} />
        <input type="hidden" name="feeFixed" value={v.feeFixed} />
        <input type="hidden" name="shipping" value={v.shipping} />
        <div className="flip-grid">
          <div className="field"><label className="label small" htmlFor="d-maker">Marke</label><input className="input" id="d-maker" name="maker" required placeholder="z. B. Omega" /></div>
          <div className="field"><label className="label small" htmlFor="d-model">Modell</label><input className="input" id="d-model" name="model" placeholder="z. B. Seamaster" /></div>
          <div className="field"><label className="label small" htmlFor="d-ref">Referenz</label><input className="input" id="d-ref" name="reference" placeholder="vom Gehäuse / den Papieren" /></div>
        </div>
        <label className="check small"><input type="checkbox" name="practice" defaultChecked /> Übungs-Deal (nur auf dem Papier, zählt getrennt)</label>
        <div><button className="btn" type="submit">Deal anlegen</button></div>
      </form>
    </div>
  );
}

// ---- Quiz --------------------------------------------------------------------------------------------

export function Quiz({ lesson, quiz }: { lesson: string; quiz: QuizItem[] }) {
  const [result, run, pending] = useActionState<QuizState, FormData>(quizAction, null);
  const [round, setRound] = useState(0);
  // „Noch einmal“: das alte Ergebnis ausblenden, bis neu geprüft wurde.
  const [dismissed, setDismissed] = useState<QuizState>(null);
  const state = result && result !== dismissed ? result : null;
  return (
    <form action={run} key={round} className="stack" data-testid="quiz">
      <input type="hidden" name="lesson" value={lesson} />
      {quiz.map((q, i) => {
        const picked = state?.picked[i];
        const answered = state !== null;
        const right = answered && picked === q.answer;
        return (
          <fieldset key={i} className="card card-pad stack flip-q" style={{ gap: 6, margin: 0 }} data-testid={`quiz-q${i}`}>
            <legend className="small" style={{ fontWeight: 700 }}>{i + 1}. {q.q}</legend>
            {q.options.map((o, j) => (
              <label key={j} className={`check small${answered && j === q.answer ? " flip-right" : answered && j === picked ? " flip-wrong" : ""}`}>
                <input type="radio" name={`q${i}`} value={j} defaultChecked={picked === j} disabled={answered} required /> {o}
              </label>
            ))}
            {answered && (
              <div className={`small ${right ? "flip-ok-text" : "flip-bad-text"}`} data-testid={`quiz-why${i}`}>
                <strong>{right ? "✓ Richtig." : "✕ Nicht ganz."}</strong> {q.why}
              </div>
            )}
          </fieldset>
        );
      })}
      {state ? (
        <div className={`notice small ${state.passed ? "notice-ok" : "notice-warn"}`} role="status" data-testid="quiz-result">
          {state.correct} von {state.total} richtig. {state.passed ? "Lektion abgeschlossen ✓" : "Erklärungen lesen und noch einmal versuchen."}
          {!state.passed && (
            <button type="button" className="btn btn-small" style={{ marginLeft: 8 }} onClick={() => { setDismissed(result); setRound((n) => n + 1); }}>
              Noch einmal
            </button>
          )}
        </div>
      ) : (
        <div>
          <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Prüft …" : "Antworten prüfen"}</button>
        </div>
      )}
    </form>
  );
}

// ---- KI-Coach ----------------------------------------------------------------------------------------

export function CoachButton({ id, hasKey, again }: { id: string; hasKey: boolean; again: boolean }) {
  const [state, run, pending] = useActionState<FlipState, FormData>(coachAction, null);
  if (!hasKey) return <p className="small muted">KI-Coach: unter Anbindungen → „KI (Claude)“ einen Schlüssel eintragen – dann schätzt die KI deinen Deal ein (Risiken, offene Prüfungen, Rechnung, Verhandlung).</p>;
  return (
    <form action={run} className="stack" style={{ gap: 6 }}>
      <input type="hidden" name="id" value={id} />
      <div><button className="btn btn-small" type="submit" disabled={pending} data-testid="coach">{pending ? "KI denkt nach … (bis 1 Min.)" : again ? "KI-Coach: neu einschätzen" : "KI-Coach: Deal einschätzen"}</button></div>
      <Notice state={state} />
    </form>
  );
}
