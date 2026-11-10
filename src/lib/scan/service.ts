import "server-only";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { budgetRest, heuteSumme, scanCode } from "./logic";

// B34.1 Scan-Modus (Handy, Laden und online): jeder Scan wird gespeichert (Eingabe, Ergebnis, Aktion). Nichts wird
// gekauft – „Kauf vorbereiten“ öffnet nur den Warenkorb- bzw. Produkt-Link (wie im Deal-Eingang). Kein Bot, kein
// Seller-Central-Zugriff.

const S = schema.scanEintraege;
export type ScanEintrag = typeof S.$inferSelect;
export class ScanFehler extends Error {}

const berlinTag = (d = new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);

export type ScanEingabe = {
  code: string;
  /** Ohne Preis (geteilter Amazon-Link): aktueller Buy-Box-Preis im Land des Links, mit Hinweis „bitte prüfen“. */
  preis: number | null;
  netto?: boolean;
  rueckverguetung?: number | null;
  menge?: number | null;
  modus?: "laden" | "online";
  shop?: string | null;
  offline?: boolean;
  /** Zeitpunkt auf dem Handy (Offline-Scans). */
  gescanntAm?: Date | null;
};

/** Prüfen und speichern. Bei Fehler (z. B. Keepa nicht erreichbar) bleibt der Scan mit Fehler stehen und wird nachgeprüft. */
export async function scanAusfuehren(session: Session, e: ScanEingabe) {
  const { scanPruefen } = await import("@/lib/mobil/service");
  const c = scanCode(e.code);
  if (!c) throw new ScanFehler("Bitte EAN, ASIN oder Amazon-Link eingeben.");
  let code = c.code;
  if (c.kurzlink) {
    const { resolveAsin } = await import("@/lib/brands/shop-service");
    const asin = await resolveAsin(c.code).catch(() => null);
    if (!asin) throw new ScanFehler("Kurzlink nicht auflösbar – bitte die ASIN eingeben.");
    code = asin;
  }
  let preisHinweis: string | null = null;
  if (!(e.preis && e.preis > 0)) {
    const land = e.modus === "online" ? amazonLand(e.code) : null;
    if (!land) throw new ScanFehler("Bitte den Preis eingeben.");
    const p = await amazonPreis(session.tenantId, code, land);
    if (!p) throw new ScanFehler(`Kein aktueller Amazon-Preis ${land} – bitte den Preis eingeben.`);
    e = { ...e, preis: p };
    preisHinweis = `Preis = aktueller Buy-Box-Preis Amazon ${land} (${p.toFixed(2).replace(".", ",")} €) – bitte prüfen.`;
  }
  const preis = e.preis as number;
  if (preis > 100_000) throw new ScanFehler("Bitte den Preis prüfen.");
  const rv = Math.min(50, Math.max(0, Number(e.rueckverguetung) || 0));
  const menge = e.menge && e.menge > 0 ? Math.round(e.menge) : null;
  const modus = e.modus === "online" ? "online" : "laden";
  // Amazon-Link im Online-Modus: als Kauf-Link merken (Amazon-zu-Amazon), sonst der geteilte Shop-Link.
  const shopUrl = (e.shop?.trim() || (/^https?:\/\//i.test(e.code.trim()) && !c.kurzlink ? e.code.trim() : "") || null)?.slice(0, 500) ?? null;
  const basis = { tenantId: session.tenantId, userId: session.userId, modus, code: e.code.trim().slice(0, 300), shopUrl, preis, netto: Boolean(e.netto), rueckverguetung: rv, menge, offline: Boolean(e.offline), gescanntAm: e.gescanntAm ?? new Date() } as const;
  try {
    const r0 = await scanPruefen(session.tenantId, { ean: code, preis, menge, netto: e.netto, rueckverguetung: rv });
    const r = preisHinweis ? { ...r0, hinweise: [preisHinweis, ...r0.hinweise].slice(0, 5) } : r0;
    const [row] = await db
      .insert(S)
      .values({ ...basis, asin: r.asin, titel: r.titel?.slice(0, 300) ?? null, ekNetto: r.ek_netto, ampel: r.ampel, land: r.land, gewinnStueck: r.gewinn_stueck, roi: r.roi, roiPa: r.roi_pa, empfohleneMenge: r.empfohlene_menge, ergebnis: r as unknown as Record<string, unknown> })
      .returning({ id: S.id });
    return { id: row.id, r, fehler: null as string | null, preis };
  } catch (err) {
    const fehler = err instanceof Error ? err.message.slice(0, 300) : "Prüfung fehlgeschlagen.";
    const [row] = await db.insert(S).values({ ...basis, fehler }).returning({ id: S.id });
    return { id: row.id, r: null, fehler, preis };
  }
}

/** Land eines Amazon-Links (amazon.de/.fr/.it/.es) – null bei EAN/ASIN ohne Link. */
function amazonLand(code: string): string | null {
  const m = /^https?:\/\/(?:www\.|smile\.)?amazon\.(de|fr|it|es)\//i.exec(code.trim());
  return m ? m[1].toUpperCase() : /^https?:\/\/(amzn\.(eu|to)|a\.co)\//i.test(code.trim()) || /^B0[A-Z0-9]{8}$/i.test(code.trim()) ? "DE" : null;
}

/** Aktueller Buy-Box-Preis (brutto, EUR) im Land – aus dem Keepa-Cache der Deal-Ampel. */
async function amazonPreis(tenantId: string, code: string, land: string): Promise<number | null> {
  const { dealPruefen } = await import("@/lib/deal-ampel/service");
  const r = await dealPruefen(tenantId, { code, ek: 1, ekIstNetto: false, menge: null, laender: [land] }).catch(() => null);
  return r?.laender.find((l) => l.land === land)?.vkEur ?? null;
}

/** Gespeicherten Scan mit Fehler neu prüfen (Netz wieder da, Keepa wieder erreichbar). */
export async function scanNeuPruefen(session: Session, id: string) {
  const { scanPruefen } = await import("@/lib/mobil/service");
  const [x] = await db.select().from(S).where(and(eq(S.tenantId, session.tenantId), eq(S.id, id)));
  if (!x) throw new ScanFehler("Scan nicht gefunden.");
  const c = scanCode(x.asin ?? x.code);
  if (!c || c.kurzlink) throw new ScanFehler("Code nicht lesbar.");
  try {
    const r = await scanPruefen(session.tenantId, { ean: c.code, preis: x.preis, menge: x.menge, netto: x.netto, rueckverguetung: x.rueckverguetung });
    await db.update(S).set({ asin: r.asin, titel: r.titel?.slice(0, 300) ?? null, ekNetto: r.ek_netto, ampel: r.ampel, land: r.land, gewinnStueck: r.gewinn_stueck, roi: r.roi, roiPa: r.roi_pa, empfohleneMenge: r.empfohlene_menge, ergebnis: r as unknown as Record<string, unknown>, fehler: null }).where(eq(S.id, x.id));
    return { id: x.id, r, fehler: null as string | null };
  } catch (err) {
    const fehler = err instanceof Error ? err.message.slice(0, 300) : "Prüfung fehlgeschlagen.";
    await db.update(S).set({ fehler }).where(eq(S.id, x.id));
    return { id: x.id, r: null, fehler };
  }
}

/** Offene Scans (Fehler, letzte 24 Std.) der Person neu prüfen – nach dem Nachreichen der Offline-Scans. */
export async function offeneNachpruefen(session: Session): Promise<number> {
  const rows = await db
    .select({ id: S.id })
    .from(S)
    .where(and(eq(S.tenantId, session.tenantId), eq(S.userId, session.userId), isNull(S.ampel), sql`${S.fehler} is not null`, gte(S.createdAt, new Date(Date.now() - 24 * 3600_000))))
    .limit(20);
  let n = 0;
  for (const r of rows) if ((await scanNeuPruefen(session, r.id)).r) n++;
  return n;
}

/** Push nach dem Nachprüfen eines Offline-Scans (Art „Deal“, ohne Discord – Scans sind persönlich). */
export async function offlineMelden(session: Session, id: string, r: { ampel: string; vorlesen: string; titel: string | null; asin: string } | null, fehler: string | null) {
  const { melden } = await import("@/lib/push/service");
  const titel = r ? `Offline-Scan geprüft: ${r.ampel === "gruen" ? "🟢 Grün" : r.ampel === "gelb" ? "🟡 Gelb" : "🔴 Rot"}` : "Offline-Scan: Prüfung offen";
  const text = r ? `${(r.titel ?? r.asin).slice(0, 60)} – ${r.vorlesen}` : `Noch nicht prüfbar: ${fehler ?? "unbekannter Fehler"}. Wird beim nächsten Öffnen erneut versucht.`;
  await melden(session.tenantId, [session.userId], { titel, text, link: `/scan?id=${id}`, art: "deal" }, { ohneDiscord: true }).catch(() => undefined);
}

/** „Heute gescannt“ der Person: Zeilen, Summe der geplanten Einkäufe, Budget-Rest und Kapital-Ampel des Bestands. */
export async function heuteGescannt(session: Session, heute = berlinTag()) {
  const zeilen = await db
    .select()
    .from(S)
    .where(and(eq(S.tenantId, session.tenantId), eq(S.userId, session.userId), sql`(${S.gescanntAm} at time zone 'Europe/Berlin')::date = ${heute}::date`))
    .orderBy(desc(S.gescanntAm))
    .limit(200);
  const summe = heuteSumme(zeilen);
  const { budgetEinstellung, budgetVerbraucht } = await import("@/lib/deal-eingang/kauf");
  const [b, v] = await Promise.all([budgetEinstellung(session.tenantId), budgetVerbraucht(session.tenantId)]);
  const budget = { ...budgetRest({ jeTag: b.jeTag, gekauftHeute: v.tag, geplant: summe.geplant }), jeTag: b.jeTag, gekauftHeute: v.tag };
  const { kapitalStand } = await import("@/lib/mobil/service");
  const k = await Promise.race([kapitalStand(session.tenantId), new Promise<null>((ok) => setTimeout(() => ok(null), 1500))]);
  const kapital = k?.summe ? { ...k.summe, rotAnteil: k.summe.gesamt > 0 ? Math.round((k.summe.rot / k.summe.gesamt) * 100) : 0 } : null;
  return { heute, zeilen, summe, budget, kapital };
}

export async function scanLesen(session: Session, id: string): Promise<ScanEintrag | null> {
  const [x] = await db.select().from(S).where(and(eq(S.tenantId, session.tenantId), eq(S.id, id)));
  return x ?? null;
}

export type Aktion = "einkaufsliste" | "deal" | "verworfen" | "kauf_vorbereitet" | "gekauft";

/**
 * Aktion je Scan: In Einkaufsliste (Menge, Preis, Shop/Ort), Als Deal speichern (Deal-Eingang mit einer Zeile,
 * ohne KI-Erkennung), Verwerfen, Kauf vorbereiten (nur Link, nichts gekauft), Gekauft (von Hand).
 */
export async function aktionSetzen(session: Session, id: string, aktion: Aktion, o: { menge?: number | null; preis?: number | null; ort?: string | null } = {}): Promise<{ ok: true; text: string; url?: string; eingangId?: string } | { ok: false; text: string }> {
  if (session.readOnly) return { ok: false, text: "Nur ansehen – nichts geändert." };
  const x = await scanLesen(session, id);
  if (!x) return { ok: false, text: "Scan nicht gefunden." };
  const menge = o.menge && o.menge > 0 ? Math.round(o.menge) : (x.listeMenge ?? x.menge ?? x.empfohleneMenge ?? 1);
  const preis = o.preis && o.preis > 0 ? o.preis : (x.listePreis ?? null);
  const ort = (o.ort ?? x.listeOrt ?? "").trim().slice(0, 120) || null;
  const W = and(eq(S.tenantId, session.tenantId), eq(S.id, x.id));
  if (aktion === "verworfen") {
    await db.update(S).set({ aktion }).where(W);
    return { ok: true, text: "Verworfen." };
  }
  if (aktion === "einkaufsliste" || aktion === "gekauft") {
    await db.update(S).set({ aktion, listeMenge: menge, listePreis: preis, listeOrt: ort }).where(W);
    return { ok: true, text: aktion === "gekauft" ? `Als gekauft markiert (${menge} Stück).` : `In der Einkaufsliste: ${menge} Stück${ort ? ` · ${ort}` : ""}.` };
  }
  if (aktion === "deal") {
    if (x.dealEingangId) return { ok: true, text: "Schon als Deal gespeichert.", eingangId: x.dealEingangId };
    const { eingangAnlegen, eingangPruefen } = await import("@/lib/deal-eingang/service");
    const c = scanCode(x.asin ?? x.code);
    const text = [`Scan ${x.modus === "online" ? "online" : "im Laden"}${ort ? ` (${ort})` : ""}: ${x.titel ?? x.asin ?? x.code}`, `Preis ${x.preis.toFixed(2).replace(".", ",")} € ${x.netto ? "netto" : "brutto"}${x.rueckverguetung ? `, Rückvergütung ${x.rueckverguetung} %` : ""}`, x.shopUrl ?? ""].filter(Boolean).join("\n");
    const ek = Math.round(x.preis * (1 - x.rueckverguetung / 100) * 100) / 100;
    const { id: eingangId, neu } = await eingangAnlegen(session.tenantId, session.userId, {
      weg: "manuell",
      quelle: "Scan-Modus",
      text,
      quelleRef: `scan:${x.id}`,
      angebote: [{ asin: c?.asin ?? x.asin, ean: c?.ean ?? null, name: x.titel, marke: null, ek, ekNetto: x.netto, waehrung: "EUR", menge, moq: null, staffel: null, versand: null, lieferzeit: null, zahlung: null, gueltigBis: null, zustand: null, packung: null }],
    });
    await db.update(S).set({ aktion, dealEingangId: eingangId, listeMenge: menge, listeOrt: ort }).where(W);
    if (neu) {
      const { after } = await import("next/server");
      after(() => eingangPruefen(session.tenantId, eingangId).catch(() => undefined));
    }
    return { ok: true, text: "Als Deal im Deal-Eingang gespeichert.", eingangId };
  }
  // Kauf vorbereiten: gleicher Link-Bau wie im Deal-Eingang (Shop-Profile, Amazon-Warenkorb-Link).
  const { shopProfileLaden } = await import("@/lib/deal-eingang/kauf");
  const { amazonProfil, istAmazon, kaufLink, profilFuer } = await import("@/lib/deal-eingang/shop-logic");
  const profile = await shopProfileLaden(session.tenantId);
  let profil = x.shopUrl ? profilFuer(x.shopUrl, profile) : null;
  if (!profil && x.shopUrl) profil = { kuerzel: "", name: new URL(x.shopUrl).hostname.replace(/^www\./, ""), domains: [], linkArt: "produktseite", linkMuster: null, hinweis: null, payback: null, aktiv: true };
  // Ohne Link: Amazon.de (gekauft wird im eigenen Land, nicht im besten Verkaufsland).
  if (!profil && x.modus === "online" && x.asin) profil = amazonProfil("DE", profile);
  if (!profil) return { ok: false, text: "Shop-Link fehlt – Link aus der Shop-App teilen oder einfügen." };
  const link = kaufLink(profil, { asin: x.asin, menge, produktUrl: x.shopUrl && !istAmazon(profil) ? x.shopUrl : null, suche: x.titel });
  if (!link) return { ok: false, text: "Für diesen Shop lässt sich kein Link bauen." };
  await db.update(S).set({ aktion: "kauf_vorbereitet", listeMenge: menge, listePreis: preis, listeOrt: ort ?? profil.name }).where(W);
  return { ok: true, text: `${link.warenkorb ? "Warenkorb" : "Produktseite"} ${profil.name} – ${link.hinweis ?? `Menge ${menge}`}. Gekauft ist damit nichts.`, url: link.url };
}

/** Beleg zum Scan: Preisschild → verschlüsselte Medienablage; Kassenbon → Rechnungsstation (Kamera-Stapel, KI liest). */
export async function belegZumScan(session: Session, id: string, art: "preisschild" | "kassenbon", bild: Buffer, typ: string): Promise<{ ok: boolean; text: string; belegId?: string }> {
  if (session.readOnly) return { ok: false, text: "Nur ansehen – nichts geändert." };
  if (!/^image\/(jpe?g|png|webp|heic)$/i.test(typ)) return { ok: false, text: "Bitte ein Foto (JPG/PNG) aufnehmen." };
  if (!bild.length || bild.length > 20_000_000) return { ok: false, text: "Foto fehlt oder ist größer als 20 MB." };
  const x = await scanLesen(session, id);
  if (!x) return { ok: false, text: "Scan nicht gefunden." };
  const am = new Date().toISOString();
  if (art === "preisschild") {
    const { neuerSchluessel, speichern } = await import("@/lib/medien/ablage");
    const key = neuerSchluessel(session.tenantId);
    await speichern(key, bild);
    await db.update(S).set({ belege: [...x.belege, { art, key, am }] }).where(and(eq(S.tenantId, session.tenantId), eq(S.id, x.id)));
    return { ok: true, text: "Preisschild gespeichert." };
  }
  const { blattAufnehmen, kameraStapel } = await import("@/lib/rechnungsstation/service");
  const wer = { userId: session.userId, name: "Scan-Modus" };
  const stapelId = await kameraStapel(session.tenantId, wer);
  const b = await blattAufnehmen(session.tenantId, wer, { stapelId, bild, bildTyp: typ });
  await db.update(S).set({ belege: [...x.belege, { art, belegId: b.id, am }] }).where(and(eq(S.tenantId, session.tenantId), eq(S.id, x.id)));
  return { ok: true, text: b.duplikat ? "Diesen Kassenbon gibt es schon in der Rechnungsstation." : "Kassenbon in der Rechnungsstation – die KI liest ihn.", belegId: b.id };
}
