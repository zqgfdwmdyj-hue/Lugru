import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { CHANNEL_LABEL } from "@/lib/labels";
import { Kpi } from "@/components/kpi";
import { skuCostMap } from "@/lib/money/costs";
import { amazonProfit, dataStand, orderLines } from "@/lib/money/profit";
import { amazonQuelle, FEE_FREE_CHANNELS, gewinnBasis, mitAmazonErsatz, summarizeAmazon, summarizeChannels, totalsOf, ueberleitung } from "@/lib/money/profit-logic";
import { formatDate, formatEuro } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { RANGES, rangeOf, type Range } from "@/lib/money/ranges";
import { and, desc, eq } from "drizzle-orm";
import { sellerboardRange } from "@/lib/sellerboard/sales";
import { db, schema } from "@/db";

const dt = (d: Date | null | undefined) => (d ? d.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" }) : "–");
/** Kosten als positive Zahl zeigen, ohne „−0,00 €“. */
const neg = (n: number) => (n === 0 ? 0 : -n);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function GewinnPage({ searchParams }: { searchParams: Promise<{ zeitraum?: string; sort?: string }> }) {
  const session = await requireArea("geld");
  const sp = await searchParams;
  // B19.3: Standard „Dieser Monat“ (ab dem 1.) – wie die Kennzahlen auf der Startseite.
  const r: Range = sp.zeitraum && sp.zeitraum in RANGES ? (sp.zeitraum as Range) : "monat";
  const [from, to] = rangeOf(r, todayIso());
  const t = session.tenantId;
  const settings = await getSettings(t);
  const costs = await skuCostMap(t);
  const [{ skus, nonSku, transfers }, lines, stand, sbAmazon, sbEbay] = await Promise.all([amazonProfit(t, from, to, settings.vatRate, costs), orderLines(t, from, to), dataStand(t), sellerboardRange(t, from, to, "amazon"), sellerboardRange(t, from, to, "ebay")]);

  const nonSkuTotal = nonSku.reduce((n, x) => n + x.amount, 0);
  const amazon = skus.length || nonSku.length
    ? summarizeAmazon(
        skus.map((s) => ({ sku: s.sku, units: s.units, revenueNet: s.revenueNet, costsExCogs: s.costsExCogs, cogs: s.cogs })),
        nonSkuTotal,
      )
    : null;
  const channels = summarizeChannels(lines, costs, settings.vatRate);
  const tot = totalsOf(amazon, channels);
  // B15.4: Quelle je Zeile – Amazon aus der Abrechnung, solange sie den Zeitraum abdeckt, sonst sellerboard.
  const aq = amazonQuelle({ abrechnungBis: stand.settlement, bis: to, hatAbrechnung: Boolean(amazon), sb: sbAmazon });
  const ersatz = aq.art === "sellerboard" && sbAmazon ? mitAmazonErsatz(tot, amazon, sbAmazon, settings.vatRate) : null;
  // B19.3: eine Basis für Kopf, Überleitung und Gewinnwerte (nicht mehr Kopf aus sellerboard, Tabelle aus der Abrechnung).
  const basis = gewinnBasis(tot, amazon, ersatz, Boolean(sbAmazon?.complete && !sbAmazon.missingCost));
  const kanalQuelle = (c: string) => `Aufträge (${CHANNEL_LABEL[c] ?? c}, Stand ${dt(stand.orders.get(c))})`;
  const fees = skus.reduce((n, s) => n + s.fees, 0);
  const cogs = skus.reduce((n, s) => n + (s.cogs ?? 0), 0) + channels.reduce((n, c) => n + c.cogsKnown, 0);
  const period = `${formatDate(from)} – ${formatDate(to)}`;
  const standText = [stand.settlement ? `Amazon-Abrechnung bis ${formatDate(stand.settlement)}` : "keine Amazon-Abrechnung", ...channels.map((c) => `${CHANNEL_LABEL[c.channel] ?? c.channel} ${dt(stand.orders.get(c.channel))}`)].join(" · ");
  const missing = [
    tot.missing.costSkus ? `EK für ${plural(tot.missing.costSkus, "SKU", "SKUs")}` : null,
    tot.missing.feeOrders ? `Gebühren für ${plural(tot.missing.feeOrders, "Bestellung", "Bestellungen")}` : null,
    tot.missing.priceLines ? `Preis für ${plural(tot.missing.priceLines, "Position", "Positionen")}` : null,
  ].filter((x): x is string => Boolean(x));
  const fix = `/gewinn/fehlend?zeitraum=${r}`;
  const sorted = [...skus].sort((a, b) => (sp.sort === "gut" ? (b.profit ?? -1e9) - (a.profit ?? -1e9) : (a.profit ?? 1e9) - (b.profit ?? 1e9)));
  const noData = !amazon && !channels.length && !ersatz;
  // Vergleich mit sellerboard: Monatswerte (12 Monate) und – bei einem Kalendermonat – Gewinn je SKU.
  const sbMonths = await db.select().from(schema.sellerboardMonths).where(eq(schema.sellerboardMonths.tenantId, t)).orderBy(desc(schema.sellerboardMonths.month)).limit(12);
  const calMonth = r === "monat" || r === "vormonat" ? from.slice(0, 7) : null;
  const sbSku = calMonth
    ? new Map((await db.select().from(schema.sellerboardSkuMonths).where(and(eq(schema.sellerboardSkuMonths.tenantId, t), eq(schema.sellerboardSkuMonths.month, calMonth)))).map((x) => [x.sku, x]))
    : null;
  const sbThis = calMonth ? sbMonths.find((m) => m.month === calMonth) ?? null : null;
  // Überleitung zur Startseite (sellerboard) je Kanal – aus denselben Zahlen wie der Kopf (B19.3).
  const sbR = await sellerboardRange(t, from, to);
  const bridge = ueberleitung({
    vatRate: settings.vatRate,
    sbAmazon,
    sbEbay,
    amazon: ersatz ? { revenueNet: ersatz.amazonRevenueNet, ergebnis: ersatz.amazonResult, aus: "sellerboard", text: aq.text } : amazon ? { revenueNet: amazon.revenueNet, ergebnis: amazon.provisional, aus: "abrechnung", text: aq.text } : null,
    kanaele: channels.map((c) => ({ channel: c.channel, label: CHANNEL_LABEL[c.channel] ?? c.channel, revenueNet: c.revenueNet, provisional: c.provisional })),
  });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Finanzen</div>
          <h1>Gewinn aus Abrechnungen und Aufträgen</h1>
          <div className="small muted" style={{ marginTop: 4 }} data-testid="profit-scope">
            {period} · Quelle je Zeile (Tabelle „Je Kanal“): Amazon-Abrechnung, solange sie den Zeitraum abdeckt, sonst sellerboard; andere Kanäle aus den Aufträgen · Umsatz <strong>netto</strong> (ohne USt.) · EK: gültiger EK aus dem Seller-System · <Link href="#ueberleitung">Vergleich mit sellerboard (Startseite)</Link>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(Object.keys(RANGES) as Range[]).map((k) => <Link key={k} href={`/gewinn?zeitraum=${k}`} className={`chip${r === k ? " active" : ""}`} aria-current={r === k ? "true" : undefined}>{RANGES[k]}</Link>)}
        </div>
      </div>

      {noData && <div className="notice notice-warn">Keine Abrechnungen und keine Aufträge in diesem Zeitraum. Amazon: Settlement-Reports unter „Daten importieren“; eBay/Temu kommen über die Anbindungen.</div>}
      {!noData && !tot.complete && (
        <div className="notice notice-warn" data-testid="profit-incomplete">
          <strong>Unvollständige Daten:</strong> {missing.join(", ")} fehlen. Der „vorläufige“ Wert enthält nur bekannte Kosten; der Gewinn aus vollständig erfassten Verkäufen umfasst nur {basis.coverage} % des Umsatzes (gleiche Zahl wie in der Kachel).{" "}
          <Link href={fix}>Fehlende Werte nachtragen →</Link>
        </div>
      )}

      <div className="grid-kpi">
        <Kpi testid="kpi-revenue" label="Umsatz netto (alle Kanäle)" value={formatEuro(basis.revenueNet)} note={ersatz ? "Amazon laut sellerboard (Abrechnung fehlt noch)" : undefined} state={tot.missing.priceLines ? "unvollstaendig" : "ok"} missing={tot.missing.priceLines ? [`Preis für ${plural(tot.missing.priceLines, "Position", "Positionen")}`] : undefined} fixHref={`${fix}#preis`} period={period} source="Amazon-Abrechnungen, Aufträge" stand={stand.settlement ? formatDate(stand.settlement) : undefined} />
        <Kpi
          testid="kpi-provisional"
          label="Vorläufiges Ergebnis"
          value={formatEuro(basis.provisional)}
          danger={basis.provisional < 0}
          state={tot.complete ? "ok" : "unvollstaendig"}
          note={ersatz ? `Amazon: Nettogewinn laut sellerboard (${aq.text}; mit Erstattungen, Werbung, Fixkosten aus sellerboard); übrige Kanäle: Umsatz minus bekannte Kosten (ohne Fixkosten)` : "Umsatz minus bekannte Kosten aus der Amazon-Abrechnung und den Aufträgen (mit Erstattungen, ohne Fixkosten)"}
          missing={missing}
          fixHref={fix}
          period={period}
        />
        <Kpi
          testid="kpi-profit"
          label="Gewinn aus vollständig erfassten Verkäufen"
          value={basis.completeRevenueNet > 0 || tot.complete ? formatEuro(basis.completeProfit) : "nicht berechenbar"}
          danger={basis.completeProfit < 0}
          state={basis.coverage >= 100 ? "ok" : basis.coverage > 0 ? "unvollstaendig" : "fehlt"}
          note={`${basis.coverage >= 100 ? `Marge ${basis.revenueNet ? `${((basis.completeProfit / basis.revenueNet) * 100).toFixed(1).replace(".", ",")} %` : "–"}` : basis.completeRevenueNet > 0 ? `umfasst ${basis.coverage} % des Umsatzes (${formatEuro(basis.completeRevenueNet)})` : "kein Verkauf mit Preis, EK und Gebühren – erst nach dem Nachtragen berechenbar"}${ersatz ? " · Amazon: sellerboard-Gewinn, übrige Kanäle: nur Positionen mit Preis, EK und Gebühr" : " · nur Positionen mit Preis, EK und Gebühr"}`}
          period={period}
        />
        <Kpi testid="kpi-costs" label="Bekannte Kosten" value={formatEuro(neg(fees) + cogs + neg(nonSkuTotal) + channels.reduce((n, c) => n + c.feesKnown, 0))} note={`${ersatz ? `Amazon nur bis zur Abrechnung (${stand.settlement ? formatDate(stand.settlement) : "–"}), danach im sellerboard-Gewinn enthalten · ` : ""}Amazon-Gebühren ${formatEuro(neg(fees))} · Wareneinsatz ${formatEuro(cogs)} · Kanalgebühren ${formatEuro(channels.reduce((n, c) => n + c.feesKnown, 0))} · sonstige ${formatEuro(neg(nonSkuTotal))}`} period={period} />
      </div>
      <details className="small muted">
        <summary style={{ cursor: "pointer" }}>Datenstand und Rechenweg</summary>
        <div className="stack" style={{ gap: 4, marginTop: 6 }}>
          <div>Stand: {standText}</div>
          <div>Umsatz netto = Brutto ÷ (1 + {Math.round(settings.vatRate * 100)} % MwSt). EK in dieser Reihenfolge (wie auf der Produktseite, mit Herkunft): Charge → „EK je SKU“ (von Hand) → Einkaufspreis aus dem eBay-Tool (Variante/Einzelangebot) → bei Sets die Summe der Bestandteile → EK laut sellerboard → zuletzt der vom Mehrfachangebot geerbte EK (als „geerbt“ markiert); 0,01-€-Platzhalter aus sellerboard zählen nie. Erstattete Einheiten gelten als zurück im Bestand.</div>
          <div>Gebühren: Amazon aus der Abrechnung, eBay je Bestellung von eBay (ältere Bestellungen ohne Angabe → „fehlt“), Temu ohne eigene Gebühr (Basispreis), Manuell ohne Gebühr. Fehlende Werte zählen nie als 0 €.</div>
          <div>„Vorläufig“ = Umsatz − bekannte Kosten. „Gewinn aus vollständig erfassten Verkäufen“ = nur Positionen, bei denen Preis, EK und Gebühr bekannt sind – plus Amazon-Kosten ohne SKU. Gibt es keine solche Position, steht dort „nicht berechenbar“ statt 0 €.</div>
        </div>
      </details>


      <section className="card card-pad small" data-testid="profit-werte">
        <h2 style={{ marginTop: 0 }}>Welche Gewinnzahl ist welche? ({period})</h2>
        <table className="table small">
          <thead><tr><th>Wert</th><th className="right">Betrag</th><th>Quelle und was drin ist</th></tr></thead>
          <tbody>
            <tr data-testid="wert-vorlaeufig"><td>Vorläufiges Ergebnis (Kachel oben)</td><td className="num right">{formatEuro(basis.provisional)}</td><td>{ersatz ? <>Amazon: <strong>Nettogewinn laut sellerboard</strong> ({aq.text}) – mit Erstattungen, Werbung und Fixkosten aus sellerboard; übrige Kanäle aus den Aufträgen: Umsatz − bekannte Gebühren − EK, ohne Fixkosten.</> : <>Amazon-Abrechnung + Aufträge: Umsatz − bekannte Kosten; Erstattungen abgezogen, ohne Fixkosten und ohne Werbung außerhalb der Abrechnung.</>}</td></tr>
            <tr data-testid="wert-vollstaendig"><td>Gewinn aus vollständig erfassten Verkäufen (Kachel oben)</td><td className="num right">{basis.completeRevenueNet > 0 || tot.complete ? formatEuro(basis.completeProfit) : "nicht berechenbar"}</td><td>Wie „vorläufig“, aber nur Verkäufe mit Preis, EK und Gebühr ({basis.coverage} % des Umsatzes){ersatz ? "; Amazon als sellerboard-Gewinn" : ""}.</td></tr>
            {sbR && <tr data-testid="wert-sb-netto"><td>sellerboard Nettogewinn (Startseite)</td><td className="num right">{formatEuro(sbR.netProfit)}</td><td>sellerboard-Dashboard ({sbR.channels.map((c) => (c === "ebay" ? "eBay" : "Amazon")).join(" + ")}) – mit Erstattungen, Werbung und Fixkosten; EK aus sellerboard{sbR.ebayOwnCost ? " (eBay: EK aus dem Seller-System)" : ""}.</td></tr>}
            {sbR && <tr data-testid="wert-sb-db"><td>sellerboard Deckungsbeitrag</td><td className="num right">{formatEuro(sbR.grossProfit)}</td><td>wie sellerboard Nettogewinn, aber <strong>ohne Fixkosten</strong>.</td></tr>}
            {sbThis && <tr data-testid="wert-sb-monat"><td>sellerboard Monatswert (Tabelle unten)</td><td className="num right">{formatEuro(sbThis.netProfit)}</td><td>Nettogewinn laut sellerboard-Monatsabgleich (Stand {sbThis.syncedAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}) – zu einem anderen Zeitpunkt abgerufen als die Startseite, daher kleine Abweichungen möglich.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="card" id="ueberleitung" data-testid="profit-bridge" style={{ overflow: "auto" }}>
        <div className="card-head"><h2>Überleitung je Kanal: sellerboard (Startseite) ↔ diese Seite</h2></div>
        {!sbR ? (
          <div className="card-pad small muted" style={{ paddingTop: 0 }} data-testid="profit-bridge-none">
            Für {period} liegen keine sellerboard-Werte vor (gespeichert sind die letzten 30 Tage, dieser und letzter Monat). Vergleich bei „Dieser Monat“, „Letzte 30 Tage“ oder „Letzter Monat“.
          </div>
        ) : (
          <>
            <div className="card-pad small muted" style={{ paddingTop: 0 }}>
              Gleicher Zeitraum ({period}{sbR.complete ? "" : ` – sellerboard nur ${sbR.daysCovered} von ${sbR.daysWanted} Tagen`}), dieselben Zahlen wie oben. Umsatz netto = sellerboard brutto ÷ {(1 + settings.vatRate).toLocaleString("de-DE")}.
            </div>
            <table className="table">
              <thead><tr><th>Kanal</th><th className="right">sellerboard netto</th><th className="right">diese Seite netto</th><th className="right">Abweichung</th><th className="right">sellerboard Gewinn</th><th className="right">diese Seite Ergebnis</th><th>Warum</th></tr></thead>
              <tbody>
                {bridge.zeilen.map((z) => (
                  <tr key={z.kanal} data-testid={`bridge-${z.kanal.toLowerCase()}`}>
                    <td>{z.kanal}</td>
                    <td className="num right">{z.sbNetto === null ? <span className="muted">–</span> : formatEuro(z.sbNetto)}</td>
                    <td className="num right">{z.sysNetto === null ? <span className="muted">–</span> : formatEuro(z.sysNetto)}</td>
                    <td className="num right" style={{ color: z.diffNetto && Math.abs(z.diffNetto) >= 1 ? "var(--warn)" : undefined }}>{z.diffNetto === null ? "–" : formatEuro(z.diffNetto)}</td>
                    <td className="num right">{z.sbGewinn === null ? <span className="muted">–</span> : formatEuro(z.sbGewinn)}</td>
                    <td className="num right">{z.sysErgebnis === null ? <span className="muted">–</span> : formatEuro(z.sysErgebnis)}</td>
                    <td className="small muted">{z.hinweis}</td>
                  </tr>
                ))}
                <tr data-testid="bridge-summe" style={{ fontWeight: 600 }}>
                  <td>Summe</td>
                  <td className="num right" data-testid="bridge-sales">{formatEuro(bridge.summe.sbNetto)}</td>
                  <td className="num right" data-testid="bridge-sys-sales">{formatEuro(bridge.summe.sysNetto)}</td>
                  <td className="num right" data-testid="bridge-diff">{formatEuro(bridge.summe.diffNetto)}</td>
                  <td className="num right" data-testid="bridge-profit">{formatEuro(bridge.summe.sbGewinn)}</td>
                  <td className="num right" data-testid="bridge-sys-profit">{formatEuro(bridge.summe.sysErgebnis)}</td>
                  <td className="small muted">Summe „diese Seite“ = Kacheln oben (Umsatz netto, vorläufiges Ergebnis)</td>
                </tr>
              </tbody>
            </table>
            <div className="card-pad small muted">
              Abweichungen entstehen nur, wo die Quelle verschieden ist: Amazon, solange die Abrechnung den Zeitraum nicht abdeckt (dann gilt oben ohnehin sellerboard), eBay (sellerboard-Dashboard ↔ eBay-Aufträge), Kanäle, die sellerboard nicht kennt (Temu, Manuell), und Auslandsverkäufe mit anderer USt.
            </div>
          </>
        )}
      </section>

      <section className="card" style={{ overflow: "auto" }} data-testid="channels">
        <div className="card-head"><h2>Je Kanal</h2></div>
        <table className="table">
          <thead><tr><th>Kanal</th><th>Quelle</th><th className="right">Umsatz netto</th><th className="right">EK (bekannt)</th><th className="right">Gebühren (bekannt)</th><th className="right">Vorläufig</th><th className="right">Vollständig</th><th>Fehlt</th></tr></thead>
          <tbody>
            {ersatz && sbAmazon && (
              <tr data-testid="channel-amazon" data-quelle="sellerboard">
                <td>Amazon</td>
                <td className="small" data-testid="channel-amazon-quelle">{aq.text}{!sbAmazon.complete ? ` (nur ${sbAmazon.daysCovered} von ${sbAmazon.daysWanted} Tagen)` : ""}</td>
                <td className="num right" title={`sellerboard ${formatEuro(sbAmazon.sales)} brutto ÷ ${(1 + settings.vatRate).toLocaleString("de-DE")}`}>≈ {formatEuro(ersatz.amazonRevenueNet)}</td>
                <td className="num right muted small" colSpan={2}>in sellerboard enthalten</td>
                <td className="num right" style={{ fontWeight: 600, color: ersatz.amazonResult < 0 ? "var(--danger)" : undefined }} title="Gewinn laut sellerboard (mit Werbung und Fixkosten aus sellerboard)">{formatEuro(ersatz.amazonResult)}</td>
                <td className="num right small muted">{amazon ? <span title="Nur bis zur letzten Abrechnung">Abrechnung: {formatEuro(amazon.provisional)}</span> : "–"}</td>
                <td className="small muted">Abrechnung folgt</td>
              </tr>
            )}
            {amazon && !ersatz && (
              <tr data-testid="channel-amazon" data-quelle="abrechnung">
                <td>Amazon</td>
                <td className="small" data-testid="channel-amazon-quelle" style={aq.unvollstaendig ? { color: "var(--warn)" } : undefined}>{aq.text}</td>
                <td className="num right">{formatEuro(amazon.revenueNet)}</td>
                <td className="num right">{formatEuro(skus.reduce((n, s) => n + (s.cogs ?? 0), 0))}</td>
                <td className="num right">{formatEuro(neg(fees))}</td>
                <td className="num right">{formatEuro(amazon.provisional)}</td>
                <td className="num right">{formatEuro(amazon.completeProfit)}</td>
                <td className="small">{amazon.missingCostSkus.length ? <Link href={`${fix}#ek`} style={{ color: "var(--warn)" }}>EK: {plural(amazon.missingCostSkus.length, "SKU", "SKUs")}</Link> : <span className="muted">–</span>}</td>
              </tr>
            )}
            {channels.map((c) => (
              <tr key={c.channel} data-testid={`channel-${c.channel}`}>
                <td>{CHANNEL_LABEL[c.channel] ?? c.channel}<div className="small muted">{plural(c.orders, "Bestellung", "Bestellungen")}</div></td>
                <td className="small">{kanalQuelle(c.channel)}</td>
                <td className="num right">{formatEuro(c.revenueNet)}</td>
                <td className="num right">{formatEuro(c.cogsKnown)}</td>
                <td className="num right">{FEE_FREE_CHANNELS.has(c.channel) ? <span className="muted small">keine</span> : formatEuro(c.feesKnown)}</td>
                <td className="num right">{formatEuro(c.provisional)}</td>
                <td className="num right">{c.completeRevenueNet > 0 ? formatEuro(c.completeProfit) : "–"}</td>
                <td className="small" style={{ color: "var(--warn)" }}>
                  {[c.missingCost ? <Link key="ek" href={`${fix}#ek`}>EK: {plural(c.missingCost, "Pos.", "Pos.")}</Link> : null, c.missingFeeOrders ? <Link key="fee" href={`${fix}#gebuehren`}>Gebühr: {plural(c.missingFeeOrders, "Best.", "Best.")}</Link> : null, c.missingPrice ? <Link key="p" href={`${fix}#preis`}>Preis: {plural(c.missingPrice, "Pos.", "Pos.")}</Link> : null]
                    .filter(Boolean)
                    .reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, " · ", el] : [el]), []) }
                  {!c.missingCost && !c.missingFeeOrders && !c.missingPrice && <span className="muted">–</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {sbMonths.length > 0 && (
        <section className="card" style={{ overflow: "auto" }} data-testid="sb-compare">
          <div className="card-head">
            <div>
              <h2>Zum Vergleich: laut sellerboard</h2>
              <div className="small muted" style={{ marginTop: 2 }}>
                sellerboard rechnet mit seinen eigenen EK, Gebühren und Fixkosten (Stand {sbMonths[0].syncedAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}). Abweichungen zur Rechnung oben zeigen, wo EK oder Abrechnungen fehlen.
                {sbThis && <> · {RANGES[r]}: <strong data-testid="sb-month-profit">{formatEuro(sbThis.netProfit)}</strong> Nettogewinn laut sellerboard</>}
              </div>
            </div>
          </div>
          <table className="table">
            <thead><tr><th>Monat</th><th className="right">Umsatz</th><th className="right">Einheiten</th><th className="right">Amazon-Gebühren</th><th className="right">Wareneinsatz</th><th className="right">Fixkosten</th><th className="right">Nettogewinn</th></tr></thead>
            <tbody>
              {sbMonths.map((m) => (
                <tr key={m.month} data-testid="sb-month-row" style={calMonth === m.month ? { background: "var(--surface-2)" } : undefined}>
                  <td className="num">{m.month.split("-").reverse().join("/")}</td>
                  <td className="num right">{formatEuro(m.sales)}</td>
                  <td className="num right">{m.units ?? "–"}</td>
                  <td className="num right">{formatEuro(m.amazonFees === null ? null : -m.amazonFees)}</td>
                  <td className="num right">{formatEuro(m.productCosts === null ? null : -m.productCosts)}</td>
                  <td className="num right">{formatEuro(m.expenses === null ? null : -m.expenses)}</td>
                  <td className="num right" style={{ fontWeight: 600, color: (m.netProfit ?? 0) < 0 ? "var(--danger)" : undefined }}>{formatEuro(m.netProfit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="row">
        <section className="card" style={{ flexGrow: 1, minWidth: 0, overflow: "auto" }}>
          <div className="card-head">
            <h2>Je SKU (Amazon)</h2>
            <div style={{ display: "flex", gap: 6 }}>
              <Link className={`chip${sp.sort !== "gut" ? " active" : ""}`} aria-current={sp.sort !== "gut" ? "true" : undefined} href={`/gewinn?zeitraum=${r}`}>Schlechteste zuerst</Link>
              <Link className={`chip${sp.sort === "gut" ? " active" : ""}`} aria-current={sp.sort === "gut" ? "true" : undefined} href={`/gewinn?zeitraum=${r}&sort=gut`}>Beste zuerst</Link>
            </div>
          </div>
          {skus.length === 0 ? <div className="card-pad small muted">Keine Amazon-Abrechnung in diesem Zeitraum.</div> : (
            <table className="table sticky-head">
              <thead><tr><th>SKU</th><th className="right">Verkauft</th><th className="right">Erstattet</th><th className="right">Umsatz netto</th><th className="right">Gebühren</th><th className="right">EK</th><th className="right">Gewinn</th>{sbSku && <th className="right" title="Nettogewinn derselben SKU im selben Monat laut sellerboard">sellerboard</th>}<th className="right">je Stk</th><th className="right">VK geplant / Ø</th></tr></thead>
              <tbody>
                {sorted.slice(0, 300).map((s) => {
                  const perUnit = s.profit !== null && s.units - s.refunds > 0 ? s.profit / (s.units - s.refunds) : null;
                  const priceDrop = s.plannedPrice && s.avgPrice ? s.avgPrice < s.plannedPrice * 0.9 : false;
                  return (
                    <tr key={s.sku}>
                      <td className="num small" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.title ?? undefined}><Link href={`/produkte/sku/${encodeURIComponent(s.sku)}`}>{s.sku}</Link></td>
                      <td className="num right">{s.units}</td>
                      <td className="num right">{s.refunds || ""}</td>
                      <td className="num right">{formatEuro(s.revenueNet)}</td>
                      <td className="num right">{formatEuro(s.fees)}</td>
                      <td className="num right">{s.cogs === null ? <Link href={`${fix}#ek`} className="tag tag-missing">fehlt</Link> : formatEuro(s.cogs)}</td>
                      <td className="num right" style={{ fontWeight: 600, color: (s.profit ?? 0) < 0 ? "var(--danger)" : undefined }}>{s.profit === null ? <span className="muted" title="EK fehlt – kein Gewinn berechenbar">–</span> : formatEuro(s.profit)}</td>
                      {sbSku && <td className="num right small" data-testid="sb-sku-profit">{sbSku.get(s.sku)?.netProfit === undefined || sbSku.get(s.sku)?.netProfit === null ? <span className="muted">–</span> : formatEuro(sbSku.get(s.sku)!.netProfit)}</td>}
                      <td className="num right">{formatEuro(perUnit)}</td>
                      <td className="num right small" style={{ color: priceDrop ? "var(--danger)" : undefined }}>{s.plannedPrice ? formatEuro(s.plannedPrice) : "–"} / {formatEuro(s.avgPrice)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        <aside className="col-side">
          <section className="card card-pad stack">
            <h2>Amazon-Kosten ohne SKU</h2>
            {nonSku.length === 0 && <div className="small muted">Keine im Zeitraum.</div>}
            {nonSku.map((n, i) => <div key={i} className="between small"><span>{n.description ?? n.type ?? "–"}</span><span className="num">{formatEuro(n.amount)}</span></div>)}
          </section>
          {transfers.length > 0 && (
            <section className="card card-pad stack" data-testid="profit-transfers">
              <h2>Geldbewegungen (nicht im Ergebnis)</h2>
              <div className="small muted">Rücklagen, Kartenabbuchungen u. Ä. verschieben nur Geld zwischen Amazon und Bank – kein Gewinn, kein Verlust.</div>
              {transfers.map((n, i) => <div key={i} className="between small"><span>{n.description ?? n.type ?? "–"}</span><span className="num">{formatEuro(n.amount)}</span></div>)}
            </section>
          )}
          <section className="card card-pad small muted">
            „VK geplant“ ist der Zielpreis aus der Arbitrage-One-SKU – rot, wenn der tatsächliche Ø-Preis über 10 % darunter liegt.
          </section>
        </aside>
      </div>
    </>
  );
}
