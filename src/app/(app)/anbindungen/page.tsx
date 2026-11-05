import { requireOwner } from "@/lib/auth/session";
import { INTEGRATIONS } from "@/lib/integrations/registry";
import { integrationStatus } from "@/lib/integrations/store";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { REPORT_KINDS } from "@/lib/reports/amazon";
import { MARKT_BERICHTE, berichtVonTyp } from "@/lib/amazon-markt/store";
import { landVonId } from "@/lib/amazon-markt/logic";
import { aoJetztAbholenAction, bqoolUploadBestaetigenAction, importErneutAction, deleteIntegrationAction, fetchAmazonReportsNow, requestAmazonReport, requestKontoBerichteNow, requestMarktBerichteNow, runAllNow, saveIntegrationAction } from "./actions";
import { aoImporte, aoLaeufe } from "@/lib/arbitrageone/abruf";
import { AO_EXPORTE, kurzFehler } from "@/lib/arbitrageone/logic";
import { TestButton } from "./test-button";
import { SellerboardCard } from "./sellerboard-card";
import { FEHLT_OHNE } from "@/lib/integrations/fehlt";
import { ordnerName } from "@/lib/mail/ordner";
import { postfachStand } from "@/lib/mail/status";
import { discordLiveStatus } from "@/lib/discord/gateway";
import { ABGELOESTE_ABRUFE, ABRUF_PLAN, ABRUFE_JE_ANBINDUNG, naechsterText } from "@/lib/today/abruf-plan";
import { hinweisAktuell } from "@/lib/today/jobs";
import { istLimitFehler } from "@/lib/sellerboard/budget-logic";

/** Anmeldung per OAuth für Postfächer – nur optional („Erweitert“); Standard ist IMAP mit App-Passwort. */
const OAUTH_POSTFACH = new Set(["google", "microsoft"]);
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

export default async function AnbindungenPage({ searchParams }: { searchParams: Promise<{ p?: string; sellerboard?: string; amz?: string; n?: string; ao?: string; erneut?: string }> }) {
  const session = await requireOwner();
  const { p, sellerboard, amz, n, ao, erneut } = await searchParams;
  const status = await integrationStatus(session.tenantId);
  const [reports, postfach, jobs, live, bqExporte, aoL, aoI] = await Promise.all([
    db.select().from(schema.apiReportRequests).where(eq(schema.apiReportRequests.tenantId, session.tenantId)).orderBy(desc(schema.apiReportRequests.requestedAt)).limit(12),
    postfachStand(session.tenantId),
    db.select().from(schema.jobRuns).where(eq(schema.jobRuns.tenantId, session.tenantId)),
    discordLiveStatus(session.tenantId),
    db.select({ id: schema.bqoolExporte.id, protokoll: schema.bqoolExporte.protokoll }).from(schema.bqoolExporte).where(eq(schema.bqoolExporte.tenantId, session.tenantId)).orderBy(desc(schema.bqoolExporte.createdAt)).limit(10),
    aoLaeufe(session.tenantId, 8),
    aoImporte(session.tenantId, 20),
  ]);
  const aoEingerichtet = status.has("arbitrageone_web");
  const aoPlan = ABRUF_PLAN["ArbitrageOne: Exporte abholen"];
  const aoLetzterPlan = aoL.find((l) => l.ausloeser === "zeitplan")?.createdAt ?? null;
  // B23: Protokoll je Upload (Land, Datei, Zeilen, Zeitpunkt, Ergebnis) aus den letzten BQool-Exporten
  const bqUploads = bqExporte
    .flatMap((e) => e.protokoll.filter((p) => p.land).map((p) => ({ ...p, exportId: e.id })))
    .sort((a, b) => b.zeit.localeCompare(a.zeit))
    .slice(0, 20);
  const jetzt = new Date();
  const abrufe = jobs
    // B29: „pausiert bis …“ nur, solange die Pause gilt
    .filter((j) => j.name !== "sellerboard: Tageslimit" || hinweisAktuell(j))
    .map((j) => {
      const plan = ABRUF_PLAN[j.name] ?? j.zeitplan ?? undefined;
      const letzter = j.lastOkAt && (!j.lastErrorAt || j.lastOkAt >= j.lastErrorAt) ? j.lastOkAt : (j.lastErrorAt ?? j.lastOkAt);
      const abgeloest = ABGELOESTE_ABRUFE[j.name];
      // B29.2: sellerboard-Tageslimit ist kein Fehler des Abrufs – „übersprungen“, wird nachgeholt
      const limitFehler = j.name.startsWith("sellerboard:") && istLimitFehler(j.lastError);
      const fehlerAktuell = Boolean(j.lastErrorAt && (!j.lastOkAt || j.lastErrorAt > j.lastOkAt));
      const status = hinweisAktuell(j) ?? (limitFehler && fehlerAktuell ? "übersprungen (sellerboard-Tageslimit) – wird nach der Rücksetzung nachgeholt" : null);
      return { name: j.name, plan, letzter, fehler: !abgeloest && !limitFehler && fehlerAktuell ? j.lastError : null, status, naechster: abgeloest ? "–" : naechsterText(plan, letzter, jetzt), abgeloest };
    })
    .sort((a, b) => Number(b.plan?.ausloeser === "live") - Number(a.plan?.ausloeser === "live") || Number(/discord/i.test(b.name)) - Number(/discord/i.test(a.name)) || a.name.localeCompare(b.name));
  const discordAbrufe = abrufe.filter((a) => /discord|call/i.test(a.name));
  const uebrigeAbrufe = abrufe.filter((a) => !/discord|call/i.test(a.name));
  const abrufZeile = (a: (typeof abrufe)[number]) => (
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
          <h1>Anbindungen</h1>
        </div>
      </div>
      <p className="muted" style={{ margin: 0, maxWidth: 760 }}>
        Zugangsdaten werden verschlüsselt gespeichert. Geheime Felder werden nie wieder angezeigt – leer lassen, um den gespeicherten Wert zu behalten.
        Bis eine Anbindung steht, lassen sich die meisten Daten auch als Datei importieren.
      </p>
      <section className="card card-pad stack">
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
          <div className="small muted">{AO_EXPORTE.map((e) => `${e.titel}: ${e.taktText}`).join(" · ")}. Gleiche Datei zweimal wird übersprungen.</div>
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
                              <strong>{x.titel}</strong> · {x.ok ? <span className="tag tag-ok">ok</span> : <span style={{ color: "var(--danger)" }}>Fehler</span>} · {x.ok ? x.text : kurzFehler(x.text)}
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
      {bqUploads.length > 0 && (
        <section className="card card-pad stack" id="importe-exporte" data-testid="importe-exporte">
          <h2>Importe/Exporte – BQool-Uploads</h2>
          <table className="table small" data-testid="bq-uploads">
            <thead><tr><th>Zeitpunkt</th><th>Land</th><th>Datei</th><th className="right">Zeilen</th><th>Ergebnis</th></tr></thead>
            <tbody>
              {bqUploads.map((u, i) => (
                <tr key={i} data-testid="bq-upload-zeile">
                  <td className="num">{zeit(new Date(u.zeit))}</td>
                  <td>{u.land}</td>
                  <td><a href={`/repricer/bqool?export=${u.exportId}`}>{u.datei}</a></td>
                  <td className="num right">{u.zeilen ?? "–"}</td>
                  <td>
                    {u.ok ? (
                      <span className="tag tag-ok">{u.vonHand ? "hochgeladen (von Hand bestätigt)" : "hochgeladen"}</span>
                    ) : u.unklar ? (
                      <span className="tag tag-warn" data-testid="bq-upload-pruefen">bitte in BQool prüfen – keine Bestätigung erkannt</span>
                    ) : (
                      <span style={{ color: "var(--danger)" }}>{u.text.replace(/^[A-Z]{2}: [^–]+– /, "")}</span>
                    )}
                    {!u.ok && (
                      <form action={bqoolUploadBestaetigenAction} style={{ display: "inline", marginLeft: 6 }}>
                        <input type="hidden" name="exportId" value={u.exportId} />
                        <input type="hidden" name="land" value={u.land} />
                        <input type="hidden" name="zeit" value={u.zeit} />
                        <button type="submit" className="btn btn-small" title="In BQool nachgesehen: die Datei ist angekommen" data-testid="bq-upload-geklappt">hat geklappt</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <div className="stack" style={{ gap: 14 }}>
        <section className="card">
          <div className="card-head">
            <div>
              <h2>eBay</h2>
              <div className="small muted" style={{ marginTop: 2 }}>Artikel einstellen, Rechnungen, Bestellungen abholen, Sendungsnummer zurückmelden.</div>
            </div>
            <a className="btn btn-small" href="/ebay?ansicht=einstellungen">Zu den eBay-Einstellungen</a>
          </div>
          <div className="card-pad small muted">Die eBay-Verbindung wird im eBay-Bereich eingerichtet (Zugang, Anmeldung, Verkaufsprofile, Artikelstandort) und gilt für alles, was mit eBay zu tun hat.</div>
        </section>
        <SellerboardCard tenantId={session.tenantId} message={sellerboard} />
        <section className="card" id="postfaecher" data-testid="anbindung-postfaecher">
          <div className="card-head">
            <div>
              <h2>Postfächer (IMAP mit App-Passwort)</h2>
              <div className="small muted" style={{ marginTop: 2 }}>Seller-Central-, eBay- und Kundenmails abrufen und darüber senden. Standard: Adresse + App-Passwort, Server werden erkannt.</div>
            </div>
            <a className="btn btn-small" href="/posteingang/verbinden">Postfach verbinden</a>
          </div>
          <div className="card-pad stack" style={{ gap: 8 }}>
            {postfach.warnung && <div className="notice notice-warn small" data-testid="amazon-mail-warnung">{postfach.warnung}</div>}
            {postfach.postfaecher.map((b) => (
              <div key={b.id} className="small" data-testid="anbindung-postfach">
                <strong style={{ overflowWrap: "anywhere" }}>{b.adresse}</strong> <span className="tag tag-neutral">{b.art}</span>{b.nurAbruf && <> <span className="tag tag-neutral">NUR ABRUF</span></>}{!b.aktiv && <> <span className="tag tag-neutral">PAUSIERT</span></>}
                <div className="muted">
                  {b.letzterAbruf ? `Zuletzt abgerufen: ${zeit(b.letzterAbruf)}` : "Noch nicht abgerufen"}
                  {b.imap && ` · Ordner: ${b.ordner ? b.ordner.map(ordnerName).join(", ") : "automatisch"}`}
                  {` · letzte Amazon-Mail: ${zeit(b.letzteAmazonMail) ?? "keine"}`}
                </div>
                {b.fehler && <div style={{ color: "var(--danger)" }}>{b.fehlerArt ? <strong>{b.fehlerArt}: </strong> : null}{b.fehler}</div>}
              </div>
            ))}
            <div><a className="btn-link small" href="/einstellungen#postfaecher">Postfächer verwalten (Ordner, Test, nur Abruf)</a></div>
          </div>
        </section>
        {INTEGRATIONS.filter((d) => !OAUTH_POSTFACH.has(d.provider)).map((def) => karte(def))}
        <details className="card card-pad" id="erweitert" open={OAUTH_POSTFACH.has(p ?? "")} data-testid="anbindung-erweitert">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Erweitert: Postfächer per Google-/Microsoft-Anmeldung (OAuth, optional)</summary>
          <div className="small muted" style={{ margin: "8px 0 12px" }}>
            {postfach.nurImap ? "Nicht nötig – deine Postfächer laufen über IMAP mit App-Passwort." : "Nur nötig, wenn ein Anbieter keine App-Passwörter erlaubt."}
          </div>
          <div className="stack" style={{ gap: 14 }}>{INTEGRATIONS.filter((d) => OAUTH_POSTFACH.has(d.provider)).map((def) => karte(def, true))}</div>
        </details>
      </div>
    </>
  );

  function karte(def: (typeof INTEGRATIONS)[number], optional = false) {
    const st = status.get(def.provider);
    const open = p === def.provider;
    return (
            <section key={def.provider} className="card" id={def.provider}>
              <div className="card-head">
                <div>
                  <h2>{def.name}</h2>
                  <div className="small muted" style={{ marginTop: 2 }}>{def.purpose}</div>
                  {!st && FEHLT_OHNE[def.provider] && <div className="small" style={{ marginTop: 4 }} data-testid={`fehlt-${def.provider}`}><strong>Ohne diese Anbindung fehlen:</strong> {FEHLT_OHNE[def.provider]}.</div>}
                  {st && (ABRUFE_JE_ANBINDUNG[def.provider] ?? []).length > 0 && (
                    <div className="small muted" style={{ marginTop: 4 }} data-testid={`intervall-${def.provider}`}>
                      {(ABRUFE_JE_ANBINDUNG[def.provider] ?? []).map((name) => {
                        const a = abrufe.find((x) => x.name === name);
                        const plan = ABRUF_PLAN[name] ?? a?.plan;
                        return `${name}: ${plan ? plan.text.replace(/^(Zeitplan|Auslöser): /, "") : "noch kein Lauf"}${a?.letzter ? ` (zuletzt ${zeit(a.letzter)})` : ""}`;
                      }).join(" · ")}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {st ? <span className="tag tag-ok">EINGERICHTET</span> : <span className="tag tag-neutral">{optional ? "OPTIONAL" : "NICHT VERBUNDEN"}</span>}
                  <a className="btn btn-small" href={open ? "/anbindungen" : `/anbindungen?p=${def.provider}#${def.provider}`}>{open ? "Schließen" : "Bearbeiten"}</a>
                </div>
              </div>
              {open && (
                <div className="row" style={{ padding: 20 }}>
                  <form action={saveIntegrationAction} className="stack" style={{ flexGrow: 1, gap: 12, maxWidth: 560 }}>
                    <input type="hidden" name="provider" value={def.provider} />
                    {def.fields.map((f) => {
                      const has = f.secret ? st?.secretKeys.includes(f.key) : Boolean(st?.config[f.key]);
                      return (
                        <div className="field" key={f.key}>
                          <label className="label" htmlFor={`${def.provider}-${f.key}`}>
                            {f.label} {f.secret && has && <span className="tag tag-ok" style={{ marginLeft: 6 }}>GESPEICHERT</span>}
                          </label>
                          {f.options ? (
                            <select className="input" id={`${def.provider}-${f.key}`} name={f.key} defaultValue={st?.config[f.key] || f.options[0].value}>
                              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          ) : f.multiline ? (
                            <textarea className="textarea" style={{ minHeight: 120, fontFamily: "var(--mono)", fontSize: 12 }} id={`${def.provider}-${f.key}`} name={f.key} placeholder={f.secret && has ? "•••••• (unverändert)" : f.placeholder} />
                          ) : (
                            <input className="input" id={`${def.provider}-${f.key}`} name={f.key} type={f.secret ? "password" : "text"} autoComplete="off" defaultValue={f.secret ? "" : (st?.config[f.key] || (f.vorbelegen && st?.config[f.vorbelegen.aus]?.toLowerCase().includes(f.vorbelegen.von) ? st.config[f.vorbelegen.aus]!.replace(new RegExp(f.vorbelegen.von, "i"), f.vorbelegen.nach) : ""))} placeholder={f.secret && has ? "•••••• (unverändert)" : f.placeholder} />
                          )}
                          {f.help && <span className="small muted">{f.help}</span>}
                        </div>
                      );
                    })}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn btn-primary" type="submit">Speichern</button>
                    </div>
                  </form>
                  <div className="col-side">
                    <div className="card card-pad" style={{ background: "var(--surface-2)" }}>
                      <h2 style={{ fontSize: 14, marginBottom: 8 }}>So richtest du es ein</h2>
                      <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }}>
                        {def.setup.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}
                      </ol>
                    </div>
                    {st && <TestButton provider={def.provider} />}
                    {st && (
                      <form action={deleteIntegrationAction}>
                        <input type="hidden" name="provider" value={def.provider} />
                        <button className="btn-link small" style={{ color: "var(--danger)" }} type="submit">Anbindung entfernen</button>
                      </form>
                    )}
                  </div>
                </div>
              )}
            </section>
    );
  }
}
