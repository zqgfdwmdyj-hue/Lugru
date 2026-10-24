import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { freeLocations, locationRows, storedDays } from "@/lib/pallets/billing";
import { getSettings } from "@/lib/settings";
import { Occupancy, PalletTabs } from "../tabs";

export default async function LagerplanPage() {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const today = todayIso();
  const s = (await getSettings(t)).pallets;
  const P = schema.pallets;
  const open = await db.select().from(P).where(and(eq(P.tenantId, t), isNull(P.outAt))).orderBy(P.code);
  const byPlace = new Map<string, typeof open>();
  for (const p of open) if (p.location) byPlace.set(p.location, [...(byPlace.get(p.location) ?? []), p]);
  const plan = s.locations ?? [];
  const free = freeLocations(plan, open.map((p) => p.location));
  const outside = open.filter((p) => !p.location || !plan.includes(p.location));
  const capacity = s.capacity || plan.length;

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Lager</div><h1>Paletten-Lager</h1></div>
        <span className="small muted">Grün = frei (antippen zum Einlagern), dunkel = belegt (antippen für die Palette).</span>
      </div>
      <PalletTabs active="lagerplan" />

      {plan.length === 0 ? (
        <div className="notice notice-info">
          Noch kein Lagerplan angelegt. Unter <Link href="/paletten/kunden#standard">Kunden & Preise → Standard-Konditionen</Link> bei „Stellplätze (Lagerplan)“ z. B. <code>A-01..A-20</code> und <code>B-01..B-20</code> eintragen.
        </div>
      ) : (
        <>
          <div className="grid-kpi">
            <div className="card card-pad"><div className="kpi-label">Belegt</div><div className="kpi-value" data-testid="plan-used">{plan.length - free.length} / {plan.length}</div><Occupancy used={plan.length - free.length} capacity={plan.length} /></div>
            <div className="card card-pad"><div className="kpi-label">Frei</div><div className="kpi-value" data-testid="plan-free">{free.length}</div><div className="small muted">{free.slice(0, 6).join(", ")}{free.length > 6 ? " …" : ""}</div></div>
            <div className="card card-pad"><div className="kpi-label">Ohne Platz im Plan</div><div className="kpi-value">{outside.length}</div><div className="small muted">{capacity ? `${open.length} von ${capacity} Stellplätzen gesamt` : ""}</div></div>
          </div>
          {locationRows(plan).map((r) => (
            <section key={r.row} className="card card-pad stack" style={{ gap: 8 }}>
              <h2 style={{ fontSize: 16 }}>Reihe {r.row}</h2>
              <div className="plan-grid" data-testid="plan-row">
                {r.places.map((place) => {
                  const here = byPlace.get(place) ?? [];
                  if (!here.length) {
                    return <Link key={place} href={`/paletten?platz=${encodeURIComponent(place)}`} className="plan-cell plan-free" title={`${place} frei – hier einlagern`}><strong>{place}</strong><span>frei</span></Link>;
                  }
                  const p = here[0];
                  return (
                    <Link key={place} href={`/paletten/${p.id}`} className={`plan-cell plan-used${here.length > 1 ? " plan-double" : ""}`} title={`${place}: ${here.map((x) => x.code).join(", ")}`}>
                      <strong>{place}</strong>
                      <span>{p.code}{here.length > 1 ? ` +${here.length - 1}` : ""}</span>
                      <span className="plan-sub">{p.customer ?? "–"} · {storedDays(p, today)} T.</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}

      {outside.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>Paletten ohne Platz im Lagerplan ({outside.length})</h2></div>
          <table className="table">
            <tbody>
              {outside.map((p) => (
                <tr key={p.id}>
                  <td className="num"><Link href={`/paletten/${p.id}`}><strong>{p.code}</strong></Link></td>
                  <td>{p.location ?? <span className="muted">kein Stellplatz</span>}</td>
                  <td>{p.customer ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
