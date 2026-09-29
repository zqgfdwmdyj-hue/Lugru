"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { refreshAction, type TodoState } from "./actions";

export function RefreshButton() {
  const [state, action, pending] = useActionState<TodoState, FormData>(refreshAction, null);
  return (
    <form action={action} className="stack" style={{ gap: 6, alignItems: "flex-end" }}>
      <button className="btn" type="submit" disabled={pending}>{pending ? "Prüfe Mails … (bis zu einer Minute)" : "↻ Mails prüfen"}</button>
      {state && <div className={`notice small ${state.ok ? "notice-ok" : "notice-warn"}`} style={{ maxWidth: 520 }}>{state.message}</div>}
    </form>
  );
}

export function ImportForm() {
  const router = useRouter();
  const [state, setState] = useState<TodoState>(null);
  const [pending, setPending] = useState(false);
  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const files = [...((e.currentTarget.elements.namedItem("file") as HTMLInputElement).files ?? [])];
    if (!files.some((f) => !/-(wal|shm)$/i.test(f.name))) return setState({ ok: false, message: "Bitte die app.db des Retouren-Tools auswählen (und, falls vorhanden, app.db-wal dazu)." });
    const body = new FormData();
    for (const f of files) body.append("file", f, f.name);
    const mb = files.reduce((n, f) => n + f.size, 0) / 1024 / 1024;
    setPending(true);
    setState({ ok: true, message: `Lade ${mb.toFixed(1)} MB hoch und übernehme …` });
    try {
      const res = await fetch("/api/import/amazon-todos", { method: "POST", body });
      const j = (await res.json().catch(() => ({}))) as { error?: string; todos?: number; open?: number; skipped?: number; seen?: number; total?: number };
      if (!res.ok) setState({ ok: false, message: j.error ?? `Fehler ${res.status}` });
      else {
        setState({ ok: true, message: `In der Datei: ${j.total} Amazon-ToDos, davon ${j.open} offen. Neu übernommen: ${j.todos}${j.skipped ? `, schon vorhanden: ${j.skipped}` : ""}. Verworfene Mails gemerkt: ${j.seen}.` });
        router.refresh();
      }
    } catch (err) {
      setState({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={upload} className="stack" style={{ gap: 8 }}>
      <label className="label" htmlFor="appdb">Aus dem Retouren-Tool übernehmen (app.db)</label>
      <input className="input" id="appdb" name="file" type="file" multiple required />
      <span className="small muted">Im Ordner <code>backend\data</code> des Retouren-Tools <strong>app.db</strong> auswählen – liegt daneben <strong>app.db-wal</strong>, diese mit Strg gedrückt dazu markieren (darin stehen die neuesten Einträge). Übernimmt alle Amazon-ToDos mit Status und Notiz sowie die Liste verworfener Mails. Doppelte werden übersprungen – mehrfaches Hochladen schadet nicht. Andere Daten aus der Datei werden nicht angefasst.</span>
      <div><button className="btn btn-small" type="submit" disabled={pending}>{pending ? "Übernehme …" : "Übernehmen"}</button></div>
      {state && <div className={`notice small ${state.ok ? "notice-ok" : "notice-warn"}`}>{state.message}</div>}
    </form>
  );
}
