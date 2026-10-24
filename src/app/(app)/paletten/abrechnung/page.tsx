import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { formatDate, formatEuro } from "@/lib/numbers";
import { chargeableFrom, customerKey } from "@/lib/pallets/billing";
import { MONTH_RE, loadMonthBill, monthLabel, palletContext, shiftMonth, statementsFor } from "@/lib/pallets/service";
import { getSettings } from "@/lib/settings";
import { CopyButton } from "@/components/copy-button";
import { deleteCharge } from "../actions";
import { ChargeForm, InvoiceStatus, SendStatementButton } from "../forms";
import { PalletTabs } from "../tabs";

const sentLabel = (d: Date | null) => (d ? d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }) : null);
const dateLabel = (d: Date | null) => (d ? d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" }) : null);
const pct = (r: number) => `${String(Math.round(r * 1000) / 10).replace(".", ",")} %`;

/** Abrechnung je Monat – eigene Ansicht, getrennt von der Lagerarbeit. */
export default async function PalettenAbrechnungPage({ searchParams }: { searchParams: Promise<{ monat?: string; kunde?: string }> }) {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const sp = await searchParams;
  const today = todayIso();
  const thisMonth = today.slice(0, 7);
  const month = sp.monat && MONTH_RE.test(sp.monat) ? sp.monat : thisMonth;
  const ctx = await palletContext(t);
  const s = ctx.settings;
  const vatRate = (await getSettings(t)).vatRate;
  const bill = await loadMonthBill(t, month, ctx);
  const running = month === thisMonth;
  const toDate = running ? await loadMonthBill(t, month, ctx, { asOf: today }) : null;
  const toDateBy = new Map((toDate?.groups ?? []).map((g) => [customerKey(g.customer), g.total]));
  const sent = await statementsFor(t, month);
  const emails = new Map(ctx.customers.map((c) => [customerKey(c.name), c.email]));
  const P = schema.pallets;
  const open = await db.select({ code: P.code, customer: P.customer }).from(P).where(and(eq(P.tenantId, t), isNull(P.outAt), isNull(P.cancelledAt)));
  const customers = [...new Set([...ctx.customers.map((c) => c.name), ...open.map((p) => p.customer ?? "").filter(Boolean)])].sort((a, b) => a.localeCompare(b, "de"));
  const net = s.pricesAre !== "brutto";
  const vat = (n: number) => (net ? Math.round(n * vatRate * 100) / 100 : Math.round((n - n / (1 + vatRate)) * 100) / 100);
  const gross = (n: number) => (net ? Math.round((n + vat(n)) * 100) / 100 : n);
  const netOf = (n: number) => (net ? n : Math.round((n - vat(n)) * 100) / 100);
  const modeText = (m: string) => (m === "monat" ? "voller Monatspreis je angefangenem Kalendermonat" : "tagesgenau anteilig");

  const copyText = [
    `Palettenlager ${monthLabel(month)} (Beträge ${net ? "netto" : "brutto"})`,
    ...bill.groups.flatMap((g) => [
      "",
      `${g.customer}: ${g.lines.length} Paletten = ${formatEuro(g.total)} (${formatEuro(g.rates.pricePerMonth)} je Stellplatz/Monat, ${g.rates.freeDays} Tage frei)`,
      ...g.lines.map((l) => `${l.pallet.code}\tein ${formatDate(l.pallet.inAt)}\t${l.pallet.outAt ? `aus ${formatDate(l.pallet.outAt)}` : "noch da"}\t${l.days} Tage\t${formatEuro(l.amount)}${l.inFee + l.outFee ? ` (inkl. ${formatEuro(l.inFee + l.outFee)} Ein/Aus)` : ""}`),
      ...g.services.map((x) => `${formatDate(x.charge.day)}\t${x.charge.description}${x.charge.palletCode ? ` (${x.charge.palletCode})` : ""}\t${String(x.charge.quantity).replace(".", ",")} × ${formatEuro(x.charge.unitPrice)}\t${formatEuro(x.amount)}`),
    ]),
    "",
    `Gesamt: ${bill.count} Paletten = ${formatEuro(bill.total)} ${net ? "netto" : "brutto"}`,
  ].join("\n");

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Lager · Paletten</div><h1>Abrechnung {monthLabel(month)}</h1></div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Link className="btn btn-small" href={`/paletten/abrechnung?monat=${shiftMonth(month, -1)}`}>← {monthLabel(shiftMonth(month, -1))}</Link>
          {month < thisMonth && <Link className="btn btn-small" href={`/paletten/abrechnung?monat=${shiftMonth(month, 1)}`}>{monthLabel(shiftMonth(month, 1))} →</Link>}
          {bill.groups.length > 0 && <CopyButton text={copyText} label="Kopieren" />}
          <a className="btn btn-small btn-primary" href={`/paletten/export?monat=${month}`}>Excel (CSV)</a>
        </div>
      </div>
      <PalletTabs active="abrechnung" />

      <div className="grid-kpi" data-testid="bill-kpis">
        {running && toDate ? (
          <>
            <div className="card card-pad"><div className="kpi-label">Bisher angefallen (bis heute)</div><div className="kpi-value" data-testid="bill-to-date">{formatEuro(toDate.total)}</div><div className="small muted">{net ? "netto" : "brutto"} · tatsächlich bis {formatDate(today)}</div></div>
            <div className="card card-pad"><div className="kpi-label">Hochrechnung bis Monatsende</div><div className="kpi-value" data-testid="bill-projection">{formatEuro(bill.total)}</div><div className="small muted">wenn alle noch eingelagerten Paletten bis {formatDate(`${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`)} bleiben</div></div>
          </>
        ) : (
          <div className="card card-pad"><div className="kpi-label">Abrechnung {monthLabel(month)}</div><div className="kpi-value" data-testid="bill-total">{formatEuro(bill.total)}</div><div className="small muted">{bill.count} Paletten · {net ? "netto" : "brutto"}</div></div>
        )}
        <div className="card card-pad" data-testid="bill-vat">
          <div className="kpi-label">Umsatzsteuer ({pct(vatRate)})</div>
          <div className="small">Netto <strong>{formatEuro(netOf(bill.total))}</strong></div>
          <div className="small">USt <strong>{formatEuro(vat(bill.total))}</strong></div>
          <div className="small">Brutto <strong>{formatEuro(gross(bill.total))}</strong></div>
          <div className="small muted">{running ? "Hochrechnung · " : ""}Preise sind {net ? "netto (zzgl. USt)" : "brutto (inkl. USt)"} – einstellbar unter Kunden &amp; Preise</div>
        </div>
      </div>

      <section className="card" id="abrechnung">
        <div className="card-pad small muted" data-testid="bill-rules">
          So wird gerechnet: je Kalendermonat; Einlagerungstag = Tag 1, der Auslagerungstag zählt mit; kostenpflichtig ab dem Tag nach den freien Tagen.
          Standard: {formatEuro(s.pricePerMonth)} je Stellplatz und Monat, {s.freeDays} Tage frei, {modeText(s.mode)}. Kunden mit eigenen Konditionen sind markiert; es gelten die Konditionen, die im Monat galten.
          {running ? " Laufender Monat: „bisher“ = bis heute angefallen, Summe = Hochrechnung bis Monatsende." : ""}
          {" "}Lagerung {formatEuro(bill.storage)}{bill.fees ? ` · Ein-/Auslagern ${formatEuro(bill.fees)}` : ""}{bill.services ? ` · Zusatzleistungen ${formatEuro(bill.services)}` : ""}
        </div>
        <table className="table" data-testid="bill">
          <thead><tr><th>Kunde / Palette</th><th>Eingelagert</th><th>Kostenpflichtig ab</th><th>Ausgelagert</th><th className="right">Tage</th><th className="right">Lager</th><th className="right">Ein/Aus</th><th className="right">Betrag</th></tr></thead>
          <tbody>
            {bill.groups.length === 0 && <tr><td colSpan={8} className="muted">In diesem Monat ist nichts abzurechnen.</td></tr>}
            {bill.groups.map((g) => {
              const key = customerKey(g.customer);
              const st = sent.get(key);
              const r = g.rates as typeof g.rates & { own?: boolean };
              const changedSinceSent = st?.sentAt && st.total !== null && Math.abs(Number(st.total) - g.total) >= 0.005;
              return [
                <tr key={g.customer} className="pal-group" data-testid="bill-group">
                  <td colSpan={7}>
                    <div className="stack" style={{ gap: 6 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <strong>{g.customer}</strong>
                        <span className="small muted" data-testid="bill-rates">
                          {g.lines.length} Paletten{g.services.length ? ` · ${g.services.length} Leistung${g.services.length === 1 ? "" : "en"}` : ""} · {formatEuro(r.pricePerMonth)}/Monat, {r.freeDays} Tage frei, {r.mode === "monat" ? "je Monat" : "anteilig"}
                        </span>
                        <span className={`tag ${r.own ? "tag-info" : "tag-neutral"}`}>{r.own ? "eigene Konditionen" : "Standard"}</span>
                        {running && <span className="small">bisher <strong data-testid="bill-group-to-date">{formatEuro(toDateBy.get(key) ?? 0)}</strong></span>}
                      </div>
                      {g.customer !== "Ohne Kunde" && (
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <a className="btn btn-small" href={`/paletten/aufstellung?monat=${month}&kunde=${encodeURIComponent(g.customer)}`} target="_blank" rel="noreferrer" data-testid="statement-pdf">Aufstellung (PDF)</a>
                          <SendStatementButton customer={g.customer} month={month} email={emails.get(key) ?? null} sentAt={sentLabel(st?.sentAt ?? null)} error={st?.sentAt ? null : st?.error ?? null} />
                          <InvoiceStatus customer={g.customer} month={month} invoicedAt={dateLabel(st?.invoicedAt ?? null)} invoiceNo={st?.invoiceNo ?? null} paidAt={dateLabel(st?.paidAt ?? null)} invoicedTotal={st?.invoicedTotal ?? null} total={g.total} owner={session.role === "owner"} />
                          {changedSinceSent && <span className="small" style={{ color: "var(--warn)" }} data-testid="sent-changed">Seit dem Versand geändert ({formatEuro(Number(st!.total))} → {formatEuro(g.total)}).</span>}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="num right"><strong>{formatEuro(g.total)}</strong></td>
                </tr>,
                ...g.lines.map((l) => (
                  <tr key={l.pallet.id}>
                    <td className="num" style={{ paddingLeft: 24 }}><Link href={`/paletten/${l.pallet.id}`}>{l.pallet.code}</Link></td>
                    <td className="num">{formatDate(l.pallet.inAt)}</td>
                    <td className="num">{formatDate(chargeableFrom(l.pallet.inAt, g.rates.freeDays))}</td>
                    <td className="num">{l.pallet.outAt ? formatDate(l.pallet.outAt) : <span className="muted">noch da</span>}</td>
                    <td className="num right">{l.days}</td>
                    <td className="num right">{formatEuro(l.storage)}</td>
                    <td className="num right">{l.inFee + l.outFee ? formatEuro(l.inFee + l.outFee) : <span className="muted">–</span>}</td>
                    <td className="num right">{formatEuro(l.amount)}</td>
                  </tr>
                )),
                ...g.services.map((x) => (
                  <tr key={x.charge.id} data-testid="bill-service">
                    <td style={{ paddingLeft: 24 }} colSpan={4}>
                      {x.charge.description}
                      {x.charge.palletCode && <span className="muted"> · {x.charge.palletCode}</span>}
                      <span className="small muted"> · {formatDate(x.charge.day)}</span>
                    </td>
                    <td className="num right">{String(x.charge.quantity).replace(".", ",")} ×</td>
                    <td className="num right">{formatEuro(x.charge.unitPrice)}</td>
                    <td className="right">
                      <form action={deleteCharge}>
                        <input type="hidden" name="id" value={x.charge.id} />
                        <button className="btn-link small" type="submit" title="Leistung löschen" style={{ color: "var(--danger)" }}>löschen</button>
                      </form>
                    </td>
                    <td className="num right">{formatEuro(x.amount)}</td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
        <details className="card-pad" data-testid="charge-details">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>+ Zusatzleistung erfassen (Folieren, Umpacken …)</summary>
          <div style={{ paddingTop: 10 }}>
            <ChargeForm customers={customers} services={s.services} pallets={open.map((p) => p.code)} today={today} customer={sp.kunde ?? null} />
          </div>
        </details>
      </section>
    </>
  );
}
