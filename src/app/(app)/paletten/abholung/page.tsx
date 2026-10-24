import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { formatDate } from "@/lib/numbers";
import { PalletTabs } from "../tabs";
import { PickupForm } from "./pickup-form";

export default async function AbholungPage({ searchParams }: { searchParams: Promise<{ kunde?: string }> }) {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const sp = await searchParams;
  const P = schema.pallets;
  const open = await db.select({ id: P.id, code: P.code, customer: P.customer, location: P.location, contents: P.contents }).from(P).where(and(eq(P.tenantId, t), isNull(P.outAt))).orderBy(P.customer, P.code);
  const customers = [...new Set(open.map((p) => p.customer ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
  const PU = schema.palletPickups;
  const recent = await db.select().from(PU).where(eq(PU.tenantId, t)).orderBy(desc(PU.createdAt)).limit(20);

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Lager</div><h1>Paletten-Lager</h1></div>
        <span className="small muted">Mehrere Paletten auf einmal ausgeben – der Fahrer unterschreibt auf dem Handy, der Abholschein ist sofort fertig.</span>
      </div>
      <PalletTabs active="abholung" />
      <section className="card card-pad stack">
        <h2>Abholung</h2>
        <PickupForm pallets={open} customers={customers} today={todayIso()} preselect={sp.kunde && customers.includes(sp.kunde) ? sp.kunde : undefined} />
      </section>
      <section className="card">
        <div className="card-head"><h2>Letzte Abholungen</h2></div>
        <table className="table" data-testid="pickups">
          <thead><tr><th>Datum</th><th>Kunde</th><th>Abgeholt von</th><th className="right">Paletten</th><th></th></tr></thead>
          <tbody>
            {recent.length === 0 && <tr><td colSpan={5} className="muted">Noch keine Abholung.</td></tr>}
            {recent.map((r) => (
              <tr key={r.id}>
                <td className="num">{formatDate(r.day)}</td>
                <td>{r.customer ?? "–"}</td>
                <td>{r.pickedBy}{r.plate ? <span className="muted"> · {r.plate}</span> : null}</td>
                <td className="num right" title={r.codes.join(", ")}>{r.codes.length}</td>
                <td className="right"><a className="btn btn-small" href={`/paletten/abholschein/${r.id}`} target="_blank" rel="noreferrer">Abholschein</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
