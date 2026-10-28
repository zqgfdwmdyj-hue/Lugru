"use client";

import { useActionState } from "react";
import { SHIP_CHOICE_LABEL, type ShipChoice } from "@/lib/shipping/packing-slip";
import { slipAction, type SlipState } from "./actions";

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const kgText = (g: number | null) => (g === null ? "" : (g / 1000).toLocaleString("de-DE", { maximumFractionDigits: 3 }));

/**
 * Labels in einem Schritt: Amazon-Lieferschein hochladen oder offene Aufträge (z. B. eBay) übernehmen →
 * Vorschau mit Versandart je Bestellung (1 Stück → Warensendung, ab 2 → DHL) → ein Knopf für alle Labels.
 */
export function SlipForm({ postReady, dhlReady, postPrice, sandbox, initial }: { postReady: boolean; dhlReady: boolean; postPrice: number; sandbox: boolean; initial: SlipState }) {
  const [state, action, pending] = useActionState<SlipState, FormData>(slipAction, initial);
  const rows = state?.rows ?? [];
  const labels = state?.labels;
  const open = rows.filter((r) => !r.done);
  const count = (c: ShipChoice) => open.filter((r) => r.choice === c).length;
  const resultFor = (id: string) => labels?.results.find((x) => x.orderId === id);
  // Artikel der offenen Sendungen – Gewicht je Stück einmal eintragen, gilt dann für alle Sendungen.
  const skus = [...new Map(open.flatMap((r) => r.skus).map((s) => [s.sku, s])).values()].sort((a, b) => Number(a.grams !== null) - Number(b.grams !== null) || a.title.localeCompare(b.title, "de"));

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="slip-sources">
        <form action={action} className="card card-pad stack" style={{ gap: 10 }} data-testid="slip-upload">
          <h2>Amazon-Lieferschein</h2>
          <label className="label" htmlFor="slip-pdf">PDF aus Seller Central (eine Bestellung je Seite)</label>
          <input className="input" id="slip-pdf" name="pdf" type="file" accept="application/pdf,.pdf" required data-testid="slip-file" />
          <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" name="direkt" data-testid="slip-direct" /> Labels gleich erstellen (ohne Vorschau)
          </label>
          <div>
            <button className="btn btn-primary" type="submit" disabled={pending} data-testid="slip-read">{pending ? "Bitte warten …" : "Lieferschein einlesen"}</button>
          </div>
        </form>
        <form action={action} className="card card-pad stack" style={{ gap: 10 }} data-testid="slip-open">
          <input type="hidden" name="intent" value="open" />
          <h2>Offene Aufträge</h2>
          <label className="label" htmlFor="slip-channel">Kanal (Name und Anschrift kommen aus dem Auftrag)</label>
          <select className="select" id="slip-channel" name="channel" defaultValue="ebay" data-testid="slip-channel">
            <option value="ebay">eBay</option>
            <option value="amazon">Amazon (FBM)</option>
            <option value="alle">alle Kanäle</option>
          </select>
          <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" name="refresh" defaultChecked data-testid="slip-refresh" /> vorher neue Bestellungen abrufen
          </label>
          <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" name="direkt" data-testid="slip-open-direct" /> Labels gleich erstellen (ohne Vorschau)
          </label>
          <div>
            <button className="btn btn-primary" type="submit" disabled={pending} data-testid="slip-load-open">{pending ? "Bitte warten …" : "Offene Aufträge übernehmen"}</button>
          </div>
        </form>
      </div>
      <span className="small muted">1 Stück → Warensendung (Deutsche Post, {eur(postPrice)}) · ab 2 Stück → DHL-Paket · „bitte prüfen“ wird nicht gekauft. Bestellungen „bitte prüfen“ und alles mit Label bleiben stehen.</span>

      {state?.error && <div className="notice notice-error" data-testid="slip-error">{state.error}</div>}
      {state?.note && <div className="notice notice-info" data-testid="slip-note">{state.note}</div>}

      {labels && (
        <section className="card card-pad stack" data-testid="slip-result">
          <h2>{labels.results.filter((r) => r.ok).length} Label(s) erstellt{labels.results.some((r) => !r.ok) ? ` · ${labels.results.filter((r) => !r.ok).length} nicht` : ""}</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {labels.fileId && <a className="btn btn-primary" href={`/datei/${labels.fileId}`} target="_blank" rel="noreferrer" data-testid="slip-pdf-all">Alle Labels öffnen & drucken</a>}
            {labels.postFileId && labels.dhlFileId && <a className="btn" href={`/datei/${labels.postFileId}`} target="_blank" rel="noreferrer" data-testid="slip-pdf-post">Nur Warensendungen</a>}
            {labels.postFileId && labels.dhlFileId && <a className="btn" href={`/datei/${labels.dhlFileId}`} target="_blank" rel="noreferrer" data-testid="slip-pdf-dhl">Nur DHL</a>}
          </div>
          {labels.walletCents !== null && <span className="small muted">Guthaben Portokasse danach: {eur(labels.walletCents / 100)}</span>}
          <span className="small muted">Danach unter Aufträge → „Label erstellt“ → „Alle als versendet markieren“: Amazon bzw. eBay bekommen die Versandmeldung (Warensendung ohne Sendungsnummer).</span>
        </section>
      )}

      {skus.length > 0 && (
        <form action={action} className="card card-pad stack" style={{ gap: 10 }} data-testid="slip-weights">
          <input type="hidden" name="intent" value="weights" />
          <h2>Gewicht je Artikel</h2>
          <span className="small muted">Versandgewicht für <strong>ein Stück inkl. Verpackung</strong> – einmal eintragen, dann rechnet jede Sendung Stück × Gewicht (z. B. 2 × 0,3 kg = 0,6 kg). Gilt für Amazon und eBay gleich.</span>
          <div className="slip-weights">
            {skus.map((s, i) => (
              <div key={s.sku} className="field" data-testid="slip-weight" data-sku={s.sku}>
                <label className="label small" htmlFor={`w_${i}`} title={s.sku}>{s.title.length > 60 ? `${s.title.slice(0, 58)} …` : s.title}</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input className="input" id={`w_${i}`} name={`w_${i}`} defaultValue={kgText(s.grams)} placeholder="z. B. 0,3" inputMode="decimal" style={{ width: 90 }} />
                  <span className="small muted">kg</span>
                  {s.grams === null && <span className="tag tag-warn">fehlt</span>}
                </div>
                <span className="small muted num">{s.sku}</span>
                <input type="hidden" name={`s_${i}`} value={s.sku} />
                <input type="hidden" name={`o_${i}`} value={kgText(s.grams)} />
              </div>
            ))}
          </div>
          <div><button className="btn" type="submit" disabled={pending} data-testid="slip-save-weights">Gewichte speichern & neu rechnen</button></div>
        </form>
      )}

      {rows.length > 0 && (
        <form action={action} className="stack" style={{ gap: 10 }} data-testid="slip-preview">
          <input type="hidden" name="intent" value="create" />
          <section className="card" style={{ overflow: "auto" }}>
            <table className="table">
              <thead><tr><th>Bestellung</th><th>Empfänger</th><th>Artikel</th><th className="right">Stück</th><th>Versand</th><th>Ergebnis</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const res = resultFor(r.orderId);
                  return (
                    <tr key={r.orderId} data-testid="slip-row" data-order={r.orderNo} data-choice={r.choice}>
                      <td className="num"><a href={`/auftraege/${r.orderId}`} target="_blank" rel="noreferrer">{r.orderNo}</a><div className="small muted">{r.channel}</div></td>
                      <td>{r.name}<div className="small muted">{r.place}</div>{r.warnings.length > 0 && <div className="small" style={{ color: "var(--warn)" }}>{r.warnings.join(" · ")}</div>}</td>
                      <td className="small" style={{ maxWidth: 280 }}>{r.items}</td>
                      <td className="num right"><strong>{r.quantity}</strong></td>
                      <td>
                        {r.done ? (
                          <span className="small muted">{r.done}</span>
                        ) : (
                          <>
                            <input type="hidden" name="orderId" value={r.orderId} />
                            <select key={`${r.orderId}:${r.choice}`} className="select" name={`choice_${r.orderId}`} defaultValue={r.choice} aria-label={`Versandart ${r.orderNo}`} data-testid="slip-choice">
                              {(["warensendung", "dhl", "pruefen"] as const).map((c) => <option key={c} value={c}>{c === "pruefen" ? "nicht versenden (prüfen)" : SHIP_CHOICE_LABEL[c]}</option>)}
                            </select>
                            <div className="small muted">{r.reason}</div>
                            <div className="small" data-testid="slip-weight-note" style={{ color: r.weightSource === "geschaetzt" ? "var(--warn)" : "var(--muted)" }}>{r.weightNote}</div>
                          </>
                        )}
                      </td>
                      <td className="small" data-testid="slip-row-result">{res ? <span style={{ color: res.ok ? "var(--ok)" : "var(--danger)" }}>{res.message}</span> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          {open.length > 0 && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn btn-primary" type="submit" disabled={pending || (!postReady && !dhlReady)} data-testid="slip-create">
                {pending ? "Bitte warten …" : count("warensendung") + count("dhl") > 0 ? `Labels erstellen: ${count("warensendung")} × Warensendung, ${count("dhl")} × DHL` : "Labels für die Auswahl erstellen"}
              </button>
              <span className="small muted">
                Warensendungen ca. {eur(count("warensendung") * postPrice)} aus der Portokasse{sandbox ? " · DHL-Sandbox aktiv (Testlabels)" : ""}. Eine Auswahl oben ändern geht vor dem Erstellen.
              </span>
            </div>
          )}
          {!postReady && count("warensendung") > 0 && <div className="notice notice-warn small">Deutsche Post ist noch nicht eingerichtet – <a href="/anbindungen?p=deutschepost#deutschepost">Anbindungen → Deutsche Post INTERNETMARKE</a>. Bis dahin gehen nur DHL-Labels.</div>}
          {!dhlReady && count("dhl") > 0 && <div className="notice notice-warn small">DHL ist noch nicht eingerichtet – Anbindungen → DHL und Einstellungen → Versand.</div>}
        </form>
      )}
    </div>
  );
}
