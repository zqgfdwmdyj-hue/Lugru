import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { formatDate, formatEuro } from "@/lib/numbers";
import { chargeableFrom, customerKey, freeLocations, normalizeLocation, storedDays } from "@/lib/pallets/billing";
import { MONTH_RE, activePickupsFor, palletContext, palletPhotos } from "@/lib/pallets/service";
import { ConfirmButton } from "@/components/confirm-button";
import { cancelPallet, checkOutPallet, undoCheckOut } from "./actions";
import { PalletScan } from "./scan";
import { Occupancy } from "./tabs";

const kg = (n: number | null) => (n ? `${String(n).replace(".", ",")} kg` : "");

export default async function PalettenPage({ searchParams }: { searchParams: Promise<{ monat?: string; kunde?: string; platz?: string; aktion?: string; code?: string }> }) {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const sp = await searchParams;
  // Alte Links auf die Abrechnung (/paletten?monat=…#abrechnung) führen in die eigene Ansicht.
  if (sp.monat && MONTH_RE.test(sp.monat)) redirect(`/paletten/abrechnung?monat=${sp.monat}`);
  const today = todayIso();
  const kunde = (sp.kunde ?? "").trim().slice(0, 120);
  const P = schema.pallets;
  const ctx = await palletContext(t);
  const rates = { ...ctx.settings, capacity: ctx.settings.capacity || (ctx.settings.locations?.length ?? 0) };

  const allOpen = await db.select().from(P).where(and(eq(P.tenantId, t), isNull(P.outAt), isNull(P.cancelledAt))).orderBy(P.inAt, P.code);
  const open = kunde ? allOpen.filter((p) => customerKey(p.customer) === customerKey(kunde)) : allOpen;
  const recentOut = await db.select().from(P).where(and(eq(P.tenantId, t), isNotNull(P.outAt))).orderBy(desc(P.updatedAt)).limit(30);
  const pickups = await activePickupsFor(t, recentOut.filter((p) => !p.cancelledAt).map((p) => p.id));
  const used = (await db.selectDistinct({ c: P.customer }).from(P).where(and(eq(P.tenantId, t), isNotNull(P.customer)))).map((r) => r.c!.trim());
  const byKey = new Map<string, string>();
  for (const n of [...ctx.customers.map((c) => c.name), ...used]) if (n && !byKey.has(customerKey(n))) byKey.set(customerKey(n), n);
  const customers = [...byKey.values()].sort((a, b) => a.localeCompare(b, "de"));
  const locations = [...new Set((await db.selectDistinct({ l: P.location }).from(P).where(and(eq(P.tenantId, t), isNotNull(P.location)))).map((r) => r.l!))].sort((a, b) => a.localeCompare(b, "de", { numeric: true }));
  const photos = await palletPhotos(t, open.map((p) => p.id));
  const chargeableNow = allOpen.filter((p) => chargeableFrom(p.inAt, ctx.ratesOf(p.customer).freeDays) <= today).length;
  const occupiedLocations = new Map<string, number>();
  for (const p of allOpen) if (p.location) occupiedLocations.set(p.location, (occupiedLocations.get(p.location) ?? 0) + 1);
  const free = freeLocations(rates.locations ?? [], allOpen.map((p) => p.location));
  const mode = sp.aktion === "aus" || sp.aktion === "suchen" || sp.aktion === "ein" ? sp.aktion : undefined;
  // Auslastung: mit festgelegter Zahl an Stellplätzen nach Paletten, sonst nach belegten Plätzen im Lagerplan.
  const plan = rates.locations ?? [];
  const occ = ctx.settings.capacity
    ? { used: allOpen.length, free: Math.max(0, ctx.settings.capacity - allOpen.length), withoutPlace: 0 }
    : { used: plan.length - free.length, free: free.length, withoutPlace: allOpen.filter((p) => !p.location || !plan.includes(p.location)).length };

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Lager</div><h1>Paletten-Lager</h1></div>
        <span className="small muted">{formatEuro(rates.pricePerMonth)} je Stellplatz und Monat · {rates.freeDays} Tage frei · <Link href="/paletten/abrechnung">Abrechnung</Link></span>
      </div>

      <nav className="pal-actions" aria-label="Lagerarbeit" data-testid="pal-actions">
        <Link href="/paletten?aktion=ein#scan" className={`pal-action${mode === "ein" ? " active" : ""}`}><span aria-hidden="true">⬇</span>Einlagern</Link>
        <Link href="/paletten/abholung" className="pal-action"><span aria-hidden="true">⬆</span>Auslagern / Abholung</Link>
        <Link href="/paletten?aktion=suchen#scan" className={`pal-action${mode === "suchen" ? " active" : ""}`}><span aria-hidden="true">🔍</span>Palette suchen</Link>
        <Link href="/paletten/inventur" className="pal-action"><span aria-hidden="true">☑</span>Inventur</Link>
      </nav>

      <div className="grid-kpi" data-testid="pal-stock">
        <div className="card card-pad">
          <div className="kpi-label">Bestand (Paletten eingelagert)</div>
          <div className="kpi-value" data-testid="kpi-open">{allOpen.length}</div>
          {rates.capacity > 0 && (
            <>
              <Occupancy used={occ.used} capacity={rates.capacity} />
              <div className="small muted" data-testid="kpi-capacity">
                {occ.used} von {rates.capacity} Stellplätzen belegt · {occ.free} frei ({Math.round((occ.used / rates.capacity) * 100)} %)
                {occ.withoutPlace ? ` · ${occ.withoutPlace} Palette${occ.withoutPlace === 1 ? "" : "n"} ohne Platz im Plan` : ""}
              </div>
            </>
          )}
        </div>
        <div className="card card-pad"><div className="kpi-label">Freie Stellplätze</div><div className="kpi-value">{rates.locations?.length ? free.length : "–"}</div><div className="small muted" data-testid="plan-setup">{rates.locations?.length ? free.slice(0, 6).join(", ") + (free.length > 6 ? " …" : "") : session.role === "owner" ? <Link href="/paletten/lagerplan#einrichten">Lagerplan einrichten</Link> : "Noch kein Lagerplan – den legt der Inhaber an (Lagerplan → Einrichten)."}</div></div>
        <div className="card card-pad"><div className="kpi-label">Davon kostenpflichtig</div><div className="kpi-value">{chargeableNow}</div><div className="small muted">{allOpen.length - chargeableNow} noch in der freien Zeit</div></div>
      </div>

      <div id="scan">
        <PalletScan key={mode ?? "x"} customers={customers} locations={[...new Set([...(rates.locations ?? []), ...locations])]} today={today} free={free} plan={rates.locations ?? []} initialLocation={normalizeLocation(sp.platz) ?? undefined} initialMode={mode} initialCode={sp.code?.slice(0, 80)} />
      </div>

      <section className="card" id="lager">
        <div className="card-head">
          <h2>Aktuell eingelagert ({open.length})</h2>
          <form method="get" action="/paletten#lager" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <label className="sr-only" htmlFor="f-kunde">Kunde</label>
            <select className="select" id="f-kunde" name="kunde" defaultValue={kunde}>
              <option value="">Alle Kunden</option>
              {customers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button className="btn btn-small" type="submit">Filtern</button>
            {open.length > 0 && <a className="btn btn-small" href={`/etikett/palette?codes=${encodeURIComponent(open.map((p) => p.code).join(","))}`} target="_blank" rel="noreferrer">Etiketten</a>}
          </form>
        </div>
        <table className="table sticky-head">
          <thead><tr><th>Palette</th><th>Kunde</th><th>Stellplatz</th><th></th><th>Kosten</th><th>Eingelagert</th><th className="right">Tage</th></tr></thead>
          <tbody>
            {open.length === 0 && <tr><td colSpan={7} className="muted">Keine Paletten eingelagert. Oben „Einlagern“ wählen und scannen oder Nummer eingeben.</td></tr>}
            {open.map((p) => {
              const r = ctx.ratesOf(p.customer);
              const from = chargeableFrom(p.inAt, r.freeDays);
              const isFree = from > today;
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
                    {p.location && (occupiedLocations.get(p.location) ?? 0) > 1 && <span className="tag tag-warn" style={{ marginLeft: 4 }} title="Mehrere Paletten auf diesem Stellplatz">⚠ {occupiedLocations.get(p.location)}×</span>}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <form action={checkOutPallet}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="btn btn-small btn-primary" type="submit" title="Palette ist heute raus – Timer stoppen">Ist raus</button>
                      </form>
                      <Link className="btn btn-small" href={`/paletten/${p.id}`}>Details</Link>
                    </div>
                  </td>
                  <td>{isFree ? <span className="tag tag-ok">frei bis {formatDate(chargeableFrom(p.inAt, r.freeDays - 1))}</span> : <span className="tag tag-warn">kostenpflichtig seit {formatDate(from)}</span>}</td>
                  <td className="num">{formatDate(p.inAt)}</td>
                  <td className="num right">{storedDays(p, today)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card" id="ausgelagert">
        <div className="card-head"><h2>Zuletzt ausgelagert</h2><span className="small muted">Versehentlich gebucht? „Zurück ins Lager“ oder „Stornieren“ – beides steht im Verlauf.</span></div>
        <table className="table">
          <thead><tr><th>Palette</th><th>Kunde</th><th>Eingelagert</th><th>Ausgelagert</th><th className="right">Tage</th><th></th></tr></thead>
          <tbody>
            {recentOut.length === 0 && <tr><td colSpan={6} className="muted">Noch keine Palette ausgelagert.</td></tr>}
            {recentOut.map((p) => (
              <tr key={p.id} data-testid="out-row">
                <td className="num"><Link href={`/paletten/${p.id}`}>{p.code}</Link>{p.cancelledAt ? <span className="tag tag-danger" style={{ marginLeft: 6 }}>storniert</span> : null}</td>
                <td>{p.customer ?? "–"}</td>
                <td className="num">{formatDate(p.inAt)}</td>
                <td className="num">{p.cancelledAt ? "–" : formatDate(p.outAt)}</td>
                <td className="num right">{p.cancelledAt ? "–" : storedDays(p, today)}</td>
                <td>
                  {!p.cancelledAt && pickups.get(p.id) ? (
                    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }} data-testid="out-in-pickup">
                      <a className="btn btn-small" href={`/paletten/abholschein/${pickups.get(p.id)!.id}`} target="_blank" rel="noreferrer" title={`Abgeholt von ${pickups.get(p.id)!.pickedBy} – Rücknahme nur für die ganze Abholung`}>Abholschein</a>
                    </div>
                  ) : !p.cancelledAt && (
                    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                      <form action={undoCheckOut}><input type="hidden" name="id" value={p.id} /><button className="btn btn-small" type="submit">Zurück ins Lager</button></form>
                      <form action={cancelPallet}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="reason" value="Fehlbuchung" />
                        <ConfirmButton className="btn btn-small" confirm={`Palette ${p.code} als Fehlbuchung stornieren? Sie zählt dann nirgends mehr, der Verlauf bleibt erhalten.`}>Stornieren</ConfirmButton>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
