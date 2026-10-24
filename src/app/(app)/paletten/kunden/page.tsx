import Link from "next/link";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { formatEuro } from "@/lib/numbers";
import { customerKey, servicesText } from "@/lib/pallets/billing";
import { palletContext } from "@/lib/pallets/service";
import { deletePalletCustomer } from "../actions";
import { CustomerForm, RatesForm } from "../forms";
import { PalletTabs } from "../tabs";

export default async function PalettenKundenPage() {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const owner = session.role === "owner";
  const ctx = await palletContext(t);
  const s = ctx.settings;
  const P = schema.pallets;
  const open = await db.select({ customer: P.customer }).from(P).where(and(eq(P.tenantId, t), isNull(P.outAt)));
  const used = (await db.selectDistinct({ c: P.customer }).from(P).where(and(eq(P.tenantId, t), isNotNull(P.customer)))).map((r) => r.c!.trim()).filter(Boolean);
  const openBy = new Map<string, number>();
  for (const p of open) openBy.set(customerKey(p.customer), (openBy.get(customerKey(p.customer)) ?? 0) + 1);

  // Alle Kunden: mit eigenen Konditionen und alle, die schon Paletten hatten.
  const rows = new Map<string, { name: string; row: (typeof ctx.customers)[number] | null }>();
  for (const c of ctx.customers) rows.set(customerKey(c.name), { name: c.name, row: c });
  for (const n of used) if (!rows.has(customerKey(n))) rows.set(customerKey(n), { name: n, row: null });
  const list = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
  const defaults = { pricePerMonth: s.pricePerMonth, freeDays: s.freeDays, mode: s.mode, inFee: s.inFee, outFee: s.outFee };
  const own = (v: unknown) => v !== null && v !== undefined;
  const month = todayIso().slice(0, 7);
  const ym = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
  const histLine = (h: { until: string; pricePerMonth: number | null; freeDays: number | null; mode: string | null; inFee: number | null; outFee: number | null }) =>
    `bis ${ym(h.until)}: ${h.pricePerMonth === null ? "Standard" : `${formatEuro(h.pricePerMonth)}/Monat`}${h.freeDays !== null ? `, ${h.freeDays} T. frei` : ""}${h.mode ? `, ${h.mode === "monat" ? "je Monat" : "anteilig"}` : ""}${h.inFee ? `, Ein ${formatEuro(h.inFee)}` : ""}${h.outFee ? `, Aus ${formatEuro(h.outFee)}` : ""}`;

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Lager</div><h1>Paletten-Lager</h1></div>
      </div>
      <PalletTabs active="kunden" />

      <section className="card" id="kunden">
        <div className="card-head"><h2>Kunden ({list.length})</h2><span className="small muted">Leere Felder = Standard. Fett = eigene Kondition.</span></div>
        <table className="table" data-testid="customers">
          <thead><tr><th>Kunde</th><th className="right">Im Lager</th><th className="right">€/Monat</th><th className="right">Frei</th><th className="right">Ein / Aus</th><th>Monatsaufstellung</th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={6} className="muted">Noch keine Kunden – sie entstehen beim Einlagern oder hier unten.</td></tr>}
            {list.map(({ name, row }) => {
              const r = ctx.ratesOf(name);
              return [
                <tr key={name} data-testid="customer-row">
                  <td>
                    <strong>{name}</strong>
                    <div className="small"><Link href={`/paletten?kunde=${encodeURIComponent(name)}#lager`}>Paletten ansehen</Link></div>
                  </td>
                  <td className="num right">{openBy.get(customerKey(name)) ?? 0}</td>
                  <td className="num right" style={{ fontWeight: own(row?.pricePerMonth) ? 700 : 400 }}>{formatEuro(r.pricePerMonth)}{r.mode === "anteilig" ? " ant." : ""}</td>
                  <td className="num right" style={{ fontWeight: own(row?.freeDays) ? 700 : 400 }}>{r.freeDays} T.</td>
                  <td className="num right" style={{ fontWeight: own(row?.inFee) || own(row?.outFee) ? 700 : 400 }}>{formatEuro(r.inFee)} / {formatEuro(r.outFee)}</td>
                  <td className="small">
                    {row?.email ? <>{row.email}{row.monthlyMail ? <span className="tag tag-ok" style={{ marginLeft: 6 }}>automatisch</span> : null}</> : <span className="muted">keine E-Mail</span>}
                    {row?.rateHistory?.length ? <div className="muted" data-testid="customer-history">Früher: {[...row.rateHistory].reverse().map(histLine).join(" · ")}</div> : null}
                  </td>
                </tr>,
                owner ? (
                  <tr key={`${name}-edit`}>
                    <td colSpan={6} style={{ paddingTop: 0 }}>
                      <details>
                        <summary className="small" style={{ cursor: "pointer" }}>Konditionen & E-Mail ändern</summary>
                        <div style={{ padding: "10px 0" }}>
                          <CustomerForm customer={{ id: row?.id, name, email: row?.email ?? null, pricePerMonth: row?.pricePerMonth ?? null, freeDays: row?.freeDays ?? null, mode: row?.mode ?? null, inFee: row?.inFee ?? null, outFee: row?.outFee ?? null, monthlyMail: row?.monthlyMail ?? false }} defaults={defaults} month={month} />
                          {row && (
                            <form action={deletePalletCustomer} style={{ marginTop: 8 }}>
                              <input type="hidden" name="id" value={row.id} />
                              <button className="btn-link small" type="submit" style={{ color: "var(--danger)" }}>Eigene Konditionen und E-Mail entfernen (wieder Standard)</button>
                            </form>
                          )}
                        </div>
                      </details>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
        {owner && (
          <details className="card-pad">
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>+ Kunde anlegen</summary>
            <div style={{ paddingTop: 10 }}><CustomerForm customer={null} defaults={defaults} month={month} /></div>
          </details>
        )}
      </section>

      <section className="card card-pad stack" style={{ gap: 12 }} id="standard">
        <h2>Standard-Konditionen & Einstellungen</h2>
        {owner ? (
          <RatesForm rates={{ ...defaults, capacity: s.capacity, longStayDays: s.longStayDays, remindFreeEnd: s.remindFreeEnd, servicesText: servicesText(s.services), locationsSpec: s.locationsSpec ?? "", locationsCount: s.locations?.length ?? 0, pricesAre: s.pricesAre ?? "netto", month }} />
        ) : (
          <div className="small">
            {formatEuro(s.pricePerMonth)} je Stellplatz und Monat · {s.freeDays} Tage frei · Einlagern {formatEuro(s.inFee)} · Auslagern {formatEuro(s.outFee)}
            {s.capacity ? ` · ${s.capacity} Stellplätze` : ""}. Ändern kann der Inhaber.
          </div>
        )}
        {s.rateHistory?.length ? <div className="small" data-testid="rates-history"><strong>Frühere Standard-Konditionen:</strong> {[...s.rateHistory].reverse().map(histLine).join(" · ")}</div> : null}
        <div className="small muted">
          Preise sind {s.pricesAre === "brutto" ? "brutto (inkl. USt)" : "netto (zzgl. USt)"}. Abrechnung je Kalendermonat: {s.mode === "monat" ? "voller Monatspreis, sobald im Monat mindestens ein kostenpflichtiger Tag liegt" : "tagesgenau anteilig (Monatspreis ÷ Tage des Monats × kostenpflichtige Tage)"}. Preisänderungen gelten ab dem gewählten Monat – frühere Monate rechnen mit den damaligen Konditionen.
          Einlagerungstag = Tag 1, der Auslagerungstag zählt mit. Bei {s.freeDays} freien Tagen kostet eine Palette ab Tag {s.freeDays + 1}. Gebühren fürs Ein- und Auslagern kommen in den Monat,
          in dem die Palette rein bzw. raus geht. Zusatzleistungen erfasst du unter „Lager“ → Abrechnung oder auf der Seite einer Palette.
        </div>
      </section>
    </>
  );
}
