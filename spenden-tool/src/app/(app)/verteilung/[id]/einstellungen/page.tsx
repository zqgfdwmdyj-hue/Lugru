import { notFound } from "next/navigation";
import { requireLogin } from "@/lib/auth";
import { loadEventView } from "@/lib/event-view";
import { deleteEvent, updateEvent } from "@/app/(app)/actions";

export default async function EinstellungenPage({ params }: { params: Promise<{ id: string }> }) {
  await requireLogin();
  const { id } = await params;
  const view = await loadEventView(id);
  if (!view) notFound();
  const { event } = view;
  return (
    <div className="stack" style={{ maxWidth: 620 }}>
      <form action={updateEvent} className="card card-pad stack" style={{ gap: 10 }}>
        <input type="hidden" name="eventId" value={id} />
        <h2>Eckdaten</h2>
        <div className="form-grid">
          <div className="field"><label className="label" htmlFor="ed">Datum</label><input className="input" id="ed" name="eventDate" type="date" required defaultValue={event.eventDate} /></div>
          <div className="field"><label className="label" htmlFor="et">Uhrzeit</label><input className="input" id="et" name="eventTime" defaultValue={event.eventTime ?? ""} placeholder="11 Uhr" /></div>
        </div>
        <div className="field"><label className="label" htmlFor="lo">Ort</label><input className="input" id="lo" name="location" defaultValue={event.location ?? ""} /></div>
        <div className="field"><label className="label" htmlFor="ti">Überschrift (Aushang, Collage, Social Media)</label><input className="input" id="ti" name="title" defaultValue={event.title} /></div>
        <div className="field"><label className="label" htmlFor="st">Unterzeile</label><input className="input" id="st" name="subtitle" defaultValue={event.subtitle ?? ""} /></div>
        <div className="field"><label className="label" htmlFor="no">Interne Notiz (erscheint nirgends)</label><textarea className="input" id="no" name="note" rows={4} defaultValue={event.note ?? ""} /></div>
        <div><button className="btn btn-primary" type="submit">Speichern</button></div>
      </form>
      <details className="card card-pad">
        <summary className="muted" style={{ cursor: "pointer" }}>Verteilung löschen …</summary>
        <form action={deleteEvent} style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input type="hidden" name="eventId" value={id} />
          <button className="btn btn-small btn-danger-link" type="submit">Endgültig löschen</button>
          <span className="small muted">Die Produkte bleiben in der Datenbank.</span>
        </form>
      </details>
    </div>
  );
}
