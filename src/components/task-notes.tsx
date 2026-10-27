import { noteSummary } from "@/lib/today/notes";

/** Aufgabennotiz: kurz direkt sichtbar, lange Texte mit Wirkung und erstem Schritt – Rest zum Aufklappen. */
export function TaskNotes({ notes, className = "todo-notes" }: { notes: string | null | undefined; className?: string }) {
  const s = noteSummary(notes);
  if (!s) return null;
  if (!s.long) return <div className={className}>{notes}</div>;
  return (
    <details className={`${className} notes-fold`} data-testid="task-notes">
      <summary>
        <span className="notes-short">
          {s.effect && <span className="notes-effect">{s.effect}</span>}
          {s.short}
        </span>{" "}
        <span className="notes-toggle" aria-hidden="true" />
      </summary>
      <div className="notes-full">{notes}</div>
    </details>
  );
}
