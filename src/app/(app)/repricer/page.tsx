import Link from "next/link";
import { KpiMeta } from "@/components/kpi";
import { requireSession } from "@/lib/auth/session";
import { formatDate, formatEuro } from "@/lib/numbers";
import { repricerRows } from "@/lib/repricer";
import { getSettings } from "@/lib/settings";
import { fbaReport } from "@/lib/stock/fba-report";
import { breakdownText } from "@/lib/stock/breakdown";
import { COST_SOURCE_LABEL } from "@/lib/money/profit-logic";
import { isEstimated, repricerCoverage } from "@/lib/repricer-logic";
import { filterAbgleich, HINWEIS_RANG, HINWEIS_TEXT, strategieUebersicht } from "@/lib/repricing/profitguard-logic";
import { sollVorschau } from "@/lib/repricing/soll-service";
import { buyboxAnteilJeLand, profitguardStand } from "@/lib/repricing/profitguard-service";
import { ablaufStand, istGebraucht, ZUSTAENDE, ZUSTAND_TEXT, type Zustand } from "@/lib/repricing/leiter-logic";
import { schnelldreherAnAction, schnelldreherAusAction, zustandAction } from "./profitguard/actions";
import { ProfitguardUpload } from "./profitguard-upload";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { todayIso } from "@/lib/dates";

// Repricer (ProfitGuard): Abgleich Seller-System (Soll) ↔ ProfitGuard (Ist aus dem Export) je SKU und Land, dazu die
// Bestandsliste mit dem klassischen Mindestpreis (EK + Gebühren + Mindestgewinn).

type SP = { nur?: string; seite?: string; land?: string; strategie?: string; hinweis?: string; repricing?: string; q?: string; ab?: string; abseite?: string; leiter?: string; zustand?: string; meldung?: string };
const AB_SEITE = 50;
const SYS_SEITE = 100;
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
  const fr = await fbaReport(session.tenantId);
  const below = all.filter((r) => r.min !== null && r.price !== null && r.price < r.min);
  const cov = repricerCoverage(all);
  const heute = todayIso();
  const [v, stand, bb, lqRows, pflegeRows] = await Promise.all([
    sollVorschau(session.tenantId).catch(() => null),
    profitguardStand(session.tenantId),
    buyboxAnteilJeLand(session.tenantId).catch(() => []),
    db.select().from(schema.repricingLiquidationen).where(eq(schema.repricingLiquidationen.tenantId, session.tenantId)),
    db.select().from(schema.repricingSkuPflege).where(eq(schema.repricingSkuPflege.tenantId, session.tenantId)),
  ]);
  const zeilen = (v?.laender ?? []).flatMap((l) => l.zeilen);
  const auffaellig = zeilen.filter((z) => z.hinweise.length);
  const uebersicht = strategieUebersicht(zeilen.map((z) => ({ istStrategie: z.istStrategieName, imRepricing: z.istImRepricing, land: z.land, hinweise: z.hinweise })));
  const laender = [...new Set(zeilen.map((z) => z.land))].sort();
  const unbekanntSkus = new Set((v?.zustandUnbekannt ?? []).map((u) => u.sku));
  const lqJe = new Map(lqRows.filter((l) => l.status === "aktiv" || l.status === "zurueck_vorgeschlagen").map((l) => [`${l.land}|${l.sku}`, l]));
  const pfJe = new Map(pflegeRows.map((p) => [`${p.land}|${p.sku}`, p]));
  const k = (z: (typeof zeilen)[number]) => `${z.land}|${z.sku}`;
  const extra = (zz: typeof zeilen) => {
    if (sp.leiter === "ablauf7") return zz.filter((z) => { const l = lqJe.get(k(z)); return !!l && ["bald", "abgelaufen"].includes(ablaufStand({ bis: l.bis, dauerhaft: l.dauerhaft, heute, vorwarnTage: s.repricing.leiter.ablaufVorwarnTage }).stand); });
    if (sp.leiter === "schnell") return zz.filter((z) => pfJe.get(k(z))?.schnelldreher);
    if (sp.leiter === "gebraucht_ohne") return zz.filter((z) => istGebraucht(z.zustand) && (z.istMin === null || (z.effMinStufe1 !== null && z.istMin >= z.effMinStufe1 - 0.005)));
    if (sp.leiter === "liquidation") return zz.filter((z) => z.liquidationFrei || z.liquidation === "neu");
    if (sp.zustand === "unbekannt") return zz.filter((z) => unbekanntSkus.has(z.sku));
    return zz;
  };
  const extraAktiv = !!(sp.leiter || sp.zustand);
  const gefiltert = extra(filterAbgleich(zeilen.map((z) => ({ ...z, istStrategie: z.istStrategieName, imRepricing: z.istImRepricing })), { land: sp.land, strategie: sp.strategie, hinweis: sp.hinweis, repricing: sp.repricing, q: sp.q, nurAuffaellig: sp.ab !== "alle" && !extraAktiv }));
  const seiten = Math.max(1, Math.ceil(gefiltert.length / AB_SEITE));
  const seite = Math.min(seiten, Math.max(1, Number(sp.abseite) || 1));
  const zeigen = gefiltert.slice((seite - 1) * AB_SEITE, seite * AB_SEITE);
  const rowsAlle = sp.nur === "unter" ? below : sp.nur === "ohne-ek" ? all.filter((r) => r.unitCost === null) : sp.nur === "ohne-preis" ? all.filter((r) => r.price === null) : sp.nur === "geschaetzt" ? all.filter((r) => r.min !== null && isEstimated(r)) : all;
  const sysSeiten = Math.max(1, Math.ceil(rowsAlle.length / SYS_SEITE));
  const sysSeite = Math.min(sysSeiten, Math.max(1, Number(sp.seite) || 1));
  const rows = rowsAlle.slice((sysSeite - 1) * SYS_SEITE, sysSeite * SYS_SEITE);
  const filterAktiv = !!(sp.land || sp.strategie || sp.hinweis || sp.repricing || sp.q || sp.ab || extraAktiv);
  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Amazon</div><h1>Repricer</h1></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn btn-primary" href="/repricer/profitguard" data-testid="link-profitguard">ProfitGuard-Datei (Freigabe)</Link>
          <a className="btn" href="/repricer/export?format=de">Bestandsliste als Tabelle</a>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>{sp.meldung}</div>}
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
          <div className="card card-pad" data-testid="kpi-pg-auffaellig"><div className="kpi-label">ProfitGuard: auffällig</div><div className="kpi-value" style={{ color: auffaellig.length ? "var(--danger)" : undefined }}>{stand.length ? auffaellig.length : "–"}</div><div className="small muted">{stand.length ? `von ${zeilen.length} SKU/Land` : "noch kein Export eingelesen"}</div></div>
          <div className="card card-pad" data-testid="kpi-buybox"><div className="kpi-label">Buy-Box-Anteil</div>{bb.length ? <div className="small">{bb.map((x) => `${x.land} ${String(x.anteil).replace(".", ",")} %`).join(" · ")}<div className="muted">{[...new Set(bb.map((x) => (x.quelle === "profitguard" ? "ProfitGuard" : "Amazon-Geschäftsbericht")))].join(" / ")}</div></div> : <div className="small muted">keine Daten (ProfitGuard-Spalte oder Amazon-Geschäftsbericht)</div>}</div>
        </div>
        <div className="small muted">Bestandsliste: Mindestpreis = EK + FBA-Gebühr + Provision + Mindestgewinn {formatEuro(s.pricing.minProfit)}, Max = Min × {String(s.pricing.maxPriceFactor).replace(".", ",")} bzw. Ziel-VK. Abgleich mit ProfitGuard: Soll-Min = Break-even mit der Mindestmarge der Altersstufe (wie in ProfitGuard). <Link href="/einstellungen">Ändern</Link> · <Link href="/repricer/profitguard#strategien">Strategien</Link></div>
        <KpiMeta source="FBA-Bestand (Bestandsbericht bzw. sellerboard), aktuelle Preise, EK im Seller-System, ProfitGuard-Export" stand={fr.missing ? "kein Bestandsbericht" : `${formatDate(fr.snapshot)}${fr.stale ? " – veraltet" : ""}`} />
      </div>
      {cov.estimated > 0 && (
        <div className="notice notice-warn small" data-testid="estimated-warning">
          <strong>{cov.estimated} von {cov.exact + cov.estimated} Mindestpreisen sind geschätzt:</strong> ohne Gebührenvorschau rechnet das System mit pauschal {formatEuro(s.pricing.defaultFbaFee)} FBA-Gebühr bzw. {Math.round(s.pricing.referralRate * 100)} % Provision. Vor dem Einsatz die <Link href="/import">Gebührenvorschau importieren</Link>. <Link href="/repricer?nur=geschaetzt">Geschätzte ansehen →</Link>
        </div>
      )}
      {stand.length === 0 && (
        <div className="notice notice-warn small" style={{ marginBottom: 12 }} data-testid="profitguard-fehlt">
          <strong>Noch kein ProfitGuard-Export eingelesen.</strong> Ohne ihn fehlen Strategie, Min und Max je SKU in ProfitGuard – im Abgleich, im Verlust-Stopp, im Listing-Check und bei Claude („repricer“). In ProfitGuard unter „Export &amp; Import“ exportieren und <a href="#profitguard-upload">hier unten hochladen</a>.
        </div>
      )}
      <section className="card card-pad stack" data-testid="abgleich-section" id="abgleich" style={{ scrollMarginTop: 70 }}>
        <h2>Abgleich Seller-System ↔ ProfitGuard</h2>
        {stand.length > 0 && <div className="small" data-testid="profitguard-stand">{stand.map((x) => `${x.marktplatz}: ${zeilen.filter((z) => z.land === x.marktplatz).length} SKUs, eingelesen ${x.am ? x.am.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "?"}`).join(" · ")}</div>}
        {uebersicht.length > 0 && (
          <div style={{ overflow: "auto" }}>
            <table className="table" data-testid="pg-strategien-uebersicht">
              <thead><tr><th>Strategie in ProfitGuard</th><th className="right">SKUs</th><th className="right">im Repricing</th><th className="right">nicht im Repricing</th><th className="right">unbekannt</th><th className="right">auffällig</th><th>je Land</th></tr></thead>
              <tbody>
                {uebersicht.map((u) => (
                  <tr key={u.strategie}>
                    <td><Link href={mitParam(sp, { strategie: u.strategie, ab: "alle", abseite: undefined }, "#abgleich")}>{u.strategie}</Link></td>
                    <td className="num right">{u.gesamt}</td>
                    <td className="num right">{u.imRepricing}</td>
                    <td className="num right" style={{ color: u.nichtIm ? "var(--warn)" : undefined }}>{u.nichtIm ? <Link href={mitParam(sp, { strategie: u.strategie, repricing: "nein", ab: "alle", abseite: undefined }, "#abgleich")}>{u.nichtIm}</Link> : 0}</td>
                    <td className="num right muted">{u.unbekannt}</td>
                    <td className="num right">{u.mitHinweis}</td>
                    <td className="small">{Object.entries(u.laender).map(([l, n]) => `${l} ${n}`).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form className="reorder-filter" data-testid="abgleich-filter">
          {sp.nur && <input type="hidden" name="nur" value={sp.nur} />}
          <div className="field"><label className="label" htmlFor="ab">Zeigen</label>
            <select className="input" id="ab" name="ab" defaultValue={sp.ab === "alle" ? "alle" : ""}><option value="">nur Auffälligkeiten</option><option value="alle">alle SKUs</option></select>
          </div>
          <div className="field"><label className="label" htmlFor="land">Land</label>
            <select className="input" id="land" name="land" defaultValue={sp.land ?? ""}><option value="">alle Länder</option>{laender.map((l) => <option key={l} value={l}>{l}</option>)}</select>
          </div>
          <div className="field"><label className="label" htmlFor="strategie">Strategie (ProfitGuard)</label>
            <select className="input" id="strategie" name="strategie" defaultValue={sp.strategie ?? ""}><option value="">alle</option>{uebersicht.map((u) => <option key={u.strategie} value={u.strategie}>{u.strategie}</option>)}</select>
          </div>
          <div className="field"><label className="label" htmlFor="repricing">im Repricing</label>
            <select className="input" id="repricing" name="repricing" defaultValue={sp.repricing ?? ""}><option value="">alle</option><option value="ja">ja</option><option value="nein">nein</option><option value="unbekannt">unbekannt</option></select>
          </div>
          <div className="field"><label className="label" htmlFor="hinweis">Auffälligkeit</label>
            <select className="input" id="hinweis" name="hinweis" defaultValue={sp.hinweis ?? ""}><option value="">alle</option>{HINWEIS_RANG.map((h) => <option key={h} value={h}>{HINWEIS_TEXT[h]}</option>)}</select>
          </div>
          <div className="field"><label className="label" htmlFor="leiter">Leiter / Zustand</label>
            <select className="input" id="leiter" name="leiter" defaultValue={sp.leiter ?? ""} data-testid="abgleich-filter-leiter"><option value="">alle</option><option value="liquidation">Liquidation</option><option value="ablauf7">Liquidation läuft in 7 Tagen ab</option><option value="schnell">Schnelldreher</option><option value="gebraucht_ohne">Gebraucht ohne eigenen Preis</option></select>
          </div>
          {sp.zustand && <input type="hidden" name="zustand" value={sp.zustand} />}
          <div className="field" style={{ flex: "1 1 160px" }}><label className="label" htmlFor="ab-q">Suche</label><input className="input" id="ab-q" name="q" type="search" defaultValue={sp.q ?? ""} placeholder="SKU, ASIN, Titel" /></div>
          <button className="btn" type="submit" data-testid="abgleich-filter-anwenden">Anwenden</button>
          {filterAktiv && <Link className="small" href={mitParam({ nur: sp.nur }, {}, "#abgleich")}>zurücksetzen</Link>}
        </form>
        {gefiltert.length === 0 ? (
          <div className="notice notice-ok small" data-testid="abgleich-keine">{filterAktiv ? "Keine SKUs für diese Auswahl." : stand.length ? "Keine Auffälligkeiten: alle SKUs mit Bestand stehen in ProfitGuard, Min und Max passen zum Soll." : "Noch kein Abgleich möglich."}</div>
        ) : (
          <div style={{ overflow: "auto" }}>
            <div className="small muted" data-testid="abgleich-anzahl">{gefiltert.length} Zeilen{auffaellig.length !== gefiltert.length ? ` · ${auffaellig.length} mit Auffälligkeiten insgesamt` : ""}{seiten > 1 ? ` · Seite ${seite} von ${seiten}` : ""}</div>
            <form id="ab-wahl" />
            <table className="table" data-testid="abgleich-tabelle">
              <thead><tr><th aria-label="Auswahl" /><th>Land</th><th>SKU</th><th title="Soll-Strategie im Seller-System">Soll</th><th>Ist (ProfitGuard)</th><th>Liquidation bis</th><th>Zustand</th><th className="right">Preis</th><th className="right" title="Break-even mit der Mindestmarge der Altersstufe">Soll-Min</th><th className="right">Min PG</th><th className="right">Soll-Max</th><th className="right">Max PG</th><th>Buy Box</th><th>Prüfen</th></tr></thead>
              <tbody>
                {zeigen.map((z) => (
                  <tr key={k(z)} data-testid="abgleich-zeile" data-sku={z.sku} data-land={z.land}>
                    <td><input type="checkbox" form="ab-wahl" name="wahl" value={k(z)} aria-label={`${z.sku} wählen`} data-testid="abgleich-wahl" /></td>
                    <td>{z.land}</td>
                    <td className="num small">{z.sku}<div className="muted" style={{ fontFamily: "inherit", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{z.titel ?? ""}</div></td>
                    <td className="small" data-testid="abgleich-soll">{z.regel}{z.stufe ? <div className="muted">Stufe {z.stufe}{z.marge !== null ? ` · ${String(z.marge).replace(".", ",")} %` : ""}</div> : null}{pfJe.get(k(z))?.schnelldreher && <div data-testid="abgleich-schnell">⚡ Schnelldreher</div>}</td>
                    <td className="small" data-testid="abgleich-ist">{z.istStrategieName ?? "–"}{z.istImRepricing === false ? <div style={{ color: "var(--warn)" }}>nicht im Repricing</div> : z.istImRepricing === null && z.istMin === null ? <div className="muted">nicht im Export</div> : null}</td>
                    <td className="small">{(() => { const l = lqJe.get(k(z)); if (!l) return "–"; const a = ablaufStand({ bis: l.bis, dauerhaft: l.dauerhaft, heute, vorwarnTage: s.repricing.leiter.ablaufVorwarnTage }); return a.stand === "dauerhaft" ? "dauerhaft" : l.bis ? <>{formatDate(l.bis)}<div className="muted">{a.stand === "abgelaufen" ? "überfällig" : `noch ${a.restTage} T`}</div></> : "–"; })()}</td>
                    <td className="small" data-testid="abgleich-zustand">{unbekanntSkus.has(z.sku) ? <span style={{ color: "var(--warn)" }}>unbekannt</span> : <>{ZUSTAND_TEXT[z.zustand]}{istGebraucht(z.zustand) && <div className="muted">Ziel {formatEuro(z.zielpreis)} · Min geb. {formatEuro(z.minGebraucht)}</div>}</>}</td>
                    <td className="num right">{formatEuro(z.istPreis)}</td>
                    <td className="num right" style={{ fontWeight: 600 }}>{formatEuro(z.min)}</td>
                    <td className="num right" style={{ color: z.hinweise.includes("min_unter_soll") ? "var(--danger)" : undefined, fontWeight: 600 }}>{formatEuro(z.istMin)}</td>
                    <td className="num right">{formatEuro(z.max)}</td>
                    <td className="num right">{formatEuro(z.istMax)}</td>
                    <td className="small">{formatEuro(z.buybox)}</td>
                    <td className="small">{z.hinweise.length ? z.hinweise.map((h) => HINWEIS_TEXT[h]).join("; ") : <span className="muted">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {session.role === "owner" && !session.readOnly && (
              <div className="row small" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }} data-testid="abgleich-mehrfach">
                <span className="muted">Auswahl:</span>
                <select name="zustand" form="ab-wahl" defaultValue="" aria-label="Zustand"><option value="">Zustand …</option>{ZUSTAENDE.filter((x) => x !== "unbekannt").map((x) => <option key={x} value={x}>{ZUSTAND_TEXT[x as Zustand]}</option>)}<option value="auto">automatisch erkennen</option></select>
                <input type="hidden" name="zurueck_q" value={sp.q ?? ""} form="ab-wahl" />
                <button className="btn btn-sm" type="submit" form="ab-wahl" formAction={zustandAction} data-testid="abgleich-zustand-setzen">Zustand setzen</button>
                <button className="btn btn-sm" type="submit" form="ab-wahl" formAction={schnelldreherAnAction} data-testid="abgleich-schnell-an">⚡ Schnelldreher an</button>
                <button className="btn btn-sm" type="submit" form="ab-wahl" formAction={schnelldreherAusAction} data-testid="abgleich-schnell-aus">Schnelldreher aus</button>
              </div>
            )}
            {seiten > 1 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }} data-testid="abgleich-seiten">
                {seite > 1 && <Link className="chip" href={mitParam(sp, { abseite: String(seite - 1) }, "#abgleich")}>← zurück</Link>}
                <span className="small muted" style={{ alignSelf: "center" }}>Seite {seite} von {seiten}</span>
                {seite < seiten && <Link className="chip" href={mitParam(sp, { abseite: String(seite + 1) }, "#abgleich")}>weiter →</Link>}
              </div>
            )}
          </div>
        )}
        {sp.zustand === "unbekannt" && (v?.zustandUnbekannt.length ?? 0) > 0 && (
          <div className="notice notice-warn small stack" style={{ gap: 6 }} data-testid="zustand-unbekannt-liste">
            <strong>Ohne Zustand – nicht im Abgleich und nicht in der Datei ({new Set(v!.zustandUnbekannt.map((u) => u.sku)).size})</strong>
            <form id="zu-wahl" />
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              {[...new Map(v!.zustandUnbekannt.map((u) => [u.sku, u])).values()].slice(0, 200).map((u) => (
                <label key={u.sku}><input type="checkbox" form="zu-wahl" name="wahl" value={`${u.land}|${u.sku}`} data-testid="zustand-unbekannt-wahl" /> {u.sku}{u.titel ? ` – ${u.titel.slice(0, 40)}` : ""}</label>
              ))}
            </div>
            {session.role === "owner" && !session.readOnly && (
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <select name="zustand" form="zu-wahl" defaultValue="" aria-label="Zustand"><option value="">Zustand …</option>{ZUSTAENDE.filter((x) => x !== "unbekannt").map((x) => <option key={x} value={x}>{ZUSTAND_TEXT[x as Zustand]}</option>)}</select>
                <button className="btn btn-sm" type="submit" form="zu-wahl" formAction={zustandAction} data-testid="zustand-unbekannt-setzen">Zustand setzen</button>
              </div>
            )}
          </div>
        )}
        <div id="profitguard-upload" style={{ scrollMarginTop: 70 }}><ProfitguardUpload /></div>
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
      <div className="small muted">EK = gültiger Einkaufspreis netto (Charge → von Hand → eBay-Tool → Set → sellerboard → geerbt), derselbe Wert wie in Produkt, Gewinn und Nachbestellung. „~“ bzw. „geschätzt“ = pauschale FBA-Gebühr oder Provision (Gebührenvorschau importieren für echte Werte). „nicht bekannt“ = kein aktueller Preis im Bestandsbericht.</div>
    </>
  );
}
