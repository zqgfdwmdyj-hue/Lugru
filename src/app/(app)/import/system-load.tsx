import { desc, eq, isNotNull, and } from "drizzle-orm";
import { db, schema } from "@/db";
import { lagLevel, perfSnapshot } from "@/lib/perf";

const sec = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 6000) / 10} min` : ms >= 1000 ? `${Math.round(ms / 100) / 10} s` : `${ms} ms`);
const hhmm = (t: number) => new Date(t).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

/**
 * Serverlast: Wie lange mussten Seiten in der letzten Stunde auf den Server warten, und welche Hintergrund-
 * Abrufe liefen dabei bzw. dauern am längsten? Hilft bei „das Tool ist langsam“.
 */
export async function SystemLoad({ tenantId }: { tenantId: string }) {
  const J = schema.jobRuns;
  const jobs = await db
    .select({ name: J.name, ms: J.lastDurationMs, at: J.updatedAt })
    .from(J)
    .where(and(eq(J.tenantId, tenantId), isNotNull(J.lastDurationMs)))
    .orderBy(desc(J.lastDurationMs))
    .limit(8);
  const p = perfSnapshot();
  const worst = p?.worst ?? null;
  const level = worst ? lagLevel(worst.maxMs) : "ok";
  return (
    <section className="card card-pad stack" id="serverlast" data-testid="system-load">
      <h2>Serverlast (letzte Stunde)</h2>
      {!p || p.minutes.length === 0 ? (
        <div className="small muted">Messung läuft seit dem letzten Neustart – Werte erscheinen nach der ersten Minute.</div>
      ) : (
        <div className="small">
          <span className={`tag ${level === "ok" ? "tag-ok" : level === "spuerbar" ? "tag-warn" : "tag-danger"}`}>{level === "ok" ? "flüssig" : level === "spuerbar" ? "spürbar verzögert" : "deutlich verzögert"}</span>{" "}
          Längste Wartezeit {sec(worst!.maxMs)} ({hhmm(worst!.at)}){worst!.jobs.length ? ` – dabei liefen: ${worst!.jobs.join(", ")}` : ""}. In {p.slowMinutes} von {p.minutes.length} Minuten über 250 ms.
          {p.running.length > 0 && <div className="muted">Läuft gerade: {p.running.join(", ")}</div>}
        </div>
      )}
      {jobs.length > 0 && (
        <details>
          <summary className="small" style={{ cursor: "pointer" }}>Längste Hintergrund-Abrufe (letzter Lauf)</summary>
          <table className="table" style={{ marginTop: 6 }}>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.name}><td className="small">{j.name}</td><td className="num right small">{sec(j.ms ?? 0)}</td><td className="small muted">{j.at.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <div className="small muted">Die Wartezeit misst, wie lange der Server mit etwas anderem beschäftigt war, bevor er eine Seite bearbeiten konnte (unter 0,1 s ist flüssig).</div>
    </section>
  );
}
