import "server-only";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSettings } from "@/lib/settings";
import { adresseAusAbsender, bestellmailFuerAntwort, bestellmailText, lieferantFuerQuelle, quelleFuerSuche, rechnungErkannt, sendungsnummerAus, type BestellFirma, type DealLieferant } from "./bestellmail-logic";
import { DealEingangFehler } from "./service";

// B28.5 Bestellmail an den Lieferanten: Entwurf beim „Gekauft“ (Seite oder deal_gekauft), Senden nur per Klick,
// Kopie ins eigene Postfach, Beleg am Deal und an der Bestellung im Einkauf, Antwort über den Posteingang zugeordnet.

const E = schema.dealEingaenge;
const BM = schema.dealBestellmails;
const LP = schema.lieferantenProfile;
const S = schema.suppliers;

/** Lieferanten mit Deal-Quelle (Einstellungen → Deal-Quellen). */
export async function dealLieferanten(tenantId: string): Promise<DealLieferant[]> {
  const rows = await db
    .select({ supplierId: LP.supplierId, name: sql<string>`coalesce(${S.name}, ${S.code})`, email: LP.email, ansprechpartner: LP.ansprechpartner, zahlungsweg: LP.zahlungsweg, rechnungMitEan: LP.rechnungMitEan, dealQuellen: LP.dealQuellen })
    .from(LP)
    .innerJoin(S, and(eq(S.id, LP.supplierId), eq(S.tenantId, tenantId)))
    .where(and(eq(LP.tenantId, tenantId), sql`jsonb_array_length(${LP.dealQuellen}) > 0`))
    .orderBy(sql`coalesce(${S.name}, ${S.code})`);
  return rows;
}

export async function lieferantFuerDeal(tenantId: string, quelle: string | null, weg?: string | null, rohtext?: string | null): Promise<DealLieferant | null> {
  return lieferantFuerQuelle(quelleFuerSuche(quelle, weg, rohtext), await dealLieferanten(tenantId));
}

/**
 * Lieferant von Hand am Deal gewählt (Auswahl am Gekauft-Knopf, wenn die Quelle fehlt oder nicht passt). Hat der Deal
 * noch keine Quelle, wird der Name des Lieferanten als Quelle eingetragen – dann passt es beim nächsten Mal von selbst.
 */
export async function lieferantWaehlen(tenantId: string, dealId: string, supplierId: string): Promise<DealLieferant> {
  const l = (await dealLieferanten(tenantId)).find((x) => x.supplierId === supplierId);
  if (!l) throw new DealEingangFehler("Lieferant nicht gefunden – unter Deal-Eingang → Deal-Quellen anlegen.");
  await db.update(E).set({ quelle: l.name }).where(and(eq(E.tenantId, tenantId), eq(E.id, dealId), sql`coalesce(trim(${E.quelle}), '') = ''`));
  return l;
}

/** Deal-Quelle speichern bzw. ändern (Lieferant wird bei Bedarf angelegt). */
export async function dealQuelleSpeichern(tenantId: string, d: { name: string; email: string | null; ansprechpartner: string | null; zahlungsweg: string | null; rechnungMitEan: boolean; dealQuellen: string[] }) {
  const name = d.name.trim();
  if (!name) throw new DealEingangFehler("Bitte den Namen des Lieferanten angeben.");
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) throw new DealEingangFehler("Die Mailadresse sieht nicht gültig aus.");
  const [vorhanden] = await db.select({ id: S.id }).from(S).where(and(eq(S.tenantId, tenantId), sql`lower(coalesce(${S.name}, ${S.code})) = lower(${name})`));
  const { ensureSupplier } = await import("@/lib/purchasing/service");
  const supplierId = vorhanden?.id ?? (await db.transaction((tx) => ensureSupplier(tx, tenantId, name)));
  const quellen = [...new Set([name, ...d.dealQuellen].map((x) => x.trim()).filter(Boolean))].slice(0, 20);
  const werte = { email: d.email || null, ansprechpartner: d.ansprechpartner || null, zahlungsweg: d.zahlungsweg || null, rechnungMitEan: d.rechnungMitEan, dealQuellen: quellen };
  await db.insert(LP).values({ tenantId, supplierId, ...werte }).onConflictDoUpdate({ target: [LP.tenantId, LP.supplierId], set: { ...werte, updatedAt: new Date() } });
  return supplierId;
}

/** Deal-Quelle entfernen (der Lieferant und sein Profil bleiben, nur die Zuordnung zu Deals entfällt). */
export async function dealQuelleEntfernen(tenantId: string, supplierId: string) {
  await db.update(LP).set({ dealQuellen: [], updatedAt: new Date() }).where(and(eq(LP.tenantId, tenantId), eq(LP.supplierId, supplierId)));
}

async function firmaFuer(tenantId: string): Promise<BestellFirma> {
  const s = await getSettings(tenantId);
  const adresse = s.dealEingang.bestellAdresse?.trim() || adresseAusAbsender(s.shipper);
  return { adresse: adresse || "LuGru GmbH", ustId: s.dealEingang.bestellUstId?.trim() || null, telefon: s.shipper?.phone ?? null, email: s.shipper?.email ?? null };
}

/**
 * Entwurf der Bestellmail für einen gekauften Deal anlegen (bzw. einen offenen Entwurf neu füllen). Ohne Lieferant mit
 * Mailadresse: Fehler mit Hinweis auf Einstellungen → Deal-Quellen. Gesendet wird hier nichts.
 */
export async function bestellmailEntwurf(tenantId: string, dealId: string, userId: string | null, o: { nr?: number | null; supplierId?: string | null } = {}): Promise<{ id: string; an: string }> {
  const [e] = await db.select().from(E).where(and(eq(E.tenantId, tenantId), eq(E.id, dealId)));
  if (!e) throw new DealEingangFehler("Eingang nicht gefunden.");
  if (e.status !== "gekauft" || !e.gekauftMenge) throw new DealEingangFehler("Erst als gekauft speichern (Menge, Preis) – dann die Bestellmail.");
  const l = o.supplierId ? await lieferantWaehlen(tenantId, dealId, o.supplierId) : await lieferantFuerDeal(tenantId, e.quelle, e.weg, e.rohtext);
  if (!l) throw new DealEingangFehler(e.quelle ? `Kein Lieferant für die Quelle „${e.quelle}“ – am Gekauft-Knopf den Lieferanten wählen oder unter Deal-Eingang → Deal-Quellen als Stichwort eintragen.` : "Der Deal hat keine Quelle – am Gekauft-Knopf den Lieferanten wählen.");
  if (!l.email) throw new DealEingangFehler(`Für ${l.name} ist keine Mailadresse hinterlegt – unter Deal-Eingang → Deal-Quellen eintragen.`);
  const z = (o.nr ? e.zeilen.find((x) => x.nr === o.nr) : null) ?? e.zeilen.filter((x) => x.asin).sort((a, b) => (a.ampel === "gruen" ? -1 : 0) - (b.ampel === "gruen" ? -1 : 0))[0] ?? e.zeilen[0];
  const preis = e.gekauftPreis ?? z?.ekNetto ?? z?.angebot.ek ?? 0;
  const { betreff, text } = bestellmailText({
    lieferant: l,
    firma: await firmaFuer(tenantId),
    artikel: { titel: z?.titel ?? z?.angebot.name ?? null, asin: z?.asin ?? null, ean: z?.angebot.ean ?? null, menge: e.gekauftMenge, preisNetto: preis, zustand: z?.angebot.zustand ?? null, verpackung: e.verpackung },
  });
  const [offen] = await db.select({ id: BM.id }).from(BM).where(and(eq(BM.tenantId, tenantId), eq(BM.dealId, dealId), eq(BM.status, "entwurf")));
  if (offen) {
    await db.update(BM).set({ an: l.email, betreff, text, supplierId: l.supplierId, bestellungId: e.bestellungId }).where(eq(BM.id, offen.id));
    return { id: offen.id, an: l.email };
  }
  const [r] = await db.insert(BM).values({ tenantId, dealId, supplierId: l.supplierId, bestellungId: e.bestellungId, an: l.email, betreff, text, createdBy: userId }).returning({ id: BM.id });
  return { id: r.id, an: l.email };
}

const mailOk = (s: string) => s.split(/[,;]/).map((x) => x.trim()).filter(Boolean).every((x) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x));

/** Entwurf ändern (Empfänger, Betreff, Text). */
export async function bestellmailSpeichern(tenantId: string, id: string, d: { an: string; betreff: string; text: string }) {
  if (!mailOk(d.an)) throw new DealEingangFehler("Bitte eine gültige Empfänger-Adresse angeben.");
  const r = await db.update(BM).set({ an: d.an.trim(), betreff: d.betreff.trim().slice(0, 300), text: d.text.slice(0, 20_000) }).where(and(eq(BM.tenantId, tenantId), eq(BM.id, id), inArray(BM.status, ["entwurf", "fehler"]))).returning({ id: BM.id });
  if (!r.length) throw new DealEingangFehler("Entwurf nicht gefunden oder schon gesendet.");
}

/**
 * Bestellmail senden – nur auf Klick („Senden“). Absender = Standard-Postfach (Geschäftsadresse), Kopie an dasselbe
 * Postfach (abschaltbar). Speichert Datum, Empfänger, Text und Zustellstatus; die Message-ID dient der Antwort-Zuordnung.
 */
export async function bestellmailSenden(tenantId: string, id: string, userId: string | null, d: { an: string; betreff: string; text: string }): Promise<{ ok: boolean; fehler?: string }> {
  await bestellmailSpeichern(tenantId, id, d);
  const [m] = await db.select().from(BM).where(and(eq(BM.tenantId, tenantId), eq(BM.id, id)));
  if (!m) throw new DealEingangFehler("Entwurf nicht gefunden.");
  const { senderMailboxes, sendMail } = await import("@/lib/mail/accounts");
  const s = await getSettings(tenantId);
  const { boxes, defaultId } = await senderMailboxes(tenantId);
  const absender = boxes.find((b) => b.id === defaultId)?.address ?? s.shipper?.email ?? null;
  const domain = absender?.split("@")[1] ?? "seller-system.invalid";
  const messageId = `<deal-bestellung-${m.id}@${domain}>`;
  const kopie = s.dealEingang.bestellKopie !== false && absender && !m.an.toLowerCase().includes(absender.toLowerCase()) ? absender : undefined;
  try {
    await sendMail(tenantId, { to: m.an, cc: kopie, subject: m.betreff, text: m.text, messageId });
    await db.update(BM).set({ status: "gesendet", fehler: null, messageId, kopieAn: kopie ?? null, gesendetAm: new Date(), gesendetVon: userId }).where(eq(BM.id, m.id));
    return { ok: true };
  } catch (e) {
    const fehler = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await db.update(BM).set({ status: "fehler", fehler }).where(eq(BM.id, m.id));
    return { ok: false, fehler };
  }
}

export async function bestellmailVerwerfen(tenantId: string, id: string) {
  await db.update(BM).set({ status: "verworfen" }).where(and(eq(BM.tenantId, tenantId), eq(BM.id, id), inArray(BM.status, ["entwurf", "fehler"])));
}

export type BestellmailZeile = typeof BM.$inferSelect;

export async function bestellmailsFuerDeal(tenantId: string, dealId: string): Promise<BestellmailZeile[]> {
  return db.select().from(BM).where(and(eq(BM.tenantId, tenantId), eq(BM.dealId, dealId), inArray(BM.status, ["entwurf", "gesendet", "fehler"]))).orderBy(desc(BM.createdAt));
}

/** Gesendete Bestellmails je Bestellung (Einkauf): Beleg „Bestellung gesendet“. */
export async function bestellmailsFuerBestellungen(tenantId: string, poIds: string[]): Promise<Map<string, BestellmailZeile>> {
  if (!poIds.length) return new Map();
  const rows = await db.select().from(BM).where(and(eq(BM.tenantId, tenantId), inArray(BM.bestellungId, poIds), eq(BM.status, "gesendet"))).orderBy(desc(BM.gesendetAm));
  const out = new Map<string, BestellmailZeile>();
  for (const r of rows) if (r.bestellungId && !out.has(r.bestellungId)) out.set(r.bestellungId, r);
  return out;
}

/**
 * Posteingang: Antwort des Lieferanten (In-Reply-To bzw. Absender + ASIN/Betreff) → am Deal vermerken, Sendungsnummer
 * und Rechnung erkennen; Sendungsnummer auch an der Bestellung im Einkauf eintragen (wenn dort noch keine steht).
 */
export async function antwortZuordnen(tenantId: string, m: { id: string; fromAddress: string; subject: string; text: string; receivedAt: Date; antwortAuf: string[]; anhangNamen: string[] }): Promise<string | null> {
  const gesendet = await db
    .select({ id: BM.id, an: BM.an, messageId: BM.messageId, betreff: BM.betreff, gesendetAm: BM.gesendetAm, dealId: BM.dealId, bestellungId: BM.bestellungId, sendungsnummer: BM.sendungsnummer, rechnungErhalten: BM.rechnungErhalten })
    .from(BM)
    .where(and(eq(BM.tenantId, tenantId), eq(BM.status, "gesendet"), gte(BM.gesendetAm, new Date(Date.now() - 60 * 86_400_000))))
    .limit(500);
  if (!gesendet.length) return null;
  const asins = new Map<string, string | null>();
  for (const g of gesendet) asins.set(g.id, /ASIN ([A-Z0-9]{10})/.exec(g.betreff)?.[1] ?? null);
  const treffer = bestellmailFuerAntwort(m, gesendet.map((g) => ({ id: g.id, an: g.an, messageId: g.messageId, betreff: g.betreff, asin: asins.get(g.id) ?? null, gesendetAm: g.gesendetAm ?? new Date(0) })));
  if (!treffer) return null;
  const g = gesendet.find((x) => x.id === treffer)!;
  const nr = sendungsnummerAus(`${m.subject}\n${m.text}`);
  const rechnung = rechnungErkannt(m.subject, m.anhangNamen);
  await db.update(BM).set({ antwortId: m.id, antwortAm: m.receivedAt, sendungsnummer: g.sendungsnummer ?? nr, rechnungErhalten: g.rechnungErhalten || rechnung }).where(eq(BM.id, g.id));
  if (nr && g.bestellungId) {
    const PO = schema.purchaseOrders;
    await db.update(PO).set({ trackingNumber: nr, updatedAt: new Date() }).where(and(eq(PO.tenantId, tenantId), eq(PO.id, g.bestellungId), sql`${PO.trackingNumber} is null`));
  }
  return g.dealId;
}
