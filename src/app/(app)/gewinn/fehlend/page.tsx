import Link from "next/link";
import { and, eq, gte, inArray, isNull, lte, ne, notInArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { CHANNEL_LABEL } from "@/lib/labels";
import { skuCostMap } from "@/lib/money/costs";
import { amazonProfit } from "@/lib/money/profit";
import { FEE_FREE_CHANNELS } from "@/lib/money/profit-logic";
import { RANGES, rangeOf, type Range } from "@/lib/money/ranges";
import { formatDate, formatEuro } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { setLinePriceAction, setLotCostAction, setOrderFeeAction, setSkuCostAction } from "../actions";
import { FixForm } from "../fix-form";

type Missing = { sku: string; title: string | null; channels: Set<string>; units: number; revenueNet: number };

/** Korrekturliste: alles, was der Gewinnrechnung im Zeitraum fehlt – direkt nachtragen. */
export default async function FehlendPage({ searchParams }: { searchParams: Promise<{ zeitraum?: string }> }) {
  const session = await requireArea("geld");
  const sp = await searchParams;
  const r: Range = sp.zeitraum && sp.zeitraum in RANGES ? (sp.zeitraum as Range) : "30";
  const [from, to] = rangeOf(r, todayIso());
  const t = session.tenantId;
  const settings = await getSettings(t);
  const costs = await skuCostMap(t);
  const O = schema.orders;
  const I = schema.orderItems;
  const inRange = and(eq(O.tenantId, t), ne(O.channel, "amazon"), ne(O.status, "cancelled"), gte(O.orderDate, new Date(`${from}T00:00:00Z`)), lte(O.orderDate, new Date(`${to}T23:59:59Z`)));
  const [{ skus }, lines, feeOrders] = await Promise.all([
    amazonProfit(t, from, to, settings.vatRate, costs),
    db.select({ itemId: I.id, orderId: O.id, ext: O.externalId, channel: O.channel, date: O.orderDate, sku: I.sku, title: I.title, qty: I.quantity, price: I.price }).from(O).innerJoin(I, eq(I.orderId, O.id)).where(inRange),
    db
      .select({ id: O.id, ext: O.externalId, channel: O.channel, date: O.orderDate, total: O.total })
      .from(O)
      .where(and(inRange, isNull(O.fees), notInArray(O.channel, [...FEE_FREE_CHANNELS] as ("temu" | "manual")[])))
      .orderBy(O.orderDate),
  ]);

  const missing = new Map<string, Missing>();
  const add = (sku: string, title: string | null, channel: string, units: number, revenueNet: number) => {
    const m = missing.get(sku) ?? { sku, title, channels: new Set<string>(), units: 0, revenueNet: 0 };
    m.channels.add(channel);
    m.units += units;
    m.revenueNet += revenueNet;
    m.title ??= title;
    missing.set(sku, m);
  };
  for (const s of skus) if (s.cogs === null && s.units > 0) add(s.sku, s.title, "amazon", s.units, s.revenueNet);
  for (const l of lines) if (l.sku && !costs.has(l.sku)) add(l.sku, l.title, l.channel, l.qty, ((l.price ?? 0) * l.qty) / (1 + settings.vatRate));
  const noSku = lines.filter((l) => !l.sku);
  const noPrice = lines.filter((l) => l.price === null);
  const list = [...missing.values()].sort((a, b) => b.revenueNet - a.revenueNet);
  const skuList = list.map((m) => m.sku);
  const [lots, attempts] = skuList.length
    ? await Promise.all([
        db.select({ id: schema.lots.id, sku: schema.lots.sku }).from(schema.lots).where(and(eq(schema.lots.tenantId, t), inArray(schema.lots.sku, skuList))),
        db.select({ id: schema.ebayListings.id, sku: schema.ebayListings.sku }).from(schema.ebayListings).where(and(eq(schema.ebayListings.tenantId, t), inArray(schema.ebayListings.sku, skuList))),
      ])
    : [[], []];
  const lotBy = new Map(lots.map((l) => [l.sku, l.id]));
  const attemptBy = new Map(attempts.map((a) => [a.sku!, a.id]));
  const total = list.length + noSku.length + feeOrders.length + noPrice.length;

  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href={`/gewinn?zeitraum=${r}`}>Finanzen · Gewinn</Link></div><h1>Fehlende Werte nachtragen</h1><div className="small muted" style={{ marginTop: 4 }}>{formatDate(from)} – {formatDate(to)}</div></div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(Object.keys(RANGES) as Range[]).map((k) => <Link key={k} href={`/gewinn/fehlend?zeitraum=${k}`} className={`chip${r === k ? " active" : ""}`}>{RANGES[k]}</Link>)}
        </div>
      </div>
      {total === 0 && <div className="notice notice-info" data-testid="nothing-missing">Für diesen Zeitraum fehlt nichts – der Gewinn ist vollständig berechnet.</div>}

      <section className="card stack" id="ek" data-testid="missing-cost">
        <div className="card-head"><h2>EK fehlt ({list.length})</h2></div>
        <div className="card-pad small muted" style={{ paddingTop: 0 }}>Netto-EK je Stück. Gibt es eine Charge, wird der EK dort gespeichert; sonst als „EK je SKU“ (gilt auch für den Lagerwert). Angebote aus dem eBay-Tool lassen sich auch dort pflegen.</div>
        {list.length === 0 ? <div className="card-pad small muted">Keine Positionen ohne EK.</div> : (
          <div className="fix-list">
            {list.map((m) => (
              <div key={m.sku} className="fix-row" data-testid="missing-cost-row">
                <div style={{ minWidth: 0 }}>
                  <div className="num" style={{ fontWeight: 600, overflowWrap: "anywhere" }}><Link href={`/produkte?q=${encodeURIComponent(m.sku)}`}>{m.sku}</Link></div>
                  <div className="small muted" style={{ overflowWrap: "anywhere" }}>{m.title ?? "ohne Titel"}</div>
                  <div className="small">{[...m.channels].map((c) => CHANNEL_LABEL[c] ?? c).join(", ")} · {m.units} Stk · Umsatz netto {formatEuro(m.revenueNet)}</div>
                  {attemptBy.has(m.sku) && <Link className="small" href={`/ebay?ansicht=vorschau&id=${attemptBy.get(m.sku)}`}>im eBay-Tool öffnen</Link>}
                </div>
                {lotBy.has(m.sku)
                  ? <FixForm action={setLotCostAction} hidden={{ lotId: lotBy.get(m.sku)! }} name="cost" label="EK netto je Stück (Charge)" placeholder="EK netto" testid="fix-lot" />
                  : <FixForm action={setSkuCostAction} hidden={{ sku: m.sku }} name="cost" label="EK netto je Stück" placeholder="EK netto" testid="fix-sku" />}
              </div>
            ))}
          </div>
        )}
        {noSku.length > 0 && <div className="card-pad small" style={{ color: "var(--warn)" }}>{noSku.length} Position(en) ohne SKU – EK nicht zuordenbar; bitte im Auftrag bzw. beim Kanal eine SKU vergeben.</div>}
      </section>

      <section className="card stack" id="gebuehren" data-testid="missing-fee">
        <div className="card-head"><h2>Gebühren fehlen ({feeOrders.length})</h2></div>
        <div className="card-pad small muted" style={{ paddingTop: 0 }}>eBay liefert die Gebühren ab jetzt beim Abruf mit; ältere Bestellungen hier aus dem Seller Hub (Bestellung → Gebühren) nachtragen. Temu und manuelle Verkäufe haben keine eigene Gebühr.</div>
        {feeOrders.length === 0 ? <div className="card-pad small muted">Keine Bestellungen ohne Gebühren.</div> : (
          <div className="fix-list">
            {feeOrders.map((o) => (
              <div key={o.id} className="fix-row" data-testid="missing-fee-row">
                <div><div className="num" style={{ fontWeight: 600 }}><Link href={`/auftraege/${o.id}`}>{o.ext}</Link></div><div className="small muted">{CHANNEL_LABEL[o.channel] ?? o.channel} · {formatDate(o.date.toISOString().slice(0, 10))} · {formatEuro(o.total)}</div></div>
                <FixForm action={setOrderFeeAction} hidden={{ orderId: o.id }} name="fee" label="Gebühren der Bestellung" placeholder="Gebühr €" testid="fix-fee" />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card stack" id="preis" data-testid="missing-price">
        <div className="card-head"><h2>Preis fehlt ({noPrice.length})</h2></div>
        <div className="card-pad small muted" style={{ paddingTop: 0 }}>Positionen ohne Verkaufspreis (z. B. Temu liefert ihn im Auftrag nicht) – Bruttopreis je Stück bzw. bei Temu den Basispreis eintragen.</div>
        {noPrice.length === 0 ? <div className="card-pad small muted">Keine Positionen ohne Preis.</div> : (
          <div className="fix-list">
            {noPrice.map((l) => (
              <div key={l.itemId} className="fix-row" data-testid="missing-price-row">
                <div style={{ minWidth: 0 }}><div className="num" style={{ fontWeight: 600 }}><Link href={`/auftraege/${l.orderId}`}>{l.ext}</Link> · {l.sku ?? "ohne SKU"}</div><div className="small muted" style={{ overflowWrap: "anywhere" }}>{CHANNEL_LABEL[l.channel] ?? l.channel} · {l.qty} Stk · {l.title ?? ""}</div></div>
                <FixForm action={setLinePriceAction} hidden={{ itemId: l.itemId }} name="price" label="Preis je Stück (brutto)" placeholder="Preis €" testid="fix-price" />
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
