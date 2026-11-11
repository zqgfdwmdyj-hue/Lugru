import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { KampagneFilter, KampagnePosition } from "@/db/tables/abverkauf";
import type { Session } from "@/lib/auth/session";
import { openPii, sealPii } from "@/lib/pii";
import { adelprepAbsender } from "./briefe";
import { leadImFilter, mhdNorm, mhdPruefen, nachfassFaellig, ustIdFormat, ZIELGRUPPEN, type Zielgruppe } from "./kampagne-logic";
import { datenschutzHinweis, preisPosition, quelleSperre } from "./logic";
import { absender, AbverkaufFehler, einstellungen, entwuerfeErstellen } from "./service";

// B34.3b Kampagnen: Zielgruppe + Produktauswahl aus dem Bestand (MHD/Charge, Mindestrestlaufzeit) + Preise (Einstand +
// Aufschlag, Staffeln, Mindestmenge) + Brieftext + Lead-Filter (Branche, PLZ, Umkreis um das Lager, Größe, Status).
// Brief mit QR-Code/Kurzlink → öffentliche Anfrageseite → Aufgabe im Posteingang. Nachfassen nur als Aufgabe.

const K = schema.abverkaufKampagnen;
const L = schema.abverkaufLeads;
const A = schema.abverkaufAnschreiben;
const AN = schema.abverkaufAnfragen;

const heute = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
const neuerCode = () => randomBytes(6).toString("base64url").replace(/[-_]/g, "x").slice(0, 8).toUpperCase();

export type Kampagne = typeof K.$inferSelect;

function pruefeSchreiben(s: Session) {
  if (s.readOnly) throw new AbverkaufFehler("Nur ansehen – nichts geändert.");
}

export async function kampagneAnlegen(s: Session, o: { name: string; zielgruppe: Zielgruppe; nachfass: boolean }): Promise<string> {
  pruefeSchreiben(s);
  const z = ZIELGRUPPEN[o.zielgruppe] ?? ZIELGRUPPEN.sonstige;
  const filter: KampagneFilter = { branche: z.branche, plz: null, umkreisKm: z.umkreisKm, groesse: null, status: ["neu"], nurAdelprep: o.zielgruppe === "adelprep_lager" };
  const cfg = await einstellungen(s.tenantId);
  const [k] = await db
    .insert(K)
    .values({ tenantId: s.tenantId, name: (o.name.trim() || z.name).slice(0, 120), zielgruppe: o.zielgruppe, code: neuerCode(), filter, brieftext: z.textVorlage, aufschlagProzent: cfg.aufschlagProzent, mindestRestlaufzeitMonate: 6, nachfassTage: o.nachfass ? 21 : null, erstelltVon: s.userId })
    .returning({ id: K.id });
  return k.id;
}

export async function kampagnenListe(tenantId: string) {
  const ks = await db.select().from(K).where(eq(K.tenantId, tenantId)).orderBy(desc(K.createdAt)).limit(100);
  const zahlen = ks.length
    ? await db.select({ k: A.kampagneId, n: sql<number>`count(*)::int`, b: sql<number>`count(*) filter (where ${A.status} = 'beantwortet')::int` }).from(A).where(and(eq(A.tenantId, tenantId), inArray(A.kampagneId, ks.map((k) => k.id)))).groupBy(A.kampagneId)
    : [];
  const anfragen = ks.length ? await db.select({ k: AN.kampagneId, n: sql<number>`count(*)::int` }).from(AN).where(and(eq(AN.tenantId, tenantId), inArray(AN.kampagneId, ks.map((k) => k.id)))).groupBy(AN.kampagneId) : [];
  return ks.map((k) => ({ ...k, anschreiben: zahlen.find((z) => z.k === k.id)?.n ?? 0, beantwortet: zahlen.find((z) => z.k === k.id)?.b ?? 0, anfragen: anfragen.find((z) => z.k === k.id)?.n ?? 0 }));
}

export async function kampagneLesen(tenantId: string, id: string): Promise<Kampagne | null> {
  const [k] = await db.select().from(K).where(and(eq(K.tenantId, tenantId), eq(K.id, id)));
  return k ?? null;
}

export async function kampagneSpeichern(s: Session, id: string, p: { name?: string; brieftext?: string; aufschlagProzent?: number; mindestRestlaufzeitMonate?: number; nachfassTage?: number | null; filter?: Partial<KampagneFilter>; offenePunkte?: Record<string, boolean>; aktiv?: boolean }) {
  pruefeSchreiben(s);
  const k = await kampagneLesen(s.tenantId, id);
  if (!k) throw new AbverkaufFehler("Kampagne nicht gefunden.");
  await db
    .update(K)
    .set({
      ...(p.name?.trim() ? { name: p.name.trim().slice(0, 120) } : {}),
      ...(p.brieftext?.trim() ? { brieftext: p.brieftext.trim().slice(0, 3000) } : {}),
      ...(p.aufschlagProzent !== undefined && Number.isFinite(p.aufschlagProzent) ? { aufschlagProzent: Math.min(200, Math.max(0, p.aufschlagProzent)) } : {}),
      ...(p.mindestRestlaufzeitMonate !== undefined && Number.isFinite(p.mindestRestlaufzeitMonate) ? { mindestRestlaufzeitMonate: Math.min(60, Math.max(0, Math.round(p.mindestRestlaufzeitMonate))) } : {}),
      ...(p.nachfassTage !== undefined ? { nachfassTage: p.nachfassTage && p.nachfassTage > 0 ? Math.min(120, Math.round(p.nachfassTage)) : null } : {}),
      ...(p.filter ? { filter: { ...k.filter, ...p.filter } } : {}),
      ...(p.offenePunkte ? { offenePunkte: { ...k.offenePunkte, ...p.offenePunkte } } : {}),
      ...(p.aktiv !== undefined ? { aktiv: p.aktiv } : {}),
    })
    .where(eq(K.id, id));
  // Preise und MHD-Prüfung folgen Aufschlag und Mindestrestlaufzeit
  if (p.aufschlagProzent !== undefined || p.mindestRestlaufzeitMonate !== undefined) await positionenSetzen(s, id, (await kampagneLesen(s.tenantId, id))!.positionen.map((x) => ({ sku: x.sku, menge: x.menge, mindestmenge: x.mindestmenge, mhd: x.mhd, charge: x.charge })));
}

// ---- Produktauswahl aus dem Bestand -----------------------------------------------------------------------------------

export type BestandZeile = { sku: string; asin: string | null; titel: string; stueck: number; ek: number | null; reichweite: number | null; kapital: number | null };

/** Bestand mit Stückzahl > 0, gefiltert nach Marke/Kategorie (Teilwort im Titel bzw. in der SKU), Reichweite und Kapital. */
export async function bestandKandidaten(tenantId: string, f: { suche?: string; minReichweite?: number | null; minKapital?: number | null }): Promise<BestandZeile[]> {
  const { kapitalAmpel } = await import("@/lib/money/kapital-service");
  const { zeilen } = await kapitalAmpel(tenantId, heute());
  const q = (f.suche ?? "").trim().toLowerCase();
  return zeilen
    .filter((z) => z.stueck > 0)
    .filter((z) => !q || `${z.name ?? ""} ${z.sku}`.toLowerCase().includes(q))
    .filter((z) => !f.minReichweite || (z.reichweite ?? 0) >= f.minReichweite)
    .filter((z) => !f.minKapital || (z.kapital ?? 0) >= f.minKapital)
    .map((z) => ({ sku: z.sku, asin: z.asin, titel: z.name ?? z.sku, stueck: z.stueck, ek: z.ek, reichweite: z.reichweite, kapital: z.kapital }))
    .sort((a, b) => (b.kapital ?? 0) - (a.kapital ?? 0))
    .slice(0, 300);
}

/** Positionen setzen: Preis = Einstand (EK je Stück) + Aufschlag, Staffeln; MHD/Charge prüfen (Mindestrestlaufzeit). */
export async function positionenSetzen(s: Session, id: string, eingaben: { sku: string; menge: number; mindestmenge: number; mhd: string | null; charge: string | null }[]): Promise<{ angeboten: number; nicht: number }> {
  pruefeSchreiben(s);
  const k = await kampagneLesen(s.tenantId, id);
  if (!k) throw new AbverkaufFehler("Kampagne nicht gefunden.");
  const cfg = await einstellungen(s.tenantId);
  const bestand = new Map((await bestandKandidaten(s.tenantId, {})).map((b) => [b.sku, b]));
  const alt = new Map(k.positionen.map((p) => [p.sku, p]));
  const pflicht = ZIELGRUPPEN[k.zielgruppe].mhdPflicht;
  const positionen: KampagnePosition[] = [];
  for (const e of eingaben.slice(0, 100)) {
    const b = bestand.get(e.sku);
    const vorher = alt.get(e.sku);
    const einstand = b?.ek ?? vorher?.einstand ?? null;
    const titel = b?.titel ?? vorher?.titel ?? e.sku;
    if (einstand === null || !(einstand > 0)) {
      positionen.push({ sku: e.sku, asin: b?.asin ?? null, titel, marke: null, menge: Math.max(0, Math.round(e.menge)), mindestmenge: Math.max(1, Math.round(e.mindestmenge || 1)), einstand: 0, preis: 0, staffel: [], mhd: mhdNorm(e.mhd), charge: e.charge?.trim() || null, angeboten: false, grund: "Einstand (EK) fehlt – nicht angeboten" });
      continue;
    }
    const pp = preisPosition(einstand, k.aufschlagProzent, cfg.staffeln);
    const menge = Math.max(1, Math.min(b?.stueck ?? e.menge, Math.round(e.menge || b?.stueck || 1)));
    const mhd = mhdPruefen({ mhd: e.mhd, charge: e.charge }, heute(), k.mindestRestlaufzeitMonate, pflicht);
    positionen.push({ sku: e.sku, asin: b?.asin ?? vorher?.asin ?? null, titel, marke: null, menge, mindestmenge: Math.max(1, Math.round(e.mindestmenge || 1)), einstand: Math.round(einstand * 100) / 100, preis: pp.preis, staffel: pp.staffel.filter((st) => st.ab <= menge), mhd: mhdNorm(e.mhd), charge: e.charge?.trim() || null, angeboten: mhd.ok, grund: mhd.grund });
  }
  await db.update(K).set({ positionen }).where(eq(K.id, id));
  return { angeboten: positionen.filter((p) => p.angeboten).length, nicht: positionen.filter((p) => !p.angeboten).length };
}

// ---- Leads im Filter ---------------------------------------------------------------------------------------------------

export async function leadsFuerKampagne(tenantId: string, k: Kampagne) {
  const cfg = await einstellungen(tenantId);
  const lager = cfg.lager.lat !== null && cfg.lager.lng !== null ? { lat: cfg.lager.lat, lng: cfg.lager.lng } : null;
  const leads = await db.select({ id: L.id, firma: L.firma, plz: L.plz, ort: L.ort, kategorie: L.kategorie, lat: L.lat, lng: L.lng, groesse: L.groesse, status: L.status, adelprep: L.adelprep, quelleTyp: L.quelleTyp }).from(L).where(eq(L.tenantId, tenantId)).orderBy(L.firma).limit(2000);
  const schon = new Set((await db.select({ l: A.leadId }).from(A).where(and(eq(A.tenantId, tenantId), eq(A.kampagneId, k.id)))).map((x) => x.l));
  return leads.map((l) => {
    const qs = quelleSperre(l, cfg.leadQuellen);
    return { ...l, ...(qs ? { ok: false, km: null, grund: "Quelle LUCID – Nutzung noch nicht geklärt" } : leadImFilter(l, k.filter, lager)), angeschrieben: schon.has(l.id) };
  });
}

/** Entwürfe für die ausgewählten Leads im Filter (höchstens 20) – Brief mit QR-Code; nichts wird verschickt. */
export async function kampagneEntwuerfe(s: Session, id: string, leadIds: string[]) {
  const k = await kampagneLesen(s.tenantId, id);
  if (!k) throw new AbverkaufFehler("Kampagne nicht gefunden.");
  const imFilter = new Set((await leadsFuerKampagne(s.tenantId, k)).filter((l) => l.ok && !l.angeschrieben).map((l) => l.id));
  const ids = leadIds.filter((x) => imFilter.has(x));
  if (!ids.length) throw new AbverkaufFehler("Keine Leads im Filter ausgewählt (oder schon angeschrieben).");
  const angebot = k.positionen.filter((p) => p.angeboten);
  if (!angebot.length && k.zielgruppe !== "adelprep_lager") throw new AbverkaufFehler("Keine angebotenen Positionen – Produkte auswählen (MHD/Einstand prüfen).");
  const cfg = await einstellungen(s.tenantId);
  const vonLogistik = ZIELGRUPPEN[k.zielgruppe].absender === "adelprep";
  if (vonLogistik && !cfg.adelprep.firma.trim()) throw new AbverkaufFehler("Für die Lager-Kampagne fehlen die Firmendaten der Logistik-Firma (Einstellungen → AdelPrep).");
  return entwuerfeErstellen(s, ids, null, { id: k.id, positionen: angebot.map((p) => ({ titel: p.titel, menge: p.menge, preis: p.preis })), brieftext: k.brieftext, betreff: k.name, absender: vonLogistik ? adelprepAbsender(cfg) : undefined });
}

// ---- Öffentliche Anfrageseite --------------------------------------------------------------------------------------------

/** Für die öffentliche Seite: nur Angebot, Absender und Datenschutzhinweis – keine Einstände, keine internen Angaben. */
export async function anfrageKampagne(code: string) {
  if (!/^[A-Z0-9]{6,12}$/.test(code)) return null;
  const [k] = await db.select().from(K).where(and(eq(K.code, code), eq(K.aktiv, true)));
  if (!k) return null;
  const cfg = await einstellungen(k.tenantId);
  const vonLogistik = ZIELGRUPPEN[k.zielgruppe].absender === "adelprep";
  const abs = vonLogistik ? adelprepAbsender(cfg) : await absender(k.tenantId);
  return {
    kampagne: { code: k.code, name: k.name, zielgruppe: k.zielgruppe },
    absender: { name: abs.name, email: abs.email, telefon: abs.telefon },
    positionen: k.positionen.filter((p) => p.angeboten).map((p) => ({ sku: p.sku, titel: p.titel, preis: p.preis, staffel: p.staffel, mindestmenge: p.mindestmenge, mhd: p.mhd })),
    datenschutz: `Ihre Angaben (Firma, USt-ID, Ansprechpartner, Kontakt, Wunsch) verwenden wir nur, um Ihre Anfrage zu beantworten. Verantwortlich: ${[abs.name, abs.strasse, [abs.plz, abs.ort].filter(Boolean).join(" "), abs.email].filter(Boolean).join(", ")}. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO (Anfrage). Löschung nach Abschluss bzw. spätestens nach 12 Monaten ohne Auftrag; Auskunft, Berichtigung, Löschung und Widerspruch jederzeit an die genannte Adresse.`,
    gewerbe: true,
  };
}

export type AnfrageEingabe = { code: string; anschreiben: string | null; firma: string; ustId: string; name: string; email: string; telefon: string; wunsch: string[]; freitext: string; menge: string; einwilligung: boolean; falle: string };

/** Anfrage speichern → Aufgabe + Eintrag im Posteingang. Prüft Pflichtfelder und USt-ID-Format (Gewerbenachweis). */
export async function anfrageAnlegen(e: AnfrageEingabe): Promise<{ ok: true } | { ok: false; fehler: string }> {
  if (e.falle) return { ok: true }; // Honigtopf: Bots bekommen „ok“, es wird nichts gespeichert
  if (!/^[A-Z0-9]{6,12}$/.test(e.code)) return { ok: false, fehler: "Kampagne nicht gefunden oder beendet." };
  const [k] = await db.select().from(K).where(and(eq(K.code, e.code), eq(K.aktiv, true)));
  if (!k) return { ok: false, fehler: "Kampagne nicht gefunden oder beendet." };
  if (!e.firma.trim()) return { ok: false, fehler: "Bitte die Firma angeben." };
  if (!e.email.trim() && !e.telefon.trim()) return { ok: false, fehler: "Bitte E-Mail oder Telefon angeben." };
  if (e.email.trim() && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e.email.trim())) return { ok: false, fehler: "E-Mail-Adresse prüfen." };
  if (!e.einwilligung) return { ok: false, fehler: "Bitte der Verarbeitung Ihrer Angaben für die Anfrage zustimmen." };
  const ust = ustIdFormat(e.ustId);
  if (!ust.ok) return { ok: false, fehler: `USt-ID (Gewerbenachweis): ${ust.grund}.` };
  const positionen = new Map(k.positionen.map((p) => [p.sku, p.titel]));
  const wunsch = [...e.wunsch.map((x) => positionen.get(x)).filter((x): x is string => !!x), e.freitext.trim()].filter(Boolean).join("; ").slice(0, 1000);
  const kontakt = [e.name.trim(), e.email.trim(), e.telefon.trim()].filter(Boolean).join(" · ").slice(0, 300);
  const code = e.anschreiben && /^AV-[A-Z0-9]{4,8}$/i.test(e.anschreiben) ? e.anschreiben.toUpperCase() : null;
  const [an] = await db.insert(AN).values({ tenantId: k.tenantId, kampagneId: k.id, anschreibenCode: code, firma: e.firma.trim().slice(0, 200), ustId: ust.norm, ustIdOk: ust.ok, kontakt: kontakt ? sealPii(kontakt) : null, wunsch, menge: e.menge.trim().slice(0, 200) || null }).returning({ id: AN.id });
  const [t] = await db
    .insert(schema.tasks)
    .values({ tenantId: k.tenantId, title: `Anfrage aus Kampagne „${k.name}“: ${e.firma.trim().slice(0, 80)}`, notes: `Wunsch: ${wunsch || "–"}. Menge: ${e.menge.trim() || "–"}. USt-ID ${ust.norm} (Format ok – vor Lieferung prüfen). ${code ? `Bezug ${code}. ` : ""}Kontakt im Posteingang.`, dueDate: heute(), priority: "critical", category: "einkauf", systemKey: `abverkauf-anfrage:${an.id}`, link: `/b2b/abverkauf/kampagnen/${k.id}#anfragen` })
    .onConflictDoNothing()
    .returning({ id: schema.tasks.id });
  await db.update(AN).set({ taskId: t?.id ?? null }).where(eq(AN.id, an.id));
  // Posteingang: Eintrag „Anfrageseite“ mit allen Angaben, verknüpft mit der Aufgabe
  await db
    .insert(schema.emails)
    .values({ tenantId: k.tenantId, messageKey: `anfrage:${an.id}`, fromAddress: e.email.trim() || null, fromName: `${e.name.trim() || e.firma.trim()} (Anfrageseite)`.slice(0, 200), subject: `Anfrage ${k.name}: ${e.firma.trim()}`.slice(0, 300), receivedAt: new Date(), snippet: wunsch.slice(0, 200), bodyText: [`Firma: ${e.firma.trim()}`, `USt-ID: ${ust.norm}`, `Kontakt: ${kontakt}`, `Wunschartikel: ${wunsch || "–"}`, `Menge: ${e.menge.trim() || "–"}`, code ? `Bezug: ${code}` : "", `Kampagne: ${k.name} (${k.code})`].filter(Boolean).join("\n"), ordner: "Anfrageseite", category: "action", topic: "Restposten-Anfrage", taskId: t?.id ?? null })
    .onConflictDoNothing();
  if (code) {
    const beantw = await db.update(A).set({ status: "beantwortet", antwortAm: new Date() }).where(and(eq(A.tenantId, k.tenantId), eq(A.code, code), inArray(A.status, ["freigegeben", "versendet"]))).returning({ lead: A.leadId });
    // B35: Anfrage über QR-Code/Kampagnen-ID dem Lead zuordnen (Verlauf, Löschfrist neu)
    if (beantw.length) await import("./lead-maschine").then((x) => x.kontaktMerken(k.tenantId, beantw.map((b) => b.lead), `Anfrage über Kampagne „${k.name}“ (QR-Code/Link)`, false)).catch(() => undefined);
  }
  return { ok: true };
}

export async function anfragenListe(tenantId: string, kampagneId: string) {
  return (await db.select().from(AN).where(and(eq(AN.tenantId, tenantId), eq(AN.kampagneId, kampagneId))).orderBy(desc(AN.createdAt)).limit(200)).map((a) => ({ ...a, kontakt: a.kontakt ? openPii(a.kontakt) : null }));
}

// ---- Nachfassen (Aufgabe, nie automatischer Versand) -------------------------------------------------------------------

export async function nachfassPruefen(tenantId: string): Promise<number> {
  const ks = await db.select().from(K).where(and(eq(K.tenantId, tenantId), eq(K.aktiv, true), isNotNull(K.nachfassTage)));
  let n = 0;
  for (const k of ks) {
    const offen = await db.select({ id: A.id, versendetAm: A.versendetAm, status: A.status }).from(A).where(and(eq(A.tenantId, tenantId), eq(A.kampagneId, k.id), eq(A.status, "versendet"), isNull(A.nachfassAm)));
    const faellig = offen.filter((a) => nachfassFaellig(a.versendetAm, false, new Date(), k.nachfassTage));
    if (!faellig.length) continue;
    await db.insert(schema.tasks).values({ tenantId, title: `Nachfassen: ${faellig.length} Anschreiben der Kampagne „${k.name}“ ohne Antwort seit ${k.nachfassTage} Tagen`, notes: "Kurz anrufen oder einen zweiten Brief freigeben – nichts wird automatisch verschickt.", dueDate: heute(), priority: "normal", category: "einkauf", systemKey: `abverkauf-nachfass:${k.id}:${heute()}`, link: `/b2b/abverkauf/kampagnen/${k.id}` }).onConflictDoNothing();
    await db.update(A).set({ nachfassAm: new Date() }).where(inArray(A.id, faellig.map((a) => a.id)));
    n += faellig.length;
  }
  return n;
}

/** Datenschutzhinweis für die Lager-Kampagne (Absender = Logistik-Firma) – genutzt in der Vorschau. */
export async function kampagneDatenschutz(tenantId: string, k: Kampagne) {
  const cfg = await einstellungen(tenantId);
  const abs = ZIELGRUPPEN[k.zielgruppe].absender === "adelprep" ? adelprepAbsender(cfg) : await absender(tenantId);
  return datenschutzHinweis(abs, { quelle: "Lead-Quelle je Händler", quelleDatum: heute(), loeschenAm: heute() });
}
