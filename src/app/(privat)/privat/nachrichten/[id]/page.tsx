import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { NachrichtEintrag } from "@/lib/inbox/persoenlich";
import { tagText } from "@/lib/inbox/persoenlich-logic";
import { loadEntry, requirePrivate } from "@/lib/private/service";
import { PrivatHead } from "../../ui";
import { einordnenAction, nachrichtAktion, privatNachfassenAction, terminAktionAction } from "../actions";
import { STATUS_TEXT } from "../status";
import { EntwurfForm, KartenSchliessen } from "./entwurf-form";

const zeit = (iso: string) => new Date(iso).toLocaleString("de-DE", { timeZone: "Europe/Berlin", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const wann = (tag: string | null, uhr: string | null) => (tag ? `${tagText(tag)}${uhr ? ` um ${uhr} Uhr` : ""}` : "");

export default async function NachrichtPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ meldung?: string }> }) {
  const session = await requirePrivate({ full: true });
  if (session.role !== "owner") redirect("/privat?nurinhaber=1");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const e = await loadEntry<NachrichtEintrag>(session, id);
  if (!e || e.kind !== "nachricht") notFound();
  const n = e.data;
  const sp = await searchParams;
  const [statusText, statusCls] = STATUS_TEXT[n.status];
  const offen = n.status === "offen" || n.status === "unsicher";
  const t = n.termin;

  return (
    <div className="nachricht-vollbild" data-testid="nachricht-detail">
      <KartenSchliessen link={`/privat/nachrichten/${id}`} />
      <PrivatHead active="nachrichten" title={n.name ?? n.von} sub={<Link className="btn btn-small" href="/privat/nachrichten">← Alle</Link>} />
      {sp.meldung && <div className="notice notice-info small" role="status" style={{ marginBottom: 10 }} data-testid="nachricht-meldung">{sp.meldung}</div>}

      <div className="card card-pad stack" style={{ gap: 6 }}>
        <div className="between" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className={`tag ${statusCls}`} data-testid="nachricht-status">{statusText}</span>
          <span className="small muted">{n.von}{n.postfach ? ` → ${n.postfach}` : ""}</span>
        </div>
        <div style={{ fontWeight: 600 }}>{n.betreff}</div>
        {n.zusammenfassung && <div className="small" data-testid="nachricht-zusammenfassung">{n.zusammenfassung}</div>}
        {(n.status === "beantwortet" || n.status === "beantwortet_extern") && n.beantwortetAm && (
          <div className="small muted" data-testid="nachricht-beantwortet">✓ {n.status === "beantwortet_extern" ? "Beantwortet (extern)" : "Beantwortet"} am {zeit(n.beantwortetAm)}{n.beantwortetVon ? ` von ${n.beantwortetVon}` : ""}</div>
        )}
      </div>

      {n.status === "unsicher" && (
        <div className="notice notice-info small stack" style={{ gap: 8, marginTop: 10 }} data-testid="nachricht-einordnen">
          <div><strong>Persönlich?</strong> Nicht sicher erkannt{n.einstufung?.gruende?.length ? ` (${n.einstufung.gruende.join(", ")})` : ""}. Deine Wahl gilt dauerhaft für diesen Absender.</div>
          <form action={einordnenAction} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input type="hidden" name="id" value={id} />
            <button className="btn btn-small btn-primary" name="art" value="persoenlich" type="submit">Persönlich</button>
            <button className="btn btn-small" name="art" value="geschaeftlich" type="submit">Geschäftlich → Posteingang</button>
            <button className="btn btn-small" name="art" value="ignorieren" type="submit">Ignorieren</button>
          </form>
        </div>
      )}

      {t && (
        <div className="notice small stack" style={{ gap: 8, marginTop: 10 }} data-testid="nachricht-termin">
          {n.terminGeaendert ? (
            <>
              <div>📅 Termin „{n.terminGeaendert.titel}“ am {tagText(n.terminGeaendert.tag)} als <strong>abgesagt</strong> markiert. Neuen Termin anbieten? (steht im Entwurf)</div>
              <form action={terminAktionAction}><input type="hidden" name="id" value={id} /><button className="btn btn-small" name="aktion" value="rueckgaengig" type="submit" data-testid="termin-rueckgaengig">Rückgängig</button></form>
            </>
          ) : n.terminErledigt ? (
            <div>📅 Termin: {n.terminErledigt === "rueckgaengig" ? "Absage zurückgenommen" : n.terminErledigt === "eingetragen" ? "eingetragen" : n.terminErledigt === "verschoben" ? "verschoben" : "als abgesagt markiert"}.</div>
          ) : t.art === "absage" ? (
            <div>📅 Absage erkannt{t.tag ? ` für ${wann(t.tag, t.uhrzeit)}` : ""} – kein passender Termin im Privatkalender gefunden.</div>
          ) : t.art === "verschiebung" ? (
            <>
              <div>📅 Verschieben{t.tag ? ` vom ${wann(t.tag, t.uhrzeit)}` : ""} auf <strong>{wann(t.neuerTag, t.neueUhrzeit) || "[Termin]"}</strong>?</div>
              {n.terminId && t.neuerTag ? (
                <form action={terminAktionAction}><input type="hidden" name="id" value={id} /><button className="btn btn-small btn-primary" name="aktion" value="verschieben" type="submit" data-testid="termin-verschieben">Termin verschieben</button></form>
              ) : (
                <div className="muted">Kein passender Termin im Kalender – bitte von Hand anpassen.</div>
              )}
            </>
          ) : (
            <>
              <div>📅 Termin bestätigen? <strong>{wann(t.art === "bestaetigung" ? t.tag : t.neuerTag, t.art === "bestaetigung" ? t.uhrzeit : t.neueUhrzeit) || "[Termin]"}</strong>{n.terminId ? " – steht schon im Kalender." : ""}</div>
              {!n.terminId && (t.tag || t.neuerTag) && (
                <form action={terminAktionAction}><input type="hidden" name="id" value={id} /><button className="btn btn-small btn-primary" name="aktion" value="eintragen" type="submit" data-testid="termin-eintragen">In den Privatkalender</button></form>
              )}
            </>
          )}
        </div>
      )}

      {offen && (
        <section className="card card-pad" style={{ marginTop: 10 }}>
          <EntwurfForm id={id} text={n.entwurf} action={nachrichtAktion} anrede={n.anrede} />
          <div className="small muted" style={{ marginTop: 6 }}>{n.entwurfQuelle === "ki" ? "Entwurf von der KI (ohne externe Speicherung)." : "Entwurf aus der Vorlage."} Gesendet wird über {n.postfach ?? "das Standardpostfach"} im selben Verlauf.</div>
        </section>
      )}

      {n.status === "ausgehend" && (
        <form action={privatNachfassenAction} className="card card-pad" style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} data-testid="privat-nachfassen">
          <input type="hidden" name="id" value={id} />
          <span className="small">{n.nachfassenAm ? `Nachfassen am ${n.nachfassenAm.split("-").reverse().join(".")}` : "Keine Antwort bekommen?"}</span>
          <input className="input" name="tage" type="number" min={1} max={60} defaultValue={3} style={{ width: 80 }} />
          <button className="btn btn-small" type="submit">Nachfassen in … Tagen</button>
        </form>
      )}

      <section className="stack" style={{ gap: 8, marginTop: 14 }} data-testid="nachricht-verlauf">
        <h2 style={{ fontSize: 15, margin: 0 }}>Verlauf</h2>
        {n.verlauf.map((v) => (
          <article key={v.key} className={`card card-pad verlauf-${v.richtung}`} data-testid={`verlauf-${v.richtung}`}>
            <div className="between small muted" style={{ gap: 8 }}>
              <span>{v.richtung === "ein" ? `Von ${n.name ?? v.von}` : `Gesendet${v.extern ? " (Mailprogramm)" : ""} von ${v.von}`}</span>
              <span>{zeit(v.am)}</span>
            </div>
            <div className="article-body" style={{ marginTop: 6, fontSize: 14, whiteSpace: "pre-wrap" }}>{v.text}</div>
          </article>
        ))}
      </section>
    </div>
  );
}
