import Link from "next/link";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { customerKey } from "@/lib/pallets/billing";
import { loadShipments, type Shipment } from "@/lib/pallets/shipment-service";
import { STATUS_TONE, carrierLabel, delayDays, dmy, groupShipments, isOverdue, loadText, statusLabel, trackingLink } from "@/lib/pallets/shipments";
import { NewShipmentForm } from "./forms";
import { ShipmentNotices } from "./notices";

export default async function SendungenPage({ searchParams }: { searchParams: Promise<{ richtung?: string; neu?: string }> }) {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const sp = await searchParams;
  const today = todayIso();
  const richtung = sp.richtung === "ein" || sp.richtung === "aus" ? sp.richtung : null;
  const all = await loadShipments(t);
  const rows = richtung ? all.filter((s) => s.direction === richtung) : all;
  const g = groupShipments(rows, today);
  const ids = rows.map((r) => r.id);
  const photoCounts = new Map<string, number>();
  if (ids.length) {
    const pc = await db
      .select({ id: schema.palletShipmentPhotos.shipmentId, n: sql<number>`count(*)::int` })
      .from(schema.palletShipmentPhotos)
      .where(and(eq(schema.palletShipmentPhotos.tenantId, t), inArray(schema.palletShipmentPhotos.shipmentId, ids)))
      .groupBy(schema.palletShipmentPhotos.shipmentId);
    for (const r of pc) photoCounts.set(r.id, r.n);
  }
  const P = schema.pallets;
  const used = (await db.selectDistinct({ c: P.customer }).from(P).where(and(eq(P.tenantId, t), isNotNull(P.customer)))).map((r) => r.c!.trim());
  const known = (await db.select({ name: schema.palletCustomers.name }).from(schema.palletCustomers).where(eq(schema.palletCustomers.tenantId, t))).map((r) => r.name);
  const byKey = new Map<string, string>();
  for (const n of [...known, ...used]) if (n && !byKey.has(customerKey(n))) byKey.set(customerKey(n), n);
  const customers = [...byKey.values()].sort((a, b) => a.localeCompare(b, "de"));
  const open = all.filter((s) => s.status !== "zugestellt" && s.status !== "storniert");
  const shifted = open.filter((s) => delayDays(s) > 0 || s.status === "verzoegert").length;

  const section = (title: string, list: Shipment[], testid: string, empty?: string) =>
    list.length || empty ? (
      <section className="card" data-testid={testid}>
        <div className="card-head"><h2>{title} ({list.length})</h2></div>
        {list.length ? <ShipmentTable rows={list} today={today} photos={photoCounts} /> : <div className="card-pad small muted">{empty}</div>}
      </section>
    ) : null;

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Lager</div><h1>Sendungen (Spedition & Paket)</h1></div>
        <span className="small muted">Anlieferungen ins Lager und Versand an Kunden – mit Sendungsnummer, Termin, Meldungen für alle und Link für den Kunden.</span>
      </div>

      <ShipmentNotices session={session} />

      <div className="grid-kpi" data-testid="ship-kpis">
        <div className="card card-pad"><div className="kpi-label">Heute erwartet</div><div className="kpi-value" data-testid="kpi-today">{g.today.length}</div></div>
        <div className="card card-pad"><div className="kpi-label">Überfällig</div><div className="kpi-value" data-testid="kpi-late">{g.overdue.length}</div><div className="small muted">Termin vorbei, nicht angekommen</div></div>
        <div className="card card-pad"><div className="kpi-label">Offen gesamt</div><div className="kpi-value">{open.length}</div><div className="small muted">{shifted ? `${shifted} verschoben` : "keine verschoben"}</div></div>
      </div>

      <nav className="tabs" aria-label="Richtung" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Link className={`btn btn-small${!richtung ? " btn-primary" : ""}`} href="/paletten/sendungen">Alle</Link>
        <Link className={`btn btn-small${richtung === "ein" ? " btn-primary" : ""}`} href="/paletten/sendungen?richtung=ein">⬇ Anlieferungen</Link>
        <Link className={`btn btn-small${richtung === "aus" ? " btn-primary" : ""}`} href="/paletten/sendungen?richtung=aus">⬆ Versand an Kunden</Link>
      </nav>

      <details className="card" open={all.length === 0 || sp.neu === "1"} data-testid="ship-new-card">
        <summary className="card-head" style={{ cursor: "pointer" }}><h2 style={{ display: "inline" }}>＋ Neue Sendung</h2></summary>
        <div className="card-pad"><NewShipmentForm customers={customers} today={today} /></div>
      </details>

      {section("Überfällig", g.overdue, "ship-overdue")}
      {section("Heute", g.today, "ship-today")}
      {section("Nächste 7 Tage", g.soon, "ship-soon")}
      {section("Später / ohne Termin", g.later, "ship-later", rows.length ? undefined : "Noch keine Sendungen. Oben „Neue Sendung“ öffnen.")}
      {g.done.length > 0 && (
        <details className="card" data-testid="ship-done">
          <summary className="card-head" style={{ cursor: "pointer" }}><h2 style={{ display: "inline" }}>Erledigt (letzte 60 Tage, {g.done.length})</h2></summary>
          <ShipmentTable rows={g.done} today={today} photos={photoCounts} />
        </details>
      )}
    </>
  );
}

function ShipmentTable({ rows, today, photos }: { rows: Shipment[]; today: string; photos: Map<string, number> }) {
  return (
    <table className="table">
      <thead><tr><th></th><th>Sendung</th><th>Spedition / Nr.</th><th>Termin</th><th>Status</th></tr></thead>
      <tbody>
        {rows.map((s) => {
          const link = trackingLink(s);
          const delay = delayDays(s);
          const n = photos.get(s.id) ?? 0;
          return (
            <tr key={s.id} data-testid="ship-row">
              <td title={s.direction === "ein" ? "Anlieferung ins Lager" : "Versand an Kunden"} aria-label={s.direction === "ein" ? "Anlieferung" : "Versand"}>{s.direction === "ein" ? "⬇" : "⬆"}</td>
              <td>
                <Link href={`/paletten/sendungen/${s.id}`}><strong>{s.title}</strong></Link>
                {n > 0 && <span className="small muted"> · 📷{n}</span>}
                <div className="small muted">{[s.customer, s.place, loadText(s)].filter(Boolean).join(" · ")}</div>
              </td>
              <td>
                {carrierLabel(s.carrier, s.carrierName)}
                {s.trackingNo && <div className="small num">{link ? <a href={link} target="_blank" rel="noreferrer">{s.trackingNo} ↗</a> : s.trackingNo}</div>}
              </td>
              <td className="num">
                {s.plannedDate ? dmy(s.plannedDate) : <span className="muted">offen</span>}
                {s.plannedTime && <div className="small muted">{s.plannedTime}</div>}
                {delay > 0 && <div><span className="tag tag-warn">+{delay} Tag{delay === 1 ? "" : "e"} verschoben</span></div>}
              </td>
              <td>
                <span className={STATUS_TONE[s.status]}>{statusLabel(s.status, s.direction)}</span>
                {isOverdue(s, today) && <span className="tag tag-danger" style={{ marginLeft: 4 }}>überfällig</span>}
                {s.location && <div className="small muted">{s.location}</div>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
