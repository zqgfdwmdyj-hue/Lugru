import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { canAccess } from "@/lib/auth/areas";
import { daysSince, FOLLOW_UP_DAYS, LEAD_COLUMNS, TASK_COLUMNS } from "@/lib/board/logic";
import { leadBoard, taskBoard } from "@/lib/board/service";
import { FINDING_LABEL } from "@/lib/leads/labels";
import { Kanban, type KanbanColumn } from "@/components/kanban";
import { addTaskAction, feedFromLeadAction, moveLeadAction, moveTaskAction } from "./actions";

const MAX_CARDS = 60;

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ b?: string; alle?: string }> }) {
  const session = await requireArea("start", "lieferanten");
  const sp = await searchParams;
  const leadsAllowed = canAccess(session, "lieferanten");
  const tasksAllowed = canAccess(session, "start");
  const board = sp.b === "todos" || !leadsAllowed ? "todos" : "grosshandel";
  const all = sp.alle === "1";
  const now = new Date();

  let columns: KanbanColumn[] = [];
  if (board === "grosshandel") {
    const cols = await leadBoard(session.tenantId);
    columns = LEAD_COLUMNS.map((c) => {
      const rows = cols.get(c.key) ?? [];
      return {
        key: c.key,
        title: c.title,
        hint: c.hint,
        more: Math.max(0, rows.length - MAX_CARDS),
        cards: rows.slice(0, MAX_CARDS).map((l) => {
          const days = daysSince(l.mailedAt, now);
          const brands = l.searchBrands.filter(Boolean);
          const fair = l.findings.find((f) => f.source === "messe");
          return {
            id: l.id,
            content: (
              <>
                <Link href={`/lieferanten/finden/${l.id}`} draggable={false}>{l.companyName}</Link>
                <div className="muted">
                  {[l.city, l.country].filter(Boolean).join(" · ")}
                  {brands.length > 0 && <> · {brands.slice(0, 3).join(", ")}</>}
                  {fair && <> · {fair.detail?.split(" · ")[0]}</>}
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {[...new Set(l.findings.map((f) => f.source))].map((s) => <span key={s} className="tag tag-neutral">{FINDING_LABEL[s]}</span>)}
                  {l.status === "entwurf" && <span className="tag tag-info">Entwurf</span>}
                  {c.key === "angeschrieben" && days !== null && <span className={`tag ${days >= FOLLOW_UP_DAYS ? "tag-warn" : "tag-neutral"}`}>vor {days} T. angeschrieben</span>}
                  {c.key === "follow_up" && (l.followUpAt ? <span className="tag tag-neutral">nachgefasst {l.followUpAt.toLocaleDateString("de-DE")}</span> : <span className="tag tag-warn">nachfassen</span>)}
                  {l.repliedAt && <span className="tag tag-ok">Antwort {l.repliedAt.toLocaleDateString("de-DE")}</span>}
                  {l.supplierId && <span className="tag tag-ok">Lieferant</span>}
                </div>
                {c.key === "preisliste" && (
                  <form action={feedFromLeadAction}><input type="hidden" name="id" value={l.id} /><button className="btn btn-small" type="submit">Preisliste hochladen →</button></form>
                )}
              </>
            ),
          };
        }),
      };
    });
  } else {
    const cols = await taskBoard(session.tenantId, all);
    columns = TASK_COLUMNS.map((c) => {
      const rows = cols.get(c.key) ?? [];
      return {
        key: c.key,
        title: c.title,
        more: Math.max(0, rows.length - MAX_CARDS),
        top:
          c.key === "offen" ? (
            <form action={addTaskAction} className="stack" style={{ gap: 6 }} data-testid="task-add">
              {all && <input type="hidden" name="alle" value="1" />}
              <input className="input" name="title" placeholder="Neue Aufgabe …" required aria-label="Neue Aufgabe" />
              <div style={{ display: "flex", gap: 6 }}>
                <input className="input" type="date" name="due" aria-label="Fällig am" style={{ flex: 1 }} />
                <button className="btn btn-small" type="submit">Hinzufügen</button>
              </div>
            </form>
          ) : undefined,
        cards: rows.slice(0, MAX_CARDS).map((t) => {
          const overdue = t.status === "open" && t.dueDate && t.dueDate < now.toISOString().slice(0, 10);
          return {
            id: t.id,
            content: (
              <>
                {t.link ? <Link href={t.link} draggable={false}>{t.title}</Link> : <strong style={t.status === "done" ? { textDecoration: "line-through", fontWeight: 500 } : undefined}>{t.title}</strong>}
                {t.notes && <div className="muted" style={{ whiteSpace: "pre-line" }}>{t.notes.slice(0, 160)}</div>}
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {t.dueDate && <span className={`tag ${overdue ? "tag-danger" : "tag-neutral"}`}>fällig {t.dueDate.split("-").reverse().join(".")}</span>}
                  {t.priority === "critical" && <span className="tag tag-danger">wichtig</span>}
                  {t.category !== "eigene" && <span className="tag tag-neutral">{t.category}</span>}
                </div>
              </>
            ),
          };
        }),
      };
    });
  }

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Übersicht</div><h1>Board</h1></div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {leadsAllowed && <Link href="/board" className={`chip${board === "grosshandel" ? " active" : ""}`}>Großhändler</Link>}
        {tasksAllowed && <Link href="/board?b=todos" className={`chip${board === "todos" ? " active" : ""}`}>Meine To-dos</Link>}
        {board === "todos" && <Link href={all ? "/board?b=todos" : "/board?b=todos&alle=1"} className="small" style={{ marginLeft: 8 }}>{all ? "nur eigene Aufgaben" : "alle Aufgaben zeigen"}</Link>}
        <span className="small muted" style={{ marginLeft: "auto" }}>Karten ziehen – oder unten an der Karte „→ Spalte“ wählen.</span>
      </div>
      {board === "grosshandel" && (
        <div className="small muted">
          „Zu kontaktieren“: geprüfte Großhändler und Entwürfe (weitere über „Aufs Board“ in der Liste). Nach {FOLLOW_UP_DAYS} Tagen ohne Antwort wandert eine Anfrage automatisch nach „Follow-up“ (mit Aufgabe); Antworten im Posteingang landen unter „Antwort erhalten“. „Abgeschlossen“ legt die Firma als Lieferant an.
        </div>
      )}
      <Kanban columns={columns} move={board === "grosshandel" ? moveLeadAction : moveTaskAction} testid={`board-${board}`} />
    </>
  );
}
