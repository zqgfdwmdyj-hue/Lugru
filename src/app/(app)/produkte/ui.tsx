import Link from "next/link";
import { canAccess } from "@/lib/auth/areas";
import type { Session } from "@/lib/auth/session";
import { safeHref } from "@/lib/auth/prefs";
import { todayIso } from "@/lib/dates";
import { CHANNEL_LABEL, COST_SOURCE_LABEL as LOT_COST_SOURCE } from "@/lib/labels";
import { formatDate, formatEuro } from "@/lib/numbers";
import { amazonProfit, orderLines } from "@/lib/money/profit";
import { COST_SOURCE_LABEL, summarizeAmazon, summarizeChannels, totalsOf } from "@/lib/money/profit-logic";
import { RANGES, rangeOf, type Range } from "@/lib/money/ranges";
import { skuCostMap } from "@/lib/money/costs";
import { availableOf, stockSkuOf, targetQuantity } from "@/lib/stock/channel-logic";
import { breakdownText, fbaBreakdown, STOCK_TERMS } from "@/lib/stock/breakdown";
import { getSettings } from "@/lib/settings";
import type { ProductDetail } from "@/lib/products/service";
import { Kpi } from "@/components/kpi";
import { FixForm } from "../gewinn/fix-form";
import { setLotCostAction, setSkuCostAction } from "../gewinn/actions";

// Produkte: gemeinsame Bausteine für Liste und Detail (Seiten dürfen nur default/metadata exportieren).

export const VIEWS = { bestand: "Mit Bestand", alle: "Alle", zuordnung: "Zuordnung prüfen" } as const;
export type View = keyof typeof VIEWS;
export const PAGE_SIZE = 50;

export function listHref(p: { q?: string; ansicht?: string; seite?: string; art?: string }) {
  const u = new URLSearchParams();
  if (p.q) u.set("q", p.q);
  if (p.ansicht && p.ansicht !== "bestand") u.set("ansicht", p.ansicht);
  if (p.art) u.set("art", p.art);
  if (p.seite && p.seite !== "1") u.set("seite", p.seite);
  const s = u.toString();
  return `/produkte${s ? `?${s}` : ""}`;
}

export const TABS = { stammdaten: "Stammdaten", einkauf: "Chargen & Einkauf", bestand: "Bestand", angebote: "Angebote", ergebnis: "Ergebnis", belege: "Belege" } as const;
export type Tab = keyof typeof TABS;

const STATUS_LABEL: Record<string, string> = { draft: "Entwurf", active: "aktiv", ended: "beendet", error: "Fehler", published: "veröffentlicht" };
const PO_LABEL: Record<string, string> = { draft: "Entwurf", ordered: "bestellt", shipped: "unterwegs", partial: "teilweise da", received: "eingegangen", cancelled: "storniert" };
const LOT_KIND: Record<string, string> = { purchase: "Einkauf", return: "Retoure", unknown: "unbekannt" };

/** Detailansicht mit Reitern. `base` = Adresse dieser Seite ohne Abfrage. */
export async function ProductHub({ session, d, base, tab, von, highlight, zeitraum }: { session: Session; d: ProductDetail & object; base: string; tab: Tab; von?: string; highlight?: string; zeitraum?: string }) {
  const tabs = (Object.keys(TABS) as Tab[]).filter((k) => (k === "ergebnis" ? canAccess(session, "geld") : k === "belege" ? canAccess(session, "buchhaltung") : true));
  const current: Tab = tabs.includes(tab) ? tab : "stammdaten";
  // Zurück dorthin, woher man kam: Produktliste (mit Filtern) oder Suche (mit Suchbegriff) – samt Sprungmarke der Zeile.
  const safeVon = von ? safeHref(von) : null;
  const back = safeVon && (safeVon.startsWith("/produkte") || safeVon.startsWith("/suche")) ? safeVon : "/produkte";
  const backQ = back.startsWith("/suche") ? new URLSearchParams(back.split("?")[1]?.split("#")[0] ?? "").get("q") : null;
  const backLabel = back.startsWith("/suche") ? `← Suche${backQ ? ` „${backQ}“` : ""}` : "← Produkte";
  const q = (t: Tab) => {
    const u = new URLSearchParams();
    if (t !== "stammdaten") u.set("tab", t);
    if (von) u.set("von", von);
    const s = u.toString();
    return `${base}${s ? `?${s}` : ""}`;
  };
  const title = d.product?.title ?? d.group.title ?? d.skus[0] ?? "Produkt";
  const own = d.ownRows.reduce((n, r) => n + r.quantity, 0);
  const fbaB = fbaBreakdown(d.fbaRows);
  const activeOffers = d.listings.filter((l) => l.status === "active").length;
  const ekMissing = d.ek.filter((e) => !e.effective).length;
  const ekConflict = d.ek.filter((e) => e.conflict).length;

  return (
    <>
      <div className="page-head">
        <div style={{ display: "flex", gap: 14, alignItems: "center", minWidth: 0 }}>
          {d.group.image && <img src={d.group.image} alt="" width={64} height={64} style={{ objectFit: "contain", borderRadius: 8, background: "var(--surface)", flex: "none" }} />}
          <div style={{ minWidth: 0 }}>
            <div className="crumb"><Link href={back} data-testid="product-back">{backLabel}</Link></div>
            <h1 style={{ overflowWrap: "anywhere" }}>{title}</h1>
            <div className="small muted num" style={{ marginTop: 4 }}>
              {[d.product?.asin ?? d.group.asin ? `ASIN ${d.product?.asin ?? d.group.asin}` : null, d.product?.ean ?? d.group.ean ? `EAN ${d.product?.ean ?? d.group.ean}` : null, `${d.skus.length} SKU${d.skus.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>
      </div>
      <div className="grid-kpi" data-testid="product-kpis">
        <div className="card card-pad"><div className="kpi-label">Eigenes Lager</div><div className="kpi-value" style={{ color: own < 0 ? "var(--danger)" : undefined }}>{own}</div></div>
        <div className="card card-pad" data-testid="kpi-fba">
          <div className="kpi-label" title={STOCK_TERMS.gesamt.hint}>Bei Amazon – {STOCK_TERMS.gesamt.label}</div>
          {d.fbaReport.missing ? (
            <>
              <div className="kpi-value muted" style={{ fontSize: 18 }}>unbekannt</div>
              <Link className="small" href="/import" style={{ color: "var(--warn)" }}>FBA-Bestandsbericht fehlt – importieren →</Link>
            </>
          ) : (
            <>
              <div className="kpi-value" data-testid="kpi-fba-total">{fbaB.gesamt}</div>
              <div className="small" data-testid="kpi-fba-breakdown">{breakdownText(fbaB)}</div>
              <div className="small" style={{ color: d.fbaReport.stale ? "var(--warn)" : "var(--muted)" }}>laut {d.fbaReport.source === "sellerboard" ? "sellerboard" : "Bestandsbericht"} vom {formatDate(d.fbaReport.snapshot)}{d.fbaReport.stale ? " – veraltet" : ""}</div>
            </>
          )}
        </div>
        <div className="card card-pad"><div className="kpi-label">Aktive Angebote</div><div className="kpi-value">{activeOffers}</div></div>
        <div className="card card-pad">
          <div className="kpi-label">EK</div>
          <div className="kpi-value">{d.ek.length === 1 && d.ek[0].effective ? formatEuro(d.ek[0].effective.cost) : ekMissing ? <span style={{ color: "var(--warn)", fontSize: 18 }}>fehlt</span> : `${d.ek.length} SKUs`}</div>
          {(ekMissing > 0 || ekConflict > 0) && <Link className="small" href={q("einkauf")} style={{ color: "var(--warn)" }}>{[ekMissing ? `${ekMissing} ohne EK` : null, ekConflict ? `${ekConflict} widersprüchlich` : null].filter(Boolean).join(" · ")} →</Link>}
        </div>
      </div>
      <nav className="prod-tabs" aria-label="Produkt" data-testid="product-tabs">
        {tabs.map((k) => (
          <Link key={k} href={q(k)} className={`chip${current === k ? " active" : ""}`} aria-current={current === k ? "page" : undefined}>{TABS[k]}</Link>
        ))}
      </nav>
      <div data-testid={`tab-${current}`}>
        {current === "stammdaten" && <Stammdaten d={d} />}
        {current === "einkauf" && <Einkauf d={d} highlight={highlight} canFix={!session.readOnly && (canAccess(session, "geld") || canAccess(session, "wawi"))} />}
        {current === "bestand" && <Bestand d={d} />}
        {current === "angebote" && <Angebote d={d} />}
        {current === "ergebnis" && <Ergebnis session={session} d={d} base={q("ergebnis")} zeitraum={zeitraum} />}
        {current === "belege" && <Belege d={d} />}
      </div>
    </>
  );
}

const SOURCE_ROLE: Record<string, string> = { produkt: "Charge", lager: "Lager-SKU", angebot: "Angebot", ebay: "eBay-Tool", artikel: "Artikelstamm", fba: "Amazon-Bestand", charge: "Charge" };

function Stammdaten({ d }: { d: ProductDetail & object }) {
  const p = d.product;
  const roles = new Map<string, Set<string>>();
  for (const c of d.cands) roles.set(c.sku, (roles.get(c.sku) ?? new Set()).add(SOURCE_ROLE[c.source] ?? c.source));
  const fields: [string, React.ReactNode][] = p
    ? [
        ["Titel", p.title ?? "–"],
        ["ASIN", p.asin ? <a href={`https://www.amazon.de/dp/${p.asin}`} target="_blank" rel="noreferrer">{p.asin} ↗</a> : "–"],
        ["EAN", p.ean ?? "–"],
        ["Gewicht", p.weightGrams ? `${p.weightGrams} g` : "–"],
        ["Maße", p.lengthCm ? `${p.lengthCm} × ${p.widthCm} × ${p.heightCm} cm` : "–"],
        ["FBA-Gebühr je Stück", p.fbaFee ? formatEuro(Number(p.fbaFee)) : "–"],
        ["Gefahrgut", p.isHazmat ? "ja" : "nein"],
      ]
    : [
        ["Titel", d.group.title ?? "–"],
        ["EAN", d.group.ean ?? "–"],
        ["Produkt (ASIN)", <span key="x" className="muted">Keinem Amazon-Produkt zugeordnet – eigene SKU (z. B. eBay-Ware).</span>],
      ];
  return (
    <div className="row" style={{ flexWrap: "wrap" }}>
      <section className="card card-pad" style={{ flex: "1 1 320px" }}>
        <h2 style={{ marginBottom: 10 }}>Stammdaten</h2>
        <dl className="facts">
          {fields.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        {d.articles.length > 0 && (
          <div className="small" style={{ marginTop: 10 }}>
            Artikelstamm: {d.articles.map((a) => <Link key={a.id} href={`/artikel/${a.id}`} style={{ marginRight: 8 }}>{a.title} ({a.status}) →</Link>)}
          </div>
        )}
      </section>
      <section className="card" style={{ flex: "1 1 360px", overflow: "auto" }}>
        <table className="table" data-testid="product-skus">
          <thead><tr><th>SKU</th><th>Kommt vor als</th></tr></thead>
          <tbody>
            {d.skus.map((s) => (
              <tr key={s}><td className="num small">{s}</td><td className="small">{[...(roles.get(s) ?? [])].join(", ") || <span className="muted">nur in Aufträgen</span>}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Einkauf({ d, highlight, canFix }: { d: ProductDetail & object; highlight?: string; canFix: boolean }) {
  const lotsWithoutCost = d.lots.filter((l) => l.unitCostNet === null);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card" style={{ overflow: "auto" }} id="ek">
        <div className="card-pad" style={{ paddingBottom: 0 }}>
          <h2>EK je SKU</h2>
          <p className="small muted" style={{ margin: "4px 0 0" }}>Gilt überall gleich – Produkt, Gewinn, Lagerwert, Nachbestellung, Repricer, Hebel und SAS-Deals: Charge → EK von Hand → Einkaufspreis aus dem eBay-Tool → bei Sets die Summe der Bestandteile → EK laut sellerboard → zuletzt der vom Mehrfachangebot geerbte EK. Platzhalter aus sellerboard (0,01 €) zählen nie. Abweichungen werden markiert, nicht überschrieben.</p>
        </div>
        <table className="table" data-testid="ek-table">
          <thead><tr><th>SKU</th><th>Quellen</th><th className="right">Gilt</th><th /></tr></thead>
          <tbody>
            {d.ek.map((e) => (
              <tr key={e.sku} data-testid="ek-row" style={e.sku === highlight ? { background: "var(--info-soft)" } : undefined}>
                <td className="num small">{e.sku}</td>
                <td className="small">
                  {e.sources.length ? (
                    e.sources.map((s, i) => (
                      <div key={i} data-testid="ek-source">
                        <span className={`tag ${s.ignored ? "tag-neutral" : s.inherited ? "tag-warn" : "tag-neutral"}`} style={{ marginRight: 4, ...(s.ignored ? { textDecoration: "line-through" } : {}) }} data-ignored={s.ignored ? "1" : undefined}>{s.label}{s.inherited ? " · geerbt" : ""} {formatEuro(s.cost)}</span>
                        {s.detail && <span className="muted">{s.detail}</span>}
                      </div>
                    ))
                  ) : (
                    <span className="muted">keine</span>
                  )}
                  {e.conflict && <span className="tag tag-warn" data-testid="ek-conflict">weicht ab ({formatEuro(e.spread)})</span>}
                </td>
                <td className="num right" data-testid="ek-effective">
                  {e.effective ? (
                    <>
                      {formatEuro(e.effective.cost)}
                      <div className="small muted" style={{ fontFamily: "inherit" }}>{COST_SOURCE_LABEL[e.effective.source]}{e.effective.inherited ? " (geerbt – bitte prüfen)" : ""}</div>
                    </>
                  ) : (
                    <span style={{ color: "var(--warn)" }}>fehlt</span>
                  )}
                </td>
                <td>
                  {canFix && !e.effective && !d.lots.some((l) => l.sku === e.sku) && <FixForm action={setSkuCostAction} hidden={{ sku: e.sku }} name="cost" label={`EK netto für ${e.sku}`} placeholder="EK netto €" testid="ek-fix" />}
                  {canFix && e.effective?.inherited && !e.conflict && !d.lots.some((l) => l.sku === e.sku && l.unitCostNet !== null) && <FixForm action={setSkuCostAction} hidden={{ sku: e.sku }} name="cost" label={`Eigenen EK für ${e.sku} eintragen (statt geerbt)`} placeholder="eigener EK €" testid="ek-fix-inherited" />}
                  {canFix && e.conflict && !d.lots.some((l) => l.sku === e.sku && l.unitCostNet !== null) && <FixForm action={setSkuCostAction} hidden={{ sku: e.sku }} name="cost" label={`Richtigen EK für ${e.sku} festlegen`} placeholder="richtiger EK €" testid="ek-fix" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card" style={{ overflow: "auto" }}>
        <div className="card-pad" style={{ paddingBottom: 0 }}><h2>Chargen</h2></div>
        <table className="table" data-testid="lot-table">
          <thead><tr><th>SKU</th><th>Art</th><th>Datum</th><th className="right">Menge</th><th className="right">EK netto</th><th>Lieferant</th><th /></tr></thead>
          <tbody>
            {d.lots.length === 0 && <tr><td colSpan={7} className="muted small">Keine Charge – Ware ohne Einkauf in der Wawi (z. B. eBay-Bestand). EK oben von Hand eintragen.</td></tr>}
            {d.lots.map((l) => (
              <tr key={l.id}>
                <td className="num small"><Link href={`/chargen/${l.id}`}>{l.sku}</Link></td>
                <td className="small">{LOT_KIND[l.kind]}</td>
                <td className="small">{formatDate(l.purchaseDate ?? l.returnDate)}{l.estimated ? " (geschätzt)" : ""}</td>
                <td className="num right">{l.quantity ?? "–"}</td>
                <td className="num right">{l.unitCostNet !== null ? formatEuro(Number(l.unitCostNet)) : canFix ? <FixForm action={setLotCostAction} hidden={{ lotId: l.id }} name="cost" label={`EK für Charge ${l.sku}`} placeholder="EK €" testid="lot-fix" /> : <span style={{ color: "var(--warn)" }}>fehlt</span>}</td>
                <td className="small">{l.supplier ?? <span className="muted">–</span>}</td>
                <td className="small muted">{l.unitCostSource ? LOT_COST_SOURCE[l.unitCostSource] ?? l.unitCostSource : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {lotsWithoutCost.length > 0 && <div className="small muted" style={{ padding: "8px 14px" }}>{lotsWithoutCost.length} Charge{lotsWithoutCost.length === 1 ? "" : "n"} ohne EK – fließen nicht in Gewinn und Lagerwert ein.</div>}
      </section>
      <section className="card" style={{ overflow: "auto" }}>
        <div className="card-pad" style={{ paddingBottom: 0 }}><h2>Bestellungen & Wareneingang</h2></div>
        <table className="table" data-testid="po-table">
          <thead><tr><th>Bestellung</th><th>Status</th><th>Datum</th><th className="right">Bestellt</th><th className="right">Eingegangen</th><th className="right">EK brutto</th><th>Lieferant</th></tr></thead>
          <tbody>
            {d.poItems.length === 0 && <tr><td colSpan={7} className="muted small">Keine Einkaufsbestellung zu diesem Produkt.</td></tr>}
            {d.poItems.map((p, i) => (
              <tr key={`${p.poId}-${i}`}>
                <td className="num small"><Link href={`/einkauf/${p.poId}`}>{p.number}</Link></td>
                <td className="small"><span className={`tag ${p.status === "received" ? "tag-ok" : p.status === "cancelled" ? "tag-neutral" : "tag-info"}`}>{PO_LABEL[p.status] ?? p.status}</span></td>
                <td className="small">{formatDate(p.orderDate)}</td>
                <td className="num right">{p.quantity}</td>
                <td className="num right" style={{ color: p.received < p.quantity && p.status !== "cancelled" ? "var(--warn)" : undefined }}>{p.received}</td>
                <td className="num right">{formatEuro(Number(p.unitCostGross))}</td>
                <td className="small">{p.supplier ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Bestand({ d }: { d: ProductDetail & object }) {
  const fbaB = fbaBreakdown(d.fbaRows);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card" style={{ overflow: "auto" }}>
        <table className="table" data-testid="stock-table">
          <thead>
            <tr><th rowSpan={2}>SKU</th><th colSpan={4} style={{ textAlign: "center" }}>Eigenes Lager</th><th colSpan={5} style={{ textAlign: "center" }}>Bei Amazon</th></tr>
            <tr>
              <th className="right">Bestand</th><th className="right" title="Durch offene Aufträge gebunden">Reserviert</th><th className="right">Frei</th><th>Lagerplatz</th>
              <th className="right" title={STOCK_TERMS.verkaufbar.hint}>Verkaufbar</th><th className="right" title={STOCK_TERMS.reserviert.hint}>Reserviert</th><th className="right" title={STOCK_TERMS.unterwegs.hint}>Unterwegs</th><th className="right" title={STOCK_TERMS.nichtVerkaufbar.hint}>Nicht verkaufbar</th><th className="right" title={STOCK_TERMS.gesamt.hint}>Gesamt</th>
            </tr>
          </thead>
          <tbody>
            {d.skus.map((s) => {
              const o = d.ownRows.find((r) => r.sku === s);
              const a = d.fbaRows.find((r) => r.sku === s);
              const lvl = d.levels.get(s);
              return (
                <tr key={s}>
                  <td className="num small">{s}</td>
                  <td className="num right" style={{ color: (o?.quantity ?? 0) < 0 ? "var(--danger)" : undefined }}>{o ? o.quantity : <span className="muted">–</span>}</td>
                  <td className="num right">{lvl?.reserved || ""}</td>
                  <td className="num right">{lvl ? availableOf(lvl) : ""}</td>
                  <td className="small">{o?.location ?? ""}</td>
                  <td className="num right" data-testid="stock-sellable">{d.fbaReport.missing ? <span className="muted" title="FBA-Bestand unbekannt">unbekannt</span> : a ? a.fulfillable : <span className="muted" title="laut Bestand nicht bei Amazon">0</span>}</td>
                  <td className="num right" data-testid="stock-reserved">{a ? a.reserved || "" : ""}</td>
                  <td className="num right">{a ? a.inboundWorking + a.inboundShipped + a.inboundReceiving || "" : ""}</td>
                  <td className="num right" style={{ color: a?.unsellable ? "var(--danger)" : undefined }}>{a?.unsellable || ""}</td>
                  <td className="num right" data-testid="stock-total">{a ? fbaBreakdown([a]).gesamt : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="small muted" style={{ padding: "8px 14px" }} data-testid="fba-stand">
          {d.fbaReport.missing ? (
            <>Amazon-Bestand unbekannt – weder FBA-Bestandsbericht noch sellerboard-Bestand vorhanden (<Link href="/import">Import</Link>).</>
          ) : (
            <>
              Amazon-Bestand laut {d.fbaReport.source === "sellerboard" ? "sellerboard" : "Bestandsbericht"} vom {formatDate(d.fbaReport.snapshot)}{d.fbaReport.stale ? " – veraltet, bitte neu abgleichen" : ""}. Gesamt = verkaufbar + reserviert + unterwegs + nicht verkaufbar.
              {fbaB.gesamt > fbaB.verkaufbar && <> Davon sofort verkaufbar: {fbaB.verkaufbar}; reserviert heißt bei Amazon gebunden (Kundenbestellung, Umlagerung, Prüfung).</>}
              {d.fbaReport.source === "sellerboard" && " Nicht verkaufbare Einheiten liefert nur der Amazon-Bestandsbericht."}
            </>
          )}
        </div>
      </section>
      {d.sets.length > 0 && (
        <section className="card card-pad small">
          <h2 style={{ marginBottom: 6 }}>Sets</h2>
          {d.sets.map((s) => <div key={s.sku}>{s.sku}: {s.components.map((c) => `${c.qty}× ${c.sku}`).join(" + ")}</div>)}
        </section>
      )}
      <section className="card" style={{ overflow: "auto" }}>
        <div className="card-pad" style={{ paddingBottom: 0 }}><h2>Letzte Buchungen</h2></div>
        <table className="table">
          <thead><tr><th>Zeit</th><th>SKU</th><th className="right">Menge</th><th>Grund</th><th>Bezug</th></tr></thead>
          <tbody>
            {d.movements.length === 0 && <tr><td colSpan={5} className="muted small">Noch keine Buchungen im eigenen Lager.</td></tr>}
            {d.movements.map((m) => (
              <tr key={m.id}><td className="small">{m.createdAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}</td><td className="num small">{m.sku}</td><td className="num right" style={{ color: m.delta < 0 ? "var(--danger)" : "var(--ok)" }}>{m.delta > 0 ? `+${m.delta}` : m.delta}</td><td className="small">{m.reason}</td><td className="small muted">{m.reference ?? ""}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="small"><Link href="/bestand">Bestand & Inventur öffnen →</Link></div>
    </div>
  );
}

function Angebote({ d }: { d: ProductDetail & object }) {
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card" style={{ overflow: "auto" }}>
        <div className="card-pad" style={{ paddingBottom: 0 }}><h2>Angebote in den Kanälen</h2></div>
        <table className="table" data-testid="offer-table">
          <thead><tr><th>Kanal</th><th>Kanal-SKU</th><th>Lager-SKU</th><th>Status</th><th className="right">Preis</th><th className="right" title="Was der Kanal laut Lager zeigen soll: verfügbar (Bestand − reserviert), ggf. begrenzt">Soll (Lager)</th><th className="right" title="Zuletzt an den Kanal gemeldete Menge">Zuletzt übertragen</th><th>Abgleich</th></tr></thead>
          <tbody>
            {d.listings.length === 0 && <tr><td colSpan={8} className="muted small">In keinem Kanal angeboten.</td></tr>}
            {d.listings.map((l) => {
              const lvl = d.levels.get(stockSkuOf(l));
              const want = l.stockSync && lvl ? targetQuantity(l, availableOf(lvl)) : null;
              const when = l.pushedAt ? l.pushedAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }) : null;
              const sync = !l.stockSync
                ? "aus – Menge von Hand"
                : l.status === "draft"
                  ? "Entwurf – noch nicht abgeglichen"
                  : l.status === "ended"
                    ? "beendet – kein Abgleich"
                    : !lvl
                      ? "Lager-SKU unbekannt – kein Abgleich"
                      : l.pushedQuantity === want
                        ? `abgeglichen${when ? ` ${when}` : ""}`
                        : `ausstehend (Soll ${want})`;
              return (
              <tr key={l.id} data-testid="offer-row">
                <td>{CHANNEL_LABEL[l.channel] ?? l.channel}</td>
                <td className="num small"><Link href={`/listings?sku=${encodeURIComponent(l.sku)}`}>{l.sku}</Link></td>
                <td className="num small">{l.stockSku || <span className="muted">gleich</span>}</td>
                <td><span className={`tag ${l.status === "active" ? "tag-ok" : l.status === "error" ? "tag-danger" : "tag-neutral"}`}>{STATUS_LABEL[l.status] ?? l.status}</span>{l.lastError && <div className="small" style={{ color: "var(--danger)" }}>{l.lastError}</div>}</td>
                <td className="num right">{l.price !== null ? formatEuro(l.price) : "–"}</td>
                <td className="num right" data-testid="offer-want">{want ?? "–"}{want !== null && l.maxQuantity ? <div className="small muted">max. {l.maxQuantity}</div> : null}</td>
                <td className="num right" data-testid="offer-pushed">{l.pushedQuantity ?? "–"}{when && <div className="small muted">{when}</div>}</td>
                <td className="small" data-testid="offer-sync">{sync}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      {d.ebayTool.length > 0 && (
        <section className="card" style={{ overflow: "auto" }}>
          <div className="card-pad" style={{ paddingBottom: 0 }}><h2>Im eBay-Tool</h2></div>
          <table className="table" data-testid="ebaytool-table">
            <thead><tr><th>eBay-Nr.</th><th>Status</th><th className="right">Preis</th><th className="right">Menge</th><th className="right">EK</th><th /></tr></thead>
            <tbody>
              {d.ebayTool.map((e) => (
                <tr key={e.id}>
                  <td className="num small">{e.listingId ?? "–"}</td>
                  <td><span className={`tag ${e.status === "published" ? "tag-ok" : "tag-neutral"}`}>{STATUS_LABEL[e.status] ?? e.status}</span></td>
                  <td className="num right">{formatEuro(e.price)}</td>
                  <td className="num right">{e.quantity}</td>
                  <td className="num right">{e.purchasePrice !== null ? formatEuro(e.purchasePrice) : "–"}</td>
                  <td className="right">{e.listingId && <Link className="btn btn-small" href={`/ebay/pruefen/${e.listingId}`}>Prüfen</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

async function Ergebnis({ session, d, base, zeitraum }: { session: Session; d: ProductDetail & object; base: string; zeitraum?: string }) {
  const r: Range = zeitraum && zeitraum in RANGES ? (zeitraum as Range) : "90";
  const [from, to] = rangeOf(r, todayIso());
  const t = session.tenantId;
  const settings = await getSettings(t);
  const costs = await skuCostMap(t);
  // Kanal-SKUs (z. B. eBay „LG-…“) gehören über die Lager-SKU zum Produkt.
  const skuSet = new Set([...d.skus, ...d.listings.map((l) => l.sku)]);
  const [{ skus }, lines] = await Promise.all([amazonProfit(t, from, to, settings.vatRate, costs), orderLines(t, from, to)]);
  const az = skus.filter((s) => skuSet.has(s.sku));
  const mine = lines.filter((l) => l.sku && skuSet.has(l.sku));
  const amazon = az.length ? summarizeAmazon(az.map((s) => ({ sku: s.sku, units: s.units, revenueNet: s.revenueNet, costsExCogs: s.fees + s.promotions / (1 + settings.vatRate) + s.reimbursements + s.other, cogs: s.cogs })), 0) : null;
  const channels = summarizeChannels(mine, costs, settings.vatRate);
  const tot = totalsOf(amazon, channels);
  const units = az.reduce((n, s) => n + s.units, 0) + mine.reduce((n, l) => n + l.qty, 0);
  const period = `${formatDate(from)} – ${formatDate(to)}`;
  const missing = [
    tot.missing.costSkus ? `EK für ${tot.missing.costSkus} SKU${tot.missing.costSkus === 1 ? "" : "s"}` : null,
    tot.missing.feeOrders ? `Gebühren für ${tot.missing.feeOrders} Bestellung${tot.missing.feeOrders === 1 ? "" : "en"}` : null,
    tot.missing.priceLines ? `Preis für ${tot.missing.priceLines} Position${tot.missing.priceLines === 1 ? "" : "en"}` : null,
  ].filter((x): x is string => Boolean(x));
  const sep = base.includes("?") ? "&" : "?";
  const state = units === 0 ? "fehlt" : tot.complete ? "ok" : "unvollstaendig";
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(Object.keys(RANGES) as Range[]).map((k) => <Link key={k} href={`${base}${sep}zeitraum=${k}`} className={`chip${r === k ? " active" : ""}`}>{RANGES[k]}</Link>)}
      </div>
      {units === 0 ? (
        <div className="notice notice-info" data-testid="result-empty">Keine Verkäufe dieses Produkts im Zeitraum {period}. (Amazon zählt erst mit der Abrechnung.)</div>
      ) : (
        <div className="grid-kpi">
          <Kpi label="Umsatz netto" value={formatEuro(tot.revenueNet)} note={`${units} Stück verkauft`} period={period} source="Amazon-Abrechnung, Aufträge" testid="result-revenue" />
          <Kpi label="Vorläufiges Ergebnis" value={formatEuro(tot.provisional)} state={state} note="nur bekannte Kosten" missing={missing} fixHref={missing.length ? `${base.split("?")[0]}?tab=einkauf` : undefined} period={period} testid="result-provisional" />
          <Kpi label="Gewinn aus vollständig erfassten Verkäufen" value={tot.completeRevenueNet > 0 || tot.complete ? formatEuro(tot.completeProfit) : "nicht berechenbar"} state={tot.complete ? "ok" : tot.coverage > 0 ? "unvollstaendig" : "fehlt"} note={tot.completeRevenueNet > 0 || tot.complete ? `umfasst ${tot.coverage} % des Umsatzes (${formatEuro(tot.completeRevenueNet)}) – nur Verkäufe mit Preis, EK und Gebühren` : "kein Verkauf mit Preis, EK und Gebühren – erst nach dem Nachtragen berechenbar"} period={period} testid="result-complete" />
          <div className="card card-pad"><div className="kpi-label">Kanäle</div><div className="small" style={{ marginTop: 8 }}>{[az.length ? `Amazon ${az.reduce((n, s) => n + s.units, 0)}` : null, ...channels.map((c) => `${CHANNEL_LABEL[c.channel] ?? c.channel} ${mine.filter((l) => l.channel === c.channel).reduce((n, l) => n + l.qty, 0)}`)].filter(Boolean).join(" · ")}</div></div>
        </div>
      )}
    </div>
  );
}

function Belege({ d }: { d: ProductDetail & object }) {
  return (
    <section className="card" style={{ overflow: "auto" }}>
      <table className="table" data-testid="doc-table">
        <thead><tr><th>Datum</th><th>Nummer</th><th>Von</th><th>Art</th><th>Status</th><th className="right">Betrag</th></tr></thead>
        <tbody>
          {d.invoices.length === 0 && <tr><td colSpan={6} className="muted small">Keine Rechnung mit den Chargen oder Bestellungen dieses Produkts verknüpft. Verknüpfen unter „Eingangsrechnungen“.</td></tr>}
          {d.invoices.map((i) => (
            <tr key={i.id}>
              <td className="small">{formatDate(i.date)}</td>
              <td className="num small"><Link href={`/rechnungen/${i.id}`}>{i.number ?? "ohne Nummer"}</Link></td>
              <td className="small">{i.supplier ?? "–"}</td>
              <td className="small">{i.kind}</td>
              <td className="small">{i.status}</td>
              <td className="num right">{i.total !== null ? formatEuro(i.total) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
