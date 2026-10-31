// Speditions-Sendungen im Palettenlager: Anlieferungen ins Lager und Versand an Kunden (Paletten, Kartons).
// Reine Logik ohne Datenbank – Spediteure und Verfolgungs-Links, Status, Terminverschiebungen,
// Auswertung der DHL-Sendungsverfolgung und Gültigkeit der Kunden-Links. Damit testbar.

import type { ShipmentStatus } from "@/db/tables/pallets";

export type Direction = "ein" | "aus";

type Carrier = { key: string; name: string; kind: "paket" | "spedition" | "eigen"; url?: (no: string) => string; dhl?: boolean };

// Direkte Links nur, wo das Format der Seite feststeht. Bei Speditionen (Schenker, Dachser …) kommt der Link
// meist per Mail – der lässt sich unter „Link zur Sendungsverfolgung“ einfügen.
export const CARRIERS: Carrier[] = [
  { key: "dhl", name: "DHL (Paket, Express, Freight)", kind: "paket", dhl: true, url: (n) => `https://www.dhl.com/de-de/home/tracking.html?tracking-id=${n}&submit=1` },
  { key: "dpd", name: "DPD", kind: "paket", url: (n) => `https://tracking.dpd.de/status/de_DE/parcel/${n}` },
  { key: "gls", name: "GLS", kind: "paket", url: (n) => `https://gls-group.com/DE/de/paketverfolgung?match=${n}` },
  { key: "ups", name: "UPS", kind: "paket", url: (n) => `https://www.ups.com/track?loc=de_DE&tracknum=${n}` },
  { key: "fedex", name: "FedEx / TNT", kind: "paket", url: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}` },
  { key: "hermes", name: "Hermes", kind: "paket", url: (n) => `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation/#${n}` },
  { key: "schenker", name: "DB Schenker / DSV", kind: "spedition" },
  { key: "dachser", name: "DACHSER", kind: "spedition" },
  { key: "kuehne", name: "Kühne+Nagel", kind: "spedition" },
  { key: "raben", name: "Raben", kind: "spedition" },
  { key: "rhenus", name: "Rhenus", kind: "spedition" },
  { key: "hellmann", name: "Hellmann", kind: "spedition" },
  { key: "geodis", name: "GEODIS", kind: "spedition" },
  { key: "cargoline", name: "CargoLine", kind: "spedition" },
  { key: "systemalliance", name: "System Alliance", kind: "spedition" },
  { key: "24plus", name: "24plus", kind: "spedition" },
  { key: "ctl", name: "CTL (Cargo Trans Logistik)", kind: "spedition" },
  { key: "ids", name: "IDS Logistik", kind: "spedition" },
  { key: "andere", name: "Andere Spedition", kind: "spedition" },
  { key: "eigen", name: "Eigener Transport / Abholung", kind: "eigen" },
];
export const CARRIER_KEYS = CARRIERS.map((c) => c.key);

export const carrierOf = (key: string) => CARRIERS.find((c) => c.key === key) ?? null;

/** Anzeigename: bei „andere“ der eingetragene Name. */
export function carrierLabel(key: string, name?: string | null): string {
  if (key === "andere" && name?.trim()) return name.trim();
  return carrierOf(key)?.name ?? (name?.trim() || key);
}

/** Nur http(s)-Links, ohne Leerzeichen – landet als href beim Kunden. */
export function safeUrl(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim();
  if (!v || v.length > 600 || /\s/.test(v)) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Link zur Sendungsverfolgung: eigener Link vor dem Standard-Link des Spediteurs. */
export function trackingLink(s: { carrier: string; trackingNo?: string | null; trackingUrl?: string | null }): string | null {
  const own = safeUrl(s.trackingUrl);
  if (own) return own;
  const no = s.trackingNo?.trim();
  const c = carrierOf(s.carrier);
  return no && c?.url ? c.url(encodeURIComponent(no)) : null;
}

/** Sendungsnummer bereinigen (Leerzeichen raus, die kommen beim Kopieren aus PDFs mit). */
export function cleanTrackingNo(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").replace(/\s+/g, "").slice(0, 60);
  return v || null;
}

export const DIRECTION_LABEL: Record<Direction, string> = { ein: "Anlieferung ins Lager", aus: "Versand an Kunden" };

export function statusLabel(status: ShipmentStatus, direction: Direction): string {
  switch (status) {
    case "geplant":
      return "geplant";
    case "unterwegs":
      return "unterwegs";
    case "verzoegert":
      return "verzögert";
    case "zugestellt":
      return direction === "ein" ? "angekommen" : "zugestellt";
    case "problem":
      return "Problem";
    case "storniert":
      return "storniert";
  }
}

export const STATUS_TONE: Record<ShipmentStatus, string> = {
  geplant: "tag",
  unterwegs: "tag tag-info",
  verzoegert: "tag tag-warn",
  zugestellt: "tag tag-ok",
  problem: "tag tag-danger",
  storniert: "tag",
};

const OPEN: ShipmentStatus[] = ["geplant", "unterwegs", "verzoegert", "problem"];
export const isOpen = (status: ShipmentStatus) => OPEN.includes(status);

/** Noch nicht angekommen, obwohl der Tag vorbei ist. */
export function isOverdue(s: { status: ShipmentStatus; plannedDate: string | null }, today: string): boolean {
  return isOpen(s.status) && Boolean(s.plannedDate) && s.plannedDate! < today;
}

export const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400_000);
}

/** „Termin verschoben: 28.10. → 30.10. (+2 Tage)“ bzw. „Termin festgelegt: 30.10.2026“. */
export function shiftText(oldDate: string | null, newDate: string | null, reason?: string | null): string {
  const why = reason?.trim() ? ` – ${reason.trim()}` : "";
  if (!newDate) return `Termin offen${oldDate ? ` (war ${dmy(oldDate)})` : ""}${why}`;
  if (!oldDate) return `Termin: ${dmy(newDate)}${why}`;
  const d = daysBetween(oldDate, newDate);
  const delta = d === 0 ? "" : ` (${d > 0 ? "+" : "−"}${Math.abs(d)} Tag${Math.abs(d) === 1 ? "" : "e"})`;
  return `Termin verschoben: ${dm(oldDate)} → ${dmy(newDate)}${delta}${why}`;
}

/**
 * Neuer Termin: Wird es später als geplant, gilt die Sendung als verzögert (außer sie ist schon da,
 * hat ein Problem oder ist storniert). Früher oder gleich ändert den Status nicht.
 */
export function statusAfterShift(status: ShipmentStatus, oldDate: string | null, newDate: string | null): ShipmentStatus {
  if ((status === "geplant" || status === "unterwegs") && oldDate && newDate && newDate > oldDate) return "verzoegert";
  return status;
}

/** Um wie viele Tage liegt der aktuelle Termin hinter dem zuerst genannten? */
export function delayDays(s: { firstDate: string | null; plannedDate: string | null }): number {
  return s.firstDate && s.plannedDate ? Math.max(0, daysBetween(s.firstDate, s.plannedDate)) : 0;
}

export type ShipmentLike = { id: string; status: ShipmentStatus; plannedDate: string | null; direction: Direction };

/** Übersicht: überfällig, heute, demnächst (7 Tage), später/ohne Termin, erledigt. */
export function groupShipments<T extends ShipmentLike>(rows: T[], today: string) {
  const week = new Date(`${today}T12:00:00Z`);
  week.setUTCDate(week.getUTCDate() + 7);
  const weekIso = week.toISOString().slice(0, 10);
  const byDate = (a: T, b: T) => (a.plannedDate ?? "9999").localeCompare(b.plannedDate ?? "9999");
  const open = rows.filter((r) => isOpen(r.status)).sort(byDate);
  return {
    overdue: open.filter((r) => isOverdue(r, today)),
    today: open.filter((r) => r.plannedDate === today),
    soon: open.filter((r) => r.plannedDate && r.plannedDate > today && r.plannedDate <= weekIso),
    later: open.filter((r) => !r.plannedDate || r.plannedDate > weekIso),
    done: rows.filter((r) => !isOpen(r.status)),
  };
}

// ---------------------------------------------------------------------------------------------------------
// DHL Sendungsverfolgung (Shipment Tracking – Unified): Antwort auswerten.

export type DhlTrack = {
  code: "pre-transit" | "transit" | "delivered" | "failure" | "unknown";
  text: string;
  place: string | null;
  at: string | null;
  /** Voraussichtlicher Zustelltag (JJJJ-MM-TT, deutsche Zeit), falls DHL einen nennt. */
  eta: string | null;
};

const berlinDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
};

type DhlJson = {
  shipments?: {
    status?: { statusCode?: string; status?: string; description?: string; timestamp?: string; location?: { address?: { addressLocality?: string } } };
    estimatedTimeOfDelivery?: string;
    estimatedDeliveryTimeFrame?: { estimatedFrom?: string; estimatedThrough?: string };
  }[];
};

export function parseDhlTracking(json: unknown): DhlTrack | null {
  const s = (json as DhlJson | null)?.shipments?.[0];
  if (!s?.status) return null;
  const st = s.status;
  const code = (["pre-transit", "transit", "delivered", "failure"] as const).find((c) => c === st.statusCode) ?? "unknown";
  const text = (st.description || st.status || "").replace(/\s+/g, " ").trim().slice(0, 240);
  const place = st.location?.address?.addressLocality?.replace(/\s+/g, " ").trim().slice(0, 120) || null;
  const etaRaw = s.estimatedTimeOfDelivery ?? s.estimatedDeliveryTimeFrame?.estimatedThrough ?? s.estimatedDeliveryTimeFrame?.estimatedFrom ?? null;
  return { code, text, place, at: st.timestamp ?? null, eta: etaRaw ? berlinDay(etaRaw) : null };
}

export type TrackUpdate = { status?: ShipmentStatus; location?: string; plannedDate?: string; deliveredAt?: Date; events: { kind: "automatisch" | "termin"; text: string; notice: boolean; oldDate?: string | null; newDate?: string | null; status?: ShipmentStatus }[] };

/**
 * Was ändert sich durch den Stand bei DHL? Nur echte Änderungen (Ort/Status), damit der Verlauf nicht bei
 * jedem Abruf wächst. Zugestellt und Problem sind Meldungen für alle; ein neuer Liefertag ebenfalls.
 */
export function trackingUpdate(cur: { status: ShipmentStatus; location: string | null; plannedDate: string | null; direction: Direction }, t: DhlTrack): TrackUpdate {
  const out: TrackUpdate = { events: [] };
  if (cur.status === "zugestellt" || cur.status === "storniert") return out;
  const loc = [t.text, t.place ? `(${t.place})` : ""].filter(Boolean).join(" ").slice(0, 300);
  if (loc && loc !== cur.location) out.location = loc;
  let status: ShipmentStatus = cur.status;
  if (t.code === "delivered") status = "zugestellt";
  else if (t.code === "failure") status = "problem";
  else if (t.code === "transit" && cur.status === "geplant") status = "unterwegs";
  if (status !== cur.status) {
    out.status = status;
    if (status === "zugestellt") out.deliveredAt = t.at && !Number.isNaN(Date.parse(t.at)) ? new Date(t.at) : new Date();
  }
  if (out.location || out.status) {
    const label = out.status ? `DHL: ${statusLabel(status, cur.direction)}` : "DHL";
    out.events.push({ kind: "automatisch", text: `${label}${loc ? ` – ${loc}` : ""}`, notice: status === "zugestellt" || status === "problem", status: out.status });
  }
  if (t.eta && t.eta !== cur.plannedDate && status !== "zugestellt") {
    out.plannedDate = t.eta;
    const next = statusAfterShift(out.status ?? cur.status, cur.plannedDate, t.eta);
    if (next !== (out.status ?? cur.status)) out.status = next;
    out.events.push({ kind: "termin", text: shiftText(cur.plannedDate, t.eta, "laut DHL"), notice: true, oldDate: cur.plannedDate, newDate: t.eta, status: out.status });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Kunden-Links

export const LINK_DAYS = [3, 7, 14, 30] as const;

/** Gültig bis: Ende des n-ten Tages (deutsche Zeit grob: 23:59 UTC reicht als „bis einschließlich“). */
export function linkExpiry(days: number, now = new Date()): Date {
  const n = Math.max(1, Math.min(60, Math.round(days) || 7));
  const d = new Date(now.getTime() + n * 86400_000);
  d.setUTCHours(23, 59, 0, 0);
  return d;
}

export type LinkState = "aktiv" | "abgelaufen" | "widerrufen";
export function linkState(l: { expiresAt: Date; revokedAt: Date | null }, now = new Date()): LinkState {
  if (l.revokedAt) return "widerrufen";
  return l.expiresAt.getTime() < now.getTime() ? "abgelaufen" : "aktiv";
}

/** Was der Kunde im Verlauf sieht: keine internen Einträge, keine Namen. */
export function publicTimeline<E extends { kind: string; text: string; internal: boolean; createdAt: Date }>(events: E[]) {
  return events.filter((e) => !e.internal).map((e) => ({ at: e.createdAt, text: e.text }));
}

/** Kurzbeschreibung der Ladung, z. B. „3 Paletten · 12 Kartons“. */
export function loadText(s: { palletCount: number | null; cartonCount: number | null }): string {
  const parts: string[] = [];
  if (s.palletCount) parts.push(`${s.palletCount} Palette${s.palletCount === 1 ? "" : "n"}`);
  if (s.cartonCount) parts.push(`${s.cartonCount} Karton${s.cartonCount === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------------------------------------
// Eingaben (Formular oder Assistent) prüfen

export type ShipmentBase = {
  direction: Direction;
  title: string;
  customer: string | null;
  place: string | null;
  carrier: string;
  carrierName: string | null;
  trackingNo: string | null;
  trackingUrl: string | null;
  palletCount: number | null;
  cartonCount: number | null;
  note: string | null;
};

const oneLine = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max) || null;
const countOf = (v: unknown) => {
  const n = Math.round(Number(String(v ?? "").trim() || "0"));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 9999) : null;
};

/** Stammdaten einer Sendung aus Formularfeldern bzw. Werkzeug-Eingaben – Fehlertext oder geprüfte Werte. */
export function parseShipmentBase(get: (key: string) => unknown): ShipmentBase | string {
  const d = get("direction");
  const direction = d === "aus" ? "aus" : d === "ein" ? "ein" : null;
  if (!direction) return "Bitte wählen: Anlieferung ins Lager oder Versand an Kunden.";
  const title = oneLine(get("title"), 160);
  if (!title) return "Bitte eine Bezeichnung eingeben (z. B. „12 Paletten Shampoo“ oder die Auftragsnummer).";
  const carrier = String(get("carrier") ?? "");
  if (!CARRIER_KEYS.includes(carrier)) return "Bitte Spedition bzw. Paketdienst wählen.";
  const rawUrl = String(get("trackingUrl") ?? "").trim();
  const trackingUrl = safeUrl(rawUrl);
  if (rawUrl && !trackingUrl) return "Der Link zur Sendungsverfolgung muss mit https:// beginnen.";
  return {
    direction,
    title,
    customer: oneLine(get("customer"), 120),
    place: oneLine(get("place"), 160),
    carrier,
    carrierName: carrier === "andere" ? oneLine(get("carrierName"), 80) : null,
    trackingNo: cleanTrackingNo(String(get("trackingNo") ?? "")),
    trackingUrl,
    palletCount: countOf(get("palletCount")),
    cartonCount: countOf(get("cartonCount")),
    note: String(get("note") ?? "").trim().slice(0, 2000) || null,
  };
}

/** Ankündigung für den Verlauf – ohne interne Notiz, der Kunde sieht sie im Link. */
export function createdText(b: ShipmentBase, plannedDate: string | null, plannedTime: string | null) {
  const what = b.direction === "ein" ? "Anlieferung angekündigt" : "Versand angelegt";
  const parts = [loadText(b), carrierLabel(b.carrier, b.carrierName), plannedDate ? `Termin ${dmy(plannedDate)}${plannedTime ? ` (${plannedTime})` : ""}` : "Termin noch offen"].filter(Boolean);
  return `${what}: ${parts.join(" · ")}`;
}

/** Text für eine Terminänderung (Tag und/oder Zeitfenster). */
export function shiftEventText(cur: { plannedDate: string | null; plannedTime: string | null }, newDate: string | null, plannedTime: string | null, reason: string | null) {
  if (newDate === cur.plannedDate) return `Zeitfenster geändert: ${plannedTime ?? "offen"}${reason ? ` – ${reason}` : ""}`;
  const timeNote = plannedTime && plannedTime !== cur.plannedTime ? `, Zeitfenster ${plannedTime}` : "";
  return `${shiftText(cur.plannedDate, newDate, reason)}${timeNote}`;
}

export const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
