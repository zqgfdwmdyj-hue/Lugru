"use client";

import { useActionState } from "react";
import { SHIP_CHOICE_LABEL, type ShipChoice } from "@/lib/shipping/packing-slip";
import { slipAction, type SlipState } from "./actions";

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

/** Lieferschein hochladen → Vorschau mit Versandart je Bestellung → ein Knopf für alle Labels. */
export function SlipForm({ postReady, dhlReady, postPrice, sandbox }: { postReady: boolean; dhlReady: boolean; postPrice: number; sandbox: boolean }) {
  const [state, action, pending] = useActionState<SlipState, FormData>(slipAction, null);
  const rows = state?.rows ?? [];
  const labels = state?.labels;
  const open = rows.filter((r) => !r.done);
  const count = (c: ShipChoice) => open.filter((r) => r.choice === c).length;
  const resultFor = (id: string) => labels?.results.find((x) => x.orderId === id);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <form action={action} className="card card-pad stack" style={{ gap: 10 }} data-testid="slip-upload">
        <label className="label" htmlFor="slip-pdf">Amazon-Lieferschein (PDF, eine Bestellung je Seite)</label>
        <input className="input" id="slip-pdf" name="pdf" type="file" accept="application/pdf,.pdf" required data-testid="slip-file" />
        <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" name="direkt" data-testid="slip-direct" /> Labels gleich erstellen (ohne Vorschau) – Bestellungen mit „bitte prüfen“ bleiben stehen
        </label>
        <div>
          <button className="btn btn-primary" type="submit" disabled={pending} data-testid="slip-read">{pending ? "Bitte warten …" : "Lieferschein einlesen"}</button>
        </div>
        <span className="small muted">1 Stück → Warensendung (Deutsche Post, {eur(postPrice)}) · ab 2 Stück → DHL-Paket. Aufträge werden angelegt bzw. den schon abgerufenen zugeordnet.</span>
      </form>

      {state?.error && <div className="notice notice-error" data-testid="slip-error">{state.error}</div>}
      {state?.note && <div className="notice notice-warn">{state.note}</div>}

      {labels && (
        <section className="card card-pad stack" data-testid="slip-result">
          <h2>{labels.results.filter((r) => r.ok).length} Label(s) erstellt{labels.results.some((r) => !r.ok) ? ` · ${labels.results.filter((r) => !r.ok).length} nicht` : ""}</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {labels.fileId && <a className="btn btn-primary" href={`/datei/${labels.fileId}`} target="_blank" rel="noreferrer" data-testid="slip-pdf-all">Alle Labels öffnen & drucken</a>}
            {labels.postFileId && labels.dhlFileId && <a className="btn" href={`/datei/${labels.postFileId}`} target="_blank" rel="noreferrer" data-testid="slip-pdf-post">Nur Warensendungen</a>}
            {labels.postFileId && labels.dhlFileId && <a className="btn" href={`/datei/${labels.dhlFileId}`} target="_blank" rel="noreferrer" data-testid="slip-pdf-dhl">Nur DHL</a>}
          </div>
          {labels.walletCents !== null && <span className="small muted">Guthaben Portokasse danach: {eur(labels.walletCents / 100)}</span>}
          <span className="small muted">Danach unter Aufträge → „Label erstellt“ → „Alle als versendet markieren“: Amazon bekommt die Versandbestätigung (Warensendung ohne Sendungsnummer).</span>
        </section>
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
                      <td className="num"><a href={`/auftraege/${r.orderId}`} target="_blank" rel="noreferrer">{r.orderNo}</a></td>
                      <td>{r.name}<div className="small muted">{r.place}</div>{r.warnings.length > 0 && <div className="small" style={{ color: "var(--warn)" }}>{r.warnings.join(" · ")}</div>}</td>
                      <td className="small" style={{ maxWidth: 280 }}>{r.items}</td>
                      <td className="num right"><strong>{r.quantity}</strong></td>
                      <td>
                        {r.done ? (
                          <span className="small muted">{r.done}</span>
                        ) : (
                          <>
                            <input type="hidden" name="orderId" value={r.orderId} />
                            <select className="select" name={`choice_${r.orderId}`} defaultValue={r.choice} aria-label={`Versandart ${r.orderNo}`} data-testid="slip-choice">
                              {(["warensendung", "dhl", "pruefen"] as const).map((c) => <option key={c} value={c}>{c === "pruefen" ? "nicht versenden (prüfen)" : SHIP_CHOICE_LABEL[c]}</option>)}
                            </select>
                            <div className="small muted">{r.reason}{r.choice === "dhl" ? ` · ${r.weightKg.toLocaleString("de-DE")} kg` : ""}</div>
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
                {pending ? "Erstelle Labels …" : count("warensendung") + count("dhl") > 0 ? `Labels erstellen: ${count("warensendung")} × Warensendung, ${count("dhl")} × DHL` : "Labels für die Auswahl erstellen"}
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
