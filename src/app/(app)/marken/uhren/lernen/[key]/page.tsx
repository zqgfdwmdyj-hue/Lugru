import Link from "next/link";
import { notFound } from "next/navigation";
import { LESSONS, lessonByKey, TRACK_LABEL } from "@/lib/watches/lessons";
import { learnProgress, requireFlip } from "@/lib/watches/service";
import { lessonDoneAction } from "../../actions";
import { Quiz } from "../../forms";
import { FlipHead } from "../../ui";

/** Eine Lektion: Ziel, Inhalt, Übung mit den Werkzeugen, Quiz. */
export default async function LessonPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const lesson = lessonByKey(key);
  if (!lesson) notFound();
  const { session, brandName } = await requireFlip();
  const p = (await learnProgress(session.tenantId, session.userId)).find((x) => x.lesson === lesson.key);
  const i = LESSONS.findIndex((l) => l.key === lesson.key);
  const prev = LESSONS[i - 1];
  const next = LESSONS[i + 1];
  return (
    <div className="flip stack flip-lesson" style={{ gap: 16 }} data-testid="lesson">
      <FlipHead title={lesson.title} brand={brandName} sub={`${TRACK_LABEL[lesson.track]} · Lektion ${i + 1} von ${LESSONS.length} · ca. ${lesson.minutes} Min.${p?.done ? " · ✓ abgeschlossen" : ""}`} />
      <div className="notice notice-info small"><strong>Ziel:</strong> {lesson.goal}</div>

      {lesson.sections.map((s) => (
        <section key={s.h} className="card card-pad">
          <h2>{s.h}</h2>
          <ul>
            {s.points.map((x) => <li key={x}>{x}</li>)}
          </ul>
        </section>
      ))}

      <section className="card card-pad stack" style={{ gap: 8 }} data-testid="lesson-practice">
        <h2>Übung</h2>
        <p className="small" style={{ margin: 0 }}>{lesson.practice.text}</p>
        <div><Link className="btn" href={lesson.practice.href}>{lesson.practice.label} →</Link></div>
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <h2>Quiz</h2>
        <p className="small muted" style={{ margin: 0 }}>Alles richtig = Lektion abgeschlossen. Die Erklärungen erscheinen nach dem Prüfen.</p>
        <Quiz lesson={lesson.key} quiz={lesson.quiz} />
      </section>

      <form action={lessonDoneAction} className="small">
        <input type="hidden" name="lesson" value={lesson.key} />
        <input type="hidden" name="done" value={p?.done ? "0" : "1"} />
        <button className="btn-link" type="submit" data-testid="lesson-toggle">{p?.done ? "Als nicht abgeschlossen markieren" : "Ohne Quiz als gelesen markieren"}</button>
      </form>

      <div className="between small">
        {prev ? <Link href={`/marken/uhren/lernen/${prev.key}`}>← {prev.title}</Link> : <Link href="/marken/uhren/lernen">← Lernpfad</Link>}
        {next ? <Link href={`/marken/uhren/lernen/${next.key}`} data-testid="lesson-next">{next.title} →</Link> : <Link href="/marken/uhren">Zur Übersicht →</Link>}
      </div>
    </div>
  );
}
