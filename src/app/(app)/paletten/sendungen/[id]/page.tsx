import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { customerKey } from "@/lib/pallets/billing";
import { loadShipment } from "@/lib/pallets/shipment-service";
import { DIRECTION_LABEL, STATUS_TONE, carrierLabel, carrierOf, delayDays, dmy, isOverdue, linkState, loadText, statusLabel, trackingLink } from "@/lib/pallets/shipments";
import { SHIPMENT_STATUSES } from "@/db/schema";
import { AddShipmentPhotos, EditShipmentForm, ShareLinks, ShipAction } from "../forms";
import { publicUrl } from "@/lib/public-url";
import { ShipmentNotices } from "../notices";
import { ConfirmButton } from "@/components/confirm-button";

const time = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
const day = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

export default async function SendungPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ neu?: string }> }) {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const { id } = await params;
  const sp = await searchParams;
  const data = await loadShipment(t, id);
  if (!data) notFound();
  const { shipment: s, events, photos, links } = data;
  const today = todayIso();
  const link = trackingLink(s);
  const delay = delayDays(s);
  const carrier = carrierOf(s.carrier);
  const dhlReady = s.carrier === "dhl" && Boolean(s.trackingNo) && Boolean((await getIntegration(t, "dhl_tracking"))?.apiKey);
  const P = schema.pallets;
  const used = (await db.selectDistinct({ c: P.customer }).from(P).where(and(eq(P.tenantId, t), isNotNull(P.customer)))).map((r) => r.c!.trim());
  const known = await db.select({ name: schema.palletCustomers.name, email: schema.palletCustomers.email }).from(schema.palletCustomers).where(eq(schema.palletCustomers.tenantId, t));
  const customers = [...new Map([...known.map((k) => k.name), ...used].map((n) => [customerKey(n), n])).values()].sort((a, b) => a.localeCompare(b, "de"));
  const customerEmail = s.customer ? (known.find((k) => customerKey(k.name) === customerKey(s.customer))?.email ?? null) : null;
  const linkRows = links.map((l) => {
    const state = linkState(l);
    return { id: l.id, path: state === "aktiv" ? `/sendung/${l.token}` : null, state, until: day(l.expiresAt), views: l.views, photos: l.showPhotos };
  });
  const open = s.status !== "zugestellt" && s.status !== "storniert";
  const arrivedLabel = s.direction === "ein" ? "Angekommen" : "Zugestellt";

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/paletten/sendungen">Sendungen</Link> · {DIRECTION_LABEL[s.direction]}</div>
          <h1 data-testid="ship-h1">{s.direction === "ein" ? "⬇" : "⬆"} {s.title}</h1>
        </div>
        <span>
          <span className={STATUS_TONE[s.status]} data-testid="ship-status">{statusLabel(s.status, s.direction)}</span>
          {isOverdue(s, today) && <span className="tag tag-danger" style={{ marginLeft: 4 }}>überfällig</span>}
        </span>
      </div>

      {sp.neu === "1" && <div className="notice notice-ok" data-testid="ship-created">Sendung angelegt – alle mit Zugriff aufs Palettenlager sehen sie jetzt. Unten kannst du einen Link für den Kunden erstellen.</div>}
      <ShipmentNotices session={session} compact />

      <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
        <section className="card card-pad stack" style={{ gap: 8 }} data-testid="ship-info">
          <div>
            <div className="kpi-label">Termin</div>
            <div className="kpi-value" style={{ fontSize: 22 }} data-testid="ship-date-show">{s.plannedDate ? dmy(s.plannedDate) : "offen"}{s.plannedTime ? <span className="small muted"> · {s.plannedTime}</span> : null}</div>
            {delay > 0 && s.firstDate && <div className="small"><span className="tag tag-warn">+{delay} Tag{delay === 1 ? "" : "e"}</span> ursprünglich {dmy(s.firstDate)}</div>}
            {s.deliveredAt && <div className="small">{arrivedLabel} am {time(s.deliveredAt)}</div>}
          </div>
          <div>
            <div className="kpi-label">Spedition / Paketdienst</div>
            <div>{carrierLabel(s.carrier, s.carrierName)}{s.trackingNo && <> · <span className="num" data-testid="ship-trackno-show">{s.trackingNo}</span></>}</div>
            {link ? (
              <a className="btn btn-small btn-primary" href={link} target="_blank" rel="noreferrer" style={{ marginTop: 6 }} data-testid="ship-track-link">Sendung beim Spediteur verfolgen ↗</a>
            ) : carrier?.kind === "spedition" && s.trackingNo ? (
              <div className="small muted">Kein Verfolgungs-Link hinterlegt – unten unter „Angaben ändern“ den Link aus der Mail der Spedition einfügen.</div>
            ) : null}
          </div>
          {s.location && <div><div className="kpi-label">Aktueller Stand</div><div data-testid="ship-location">{s.location}</div></div>}
          <div className="small muted">{[s.customer ? `Kunde: ${s.customer}` : null, s.place ? `${s.direction === "ein" ? "Von" : "An"}: ${s.place}` : null, loadText(s)].filter(Boolean).join(" · ")}</div>
          {s.note && <div className="small" style={{ whiteSpace: "pre-wrap" }}><strong>Intern:</strong> {s.note}</div>}
          {s.carrier === "dhl" && s.trackingNo && (
            <div className="small muted" data-testid="ship-dhl">
              {dhlReady ? (
                <>
                  DHL wird automatisch abgefragt (etwa alle 3 Std.){s.trackedAt ? ` – zuletzt ${time(s.trackedAt)}` : ""}.
                  {s.trackError && <div className="notice notice-warn" style={{ marginTop: 4 }}>{s.trackError}</div>}
                  {open && (
                    <ShipAction id={s.id} intent="dhl" className="">
                      <button className="btn btn-small" type="submit" style={{ marginTop: 4 }} data-testid="ship-dhl-now">Jetzt bei DHL abfragen</button>
                    </ShipAction>
                  )}
                </>
              ) : (
                <>Automatische DHL-Verfolgung möglich – {session.role === "owner" ? <Link href="/anbindungen">unter Anbindungen „DHL Sendungsverfolgung“ einrichten</Link> : "der Inhaber kann sie unter Anbindungen einrichten"}.</>
              )}
            </div>
          )}
        </section>

        <section className="card card-pad stack" style={{ gap: 12 }}>
          {open && (
            <>
              <div>
                <h2 style={{ fontSize: 16, margin: "0 0 6px" }}>Schnell melden</h2>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {s.status === "geplant" && (
                    <ShipAction id={s.id} intent="status" className="">
                      <input type="hidden" name="status" value="unterwegs" />
                      <button className="btn btn-small" type="submit" data-testid="ship-quick-unterwegs">Ist unterwegs</button>
                    </ShipAction>
                  )}
                  <ShipAction id={s.id} intent="status" className="">
                    <input type="hidden" name="status" value="zugestellt" />
                    <button className="btn btn-small btn-primary" type="submit" data-testid="ship-quick-done">✓ {arrivedLabel}</button>
                  </ShipAction>
                </div>
              </div>
              <ShipAction id={s.id} intent="termin" testid="ship-shift">
                <h2 style={{ fontSize: 16, margin: 0 }}>Termin verschieben</h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
                  <div className="field" style={{ margin: 0 }}><label className="label" htmlFor="t-date">Neuer Termin</label><input className="input" id="t-date" name="plannedDate" type="date" defaultValue={s.plannedDate ?? ""} data-testid="ship-shift-date" /></div>
                  <div className="field" style={{ margin: 0 }}><label className="label" htmlFor="t-time">Zeitfenster</label><input className="input" id="t-time" name="plannedTime" maxLength={40} defaultValue={s.plannedTime ?? ""} placeholder="z. B. 8–12 Uhr" /></div>
                </div>
                <div className="field" style={{ margin: 0 }}><label className="label" htmlFor="t-reason">Grund (optional, sieht auch der Kunde)</label><input className="input" id="t-reason" name="reason" maxLength={200} placeholder="z. B. Spedition: Zustellung nicht möglich, Stau" data-testid="ship-shift-reason" /></div>
                <button className="btn btn-small btn-primary" type="submit" style={{ alignSelf: "flex-start" }} data-testid="ship-shift-save">Termin speichern & alle informieren</button>
              </ShipAction>
            </>
          )}
          <ShipAction id={s.id} intent="status" testid="ship-status-form">
            <h2 style={{ fontSize: 16, margin: 0 }}>Stand / Status</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
              <div className="field" style={{ margin: 0 }}>
                <label className="label" htmlFor="s-status">Status</label>
                <select className="select" id="s-status" name="status" defaultValue={s.status}>
                  {SHIPMENT_STATUSES.map((x) => <option key={x} value={x}>{statusLabel(x, s.direction)}</option>)}
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}><label className="label" htmlFor="s-loc">Wo ist sie gerade?</label><input className="input" id="s-loc" name="location" maxLength={300} defaultValue={s.location ?? ""} placeholder="z. B. Im Depot Nürnberg" data-testid="ship-loc" /></div>
            </div>
            <button className="btn btn-small" type="submit" style={{ alignSelf: "flex-start" }} data-testid="ship-status-save">Speichern</button>
          </ShipAction>
        </section>
      </div>

      <section className="card" data-testid="ship-share">
        <div className="card-head"><h2>Link für den Kunden</h2><span className="small muted">Ohne Anmeldung, nur diese Sendung, läuft automatisch ab. Interne Notizen und Namen sieht der Kunde nie.</span></div>
        <div className="card-pad"><ShareLinks id={s.id} links={linkRows} title={s.title} customerEmail={customerEmail} publicBase={publicUrl()} /></div>
      </section>

      <section className="card" data-testid="ship-photos">
        <div className="card-head"><h2>Fotos ({photos.length})</h2></div>
        <div className="card-pad stack" style={{ gap: 10 }}>
          {photos.length > 0 && (
            <div className="pal-thumbs">
              {photos.map((p) => (
                <div key={p.id} className="pal-thumb" style={{ width: 120, height: "auto" }}>
                  <a href={`/datei/${p.fileId}`} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/datei/${p.fileId}`} alt="Foto der Sendung" loading="lazy" />
                  </a>
                  <div className="small" style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                    <ShipAction id={s.id} intent="foto-teilen" className="">
                      <input type="hidden" name="photoId" value={p.id} />
                      <input type="hidden" name="shared" value={p.shared ? "0" : "1"} />
                      <button className="btn-link small" type="submit" title={p.shared ? "Im Kunden-Link sichtbar – klicken für nur intern" : "Nur intern – klicken, um es dem Kunden zu zeigen"}>{p.shared ? "👁 Kunde sieht es" : "🔒 nur intern"}</button>
                    </ShipAction>
                    <ShipAction id={s.id} intent="foto-loeschen" className="">
                      <input type="hidden" name="photoId" value={p.id} />
                      <ConfirmButton className="btn-link small" confirm="Foto entfernen? Es ist danach auch im Kunden-Link weg.">Entfernen</ConfirmButton>
                    </ShipAction>
                  </div>
                </div>
              ))}
            </div>
          )}
          <AddShipmentPhotos id={s.id} />
        </div>
      </section>

      <section className="card" data-testid="ship-history">
        <div className="card-head"><h2>Verlauf</h2></div>
        <div className="card-pad stack" style={{ gap: 10 }}>
          <ShipAction id={s.id} intent="notiz" className="" resetOnOk>
            <div style={{ display: "flex", gap: 6 }}>
              <label className="sr-only" htmlFor="n-text">Interne Notiz</label>
              <input className="input" id="n-text" name="text" maxLength={600} placeholder="Interne Notiz, z. B. Spedition angerufen …" style={{ flex: 1 }} />
              <button className="btn btn-small" type="submit">Notiz</button>
            </div>
          </ShipAction>
          <ul className="ship-timeline" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {events.map((e) => (
              <li key={e.id} data-testid="ship-event" style={{ borderLeft: `3px solid ${e.notice ? "var(--warn)" : "var(--border, #ddd)"}`, paddingLeft: 8 }}>
                <div>{e.text}</div>
                <div className="small muted">
                  {time(e.createdAt)}
                  {e.userName ? ` · ${e.userName}` : ""}
                  {e.notice ? " · Meldung an alle" : ""}
                  {e.internal ? " · intern" : ""}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <details className="card" data-testid="ship-edit-card">
        <summary className="card-head" style={{ cursor: "pointer" }}><h2 style={{ display: "inline" }}>Angaben ändern</h2></summary>
        <div className="card-pad">
          <EditShipmentForm id={s.id} customers={customers} v={{ direction: s.direction, title: s.title, customer: s.customer, place: s.place, carrier: s.carrier, carrierName: s.carrierName, trackingNo: s.trackingNo, trackingUrl: s.trackingUrl, palletCount: s.palletCount, cartonCount: s.cartonCount, note: s.note }} />
        </div>
      </details>
    </>
  );
}
