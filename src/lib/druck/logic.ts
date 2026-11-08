// Druckagent – reine Logik: Vorlagen und Rechte, Zustand des Agenten/Druckers (Symbol neben dem Druckknopf),
// Warteschlange (7 Tage, Push nach 15 Minuten), Steuer-Barcodes des Scanner-Arbeitsplatzes, PDF-Erkennung.

import { rolleVon } from "@/lib/auth/rollen";
import type { DruckerModell } from "./brother";

export const AGENT_ONLINE_SEK = 90; // Heartbeat alle 30 s – nach drei verpassten gilt der Agent als offline
export const WARTESCHLANGE_TAGE = 7;
export const PROTOKOLL_TAGE = 90;
export const PUSH_NACH_MIN = 15;
export const AGENT_VERSION_AKTUELL = "1.0.0";

export type Rolle = "owner" | "staff" | "va" | string;

export type VorlageId = "fnsku" | "ean" | "preis" | "stellplatz" | "retoure" | "lieferschein" | "dhl" | "palette" | "kartonlabel" | "fnsku_pdf" | "steuerkarte";

export type Vorlage = { id: VorlageId; text: string; drucker: DruckerModell; medium: string; va: boolean; felder: { name: string; text: string; pflicht?: boolean }[] };

/** Vorlagen mit fest hinterlegtem Drucker (62 mm → QL-800, 102 mm → QL-1100). VA darf FNSKU, Retouren, DHL. */
export const VORLAGEN: Record<VorlageId, Vorlage> = {
  fnsku: { id: "fnsku", text: "FNSKU-Etikett", drucker: "QL-800", medium: "62x29", va: true, felder: [{ name: "fnsku", text: "FNSKU", pflicht: true }, { name: "titel", text: "Titel" }, { name: "zustand", text: "Zustand" }, { name: "zusatz", text: "Made in / Charge" }] },
  ean: { id: "ean", text: "Produkt-/EAN-Etikett", drucker: "QL-800", medium: "62x29", va: true, felder: [{ name: "ean", text: "EAN", pflicht: true }, { name: "titel", text: "Titel" }, { name: "sku", text: "SKU" }] },
  preis: { id: "preis", text: "Preisetikett (B2B/Kleinanzeigen)", drucker: "QL-800", medium: "62x29", va: false, felder: [{ name: "preis", text: "Preis (€)", pflicht: true }, { name: "titel", text: "Titel", pflicht: true }, { name: "zusatz", text: "Zusatz (z. B. inkl. MwSt.)" }] },
  stellplatz: { id: "stellplatz", text: "Stellplatz-Schild", drucker: "QL-800", medium: "62x29", va: true, felder: [{ name: "fach", text: "Fachcode", pflicht: true }, { name: "text", text: "Beschriftung" }] },
  retoure: { id: "retoure", text: "Retouren-Etikett", drucker: "QL-800", medium: "62x29", va: true, felder: [{ name: "retSku", text: "RET-SKU", pflicht: true }, { name: "lpn", text: "LPN" }, { name: "titel", text: "Titel" }] },
  lieferschein: { id: "lieferschein", text: "Lieferschein-Label B2B", drucker: "QL-800", medium: "62x29", va: true, felder: [{ name: "kunde", text: "Kunde", pflicht: true }, { name: "nummer", text: "Lieferschein-Nr.", pflicht: true }, { name: "pakete", text: "Paket x von y" }] },
  dhl: { id: "dhl", text: "DHL-/Internetmarke-Label (102 mm)", drucker: "QL-1100", medium: "102x152", va: true, felder: [] },
  palette: { id: "palette", text: "Palettenlabel (102 mm)", drucker: "QL-1100", medium: "102x152", va: true, felder: [{ name: "kunde", text: "Kunde", pflicht: true }, { name: "nummer", text: "Palettennummer", pflicht: true }, { name: "inhalt", text: "Inhalt" }] },
  kartonlabel: { id: "kartonlabel", text: "FBA-Kartonlabel aus PDF (102 mm)", drucker: "QL-1100", medium: "102x152", va: true, felder: [] },
  fnsku_pdf: { id: "fnsku_pdf", text: "FNSKU-Etiketten aus PDF-Bogen", drucker: "QL-800", medium: "62x29", va: true, felder: [] },
  steuerkarte: { id: "steuerkarte", text: "Steuer-Barcodes (Scanner)", drucker: "QL-1100", medium: "102x152", va: true, felder: [] },
};

/** VA-Konto: Rolle „va“ oder Mitarbeiter mit genau den VA-Bereichen (Vorlage „VA“ in der Benutzerliste). */
export const istVa = (o: { role: Rolle; areas?: string[] | null; privateAccess?: boolean }) =>
  o.role === "va" || (o.role === "staff" && rolleVon({ role: "staff", areas: o.areas ?? null, privateAccess: !!o.privateAccess, privateScope: "voll" }) === "va");

export function darfDrucken(o: { role: Rolle; readOnly?: boolean; areas?: string[] | null; privateAccess?: boolean }, vorlage: VorlageId): boolean {
  if (o.readOnly) return false;
  if (o.role === "owner") return true;
  if (istVa(o)) return VORLAGEN[vorlage]?.va ?? false;
  return true; // Mitarbeiter mit Lager-/Büro-Zugang
}

export const darfAgentEinstellen = (o: { role: Rolle; readOnly?: boolean }) => o.role === "owner" && !o.readOnly;

// ---- Zustand für das Symbol neben dem Druckknopf ------------------------------------------------------------------------

export type AgentKurz = { id: string; name: string; geraet: string | null; letzterKontakt: Date | null; deaktiviertAm: Date | null; letzterDruck: Date | null; drucker: { name: string; modell: string | null; zustand: string; fehler: string[] }[] };
export type Symbol = { farbe: "gruen" | "gelb" | "rot" | "grau"; text: string; online: boolean; agentId: string | null };

const uhr = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);

export const agentOnline = (a: Pick<AgentKurz, "letzterKontakt" | "deaktiviertAm">, jetzt = new Date()) => !a.deaktiviertAm && !!a.letzterKontakt && jetzt.getTime() - a.letzterKontakt.getTime() <= AGENT_ONLINE_SEK * 1000;

export const ZUSTAND_TEXT: Record<string, string> = { bereit: "bereit", papier_leer: "Papier leer", deckel_offen: "Deckel offen", aus: "aus", fehler: "Fehler", unbekannt: "Zustand unbekannt", schlaeft: "schläft" };

/** Symbol für einen Drucker (Modell): grün = bereit, gelb = Papier leer/Deckel offen/aus (Shelly), rot = Agent nicht erreichbar. */
export function druckerSymbol(agenten: AgentKurz[], modell: DruckerModell, jetzt = new Date()): Symbol {
  const aktiv = agenten.filter((a) => !a.deaktiviertAm);
  if (!aktiv.length) return { farbe: "grau", text: "Kein Druckagent eingerichtet (Einstellungen → Drucker)", online: false, agentId: null };
  const mit = aktiv.find((a) => a.drucker.some((d) => d.modell === modell)) ?? aktiv.sort((x, y) => (y.letzterKontakt?.getTime() ?? 0) - (x.letzterKontakt?.getTime() ?? 0))[0];
  const geraet = mit.geraet ?? mit.name;
  if (!agentOnline(mit, jetzt)) return { farbe: "rot", text: `${geraet} nicht erreichbar seit ${mit.letzterKontakt ? uhr(mit.letzterKontakt) : "–"} – Aufträge warten`, online: false, agentId: mit.id };
  const d = mit.drucker.find((x) => x.modell === modell);
  if (!d) return { farbe: "gelb", text: `${modell} am ${geraet} nicht gefunden`, online: true, agentId: mit.id };
  const zuletzt = mit.letzterDruck ? ` · zuletzt gedruckt ${uhr(mit.letzterDruck)}` : "";
  if (d.zustand === "bereit") return { farbe: "gruen", text: `${modell} bereit (${geraet})${zuletzt}`, online: true, agentId: mit.id };
  const was = ZUSTAND_TEXT[d.zustand] ?? d.zustand;
  const details = d.fehler.filter((f) => f.toLowerCase() !== was.toLowerCase());
  return { farbe: d.zustand === "aus" ? "gelb" : "rot", text: `${modell}: ${was}${details.length ? ` (${details.join(", ")})` : ""} – ${geraet}`, online: true, agentId: mit.id };
}

// ---- Warteschlange ------------------------------------------------------------------------------------------------------

export function pushFaellig(a: { status: string; createdAt: Date; pushGemeldetAm: Date | null }, jetzt = new Date()): boolean {
  return a.status === "wartet" && !a.pushGemeldetAm && jetzt.getTime() - a.createdAt.getTime() >= PUSH_NACH_MIN * 60_000;
}

export const abgelaufen = (a: { status: string; createdAt: Date }, jetzt = new Date()) => a.status === "wartet" && jetzt.getTime() - a.createdAt.getTime() > WARTESCHLANGE_TAGE * 86_400_000;

/** Statusmeldung des Agenten → neuer Auftragsstatus („wartet“ = zurück in die Warteschlange, z. B. Drucker startet nicht). */
export function statusNachMeldung(s: string): "gedruckt" | "fehler" | "wartet" | null {
  return s === "gedruckt" ? "gedruckt" : s === "fehler" ? "fehler" : s === "wartet" ? "wartet" : null;
}

// ---- Scanner-Arbeitsplatz ------------------------------------------------------------------------------------------------

export const STEUER_CODES = { "LUGRU-DRUCKEN-1": "Drucken 1×", "LUGRU-DRUCKEN-5": "Drucken 5×", "LUGRU-WARENEINGANG": "Wareneingang", "LUGRU-STELLPLATZ": "Stellplatz", "LUGRU-RETOURE": "Retoure", "LUGRU-ABBRECHEN": "Abbrechen" } as const;
export type SteuerCode = keyof typeof STEUER_CODES;

export type ScanArt = { art: "steuer"; code: SteuerCode } | { art: "fnsku"; wert: string } | { art: "ean"; wert: string } | { art: "lpn"; wert: string } | { art: "fach"; wert: string } | { art: "menge"; wert: number } | { art: "sku"; wert: string };

/** Eingabe des Handscanners (Tastatur) einordnen. */
export function scanEinordnen(roh: string): ScanArt | null {
  const t = roh.trim();
  if (!t) return null;
  const u = t.toUpperCase();
  if (u in STEUER_CODES) return { art: "steuer", code: u as SteuerCode };
  if (/^X00[0-9A-Z]{7}$/.test(u)) return { art: "fnsku", wert: u };
  if (/^\d{8}$|^\d{12,14}$/.test(t)) return { art: "ean", wert: t };
  if (/^LPN[0-9A-Z]{6,}$/.test(u)) return { art: "lpn", wert: u };
  if (/^FACH[-_ ]?[0-9A-Z-]+$/.test(u)) return { art: "fach", wert: u.replace(/^FACH[-_ ]?/, "") };
  if (/^\d{1,3}$/.test(t)) return { art: "menge", wert: Number(t) };
  return { art: "sku", wert: t };
}

export const steuerAnzahl = (c: SteuerCode) => (c === "LUGRU-DRUCKEN-5" ? 5 : c === "LUGRU-DRUCKEN-1" ? 1 : 0);

// ---- PDFs aus Seller Central ---------------------------------------------------------------------------------------------

export const SENDUNG_RE = /\bFBA[0-9A-Z]{8,12}\b/;

export function sendungsnummer(text: string): string | null {
  return SENDUNG_RE.exec(text.toUpperCase())?.[0] ?? null;
}

/** Seitengröße (Punkte, 1/72 Zoll) → Art: 102×152 mm (4×6 Zoll) = Kartonlabel, A4 = FNSKU-Bogen. */
export function pdfArt(breitePt: number, hoehePt: number): "kartonlabel" | "a4" | "unbekannt" {
  const [b, h] = [Math.min(breitePt, hoehePt), Math.max(breitePt, hoehePt)];
  const mm = (pt: number) => (pt / 72) * 25.4;
  if (Math.abs(mm(b) - 101.6) < 4 && Math.abs(mm(h) - 152.4) < 5) return "kartonlabel";
  if (Math.abs(mm(b) - 210) < 4 && Math.abs(mm(h) - 297) < 5) return "a4";
  return "unbekannt";
}

export type Raster = { id: "27" | "40"; spalten: number; zeilen: number; breiteMm: number; hoeheMm: number; randLinksMm: number; randObenMm: number; abstandXMm: number; abstandYMm: number };

/** Amazon-FNSKU-Bögen A4: 27 (3 × 9, 63,5 × 29,6 mm) und 40 (4 × 10, 52,5 × 29,7 mm). */
export const RASTER: Record<"27" | "40", Raster> = {
  "27": { id: "27", spalten: 3, zeilen: 9, breiteMm: 63.5, hoeheMm: 29.6, randLinksMm: 7.25, randObenMm: 15.3, abstandXMm: 2.5, abstandYMm: 0 },
  "40": { id: "40", spalten: 4, zeilen: 10, breiteMm: 52.5, hoeheMm: 29.7, randLinksMm: 0, randObenMm: 0, abstandXMm: 0, abstandYMm: 0 },
};

/** Raster aus der Zahl der FNSKUs je Seite raten (mehr als 27 → 40er-Bogen). */
export function rasterRaten(fnskusJeSeite: number): Raster {
  return fnskusJeSeite > 27 ? RASTER["40"] : RASTER["27"];
}

/** Zellen eines Bogens in Pixeln (bei dpi), Reihenfolge zeilenweise. */
export function zellen(r: Raster, dpi: number): { x: number; y: number; b: number; h: number }[] {
  const px = (mm: number) => Math.round((mm / 25.4) * dpi);
  const out: { x: number; y: number; b: number; h: number }[] = [];
  for (let z = 0; z < r.zeilen; z++) for (let s = 0; s < r.spalten; s++) out.push({ x: px(r.randLinksMm + s * (r.breiteMm + r.abstandXMm)), y: px(r.randObenMm + z * (r.hoeheMm + r.abstandYMm)), b: px(r.breiteMm), h: px(r.hoeheMm) });
  return out;
}

export const fnskusImText = (t: string) => (t.toUpperCase().match(/\bX00[0-9A-Z]{7}\b/g) ?? []).length;

/** Token-Form prüfen (da_ + 32 Zeichen base64url). */
export const tokenFormOk = (t: string | null | undefined) => !!t && /^da_[A-Za-z0-9_-]{32,64}$/.test(t);
