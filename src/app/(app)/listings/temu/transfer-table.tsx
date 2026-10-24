"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";
import { parseAmount } from "@/lib/numbers";
import type { TemuPackage } from "@/lib/temu/goods";
import { temuBasePrice, type TemuPriceRule } from "@/lib/temu/price";
import type { Candidate } from "@/lib/temu/transfer";
import { packOf, WIZARD_STATUS, wizardStatus, type WizardStatus } from "@/lib/temu/wizard";
import { linkTemuAction, queueTransfersAction, type TransferState } from "./actions";

type Pack = Partial<TemuPackage>;
const PACK_FIELDS: [keyof TemuPackage, string][] = [["weightG", "g"], ["lengthCm", "L"], ["widthCm", "B"], ["heightCm", "H"]];
const euro = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const plain = (n: number | undefined) => (n === undefined ? "" : String(n).replace(".", ","));
type Filter = "alle" | WizardStatus | "ohne-wawi";

type Step = 1 | 2 | 3 | 4 | 5;
const STEPS: [Step, string][] = [[1, "Angebote wählen"], [2, "Preis"], [3, "Paket"], [4, "Prüfen"], [5, "Einstellen"]];

/**
 * Assistent „eBay → Temu / Wawi“ in fünf Schritten: Angebote wählen, Preis (Basispreis-Rechner, je Zeile
 * änderbar), Paket (Standard oder je Zeile), Prüfen (was fehlt) und Einstellen. Jede Zeile zeigt ihren Stand:
 * Entwurf, unvollständig, in Arbeit, veröffentlicht oder fehlgeschlagen.
 */
export function TransferTable({ candidates, rule, pack, temuConnected, running, allowHttp = false }: { candidates: Candidate[]; rule: TemuPriceRule; pack: Pack; temuConnected: boolean; running: boolean; allowHttp?: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [factor, setFactor] = useState(plain(Math.round(rule.factor * 10000) / 100));
  const [food, setFood] = useState(rule.food);
  const [std, setStd] = useState<Record<string, string>>(Object.fromEntries(PACK_FIELDS.map(([k]) => [k, plain(pack[k])])));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [packs, setPacks] = useState<Record<string, Record<string, string>>>({});
  const [filter, setFilter] = useState<Filter>("alle");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<TransferState>(null);

  // Solange die Warteschlange läuft, die Liste alle paar Sekunden neu laden.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [running, router]);

  const liveRule = { factor: (parseAmount(factor) ?? 0) / 100, food };
  const num = (v: string | undefined) => (v ? parseAmount(v) ?? undefined : undefined);
  const stdPack = Object.fromEntries(PACK_FIELDS.map(([k]) => [k, num(std[k])]).filter(([, v]) => v !== undefined)) as Pack;
  const rowPack = (c: Candidate) => packOf(Object.fromEntries(PACK_FIELDS.map(([k]) => [k, num(packs[c.key]?.[k])])), c.pack, stdPack);
  const priceOf = (c: Candidate) => num(prices[c.key]) ?? temuBasePrice(c.price, liveRule);
  const stateOf = (c: Candidate) => wizardStatus(c, priceOf(c), rowPack(c), { allowHttp });
  const busyJob = (c: Candidate) => c.job?.status === "wartet" || c.job?.status === "läuft";
  const matches = (c: Candidate, f: Filter) => (f === "alle" ? true : f === "ohne-wawi" ? !c.wawi : stateOf(c).status === f);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return candidates.filter((c) => matches(c, filter) && (!needle || c.title.toLowerCase().includes(needle) || (c.sku ?? "").toLowerCase().includes(needle) || c.ref.includes(needle)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, filter, q, factor, food, std, prices, packs]);
  const count = (f: Filter) => candidates.filter((c) => matches(c, f)).length;
  const chosen = candidates.filter((c) => picked.has(c.key));
  const ready = chosen.filter((c) => !c.temu && !busyJob(c) && stateOf(c).status === "entwurf");
  const blocked = chosen.filter((c) => !c.temu && !busyJob(c) && stateOf(c).status === "unvollstaendig");

  function toggle(key: string, on: boolean) {
    setPicked((s) => {
      const n = new Set(s);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });
  }

  async function submit(target: "temu" | "wawi") {
    setState(null);
    const todo = target === "temu" ? ready : chosen.filter((c) => !c.wawi && !busyJob(c));
    const skipped = chosen.length - todo.length;
    if (!todo.length) {
      setState({ ok: false, message: chosen.length ? (target === "temu" ? "Keins der gewählten Angebote ist bereit – siehe Schritt 4 „Prüfen“." : "Die Auswahl ist schon in der Wawi.") : "Bitte zuerst Angebote wählen (Schritt 1)." });
      return;
    }
    setBusy(true);
    try {
      const r = await queueTransfersAction({
        target,
        factorPercent: parseAmount(factor) ?? 0,
        food,
        pack: stdPack,
        picks: todo.map((c) => ({ source: c.source, ref: c.ref, title: c.title, ...(num(prices[c.key]) ? { price: num(prices[c.key]) } : {}), pack: rowPack(c) })),
      });
      setState(r && skipped ? { ...r, message: `${r.message} ${skipped} übersprungen (${target === "temu" ? "unvollständig, schon bei Temu oder in Arbeit" : "schon in der Wawi"}).` } : r);
      if (r?.ok) setPicked(new Set());
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const allShown = shown.length > 0 && shown.every((c) => picked.has(c.key) || busyJob(c));
  const nav = (back: Step | null, next: Step | null, nextLabel?: string) => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {back && <button type="button" className="btn" onClick={() => setStep(back)}>← Zurück</button>}
      {next && <button type="button" className="btn btn-primary" disabled={!picked.size} onClick={() => setStep(next)} data-testid={`wizard-next-${next}`}>{nextLabel ?? "Weiter"} →</button>}
      <span className="small muted">{picked.size} ausgewählt</span>
    </div>
  );
  const statusCell = (c: Candidate) => {
    const s = stateOf(c);
    return (
      <td className="small" style={{ minWidth: 170 }} data-testid="wizard-status" data-status={s.status}>
        <span className={`tag ${WIZARD_STATUS[s.status].cls}`} title={WIZARD_STATUS[s.status].hint}>{WIZARD_STATUS[s.status].label}</span>
        {s.missing.length > 0 && <div className="muted">fehlt: {s.missing.join(", ")}</div>}
        {s.status === "fehlgeschlagen" && s.reason && <div style={{ color: "var(--danger)" }} data-testid="transfer-error">Fehler: {s.reason}</div>}
        {s.status !== "fehlgeschlagen" && s.reason && <div className="muted">{s.reason}</div>}
        {c.temu?.goodsId && <div className="muted">Temu {c.temu.goodsId}{c.temu.label ? ` · ${c.temu.label}` : ""}</div>}
        <div className="muted">{c.wawi ? "in der Wawi" : "nicht in der Wawi"}</div>
      </td>
    );
  };
  const offerCell = (c: Candidate) => (
    <td style={{ minWidth: 220, maxWidth: 360 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {c.image ? <img src={c.image} alt="" width={40} height={40} style={{ objectFit: "cover", borderRadius: 6, flex: "none" }} /> : <span style={{ width: 40, height: 40, background: "var(--row)", borderRadius: 6, flex: "none" }} />}
        <div>
          <div>{c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.title}</a> : c.title}</div>
          <div className="small muted">
            {c.source === "attempt" ? "eBay-Tool" : "eBay (älter)"} · {c.sku ? `SKU ${c.sku}` : `Nr. ${c.ref}`}
            {c.variations ? ` · ${c.variations} Varianten` : ""}
            {c.condition && c.condition !== "NEW" ? " · gebraucht" : ""}
          </div>
        </div>
      </div>
    </td>
  );

  return (
    <div className="stack" data-testid="transfer">
      <ol className="wizard-steps" aria-label="Schritte">
        {STEPS.map(([n, label]) => (
          <li key={n}>
            <button type="button" className={`wizard-step${step === n ? " active" : ""}${n < step ? " done" : ""}`} aria-current={step === n ? "step" : undefined} onClick={() => setStep(n)} data-testid={`wizard-step-${n}`}>
              <span className="wizard-num">{n}</span> {label}
            </button>
          </li>
        ))}
      </ol>

      {step === 1 && (
        <section className="stack" data-testid="wizard-1">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {(["alle", "entwurf", "unvollstaendig", "in-arbeit", "veroeffentlicht", "fehlgeschlagen", "ohne-wawi"] as Filter[]).map((f) => (
              <button key={f} type="button" className={`chip${filter === f ? " active" : ""}`} onClick={() => setFilter(f)} data-testid={`wizard-filter-${f}`}>
                {f === "alle" ? "Alle" : f === "ohne-wawi" ? "Nicht in der Wawi" : WIZARD_STATUS[f].label} ({count(f)})
              </button>
            ))}
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen: Titel, SKU, Artikelnummer" aria-label="Angebote durchsuchen" style={{ maxWidth: 260 }} />
          </div>
          <section className="card" style={{ minWidth: 0, overflow: "auto" }}>
            <table className="table sticky-head">
              <thead>
                <tr>
                  <th><input type="checkbox" aria-label="Alle sichtbaren auswählen" checked={allShown} onChange={(e) => setPicked((s) => { const n = new Set(s); for (const c of shown) if (!busyJob(c)) { if (e.target.checked) n.add(c.key); else n.delete(c.key); } return n; })} /></th>
                  <th>Angebot</th><th className="right">eBay</th><th className="right">Menge</th><th>Stand</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={5} className="muted">{candidates.length ? "Kein Angebot in diesem Filter." : "Keine laufenden eBay-Angebote gefunden."}</td></tr>}
                {shown.map((c) => (
                  <tr key={c.key} data-testid="transfer-row" data-key={c.key}>
                    <td><input type="checkbox" aria-label={`Auswählen: ${c.title}`} checked={picked.has(c.key)} disabled={busyJob(c)} onChange={(e) => toggle(c.key, e.target.checked)} /></td>
                    {offerCell(c)}
                    <td className="num right">{c.variations ? "ab " : ""}{euro(c.price)}</td>
                    <td className="num right">{c.quantity}</td>
                    {statusCell(c)}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {nav(null, 2, "Weiter zum Preis")}
            <button className="btn" type="button" disabled={busy || !picked.size} onClick={() => void submit("wawi")} data-testid="to-wawi" title="eBay-Angebot in die Wawi: Bestand aus der eBay-Menge, ab jetzt mit allen Kanälen abgeglichen – braucht keinen Preis und kein Paket">
              Nur in die Wawi übernehmen ({picked.size})
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="stack" data-testid="wizard-2">
          <div className="card card-pad" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="stack" style={{ gap: 4 }}>
              <span className="label">Faktor (%)</span>
              <input className="input" value={factor} onChange={(e) => setFactor(e.target.value)} inputMode="decimal" aria-label="Faktor in Prozent" style={{ width: 80 }} />
            </label>
            <label className="stack" style={{ gap: 4 }}>
              <span className="label">Warengruppe</span>
              <select className="select" value={food ? "food" : "nonfood"} onChange={(e) => setFood(e.target.value === "food")} aria-label="Warengruppe">
                <option value="nonfood">Non-Food (19 % MwSt.)</option>
                <option value="food">Food (7 % MwSt.)</option>
              </select>
            </label>
            <span className="small muted" style={{ flex: "1 1 260px" }}>Temu-Basispreis = (eBay-Preis × Faktor − 2,99 € Versand, wenn das 30 € oder weniger sind) ÷ (1 + MwSt.). Eigener Preis je Zeile geht vor.</span>
          </div>
          <section className="card" style={{ overflow: "auto" }}>
            <table className="table">
              <thead><tr><th>Angebot</th><th className="right">eBay</th><th>Temu-Preis</th></tr></thead>
              <tbody>
                {chosen.map((c) => {
                  const calc = temuBasePrice(c.price, liveRule);
                  return (
                    <tr key={c.key} data-testid="transfer-row" data-key={c.key}>
                      {offerCell(c)}
                      <td className="num right">{c.variations ? "ab " : ""}{euro(c.price)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {c.variations ? (
                          <span className="small muted">je Variante, ab {calc > 0 ? euro(calc) : "–"}</span>
                        ) : (
                          <><input className="input num" value={prices[c.key] ?? ""} onChange={(e) => setPrices((p) => ({ ...p, [c.key]: e.target.value }))} placeholder={calc > 0 ? calc.toFixed(2).replace(".", ",") : "eigener Preis"} aria-label={`Temu-Preis für ${c.title}`} style={{ width: 90 }} /> €{calc <= 0 && !prices[c.key] && <span className="small" style={{ color: "var(--warn)" }}> Rechner ergibt 0 €</span>}</>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          {nav(1, 3, "Weiter zum Paket")}
        </section>
      )}

      {step === 3 && (
        <section className="stack" data-testid="wizard-3">
          <div className="card card-pad stack" style={{ gap: 6 }}>
            <span className="label">Standardpaket (gilt, wenn in der Zeile und am Angebot nichts steht)</span>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {PACK_FIELDS.map(([k, label]) => (
                <input key={k} className="input" value={std[k] ?? ""} onChange={(e) => setStd((s) => ({ ...s, [k]: e.target.value }))} placeholder={label === "g" ? "Gramm" : `${label} cm`} aria-label={`Standardpaket ${label === "g" ? "Gewicht in Gramm" : `${label} in cm`}`} style={{ width: 80 }} />
              ))}
            </div>
          </div>
          <section className="card" style={{ overflow: "auto" }}>
            <table className="table">
              <thead><tr><th>Angebot</th><th>Paket (g · L × B × H cm)</th></tr></thead>
              <tbody>
                {chosen.map((c) => (
                  <tr key={c.key}>
                    {offerCell(c)}
                    <td style={{ whiteSpace: "nowrap" }}>
                      {PACK_FIELDS.map(([k, label]) => (
                        <input key={k} className="input num" value={packs[c.key]?.[k] ?? ""} onChange={(e) => setPacks((p) => ({ ...p, [c.key]: { ...p[c.key], [k]: e.target.value } }))} placeholder={plain(c.pack[k]) || plain(stdPack[k]) || label} aria-label={`Paket ${label} für ${c.title}`} style={{ width: 64, marginRight: 4 }} />
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          {nav(2, 4, "Weiter zur Prüfung")}
        </section>
      )}

      {step === 4 && (
        <section className="stack" data-testid="wizard-4">
          <div className="grid-kpi">
            <div className="card card-pad"><div className="kpi-label">Bereit für Temu</div><div className="kpi-value" data-testid="wizard-ready">{ready.length}</div></div>
            <div className="card card-pad"><div className="kpi-label">Unvollständig</div><div className="kpi-value" style={{ color: blocked.length ? "var(--warn)" : undefined }} data-testid="wizard-blocked">{blocked.length}</div><div className="small muted">werden übersprungen</div></div>
            <div className="card card-pad"><div className="kpi-label">Schon bei Temu / in Arbeit</div><div className="kpi-value">{chosen.length - ready.length - blocked.length}</div></div>
          </div>
          <section className="card" style={{ overflow: "auto" }}>
            <table className="table">
              <thead><tr><th>Angebot</th><th className="right">Temu-Preis</th><th>Paket</th><th>Stand</th></tr></thead>
              <tbody>
                {chosen.length === 0 && <tr><td colSpan={4} className="muted">Noch nichts ausgewählt – zurück zu Schritt 1.</td></tr>}
                {chosen.map((c) => {
                  const p = rowPack(c);
                  return (
                    <tr key={c.key} data-testid="transfer-row" data-key={c.key}>
                      {offerCell(c)}
                      <td className="num right">{c.variations ? "je Variante" : priceOf(c) > 0 ? euro(priceOf(c)) : "–"}</td>
                      <td className="small num">{p.weightG ?? "–"} g · {p.lengthCm ?? "–"} × {p.widthCm ?? "–"} × {p.heightCm ?? "–"}</td>
                      {statusCell(c)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          {nav(3, 5, "Weiter zum Einstellen")}
        </section>
      )}

      {step === 5 && (
        <section className="stack" data-testid="wizard-5">
          <div className="card card-pad stack" style={{ gap: 10 }}>
            <div className="small">
              <strong>{ready.length}</strong> von {chosen.length} ausgewählten Angeboten sind bereit für Temu{blocked.length ? `, ${blocked.length} unvollständig (werden übersprungen)` : ""}.
              Menge kommt aus der Wawi; Kategorie und Pflichtmerkmale ordnet Temu selbst zu – fehlt dort etwas, steht das Angebot danach auf „unvollständig“.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button className="btn btn-primary" type="button" disabled={busy || !temuConnected || !ready.length} onClick={() => void submit("temu")} data-testid="to-temu">
                {ready.length} auf Temu einstellen
              </button>
              <button className="btn" type="button" disabled={busy || !picked.size} onClick={() => void submit("wawi")} data-testid="to-wawi-5">Nur in die Wawi übernehmen ({picked.size})</button>
              {busy && <span className="small muted">Reihe ein …</span>}
              {!temuConnected && <span className="small" style={{ color: "var(--warn)" }}>Temu ist nicht verbunden.</span>}
            </div>
          </div>
          {nav(4, null)}
        </section>
      )}
      {state && <div className={`notice ${state.ok ? "notice-ok" : "notice-warn"}`} data-testid="transfer-msg">{state.message}</div>}
    </div>
  );
}

/** Schon bei Temu vorhandene Produkte (Excel-Vorlage, Shop-Synchronisierung) per SKU verknüpfen. */
export function LinkTemuButton({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState<TransferState>(async () => linkTemuAction(), null);
  return (
    <form action={action} className="stack" style={{ gap: 6 }}>
      <div>
        <button className="btn" type="submit" disabled={disabled || pending} data-testid="link-temu" title="Produkte, die per Excel-Vorlage oder Shop-Synchronisierung zu Temu kamen: über die SKU mit eBay/Lager verknüpfen, dann folgt die Menge dem Bestand">
          {pending ? "Suche bei Temu …" : "Bei Temu vorhandene Produkte verknüpfen"}
        </button>
      </div>
      {state && <div className={`notice small ${state.ok ? "notice-ok" : "notice-warn"}`} data-testid="link-temu-msg">{state.message}</div>}
    </form>
  );
}
