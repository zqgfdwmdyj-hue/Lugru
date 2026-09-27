import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { ImportForm } from "./import-form";

const SOURCE_LABEL: Record<string, string> = {
  sellerboard: "Sellerboard-Export",
  accountone: "AccountOne COG",
  template: "Eigene Vorlage",
};

export default async function EinkaufPage() {
  const session = await requireSession();
  const runs = await db
    .select({
      id: schema.importRuns.id,
      source: schema.importRuns.source,
      fileName: schema.importRuns.fileName,
      stats: schema.importRuns.stats,
      createdAt: schema.importRuns.createdAt,
      user: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.importRuns)
    .leftJoin(schema.users, eq(schema.users.id, schema.importRuns.userId))
    .where(eq(schema.importRuns.tenantId, session.tenantId))
    .orderBy(desc(schema.importRuns.createdAt))
    .limit(20);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Einkauf</div>
          <h1>Import aus Arbitrage One</h1>
        </div>
      </div>
      <ImportForm />
      <section className="card" style={{ overflow: "hidden" }}>
        <div className="card-head"><h2>Letzte Importe</h2></div>
        {runs.length === 0 ? (
          <div className="card-pad muted">Noch keine Importe.</div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Zeitpunkt</th><th>Datei</th><th>Art</th><th className="right">Zeilen</th><th className="right">Neu</th><th className="right">Aktualisiert</th><th>Von</th></tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const s = r.stats as { rows?: number; created?: number; updated?: number };
                return (
                  <tr key={r.id}>
                    <td className="num">{r.createdAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}</td>
                    <td>{r.fileName}</td>
                    <td>{SOURCE_LABEL[r.source] ?? r.source}</td>
                    <td className="num right">{s.rows ?? "–"}</td>
                    <td className="num right">{s.created ?? "–"}</td>
                    <td className="num right">{s.updated ?? "–"}</td>
                    <td>{r.user ?? r.email ?? "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
