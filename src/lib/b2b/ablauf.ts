import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ReservierungStatus } from "@/db/schema";
import { sendMail } from "@/lib/mail/accounts";
import { getSettings } from "@/lib/settings";
import { todayIso } from "@/lib/dates";
import { belegPdf, gutschriftErstellen, kontaktAnlegen, rechnungErstellen, zahlungsstand, type LexPosition } from "@/lib/integrations/clients/lexoffice";
import { ekFuerMenge, staffelText } from "./eingabe";
import { bestellungFaellig, steuerFuer, teileZu } from "./logic";
import { ladeDeal, schliessen, setzeStatus, type Deal } from "./service";

// Ablauf nach dem Reservieren: Vorkasse-Rechnungen (Lexoffice), Zahlungsabgleich, Sammelbestellung beim
// Großhändler (Entwurf → Freigabe → Senden mit Haken), MOQ verfehlt (verfallen oder Restmenge übernehmen),
// Wareneingang mit Fehlmenge (Kürzung + Gutschrift + Reklamations-Entwurf), Übergabe an das Prep Center.
// Mails gehen nur nach ausdrücklichem Haken „Geprüft – jetzt senden“ raus.

const R = schema.dealReservierungen;
const K = schema.b2bKunden;
const B = schema.dealBestellungen;
const LP = schema.lieferantenProfile;

const eur = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${n.toFixed(2).replace(".", ",")} €`);

async function reservierungenMitKunde(tenantId: string, dealId: string) {
  return db
    .select({ r: R, k: K })
    .from(R)
    .innerJoin(K, and(eq(K.id, R.kundeId), eq(K.tenantId, R.tenantId)))
    .where(and(eq(R.tenantId, tenantId), eq(R.dealId, dealId)))
    .orderBy(asc(R.bedingungenAm));
}
type ResMitKunde = Awaited<ReturnType<typeof reservierungenMitKunde>>[number];

const position = (d: Deal, menge: number, netto: number, satz: number): LexPosition => ({ name: d.titel, beschreibung: `Deal #${d.nr} · ASIN ${d.asin}${d.ean ? ` · EAN ${d.ean}` : ""}`, menge, einheit: "Stück", netto, steuersatz: Math.round(satz * 100) });

async function kontaktFuer(tenantId: string, k: typeof K.$inferSelect, reverseCharge: boolean): Promise<string> {
  if (k.lexofficeKontaktId) return k.lexofficeKontaktId;
  const id = await kontaktAnlegen(tenantId, { firma: k.firma, ansprechpartner: k.ansprechpartner, email: k.email, strasse: k.strasse, plz: k.plz, ort: k.ort, land: k.land, ustId: k.ustId, reverseCharge });
  await db.update(K).set({ lexofficeKontaktId: id, updatedAt: new Date() }).where(and(eq(K.tenantId, tenantId), eq(K.id, k.id)));
  return id;
}

// ---- Rechnungen und Zahlungen ---------------------------------------------------------------------

/** Vorkasse-Rechnungen für alle noch nicht abgerechneten Reservierungen; per Mail nur mit Haken. */
export async function rechnungenErstellen(tenantId: string, dealId: string, o: { mailen: boolean }): Promise<{ erstellt: number; mails: number; fehler: string[] }> {
  const d = await ladeDeal(tenantId, dealId);
  if (!d || !["aktiv", "geschlossen"].includes(d.status)) return { erstellt: 0, mails: 0, fehler: ["Rechnungen nur für offene oder geschlossene Deals."] };
  const s = await getSettings(tenantId);
  const absender = s.b2b.firma.handelsname || s.b2b.firma.name || undefined;
  let erstellt = 0;
  let mails = 0;
  const fehler: string[] = [];
  for (const { r, k } of await reservierungenMitKunde(tenantId, dealId)) {
    if (r.status !== "reserviert" || r.rechnungId) continue;
    try {
      const st = steuerFuer({ kundeLand: k.land, ustId: k.ustId, ustGueltig: k.ustGueltig, firmaLand: s.b2b.firma.land || "DE", satz: s.b2b.ustSatz });
      const rc = st.art === "reverse_charge";
      const kontaktId = await kontaktFuer(tenantId, k, rc);
      const beleg = await rechnungErstellen(tenantId, {
        kontaktId,
        positionen: [position(d, r.menge, r.preisNetto, s.b2b.ustSatz)],
        reverseCharge: rc,
        titel: "Rechnung (Vorkasse)",
        einleitung: `Ihre Reservierung aus Deal #${d.nr}. Bitte überweisen Sie den Betrag innerhalb von 7 Tagen – bestellt wird nach Zahlungseingang.`,
        bemerkung: "Lieferung an das Prep Center. Bei Fehlmenge des Großhändlers erhalten Sie eine Gutschrift.",
        lieferdatum: todayIso(),
      });
      await db.update(R).set({ rechnungId: beleg.id, rechnungNr: beleg.nummer, rechnungBrutto: beleg.brutto, reverseCharge: rc, status: "vorkasse_offen", updatedAt: new Date() }).where(eq(R.id, r.id));
      erstellt++;
      if (o.mailen && k.email) {
        const pdf = await belegPdf(tenantId, "rechnung", beleg.id);
        await sendMail(tenantId, { to: k.email, subject: `Rechnung ${beleg.nummer ?? ""} – Deal #${d.nr}`.trim(), text: `Hallo${k.ansprechpartner ? ` ${k.ansprechpartner}` : ""},\n\nanbei die Vorkasse-Rechnung zu Ihrer Reservierung (${r.menge} × ${d.titel}) über ${eur(beleg.brutto)}.\nBitte innerhalb von 7 Tagen überweisen – bestellt wird nach Zahlungseingang.${absender ? `\n\n${absender}` : ""}`, attachments: [{ filename: `Rechnung-${beleg.nummer ?? beleg.id}.pdf`, content: pdf, contentType: "application/pdf" }] }, { fromName: absender });
        mails++;
      }
    } catch (e) {
      fehler.push(`${k.firma}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { erstellt, mails, fehler };
}

/** Zahlungsstand aus Lexoffice holen (ein Deal oder alle offenen Vorkassen). */
export async function zahlungenAbgleichen(tenantId: string, dealId?: string): Promise<{ geprueft: number; bezahlt: number }> {
  const offen = await db.select({ id: R.id, rechnungId: R.rechnungId }).from(R).where(and(eq(R.tenantId, tenantId), eq(R.status, "vorkasse_offen"), ...(dealId ? [eq(R.dealId, dealId)] : [])));
  let bezahlt = 0;
  for (const x of offen) {
    if (!x.rechnungId) continue;
    const z = await zahlungsstand(tenantId, x.rechnungId);
    if (z.bezahlt) {
      await db.update(R).set({ status: "bezahlt", bezahltAm: new Date(), updatedAt: new Date() }).where(eq(R.id, x.id));
      bezahlt++;
    }
  }
  return { geprueft: offen.length, bezahlt };
}

// ---- Sammelbestellung -----------------------------------------------------------------------------

/** Was bestellt werden kann: bezahlt (oder Kunde „auf Rechnung“); ohne „nur bezahlte“ alle aktiven. */
export function istBestellbar(x: ResMitKunde, nurBezahlte: boolean): boolean {
  const s = x.r.status;
  if (!nurBezahlte) return ["reserviert", "vorkasse_offen", "bezahlt"].includes(s);
  return s === "bezahlt" || (s === "vorkasse_offen" && x.k.zahlungsart === "rechnung");
}

export async function bestellStand(tenantId: string, d: Deal) {
  const s = await getSettings(tenantId);
  const alle = await reservierungenMitKunde(tenantId, d.id);
  const aktiv = alle.filter((x) => ["reserviert", "vorkasse_offen", "bezahlt"].includes(x.r.status));
  const bestellbar = aktiv.filter((x) => istBestellbar(x, s.b2b.nurBezahlteBestellen));
  const summe = (l: ResMitKunde[]) => l.reduce((n, x) => n + x.r.menge, 0);
  const [bestellung] = await db.select().from(B).where(and(eq(B.tenantId, tenantId), eq(B.dealId, d.id)));
  const reserviert = summe(aktiv);
  const bestellMenge = summe(bestellbar);
  const f = bestellungFaellig({ moq: d.moqLieferant, reserviert, bezahlt: bestellMenge, nurBezahlte: true, frist: d.frist, heute: todayIso() });
  return { alle, aktiv, bestellbar, nichtBestellbar: aktiv.filter((x) => !bestellbar.includes(x)), reserviert, bestellMenge, faellig: f, bestellung: bestellung ?? null, nurBezahlte: s.b2b.nurBezahlteBestellen };
}

function bestellMail(d: Deal, menge: number, ek: number, firma: string, lieferadresse: string, lieferant: string | null) {
  return {
    betreff: `Bestellung ${d.ean ?? d.asin} – ${menge} Stück (Deal ${d.nr})`,
    text: [
      `Guten Tag${lieferant ? ` (${lieferant})` : ""},`,
      "",
      "wir bestellen verbindlich:",
      "",
      `${menge} × ${d.titel}`,
      `${d.ean ? `EAN ${d.ean} · ` : ""}ASIN ${d.asin}`,
      `Preis laut Angebot: ${eur(ek)} netto je Stück${d.staffel.length ? ` (Staffel ${staffelText(d.staffel)})` : ""}`,
      "",
      "Lieferanschrift:",
      lieferadresse || "(bitte Lieferanschrift in Einstellungen → B2B-Deals eintragen)",
      "",
      "Bitte bestätigen Sie Liefertermin und Menge. Rechnung bitte per Mail.",
      "",
      "Mit freundlichen Grüßen",
      firma,
    ].join("\n"),
  };
}

/** Bestell-Mail als Entwurf anlegen (MOQ erreicht oder Restmenge übernommen). Schließt einen noch offenen Deal. */
export async function bestellungEntwerfen(tenantId: string, dealId: string, o: { eigeneMenge?: number } = {}): Promise<{ ok: true; menge: number } | { ok: false; fehler: string }> {
  const d = await ladeDeal(tenantId, dealId);
  if (!d || !["aktiv", "geschlossen"].includes(d.status)) return { ok: false, fehler: "Nur offene oder geschlossene Deals können bestellt werden." };
  const st = await bestellStand(tenantId, d);
  if (st.bestellung && st.bestellung.status !== "entwurf") return { ok: false, fehler: "Die Bestellung ist schon freigegeben bzw. gesendet." };
  const eigene = Math.max(0, Math.round(o.eigeneMenge ?? st.bestellung?.eigeneMenge ?? 0));
  const menge = st.bestellMenge + eigene;
  if (menge < d.moqLieferant) return { ok: false, fehler: `Mindestmenge des Lieferanten (${d.moqLieferant}) nicht erreicht – bestellbar ${st.bestellMenge}${st.nurBezahlte ? " (nur bezahlte)" : ""}. Restmenge übernehmen oder Deal verfallen lassen.` };
  if (d.status === "aktiv") await schliessen(tenantId, dealId);
  const s = await getSettings(tenantId);
  const [p] = d.supplierId ? await db.select({ email: LP.email }).from(LP).where(and(eq(LP.tenantId, tenantId), eq(LP.supplierId, d.supplierId))) : [];
  const [sup] = d.supplierId ? await db.select({ name: schema.suppliers.name, code: schema.suppliers.code }).from(schema.suppliers).where(and(eq(schema.suppliers.tenantId, tenantId), eq(schema.suppliers.id, d.supplierId))) : [];
  const m = bestellMail(d, menge, ekFuerMenge(d.ekNetto, d.staffel, menge), s.b2b.firma.name || s.b2b.firma.handelsname || "", s.b2b.lieferadresse, sup?.name ?? sup?.code ?? null);
  const werte = { menge, eigeneMenge: eigene, status: "entwurf" as const, mailAn: p?.email ?? null, mailBetreff: m.betreff, mailText: m.text, updatedAt: new Date() };
  await db.insert(B).values({ tenantId, dealId, ...werte }).onConflictDoUpdate({ target: B.dealId, set: werte });
  return { ok: true, menge };
}

/** Freigabe durch den Inhaber (Ludwig/Chris) – Text kann vorher angepasst werden. */
export async function bestellungFreigeben(tenantId: string, dealId: string, userId: string, o: { an: string | null; betreff: string; text: string }): Promise<{ ok: boolean; fehler?: string }> {
  const [b] = await db.select().from(B).where(and(eq(B.tenantId, tenantId), eq(B.dealId, dealId)));
  if (!b || b.status !== "entwurf") return { ok: false, fehler: "Kein Bestell-Entwurf." };
  if (!o.an || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.an)) return { ok: false, fehler: "Bitte die Bestell-E-Mail des Lieferanten angeben." };
  await db.update(B).set({ status: "freigegeben", mailAn: o.an, mailBetreff: o.betreff.slice(0, 300), mailText: o.text.slice(0, 10_000), freigegebenVon: userId, freigegebenAm: new Date(), updatedAt: new Date() }).where(eq(B.dealId, dealId));
  return { ok: true };
}

/**
 * Bestellung senden (nur mit Haken „Geprüft – jetzt senden“). Bestellbare Reservierungen → „bestellt“; nicht
 * bezahlte werden storniert (mit Gutschrift, falls schon eine Rechnung existiert).
 */
export async function bestellungSenden(tenantId: string, dealId: string, o: { geprueft: boolean }): Promise<{ ok: true; storniert: number } | { ok: false; fehler: string }> {
  if (!o.geprueft) return { ok: false, fehler: "Bitte „Geprüft – jetzt senden“ anhaken." };
  const d = await ladeDeal(tenantId, dealId);
  const [b] = await db.select().from(B).where(and(eq(B.tenantId, tenantId), eq(B.dealId, dealId)));
  if (!d || !b || b.status !== "freigegeben" || !b.mailAn) return { ok: false, fehler: "Bestellung ist nicht freigegeben." };
  const st = await bestellStand(tenantId, d);
  if (st.bestellMenge + b.eigeneMenge !== b.menge) return { ok: false, fehler: `Die bestellbare Menge hat sich geändert (${st.bestellMenge + b.eigeneMenge} statt ${b.menge}) – Entwurf bitte neu erstellen.` };
  const s = await getSettings(tenantId);
  await sendMail(tenantId, { to: b.mailAn, subject: b.mailBetreff ?? `Bestellung Deal ${d.nr}`, text: b.mailText ?? "" }, { fromName: s.b2b.firma.name || undefined });
  await db.update(B).set({ status: "bestellt", bestelltAm: new Date(), updatedAt: new Date() }).where(eq(B.dealId, dealId));
  for (const x of st.bestellbar) await db.update(R).set({ status: "bestellt", updatedAt: new Date() }).where(eq(R.id, x.r.id));
  let storniert = 0;
  for (const x of st.nichtBestellbar) {
    await stornoMitGutschrift(tenantId, d, x, "Nicht rechtzeitig bezahlt – nicht mitbestellt.");
    storniert++;
  }
  await setzeStatus(tenantId, dealId, "bestellt");
  return { ok: true, storniert };
}

async function stornoMitGutschrift(tenantId: string, d: Deal, x: ResMitKunde, grund: string, bezahltErstatten = false) {
  const s = await getSettings(tenantId);
  let gutschrift: { id: string; brutto: number | null } | null = null;
  if (x.r.rechnungId && !x.r.gutschriftId) {
    const kontaktId = await kontaktFuer(tenantId, x.k, x.r.reverseCharge);
    const g = await gutschriftErstellen(tenantId, { rechnungId: x.r.rechnungId, kontaktId, positionen: [position(d, x.r.menge, x.r.preisNetto, s.b2b.ustSatz)], reverseCharge: x.r.reverseCharge, titel: "Gutschrift", bemerkung: grund });
    gutschrift = { id: g.id, brutto: g.brutto };
  }
  const status: ReservierungStatus = bezahltErstatten || x.r.status === "bezahlt" ? "erstattet" : "storniert";
  await db.update(R).set({ status, ...(gutschrift ? { gutschriftId: gutschrift.id, gutschriftBetrag: gutschrift.brutto } : {}), notiz: grund, updatedAt: new Date() }).where(eq(R.id, x.r.id));
}

/** MOQ verfehlt: Deal verfällt; Rechnungen werden per Gutschrift aufgehoben, Bezahltes ist zu erstatten. */
export async function verfallenLassen(tenantId: string, dealId: string): Promise<{ storniert: number; zuErstatten: number }> {
  const d = await ladeDeal(tenantId, dealId);
  if (!d || !["aktiv", "geschlossen"].includes(d.status)) return { storniert: 0, zuErstatten: 0 };
  const st = await bestellStand(tenantId, d);
  let zuErstatten = 0;
  for (const x of st.aktiv) {
    if (x.r.status === "bezahlt") zuErstatten++;
    await stornoMitGutschrift(tenantId, d, x, "Mindestmenge des Großhändlers nicht erreicht – Deal verfallen.");
  }
  await setzeStatus(tenantId, dealId, "verfallen");
  return { storniert: st.aktiv.length, zuErstatten };
}

// ---- Wareneingang und Fehlmenge -------------------------------------------------------------------

/**
 * Wareneingang buchen. Bei Fehlmenge: eigene Menge zuerst kürzen, dann je Einstellung anteilig oder nach
 * Reservierungszeitpunkt; Gutschrift je gekürzter Reservierung; Reklamations-Entwurf an den Großhändler.
 */
export async function wareneingangBuchen(tenantId: string, dealId: string, eingang: number): Promise<{ ok: true; fehlt: number; gutschriften: number; je: Record<string, number> } | { ok: false; fehler: string }> {
  const d = await ladeDeal(tenantId, dealId);
  const [b] = await db.select().from(B).where(and(eq(B.tenantId, tenantId), eq(B.dealId, dealId)));
  if (!d || d.status !== "bestellt" || !b || b.status !== "bestellt") return { ok: false, fehler: "Wareneingang nur für bestellte Deals." };
  if (!Number.isInteger(eingang) || eingang < 0) return { ok: false, fehler: "Bitte die gelieferte Stückzahl eingeben." };
  const s = await getSettings(tenantId);
  const res = (await reservierungenMitKunde(tenantId, dealId)).filter((x) => x.r.status === "bestellt");
  const z = teileZu(res.map((x) => ({ id: x.r.id, menge: x.r.menge, zeit: x.r.bedingungenAm })), eingang, s.b2b.fehlmengenRegel, b.eigeneMenge);
  let gutschriften = 0;
  for (const x of res) {
    const zugeteilt = z.je[x.r.id] ?? 0;
    const fehlt = x.r.menge - zugeteilt;
    let g: { id: string; brutto: number | null } | null = null;
    if (fehlt > 0 && x.r.rechnungId) {
      const kontaktId = await kontaktFuer(tenantId, x.k, x.r.reverseCharge);
      const beleg = await gutschriftErstellen(tenantId, { rechnungId: x.r.rechnungId, kontaktId, positionen: [position(d, fehlt, x.r.preisNetto, s.b2b.ustSatz)], reverseCharge: x.r.reverseCharge, titel: "Gutschrift Fehlmenge", bemerkung: `Der Großhändler hat weniger geliefert: ${zugeteilt} statt ${x.r.menge} Stück.` });
      g = { id: beleg.id, brutto: beleg.brutto };
      gutschriften++;
    }
    await db
      .update(R)
      .set({ zugeteilt, status: zugeteilt === 0 ? "erstattet" : "angekommen", ...(g ? { gutschriftId: g.id, gutschriftBetrag: g.brutto } : {}), updatedAt: new Date() })
      .where(eq(R.id, x.r.id));
  }
  const reklamation = z.fehlt > 0 ? reklamationText(d, b.menge, eingang, s.b2b.firma.name || "") : null;
  await db.update(B).set({ status: "angekommen", eingangMenge: eingang, eingangAm: new Date(), eigeneMenge: z.eigen, reklamation, updatedAt: new Date() }).where(eq(B.dealId, dealId));
  await setzeStatus(tenantId, dealId, "angekommen", { angekommenAm: new Date() });
  return { ok: true, fehlt: z.fehlt, gutschriften, je: z.je };
}

function reklamationText(d: Deal, bestellt: number, geliefert: number, firma: string) {
  return [
    "Guten Tag,",
    "",
    `zu unserer Bestellung (Deal ${d.nr}) ${d.titel}${d.ean ? `, EAN ${d.ean}` : ""}:`,
    `bestellt ${bestellt} Stück, geliefert ${geliefert} Stück – es fehlen ${bestellt - geliefert} Stück.`,
    "",
    "Bitte liefern Sie die fehlende Menge nach oder schreiben Sie sie uns auf der Rechnung gut.",
    "",
    "Mit freundlichen Grüßen",
    firma,
  ].join("\n");
}

/** Reklamation an den Großhändler – nur mit Haken. */
export async function reklamationSenden(tenantId: string, dealId: string, o: { geprueft: boolean; text: string }): Promise<{ ok: boolean; fehler?: string }> {
  if (!o.geprueft) return { ok: false, fehler: "Bitte „Geprüft – jetzt senden“ anhaken." };
  const d = await ladeDeal(tenantId, dealId);
  const [b] = await db.select().from(B).where(and(eq(B.tenantId, tenantId), eq(B.dealId, dealId)));
  if (!d || !b?.mailAn || !b.reklamation) return { ok: false, fehler: "Keine Reklamation offen." };
  const s = await getSettings(tenantId);
  await sendMail(tenantId, { to: b.mailAn, subject: `Fehlmenge – Bestellung Deal ${d.nr}`, text: o.text.slice(0, 10_000) || b.reklamation }, { fromName: s.b2b.firma.name || undefined });
  await db.update(B).set({ reklamation: `GESENDET ${new Date().toISOString().slice(0, 10)}\n${o.text || b.reklamation}`, updatedAt: new Date() }).where(eq(B.dealId, dealId));
  return { ok: true };
}

// ---- Übergabe an das Prep Center ------------------------------------------------------------------

export type ExportZeile = { kunde: string; amazonName: string | null; land: string; deal: number; asin: string; ean: string | null; titel: string; menge: number; reservierung: string };

/** Daten für das Prep-Tool (je Kunde oder alle): gelieferte Menge je Kunde. */
export async function exportZeilen(tenantId: string, dealId: string, kundeId?: string | null): Promise<ExportZeile[]> {
  const d = await ladeDeal(tenantId, dealId);
  if (!d) return [];
  return (await reservierungenMitKunde(tenantId, dealId))
    .filter((x) => ["angekommen", "an_prep", "erledigt"].includes(x.r.status) && (!kundeId || x.k.id === kundeId))
    .map((x) => ({ kunde: x.k.firma, amazonName: x.k.amazonName, land: x.k.land, deal: d.nr, asin: d.asin, ean: d.ean, titel: d.titel, menge: x.r.zugeteilt ?? x.r.menge, reservierung: x.r.id }));
}

/** Als an das Prep Center übergeben markieren; sind alle übergeben, ist der Deal „verteilt“. */
export async function anPrepUebergeben(tenantId: string, dealId: string, kundeId?: string | null): Promise<number> {
  const zeilen = await exportZeilen(tenantId, dealId, kundeId);
  const ids = zeilen.map((z) => z.reservierung);
  if (ids.length) await db.update(R).set({ status: "an_prep", exportiertAm: new Date(), updatedAt: new Date() }).where(and(eq(R.tenantId, tenantId), inArray(R.id, ids), eq(R.status, "angekommen")));
  const offen = await db.select({ id: R.id }).from(R).where(and(eq(R.tenantId, tenantId), eq(R.dealId, dealId), eq(R.status, "angekommen")));
  if (offen.length === 0) await setzeStatus(tenantId, dealId, "verteilt");
  return ids.length;
}
