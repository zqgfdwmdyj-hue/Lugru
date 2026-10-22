import Link from "next/link";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { formatDate, formatEuro } from "@/lib/numbers";
import { amountForMonth, chargeableFrom, customerKey, storedDays } from "@/lib/pallets/billing";
import { MONTH_RE, loadMonthBill, monthLabel, palletContext, palletPhotos, shiftMonth, statementsFor } from "@/lib/pallets/service";
import { CopyButton } from "@/components/copy-button";
import { checkOutPallet, deleteCharge, deletePallet, undoCheckOut } from "./actions";
import { ChargeForm, SendStatementButton } from "./forms";
import { PalletScan } from "./scan";
import { Occupancy, PalletTabs } from "./tabs";

const kg = (n: number | null) => (n ? `${String(n).replace(".", ",")} kg` : "");
const sentLabel = (d: Date | null) => (d ? d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }) : null);

export default async function PalettenPage({ searchParams }: { searchParams: Promise<{ monat?: string; kunde?: string }> }) {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const sp = await searchParams;
  const today = todayIso();
  const thisMonth = today.slice(0, 7);
  const month = sp.monat && MONTH_RE.test(sp.monat) ? sp.monat : thisMonth;
  const kunde = (sp.kunde ?? "").trim().slice(0, 120);
  const P = schema.pallets;
  const ctx = await palletContext(t);
  const rates = ctx.settings;

  const allOpen = await db.select().from(P).where(and(eq(P.tenantId, t), isNull(P.outAt))).orderBy(P.inAt, P.code);
  const open = kunde ? allOpen.filter((p) => customerKey(p.customer) === customerKey(kunde)) : allOpen;
  const recentOut = await db.select().from(P).where(and(eq(P.tenantId, t), isNotNull(P.outAt))).orderBy(desc(P.outAt), desc(P.updatedAt)).limit(30);
  const used = (await db.selectDistinct({ c: P.customer }).from(P).where(and(eq(P.tenantId, t), isNotNull(P.customer)))).map((r) => r.c!.trim());
  const byKey = new Map<string, string>();
  for (const n of [...ctx.customers.map((c) => c.name), ...used]) if (n && !byKey.has(customerKey(n))) byKey.set(customerKey(n), n);
  const customers = [...byKey.values()].sort((a, b) => a.localeCompare(b, "de"));
  const locations = [...new Set((await db.selectDistinct({ l: P.location }).from(P).where(and(eq(P.tenantId, t), isNotNull(P.location)))).map((r) => r.l!))].sort((a, b) => a.localeCompare(b, "de", { numeric: true }));
  const photos = await palletPhotos(t, open.map((p) => p.id));

  const bill = await loadMonthBill(t, month, ctx);
  const current = month === thisMonth ? bill : await loadMonthBill(t, thisMonth, ctx);
  const sent = await statementsFor(t, month);
  const emails = new Map(ctx.customers.map((c) => [customerKey(c.name), c.email]));
  const chargeableNow = allOpen.filter((p) => chargeableFrom(p.inAt, ctx.ratesOf(p.customer).freeDays) <= today).length;
  const modeLabel = rates.mode === "monat" ? "je angefangenem Monat" : "tagesgenau anteilig";
  const occupiedLocations = new Map<string, number>();
  for (const p of allOpen) if (p.location) occupiedLocations.set(p.location, (occupiedLocations.get(p.location) ?? 0) + 1);

  const copyText = [
    `Palettenlager ${monthLabel(month)}`,
    ...bill.groups.flatMap((g) => [
      "",
      `${g.customer}: ${g.lines.length} Paletten = ${formatEuro(g.total)} (${formatEuro(g.rates.pricePerMonth)} je Stellplatz/Monat, ${g.rates.freeDays} Tage frei)`,
      ...g.lines.map((l) => `${l.pallet.code}\tein ${formatDate(l.pallet.inAt)}\t${l.pallet.outAt ? `aus ${formatDate(l.pallet.outAt)}` : "noch da"}\t${l.days} Tage\t${formatEuro(l.amount)}${l.inFee + l.outFee ? ` (inkl. ${formatEuro(l.inFee + l.outFee)} Ein/Aus)` : ""}`),
      ...g.services.map((s) => `${formatDate(s.charge.day)}\t${s.charge.description}${s.charge.palletCode ? ` (${s.charge.palletCode})` : ""}\t${String(s.charge.quantity).replace(".", ",")} × ${formatEuro(s.charge.unitPrice)}\t${formatEuro(s.amount)}`),
    ]),
    "",
    `Gesamt: ${bill.count} Paletten = ${formatEuro(bill.total)}`,
  ].join("\n");

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Lager</div><h1>Paletten-Lager</h1></div>
        <span className="small muted">Standard: {formatEuro(rates.pricePerMonth)} je Stellplatz und Monat · {rates.freeDays} Tage kostenfrei · {modeLabel}</span>
      </div>
      <PalletTabs active="lager" />

      <div className="grid-kpi">
        <div className="card card-pad">
          <div className="kpi-label">Eingelagert</div>
          <div className="kpi-value" data-testid="kpi-open">{allOpen.length}</div>
          {rates.capacity > 0 && (
            <>
              <Occupancy used={allOpen.length} capacity={rates.capacity} />
              <div className="small muted" data-testid="kpi-capacity">{allOpen.length} von {rates.capacity} Stellplätzen belegt · {Math.max(0, rates.capacity - allOpen.length)} frei</div>
            </>
          )}
        </div>
        <div className="card card-pad"><div className="kpi-label">Davon kostenpflichtig</div><div className="kpi-value">{chargeableNow}</div></div>
        <div className="card card-pad"><div className="kpi-label">Abrechnung {monthLabel(thisMonth)}</div><div className="kpi-value">{formatEuro(current.total)}</div><div className="small muted">{current.count} Paletten, Stand Monatsende</div></div>
        <div className="card card-pad"><div className="kpi-label">Kunden mit Paletten</div><div className="kpi-value">{new Set(allOpen.map((p) => customerKey(p.customer))).size}</div></div>
      </div>

      <PalletScan customers={customers} locations={locations} today={today} />

      <section className="card" id="lager">
        <div className="card-head">
          <h2>Aktuell eingelagert ({open.length})</h2>
          <form method="get" action="/paletten#lager" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {month !== thisMonth && <input type="hidden" name="monat" value={month} />}
            <label className="sr-only" htmlFor="f-kunde">Kunde</label>
            <select className="select" id="f-kunde" name="kunde" defaultValue={kunde}>
              <option value="">Alle Kunden</option>
              {customers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button className="btn btn-small" type="submit">Filtern</button>
            {open.length > 0 && <a className="btn btn-small" href={`/etikett/palette?codes=${encodeURIComponent(open.map((p) => p.code).join(","))}`} target="_blank" rel="noreferrer">Etiketten</a>}
          </form>
        </div>
        <table className="table">
          <thead><tr><th>Palette</th><th>Kunde</th><th>Stellplatz</th><th></th><th>Kosten</th><th>Eingelagert</th><th className="right">Tage</th><th className="right">{monthLabel(thisMonth).split(" ")[0]}</th></tr></thead>
          <tbody>
            {open.length === 0 && <tr><td colSpan={8} className="muted">Keine Paletten eingelagert. Oben scannen oder Nummer eingeben.</td></tr>}
            {open.map((p) => {
              const r = ctx.ratesOf(p.customer);
              const from = chargeableFrom(p.inAt, r.freeDays);
              const free = from > today;
              const n = photos.get(p.id)?.length ?? 0;
              const info = [p.contents, kg(p.weightKg), p.note].filter(Boolean).join(" · ");
              return (
                <tr key={p.id} data-testid="pallet-row">
                  <td className="num">
                    <Link href={`/paletten/${p.id}`}><strong>{p.code}</strong></Link>
                    {n > 0 && <span className="small muted" title={`${n} Foto${n === 1 ? "" : "s"}`}> · 📷{n}</span>}
                    {info && <div className="small muted">{info}</div>}
                  </td>
                  <td>{p.customer ?? <span className="muted">–</span>}</td>
                  <td className="num">
                    {p.location ?? <span className="muted">–</span>}
                    {p.location && (occupiedLocations.get(p.location) ?? 0) > 1 && <span className="tag tag-warn" style={{ marginLeft: 4 }} title="Mehrere Paletten auf diesem Stellplatz">{occupiedLocations.get(p.location)}×</span>}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <form action={checkOutPallet}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="btn btn-small btn-primary" type="submit" title="Palette ist heute raus – Timer stoppen">Ist raus</button>
                      </form>
                      <Link className="btn btn-small" href={`/paletten/${p.id}`}>Ändern</Link>
                    </div>
                  </td>
                  <td>{free ? <span className="tag tag-ok">frei bis {formatDate(chargeableFrom(p.inAt, r.freeDays - 1))}</span> : <span className="tag tag-warn">seit {formatDate(from)}</span>}</td>
                  <td className="num">{formatDate(p.inAt)}</td>
                  <td className="num right">{storedDays(p, today)}</td>
                  <td className="num right">{formatEuro(amountForMonth(p, thisMonth, r).amount)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card" id="abrechnung">
        <div className="card-head" style={{ flexWrap: "wrap", gap: 8 }}>
          <h2>Abrechnung {monthLabel(month)}: {formatEuro(bill.total)}</h2>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Link className="btn btn-small" href={`/paletten?monat=${shiftMonth(month, -1)}#abrechnung`}>← {monthLabel(shiftMonth(month, -1))}</Link>
            {month < thisMonth && <Link className="btn btn-small" href={`/paletten?monat=${shiftMonth(month, 1)}#abrechnung`}>{monthLabel(shiftMonth(month, 1))} →</Link>}
            {bill.count + bill.groups.reduce((s, g) => s + g.services.length, 0) > 0 && <CopyButton text={copyText} label="Kopieren" />}
            <a className="btn btn-small btn-primary" href={`/paletten/export?monat=${month}`}>Excel (CSV)</a>
          </div>
        </div>
        <div className="card-pad small muted" style={{ paddingTop: 0 }}>
          {month === thisMonth ? "Laufender Monat: Paletten, die noch da sind, zählen bis Monatsende. " : ""}
          Lagerung {formatEuro(bill.storage)}{bill.fees ? ` · Ein-/Auslagern ${formatEuro(bill.fees)}` : ""}{bill.services ? ` · Zusatzleistungen ${formatEuro(bill.services)}` : ""}
        </div>
        <table className="table" data-testid="bill">
          <thead><tr><th>Kunde / Palette</th><th>Eingelagert</th><th>Kostenpflichtig ab</th><th>Ausgelagert</th><th className="right">Tage</th><th className="right">Lager</th><th className="right">Ein/Aus</th><th className="right">Betrag</th></tr></thead>
          <tbody>
            {bill.groups.length === 0 && <tr><td colSpan={8} className="muted">In diesem Monat ist nichts abzurechnen.</td></tr>}
            {bill.groups.map((g) => {
              const key = customerKey(g.customer);
              const st = sent.get(key);
              return [
                <tr key={g.customer} className="pal-group" data-testid="bill-group">
                  <td colSpan={7}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <strong>{g.customer}</strong>
                      <span className="small muted">{g.lines.length} Paletten{g.services.length ? ` · ${g.services.length} Leistung${g.services.length === 1 ? "" : "en"}` : ""} · {formatEuro(g.rates.pricePerMonth)}/Monat, {g.rates.freeDays} Tage frei</span>
                      {g.customer !== "Ohne Kunde" && (
                        <>
                          <a className="btn btn-small" href={`/paletten/aufstellung?monat=${month}&kunde=${encodeURIComponent(g.customer)}`} target="_blank" rel="noreferrer" data-testid="statement-pdf">Aufstellung (PDF)</a>
                          <SendStatementButton customer={g.customer} month={month} email={emails.get(key) ?? null} sentAt={sentLabel(st?.sentAt ?? null)} error={st?.sentAt ? null : st?.error ?? null} />
                        </>
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
                ...g.services.map((s) => (
                  <tr key={s.charge.id} data-testid="bill-service">
                    <td style={{ paddingLeft: 24 }} colSpan={4}>
                      {s.charge.description}
                      {s.charge.palletCode && <span className="muted"> · {s.charge.palletCode}</span>}
                      <span className="small muted"> · {formatDate(s.charge.day)}</span>
                    </td>
                    <td className="num right">{String(s.charge.quantity).replace(".", ",")} ×</td>
                    <td className="num right">{formatEuro(s.charge.unitPrice)}</td>
                    <td className="right">
                      <form action={deleteCharge}>
                        <input type="hidden" name="id" value={s.charge.id} />
                        <button className="btn-link small" type="submit" title="Leistung löschen" style={{ color: "var(--danger)" }}>löschen</button>
                      </form>
                    </td>
                    <td className="num right">{formatEuro(s.amount)}</td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
        <details className="card-pad" data-testid="charge-details">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>+ Zusatzleistung erfassen (Folieren, Umpacken …)</summary>
          <div style={{ paddingTop: 10 }}>
            <ChargeForm customers={customers} services={rates.services} pallets={allOpen.map((p) => p.code)} today={today} customer={kunde || null} />
          </div>
        </details>
      </section>

      <section className="card" id="ausgelagert">
        <div className="card-head"><h2>Zuletzt ausgelagert</h2><span className="small muted">Versehentlich ausgelagert? „Zurück ins Lager“</span></div>
        <table className="table">
          <thead><tr><th>Palette</th><th>Kunde</th><th>Eingelagert</th><th>Ausgelagert</th><th className="right">Tage</th><th></th></tr></thead>
          <tbody>
            {recentOut.length === 0 && <tr><td colSpan={6} className="muted">Noch keine Palette ausgelagert.</td></tr>}
            {recentOut.map((p) => (
              <tr key={p.id}>
                <td className="num"><Link href={`/paletten/${p.id}`}>{p.code}</Link></td>
                <td>{p.customer ?? "–"}</td>
                <td className="num">{formatDate(p.inAt)}</td>
                <td className="num">{formatDate(p.outAt)}</td>
                <td className="num right">{storedDays(p, today)}</td>
                <td>
                  <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                    <form action={undoCheckOut}><input type="hidden" name="id" value={p.id} /><button className="btn btn-small" type="submit">Zurück ins Lager</button></form>
                    <form action={deletePallet}><input type="hidden" name="id" value={p.id} /><button className="btn btn-small" type="submit" title="Eintrag ganz löschen (z. B. Fehlbuchung)">Löschen</button></form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
