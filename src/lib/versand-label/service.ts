import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Address } from "@/db/schema";
import { askClaude, modelFor } from "@/lib/ai/claude";
import { getIntegration } from "@/lib/integrations/store";
import { getSettings } from "@/lib/settings";
import { storeFile } from "@/lib/orders/service";
import {
  adresseAusKi,
  adresseAusText,
  gefahrgutPruefen,
  kosten,
  KI_AUFTRAG,
  pflichtFehlend,
  trackingLink,
  versandText,
  VERSAND_PRODUKTE,
  VERSICHERUNG_MAX,
  type Empfaenger,
  type Erkannt,
  type Gefahrgut,
  type Kanal,
  type ProduktKey,
  type Services,
} from "./logic";

// DHL-Label aus Chat/Screenshot (Teil B): Adresse erkennen (KI, ohne KI nach Regeln), bei DHL prüfen, Label über
// Parcel DE Shipping (bzw. Warensendung über die Internetmarke), Auftrag mit Kanal Kleinanzeigen/WhatsApp/B2B, Protokoll.
// Ohne DHL-Verbindung wird eine Vorlage gespeichert. Chat-Text und Bild werden nicht gespeichert.

const V = schema.versandLabels;

export type LabelEingabe = {
  kanal: Kanal;
  absender: "lugru" | "zweiter";
  empfaenger: Empfaenger;
  unsicher?: string[];
  produkt: ProduktKey;
  gewichtKg: number;
  masse?: { l: number; b: number; h: number } | null;
  wert?: number | null;
  services: Services;
  gefahrgut?: Gefahrgut | null;
  artikel?: string;
  sku?: string;
  menge: number;
  preis?: number | null;
  zahlungsart?: string;
  vorlageId?: string | null;
};

export type LabelErgebnis =
  | { ok: true; id: string; nr: string | null; fileId: string; orderId: string | null; tracking: string | null; text: string | null; kennzeichen: ("lq" | "lithium")[]; hinweise: string[]; kosten: number | null; sekunden: number; un: string | null }
  | { ok: false; fehler: string; vorlage?: boolean; id?: string };

/** Erste JSON-Struktur aus einer KI-Antwort. */
function jsonAus(text: string): unknown {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

/** Adresse aus eingefügtem Text und/oder Bild. Mit KI (Anbindungen → Claude), sonst nach Regeln (nur Text). */
export async function adresseErkennen(tenantId: string, e: { text: string; bild?: { bytes: Uint8Array; mime: string } | null }): Promise<(Erkannt & { hinweis?: string }) | { fehler: string }> {
  const text = e.text.trim().slice(0, 6000);
  const ai = await getIntegration(tenantId, "anthropic");
  if (ai?.apiKey) {
    try {
      const prompt = e.bild
        ? [{ type: "image" as const, source: { type: "base64" as const, media_type: e.bild.mime.replace("jpg", "jpeg"), data: Buffer.from(e.bild.bytes).toString("base64") } }, { type: "text" as const, text: KI_AUFTRAG(text) }]
        : KI_AUFTRAG(text);
      const r = await askClaude(ai.apiKey, prompt, { model: modelFor(ai, "simple"), task: "simple", maxTokens: 800, timeoutMs: 25_000 });
      const k = adresseAusKi(jsonAus(r.text));
      if (k) return k;
    } catch {
      // KI nicht erreichbar → Regeln (nur bei Text möglich)
    }
  }
  if (!text) return { fehler: e.bild ? "Das Bild konnte nicht gelesen werden – KI nicht eingerichtet oder nicht erreichbar (Anbindungen → Claude). Adresse bitte als Text einfügen." : "Bitte Text einfügen oder ein Bild wählen." };
  return { ...adresseAusText(text), hinweis: ai?.apiKey ? "KI nicht erreichbar – nach Regeln gelesen, bitte prüfen." : undefined };
}

const zuAdresse = (a: Empfaenger): Address => ({
  name1: a.name.slice(0, 50),
  name2: a.packstation ? a.postnummer : a.name2,
  street: a.packstation ?? a.strasse,
  houseNo: a.packstation ? a.packstation.replace(/\D/g, "") : a.hausnummer,
  zip: a.plz,
  city: a.ort,
  country: a.land || "DE",
  email: a.email,
  phone: a.telefon,
});

async function absenderAdresse(tenantId: string, wer: "lugru" | "zweiter"): Promise<Address | null> {
  const s = await getSettings(tenantId);
  const a = wer === "zweiter" ? s.versandLabel.absender2 : s.shipper;
  if (!a?.name1 || !a.street || !a.zip || !a.city) return null;
  return a;
}

/** DHL-Zugang + Abrechnungsnummer für das Produkt (null = keine DHL-Verbindung → Vorlage). */
async function dhlZugang(tenantId: string, produkt: ProduktKey) {
  const s = await getSettings(tenantId);
  const creds = await getIntegration(tenantId, "dhl");
  if (!creds?.apiKey || !creds.username || !creds.password) return null;
  const klein = produkt === "paeckchen";
  const billingNumber = klein ? s.dhl.billingNumberKleinpaket : s.dhl.billingNumberPaket;
  if (!billingNumber) return null;
  return { creds: { apiKey: creds.apiKey, username: creds.username, password: creds.password }, sandbox: s.dhl.sandbox, billingNumber, product: klein ? s.dhl.productKleinpaket : "V01PAK", printFormat: s.dhl.labelFormat };
}

/** Eingaben prüfen (ohne DHL): Pflichtfelder, Gewicht/Produkt, Versicherung, Gefahrgut. */
export function eingabeFehler(e: LabelEingabe): { fehler: string[]; hinweise: string[]; kennzeichen: ("lq" | "lithium")[] } {
  const fehler: string[] = [];
  const fehlt = pflichtFehlend(e.empfaenger);
  const NAMEN: Record<string, string> = { name: "Name", strasse: "Straße", hausnummer: "Hausnummer", plz: "PLZ", ort: "Ort", postnummer: "Postnummer (Packstation)" };
  if (fehlt.length) fehler.push(`Bitte ergänzen: ${fehlt.map((f) => NAMEN[f] ?? f).join(", ")}.`);
  const p = VERSAND_PRODUKTE.find((x) => x.key === e.produkt)!;
  if (!(e.gewichtKg > 0)) fehler.push("Gewicht fehlt.");
  else if (e.gewichtKg > p.bisKg) fehler.push(`${p.titel}: höchstens ${String(p.bisKg).replace(".", ",")} kg – ${e.gewichtKg > 31.5 ? "über 31,5 kg nur per Spedition" : "größeres Paket wählen"}.`);
  if (e.services.versicherung && e.services.versicherung > VERSICHERUNG_MAX) fehler.push(`Versicherung höchstens ${VERSICHERUNG_MAX.toLocaleString("de-DE")} €.`);
  if (e.produkt === "warensendung" && (e.gefahrgut?.lq || e.gefahrgut?.lithium || e.gefahrgut?.vollgefahrgut)) fehler.push("Gefahrgut nicht als Warensendung – DHL Paket wählen.");
  if (e.produkt === "paeckchen" && (e.services.versicherung || e.services.alterssicht)) fehler.push("Päckchen: keine Versicherung/Alterssichtprüfung – DHL Paket wählen.");
  const g = gefahrgutPruefen(e.gefahrgut ?? {}, e.gewichtKg);
  fehler.push(...g.fehler);
  return { fehler, hinweise: g.hinweise, kennzeichen: g.kennzeichen };
}

/** Adresse bei DHL prüfen lassen (validate=true, es entsteht kein Label). Ohne DHL: nur die eigenen Prüfungen. */
export async function adressePruefen(tenantId: string, e: LabelEingabe): Promise<{ ok: boolean; meldungen: string[]; dhl: boolean }> {
  const lokal = pflichtFehlend(e.empfaenger);
  if (lokal.length) return { ok: false, meldungen: [`Es fehlt: ${lokal.join(", ")}.`], dhl: false };
  if (e.produkt === "warensendung") return { ok: true, meldungen: ["Warensendung: keine DHL-Adressprüfung – Anschrift bitte selbst kontrollieren."], dhl: false };
  const z = await dhlZugang(tenantId, e.produkt);
  const abs = await absenderAdresse(tenantId, e.absender);
  if (!z || !abs) return { ok: true, meldungen: ["Keine DHL-Verbindung – Adresse nur auf Vollständigkeit geprüft."], dhl: false };
  const { pruefeDhlSendung } = await import("@/lib/integrations/clients/dhl");
  const r = await pruefeDhlSendung({ ...z, shipper: abs, to: zuAdresse(e.empfaenger), weightKg: e.gewichtKg || 1 }).catch((x) => ({ ok: false, meldungen: [x instanceof Error ? x.message : String(x)] }));
  return { ...r, meldungen: r.meldungen.length ? r.meldungen : [r.ok ? "DHL: Adresse in Ordnung." : "DHL hat die Adresse abgelehnt."], dhl: true };
}

const zahl = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? null : String(Math.round(n * 1000) / 1000));

async function speichern(tenantId: string, userId: string | null, e: LabelEingabe, extra: Partial<typeof V.$inferInsert>): Promise<string> {
  const werte = {
    tenantId,
    createdBy: userId,
    kanal: e.kanal,
    absender: e.absender,
    produkt: e.produkt,
    empfaenger: e.empfaenger,
    unsicher: e.unsicher ?? [],
    gewichtKg: zahl(e.gewichtKg),
    masse: e.masse ?? null,
    wert: zahl(e.wert),
    services: e.services,
    gefahrgut: e.gefahrgut ?? null,
    artikel: e.artikel?.slice(0, 300) || null,
    sku: e.sku?.slice(0, 80) || null,
    menge: Math.max(1, Math.round(e.menge || 1)),
    preis: zahl(e.preis),
    zahlungsart: e.zahlungsart?.slice(0, 60) || null,
    ...extra,
  };
  if (e.vorlageId) {
    const [u] = await db.update(V).set(werte).where(and(eq(V.tenantId, tenantId), eq(V.id, e.vorlageId), inArray(V.status, ["vorlage", "entwurf", "fehler"]))).returning({ id: V.id });
    if (u) return u.id;
  }
  const [n] = await db.insert(V).values(werte).returning({ id: V.id });
  return n.id;
}

/**
 * Label erstellen: prüfen → DHL (bzw. Internetmarke) → PDF speichern → Auftrag (außer Retoure) → Protokoll.
 * DHL lehnt ab → Fehlertext im Klartext (die Seite behält das Formular). Ohne Verbindung → Vorlage.
 */
export async function labelErstellen(tenantId: string, userId: string | null, e: LabelEingabe): Promise<LabelErgebnis> {
  const t0 = Date.now();
  const pruef = eingabeFehler(e);
  if (pruef.fehler.length) return { ok: false, fehler: pruef.fehler.join(" ") };
  const settings = await getSettings(tenantId);
  const abs = await absenderAdresse(tenantId, e.absender);
  if (!abs) return { ok: false, fehler: e.absender === "zweiter" ? "Zweiter Absender ist noch nicht hinterlegt (unten „Einstellungen“)." : "Absenderadresse fehlt (Einstellungen → Versand)." };
  const an = zuAdresse(e.empfaenger);
  const p = VERSAND_PRODUKTE.find((x) => x.key === e.produkt)!;
  let nr: string | null = null;
  let pdf: Buffer;
  let carrier = "DHL";
  if (e.produkt === "warensendung") {
    const { imBuyLabels, imCreds } = await import("@/lib/integrations/clients/deutschepost");
    const creds = imCreds(await getIntegration(tenantId, "deutschepost"));
    if (!creds) {
      const id = await speichern(tenantId, userId, e, { status: "vorlage", hinweise: ["Deutsche Post (Internetmarke) nicht verbunden – als Vorlage gespeichert."] });
      return { ok: false, vorlage: true, id, fehler: "Keine Verbindung zur Internetmarke (Anbindungen → Deutsche Post) – als Vorlage gespeichert." };
    }
    try {
      const r = await imBuyLabels(creds, { sender: abs, labels: [{ ref: e.artikel?.slice(0, 20) || "Warensendung", to: an }], productCode: settings.post.productCode, priceCents: Math.round(settings.post.price * 100), pageFormat: { id: settings.post.pageFormatId, labelX: settings.post.labelX, labelY: settings.post.labelY } });
      pdf = r.pdf;
      nr = r.vouchers[0]?.voucherId || null;
      carrier = "Deutsche Post";
    } catch (x) {
      const msg = x instanceof Error ? x.message : String(x);
      const id = await speichern(tenantId, userId, e, { status: "fehler", fehler: msg.slice(0, 500) });
      return { ok: false, id, fehler: msg };
    }
  } else {
    const z = await dhlZugang(tenantId, e.produkt);
    if (!z) {
      const id = await speichern(tenantId, userId, e, { status: "vorlage", hinweise: ["DHL nicht verbunden – als Vorlage gespeichert."] });
      return { ok: false, vorlage: true, id, fehler: "Keine DHL-Verbindung (Anbindungen → DHL bzw. Abrechnungsnummer in Einstellungen → Versand) – Label-Daten als Vorlage gespeichert. Später hier öffnen und erstellen." };
    }
    const { createDhlLabel } = await import("@/lib/integrations/clients/dhl");
    const retoure = e.produkt === "retoure";
    try {
      const r = await createDhlLabel({
        ...z,
        shipper: retoure ? an : abs,
        to: retoure ? abs : an,
        weightKg: e.gewichtKg,
        refNo: `${e.kanal === "b2b" ? "B2B" : e.kanal === "whatsapp" ? "WA" : "KA"} ${(e.artikel ?? "").slice(0, 26)}`.trim(),
        services: { visualCheckOfAge: e.services.alterssicht ?? undefined, additionalInsurance: e.services.versicherung && e.services.versicherung > 500 ? e.services.versicherung : undefined },
        dimCm: e.masse ?? null,
      });
      pdf = r.labelPdf;
      nr = r.shipmentNo;
      pruef.hinweise.push(...r.warnings);
    } catch (x) {
      const msg = (x instanceof Error ? x.message : String(x)).slice(0, 600);
      const id = await speichern(tenantId, userId, e, { status: "fehler", fehler: msg });
      return { ok: false, id, fehler: msg };
    }
  }
  const fileId = await storeFile(tenantId, `${carrier === "DHL" ? "DHL" : "Warensendung"}_${nr ?? Date.now()}.pdf`, "application/pdf", pdf);
  // Auftrag (Verkauf über Chat/B2B) – damit Umsatz, Bestand (beim Versenden) und Prep-Kosten stimmen. Retoure: kein Verkauf.
  let orderId: string | null = null;
  if (e.produkt !== "retoure") {
    const [o] = await db
      .insert(schema.orders)
      .values({
        tenantId,
        channel: e.kanal,
        externalId: `L-${nr ?? Date.now().toString(36).toUpperCase()}`,
        orderDate: new Date(),
        fulfillment: "FBM",
        status: "label_created",
        buyerName: e.empfaenger.name,
        shipTo: an,
        total: e.preis !== null && e.preis !== undefined ? Math.round(e.preis * Math.max(1, e.menge) * 100) / 100 : null,
        carrier,
        trackingNumber: carrier === "DHL" ? nr : null,
        shippedBy: "self",
        notes: [e.zahlungsart ? `Zahlungsart: ${e.zahlungsart}` : null, e.artikel ? `Artikel: ${e.artikel}` : null, "Label aus „Versand → Label erstellen“"].filter(Boolean).join(" · "),
      })
      .returning({ id: schema.orders.id });
    orderId = o.id;
    await db.insert(schema.orderItems).values({ tenantId, orderId, sku: e.sku || null, title: e.artikel?.slice(0, 300) || null, quantity: Math.max(1, Math.round(e.menge || 1)), price: e.preis ?? null });
    await db.insert(schema.parcels).values({ tenantId, orderId, carrier, product: carrier === "DHL" ? (e.produkt === "paeckchen" ? settings.dhl.productKleinpaket : "V01PAK") : `Warensendung ${settings.post.productCode}`, weightKg: String(e.gewichtKg), trackingNumber: nr, labelFileId: fileId, status: "created" });
  }
  const k = kosten(e.produkt, e.services, settings.versandLabel.preise);
  const id = await speichern(tenantId, userId, e, { status: "erstellt", sendungsnummer: nr, labelFileId: fileId, orderId, kosten: zahl(k), hinweise: pruef.hinweise, fehler: null });
  const tracking = carrier === "DHL" && nr ? trackingLink(nr) : null;
  return {
    ok: true,
    id,
    nr,
    fileId,
    orderId,
    tracking,
    text: tracking && nr ? versandText({ name: e.empfaenger.name, nr, kanal: e.kanal }) : null,
    kennzeichen: pruef.kennzeichen,
    hinweise: [p.key === "retoure" ? "Retourenlabel: Absender ist der Kunde, Empfänger du." : null, ...pruef.hinweise].filter((x): x is string => Boolean(x)),
    kosten: k,
    sekunden: Math.round((Date.now() - t0) / 100) / 10,
    un: e.gefahrgut?.lithium ?? null,
  };
}

/** Protokoll: Inhaber sieht alle (mit Kosten), sonst nur die eigenen. */
export async function labelProtokoll(tenantId: string, o: { userId: string; alle: boolean; limit?: number }) {
  const rows = await db
    .select({ id: V.id, createdAt: V.createdAt, status: V.status, kanal: V.kanal, produkt: V.produkt, empfaenger: V.empfaenger, sendungsnummer: V.sendungsnummer, labelFileId: V.labelFileId, orderId: V.orderId, kosten: V.kosten, fehler: V.fehler, gefahrgut: V.gefahrgut, wer: schema.users.name, werMail: schema.users.email })
    .from(V)
    .leftJoin(schema.users, eq(schema.users.id, V.createdBy))
    .where(and(eq(V.tenantId, tenantId), o.alle ? undefined : eq(V.createdBy, o.userId)))
    .orderBy(desc(V.createdAt))
    .limit(o.limit ?? 50);
  return rows.map((r) => ({ ...r, an: r.empfaenger ? `${r.empfaenger.name}, ${r.empfaenger.plz} ${r.empfaenger.ort}` : "–", kosten: o.alle && r.kosten !== null ? Number(r.kosten) : null }));
}

/** Vorlage/Entwurf/Fehler wieder öffnen (eigene; Inhaber alle). */
export async function labelLaden(tenantId: string, id: string, o: { userId: string; alle: boolean }) {
  const [r] = await db.select().from(V).where(and(eq(V.tenantId, tenantId), eq(V.id, id), o.alle ? undefined : eq(V.createdBy, o.userId)));
  return r ?? null;
}

/** Entwurf aus dem iPhone-Teilen-Menü (Kurzbefehl): erkannte Adresse speichern, Seite öffnet sie vorausgefüllt. */
export async function entwurfAnlegen(tenantId: string, userId: string, k: Erkannt): Promise<string> {
  const [n] = await db.insert(V).values({ tenantId, createdBy: userId, status: "entwurf", kanal: "kleinanzeigen", produkt: "paket_2", empfaenger: k.adresse, unsicher: k.unsicher }).returning({ id: V.id });
  return n.id;
}

/**
 * Stammadressen: B2B-Kunden (nur mit B2B-Zugriff – nie für die VA), Palettenkunden (Name) und Empfänger der letzten
 * Labels dieser Person bzw. (Inhaber) aller.
 */
export async function stammadressen(tenantId: string, o: { userId: string; mitB2b: boolean; alle: boolean }) {
  const out: { quelle: "b2b" | "paletten" | "zuletzt"; titel: string; adresse: Empfaenger }[] = [];
  if (o.mitB2b) {
    const k = await db.select({ firma: schema.b2bKunden.firma, ansprechpartner: schema.b2bKunden.ansprechpartner, strasse: schema.b2bKunden.strasse, plz: schema.b2bKunden.plz, ort: schema.b2bKunden.ort, land: schema.b2bKunden.land, email: schema.b2bKunden.email }).from(schema.b2bKunden).where(eq(schema.b2bKunden.tenantId, tenantId)).limit(200);
    for (const x of k) {
      const sh = /^(.+?\D)\s*(\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?)\s*$/.exec(x.strasse ?? "");
      out.push({ quelle: "b2b", titel: x.firma, adresse: { name: x.firma, name2: x.ansprechpartner ?? undefined, strasse: sh?.[1]?.trim() ?? x.strasse ?? "", hausnummer: sh?.[2]?.replace(/\s+/g, "") ?? "", plz: x.plz ?? "", ort: x.ort ?? "", land: x.land || "DE", email: x.email ?? undefined } });
    }
    const p = await db.select({ name: schema.palletCustomers.name }).from(schema.palletCustomers).where(eq(schema.palletCustomers.tenantId, tenantId)).limit(100);
    for (const x of p) if (!out.some((y) => y.titel.toLowerCase() === x.name.toLowerCase())) out.push({ quelle: "paletten", titel: x.name, adresse: { name: x.name, strasse: "", hausnummer: "", plz: "", ort: "", land: "DE" } });
  }
  const zuletzt = await db
    .select({ empfaenger: V.empfaenger })
    .from(V)
    .where(and(eq(V.tenantId, tenantId), eq(V.status, "erstellt"), o.alle ? undefined : eq(V.createdBy, o.userId), sql`${V.kanal} <> 'b2b' or ${o.mitB2b}`))
    .orderBy(desc(V.createdAt))
    .limit(60);
  const gesehen = new Set<string>();
  for (const z of zuletzt) {
    const a = z.empfaenger;
    if (!a?.name) continue;
    const key = `${a.name}|${a.plz}`.toLowerCase();
    if (gesehen.has(key) || out.some((y) => y.titel.toLowerCase() === a.name.toLowerCase())) continue;
    gesehen.add(key);
    out.push({ quelle: "zuletzt", titel: `${a.name} (${a.plz} ${a.ort})`, adresse: a });
    if (gesehen.size >= 20) break;
  }
  return out;
}
