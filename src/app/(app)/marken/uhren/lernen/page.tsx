import Link from "next/link";
import { LESSONS, TRACK_LABEL, type Track } from "@/lib/watches/lessons";
import { learnProgress, requireFlip } from "@/lib/watches/service";
import { FlipHead } from "../ui";

const TRACKS: Track[] = ["start", "gebraucht", "neu", "geld", "verkauf"];

/** Lernpfad: Lektionen nach Themen, mit Stand je Person. */
export default async function LernenPage() {
  const { session, brandName } = await requireFlip();
  const progress = new Map((await learnProgress(session.tenantId, session.userId)).map((p) => [p.lesson, p]));
  const done = LESSONS.filter((l) => progress.get(l.key)?.done).length;
  return (
    <div className="flip stack" style={{ gap: 16 }}>
      <FlipHead title="Lernpfad" brand={brandName} sub={`${done} von ${LESSONS.length} Lektionen abgeschlossen · jede Lektion mit Quiz und Übung`} />
      <div className="flip-progress" aria-hidden="true"><span style={{ width: `${Math.round((done / LESSONS.length) * 100)}%` }} /></div>
      {TRACKS.map((t) => (
        <section key={t} className="stack" style={{ gap: 8 }}>
          <h2>{TRACK_LABEL[t]}</h2>
          <ul className="flip-list" data-testid={`track-${t}`}>
            {LESSONS.filter((l) => l.track === t).map((l) => {
              const p = progress.get(l.key);
              return (
                <li key={l.key} className={p?.done ? "done" : ""}>
                  <Link href={`/marken/uhren/lernen/${l.key}`} data-testid={`lesson-${l.key}`}><strong>{p?.done ? "✓ " : ""}{l.title}</strong></Link>
                  <div className="small muted">
                    {l.minutes} Min. · {l.goal}
                    {p && !p.done && p.total ? ` · Quiz: ${p.bestCorrect}/${p.total}` : ""}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <p className="small muted">Bewusst ohne konkrete Marktpreise – die ändern sich. Dein Preisgefühl entsteht unter „Marktpreise“ und in Übungs-Deals.</p>
    </div>
  );
}
