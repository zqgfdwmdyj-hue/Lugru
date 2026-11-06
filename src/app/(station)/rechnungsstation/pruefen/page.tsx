import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { ConfirmButton } from "@/components/confirm-button";
import { AMPEL_TEXT, BELEG_ARTEN, type Ampel } from "@/lib/rechnungsstation/logic";
import { eingangsOrdner, pruefListe, stapelListe } from "@/lib/rechnungsstation/service";
import { belegPruefenAction, belegVerwerfenAction, ordnerJetztAction, pdfStapelHochladenAction, stationEinstellungenAction, weitergebenJetztAction } from "./actions";

export const metadata: Metadata = { title: "Rechnungsstation: Prüfliste – Seller-System" };

// Prüfliste: unklare (rot) und unsichere (gelb) Belege mit dem Bild daneben korrigieren. Rote gehen erst nach der
// Prüfung an Stotax, gelbe sind mit Vermerk schon unterwegs. Status je Beleg: erfasst → zugeordnet → an Stotax.

const eur = (n: number | null) => (n === null ? "–" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
const zeit = (d: Date | null) => (d ? d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–");
const ART: Record<string, string> = { rechnung: "Rechnung", kassenzettel: "Kassenzettel", lieferschein: "Lieferschein", gutschrift: "Gutschrift", sonstiges: "kein Beleg / sonstiges" };
const artVon = (docType: string) => (docType === "quittung" ? "kassenzettel" : docType === "lieferschein" || docType === "gutschrift" ? docType : docType === "unbekannt" || docType === "keinbeleg" ? "sonstiges" : "rechnung");
const TAG: Record<Ampel, string> = { gruen: "tag-ok", gelb: "tag-warn", rot: "tag-critical" };

export default async function PruefPage({ searchParams }: { searchParams: Promise<{ stapel?: string; meldung?: string; fehler?: string }> }) {
  const s = await requireArea("service", "buchhaltung", "geld");
  const sp = await searchParams;
  const stapel = sp.stapel && /^[0-9a-f-]{36}$/.test(sp.stapel) ? sp.stapel : null;
  const [liste, stapelRows, settings] = await Promise.all([pruefListe(s.tenantId, stapel), stapelListe(s.tenantId), getSettings(s.tenantId)]);
  const I = schema.invoices;
  const alle = stapel ? await db.select().from(I).where(and(eq(I.tenantId, s.tenantId), eq(I.stapelId, stapel))).orderBy(desc(I.aufgenommenAm), desc(I.createdAt)).limit(500) : [];
  const ordner = eingangsOrdner();
  const inhaber = s.role === "owner" && !s.readOnly;
  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }} className="stack" data-testid="pruefliste">
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Link href="/">← Seller-System</Link>
        <h1 style={{ margin: 0, flexGrow: 1 }}>Rechnungsstation: Prüfliste</h1>
        <Link href="/rechnungsstation" className="btn btn-primary">Station (Kamera)</Link>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" data-testid="pruef-meldung">{sp.meldung}</div>}
      {sp.fehler && <div className="notice notice-error small" role="alert" data-testid="pruef-fehler">{sp.fehler}</div>}

      {!s.readOnly && (
        <section className="card card-pad" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <form action={pdfStapelHochladenAction} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="field">
              <label className="label" htmlFor="pdf-stapel">PDF-Stapel vom Einzugsscanner</label>
              <input id="pdf-stapel" name="datei" type="file" accept="application/pdf,.pdf" required data-testid="pdf-stapel-datei" />
            </div>
            <button type="submit" className="btn" data-testid="pdf-stapel-hochladen">Hochladen & trennen</button>
          </form>
          {ordner && (
            <form action={ordnerJetztAction}>
              <button type="submit" className="btn" data-testid="ordner-pruefen">Scanner-Ordner jetzt prüfen</button>
            </form>
          )}
          <form action={weitergebenJetztAction}>
            <input type="hidden" name="stapel" value={stapel ?? ""} />
            <button type="submit" className="btn" data-testid="jetzt-weitergeben" title="Sonst automatisch alle 15 Minuten">Ausstehende jetzt an Stotax</button>
          </form>
          <span className="small muted" style={{ flexBasis: "100%" }}>
            {ordner ? "Scanner-Ordner wird jede Minute geprüft: PDFs werden an den Rechnungsnummern getrennt." : "Scanner-Ordner ist nicht eingerichtet (BELEG_EINGANG_DIR) – PDFs hier hochladen."} Grüne und gelbe Belege gehen alle 15 Minuten an Stotax (gelbe mit Vermerk), rote erst nach der Prüfung.
          </span>
        </section>
      )}

      <section className="card card-pad stack" style={{ gap: 6 }} data-testid="stapel-liste">
        <h2 style={{ margin: 0 }}>Stapel</h2>
        {stapelRows.length ? (
          <div className="table-wrap">
            <table className="table small">
              <thead><tr><th>Stapel</th><th>Quelle</th><th>Wer</th><th>Belege</th><th>offen</th><th>Beginn</th><th></th></tr></thead>
              <tbody>
                {stapelRows.map((r) => (
                  <tr key={r.id} data-testid="stapel-zeile" style={r.id === stapel ? { fontWeight: 600 } : undefined}>
                    <td>{r.name}</td>
                    <td>{r.quelle === "kamera" ? "Kamera" : r.quelle === "ordner" ? "Scanner-Ordner" : "Upload"}</td>
                    <td>{r.wer ?? "–"}</td>
                    <td>{r.n}</td>
                    <td>{r.unklar ? <span className="tag tag-warn">{r.unklar}</span> : "0"}</td>
                    <td>{zeit(r.createdAt)}{r.beendetAm ? "" : " · läuft"}</td>
                    <td><Link href={`/rechnungsstation/pruefen?stapel=${r.id}`}>ansehen</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="small muted">Noch keine Stapel.</div>
        )}
      </section>

      <section className="stack" style={{ gap: 12 }} data-testid="pruef-belege">
        <h2 style={{ margin: 0 }}>Zu prüfen{stapel ? " (dieser Stapel)" : ""}: {liste.length}</h2>
        {!liste.length && <div className="small muted">Nichts zu prüfen.</div>}
        {liste.map((b) => {
          const bild = b.bildFileIds[1] ?? b.bildFileIds[0];
          const dup = b.checks.duplicateOf?.[0];
          return (
            <div key={b.id} className="card card-pad" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }} data-testid="pruef-beleg" data-ampel={b.ampel ?? ""}>
              <div style={{ minHeight: 280, background: "var(--surface-2, #f1f5f9)", borderRadius: 6, overflow: "hidden" }}>
                {bild ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a href={`/datei/${bild}`} target="_blank" rel="noreferrer"><img src={`/datei/${bild}`} alt="Beleg" style={{ width: "100%", height: "auto", display: "block" }} /></a>
                ) : b.fileId ? (
                  <object data={`/datei/${b.fileId}`} type="application/pdf" style={{ width: "100%", height: 420 }}><a href={`/datei/${b.fileId}`}>PDF öffnen</a></object>
                ) : (
                  <div className="small muted" style={{ padding: 12 }}>Kein Bild gespeichert.</div>
                )}
              </div>
              <div className="stack" style={{ gap: 8 }}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span className={`tag ${TAG[(b.ampel as Ampel) ?? "rot"]}`}>{AMPEL_TEXT[(b.ampel as Ampel) ?? "rot"]}</span>
                  {b.pruefGruende.map((g) => <span key={g} className="tag tag-neutral">{g}</span>)}
                  {b.seiten > 1 && <span className="small muted">{b.seiten} Seiten</span>}
                  {b.fileId && <a className="small" href={`/datei/${b.fileId}`} target="_blank" rel="noreferrer">PDF</a>}
                </div>
                {dup && <div className="notice notice-warn small" data-testid="pruef-duplikat">{dup.reason}</div>}
                <form action={belegPruefenAction} className="stack" style={{ gap: 8 }}>
                  <input type="hidden" name="id" value={b.id} />
                  <input type="hidden" name="stapel" value={stapel ?? ""} />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <label className="label">Art<select className="select" name="art" defaultValue={artVon(b.docType)} style={{ display: "block" }}>{BELEG_ARTEN.map((a) => <option key={a} value={a}>{ART[a]}</option>)}</select></label>
                    <label className="label" style={{ flexGrow: 1 }}>Lieferant / Händler<input className="input" name="lieferant" defaultValue={b.vendor ?? ""} required style={{ display: "block", width: "100%" }} data-testid="pruef-lieferant" /></label>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <label className="label">Rechnungsnr.<input className="input" name="nummer" defaultValue={b.invoiceNumber ?? ""} style={{ display: "block", width: 150 }} data-testid="pruef-nummer" /></label>
                    <label className="label">Datum<input className="input" type="date" name="datum" defaultValue={b.invoiceDate ?? ""} required style={{ display: "block" }} data-testid="pruef-datum" /></label>
                    <label className="label">Fällig am<input className="input" type="date" name="faellig" defaultValue={b.faelligAm ?? ""} style={{ display: "block" }} /></label>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <label className="label">Netto<input className="input" name="netto" inputMode="decimal" defaultValue={b.totalNet !== null ? String(b.totalNet).replace(".", ",") : ""} style={{ display: "block", width: 110 }} /></label>
                    <label className="label">Brutto<input className="input" name="brutto" inputMode="decimal" defaultValue={b.totalGross !== null ? String(b.totalGross).replace(".", ",") : ""} required style={{ display: "block", width: 110 }} data-testid="pruef-brutto" /></label>
                    {b.ust.length > 0 && <span className="small muted" style={{ alignSelf: "flex-end" }}>USt {b.ust.map((u) => `${u.satz} %: ${eur(u.betrag)}`).join(", ")}</span>}
                  </div>
                  {dup && <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="keinDuplikat" data-testid="pruef-kein-duplikat" /> Kein Duplikat (eigener Beleg)</label>}
                  {b.positionen.length > 0 && (
                    <details className="small"><summary>{b.positionen.length} Positionen</summary>
                      <ul>{b.positionen.slice(0, 30).map((p, i) => <li key={i}>{p.menge ?? "?"}× {p.artikel ?? "?"}{p.asin ? ` (${p.asin})` : ""}{p.ek !== null ? ` à ${eur(p.ek)}` : ""}</li>)}</ul>
                    </details>
                  )}
                  {!s.readOnly && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="submit" className="btn btn-primary" data-testid="pruef-speichern">Speichern & freigeben</button>
                    </div>
                  )}
                </form>
                {!s.readOnly && (
                  <form action={belegVerwerfenAction}>
                    <input type="hidden" name="id" value={b.id} />
                    <input type="hidden" name="stapel" value={stapel ?? ""} />
                    <ConfirmButton confirm="Als „kein Beleg“ markieren? Er wird nicht an Stotax gegeben." testid="pruef-verwerfen">Kein Beleg</ConfirmButton>
                  </form>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {stapel && alle.length > 0 && (
        <section className="card card-pad stack" style={{ gap: 6 }} data-testid="stapel-belege">
          <h2 style={{ margin: 0 }}>Alle Belege dieses Stapels</h2>
          <div className="table-wrap">
            <table className="table small">
              <thead><tr><th>Lieferant</th><th>Nr.</th><th>Datum</th><th>Brutto</th><th>Ampel</th><th>erfasst</th><th>zugeordnet</th><th>an Stotax</th></tr></thead>
              <tbody>
                {alle.map((b) => (
                  <tr key={b.id} data-testid="stapel-beleg" data-status={b.stotaxSentAt ? "stotax" : b.zugeordnetAm ? "zugeordnet" : "erfasst"}>
                    <td>{b.vendor ?? "–"}{b.seiten > 1 ? ` (${b.seiten} S.)` : ""}</td>
                    <td>{b.invoiceNumber ?? "–"}</td>
                    <td>{b.invoiceDate ? b.invoiceDate.split("-").reverse().join(".") : "–"}</td>
                    <td>{eur(b.totalGross)}</td>
                    <td>{b.status === "ignored" ? "kein Beleg" : b.ampel ? <span className={`tag ${TAG[b.ampel as Ampel]}`}>{b.geprueftAm ? "geprüft" : AMPEL_TEXT[b.ampel as Ampel]}</span> : "liest …"}</td>
                    <td>{zeit(b.createdAt)}</td>
                    <td>{b.zugeordnetAm ? `${zeit(b.zugeordnetAm)}${b.zuordnung ? ` · ${b.zuordnung.text}` : " · Charge (ASIN)"}` : "–"}</td>
                    <td>{b.stotaxSentAt ? zeit(b.stotaxSentAt) : b.stotaxError ? <span title={b.stotaxError}>Fehler</span> : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {inhaber && (
        <form action={stationEinstellungenAction} className="card card-pad stack" style={{ gap: 8 }} data-testid="station-einstellungen">
          <h2 style={{ margin: 0 }}>Einstellungen (nur Inhaber)</h2>
          <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="ordnerAn" defaultChecked={settings.rechnungsstation.ordnerAn} /> Scanner-Ordner automatisch auswerten</label>
          <label className="label">Google-Drive-Belegordner (Ordner-ID oder Link)<input className="input" name="driveOrdnerId" defaultValue={settings.rechnungsstation.driveOrdnerId} placeholder="…/folders/<ID>" style={{ display: "block", width: 420, maxWidth: "100%" }} /></label>
          <span className="small muted">Braucht unter Anbindungen → Google Drive einen Dienstkonto-Schlüssel; das Dienstkonto muss im Ordner „Bearbeiter“ sein. Eigene Ablagen werden beim Rechnungs-Abruf übersprungen.</span>
          <div><button type="submit" className="btn">Speichern</button></div>
        </form>
      )}
    </div>
  );
}
