import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { integrationStatus } from "@/lib/integrations/store";
import { REPORT_KINDS } from "@/lib/reports/amazon";
import { MARKT_BERICHTE, berichtVonTyp } from "@/lib/amazon-markt/store";
import { landVonId } from "@/lib/amazon-markt/logic";
import { aoImporte, aoLaeufe } from "@/lib/arbitrageone/abruf";
import { AO_EXPORTE, kurzFehler } from "@/lib/arbitrageone/logic";
import { discordLiveStatus } from "@/lib/discord/gateway";
import { ABRUF_PLAN, naechsterText } from "@/lib/today/abruf-plan";
import { abrufListe, type AbrufZeile } from "../../anbindungen/abrufe";
import { aoJetztAbholenAction, fetchAmazonReportsNow, importErneutAction, requestAmazonReport, requestKontoBerichteNow, requestMarktBerichteNow, runAllNow } from "../../anbindungen/actions";

// Einstellungen › Hintergrund & Importe: was automatisch läuft (Abrufe mit letztem/nächstem Lauf, Amazon-Berichte,
// Discord live) und was importiert wurde (ArbitrageOne, ProfitGuard-Dateien). Zugangsdaten stehen unter „Anbindungen“.

const zeit = (d: Date | null) => (d ? d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }) : null);

const MARKT_NAME: Record<keyof typeof MARKT_BERICHTE, string> = { buybox: "Buy-Box-Anteil (Sales and Traffic)", listungen: "Listung (Alle Angebote)", lageralter: "Lageralter (Bestandsplanung)" };
const AMZ_MSG: Record<string, (n: number) => string> = {
  angefordert: (n) => `${n} Bericht${n === 1 ? "" : "e"} je Land angefordert – Amazon braucht meist einige Minuten, dann „Fertige Berichte abholen“.`,
  fehler: (n) => `${n} angefordert, mindestens eine Anforderung schlug fehl (siehe Liste).`,
  abgeholt: (n) => (n ? `${n} fertige Bericht${n === 1 ? "" : "e"} übernommen.` : "Noch nichts fertig – in ein paar Minuten erneut versuchen."),
  konto: (n) => `${n} Berichte angefordert (Kontozustand, gestrandet/gesperrt, Langzeitlager, Inbound-Mängel, Umsatzsteuer) – in ein paar Minuten „Fertige Berichte abholen“.`,
};
/** Amazon-Berichte 1–4: Anzeigename je Berichtstyp. */
const KONTO_NAME: Record<string, string> = {
  GET_V2_SELLER_PERFORMANCE_REPORT: "Kontozustand (Leistung des Verkäufers)",
  GET_VAT_TRANSACTION_DATA: "Umsatzsteuer-Transaktionsbericht",
  GET_STRANDED_INVENTORY_UI_DATA: "Gestrandeter Bestand",
  GET_MERCHANTS_LISTINGS_FYP_REPORT: "Gesperrte Angebote",
  GET_FBA_FBA_LONGTERM_STORAGE_FEE_CHARGES_DATA: "Langzeit-Lagergebühren",
  GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA: "Inbound-Mängel (Gebühren)",
};
/** „GET_SALES_AND_TRAFFIC_REPORT@A1PA…“ → „Buy-Box-Anteil (Sales and Traffic) DE“ */
function berichtName(t: string) {
  const [typ, mp] = t.split("@");
  const b = mp ? berichtVonTyp(typ) : null;
  return b ? `${MARKT_NAME[b]} ${landVonId(mp) ?? mp}` : (KONTO_NAME[typ] ?? t);
}

const AO_MSG: Record<string, string> = { ok: "ArbitrageOne: alle Exporte abgeholt und verarbeitet.", teilweise: "ArbitrageOne: nicht alle Exporte geklappt – siehe Liste und Aufgabe.", fehler: "ArbitrageOne-Abruf fehlgeschlagen – siehe Liste und Aufgabe." };
const AO_STATUS: Record<string, string> = { laeuft: "läuft", ok: "ok", teilweise: "teilweise", fehler: "Fehler" };

export default async function HintergrundPage({ searchParams }: { searchParams: Promise<{ amz?: string; n?: string; ao?: string; erneut?: string }> }) {
  const session = await requireOwner();
  const { amz, n, ao, erneut } = await searchParams;
  const status = await integrationStatus(session.tenantId);
  const [reports, abrufe, live, bqExporte, aoL, aoI] = await Promise.all([
    db.select().from(schema.apiReportRequests).where(eq(schema.apiReportRequests.tenantId, session.tenantId)).orderBy(desc(schema.apiReportRequests.requestedAt)).limit(12),
    abrufListe(session.tenantId),
    discordLiveStatus(session.tenantId),
    db.select({ id: schema.profitguardExporte.id, anzahl: schema.profitguardExporte.anzahl, nurAenderungen: schema.profitguardExporte.nurAenderungen, importiertAm: schema.profitguardExporte.importiertAm, importiertVon: schema.profitguardExporte.importiertVon, createdAt: schema.profitguardExporte.createdAt }).from(schema.profitguardExporte).where(eq(schema.profitguardExporte.tenantId, session.tenantId)).orderBy(desc(schema.profitguardExporte.createdAt)).limit(10),
    aoLaeufe(session.tenantId, 8),
    aoImporte(session.tenantId, 20),
  ]);
  const aoEingerichtet = status.has("arbitrageone_web");
  const aoPlan = ABRUF_PLAN["ArbitrageOne: Exporte abholen"];
  const aoLetzterPlan = aoL.find((l) => l.ausloeser === "zeitplan")?.createdAt ?? null;
  const jetzt = new Date();
  const discordAbrufe = abrufe.filter((a) => /discord|call/i.test(a.name));
  const uebrigeAbrufe = abrufe.filter((a) => !/discord|call/i.test(a.name));
  const abrufZeile = (a: AbrufZeile) => (
    <tr key={a.name} data-testid="abruf-zeile">
      <td>{a.name}</td>
      <td className="small">{a.abgeloest ? <span className="muted" data-testid="abruf-abgeloest">{a.abgeloest}</span> : (a.plan?.text ?? "Zeitplan: wird beim nächsten Lauf erfasst")}</td>
      <td className="small num">{zeit(a.letzter) ?? "–"}{a.fehler && <div style={{ color: "var(--danger)" }}>Fehler: {a.fehler.slice(0, 160)}</div>}{a.status && <div className="muted" data-testid="abruf-status">{a.status}</div>}</td>
      <td className="small">{a.naechster}</td>
    </tr>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Einstellungen</div>
          <h1>Hintergrund &amp; Importe</h1>
        </div>
      </div>
      <p className="muted" style={{ margin: 0, maxWidth: 760 }}>
        Was das System selbst abruft (mit letztem und nächstem Lauf) und was importiert wurde. Zugangsdaten und Verbindungen stehen unter <Link href="/anbindungen">Anbindungen</Link>, Datei-Uploads unter <Link href="/import">Uploads</Link>.
      </p>
      <nav className="small" style={{ display: "flex", gap: 12, flexWrap: "wrap" }} data-testid="hintergrund-sprung">
        <a href="#abrufe">Hintergrund-Abrufe</a>
        {status.get("amazon_sp") && <a href="#amazon-berichte">Amazon-Berichte</a>}
        {(aoEingerichtet || aoI.length > 0) && <a href="#importe-arbitrageone">Importe – ArbitrageOne</a>}
        {bqExporte.length > 0 && <a href="#importe-exporte">ProfitGuard-Dateien</a>}
      </nav>
      <section className="card card-pad stack" id="abrufe" data-testid="hintergrund-abrufe">
        <div className="between">
          <h2>Hintergrund-Abrufe</h2>
          <form action={runAllNow}><button className="btn btn-small" type="submit">Jetzt alles abrufen</button></form>
        </div>
        <div className="small muted">Amazon- und eBay-Bestellungen plus Bestandsabgleich aller Kanäle alle 5 Minuten, Postfächer alle 15 Minuten, Amazon-Reports nach Plan (Bestand alle 4 Std., Protokolle täglich, Buy Box/Listung/Lageralter je Land täglich, Kontozustand und gestrandet/gesperrt täglich, Umsatzsteuer alle 3 Tage, Langzeitlager und Inbound-Mängel wöchentlich), Rechnungen stündlich.</div>
        {status.get("amazon_sp") && (
          <form action={requestAmazonReport} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <label htmlFor="rk" className="small">Amazon-Report sofort anfordern:</label>
            <select className="select" id="rk" name="kind" style={{ width: 280, maxWidth: "100%" }}>{Object.entries(REPORT_KINDS).filter(([k]) => k !== "settlement").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <button className="btn btn-small" type="submit">Anfordern</button>
          </form>
        )}
        {status.get("amazon_sp") && (
          <div id="amazon-berichte" className="stack" style={{ gap: 6 }} data-testid="amazon-berichte">
            <form action={requestMarktBerichteNow} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <label htmlFor="mb" className="small">Je Land (alle Marktplätze der Anbindung):</label>
              <select className="select" id="mb" name="bericht" style={{ width: 280, maxWidth: "100%" }}>
                <option value="alle">Buy Box, Listung und Lageralter</option>
                {Object.entries(MARKT_NAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button className="btn btn-small" type="submit">Anfordern</button>
            </form>
            <form action={requestKontoBerichteNow} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span className="small">Konto &amp; Gebühren: Kontozustand, gestrandet/gesperrt, Langzeitlager, Inbound-Mängel, Umsatzsteuer</span>
              <button className="btn btn-small" type="submit" data-testid="konto-berichte-anfordern">Konto-Berichte anfordern</button>
            </form>
            <form action={fetchAmazonReportsNow}><button className="btn btn-small" type="submit">Fertige Berichte abholen</button></form>
            {amz && AMZ_MSG[amz] && <div className={`notice ${amz === "fehler" ? "notice-warn" : amz === "abgeholt" && Number(n) > 0 ? "notice-ok" : "notice-info"}`} data-testid="amazon-berichte-msg" role="status">{AMZ_MSG[amz](Number(n) || 0)}</div>}
          </div>
        )}
        {(status.get("discord_calls") || discordAbrufe.length > 0) && (
          <div className="small" data-testid="discord-live-status">
            <strong>Discord – Call-Kanal:</strong>{" "}
            {live.aktiv ? (live.zustand === "verbunden" ? <>Auslöser: live (Discord) – verbunden seit {zeit(live.seit)}</> : live.zustand === "verbinde" ? <>Auslöser: live (Discord) – verbindet …</> : <span style={{ color: "var(--danger)" }}>Live-Verbindung {live.zustand === "fehler" ? "abgelehnt" : "getrennt"}: {live.fehler}</span>) : <>Live-Verbindung aus – Sicherheitsnetz täglich 06:00</>}
            {" · "}zuletzt empfangen: <span data-testid="discord-zuletzt-empfangen">{zeit(live.zuletztEmpfangen) ?? "noch nichts"}</span> · Sicherheitsnetz: täglich 06:00 (letzte 7 Tage)
          </div>
        )}
        {discordAbrufe.length > 0 && (
          <table className="table small" data-testid="abrufe-discord">
            <thead><tr><th>Abruf</th><th>Auslöser</th><th>letzter Lauf</th><th>nächster Lauf</th></tr></thead>
            <tbody>{discordAbrufe.map(abrufZeile)}</tbody>
          </table>
        )}
        {uebrigeAbrufe.length > 0 && (
          <details>
            <summary className="small" style={{ cursor: "pointer" }}>Alle übrigen Abrufe ({uebrigeAbrufe.length}) mit letztem und nächstem Lauf</summary>
            <table className="table small" data-testid="abrufe-alle">
              <thead><tr><th>Abruf</th><th>Auslöser</th><th>letzter Lauf</th><th>nächster Lauf</th></tr></thead>
              <tbody>{uebrigeAbrufe.map(abrufZeile)}</tbody>
            </table>
          </details>
        )}
        {reports.length > 0 && (
          <table className="table">
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}><td className="num small">{r.requestedAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}</td><td className="small">{berichtName(r.reportType)}</td><td className="small">{r.status === "pending" ? "wartet auf Amazon" : r.status === "done" ? "übernommen" : `Fehler: ${r.error ?? ""}`}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {(aoEingerichtet || aoI.length > 0) && (
        <section className="card card-pad stack" id="importe-arbitrageone" data-testid="importe-arbitrageone">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h2>Importe – ArbitrageOne</h2>
            {aoEingerichtet && (
              <form action={aoJetztAbholenAction}>
                <button className="btn btn-small" type="submit" data-testid="ao-jetzt">Jetzt abholen</button>
              </form>
            )}
          </div>
          <div className="small" data-testid="ao-plan">
            {aoPlan.text} · letzter Nachtlauf: {zeit(aoLetzterPlan) ?? "noch keiner"} · nächster: {naechsterText(aoPlan, aoLetzterPlan, jetzt)}
          </div>
          <div className="small muted">{AO_EXPORTE.map((e) => `${e.titel}: ${e.taktText}`).join(" · ")} Gleiche Datei zweimal wird übersprungen.</div>
          {ao && AO_MSG[ao] && <div className={`notice ${ao === "ok" ? "notice-ok" : "notice-warn"}`} role="status" data-testid="ao-meldung">{AO_MSG[ao]}</div>}
          {erneut && <div className={`notice ${erneut.startsWith("ok:") ? "notice-ok" : "notice-warn"}`} role="status" data-testid="ao-erneut-meldung">{erneut.replace(/^(ok|fehler):/, "").slice(0, 300)}</div>}
          {aoL.length > 0 && (
            <table className="table small" data-testid="ao-laeufe">
              <thead><tr><th>Zeitpunkt</th><th>Auslöser</th><th>Status</th><th>Ergebnis</th></tr></thead>
              <tbody>
                {aoL.map((l) => (
                  <tr key={l.id} data-testid="ao-lauf">
                    <td className="num">{zeit(l.createdAt)}</td>
                    <td>{l.ausloeser === "zeitplan" ? "täglich 05:30" : "Jetzt abholen"}</td>
                    <td>{l.status === "ok" ? <span className="tag tag-ok">ok</span> : <span style={{ color: l.status === "laeuft" ? undefined : "var(--danger)" }}>{AO_STATUS[l.status]}</span>}</td>
                    <td>
                      {l.fehler ? (
                        <span style={{ color: "var(--danger)" }}>{kurzFehler(l.fehler)}</span>
                      ) : l.ergebnis.length ? (
                        // B27.6: je Export eine Zeile – Name · Status · Kurztext · Bildschirmfoto; Rohmeldung beim Darüberfahren
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                          {l.ergebnis.map((x) => (
                            <li key={x.key} data-testid="ao-lauf-export" title={x.ok ? undefined : (x.roh ?? x.text)}>
                              <strong>{x.titel}</strong>{x.entfaellt ? <span className="muted">: {x.text}</span> : <> · {x.ok ? <span className="tag tag-ok">ok</span> : <span style={{ color: "var(--danger)" }}>Fehler</span>} · {x.ok ? x.text : kurzFehler(x.text)}</>}
                              {x.bild && <> · <a href={x.bild} target="_blank" rel="noreferrer" data-testid="ao-lauf-bild">Bildschirmfoto</a>{x.seite ? <span className="muted"> ({x.seitentitel || x.seite})</span> : null}</>}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        "Nichts fällig"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {aoI.length > 0 && (
            <table className="table small" data-testid="ao-importe">
              <thead><tr><th>Zeitpunkt</th><th>Export</th><th>Datei</th><th>Ergebnis</th></tr></thead>
              <tbody>
                {aoI.map((x) => {
                  const e = (x.ergebnis ?? {}) as { text?: string; link?: string };
                  return (
                    <tr key={x.id} data-testid="ao-import" data-export={x.quelle ?? ""}>
                      <td className="num">{zeit(x.am)}</td>
                      <td>{AO_EXPORTE.find((a) => a.key === x.quelle)?.titel ?? x.quelle}</td>
                      <td style={{ overflowWrap: "anywhere" }}>{x.dateiname}</td>
                      <td>
                        {x.status === "fehler" ? <span style={{ color: "var(--danger)" }}>{x.fehler}</span> : x.bereits ? "bereits importiert – nichts doppelt" : <>{e.text ?? "verarbeitet"}{e.link && <> · <a href={e.link}>ansehen</a></>}</>}
                        {x.nachverarbeitetAm && x.status !== "fehler" && <span className="small muted"> · erneut verarbeitet {zeit(x.nachverarbeitetAm)}</span>}
                        {x.status === "fehler" && x.datei && (
                          <form action={importErneutAction} style={{ display: "inline", marginLeft: 6 }}>
                            <input type="hidden" name="id" value={x.id} />
                            <button type="submit" className="btn btn-small" data-testid="ao-import-erneut">Erneut verarbeiten</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
      {bqExporte.length > 0 && (
        <section className="card card-pad stack" id="importe-exporte" data-testid="importe-exporte">
          <h2>Exporte – ProfitGuard-Importdateien</h2>
          <div className="small muted">Vom Seller-System erzeugt; Ludwig importiert sie selbst in ProfitGuard – das System sendet nichts.</div>
          <table className="table small" data-testid="pg-exporte">
            <thead><tr><th>Erzeugt</th><th>Umfang</th><th>Zeilen je Land</th><th>In ProfitGuard importiert</th></tr></thead>
            <tbody>
              {bqExporte.map((e) => (
                <tr key={e.id} data-testid="pg-export-zeile">
                  <td className="num"><a href={`/repricer/profitguard?export=${e.id}`}>{zeit(e.createdAt)}</a></td>
                  <td>{e.nurAenderungen ? "nur Änderungen" : "alles"}</td>
                  <td>{Object.entries(e.anzahl).filter(([, n]) => n).map(([l, n]) => `${l} ${n}`).join(" · ") || "–"}</td>
                  <td>{e.importiertAm ? <span className="tag tag-ok">bestätigt {zeit(e.importiertAm)}{e.importiertVon ? ` (${e.importiertVon})` : ""}</span> : <span className="muted">noch nicht bestätigt</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
