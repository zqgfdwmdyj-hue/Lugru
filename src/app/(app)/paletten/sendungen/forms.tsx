"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useKeepForm } from "@/components/keep-form";
import { useSubmitKey } from "@/lib/use-submit-key";
import { CARRIERS, LINK_DAYS } from "@/lib/pallets/shipments";
import { PhotoPicker, type PickedPhoto } from "../photos";
import { createShipment, shipmentAction, type ShipState } from "./actions";

function Msg({ state }: { state: ShipState }) {
  if (!state) return null;
  return <div className={`notice ${state.ok ? "notice-ok" : "notice-warn"}`} role="status" data-testid="ship-msg">{state.message}</div>;
}

type BaseValues = {
  direction?: "ein" | "aus";
  title?: string;
  customer?: string | null;
  place?: string | null;
  carrier?: string;
  carrierName?: string | null;
  trackingNo?: string | null;
  trackingUrl?: string | null;
  palletCount?: number | null;
  cartonCount?: number | null;
  note?: string | null;
};

/** Felder, die beim Anlegen und Bearbeiten gleich sind. */
function BaseFields({ v, customers, idPrefix }: { v: BaseValues; customers: string[]; idPrefix: string }) {
  const [carrier, setCarrier] = useState(v.carrier ?? "");
  const [direction, setDirection] = useState<"ein" | "aus">(v.direction ?? "ein");
  const kind = CARRIERS.find((c) => c.key === carrier)?.kind;
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <>
      <fieldset className="ship-dir" style={{ border: 0, padding: 0, margin: 0, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <legend className="label">Was kommt bzw. geht raus?</legend>
        <label className={`pal-action${direction === "ein" ? " active" : ""}`} style={{ cursor: "pointer" }}>
          <input type="radio" name="direction" value="ein" checked={direction === "ein"} onChange={() => setDirection("ein")} style={{ marginRight: 6 }} data-testid="ship-dir-ein" />
          ⬇ Anlieferung ins Lager
        </label>
        <label className={`pal-action${direction === "aus" ? " active" : ""}`} style={{ cursor: "pointer" }}>
          <input type="radio" name="direction" value="aus" checked={direction === "aus"} onChange={() => setDirection("aus")} style={{ marginRight: 6 }} data-testid="ship-dir-aus" />
          ⬆ Versand an Kunden
        </label>
      </fieldset>
      <div className="field">
        <label className="label" htmlFor={id("title")}>Bezeichnung *</label>
        <input className="input" id={id("title")} name="title" required maxLength={160} defaultValue={v.title ?? ""} placeholder={direction === "ein" ? "z. B. 12 Paletten Shampoo von Lieferant X" : "z. B. Auftrag 4711 – 3 Paletten an Kunde Y"} data-testid="ship-title" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <div className="field">
          <label className="label" htmlFor={id("customer")}>Kunde (Palettenlager)</label>
          <input className="input" id={id("customer")} name="customer" list={id("customers")} maxLength={120} defaultValue={v.customer ?? ""} placeholder="optional" />
          <datalist id={id("customers")}>{customers.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div className="field">
          <label className="label" htmlFor={id("place")}>{direction === "ein" ? "Kommt von" : "Geht an (Ort/Firma)"}</label>
          <input className="input" id={id("place")} name="place" maxLength={160} defaultValue={v.place ?? ""} placeholder={direction === "ein" ? "z. B. Lieferant, Hamburg" : "z. B. Musterfirma, München"} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <div className="field">
          <label className="label" htmlFor={id("carrier")}>Spedition / Paketdienst *</label>
          <select className="select" id={id("carrier")} name="carrier" required value={carrier} onChange={(e) => setCarrier(e.target.value)} data-testid="ship-carrier">
            <option value="">– bitte wählen –</option>
            <optgroup label="Paketdienste">{CARRIERS.filter((c) => c.kind === "paket").map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</optgroup>
            <optgroup label="Speditionen">{CARRIERS.filter((c) => c.kind === "spedition").map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</optgroup>
            <optgroup label="Sonstiges">{CARRIERS.filter((c) => c.kind === "eigen").map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</optgroup>
          </select>
        </div>
        {carrier === "andere" && (
          <div className="field">
            <label className="label" htmlFor={id("carrierName")}>Name der Spedition</label>
            <input className="input" id={id("carrierName")} name="carrierName" maxLength={80} defaultValue={v.carrierName ?? ""} placeholder="z. B. Spedition Muster" />
          </div>
        )}
        {kind !== "eigen" && (
          <div className="field">
            <label className="label" htmlFor={id("trackingNo")}>Sendungs- / Speditionsnummer</label>
            <input className="input" id={id("trackingNo")} name="trackingNo" maxLength={80} defaultValue={v.trackingNo ?? ""} autoCapitalize="characters" autoComplete="off" placeholder="aus Avis oder Lieferschein" data-testid="ship-trackno" />
          </div>
        )}
      </div>
      {kind !== "eigen" && (
        <div className="field">
          <label className="label" htmlFor={id("trackingUrl")}>Link zur Sendungsverfolgung (optional)</label>
          <input className="input" id={id("trackingUrl")} name="trackingUrl" type="url" inputMode="url" maxLength={600} defaultValue={v.trackingUrl ?? ""} placeholder="https://… – aus der Mail der Spedition einfügen" />
          {kind === "spedition" && <span className="small muted">Speditionen schicken den Link meist per Mail. Eingefügt, öffnen ihn alle (und der Kunde) mit einem Tipp.</span>}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
        <div className="field"><label className="label" htmlFor={id("pal")}>Paletten</label><input className="input" id={id("pal")} name="palletCount" type="number" min={0} max={9999} inputMode="numeric" defaultValue={v.palletCount ?? ""} data-testid="ship-pallets" /></div>
        <div className="field"><label className="label" htmlFor={id("ctn")}>Kartons</label><input className="input" id={id("ctn")} name="cartonCount" type="number" min={0} max={9999} inputMode="numeric" defaultValue={v.cartonCount ?? ""} /></div>
      </div>
      <div className="field">
        <label className="label" htmlFor={id("note")}>Interne Notiz (sieht der Kunde nie)</label>
        <textarea className="input" id={id("note")} name="note" rows={2} maxLength={2000} defaultValue={v.note ?? ""} />
      </div>
    </>
  );
}

/** Neue Sendung anlegen (Anlieferung oder Versand) – mit Termin und Fotos. */
export function NewShipmentForm({ customers, today }: { customers: string[]; today: string }) {
  const [state, action] = useActionState<ShipState, FormData>(createShipment, null);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [shared, setShared] = useState(true);
  const [pending, start] = useTransition();
  const submitKey = useSubmitKey();
  useEffect(() => {
    if (state) submitKey.settled();
  }, [state, submitKey]);
  return (
    <form
      className="stack"
      style={{ gap: 10 }}
      data-testid="ship-new"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set("photosShared", shared ? "on" : "off");
        for (const p of photos) fd.append("photos", p.file, p.file.name);
        start(() => action(submitKey.stamp(fd)));
      }}
    >
      <BaseFields v={{}} customers={customers} idPrefix="n" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        <div className="field"><label className="label" htmlFor="n-date">Termin (erwartet am)</label><input className="input" id="n-date" name="plannedDate" type="date" min={addDays(today, -365)} max={addDays(today, 365)} data-testid="ship-date" /></div>
        <div className="field"><label className="label" htmlFor="n-time">Zeitfenster</label><input className="input" id="n-time" name="plannedTime" maxLength={40} placeholder="z. B. 8–12 Uhr" /></div>
      </div>
      <div className="field">
        <span className="label">Fotos (Ladung, Lieferschein)</span>
        <PhotoPicker photos={photos} onChange={setPhotos} />
        {photos.length > 0 && (
          <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Fotos im Kunden-Link zeigen
          </label>
        )}
      </div>
      <button className="btn btn-primary" type="submit" disabled={pending} style={{ alignSelf: "flex-start" }} data-testid="ship-create">{pending ? "Lege an …" : "Sendung anlegen"}</button>
      <Msg state={state} />
    </form>
  );
}

const addDays = (iso: string, d: number) => {
  const x = new Date(`${iso}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
};

/** Kleines Formular für eine Aktion an der Sendung (Termin, Status, Notiz …) mit Rückmeldung. */
export function ShipAction({ id, intent, children, testid, className = "stack", resetOnOk = false }: { id: string; intent: string; children: React.ReactNode; testid?: string; className?: string; resetOnOk?: boolean }) {
  const [state, action, pending] = useActionState<ShipState, FormData>(shipmentAction, null);
  // Eingaben bleiben bei Fehlern stehen; Auswahlfelder zeigen nach dem Speichern den gespeicherten Wert.
  const keep = useKeepForm(state, action, { resetOnSuccess: resetOnOk });
  return (
    <form ref={keep.ref} action={action} onSubmit={keep.onSubmit} className={className} style={{ gap: 8 }} data-testid={testid} aria-busy={pending}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="intent" value={intent} />
      {children}
      <Msg state={state} />
    </form>
  );
}

/** Stammdaten der Sendung ändern. */
export function EditShipmentForm({ id, v, customers }: { id: string; v: BaseValues; customers: string[] }) {
  return (
    <ShipAction id={id} intent="bearbeiten" testid="ship-edit">
      <BaseFields v={v} customers={customers} idPrefix="e" />
      <button className="btn btn-small btn-primary" type="submit" style={{ alignSelf: "flex-start" }}>Speichern</button>
    </ShipAction>
  );
}

/** Fotos nachträglich hinzufügen. */
export function AddShipmentPhotos({ id }: { id: string }) {
  const [state, action] = useActionState<ShipState, FormData>(shipmentAction, null);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [shared, setShared] = useState(true);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (state?.ok) setPhotos([]);
  }, [state]);
  function save() {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("intent", "fotos");
    fd.set("photosShared", shared ? "on" : "off");
    for (const p of photos) fd.append("photos", p.file, p.file.name);
    start(() => action(fd));
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <PhotoPicker photos={photos} onChange={setPhotos} />
      {photos.length > 0 && (
        <>
          <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Im Kunden-Link zeigen
          </label>
          <button className="btn btn-primary btn-small" type="button" onClick={save} disabled={pending} style={{ alignSelf: "flex-start" }} data-testid="ship-photo-save">
            {pending ? "Speichere …" : `${photos.length} Foto${photos.length === 1 ? "" : "s"} speichern`}
          </button>
        </>
      )}
      <Msg state={state} />
    </div>
  );
}

type LinkRow = { id: string; path: string | null; state: "aktiv" | "abgelaufen" | "widerrufen"; until: string; views: number; photos: boolean };

/** Kunden-Link: erstellen, kopieren, teilen (WhatsApp, Mail …), zurückziehen. */
export function ShareLinks({ id, links, title, customerEmail, publicBase = null }: { id: string; links: LinkRow[]; title: string; customerEmail: string | null; publicBase?: string | null }) {
  const [state, action, pending] = useActionState<ShipState, FormData>(shipmentAction, null);
  const keep = useKeepForm(state, action);
  const [origin, setOrigin] = useState("");
  // Kunden sind nicht im eigenen Netz: mit öffentlicher Adresse (PUBLIC_URL) gilt die, sonst die aktuelle.
  useEffect(() => setOrigin(publicBase ?? window.location.origin), [publicBase]);
  const fresh = state?.ok && state.link ? state.link : null;
  const active = links.filter((l) => l.state === "aktiv" && l.path);
  const shown = fresh && !active.some((l) => l.path === fresh) ? [{ id: "neu", path: fresh, state: "aktiv" as const, until: "", views: 0, photos: true }, ...active] : active;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <form action={action} ref={keep.ref} onSubmit={keep.onSubmit} className="stack" style={{ gap: 8 }} data-testid="ship-link-form">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="intent" value="link" />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor="l-days">Gültig für</label>
            <select className="select" id="l-days" name="days" defaultValue="7">{LINK_DAYS.map((d) => <option key={d} value={d}>{d} Tage</option>)}</select>
          </div>
          <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" name="showPhotos" value="on" defaultChecked /> Fotos zeigen
          </label>
          <button className="btn btn-primary btn-small" type="submit" disabled={pending} data-testid="ship-link-create">{pending ? "Erstelle …" : "Link für Kunden erstellen"}</button>
        </div>
        <Msg state={state} />
      </form>
      {shown.map((l) => (
        <LinkLine key={l.id} id={id} row={l} url={`${origin}${l.path}`} title={title} customerEmail={customerEmail} highlight={l.path === fresh} />
      ))}
      {links.filter((l) => l.state !== "aktiv").length > 0 && (
        <details>
          <summary className="small muted">Frühere Links ({links.filter((l) => l.state !== "aktiv").length})</summary>
          <ul className="small muted" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {links.filter((l) => l.state !== "aktiv").map((l) => <li key={l.id}>{l.state === "widerrufen" ? "zurückgezogen" : `abgelaufen am ${l.until}`} · {l.views}× geöffnet</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function LinkLine({ id, row, url, title, customerEmail, highlight }: { id: string; row: LinkRow; url: string; title: string; customerEmail: string | null; highlight: boolean }) {
  const [copied, setCopied] = useState(false);
  const [revokeState, revoke, revoking] = useActionState<ShipState, FormData>(shipmentAction, null);
  const text = `Sendungsverfolgung „${title}“: ${url}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("Link kopieren:", url);
    }
  }
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Sendungsverfolgung", text, url });
      } catch {
        /* abgebrochen */
      }
    } else void copy();
  }
  if (revokeState?.ok) return <div className="notice notice-ok">{revokeState.message}</div>;
  return (
    <div className={`card card-pad${highlight ? " ship-link-new" : ""}`} style={{ padding: 10 }} data-testid="ship-link">
      <div className="small" style={{ wordBreak: "break-all" }}><a href={url} target="_blank" rel="noreferrer" data-testid="ship-link-url">{url}</a></div>
      <div className="small muted">{row.until ? `gültig bis ${row.until}` : "gerade erstellt"}{row.photos ? "" : " · ohne Fotos"}{row.views ? ` · ${row.views}× geöffnet` : ""}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
        <button className="btn btn-small btn-primary" type="button" onClick={copy} data-testid="ship-link-copy">{copied ? "✓ Kopiert" : "Link kopieren"}</button>
        <button className="btn btn-small" type="button" onClick={share}>Teilen (WhatsApp …)</button>
        <a className="btn btn-small" href={`mailto:${customerEmail ?? ""}?subject=${encodeURIComponent(`Sendungsverfolgung: ${title}`)}&body=${encodeURIComponent(`Guten Tag,\n\nhier können Sie den aktuellen Stand Ihrer Sendung verfolgen:\n${url}\n\nViele Grüße`)}`}>Per E-Mail</a>
        {row.id !== "neu" && (
          <form action={revoke}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="intent" value="link-widerrufen" />
            <input type="hidden" name="linkId" value={row.id} />
            <button className="btn btn-small" type="submit" disabled={revoking} onClick={(e) => { if (!window.confirm("Link zurückziehen? Der Kunde sieht dann nichts mehr.")) e.preventDefault(); }}>Zurückziehen</button>
          </form>
        )}
      </div>
      {revokeState && !revokeState.ok && <div className="notice notice-warn">{revokeState.message}</div>}
    </div>
  );
}
