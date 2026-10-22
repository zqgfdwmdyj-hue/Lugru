import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { formatDate, formatEuro } from "@/lib/numbers";
import { chargeableFrom, customerKey, storedDays } from "@/lib/pallets/billing";
import { palletContext, palletPhotos } from "@/lib/pallets/service";
import { checkOutPallet, deleteCharge, deletePallet, deletePalletPhoto, undoCheckOut, updatePallet } from "../actions";
import { ChargeForm } from "../forms";
import { AddPhotos } from "../photos";
import { PalletTabs } from "../tabs";

export default async function PaletteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const P = schema.pallets;
  const [p] = await db.select().from(P).where(and(eq(P.id, id), eq(P.tenantId, t)));
  if (!p) notFound();
  const today = todayIso();
  const ctx = await palletContext(t);
  const r = ctx.ratesOf(p.customer);
  const from = chargeableFrom(p.inAt, r.freeDays);
  const photos = (await palletPhotos(t, [p.id])).get(p.id) ?? [];
  const charges = await db.select().from(schema.palletCharges).where(and(eq(schema.palletCharges.tenantId, t), eq(schema.palletCharges.palletId, p.id))).orderBy(desc(schema.palletCharges.day));
  const used = (await db.selectDistinct({ c: P.customer }).from(P).where(and(eq(P.tenantId, t), isNotNull(P.customer)))).map((x) => x.c!.trim());
  const byKey = new Map<string, string>();
  for (const n of [...ctx.customers.map((c) => c.name), ...used]) if (n && !byKey.has(customerKey(n))) byKey.set(customerKey(n), n);
  const customers = [...byKey.values()].sort((a, b) => a.localeCompare(b, "de"));
  const neighbours = p.location && !p.outAt
    ? await db.select({ id: P.id, code: P.code }).from(P).where(and(eq(P.tenantId, t), isNull(P.outAt), eq(P.location, p.location)))
    : [];
  const others = neighbours.filter((n) => n.id !== p.id);

  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/paletten">Paletten-Lager</Link></div><h1 className="num">{p.code}</h1></div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <a className="btn btn-small" href={`/etikett/palette?codes=${encodeURIComponent(p.code)}`} target="_blank" rel="noreferrer">Etikett</a>
          {p.outAt ? (
            <form action={undoCheckOut}><input type="hidden" name="id" value={p.id} /><button className="btn btn-small" type="submit">Zurück ins Lager</button></form>
          ) : (
            <form action={checkOutPallet}><input type="hidden" name="id" value={p.id} /><button className="btn btn-small btn-primary" type="submit">Ist raus</button></form>
          )}
        </div>
      </div>
      <PalletTabs active="lager" />

      <div className="grid-kpi">
        <div className="card card-pad"><div className="kpi-label">Stellplatz</div><div className="kpi-value num" data-testid="detail-location">{p.location ?? "–"}</div>{others.length > 0 && <div className="small" style={{ color: "var(--warn)" }}>auch dort: {others.map((o) => o.code).join(", ")}</div>}</div>
        <div className="card card-pad"><div className="kpi-label">Kunde</div><div className="kpi-value" style={{ fontSize: 20 }}>{p.customer ?? "–"}</div><div className="small muted">{formatEuro(r.pricePerMonth)}/Monat · {r.freeDays} Tage frei</div></div>
        <div className="card card-pad"><div className="kpi-label">{p.outAt ? "Stand" : "Im Lager"}</div><div className="kpi-value">{storedDays(p, today)} {storedDays(p, today) === 1 ? "Tag" : "Tage"}</div><div className="small muted">{p.outAt ? `ausgelagert ${formatDate(p.outAt)}` : from > today ? `frei bis ${formatDate(chargeableFrom(p.inAt, r.freeDays - 1))}` : `kostenpflichtig seit ${formatDate(from)}`}</div></div>
      </div>

      <section className="card card-pad stack" style={{ gap: 12 }}>
        <h2>Daten</h2>
        <form action={updatePallet} className="stack" style={{ gap: 10 }} data-testid="pallet-edit">
          <input type="hidden" name="id" value={p.id} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <div className="field"><label className="label" htmlFor="e-customer">Kunde</label><input className="input" id="e-customer" name="customer" defaultValue={p.customer ?? ""} list="e-customers" /><datalist id="e-customers">{customers.map((c) => <option key={c} value={c} />)}</datalist></div>
            <div className="field"><label className="label" htmlFor="e-location">Stellplatz</label><input className="input" id="e-location" name="location" defaultValue={p.location ?? ""} autoCapitalize="characters" /></div>
            <div className="field"><label className="label" htmlFor="e-weight">Gewicht (kg)</label><input className="input" id="e-weight" name="weightKg" inputMode="decimal" defaultValue={p.weightKg ? String(p.weightKg).replace(".", ",") : ""} /></div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label className="label" htmlFor="e-contents">Inhalt</label><input className="input" id="e-contents" name="contents" defaultValue={p.contents ?? ""} placeholder="z. B. 48 Kartons Shampoo" /></div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label className="label" htmlFor="e-note">Notiz</label><input className="input" id="e-note" name="note" defaultValue={p.note ?? ""} /></div>
            <div className="field"><label className="label" htmlFor="e-in">Eingelagert am</label><input className="input" id="e-in" name="inAt" type="date" defaultValue={p.inAt} max={today} required /></div>
            <div className="field"><label className="label" htmlFor="e-out">Ausgelagert am</label><input className="input" id="e-out" name="outAt" type="date" defaultValue={p.outAt ?? ""} max={today} /></div>
          </div>
          <button className="btn btn-primary" type="submit" style={{ alignSelf: "flex-start" }}>Speichern</button>
        </form>
      </section>

      <section className="card card-pad stack" style={{ gap: 12 }} id="fotos">
        <h2>Fotos ({photos.length})</h2>
        {photos.length > 0 && (
          <div className="pal-thumbs pal-thumbs-lg" data-testid="pallet-photos">
            {photos.map((f) => (
              <div key={f} className="pal-thumb">
                <a href={`/datei/${f}`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/datei/${f}`} alt={`Foto ${p.code}`} loading="lazy" />
                </a>
                <form action={deletePalletPhoto}>
                  <input type="hidden" name="palletId" value={p.id} />
                  <input type="hidden" name="fileId" value={f} />
                  <button type="submit" aria-label="Foto löschen" title="Foto löschen">×</button>
                </form>
              </div>
            ))}
          </div>
        )}
        <AddPhotos palletId={p.id} />
      </section>

      <section className="card card-pad stack" style={{ gap: 12 }} id="leistungen">
        <h2>Zusatzleistungen</h2>
        {charges.length > 0 && (
          <table className="table">
            <tbody>
              {charges.map((c) => (
                <tr key={c.id}>
                  <td className="num">{formatDate(c.day)}</td>
                  <td>{c.description}</td>
                  <td className="num right">{String(c.quantity).replace(".", ",")} × {formatEuro(c.unitPrice)}</td>
                  <td className="num right">{formatEuro(Math.round(c.quantity * c.unitPrice * 100) / 100)}</td>
                  <td className="right"><form action={deleteCharge}><input type="hidden" name="id" value={c.id} /><button className="btn-link small" type="submit" style={{ color: "var(--danger)" }}>löschen</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <ChargeForm customers={customers} services={ctx.settings.services} pallets={[]} today={today} customer={p.customer} pallet={{ id: p.id, code: p.code }} />
      </section>

      {p.outAt && (
        <form action={deletePallet} style={{ marginTop: 4 }}>
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="back" value="1" />
          <button className="btn-link small" type="submit" style={{ color: "var(--danger)" }} title="Eintrag ganz löschen (z. B. Fehlbuchung)">Eintrag löschen</button>
        </form>
      )}
    </>
  );
}
