import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { formatDate } from "@/lib/numbers";
import { ConfirmButton } from "@/components/confirm-button";
import { cancelPickupAction } from "../actions";
import { PickupForm } from "./pickup-form";

export default async function AbholungPage({ searchParams }: { searchParams: Promise<{ kunde?: string }> }) {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const sp = await searchParams;
  const P = schema.pallets;
  const open = await db.select({ id: P.id, code: P.code, customer: P.customer, location: P.location, contents: P.contents }).from(P).where(and(eq(P.tenantId, t), isNull(P.outAt), isNull(P.cancelledAt))).orderBy(P.customer, P.code);
  // Für verständliche Meldungen beim Scannen: schon ausgelagerte oder stornierte Nummern.
  const gone = (await db.select({ code: P.code, outAt: P.outAt, cancelled: P.cancelledAt }).from(P).where(and(eq(P.tenantId, t), isNotNull(P.outAt))).orderBy(desc(P.outAt)).limit(2000)).map((g) => ({ code: g.code, outAt: g.outAt!, cancelled: Boolean(g.cancelled) }));
  const customers = [...new Set(open.map((p) => p.customer ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
  const PU = schema.palletPickups;
  const recent = await db.select().from(PU).where(eq(PU.tenantId, t)).orderBy(desc(PU.createdAt)).limit(20);

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Lager</div><h1>Paletten-Lager</h1></div>
        <span className="small muted">Mehrere Paletten auf einmal ausgeben – der Fahrer unterschreibt auf dem Handy, der Abholschein ist sofort fertig.</span>
      </div>
      <section className="card card-pad stack">
        <h2>Abholung</h2>
        <PickupForm pallets={open} gone={gone} customers={customers} today={todayIso()} preselect={sp.kunde && customers.includes(sp.kunde) ? sp.kunde : undefined} />
      </section>
      <section className="card">
        <div className="card-head"><h2>Letzte Abholungen</h2></div>
        <table className="table" data-testid="pickups" id="abholungen">
          <thead><tr><th>Datum</th><th>Kunde</th><th>Abgeholt von</th><th className="right">Paletten</th><th></th></tr></thead>
          <tbody>
            {recent.length === 0 && <tr><td colSpan={5} className="muted">Noch keine Abholung.</td></tr>}
            {recent.map((r) => (
              <tr key={r.id} data-testid="pickup-row">
                <td className="num">{formatDate(r.day)}</td>
                <td>{r.customer ?? "–"}{r.cancelledAt ? <span className="tag tag-danger" style={{ marginLeft: 6 }} title={r.cancelReason ?? ""}>zurückgenommen</span> : null}</td>
                <td>{r.pickedBy}{r.plate ? <span className="muted"> · {r.plate}</span> : null}</td>
                <td className="num right" title={r.codes.join(", ")}>{r.codes.length}</td>
                <td className="right">
                  <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", flexWrap: "wrap" }}>
                    <a className="btn btn-small" href={`/paletten/abholschein/${r.id}`} target="_blank" rel="noreferrer">Abholschein</a>
                    {!r.cancelledAt && (
                      <form action={cancelPickupAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <ConfirmButton className="btn btn-small" confirm={`Abholung vom ${formatDate(r.day)} (${r.codes.length} Paletten) zurücknehmen? Die Paletten sind dann wieder im Lager, der Abholschein wird als zurückgenommen markiert.`} testid="pickup-cancel">Zurücknehmen</ConfirmButton>
                      </form>
                    )}
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
