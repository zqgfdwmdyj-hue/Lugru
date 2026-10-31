import Link from "next/link";
import { KpiMeta } from "@/components/kpi";
import { requireArea } from "@/lib/auth/session";
import { LAENDER } from "@/lib/amazon-markt/logic";
import { b2bAuswertung, staffelKandidaten } from "@/lib/amazon-business/service";
import { getSettings } from "@/lib/settings";
import { berichtHochladenAction, staffelFreigebenAction, staffelUebernehmenAction, staffelUebertragenAction, staffelVerwerfenAction } from "./actions";

// Amazon Business: B2B-Besuche, -Umsatz und Buy Box je ASIN; Staffelpreise mit Gewinnprüfung, Freigabe durch den
// Inhaber, Upload-Datei oder Übertragung über die Schnittstelle.

const eur = (n: number | null) => (n === null ? "–" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
const eur0 = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pct = (n: number | null) => (n === null ? "–" : `${n.toLocaleString("de-DE")} %`);
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const STATUS: Record<string, { text: string; tag: string }> = { vorschlag: { text: "Vorschlag", tag: "tag-warn" }, freigegeben: { text: "freigegeben", tag: "tag-ok" }, uebertragen: { text: "übertragen", tag: "tag-ok" }, fehler: { text: "Fehler", tag: "tag-danger" } };

export default async function AmazonBusinessPage({ searchParams }: { searchParams: Promise<{ land?: string; zeitraum?: string; meldung?: string }> }) {
  const session = await requireArea("amazon");
  const sp = await searchParams;
  const a = await b2bAuswertung(session.tenantId, { zeitraum: sp.zeitraum });
  const land = sp.land && (LAENDER as string[]).includes(sp.land) ? sp.land : (a.laender[0]?.periode.land ?? "DE");
  const [kand, settings] = await Promise.all([staffelKandidaten(session.tenantId, land), getSettings(session.tenantId)]);
  const owner = session.role === "owner";
  const l = a.laender.find((x) => x.periode.land === land);
  const regel = settings.amazonBusiness;
  const offen = kand.filter((k) => !k.gespeichert && k.vorschlag && !k.vorschlag.fehler && k.vorschlag.stufen.some((s) => s.ok));
  const gespeichert = kand.filter((k) => k.gespeichert);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Amazon</div>
          <h1>Amazon Business</h1>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-ok small" style={{ marginBottom: 12 }} role="status">{sp.meldung}</div>}

      {a.laender.length === 0 ? (
        <div className="card card-pad small" data-testid="ab-leer">
          Noch keine B2B-Werte. Sie kommen mit dem Bericht „Sales and Traffic“ über die Amazon-Schnittstelle (alle 2 Tage) – oder hier den Geschäftsbericht hochladen (unten).
        </div>
      ) : (
        <>
          <div className="stack" style={{ gap: 6 }} data-kpi-group>
            <div className="grid-kpi" data-testid="ab-summen">
              <div className="card card-pad">
                <div className="kpi-label">B2B-Umsatz</div>
                <div className="kpi-value" data-testid="ab-umsatz">{eur0(a.gesamt.umsatzB2b)}</div>
                <div className="small muted">von {eur0(a.gesamt.umsatz)} gesamt</div>
              </div>
              <div className="card card-pad">
                <div className="kpi-label">Anteil B2B</div>
                <div className="kpi-value" data-testid="ab-anteil">{pct(a.gesamt.anteilProzent)}</div>
              </div>
              <div className="card card-pad">
                <div className="kpi-label">B2B-Besuche</div>
                <div className="kpi-value">{a.gesamt.sitzungenB2b.toLocaleString("de-DE")}</div>
                <div className="small muted">Kaufquote {pct(a.gesamt.kaufquoteB2b)}</div>
              </div>
              <div className="card card-pad">
                <div className="kpi-label">Buy Box B2B (gewichtet)</div>
                <div className="kpi-value">{pct(a.gesamt.buyboxB2b)}</div>
              </div>
            </div>
            <KpiMeta period={a.laender.map((x) => `${x.periode.land} ${dmy(x.periode.von)}–${dmy(x.periode.bis)}`).join(" · ")} source="Amazon „Sales and Traffic“ (Schnittstelle) bzw. hochgeladener Geschäftsbericht" stand={a.laender.map((x) => x.periode.abgerufenAm.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })).join(" · ")} />
          </div>
          <form method="get" className="small" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "10px 0" }}>
            <span className="muted">Zeitraum:</span>
            <select name="zeitraum" defaultValue={sp.zeitraum ?? "letzte"} aria-label="Zeitraum">
              <option value="letzte">jüngster je Land</option>
              {[...new Set(a.perioden.map((p) => `${p.von}:${p.bis}`))].map((z) => (
                <option key={z} value={z}>{dmy(z.slice(0, 10))} – {dmy(z.slice(11))}</option>
              ))}
            </select>
            <input type="hidden" name="land" value={land} />
            <button className="btn btn-small" type="submit">Anzeigen</button>
          </form>
        </>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0 12px" }}>
        {[...new Set([...a.laender.map((x) => x.periode.land), land])].map((x) => (
          <Link key={x} href={`/amazon-business?land=${x}${sp.zeitraum ? `&zeitraum=${encodeURIComponent(sp.zeitraum)}` : ""}`} className={`chip${x === land ? " active" : ""}`} aria-current={x === land ? "true" : undefined}>{x}</Link>
        ))}
      </div>

      {l && (
        <>
          <h2>B2B je ASIN – {land}</h2>
          <div className="table-wrap card" style={{ marginBottom: 14 }}>
            <table className="table" data-testid="ab-tabelle">
              <thead>
                <tr>
                  <th>Artikel</th>
                  <th className="right">Besuche B2B / gesamt</th>
                  <th className="right">Einheiten B2B</th>
                  <th className="right">Umsatz B2B</th>
                  <th className="right">Buy Box B2B</th>
                </tr>
              </thead>
              <tbody>
                {l.zeilen.slice(0, 100).map((z) => (
                  <tr key={z.asin}>
                    <td>{z.titel ?? z.sku ?? z.asin}<div className="small muted">{z.asin}{z.sku ? ` · ${z.sku}` : ""}</div></td>
                    <td className="right num">{z.sitzungenB2b ?? "–"} / {z.sitzungen ?? "–"}</td>
                    <td className="right num">{z.einheitenB2b ?? "–"}</td>
                    <td className="right num">{eur(z.umsatzB2b)}</td>
                    <td className="right num">{pct(z.buyboxB2b)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Staffelpreise – {land}</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        Staffeln ab {regel.stufen.join(" / ")} Stück mit {regel.rabatte.join(" / ")} % Rabatt auf den aktuellen Preis – nie unter dem Mindestpreis (Gewinn je Stück ≥ {eur(regel.minGewinn)} nach EK, FBA, Provision und USt).
        Ablauf: Vorschlag übernehmen → <strong>Freigabe durch den Inhaber</strong> → Upload-Datei für Seller Central oder Übertragung über die Schnittstelle.
      </p>

      {gespeichert.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 12 }} data-testid="ab-gespeichert">
          <form>
            <input type="hidden" name="land" value={land} />
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th></th><th>Artikel</th><th className="right">Business-Preis</th><th>Staffeln</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {gespeichert.map((k) => {
                    const g = k.gespeichert!;
                    return (
                      <tr key={k.sku} data-testid="ab-staffel" data-status={g.status}>
                        <td>{(g.status === "vorschlag" || g.status === "fehler" || g.status === "freigegeben") && <input type="checkbox" name="sku" value={k.sku} aria-label={`${k.sku} auswählen`} />}</td>
                        <td>{k.titel ?? k.sku}<div className="small muted">{k.sku}</div></td>
                        <td className="right num">{eur(g.businessPreis)}</td>
                        <td className="small">{g.stufen.filter((s) => s.ok).map((s) => `ab ${s.ab}: ${eur(s.preis)} (Gewinn ${eur(s.gewinn)})`).join(" · ") || "–"}</td>
                        <td><span className={`tag ${STATUS[g.status].tag}`}>{STATUS[g.status].text}</span>{g.fehler && <div className="small" style={{ color: "var(--danger)" }}>{g.fehler}</div>}{g.freigegebenVon && <div className="small muted">frei: {g.freigegebenVon}</div>}</td>
                        <td>
                          <button className="btn-link small" formAction={staffelVerwerfenAction} name="verwerfen" value={k.sku} type="submit">verwerfen</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
              {owner ? (
                <>
                  <button className="btn" formAction={staffelFreigebenAction} type="submit" data-testid="ab-freigeben">Ausgewählte freigeben</button>
                  <label className="small"><input type="checkbox" name="bestaetigt" /> Freigegebene jetzt an Amazon übertragen</label>
                  <button className="btn" formAction={staffelUebertragenAction} type="submit" data-testid="ab-uebertragen">Über Schnittstelle übertragen</button>
                </>
              ) : (
                <span className="small muted">Freigabe und Übertragung nur durch den Inhaber.</span>
              )}
              <a className="btn" href={`/amazon-business/datei?land=${land}`} data-testid="ab-datei">Upload-Datei (freigegebene)</a>
            </div>
          </form>
        </div>
      )}

      {offen.length === 0 ? (
        <div className="card card-pad small muted" style={{ marginBottom: 14 }}>Keine neuen Vorschläge{kand.some((k) => k.vorschlag?.fehler) ? ` – ${kand.filter((k) => k.vorschlag?.fehler).length} Artikel ohne EK` : ""}.</div>
      ) : (
        <form action={staffelUebernehmenAction} className="card card-pad" style={{ marginBottom: 14 }} data-testid="ab-vorschlaege">
          <input type="hidden" name="land" value={land} />
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th></th><th>Artikel</th><th className="right">Preis</th><th className="right">Mindestpreis</th>{regel.stufen.map((s) => <th key={s} className="right">ab {s}</th>)}</tr></thead>
              <tbody>
                {offen.slice(0, 60).map((k) => (
                  <tr key={k.sku}>
                    <td><input type="checkbox" name="sku" value={k.sku} aria-label={`${k.sku} übernehmen`} /></td>
                    <td>{k.titel ?? k.sku}<div className="small muted">{k.sku} · B2B-Besuche {k.sitzungenB2b ?? "–"}</div></td>
                    <td className="right num">
                      <input name={`bp_${k.sku}`} defaultValue={k.preis?.toFixed(2).replace(".", ",")} inputMode="decimal" style={{ width: 80 }} aria-label="Business-Preis" />
                      <div className="small muted">{k.preisQuelle}</div>
                    </td>
                    <td className="right num">{eur(k.vorschlag!.mindestPreis)}</td>
                    {k.vorschlag!.stufen.map((s) => (
                      <td key={s.ab} className="right num" title={s.hinweis ?? undefined} style={s.ok ? undefined : { opacity: 0.5 }}>
                        {eur(s.preis)}<div className="small muted">+{eur(s.gewinn)}</div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-primary" type="submit" style={{ marginTop: 10 }} data-testid="ab-uebernehmen">Ausgewählte als Vorschlag speichern</button>
        </form>
      )}

      <details className="card card-pad">
        <summary><strong>Geschäftsbericht hochladen (CSV)</strong></summary>
        <p className="small muted">Seller Central → Berichte → Statistiken &amp; Berichte → „Detailseite Verkäufe und Traffic nach untergeordnetem Artikel“, Spalten mit „B2B“ einblenden, als CSV herunterladen.</p>
        <form action={berichtHochladenAction} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <label className="small">Land<select name="land" defaultValue={land}>{LAENDER.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <label className="small">von<input name="von" placeholder="TT.MM.JJJJ" required /></label>
          <label className="small">bis<input name="bis" placeholder="TT.MM.JJJJ" required /></label>
          <label className="small">Datei<input type="file" name="datei" accept=".csv,.txt,.xlsx" required data-testid="ab-datei-upload" /></label>
          <button className="btn" type="submit" data-testid="ab-hochladen">Einlesen</button>
        </form>
      </details>
    </>
  );
}
