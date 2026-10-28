import type { Metadata } from "next";
import { connection } from "next/server";
import { resolveShareLink } from "@/lib/pallets/shipment-service";
import { STATUS_TONE, carrierLabel, delayDays, loadText, publicTimeline, statusLabel, trackingLink } from "@/lib/pallets/shipments";

// Sendungsverfolgung für Kunden: ohne Anmeldung, nur über den zufälligen, befristeten Link. Zeigt nur diese
// eine Sendung – ohne interne Notizen, ohne Namen von Mitarbeitern, ohne andere Kunden.

export const metadata: Metadata = {
  title: "Sendungsverfolgung",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const fmtDay = (iso: string) => new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${iso}T12:00:00Z`));
const fmtTime = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
const fmtDate = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

const wrap: React.CSSProperties = { maxWidth: 640, margin: "0 auto", padding: "24px 16px 48px", display: "grid", gap: 14 };

export default async function PublicShipmentPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const r = await resolveShareLink(token, { count: true });
  if (!r) {
    return (
      <main style={wrap} data-testid="public-ship-gone">
        <h1 style={{ fontSize: 22, margin: 0 }}>Sendungsverfolgung</h1>
        <div className="notice notice-warn">Dieser Link ist abgelaufen oder wurde zurückgezogen. Bitte beim Absender einen neuen Link anfragen.</div>
      </main>
    );
  }
  const { shipment: s, events, photos, sender, link } = r;
  const tracking = trackingLink(s);
  const delay = delayDays(s);
  const done = s.status === "zugestellt";
  const timeline = publicTimeline(events);
  const load = loadText(s);
  return (
    <main style={wrap} data-testid="public-ship">
      <header>
        <div className="small muted">{s.direction === "ein" ? `Anlieferung an ${sender}` : `Sendung von ${sender}`}</div>
        <h1 style={{ fontSize: 24, margin: "4px 0 6px" }} data-testid="public-ship-title">{s.title}</h1>
        <span className={STATUS_TONE[s.status]} style={{ fontSize: 15 }} data-testid="public-ship-status">{statusLabel(s.status, s.direction)}</span>
      </header>

      <section className="card card-pad" style={{ display: "grid", gap: 10 }}>
        <div>
          <div className="kpi-label">{done ? (s.direction === "ein" ? "Angekommen" : "Zugestellt") : "Voraussichtlich am"}</div>
          <div style={{ fontSize: 20, fontWeight: 600 }} data-testid="public-ship-date">
            {done && s.deliveredAt ? fmtTime(s.deliveredAt) : s.plannedDate ? fmtDay(s.plannedDate) : "Termin folgt"}
            {!done && s.plannedTime ? <span className="small muted"> · {s.plannedTime}</span> : null}
          </div>
          {!done && delay > 0 && s.firstDate && <div className="small" data-testid="public-ship-shift">Verschoben – ursprünglich geplant am {fmtDay(s.firstDate)}</div>}
        </div>
        {s.location && (
          <div>
            <div className="kpi-label">Aktueller Stand</div>
            <div data-testid="public-ship-location">{s.location}</div>
          </div>
        )}
        <div>
          <div className="kpi-label">Versand mit</div>
          <div>{carrierLabel(s.carrier, s.carrierName)}{s.trackingNo ? <> · Sendungsnummer <strong className="num">{s.trackingNo}</strong></> : null}</div>
          {tracking && <a className="btn btn-primary" href={tracking} target="_blank" rel="noreferrer noopener" style={{ marginTop: 8, display: "inline-block" }} data-testid="public-ship-track">Beim Versanddienstleister verfolgen ↗</a>}
        </div>
        {(load || s.place) && <div className="small muted">{[load, s.place ? `${s.direction === "ein" ? "Von" : "An"}: ${s.place}` : null].filter(Boolean).join(" · ")}</div>}
      </section>

      {photos.length > 0 && (
        <section className="card card-pad" style={{ display: "grid", gap: 8 }}>
          <div className="kpi-label">Fotos</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
            {photos.map((f) => (
              <a key={f} href={`/api/public/sendung/${token}/${f}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/public/sendung/${token}/${f}`} alt="Foto der Sendung" loading="lazy" style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 8 }} data-testid="public-ship-photo" />
              </a>
            ))}
          </div>
        </section>
      )}

      {timeline.length > 0 && (
        <section className="card card-pad">
          <div className="kpi-label" style={{ marginBottom: 6 }}>Verlauf</div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {timeline.map((e, i) => (
              <li key={i} style={{ borderLeft: "3px solid var(--accent, #0e6b5f)", paddingLeft: 8 }} data-testid="public-ship-event">
                <div>{e.text}</div>
                <div className="small muted">{fmtTime(e.at)}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="small muted">Link gültig bis {fmtDate(link.expiresAt)}. Fragen zur Sendung? Bitte direkt an {sender || "den Absender"} wenden.</footer>
    </main>
  );
}
