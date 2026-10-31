import Link from "next/link";
import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "@/db";
import { ALL_TOOLS, RUECKGAENGIG_TAGE, toolByName } from "@/lib/assistant/registry";
import { keinRueckgaengigGrund } from "@/lib/assistant/verlauf-logic";
import { requireSession } from "@/lib/auth/session";
import { rueckgaengigAction } from "./actions";

// Assistent-Verlauf: was der Assistent (Fragefeld) bzw. Claude (Konnektor) geändert hat – mit Auftragstext,
// betroffenen Datensätzen, Stufe und „Rückgängig“ (grüne Aktionen, 7 Tage). Mitarbeiter sehen nur Eigenes.

const zeit = (d: Date) => d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const STUFE = { gruen: ["grün", "tag-ok"], gelb: ["gelb", "tag-warn"], rot: ["rot", "tag-danger"] } as const;

const undoTitel = ALL_TOOLS.filter((t) => t.write && t.undo).map((t) => t.title);

export default async function AssistentVerlaufPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const L = schema.assistantLog;
  const seit = new Date(Date.now() - 30 * 86_400_000);
  const grenze = Date.now() - RUECKGAENGIG_TAGE * 86_400_000;
  const rows = await db
    .select({ id: L.id, at: L.createdAt, tool: L.tool, channel: L.channel, ok: L.ok, summary: L.summary, auftrag: L.auftrag, ids: L.ids, stufe: L.stufe, undo: L.undo, zurueck: L.rueckgaengigAm, userId: L.userId, name: schema.users.name, email: schema.users.email })
    .from(L)
    .leftJoin(schema.users, eq(schema.users.id, L.userId))
    .where(and(eq(L.tenantId, session.tenantId), eq(L.write, true), gte(L.createdAt, seit), session.role === "owner" ? undefined : eq(L.userId, session.userId)))
    .orderBy(desc(L.createdAt))
    .limit(150);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Assistent</div>
          <h1>Assistent-Verlauf</h1>
          <div className="small muted">Änderungen durch den Assistenten im Fragefeld und durch Claude (Konnektor), 30 Tage. {session.role === "owner" ? "Du siehst alle Personen." : "Du siehst deine eigenen."}</div>
          <div className="small muted" data-testid="verlauf-regel">„↩ Rückgängig“ gibt es {RUECKGAENGIG_TAGE} Tage lang für einfache (grüne) Änderungen dieser Werkzeuge: {undoTitel.join(", ")}. Alles andere bitte von Hand zurücknehmen – bei jedem Eintrag steht, warum es keinen Knopf gibt.</div>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-info small" role="status" style={{ marginBottom: 12 }} data-testid="verlauf-meldung">{sp.meldung}</div>}
      {rows.length === 0 ? (
        <div className="card card-pad small muted">Noch keine Änderungen durch den Assistenten.</div>
      ) : (
        <div className="stack" style={{ gap: 8 }} data-testid="verlauf-liste">
          {rows.map((r) => {
            const tool = toolByName(r.tool);
            const darf = tool?.privat ? r.userId === session.userId : session.role === "owner" || r.userId === session.userId;
            const grund = keinRueckgaengigGrund({ ok: r.ok, zurueck: Boolean(r.zurueck), undoDaten: r.undo !== null && r.undo !== undefined, toolHatUndo: Boolean(tool?.undo), stufe: r.stufe, alterTage: r.at.getTime() >= grenze ? 0 : RUECKGAENGIG_TAGE + 1, darf, nurAnsehen: session.readOnly });
            const kann = grund === null;
            const st = STUFE[(r.stufe ?? "gruen") as keyof typeof STUFE] ?? STUFE.gruen;
            return (
              <div key={r.id} className="card card-pad small" data-testid="verlauf-eintrag" data-tool={r.tool}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <strong>{tool?.title ?? r.tool}</strong>
                  <span className={`tag ${st[1]}`}>{st[0]}</span>
                  {!r.ok && <span className="tag tag-neutral">nicht ausgeführt</span>}
                  {r.zurueck && <span className="tag tag-info" data-testid="verlauf-zurueck">rückgängig gemacht {zeit(r.zurueck)}</span>}
                  <span className="muted" style={{ marginLeft: "auto" }}>{zeit(r.at)} · {r.name || r.email || "?"} · {r.channel === "app" ? "Fragefeld" : "Claude"}</span>
                </div>
                {r.summary && <div style={{ marginTop: 4 }}>{r.summary}</div>}
                {r.auftrag && <div className="muted" style={{ marginTop: 2 }}>Auftrag: „{r.auftrag.slice(0, 300)}“</div>}
                {r.ids.length > 0 && <div className="muted">{r.ids.length} {r.ids.length === 1 ? "Datensatz" : "Datensätze"}</div>}
                {!kann && r.ok && !r.zurueck && <div className="muted" style={{ marginTop: 4 }} data-testid="verlauf-kein-rueckgaengig">Kein Rückgängig: {grund}.</div>}
                {kann && (
                  <form action={rueckgaengigAction} style={{ marginTop: 6 }}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="btn btn-small" type="submit" data-testid="verlauf-rueckgaengig">↩ Rückgängig</button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="small muted" style={{ marginTop: 12 }}>Stufen je Aktion: <Link href="/einstellungen/claude#stufen">Einstellungen → Claude & KI-Assistent</Link>.</p>
    </>
  );
}
