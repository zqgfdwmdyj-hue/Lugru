import Link from "next/link";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { formatDate, formatEuro } from "@/lib/numbers";
import { amountForMonth, chargeableFrom, storedDays } from "@/lib/pallets/billing";
import { MONTH_RE, loadMonthBill, monthLabel, shiftMonth } from "@/lib/pallets/service";
import { CopyButton } from "@/components/copy-button";
import { checkOutPallet, deletePallet, savePalletRates, undoCheckOut, updatePallet } from "./actions";
import { PalletScan } from "./scan";

export default async function PalettenPage({ searchParams }: { searchParams: Promise<{ monat?: string; kunde?: string; bearbeiten?: string }> }) {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const sp = await searchParams;
  const today = todayIso();
  const thisMonth = today.slice(0, 7);
  const month = sp.monat && MONTH_RE.test(sp.monat) ? sp.monat : thisMonth;
  const kunde = (sp.kunde ?? "").trim().slice(0, 120);
  const P = schema.pallets;

  const open = await db
    .select()
    .from(P)
    .where(and(eq(P.tenantId, t), isNull(P.outAt), kunde ? sql`coalesce(${P.customer}, '') = ${kunde}` : undefined))
    .orderBy(P.inAt, P.code);
  const recentOut = await db.select().from(P).where(and(eq(P.tenantId, t), isNotNull(P.outAt))).orderBy(desc(P.outAt), desc(P.updatedAt)).limit(30);
  const customers = (await db.selectDistinct({ c: P.customer }).from(P).where(and(eq(P.tenantId, t), isNotNull(P.customer)))).map((r) => r.c!).sort((a, b) => a.localeCompare(b, "de"));
  const bill = await loadMonthBill(t, month);
  const rates = bill.rates;
  const current = month === thisMonth ? bill : await loadMonthBill(t, thisMonth);
  const chargeableNow = open.filter((p) => chargeableFrom(p.inAt, rates.freeDays) <= today).length;
  const editId = sp.bearbeiten;
  const modeLabel = rates.mode === "monat" ? "je angefangenem Monat" : "tagesgenau anteilig";

  const copyText = [
    `Palettenlager ${monthLabel(month)} – ${formatEuro(rates.pricePerMonth)} je Stellplatz/Monat (${modeLabel}), ${rates.freeDays} Tage frei`,
    ...bill.groups.flatMap((g) => [
      "",
      `${g.customer}: ${g.lines.length} Paletten = ${formatEuro(g.total)}`,
      ...g.lines.map((l) => `${l.pallet.code}\tein ${formatDate(l.pallet.inAt)}\t${l.pallet.outAt ? `aus ${formatDate(l.pallet.outAt)}` : "noch da"}\t${l.days} Tage\t${formatEuro(l.amount)}`),
    ]),
    "",
    `Gesamt: ${bill.count} Paletten = ${formatEuro(bill.total)}`,
  ].join("\n");

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Lager</div><h1>Paletten-Lager</h1></div>
        <span className="small muted">{formatEuro(rates.pricePerMonth)} je Stellplatz und Monat · die ersten {rates.freeDays} Tage kostenfrei · {modeLabel}</span>
      </div>

      <div className="grid-kpi">
        <div className="card card-pad"><div className="kpi-label">Eingelagert</div><div className="kpi-value" data-testid="kpi-open">{open.length}</div></div>
        <div className="card card-pad"><div className="kpi-label">Davon kostenpflichtig</div><div className="kpi-value">{chargeableNow}</div></div>
        <div className="card card-pad"><div className="kpi-label">Abrechnung {monthLabel(thisMonth)}</div><div className="kpi-value">{formatEuro(current.total)}</div><div className="small muted">{current.count} Paletten, Stand Monatsende</div></div>
        <div className="card card-pad"><div className="kpi-label">Kunden mit Paletten</div><div className="kpi-value">{new Set(open.map((p) => p.customer ?? "")).size}</div></div>
      </div>

      <PalletScan customers={customers} today={today} />

      <section className="card" id="lager">
        <div className="card-head">
          <h2>Aktuell eingelagert ({open.length})</h2>
          <form method="get" action="/paletten#lager" style={{ display: "flex", gap: 6 }}>
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
          <thead><tr><th>Palette</th><th>Kunde</th><th></th><th>Kosten</th><th>Eingelagert</th><th className="right">Tage</th><th className="right">{monthLabel(thisMonth).split(" ")[0]}</th></tr></thead>
          <tbody>
            {open.length === 0 && <tr><td colSpan={7} className="muted">Keine Paletten eingelagert. Oben scannen oder Nummer eingeben.</td></tr>}
            {open.map((p) => {
              const from = chargeableFrom(p.inAt, rates.freeDays);
              const free = from > today;
              const days = storedDays(p, today);
              if (editId === p.id) {
                return (
                  <tr key={p.id}>
                    <td colSpan={7}>
                      <form action={updatePallet} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                        <input type="hidden" name="id" value={p.id} />
                        <strong className="num">{p.code}</strong>
                        <div className="field"><label className="label" htmlFor={`c-${p.id}`}>Kunde</label><input className="input" id={`c-${p.id}`} name="customer" defaultValue={p.customer ?? ""} list="pal-customers" /></div>
                        <div className="field"><label className="label" htmlFor={`i-${p.id}`}>Eingelagert</label><input className="input" id={`i-${p.id}`} name="inAt" type="date" defaultValue={p.inAt} max={today} required /></div>
                        <div className="field"><label className="label" htmlFor={`n-${p.id}`}>Notiz</label><input className="input" id={`n-${p.id}`} name="note" defaultValue={p.note ?? ""} /></div>
                        <button className="btn btn-primary btn-small" type="submit">Speichern</button>
                        <Link className="btn btn-small" href="/paletten#lager">Abbrechen</Link>
                      </form>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={p.id} data-testid="pallet-row">
                  <td className="num"><strong>{p.code}</strong>{p.note && <div className="small muted">{p.note}</div>}</td>
                  <td>{p.customer ?? <span className="muted">–</span>}</td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <form action={checkOutPallet}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="btn btn-small btn-primary" type="submit" title="Palette ist heute raus – Timer stoppen">Ist raus</button>
                      </form>
                      <Link className="btn btn-small" href={`/paletten?bearbeiten=${p.id}#lager`}>Ändern</Link>
                    </div>
                  </td>
                  <td>{free ? <span className="tag tag-ok">frei bis {formatDate(chargeableFrom(p.inAt, rates.freeDays - 1))}</span> : <span className="tag tag-warn">seit {formatDate(from)}</span>}</td>
                  <td className="num">{formatDate(p.inAt)}</td>
                  <td className="num right">{days}</td>
                  <td className="num right">{formatEuro(amountForMonth(p, thisMonth, rates).amount)}</td>
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
            {bill.count > 0 && <CopyButton text={copyText} label="Kopieren" />}
            <a className="btn btn-small btn-primary" href={`/paletten/export?monat=${month}`}>Excel (CSV)</a>
          </div>
        </div>
        {month === thisMonth && <div className="card-pad small muted" style={{ paddingTop: 0 }}>Laufender Monat: Paletten, die noch da sind, zählen bis Monatsende.</div>}
        <table className="table" data-testid="bill">
          <thead><tr><th>Kunde / Palette</th><th>Eingelagert</th><th>Kostenpflichtig ab</th><th>Ausgelagert</th><th className="right">Tage im Monat</th><th className="right">Betrag</th></tr></thead>
          <tbody>
            {bill.count === 0 && <tr><td colSpan={6} className="muted">In diesem Monat ist nichts abzurechnen.</td></tr>}
            {bill.groups.map((g) => [
              <tr key={g.customer} style={{ background: "var(--bg-soft, rgba(0,0,0,.03))" }}>
                <td colSpan={5}><strong>{g.customer}</strong> <span className="small muted">· {g.lines.length} Paletten</span></td>
                <td className="num right"><strong>{formatEuro(g.total)}</strong></td>
              </tr>,
              ...g.lines.map((l) => (
                <tr key={l.pallet.id}>
                  <td className="num" style={{ paddingLeft: 24 }}>{l.pallet.code}</td>
                  <td className="num">{formatDate(l.pallet.inAt)}</td>
                  <td className="num">{formatDate(chargeableFrom(l.pallet.inAt, rates.freeDays))}</td>
                  <td className="num">{l.pallet.outAt ? formatDate(l.pallet.outAt) : <span className="muted">noch da</span>}</td>
                  <td className="num right">{l.days}</td>
                  <td className="num right">{formatEuro(l.amount)}</td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </section>

      <section className="card" id="ausgelagert">
        <div className="card-head"><h2>Zuletzt ausgelagert</h2><span className="small muted">Versehentlich ausgelagert? „Zurück ins Lager“</span></div>
        <table className="table">
          <thead><tr><th>Palette</th><th>Kunde</th><th>Eingelagert</th><th>Ausgelagert</th><th className="right">Tage</th><th></th></tr></thead>
          <tbody>
            {recentOut.length === 0 && <tr><td colSpan={6} className="muted">Noch keine Palette ausgelagert.</td></tr>}
            {recentOut.map((p) => (
              <tr key={p.id}>
                <td className="num">{p.code}</td>
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

      {session.role === "owner" && (
        <section className="card card-pad stack">
          <h2>Preise</h2>
          <form action={savePalletRates} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="field"><label className="label" htmlFor="r-price">Preis je Stellplatz und Monat (€)</label><input className="input" id="r-price" name="pricePerMonth" inputMode="decimal" defaultValue={String(rates.pricePerMonth).replace(".", ",")} style={{ width: 120 }} /></div>
            <div className="field"><label className="label" htmlFor="r-free">Kostenfreie Tage</label><input className="input" id="r-free" name="freeDays" type="number" min={0} max={365} defaultValue={rates.freeDays} style={{ width: 100 }} /></div>
            <div className="field">
              <label className="label" htmlFor="r-mode">Abrechnung</label>
              <select className="select" id="r-mode" name="mode" defaultValue={rates.mode}>
                <option value="monat">Voller Monatspreis je angefangenem Monat</option>
                <option value="anteilig">Tagesgenau anteilig</option>
              </select>
            </div>
            <button className="btn" type="submit">Speichern</button>
          </form>
          <div className="small muted">Einlagerungstag = Tag 1, der Auslagerungstag zählt mit. Bei {rates.freeDays} freien Tagen kostet eine Palette ab Tag {rates.freeDays + 1}.</div>
        </section>
      )}
    </>
  );
}
