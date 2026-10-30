import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { kontoauszugImportieren } from "@/lib/bank/service";
import { addDaysIso } from "@/lib/dates";
import { createZip } from "@/lib/ebay/export/zip";
import { getSettings } from "@/lib/settings";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { abgleichen, abstimmungsgrad, type Abrechnung, type Beleg, type Vorschlag, type Zahlung } from "./abgleich";
import { leseAmex } from "./amex";
import { alsCp1252, datevBuchungsstapel, type DatevZeile } from "./datev";
import { kontoVorschlag, regelSchluessel, ustSatzAus, wirktEu, type Geldkonten } from "./kontierung";
import { leseUstBericht, type UstAuswertung } from "./ust-bericht";

// Buchhaltung je Firma (nur LuGru/WiGru – AdelPrep läuft über Lexoffice): Kontoauszüge und Amex-CSV mit
// Saldo-Kontrolle, Abgleich Zahlung ↔ Beleg, Vorkontierung SKR04, Festschreibung, DATEV-Export, Protokoll (GoBD).

const U = schema.bankUmsaetze;
const I = schema.invoices;
const Z = schema.belegZuordnungen;
const B = schema.buchungen;
const P = schema.buchhaltungProtokoll;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Conn = typeof db | Tx;
type Wer = Pick<Session, "tenantId" | "userId"> & { name?: string | null; email?: string };

const r2 = (n: number) => Math.round(n * 100) / 100;
export const monatGrenzen = (monat: string) => {
  const [j, m] = monat.split("-").map(Number);
  const ende = new Date(Date.UTC(j, m, 0)).toISOString().slice(0, 10);
  return { von: `${monat}-01`, bis: ende };
};
export const monatOk = (m: unknown): m is string => typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

export class BuchhaltungFehler extends Error {}

async function cfg(tenantId: string) {
  return (await getSettings(tenantId)).buchhaltung;
}
/** Firma prüfen (nur die eingestellten); null = Hauptfirma. */
export async function firmaPruefen(tenantId: string, firma: string | null | undefined): Promise<{ firma: string; haupt: boolean; firmen: string[] }> {
  const c = await cfg(tenantId);
  const f = firma && c.firmen.includes(firma) ? firma : c.firmen[0];
  return { firma: f, haupt: f === c.firmen[0], firmen: c.firmen };
}
/** Filter auf die Firma – bei der Hauptfirma auch Einträge ohne Firma (Altbestand). */
const firmaWo = (col: PgColumn, f: { firma: string; haupt: boolean }): SQL => (f.haupt ? or(isNull(col), eq(col, f.firma))! : eq(col, f.firma));

async function protokoll(conn: Conn, wer: Wer, objekt: string, objektId: string | null, aktion: string, vorher: unknown, nachher: unknown) {
  await conn.insert(P).values({ tenantId: wer.tenantId, objekt, objektId, aktion, vorher: (vorher ?? null) as never, nachher: (nachher ?? null) as never, userId: wer.userId, userName: wer.name || wer.email || null });
}

// ---- Uploads ---------------------------------------------------------------------------------------------

export async function sparkasseImportieren(wer: Wer, firma: string | null, datei: { name: string; bytes: Uint8Array }, saldoBank?: number | null) {
  const f = await firmaPruefen(wer.tenantId, firma);
  const r = await kontoauszugImportieren(wer.tenantId, "geschaeft", null, datei.bytes, { saldoBank, firma: f.firma });
  const endsaldo = r.endsaldo?.saldo ?? null;
  const anfangssaldo = endsaldo !== null ? r2(endsaldo - r.summe) : null;
  const [imp] = await db
    .insert(schema.buchhaltungImporte)
    .values({ tenantId: wer.tenantId, firma: f.firma, art: "sparkasse", dateiname: datei.name.slice(0, 200), von: r.von, bis: r.bis, neu: r.neu, doppelt: r.doppelt, summe: r.summe, anfangssaldo, endsaldo, userId: wer.userId })
    .returning({ id: schema.buchhaltungImporte.id });
  await protokoll(db, wer, "import", imp.id, "sparkasse", null, { datei: datei.name, von: r.von, bis: r.bis, neu: r.neu, doppelt: r.doppelt, summe: r.summe, anfangssaldo, endsaldo });
  return { ...r, anfangssaldo, endsaldo, firma: f.firma };
}

export async function amexImportieren(wer: Wer, firma: string | null, datei: { name: string; bytes: Uint8Array }) {
  const f = await firmaPruefen(wer.tenantId, firma);
  const a = leseAmex(datei.bytes);
  let neu = 0;
  const werte = a.umsaetze.map((u) => ({
    tenantId: wer.tenantId,
    bereich: "kreditkarte" as const,
    userId: null,
    schluessel: u.schluessel,
    konto: "AMEX",
    buchungstag: u.buchungstag,
    valuta: null,
    betrag: u.betrag,
    waehrung: "EUR",
    gegenpartei: u.beschreibung,
    zweck: [u.referenz ? `Ref. ${u.referenz}` : "", u.ort ?? ""].filter(Boolean).join(" · "),
    firma: f.firma,
    buchungstext: "Amex",
    gruppe: createHash("sha256").update(`amex|${u.beschreibung.toLowerCase().replace(/[^a-z]+/g, " ").trim().slice(0, 30)}`).digest("hex").slice(0, 32),
  }));
  for (let i = 0; i < werte.length; i += 500) neu += (await db.insert(U).values(werte.slice(i, i + 500)).onConflictDoNothing().returning({ id: U.id })).length;
  const summe = r2(a.gutschriften - a.belastungen);
  const [imp] = await db
    .insert(schema.buchhaltungImporte)
    .values({ tenantId: wer.tenantId, firma: f.firma, art: "amex", dateiname: datei.name.slice(0, 200), von: a.von, bis: a.bis, neu, doppelt: werte.length - neu, summe, userId: wer.userId })
    .returning({ id: schema.buchhaltungImporte.id });
  await protokoll(db, wer, "import", imp.id, "amex", null, { datei: datei.name, von: a.von, bis: a.bis, neu, belastungen: a.belastungen, gutschriften: a.gutschriften });
  return { neu, doppelt: werte.length - neu, von: a.von, bis: a.bis, belastungen: a.belastungen, gutschriften: a.gutschriften, firma: f.firma };
}

export async function ustBerichtImportieren(wer: Wer, firma: string | null, datei: { name: string; bytes: Uint8Array }): Promise<{ monat: string; auswertung: UstAuswertung }> {
  const f = await firmaPruefen(wer.tenantId, firma);
  const a = leseUstBericht(datei.bytes);
  const monat = (a.zeitraum.bis ?? a.zeitraum.von ?? "").slice(0, 7);
  if (!monatOk(monat)) throw new BuchhaltungFehler("Im Bericht steht kein Datum – ist das der Umsatzsteuer-Transaktionsbericht?");
  await db
    .insert(schema.ustAuswertungen)
    .values({ tenantId: wer.tenantId, firma: f.firma, monat, daten: a, dateiname: datei.name.slice(0, 200) })
    .onConflictDoUpdate({ target: [schema.ustAuswertungen.tenantId, schema.ustAuswertungen.firma, schema.ustAuswertungen.monat], set: { daten: a, dateiname: datei.name.slice(0, 200), createdAt: new Date() } });
  await protokoll(db, wer, "ust_bericht", monat, "import", null, { datei: datei.name, laender: [...new Set(a.zeilen.map((z) => z.land))] });
  return { monat, auswertung: a };
}

// ---- Abgleich --------------------------------------------------------------------------------------------

type UmsatzZeile = { id: string; buchungstag: string; betrag: number; gegenpartei: string | null; zweck: string | null; gegenIban: string | null; bereich: string };
const alsZahlung = (u: UmsatzZeile): Zahlung => ({ id: u.id, datum: u.buchungstag, betrag: u.betrag, gegenpartei: u.gegenpartei ?? "", zweck: u.zweck ?? "", iban: u.gegenIban, quelle: u.bereich === "kreditkarte" ? "kreditkarte" : "bank" });

const umsatzFelder = { id: U.id, buchungstag: U.buchungstag, betrag: U.betrag, gegenpartei: U.gegenpartei, zweck: U.zweck, gegenIban: U.gegenIban, bereich: U.bereich };

async function belegeOffen(tenantId: string, f: { firma: string; haupt: boolean }, von: string, bis: string) {
  const rows = await db
    .select({ id: I.id, datum: I.invoiceDate, brutto: I.totalGross, netto: I.totalNet, nummer: I.invoiceNumber, vendor: I.vendor, docType: I.docType, kind: I.kind, supplier: schema.suppliers.name, fileName: I.fileName, status: I.status })
    .from(I)
    .leftJoin(schema.suppliers, eq(schema.suppliers.id, I.supplierId))
    .where(and(eq(I.tenantId, tenantId), firmaWo(I.firma, f), inArray(I.docType, ["rechnung", "gutschrift", "quittung"]), ne(I.status, "ignored"), gte(I.invoiceDate, von), lte(I.invoiceDate, bis)));
  const zugeordnet = rows.length
    ? await db
        .select({ invoiceId: Z.invoiceId, summe: sql<number>`sum(${Z.betrag})::float` })
        .from(Z)
        .where(and(eq(Z.tenantId, tenantId), inArray(Z.invoiceId, rows.map((r) => r.id)), ne(Z.status, "abgelehnt")))
        .groupBy(Z.invoiceId)
    : [];
  const summe = new Map(zugeordnet.map((z) => [z.invoiceId!, z.summe]));
  return rows
    .map((r) => ({ ...r, lieferant: r.vendor || r.supplier || null, rest: r2(Math.abs(r.brutto ?? 0) - (summe.get(r.id) ?? 0)) }))
    .filter((r) => r.brutto !== null && r.rest > 0.005);
}

/** Abgleich für Firma und Monat: neue Vorschläge; sichere werden sofort bestätigt (mit Buchungsvorschlag). */
export async function abgleichLaufen(wer: Wer, firma: string | null, monat: string) {
  const f = await firmaPruefen(wer.tenantId, firma);
  const { von, bis } = monatGrenzen(monat);
  const t = wer.tenantId;
  const vorhanden = db.select({ id: Z.umsatzId }).from(Z).where(and(eq(Z.tenantId, t), ne(Z.status, "abgelehnt")));
  const zahlungen = await db
    .select(umsatzFelder)
    .from(U)
    .where(and(eq(U.tenantId, t), inArray(U.bereich, ["geschaeft", "kreditkarte"]), firmaWo(U.firma, f), gte(U.buchungstag, von), lte(U.buchungstag, bis), notInArray(U.id, vorhanden)));
  // Kartenumsätze für die Summenprüfung der Amex-Lastschrift (75 Tage zurück), ohne bereits verwendete.
  const verwendet = new Set(
    (await db.select({ d: Z.details }).from(Z).where(and(eq(Z.tenantId, t), eq(Z.art, "amex_sammel"), ne(Z.status, "abgelehnt")))).flatMap((x) => x.d.kartenUmsaetze ?? []),
  );
  const karte = (await db.select(umsatzFelder).from(U).where(and(eq(U.tenantId, t), eq(U.bereich, "kreditkarte"), firmaWo(U.firma, f), gte(U.buchungstag, addDaysIso(von, -75)), lte(U.buchungstag, bis)))).filter((k) => !verwendet.has(k.id));
  const belege = await belegeOffen(t, f, addDaysIso(von, -120), addDaysIso(bis, 30));
  const settlements = await db
    .select({ id: schema.amazonSettlements.settlementId, depositDate: schema.amazonSettlements.depositDate, total: schema.amazonSettlements.totalAmount })
    .from(schema.amazonSettlements)
    .where(and(eq(schema.amazonSettlements.tenantId, t), gte(schema.amazonSettlements.depositDate, new Date(`${addDaysIso(von, -10)}T00:00:00Z`)), lte(schema.amazonSettlements.depositDate, new Date(`${addDaysIso(bis, 10)}T23:59:59Z`))));
  const abrechnungen: Abrechnung[] = settlements.map((s) => ({ id: s.id, auszahlung: s.depositDate ? s.depositDate.toISOString().slice(0, 10) : null, betrag: s.total, markt: "amazon" }));
  const belegListe: Beleg[] = belege.map((b) => ({ id: b.id, datum: b.datum, brutto: b.rest, nummer: b.nummer, lieferant: b.lieferant, gutschrift: b.docType === "gutschrift" }));
  const r = abgleichen(zahlungen.map(alsZahlung), belegListe, { karte: karte.map(alsZahlung), abrechnungen });

  let automatisch = 0;
  await db.transaction(async (tx) => {
    for (const v of r.vorschlaege) {
      const auto = v.sicherheit === "hoch";
      const [z] = await tx
        .insert(Z)
        .values({
          tenantId: t,
          firma: f.firma,
          umsatzId: v.zahlungId,
          invoiceId: v.belegId,
          art: v.art,
          betrag: v.betrag,
          sicherheit: v.sicherheit,
          regel: v.regel,
          status: auto ? "bestaetigt" : "vorschlag",
          details: { ...(v.kartenUmsaetze ? { kartenUmsaetze: v.kartenUmsaetze } : {}), ...(v.abrechnungId ? { abrechnungId: v.abrechnungId } : {}), ...(auto ? { automatisch: true } : {}) },
          bestaetigtAm: auto ? new Date() : null,
        })
        .returning();
      if (auto) {
        automatisch++;
        await buchungAusZuordnung(tx, wer, z);
      }
    }
    await protokoll(tx, wer, "abgleich", `${f.firma}:${monat}`, "lauf", null, { zahlungen: zahlungen.length, vorschlaege: r.vorschlaege.length, automatisch, ohne: r.ohneZuordnung.length });
  });
  return { zahlungen: zahlungen.length, vorschlaege: r.vorschlaege.length - automatisch, automatisch, ohne: r.ohneZuordnung.length, firma: f.firma };
}

/** Buchungsvorschlag (SKR04) aus einer bestätigten Zuordnung. */
async function buchungAusZuordnung(conn: Conn, wer: Wer, z: typeof Z.$inferSelect) {
  const c = await cfg(wer.tenantId);
  const g: Geldkonten = c.geldkonten;
  const [u] = await conn.select({ buchungstag: U.buchungstag, betrag: U.betrag, bereich: U.bereich, gegenpartei: U.gegenpartei, zweck: U.zweck }).from(U).where(and(eq(U.tenantId, wer.tenantId), eq(U.id, z.umsatzId)));
  if (!u) return;
  const geld = u.bereich === "kreditkarte" ? g.kreditkarte : g.bank;
  const basis = { tenantId: wer.tenantId, firma: z.firma, monat: u.buchungstag.slice(0, 7), datum: u.buchungstag, umsatzId: z.umsatzId, zuordnungId: z.id, createdBy: wer.userId };
  let werte: typeof B.$inferInsert | null = null;
  if (z.art === "beleg" && z.invoiceId) {
    const [b] = await conn
      .select({ nummer: I.invoiceNumber, vendor: I.vendor, supplier: schema.suppliers.name, kind: I.kind, netto: I.totalNet, brutto: I.totalGross, text: I.textExcerpt, docType: I.docType })
      .from(I)
      .leftJoin(schema.suppliers, eq(schema.suppliers.id, I.supplierId))
      .where(and(eq(I.tenantId, wer.tenantId), eq(I.id, z.invoiceId)));
    if (!b) return;
    const lieferant = b.vendor || b.supplier || null;
    const regeln = await gelernteRegeln(conn, wer.tenantId);
    const k = kontoVorschlag({ lieferant, text: b.text ?? "", kind: b.kind, ustSatz: ustSatzAus(b.netto, b.brutto), eu: wirktEu(lieferant, b.text ?? "") }, regeln);
    werte = { ...basis, betrag: z.betrag, sollHaben: u.betrag < 0 ? "S" : "H", konto: k.konto, gegenkonto: geld, buSchluessel: k.bu, belegfeld1: b.nummer ?? "", buchungstext: `${lieferant ?? "Beleg"}${b.nummer ? ` ${b.nummer}` : ""}`.slice(0, 60), invoiceId: z.invoiceId, quelle: k.grund.startsWith("gelernt") ? "regel" : "vorschlag", hinweis: [k.grund, k.hinweis].filter(Boolean).join(" · "), status: k.sicherheit === "hoch" && !k.hinweis ? "bestaetigt" : "vorschlag" };
  } else if (z.art === "amex_sammel") {
    werte = { ...basis, betrag: z.betrag, sollHaben: "S", konto: g.kreditkarte, gegenkonto: g.bank, buSchluessel: null, belegfeld1: "AMEX", buchungstext: "Amex-Abrechnung (Ausgleich Kartenkonto)", quelle: "regel", hinweis: z.regel, status: "bestaetigt" };
  } else if (z.art === "marktplatz") {
    werte = { ...basis, betrag: z.betrag, sollHaben: "H", konto: g.marktplatz, gegenkonto: g.bank, buSchluessel: null, belegfeld1: z.details.abrechnungId ?? "", buchungstext: `Marktplatz-Auszahlung${z.details.abrechnungId ? ` ${z.details.abrechnungId}` : ""}`, quelle: "regel", hinweis: z.regel, status: z.details.abrechnungId ? "bestaetigt" : "vorschlag" };
  } else if (z.art === "ohne_beleg" && /Bankentgelt/.test(z.regel)) {
    werte = { ...basis, betrag: z.betrag, sollHaben: u.betrag < 0 ? "S" : "H", konto: "6855", gegenkonto: geld, buSchluessel: null, belegfeld1: "", buchungstext: (u.zweck || "Bankentgelt").slice(0, 60), quelle: "regel", hinweis: z.regel, status: "bestaetigt" };
  }
  if (werte) await conn.insert(B).values(werte);
}

async function gelernteRegeln(conn: Conn, tenantId: string) {
  const rows = await conn.select().from(schema.kontierungsRegeln).where(eq(schema.kontierungsRegeln.tenantId, tenantId));
  return new Map(rows.map((r) => [r.schluessel, { konto: r.konto, bu: r.buSchluessel }]));
}

async function zuordnungLaden(tenantId: string, id: string) {
  const [z] = await db.select().from(Z).where(and(eq(Z.tenantId, tenantId), eq(Z.id, id)));
  if (!z) throw new BuchhaltungFehler("Zuordnung nicht gefunden.");
  return z;
}

export async function zuordnungBestaetigen(wer: Wer, id: string) {
  const z = await zuordnungLaden(wer.tenantId, id);
  if (z.status === "bestaetigt") return;
  await db.transaction(async (tx) => {
    const [neu] = await tx.update(Z).set({ status: "bestaetigt", bestaetigtVon: wer.userId, bestaetigtAm: new Date() }).where(and(eq(Z.tenantId, wer.tenantId), eq(Z.id, id))).returning();
    await buchungAusZuordnung(tx, wer, neu);
    await protokoll(tx, wer, "zuordnung", id, "bestaetigt", { status: z.status }, { status: "bestaetigt", regel: z.regel });
  });
}

export async function zuordnungAblehnen(wer: Wer, id: string) {
  const z = await zuordnungLaden(wer.tenantId, id);
  const [fest] = await db.select({ id: B.id }).from(B).where(and(eq(B.tenantId, wer.tenantId), eq(B.zuordnungId, id), eq(B.status, "festgeschrieben"))).limit(1);
  if (fest) throw new BuchhaltungFehler("Die Buchung dazu ist festgeschrieben – bitte unten stornieren.");
  await db.transaction(async (tx) => {
    await tx.delete(B).where(and(eq(B.tenantId, wer.tenantId), eq(B.zuordnungId, id)));
    await tx.update(Z).set({ status: "abgelehnt" }).where(and(eq(Z.tenantId, wer.tenantId), eq(Z.id, id)));
    await protokoll(tx, wer, "zuordnung", id, "abgelehnt", { status: z.status, regel: z.regel }, { status: "abgelehnt" });
  });
}

/** Von Hand: Zahlung einem Beleg zuordnen (bestätigt). */
export async function zuordnungManuell(wer: Wer, umsatzId: string, invoiceId: string) {
  const [u] = await db.select({ betrag: U.betrag, firma: U.firma }).from(U).where(and(eq(U.tenantId, wer.tenantId), eq(U.id, umsatzId)));
  const [b] = await db.select({ brutto: I.totalGross, nummer: I.invoiceNumber }).from(I).where(and(eq(I.tenantId, wer.tenantId), eq(I.id, invoiceId)));
  if (!u || !b) throw new BuchhaltungFehler("Zahlung oder Beleg nicht gefunden.");
  const f = await firmaPruefen(wer.tenantId, u.firma);
  await db.transaction(async (tx) => {
    const [z] = await tx
      .insert(Z)
      .values({ tenantId: wer.tenantId, firma: f.firma, umsatzId, invoiceId, art: "beleg", betrag: r2(Math.min(Math.abs(u.betrag), Math.abs(b.brutto ?? Math.abs(u.betrag)))), sicherheit: "hoch", regel: "von Hand zugeordnet", status: "bestaetigt", bestaetigtVon: wer.userId, bestaetigtAm: new Date() })
      .returning();
    await buchungAusZuordnung(tx, wer, z);
    await protokoll(tx, wer, "zuordnung", z.id, "manuell", null, { umsatzId, invoiceId, beleg: b.nummer });
  });
}

// ---- Buchungen -------------------------------------------------------------------------------------------

export async function buchungAendern(wer: Wer, id: string, aenderung: { konto: string; bu: string | null; lernen: boolean }) {
  if (!/^\d{4,8}$/.test(aenderung.konto)) throw new BuchhaltungFehler("Konto: 4–8 Ziffern.");
  if (aenderung.bu && !/^\d{1,4}$/.test(aenderung.bu)) throw new BuchhaltungFehler("BU-Schlüssel: Ziffern.");
  const [b] = await db.select().from(B).where(and(eq(B.tenantId, wer.tenantId), eq(B.id, id)));
  if (!b) throw new BuchhaltungFehler("Buchung nicht gefunden.");
  if (b.status === "festgeschrieben") throw new BuchhaltungFehler("Festgeschrieben – nur Storno möglich.");
  await db.transaction(async (tx) => {
    await tx.update(B).set({ konto: aenderung.konto, buSchluessel: aenderung.bu, status: "bestaetigt", quelle: "hand" }).where(and(eq(B.tenantId, wer.tenantId), eq(B.id, id)));
    await protokoll(tx, wer, "buchung", id, "geaendert", { konto: b.konto, bu: b.buSchluessel, status: b.status }, { konto: aenderung.konto, bu: aenderung.bu, status: "bestaetigt" });
    // Lernen: Lieferant → Konto (beim nächsten Beleg dieses Lieferanten automatisch).
    if (aenderung.lernen && b.invoiceId) {
      const [inv] = await tx.select({ vendor: I.vendor, supplier: schema.suppliers.name }).from(I).leftJoin(schema.suppliers, eq(schema.suppliers.id, I.supplierId)).where(and(eq(I.tenantId, wer.tenantId), eq(I.id, b.invoiceId)));
      const s = regelSchluessel(inv?.vendor || inv?.supplier);
      if (s) {
        await tx
          .insert(schema.kontierungsRegeln)
          .values({ tenantId: wer.tenantId, schluessel: s, konto: aenderung.konto, buSchluessel: aenderung.bu })
          .onConflictDoUpdate({ target: [schema.kontierungsRegeln.tenantId, schema.kontierungsRegeln.schluessel], set: { konto: aenderung.konto, buSchluessel: aenderung.bu, anzahl: sql`${schema.kontierungsRegeln.anzahl} + 1`, updatedAt: new Date() } });
        await protokoll(tx, wer, "regel", s, "gelernt", null, { konto: aenderung.konto, bu: aenderung.bu });
      }
    }
  });
}

export async function buchungenBestaetigen(wer: Wer, firma: string | null, monat: string, ids?: string[]) {
  const f = await firmaPruefen(wer.tenantId, firma);
  const wo = and(eq(B.tenantId, wer.tenantId), eq(B.firma, f.firma), eq(B.monat, monat), eq(B.status, "vorschlag"), ids?.length ? inArray(B.id, ids) : undefined);
  const rows = await db.update(B).set({ status: "bestaetigt" }).where(wo).returning({ id: B.id });
  if (rows.length) await protokoll(db, wer, "buchung", `${f.firma}:${monat}`, "bestaetigt", null, { anzahl: rows.length });
  return rows.length;
}

/** Storno einer festgeschriebenen Buchung: Gegenbuchung (S/H getauscht), die Originalbuchung bleibt unverändert. */
export async function buchungStornieren(wer: Wer, id: string) {
  const [b] = await db.select().from(B).where(and(eq(B.tenantId, wer.tenantId), eq(B.id, id)));
  if (!b) throw new BuchhaltungFehler("Buchung nicht gefunden.");
  if (b.status !== "festgeschrieben") throw new BuchhaltungFehler("Nur festgeschriebene Buchungen werden storniert – sonst einfach ändern.");
  const [schon] = await db.select({ id: B.id }).from(B).where(and(eq(B.tenantId, wer.tenantId), eq(B.stornoVon, id))).limit(1);
  if (schon) throw new BuchhaltungFehler("Schon storniert.");
  const heute = new Date().toISOString().slice(0, 10);
  await db.transaction(async (tx) => {
    const [s] = await tx
      .insert(B)
      .values({ tenantId: b.tenantId, firma: b.firma, monat: heute.slice(0, 7), datum: heute, betrag: b.betrag, sollHaben: b.sollHaben === "S" ? "H" : "S", konto: b.konto, gegenkonto: b.gegenkonto, buSchluessel: b.buSchluessel, belegfeld1: b.belegfeld1, buchungstext: `Storno ${b.buchungstext}`.slice(0, 60), invoiceId: b.invoiceId, umsatzId: b.umsatzId, quelle: "storno", status: "bestaetigt", stornoVon: b.id, createdBy: wer.userId })
      .returning({ id: B.id });
    await protokoll(tx, wer, "buchung", id, "storniert", null, { stornoBuchung: s.id });
  });
}

/** Monat festschreiben: alle bestätigten Buchungen werden unveränderbar (offene Vorschläge verhindern das). */
export async function monatFestschreiben(wer: Wer, firma: string | null, monat: string) {
  const f = await firmaPruefen(wer.tenantId, firma);
  const [offen] = await db.select({ n: sql<number>`count(*)::int` }).from(B).where(and(eq(B.tenantId, wer.tenantId), eq(B.firma, f.firma), eq(B.monat, monat), eq(B.status, "vorschlag")));
  if (offen.n) throw new BuchhaltungFehler(`${offen.n} Buchungsvorschläge sind noch nicht bestätigt.`);
  const rows = await db.update(B).set({ status: "festgeschrieben", festgeschriebenAm: new Date() }).where(and(eq(B.tenantId, wer.tenantId), eq(B.firma, f.firma), eq(B.monat, monat), eq(B.status, "bestaetigt"))).returning({ id: B.id });
  await protokoll(db, wer, "festschreibung", `${f.firma}:${monat}`, "festgeschrieben", null, { buchungen: rows.length });
  return rows.length;
}

// ---- Export ----------------------------------------------------------------------------------------------

async function exportBuchungen(tenantId: string, firma: string, monat: string) {
  return db
    .select()
    .from(B)
    .where(and(eq(B.tenantId, tenantId), eq(B.firma, firma), eq(B.monat, monat), inArray(B.status, ["bestaetigt", "festgeschrieben"])))
    .orderBy(asc(B.datum), asc(B.createdAt));
}

export async function datevExport(wer: Wer, firma: string | null, monat: string): Promise<{ name: string; bytes: Uint8Array; anzahl: number }> {
  const f = await firmaPruefen(wer.tenantId, firma);
  const c = await cfg(wer.tenantId);
  const rows = await exportBuchungen(wer.tenantId, f.firma, monat);
  if (!rows.length) throw new BuchhaltungFehler("Keine bestätigten Buchungen in diesem Monat.");
  const { von, bis } = monatGrenzen(monat);
  const nr = c.datev[f.firma] ?? {};
  const wj = `${monat.slice(0, 4)}-${String(c.wjBeginnMonat || 1).padStart(2, "0")}-01`;
  const alleFest = rows.every((r) => r.status === "festgeschrieben");
  const zeilen: DatevZeile[] = rows.map((r) => ({ betrag: r.betrag, sollHaben: r.sollHaben, konto: r.konto, gegenkonto: r.gegenkonto, bu: r.buSchluessel, datum: r.datum, belegfeld1: r.belegfeld1, text: r.buchungstext }));
  const text = datevBuchungsstapel({ beraternummer: nr.beraternummer ?? "", mandantennummer: nr.mandantennummer ?? "", wjBeginn: wj > von ? `${Number(monat.slice(0, 4)) - 1}${wj.slice(4)}` : wj, von, bis, bezeichnung: `${f.firma} ${monat}`, kontenrahmen: c.kontenrahmen, festschreibung: alleFest }, zeilen);
  const summe = r2(rows.reduce((n, r) => n + r.betrag, 0));
  await db.insert(schema.buchhaltungExporte).values({ tenantId: wer.tenantId, firma: f.firma, monat, art: "datev", buchungen: rows.length, summe, festgeschrieben: alleFest, userId: wer.userId });
  await protokoll(db, wer, "export", `${f.firma}:${monat}`, "datev", null, { buchungen: rows.length, summe, festgeschrieben: alleFest });
  return { name: `EXTF_Buchungsstapel_${f.firma}_${monat}.csv`, bytes: alsCp1252(text), anzahl: rows.length };
}

/** Alternativ: CSV der Buchungen + ZIP aller Belege des Monats (Dateiname = Belegnummer). */
export async function belegeZip(wer: Wer, firma: string | null, monat: string): Promise<{ name: string; bytes: Buffer; belege: number }> {
  const f = await firmaPruefen(wer.tenantId, firma);
  const rows = await exportBuchungen(wer.tenantId, f.firma, monat);
  const ids = [...new Set(rows.map((r) => r.invoiceId).filter((x): x is string => !!x))];
  const dateien = ids.length
    ? await db.select({ id: I.id, nummer: I.invoiceNumber, name: schema.files.name, data: schema.files.data }).from(I).innerJoin(schema.files, eq(schema.files.id, I.fileId)).where(and(eq(I.tenantId, wer.tenantId), inArray(I.id, ids)))
    : [];
  const csv = ["Datum;Betrag;S/H;Konto;Gegenkonto;BU;Belegnummer;Buchungstext;Status", ...rows.map((r) => [r.datum, r.betrag.toFixed(2).replace(".", ","), r.sollHaben, r.konto, r.gegenkonto, r.buSchluessel ?? "", r.belegfeld1, `"${r.buchungstext.replace(/"/g, '""')}"`, r.status].join(";"))].join("\r\n");
  const genutzt = new Set<string>();
  const files = [
    { name: `Buchungen_${f.firma}_${monat}.csv`, data: `﻿${csv}\r\n` },
    ...dateien.map((d) => {
      const ext = (/\.[a-z0-9]{2,5}$/i.exec(d.name)?.[0] ?? ".pdf").toLowerCase();
      let n = `Belege/${(d.nummer || d.id).replace(/[^A-Za-z0-9._-]+/g, "_")}${ext}`;
      for (let i = 2; genutzt.has(n); i++) n = n.replace(/(_\d+)?(\.[a-z0-9]+)$/i, `_${i}$2`);
      genutzt.add(n);
      return { name: n, data: new Uint8Array(d.data) };
    }),
  ];
  await db.insert(schema.buchhaltungExporte).values({ tenantId: wer.tenantId, firma: f.firma, monat, art: "csv_zip", buchungen: rows.length, belege: dateien.length, summe: r2(rows.reduce((n, r) => n + r.betrag, 0)), userId: wer.userId });
  await protokoll(db, wer, "export", `${f.firma}:${monat}`, "csv_zip", null, { buchungen: rows.length, belege: dateien.length });
  return { name: `Buchhaltung_${f.firma}_${monat}.zip`, bytes: createZip(files), belege: dateien.length };
}

// ---- Übersicht -------------------------------------------------------------------------------------------

/** Status je Firma und Monat – für Seite und Claude (buchhaltung_status). */
export async function buchhaltungStatus(tenantId: string, monat: string, firma?: string | null) {
  const f = await firmaPruefen(tenantId, firma);
  const { von, bis } = monatGrenzen(monat);
  const zahlungen = await db
    .select({ ...umsatzFelder, valuta: U.valuta })
    .from(U)
    .where(and(eq(U.tenantId, tenantId), inArray(U.bereich, ["geschaeft", "kreditkarte"]), firmaWo(U.firma, f), gte(U.buchungstag, von), lte(U.buchungstag, bis)))
    .orderBy(asc(U.buchungstag));
  const zuord = zahlungen.length ? await db.select().from(Z).where(and(eq(Z.tenantId, tenantId), inArray(Z.umsatzId, zahlungen.map((z) => z.id)), ne(Z.status, "abgelehnt"))) : [];
  const jeZahlung = new Map<string, (typeof zuord)[number][]>();
  for (const z of zuord) jeZahlung.set(z.umsatzId, [...(jeZahlung.get(z.umsatzId) ?? []), z]);
  const zugeordnet = zahlungen.filter((z) => (jeZahlung.get(z.id) ?? []).some((x) => x.status === "bestaetigt"));
  const vorschlaege = zuord.filter((z) => z.status === "vorschlag");
  const ohneBeleg = zahlungen.filter((z) => !jeZahlung.has(z.id));
  const belegeMonat = await db
    .select({ id: I.id, datum: I.invoiceDate, brutto: I.totalGross, nummer: I.invoiceNumber, vendor: I.vendor, supplier: schema.suppliers.name, status: I.status, docType: I.docType, checks: I.checks, createdAt: I.createdAt })
    .from(I)
    .leftJoin(schema.suppliers, eq(schema.suppliers.id, I.supplierId))
    .where(and(eq(I.tenantId, tenantId), firmaWo(I.firma, f), ne(I.status, "ignored"), gte(I.invoiceDate, von), lte(I.invoiceDate, bis)));
  const offen = await belegeOffen(tenantId, f, von, bis);
  const buchungen = await db.select({ status: B.status, n: sql<number>`count(*)::int` }).from(B).where(and(eq(B.tenantId, tenantId), eq(B.firma, f.firma), eq(B.monat, monat))).groupBy(B.status);
  const exporte = await db.select().from(schema.buchhaltungExporte).where(and(eq(schema.buchhaltungExporte.tenantId, tenantId), eq(schema.buchhaltungExporte.firma, f.firma), eq(schema.buchhaltungExporte.monat, monat))).orderBy(desc(schema.buchhaltungExporte.createdAt));
  const importe = await db.select().from(schema.buchhaltungImporte).where(and(eq(schema.buchhaltungImporte.tenantId, tenantId), eq(schema.buchhaltungImporte.firma, f.firma))).orderBy(desc(schema.buchhaltungImporte.createdAt)).limit(10);
  const anzahl = (s: string) => buchungen.find((b) => b.status === s)?.n ?? 0;
  const unsicher = belegeMonat.filter((b) => b.status === "review" || (b.checks && (b.checks.date || b.checks.docType || (b.checks.duplicateOf?.length && !b.checks.notDuplicate))));
  return {
    firma: f.firma,
    firmen: f.firmen,
    monat,
    zahlungen: { gesamt: zahlungen.length, zugeordnet: zugeordnet.length, vorschlaege: vorschlaege.length, ohneBeleg: ohneBeleg.length },
    abstimmungsgrad: abstimmungsgrad(zugeordnet.length, zahlungen.length),
    belege: { gesamt: belegeMonat.length, neu: belegeMonat.filter((b) => b.status === "new").length, unsicher: unsicher.length, ohneZahlung: offen.length },
    buchungen: { vorschlag: anzahl("vorschlag"), bestaetigt: anzahl("bestaetigt"), festgeschrieben: anzahl("festgeschrieben") },
    export: exporte[0] ? { am: exporte[0].createdAt, art: exporte[0].art, buchungen: exporte[0].buchungen, festgeschrieben: exporte[0].festgeschrieben } : null,
    listen: {
      ohneBeleg: ohneBeleg.map((z) => ({ id: z.id, datum: z.buchungstag, betrag: z.betrag, gegenpartei: z.gegenpartei ?? "", zweck: z.zweck ?? "", karte: z.bereich === "kreditkarte" })),
      vorschlaege: vorschlaege.map((v) => ({ ...v, zahlung: zahlungen.find((z) => z.id === v.umsatzId) ?? null })),
      belegeOhneZahlung: offen.map((b) => ({ id: b.id, datum: b.datum, brutto: b.brutto, rest: b.rest, nummer: b.nummer, lieferant: b.lieferant, docType: b.docType })),
    },
    importe,
    exporte,
  };
}

export async function buchungenListe(tenantId: string, firma: string, monat: string) {
  return db
    .select({ b: B, beleg: I.invoiceNumber, lieferant: I.vendor, storniert: sql<boolean>`exists (select 1 from buchungen s where s.storno_von = ${B.id})` })
    .from(B)
    .leftJoin(I, eq(I.id, B.invoiceId))
    .where(and(eq(B.tenantId, tenantId), eq(B.firma, firma), eq(B.monat, monat)))
    .orderBy(asc(B.datum), asc(B.createdAt));
}

export async function protokollListe(tenantId: string, limit = 50) {
  return db.select().from(P).where(eq(P.tenantId, tenantId)).orderBy(desc(P.createdAt)).limit(limit);
}

export async function ustAuswertung(tenantId: string, firma: string, monat: string) {
  const [r] = await db.select().from(schema.ustAuswertungen).where(and(eq(schema.ustAuswertungen.tenantId, tenantId), eq(schema.ustAuswertungen.firma, firma), eq(schema.ustAuswertungen.monat, monat)));
  return r ? { ...r, daten: r.daten as UstAuswertung } : null;
}

/** Zahlungen ohne Beleg → eine Aufgabe „Belege anfordern“ je Firma und Monat (Zuständigkeit über die Delegations-Regeln). */
export async function belegeAnfordern(wer: Wer, firma: string | null, monat: string) {
  const s = await buchhaltungStatus(wer.tenantId, monat, firma);
  const key = `belege-fehlen-${s.firma}-${monat}`.toLowerCase();
  const fehlen = s.listen.ohneBeleg.filter((z) => z.betrag < 0);
  if (!fehlen.length) {
    await resolveSystemTask(db, wer.tenantId, key);
    return 0;
  }
  await upsertSystemTask(db, wer.tenantId, key, {
    title: `Belege anfordern: ${fehlen.length} Zahlung${fehlen.length === 1 ? "" : "en"} ohne Beleg (${s.firma}, ${monat.slice(5)}/${monat.slice(0, 4)})`,
    notes: fehlen
      .slice(0, 40)
      .map((z) => `• ${z.datum.split("-").reverse().join(".")} · ${z.betrag.toFixed(2).replace(".", ",")} € · ${(z.gegenpartei || z.zweck).slice(0, 60)}${z.karte ? " (Amex)" : ""}`)
      .join("\n"),
    category: "geld",
    link: `/buchhaltung?firma=${encodeURIComponent(s.firma)}&monat=${monat}#ohne-beleg`,
  });
  await protokoll(db, wer, "aufgabe", key, "belege_anfordern", null, { anzahl: fehlen.length });
  return fehlen.length;
}

/** Beleg einer Firma zuordnen (Mandantenfähigkeit). */
export async function belegFirmaSetzen(wer: Wer, invoiceId: string, firma: string) {
  const f = await firmaPruefen(wer.tenantId, firma);
  await db.update(I).set({ firma: f.firma }).where(and(eq(I.tenantId, wer.tenantId), eq(I.id, invoiceId)));
  await protokoll(db, wer, "beleg", invoiceId, "firma", null, { firma: f.firma });
}

/** Kandidaten für die Hand-Zuordnung: offene Belege mit ähnlichem Betrag (±20 %) im Zeitraum. */
export async function kandidaten(tenantId: string, firma: string | null, zahlung: { betrag: number; datum: string }) {
  const f = await firmaPruefen(tenantId, firma);
  const offen = await belegeOffen(tenantId, f, addDaysIso(zahlung.datum, -120), addDaysIso(zahlung.datum, 30));
  const b = Math.abs(zahlung.betrag);
  return offen
    .filter((x) => Math.abs(x.rest - b) <= b * 0.2 + 0.01)
    .sort((x, y) => Math.abs(x.rest - b) - Math.abs(y.rest - b))
    .slice(0, 8);
}

export type { Vorschlag };
