import Link from "next/link";
import { KpiMeta } from "@/components/kpi";
import { requireSession } from "@/lib/auth/session";
import { formatEuro } from "@/lib/numbers";
import { repricerRows } from "@/lib/repricer";
import { getSettings } from "@/lib/settings";
import { formatDate } from "@/lib/numbers";
import { fbaReport } from "@/lib/stock/fba-report";
import { breakdownText } from "@/lib/stock/breakdown";
import { COST_SOURCE_LABEL } from "@/lib/money/profit-logic";
import { isEstimated, repricerCoverage } from "@/lib/repricer-logic";
import { filterBqool, HINWEIS_RANG, HINWEIS_TEXT, regelUebersicht } from "@/lib/bqool/logic";
import { bqoolStand } from "@/lib/bqool/service";
import { BqoolUpload } from "./bqool-upload";

type SP = { nur?: string; seite?: string; land?: string; regel?: string; hinweis?: string; status?: string; q?: string; bq?: string; bqseite?: string };
const BQ_SEITE = 50;
const SYS_SEITE = 100;
/** Link mit geänderten Suchparametern (leere Werte fallen weg). */
const mitParam = (sp: SP, neu: Partial<SP>, anker = "") => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...neu })) if (v) u.set(k, String(v));
  const q = u.toString();
  return `/repricer${q ? `?${q}` : ""}${anker}`;
};

export default async function RepricerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const s = await getSettings(session.tenantId);
  const all = await repricerRows(session.tenantId);
  // Ohne FBA-Bericht ist unbekannt, welche SKUs bei Amazon liegen – nicht „0 SKUs“.
  const fr = await fbaReport(session.tenantId);
  const below = all.filter((r) => r.min !== null && r.price !== null && r.price < r.min);
  const cov = repricerCoverage(all);
  const bq = await bqoolStand(session.tenantId);
  const bqProbleme = bq.zeilen.filter((z) => z.hinweise.length);
  // B15.11: alle Länder, Übersicht je Regel, Filter und Seiten (Standard: nur Auffälligkeiten).
  const uebersicht = regelUebersicht(bq.zeilen);
  const laender = bq.stand.map((x) => x.marktplatz).sort();
  const bqGefiltert = filterBqool(bq.zeilen, { land: sp.land, regel: sp.regel, hinweis: sp.hinweis, status: sp.status, q: sp.q, nurAuffaellig: sp.bq !== "alle" });
  const bqSeiten = Math.max(1, Math.ceil(bqGefiltert.length / BQ_SEITE));
  const bqSeite = Math.min(bqSeiten, Math.max(1, Number(sp.bqseite) || 1));
  const bqZeigen = bqGefiltert.slice((bqSeite - 1) * BQ_SEITE, bqSeite * BQ_SEITE);
  const rowsAlle = sp.nur === "unter" ? below : sp.nur === "ohne-ek" ? all.filter((r) => r.unitCost === null) : sp.nur === "ohne-preis" ? all.filter((r) => r.price === null) : sp.nur === "geschaetzt" ? all.filter((r) => r.min !== null && isEstimated(r)) : all;
  const sysSeiten = Math.max(1, Math.ceil(rowsAlle.length / SYS_SEITE));
  const sysSeite = Math.min(sysSeiten, Math.max(1, Number(sp.seite) || 1));
  const rows = rowsAlle.slice((sysSeite - 1) * SYS_SEITE, sysSeite * SYS_SEITE);
  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Amazon</div><h1>Repricer (BQool)</h1></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn btn-primary" href="/repricer/bqool" data-testid="link-bqool-dateien">BQool-Dateien je Land (Freigabe)</Link>
          <a className="btn" href="/repricer/export?format=bqool" title="Nur Mindestpreise mit echten Gebühren aus der Gebührenvorschau" data-testid="export-exact">BQool-CSV ({cov.exact} mit echten Gebühren)</a>
          {cov.estimated > 0 && <a className="btn" href="/repricer/export?format=bqool&geschaetzt=1" title="Enthält Mindestpreise mit pauschaler FBA-Gebühr bzw. Provision – vor dem Einsatz prüfen" data-testid="export-estimated">inkl. {cov.estimated} geschätzter</a>}
          <a className="btn" href="/repricer/export?format=de">Als Tabelle (deutsch)</a>
        </div>
      </div>
      <div className="stack" style={{ gap: 6 }} data-kpi-group>
      <div className="grid-kpi">
        <div className="card card-pad" data-testid="kpi-repricer-skus">
          <div className="kpi-label">SKUs mit Bestand bei Amazon</div>
          {fr.missing ? (
            <><div className="kpi-value muted" style={{ fontSize: 18 }}>unbekannt</div><Link className="small" href="/import" style={{ color: "var(--warn)" }}>FBA-Bestandsbericht fehlt →</Link></>
          ) : (
            <><div className="kpi-value">{all.length}</div><div className="small" style={fr.stale ? { color: "var(--warn)" } : undefined}>{fr.stale ? `Stand ${formatDate(fr.snapshot)} – veraltet` : `laut ${fr.source === "sellerboard" ? "sellerboard" : "Bericht"} vom ${formatDate(fr.snapshot)}`}</div></>
          )}
        </div>
        <div className="card card-pad" data-testid="kpi-below">
          <div className="kpi-label">Aktueller Preis unter Mindestpreis</div>
          {cov.checkable === 0 ? (
            <><div className="kpi-value muted" style={{ fontSize: 18 }} data-testid="below-value">nicht prüfbar</div><div className="small" style={{ color: "var(--warn)" }}>{cov.total ? `Bei keiner SKU liegen aktueller Preis und Mindestpreis zusammen vor (${cov.noPrice} ohne Preis, ${cov.noMin} ohne Mindestpreis).` : "Keine SKUs."}</div></>
          ) : (
            <><div className="kpi-value" style={{ color: below.length ? "var(--danger)" : undefined }} data-testid="below-value">{below.length}</div><div className="small muted" data-testid="below-coverage">geprüft: {cov.checkable} von {cov.total} SKUs{cov.noPrice ? ` · ${cov.noPrice} ohne aktuellen Preis` : ""}{cov.noMin ? ` · ${cov.noMin} ohne Mindestpreis` : ""}</div></>
          )}
        </div>
        <div className="card card-pad" data-testid="kpi-no-cost"><div className="kpi-label">Ohne EK (kein Mindestpreis)</div><div className="kpi-value">{all.filter((r) => r.unitCost === null).length}</div>{all.some((r) => r.unitCost === null) && <Link className="small" href="/produkte?ansicht=zuordnung&art=ek-fehlt">betroffene Artikel → EK nachtragen</Link>}</div>
        <div className="card card-pad small muted">Mindestgewinn {formatEuro(s.pricing.minProfit)} · Provision {Math.round(s.pricing.referralRate * 100)} % (wenn keine Gebührenvorschau) · Max = Min × {String(s.pricing.maxPriceFactor).replace(".", ",")} bzw. Ziel-VK. <Link href="/einstellungen">Ändern</Link></div>
      </div>
      <KpiMeta source="FBA-Bestand (Bestandsbericht bzw. sellerboard), aktuelle Preise, EK im Seller-System" stand={fr.missing ? "kein Bestandsbericht" : `${formatDate(fr.snapshot)}${fr.stale ? " – veraltet" : ""}`} />
      </div>
      {cov.estimated > 0 && (
        <div className="notice notice-warn small" data-testid="estimated-warning">
          <strong>{cov.estimated} von {cov.exact + cov.estimated} Mindestpreisen sind geschätzt:</strong> ohne Gebührenvorschau rechnet das System mit pauschal {formatEuro(s.pricing.defaultFbaFee)} FBA-Gebühr bzw. {Math.round(s.pricing.referralRate * 100)} % Provision. Vor dem Einsatz in BQool die <Link href="/import">Gebührenvorschau importieren</Link> – der BQool-Export enthält geschätzte Werte nur, wenn du es ausdrücklich wählst. <Link href="/repricer?nur=geschaetzt">Geschätzte ansehen →</Link>
        </div>
      )}
      {bq.zeilen.length === 0 && (
        <div className="notice notice-warn small" style={{ marginBottom: 12 }} data-testid="bqool-fehlt">
          <strong>Noch kein BQool-Export hochgeladen.</strong> Ohne ihn fehlen Regel, Min und Max je SKU – im Verlust-Stopp, in der Kapital-Ampel und bei Claude („repricer“). In BQool unter Repricing → Manage Listings je Land exportieren und <a href="#bqool-upload">hier unten hochladen</a>.
        </div>
      )}
      <section className="card card-pad stack" data-testid="bqool-section">
        <h2>BQool: Regeln, Min/Max und Buy Box laut Export</h2>
        {bq.stand.length === 0 ? (
          <div className="small muted">Noch kein BQool-Export eingelesen. Dann siehst du hier – und Claude im Werkzeug „repricer“ – je SKU und Land die Regel, Mindest- und Höchstpreis aus BQool und ob der Mindestpreis unter dem des Seller-Systems liegt.</div>
        ) : (
          <>
            <div className="small" data-testid="bqool-stand">{bq.stand.map((x) => `${x.marktplatz}: ${bq.zeilen.filter((z) => z.marktplatz === x.marktplatz).length} SKUs, eingelesen ${x.am ? x.am.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "?"}`).join(" · ")}</div>
            <div style={{ overflow: "auto" }}>
              <table className="table" data-testid="bqool-regeln">
                <thead><tr><th>Regel (alle Länder)</th><th className="right">SKUs</th><th className="right">aktiv</th><th className="right">pausiert</th><th className="right" title="Kein Status in der Datei bzw. Amazon-Angebot inaktiv">unbekannt</th><th className="right">auffällig</th><th>je Land</th></tr></thead>
                <tbody>
                  {uebersicht.map((u) => (
                    <tr key={u.regel}>
                      <td><Link href={mitParam(sp, { regel: u.regel, bq: "alle", bqseite: undefined }, "#bqool-liste")}>{u.regel}</Link></td>
                      <td className="num right">{u.gesamt}</td>
                      <td className="num right">{u.aktiv}</td>
                      <td className="num right" style={{ color: u.pausiert ? "var(--warn)" : undefined }}>{u.pausiert ? <Link href={mitParam(sp, { regel: u.regel, status: "pausiert", bq: "alle", bqseite: undefined }, "#bqool-liste")}>{u.pausiert}</Link> : 0}</td>
                      <td className="num right muted">{u.unbekannt}</td>
                      <td className="num right">{u.mitHinweis}</td>
                      <td className="small">{Object.entries(u.laender).map(([l, n]) => `${l} ${n}`).join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <form className="reorder-filter" id="bqool-liste" data-testid="bqool-filter" style={{ scrollMarginTop: 70 }}>
              {sp.nur && <input type="hidden" name="nur" value={sp.nur} />}
              <div className="field"><label className="label" htmlFor="bq">Zeigen</label>
                <select className="input" id="bq" name="bq" defaultValue={sp.bq === "alle" ? "alle" : ""}><option value="">nur Auffälligkeiten</option><option value="alle">alle SKUs</option></select>
              </div>
              <div className="field"><label className="label" htmlFor="land">Land</label>
                <select className="input" id="land" name="land" defaultValue={sp.land ?? ""}><option value="">alle Länder</option>{laender.map((l) => <option key={l} value={l}>{l}</option>)}</select>
              </div>
              <div className="field"><label className="label" htmlFor="regel">Regel</label>
                <select className="input" id="regel" name="regel" defaultValue={sp.regel ?? ""}><option value="">alle Regeln</option>{uebersicht.map((u) => <option key={u.regel} value={u.regel}>{u.regel}</option>)}</select>
              </div>
              <div className="field"><label className="label" htmlFor="status">Status</label>
                <select className="input" id="status" name="status" defaultValue={sp.status ?? ""}><option value="">alle</option><option value="aktiv">aktiv</option><option value="pausiert">pausiert</option><option value="unbekannt">unbekannt</option></select>
              </div>
              <div className="field"><label className="label" htmlFor="hinweis">Auffälligkeit</label>
                <select className="input" id="hinweis" name="hinweis" defaultValue={sp.hinweis ?? ""}><option value="">alle</option>{HINWEIS_RANG.map((h) => <option key={h} value={h}>{HINWEIS_TEXT[h]}</option>)}</select>
              </div>
              <div className="field" style={{ flex: "1 1 160px" }}><label className="label" htmlFor="bq-q">Suche</label><input className="input" id="bq-q" name="q" type="search" defaultValue={sp.q ?? ""} placeholder="SKU, ASIN, Titel" /></div>
              <button className="btn" type="submit" data-testid="bqool-filter-anwenden">Anwenden</button>
              {(sp.land || sp.regel || sp.status || sp.hinweis || sp.q || sp.bq) && <Link className="small" href={mitParam({ nur: sp.nur }, {}, "#bqool-liste")}>zurücksetzen</Link>}
            </form>
            {bqGefiltert.length === 0 ? (
              <div className="notice notice-ok small" data-testid="bqool-keine">{sp.bq === "alle" || sp.land || sp.regel || sp.status || sp.hinweis || sp.q ? "Keine SKUs für diese Auswahl." : "Keine Auffälligkeiten: alle BQool-Mindestpreise liegen auf oder über dem Mindestpreis des Seller-Systems (soweit ein EK bekannt ist)."}</div>
            ) : (
              <div style={{ overflow: "auto" }}>
                <div className="small muted" data-testid="bqool-anzahl">{bqGefiltert.length} Zeilen{bqProbleme.length !== bqGefiltert.length ? ` · ${bqProbleme.length} mit Auffälligkeiten insgesamt` : ""}{bqSeiten > 1 ? ` · Seite ${bqSeite} von ${bqSeiten}` : ""}</div>
                <table className="table" data-testid="bqool-problems">
                  <thead><tr><th>Land</th><th>SKU</th><th>Regel</th><th className="right">Preis</th><th className="right">Min BQool</th><th className="right" title="Mindestpreis des Seller-Systems aus EK, Gebühren und Mindestgewinn">Min System</th><th className="right">Max BQool</th><th>Buy Box</th><th>Prüfen</th></tr></thead>
                  <tbody>
                    {bqZeigen.map((z) => (
                      <tr key={`${z.marktplatz}|${z.sku}`}>
                        <td>{z.marktplatz}</td>
                        <td className="num small">{z.sku}</td>
                        <td className="small">{z.regel ?? "–"}{z.status === "pausiert" ? " (pausiert)" : z.status === null ? <span className="muted" title="Kein Repricing-Status in der Datei"> (Status ?)</span> : ""}</td>
                        <td className="num right">{formatEuro(z.preis)}</td>
                        <td className="num right" style={{ color: z.hinweise.includes("min_unter_untergrenze") ? "var(--danger)" : undefined, fontWeight: 600 }}>{formatEuro(z.min)}</td>
                        <td className="num right">{formatEuro(z.untergrenze)}</td>
                        <td className="num right">{formatEuro(z.max)}</td>
                        <td className="small">{z.eigeneBuybox === true ? "✓ wir" : z.eigeneBuybox === false ? `✕ ${z.buyboxGewinner ?? "andere"}` : (z.buyboxGewinner ?? "–")}{z.buyboxPreis !== null ? ` · ${formatEuro(z.buyboxPreis)}` : ""}</td>
                        <td className="small">{z.hinweise.length ? z.hinweise.map((h) => HINWEIS_TEXT[h]).join("; ") : <span className="muted">–</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {bqSeiten > 1 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }} data-testid="bqool-seiten">
                    {bqSeite > 1 && <Link className="chip" href={mitParam(sp, { bqseite: String(bqSeite - 1) }, "#bqool-liste")}>← zurück</Link>}
                    <span className="small muted" style={{ alignSelf: "center" }}>Seite {bqSeite} von {bqSeiten}</span>
                    {bqSeite < bqSeiten && <Link className="chip" href={mitParam(sp, { bqseite: String(bqSeite + 1) }, "#bqool-liste")} data-testid="bqool-weiter">weiter →</Link>}
                  </div>
                )}
              </div>
            )}
          </>
        )}
        <div id="bqool-upload" style={{ scrollMarginTop: 70 }}><BqoolUpload /></div>
      </section>
      <div style={{ display: "flex", gap: 6 }}>
        <Link href="/repricer" className={`chip${!sp.nur ? " active" : ""}`} aria-current={!sp.nur ? "true" : undefined}>Alle</Link>
        <Link href="/repricer?nur=unter" className={`chip${sp.nur === "unter" ? " active" : ""}`} aria-current={sp.nur === "unter" ? "true" : undefined}>Unter Mindestpreis</Link>
        <Link href="/repricer?nur=ohne-ek" className={`chip${sp.nur === "ohne-ek" ? " active" : ""}`} aria-current={sp.nur === "ohne-ek" ? "true" : undefined}>Ohne EK</Link>
        <Link href="/repricer?nur=ohne-preis" className={`chip${sp.nur === "ohne-preis" ? " active" : ""}`} aria-current={sp.nur === "ohne-preis" ? "true" : undefined}>Ohne aktuellen Preis · {cov.noPrice}</Link>
        <Link href="/repricer?nur=geschaetzt" className={`chip${sp.nur === "geschaetzt" ? " active" : ""}`} aria-current={sp.nur === "geschaetzt" ? "true" : undefined}>Geschätzte Gebühren · {cov.estimated}</Link>
      </div>
      <section className="card" style={{ overflow: "auto" }}>
        <table className="table">
          <thead><tr><th>SKU</th><th>Artikel</th><th className="right" title="Verkaufbar + reserviert + unterwegs (nicht verkaufbar zählt nicht)">Bestand</th><th className="right" title="Gültiger EK netto – gleicher Rechenweg wie Produkt, Gewinn und Nachbestellung">EK netto</th><th className="right">FBA-Gebühr</th><th className="right">Aktuell</th><th className="right">Min</th><th className="right">Max</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="muted" data-testid="repricer-empty">{fr.missing ? <>Der FBA-Bestandsbericht fehlt – welche SKUs bei Amazon liegen, ist unbekannt (nicht „kein Bestand“). <Link href="/import">Bericht importieren</Link>.</> : sp.nur ? "Keine SKUs in dieser Ansicht." : `Laut FBA-Bericht vom ${formatDate(fr.snapshot)} liegt keine Ware bei Amazon.`}</td></tr>}
            {rows.map((r) => (
              <tr key={r.sku}>
                <td className="num small">{r.sku}</td>
                <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title ?? r.asin}</td>
                <td className="num right" title={breakdownText(r.breakdown)}>{r.stock}</td>
                <td className="num right" data-testid="repricer-ek" data-sku={r.sku}>
                  {r.unitCost === null ? <Link href={`/produkte/sku/${encodeURIComponent(r.sku)}?tab=einkauf`} className="tag tag-missing">fehlt</Link> : formatEuro(r.unitCost)}
                  {r.costSource && <div className="small muted" style={{ fontFamily: "inherit" }}>{COST_SOURCE_LABEL[r.costSource]}</div>}
                  {r.sbCostNote && <div className="small" style={{ color: "var(--warn)", fontFamily: "inherit" }} data-testid="repricer-sb-note">sellerboard {formatEuro(r.sbCostNote.value)}{r.sbCostNote.placeholder ? " (Platzhalter)" : " weicht ab"}</div>}
                </td>
                <td className="num right" title={r.feeEstimated ? `Pauschal ${formatEuro(s.pricing.defaultFbaFee)} – keine Gebührenvorschau` : "aus der Gebührenvorschau"}>{formatEuro(r.fbaFee)}{r.feeEstimated ? " ~" : ""}</td>
                <td className="num right" style={{ color: r.min !== null && r.price !== null && r.price < r.min ? "var(--danger)" : undefined }}>{r.price === null ? <span className="muted" title="Kein aktueller Preis – „unter Mindestpreis“ nicht prüfbar">nicht bekannt</span> : formatEuro(r.price)}</td>
                <td className="num right" style={{ fontWeight: 600 }}>{formatEuro(r.min)}{r.min !== null && isEstimated(r) && <div className="small" style={{ color: "var(--warn)", fontWeight: 400, fontFamily: "inherit" }} data-testid="min-estimated">geschätzt</div>}</td>
                <td className="num right">{formatEuro(r.max)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {sysSeiten > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} data-testid="repricer-seiten">
          {sysSeite > 1 && <Link className="chip" href={mitParam(sp, { seite: String(sysSeite - 1) })}>← zurück</Link>}
          <span className="small muted" style={{ alignSelf: "center" }}>Seite {sysSeite} von {sysSeiten} · {rowsAlle.length} SKUs</span>
          {sysSeite < sysSeiten && <Link className="chip" href={mitParam(sp, { seite: String(sysSeite + 1) })}>weiter →</Link>}
        </div>
      )}
      <div className="small muted">EK = gültiger Einkaufspreis netto (Charge → von Hand → eBay-Tool → Set → sellerboard → geerbt), derselbe Wert wie in Produkt, Gewinn und Nachbestellung. „~“ bzw. „geschätzt“ = pauschale FBA-Gebühr oder Provision (Gebührenvorschau importieren für echte Werte). „nicht bekannt“ = kein aktueller Preis im Bestandsbericht. Die BQool-Spalten bitte beim ersten Import mit der BQool-Vorlage abgleichen.</div>
    </>
  );
}
