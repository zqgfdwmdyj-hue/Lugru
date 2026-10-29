import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { formatDate, formatEuro } from "@/lib/numbers";
import { purchaseSuggestions } from "@/lib/purchasing/service";
import { sellerboardReorder } from "@/lib/purchasing/reorder";
import { ampelJeSku } from "@/lib/money/kapital-service";
import { CHECK_LABEL, filterReorder, reorderTotals, URGENCY_LABEL, type ReorderCheck, type ReorderFilter, type Urgency } from "@/lib/purchasing/reorder-logic";
import { COST_SOURCE_LABEL } from "@/lib/money/profit-logic";
import { reachText } from "@/lib/stock/breakdown";
import { getSettings } from "@/lib/settings";
import { todayIso } from "@/lib/dates";
import { SuggestSubmit } from "../forms";

// Bestellvorschläge: zwei getrennt benannte Rechenwege (A: sellerboard, B: eigene WaWi-Rechnung). Beide nutzen
// denselben gültigen EK netto; Kapitalbedarf, Dringlichkeit und Marge lassen sich filtern, Prüffälle gesammelt.

const clampInt = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};
const numOrNull = (v: string | undefined) => (v === undefined || v.trim() === "" || !Number.isFinite(Number(v.replace(",", "."))) ? null : Number(v.replace(",", ".")));
const eur0 = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const PAGE = 50;

type SP = { weg?: string; q?: string; dring?: string; pruefen?: string; marge?: string; kapital?: string; sort?: string; seite?: string; lieferzeit?: string; reichweite?: string; alle?: string; rot?: string };

function href(base: SP, patch: Partial<SP>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...patch })) if (v !== undefined && v !== "" && v !== null) u.set(k, String(v));
  return `/einkauf/vorschlaege?${u.toString()}`;
}

export default async function VorschlaegePage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const [sb, settings, ampel] = await Promise.all([sellerboardReorder(session.tenantId), getSettings(session.tenantId), ampelJeSku(session.tenantId, todayIso()).catch(() => new Map<string, "gruen" | "gelb" | "rot">())]);
  const weg = sp.weg === "wawi" || sp.weg === "sellerboard" ? sp.weg : sb.rows.length ? "sellerboard" : "wawi";
  const leadDays = clampInt(sp.lieferzeit, 14, 0, 120);
  const coverDays = clampInt(sp.reichweite, 30, 7, 365);

  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/einkauf">Einkauf</Link></div><h1>Bestellvorschläge</h1></div>
      </div>
      <p className="muted small" style={{ margin: 0, maxWidth: 900 }}>
        Zwei getrennte Rechenwege – sie können unterschiedliche Mengen ergeben. Beide rechnen mit demselben <strong>gültigen EK netto</strong> (Charge → von Hand → eBay-Tool → Set → sellerboard → geerbt; 0,01-€-Platzhalter zählen nie).
        Kapitalbedarf = Menge × EK netto, ohne Versand und Umsatzsteuer.
      </p>
      <nav className="prod-tabs" aria-label="Rechenweg" data-testid="reorder-ways">
        <Link href={href({ weg: "sellerboard" }, {})} className={`chip${weg === "sellerboard" ? " active" : ""}`} aria-current={weg === "sellerboard" ? "true" : undefined} data-testid="way-sellerboard">A · Nachbestellen laut sellerboard ({sb.rows.length})</Link>
        <Link href={href({ weg: "wawi" }, {})} className={`chip${weg === "wawi" ? " active" : ""}`} aria-current={weg === "wawi" ? "true" : undefined} data-testid="way-wawi">B · Eigene WaWi-Rechnung</Link>
      </nav>
      {weg === "sellerboard" ? <SellerboardWay sp={sp} data={sb} ampel={ampel} /> : <WawiWay tenantId={session.tenantId} sp={sp} leadDays={leadDays} coverDays={coverDays} vatRate={settings.vatRate} />}
    </>
  );
}

function SellerboardWay({ sp, data, ampel }: { sp: SP; data: Awaited<ReturnType<typeof sellerboardReorder>>; ampel: Map<string, "gruen" | "gelb" | "rot"> }) {
  const base: SP = { weg: "sellerboard", q: sp.q, dring: sp.dring, pruefen: sp.pruefen, marge: sp.marge, kapital: sp.kapital, sort: sp.sort, rot: sp.rot };
  const f: ReorderFilter = {
    q: sp.q,
    dring: (["ueberfaellig", "jetzt", "bald"] as const).includes(sp.dring as Urgency) ? (sp.dring as Urgency) : "alle",
    pruefen: sp.pruefen === "regulaer" || (sp.pruefen && sp.pruefen in CHECK_LABEL) ? (sp.pruefen as ReorderCheck | "regulaer") : "alle",
    margeMin: numOrNull(sp.marge),
    kapitalMin: numOrNull(sp.kapital),
    sort: sp.sort === "kapital" || sp.sort === "marge" ? sp.sort : "dring",
  };
  // Kapital-Ampel rot (Geld liegt, Rendite gering, Preis unter Break-even) → nicht vorschlagen; auf Wunsch zeigen.
  const rote = data.rows.filter((r) => ampel.get(r.sku) === "rot");
  const all = sp.rot === "1" ? data.rows : data.rows.filter((r) => ampel.get(r.sku) !== "rot");
  const t = reorderTotals(all);
  const list = filterReorder(all, f);
  const shown = reorderTotals(list);
  const page = Math.max(1, Number(sp.seite) || 1);
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const rows = list.slice((page - 1) * PAGE, page * PAGE);
  const checkCount = (k: ReorderCheck) => all.filter((r) => r.checks.includes(k)).length;
  if (!all.length && !rote.length)
    return (
      <div className="card card-pad small" data-testid="sb-reorder-empty">
        sellerboard meldet gerade nichts zum Nachbestellen – oder der Bestand wurde noch nicht abgeglichen (<Link href="/anbindungen#sellerboard">Anbindungen → sellerboard</Link>). Die eigene Rechnung steht unter <Link href={href({ weg: "wawi" }, {})}>B · Eigene WaWi-Rechnung</Link>.
      </div>
    );
  return (
    <section className="stack" style={{ gap: 12 }} id="sellerboard" data-testid="sb-reorder">
      <div className="card card-pad small" data-testid="sb-reorder-how">
        <strong>So rechnet sellerboard:</strong> Menge und spätester Bestelltermin aus dem Verkaufstempo, der in sellerboard eingestellten Lieferzeit und dem Sicherheitspuffer (diese Einstellungen werden nicht übertragen – in sellerboard prüfen).
        Berücksichtigter Bestand: <strong>verkaufbar + reserviert + unterwegs zu Amazon</strong>; eigenes Lager und offene WaWi-Bestellungen zählen in dieser Rechnung nicht.
        Stand {data.syncedAt ? data.syncedAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–"} Uhr.
      </div>
      {rote.length > 0 && (
        <div className="card card-pad small" data-testid="reorder-rot-hinweis">
          {sp.rot === "1" ? (
            <>Artikel mit <strong>roter Kapital-Ampel</strong> werden mit angezeigt ({rote.length}) – dort bindet Ware Geld ohne ausreichende Rendite. <Link href={href(base, { rot: undefined, seite: undefined })}>Wieder ausblenden</Link></>
          ) : (
            <>{rote.length} Artikel mit <strong>roter Kapital-Ampel</strong> ausgeblendet (nicht nachbestellen – siehe <Link href="/kapital?filter=rot">Kapital-Ampel</Link>). <Link href={href(base, { rot: "1", seite: undefined })} data-testid="reorder-rot-zeigen">Trotzdem zeigen</Link></>
          )}
        </div>
      )}
      <div className="grid-kpi" data-testid="sb-reorder-totals">
        <div className="card card-pad">
          <div className="kpi-label">Kapitalbedarf netto (regulär)</div>
          <div className="kpi-value" data-testid="sb-reorder-capital">{eur0(t.capital)}</div>
          <div className="small muted">{t.withCapital} Artikel mit gültigem EK{f.q || f.dring !== "alle" || f.pruefen !== "alle" || f.margeMin !== null || f.kapitalMin !== null ? ` · Auswahl: ${eur0(shown.capital)}` : ""}</div>
        </div>
        <div className="card card-pad">
          <div className="kpi-label">Nicht enthalten</div>
          <div className="small" style={{ marginTop: 6 }} data-testid="sb-reorder-excluded">{t.noEk} ohne EK · {t.returns} Retouren</div>
        </div>
        <div className="card card-pad">
          <div className="kpi-label">Dringlichkeit</div>
          <div className="small" style={{ marginTop: 6 }}>{t.byUrgency.ueberfaellig} überfällig · {t.byUrgency.jetzt} jetzt · {t.byUrgency.bald} bald</div>
        </div>
      </div>
      <div className="card card-pad" data-testid="reorder-checks">
        <div className="small" style={{ marginBottom: 6 }}><strong>Prüfliste</strong> – Fälle, die nicht einfach nachbestellt werden sollten:</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Link href={href(base, { pruefen: undefined, seite: undefined })} className={`chip${f.pruefen === "alle" ? " active" : ""}`} aria-current={f.pruefen === "alle" ? "true" : undefined}>Alle · {all.length}</Link>
          <Link href={href(base, { pruefen: "regulaer", seite: undefined })} className={`chip${f.pruefen === "regulaer" ? " active" : ""}`} aria-current={f.pruefen === "regulaer" ? "true" : undefined} data-testid="check-regulaer">Regulär nachbestellbar · {all.filter((r) => r.regular).length}</Link>
          {(Object.keys(CHECK_LABEL) as ReorderCheck[]).map((k) => (
            <Link key={k} href={href(base, { pruefen: k, seite: undefined })} className={`chip${f.pruefen === k ? " active" : ""}`} aria-current={f.pruefen === k ? "true" : undefined} title={CHECK_LABEL[k].hint} data-testid={`check-${k}`}>
              {CHECK_LABEL[k].label} · {checkCount(k)}
            </Link>
          ))}
        </div>
        {f.pruefen !== "alle" && f.pruefen !== "regulaer" && f.pruefen && <p className="small muted" style={{ margin: "8px 0 0" }}>{CHECK_LABEL[f.pruefen].hint}</p>}
      </div>
      <form className="card card-pad reorder-filter" data-testid="reorder-filter">
        <input type="hidden" name="weg" value="sellerboard" />
        {f.pruefen !== "alle" && <input type="hidden" name="pruefen" value={f.pruefen} />}
        <div className="field" style={{ flex: "2 1 200px" }}><label className="label" htmlFor="q">Suche</label><input className="input" id="q" name="q" type="search" defaultValue={sp.q ?? ""} placeholder="SKU, ASIN oder Name" data-testid="reorder-q" /></div>
        <div className="field"><label className="label" htmlFor="dring">Dringlichkeit</label>
          <select className="input" id="dring" name="dring" defaultValue={f.dring}>
            <option value="alle">alle</option><option value="ueberfaellig">überfällig</option><option value="jetzt">jetzt</option><option value="bald">bald</option>
          </select>
        </div>
        <div className="field"><label className="label" htmlFor="marge">Marge 30 T. ab %</label><input className="input" id="marge" name="marge" inputMode="decimal" defaultValue={sp.marge ?? ""} style={{ width: 90 }} data-testid="reorder-marge" /></div>
        <div className="field"><label className="label" htmlFor="kapital">Kapital ab €</label><input className="input" id="kapital" name="kapital" inputMode="decimal" defaultValue={sp.kapital ?? ""} style={{ width: 100 }} data-testid="reorder-kapital" /></div>
        <div className="field"><label className="label" htmlFor="sort">Sortieren</label>
          <select className="input" id="sort" name="sort" defaultValue={f.sort}>
            <option value="dring">nach Dringlichkeit</option><option value="kapital">nach Kapitalbedarf</option><option value="marge">nach Marge</option>
          </select>
        </div>
        <button className="btn" type="submit" data-testid="reorder-apply">Anwenden</button>
        {(sp.q || sp.dring || sp.marge || sp.kapital || sp.sort) && <Link className="small" href={href({ weg: "sellerboard", pruefen: sp.pruefen }, {})}>zurücksetzen</Link>}
      </form>
      <section className="card" style={{ overflow: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Artikel</th>
              <th className="right" title="Verkaufbar + reserviert + unterwegs zu Amazon">Bestand berücksichtigt</th>
              <th className="right">Pro Tag</th><th className="right">Reicht noch</th><th className="right">Menge</th><th>Bestellen bis</th>
              <th className="right" title="Gültiger EK netto je Stück">EK netto</th><th className="right">Kapital netto</th><th className="right" title="Marge der letzten 30 Tage mit gültigem EK">Marge 30 T.</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={9} className="muted small" data-testid="reorder-none">Keine Zeile passt zu den Filtern.</td></tr>}
            {rows.map((r) => {
              const total = r.fbaStock + r.reserved + r.inbound;
              return (
                <tr key={r.id} data-testid="sb-reorder-row" data-sku={r.sku} data-checks={r.checks.join(" ")}>
                  <td style={{ maxWidth: 340 }}>
                    <Link href={`/produkte/sku/${encodeURIComponent(r.sku)}`} className="num">{r.sku}</Link>
                    <div className="small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name ?? ""}</div>
                    {r.isReturn && (
                      <div className="small" data-testid="reorder-origin" style={{ color: "var(--warn)" }}>
                        Retoure – {r.origin ? <>Ursprungsartikel <Link href={`/produkte/sku/${encodeURIComponent(r.origin)}`} className="num">{r.origin}</Link>, dort nachbestellen</> : "Beschaffung prüfen (kein Ursprungsartikel bekannt)"}
                      </div>
                    )}
                    {!r.isReturn && <div className="small muted">{r.source ?? <span style={{ color: "var(--warn)" }}>Bezugsquelle unklar – Beschaffung prüfen</span>}</div>}
                    {ampel.get(r.sku) && <Link href={`/kapital?q=${encodeURIComponent(r.sku)}`} className={`tag ${ampel.get(r.sku) === "rot" ? "tag-danger" : ampel.get(r.sku) === "gelb" ? "tag-warn" : "tag-ok"}`} data-testid="reorder-ampel">Kapital {ampel.get(r.sku) === "rot" ? "rot – nicht nachbestellen" : ampel.get(r.sku)}</Link>}
                    {r.checks.filter((c) => c !== "retoure").length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>{r.checks.filter((c) => c !== "retoure").map((c) => <span key={c} className="tag tag-warn" title={CHECK_LABEL[c].hint}>{CHECK_LABEL[c].label}</span>)}</div>
                    )}
                  </td>
                  <td className="num right" title={`verkaufbar ${r.fbaStock} · reserviert ${r.reserved} · unterwegs ${r.inbound}`}>
                    {total}
                    <div className="small muted">{r.fbaStock} / {r.reserved} / {r.inbound}</div>
                  </td>
                  <td className="num right">{r.salesVelocity === null ? "–" : Number(r.salesVelocity).toLocaleString("de-DE")}</td>
                  <td className="num right" style={r.daysLeft !== null && r.daysLeft < 14 ? { color: "var(--danger)", fontWeight: 600 } : undefined} title={r.noSales ? "sellerboard meldet 999 Tage, wenn nichts verkauft wurde" : undefined}>{reachText(r.daysLeft, { short: true })}</td>
                  <td className="num right"><strong>{r.isReturn ? <span className="muted" title="Retoure – Menge gilt für den Ursprungsartikel">({r.qtyToReorder})</span> : r.qtyToReorder}</strong></td>
                  <td>
                    <span className={`tag ${r.urgency === "bald" ? "tag-warn" : "tag-danger"}`}>{r.urgency === "ueberfaellig" ? `überfällig seit ${-(r.daysToReorder ?? 0)} T.` : URGENCY_LABEL[r.urgency]}</span>
                    {r.orderBy && r.urgency === "bald" && <div className="small muted">bis {formatDate(r.orderBy)}</div>}
                  </td>
                  <td className="num right" data-testid="reorder-ek">
                    {r.ek ? formatEuro(r.ek.cost) : <Link href={`/produkte/sku/${encodeURIComponent(r.sku)}?tab=einkauf`} className="tag tag-missing">fehlt</Link>}
                    {r.ek && <div className="small muted" style={{ fontFamily: "inherit" }}>{COST_SOURCE_LABEL[r.ek.source]}{r.ek.inherited ? " · geerbt" : ""}</div>}
                    {r.sbCompare?.deviates && <div className="small" style={{ color: "var(--warn)", fontFamily: "inherit" }} data-testid="reorder-sb-note">sellerboard {formatEuro(r.sbCompare.value)}{r.sbCompare.placeholder ? " (Platzhalter)" : ""}</div>}
                  </td>
                  <td className="num right" data-testid="reorder-capital">{r.capital !== null ? formatEuro(r.capital) : <span className="muted">–</span>}</td>
                  <td className="num right">{r.margin === null ? <span className="muted">–</span> : <span style={{ color: r.margin < 0 ? "var(--danger)" : undefined }}>{r.margin.toLocaleString("de-DE")} %</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <div className="between small" style={{ flexWrap: "wrap", gap: 8 }}>
        <span className="muted">{list.length} von {all.length} Zeilen · Bestand-Spalte: verkaufbar / reserviert / unterwegs</span>
        {pages > 1 && (
          <span style={{ display: "flex", gap: 6 }} data-testid="reorder-pages">
            {page > 1 && <Link href={href(base, { seite: String(page - 1) })}>← zurück</Link>}
            <span>Seite {page} von {pages}</span>
            {page < pages && <Link href={href(base, { seite: String(page + 1) })}>weiter →</Link>}
          </span>
        )}
      </div>
    </section>
  );
}

async function WawiWay({ tenantId, sp, leadDays, coverDays, vatRate }: { tenantId: string; sp: SP; leadDays: number; coverDays: number; vatRate: number }) {
  const all = sp.alle === "1";
  const rows0 = await purchaseSuggestions(tenantId, { leadDays, coverDays, all });
  const q = sp.q?.trim().toLowerCase();
  const pruefen = sp.pruefen;
  const flagged = (r: (typeof rows0)[number]) => ({ ek_fehlt: r.ekNet === null, retoure: r.returnOnly, quelle: !r.sourceKnown && !r.returnOnly });
  const rows = rows0.filter((r) => (!q || [r.asin, r.title ?? "", r.ekSku ?? ""].some((x) => x.toLowerCase().includes(q))) && (!pruefen || pruefen === "alle" || (pruefen in CHECK_LABEL && flagged(r)[pruefen as "ek_fehlt" | "retoure" | "quelle"])));
  const need = rows0.filter((r) => r.need > 0);
  const capital = need.reduce((n, r) => n + (r.ekNet !== null && !r.returnOnly ? r.ekNet * r.need : 0), 0);
  const base: SP = { weg: "wawi", lieferzeit: String(leadDays), reichweite: String(coverDays), alle: all ? "1" : undefined };
  const counts = { ek_fehlt: rows0.filter((r) => flagged(r).ek_fehlt).length, retoure: rows0.filter((r) => flagged(r).retoure).length, quelle: rows0.filter((r) => flagged(r).quelle).length };
  return (
    <section className="stack" style={{ gap: 12 }} data-testid="wawi-reorder">
      <div className="card card-pad small" data-testid="wawi-reorder-how">
        <strong>So rechnet die WaWi:</strong> Tagesabsatz = 60 % aus den letzten 30 Tagen + 40 % aus den letzten 90 Tagen (Aufträge aller Kanäle bzw. Amazon-Abrechnung – das Größere zählt).
        Berücksichtigter Bestand: <strong>Amazon verkaufbar + reserviert, unterwegs zu Amazon, eigenes Lager und offene Bestellungen</strong> (nicht verkaufbar zählt nicht).
        Vorschlag = Tagesabsatz × (Lieferzeit <strong>{leadDays}</strong> + Zielreichweite <strong>{coverDays}</strong> Tage) − Bestand − bestellt.
      </div>
      <form className="card card-pad reorder-filter">
        <input type="hidden" name="weg" value="wawi" />
        <div className="field"><label className="label" htmlFor="lz">Lieferzeit (Tage)</label><input className="input" id="lz" name="lieferzeit" type="number" defaultValue={leadDays} style={{ width: 110 }} /></div>
        <div className="field"><label className="label" htmlFor="rw">Zielreichweite danach (Tage)</label><input className="input" id="rw" name="reichweite" type="number" defaultValue={coverDays} style={{ width: 110 }} /></div>
        <div className="field" style={{ flex: "2 1 200px" }}><label className="label" htmlFor="wq">Suche</label><input className="input" id="wq" name="q" type="search" defaultValue={sp.q ?? ""} placeholder="ASIN, SKU oder Name" /></div>
        <label className="small" style={{ display: "flex", gap: 6, alignItems: "center", paddingBottom: 10 }}><input type="checkbox" name="alle" value="1" defaultChecked={all} /> auch Artikel ohne Bedarf</label>
        <button className="btn" type="submit">Neu berechnen</button>
      </form>
      <div className="grid-kpi">
        <div className="card card-pad"><div className="kpi-label">Kapitalbedarf netto</div><div className="kpi-value" data-testid="wawi-capital">{eur0(capital)}</div><div className="small muted">{need.filter((r) => r.ekNet !== null && !r.returnOnly).length} Vorschläge mit gültigem EK</div></div>
        <div className="card card-pad">
          <div className="kpi-label">Prüfliste</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            <Link className={`chip${!pruefen || pruefen === "alle" ? " active" : ""}`} aria-current={!pruefen || pruefen === "alle" ? "true" : undefined} href={href(base, { q: sp.q })}>Alle</Link>
            {(["ek_fehlt", "retoure", "quelle"] as const).map((k) => <Link key={k} className={`chip${pruefen === k ? " active" : ""}`} aria-current={pruefen === k ? "true" : undefined} href={href(base, { q: sp.q, pruefen: k })} title={CHECK_LABEL[k].hint} data-testid={`wawi-check-${k}`}>{k === "retoure" ? "Nur Retouren-Ware" : CHECK_LABEL[k].label} · {counts[k]}</Link>)}
          </div>
        </div>
      </div>
      <SuggestSubmit>
        <section className="card" style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }}></th><th>Artikel</th><th className="right">Verkauft 30/90 T.</th><th className="right">Pro Tag</th>
                <th className="right" title="Amazon verkaufbar + reserviert / unterwegs / eigenes Lager / bestellt">Bestand berücksichtigt</th><th className="right">Reicht</th>
                <th className="right">Vorschlag</th><th>Bezugsquelle</th><th className="right" title="Gültiger EK netto je Stück">EK netto</th><th className="right" title="Für die Bestellung beim Lieferanten (inkl. USt.)">EK brutto (Bestellung)</th><th className="right">Kapital netto</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={11} className="muted">Kein Nachkaufbedarf – oder noch keine Verkaufsdaten (Aufträge bzw. Amazon-Abrechnungen importieren).</td></tr>}
              {rows.map((r) => {
                const gross = r.bestOffer?.price ?? (r.ekNet != null ? r.ekNet * (1 + vatRate) : null);
                const ek = gross == null ? "" : gross.toFixed(2).replace(".", ",");
                const sup = r.bestOffer?.supplier ?? r.lastSupplier ?? "";
                const fl = flagged(r);
                const stock = r.fba + r.inbound + r.own + r.onOrder;
                return (
                  <tr key={r.asin} data-testid="wawi-row" data-asin={r.asin}>
                    <td><input type="checkbox" name="pick" value={r.asin} defaultChecked={r.need > 0 && Boolean(sup) && !r.returnOnly} aria-label={`${r.asin} übernehmen`} /></td>
                    <td style={{ maxWidth: 300 }}>
                      <span className="num">{r.asin}</span>
                      <div className="small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title ?? ""}</div>
                      <input type="hidden" name={`title:${r.asin}`} value={r.title ?? ""} />
                      {r.returnOnly && <div className="small" style={{ color: "var(--warn)" }} data-testid="wawi-return-only">Nur Retouren-Ware – Beschaffung prüfen</div>}
                    </td>
                    <td className="num right">{r.sold30} / {r.sold90}</td>
                    <td className="num right">{r.daily.toLocaleString("de-DE")}</td>
                    <td className="num right" title={`Amazon verkaufbar + reserviert ${r.fba} · unterwegs ${r.inbound} · eigenes Lager ${r.own} · bestellt ${r.onOrder}`}>
                      {stock}
                      <div className="small muted">{r.fba} / {r.inbound} / {r.own} / {r.onOrder}</div>
                    </td>
                    <td className="num right" style={r.shortfall > 0 || (r.daysLeft !== null && r.daysLeft < leadDays) ? { color: "var(--danger)", fontWeight: 600 } : undefined}>
                      {r.shortfall > 0 ? <span data-testid="wawi-shortfall">Fehlbestand: {r.shortfall} Stück<div className="small" style={{ fontWeight: 400 }}>sofort prüfen</div></span> : r.daysLeft === null ? "–" : `${r.daysLeft} T.`}
                    </td>
                    <td className="right"><input className="input" name={`qty:${r.asin}`} defaultValue={r.need || ""} inputMode="numeric" style={{ width: 64, textAlign: "right" }} aria-label="Menge" /></td>
                    <td>
                      <input className="input" name={`sup:${r.asin}`} defaultValue={sup} style={{ width: 110 }} aria-label="Lieferant" />
                      <div className="small muted">{r.bestOffer ? `Feed${r.bestOffer.stock != null ? `, ${r.bestOffer.stock} verfügbar` : ""}` : r.lastSupplier ? `zuletzt ${formatDate(r.lastDate)}` : fl.quelle ? <span style={{ color: "var(--warn)" }}>unklar – prüfen</span> : ""}</div>
                    </td>
                    <td className="num right" data-testid="wawi-ek">
                      {r.ekNet !== null ? formatEuro(r.ekNet) : <span className="tag tag-missing">fehlt</span>}
                      {r.ekSource && <div className="small muted" style={{ fontFamily: "inherit" }}>{COST_SOURCE_LABEL[r.ekSource]}</div>}
                    </td>
                    <td className="right"><input className="input" name={`ek:${r.asin}`} defaultValue={ek} inputMode="decimal" style={{ width: 84, textAlign: "right" }} aria-label="EK brutto für die Bestellung" /></td>
                    <td className="num right">{r.ekNet !== null && r.need > 0 && !r.returnOnly ? formatEuro(r.ekNet * r.need) : <span className="muted">–</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </SuggestSubmit>
      <div className="small muted">Bestand-Spalte: Amazon verkaufbar + reserviert / unterwegs zu Amazon / eigenes Lager / bestellt. EK brutto ist vorbelegt mit dem günstigsten Feed-Angebot bzw. dem gültigen EK netto × {(1 + vatRate).toLocaleString("de-DE")}.</div>
    </section>
  );
}
