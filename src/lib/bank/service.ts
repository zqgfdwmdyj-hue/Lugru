import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysIso } from "@/lib/dates";
import { erkenneWiederkehrend, gruppeVon, leseKontoauszug, saldoAm, type Auszug, type Wiederkehrend } from "./logic";
import { leseKontoauszugPdfText, type PdfAuszug } from "./pdf";

/** CSV, CAMT oder PDF (Text-PDF, z. B. Sparkasse-Kontoauszug). Scans ohne Text werden abgelehnt. */
export async function kontoauszugLesen(bytes: Uint8Array): Promise<Auszug & Partial<Pick<PdfAuszug, "anfang" | "ende" | "kontrolle" | "unsicher">>> {
  const istPdf = bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (!istPdf) return leseKontoauszug(bytes);
  const { extractText, getDocumentProxy } = await import("unpdf");
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
  if (!text.trim()) throw new Error("Das PDF enthält keinen Text (Scan) – bitte den Kontoauszug als PDF aus dem Online-Banking oder den CSV-Export verwenden.");
  const a = leseKontoauszugPdfText(text);
  if (!a.umsaetze.length && !a.salden.length) throw new Error("Im PDF wurden keine Buchungen erkannt – ist das ein Kontoauszug? Sonst bitte den CSV-Export verwenden.");
  return a;
}

// Kontoauszüge speichern und auswerten. Geschäft und Privat strikt getrennt (bereich); Privat zusätzlich je Person.

const U = schema.bankUmsaetze;
const S = schema.bankSalden;
type Bereich = "geschaeft" | "privat";
const wer = (bereich: Bereich, userId: string | null) => (bereich === "privat" ? eq(U.userId, userId ?? "00000000-0000-0000-0000-000000000000") : isNull(U.userId));
const werSaldo = (bereich: Bereich, userId: string | null) => (bereich === "privat" ? eq(S.userId, userId ?? "00000000-0000-0000-0000-000000000000") : isNull(S.userId));

export async function kontoauszugImportieren(tenantId: string, bereich: Bereich, userId: string | null, bytes: Uint8Array, o: { saldoBank?: number | null; firma?: string | null } = {}) {
  const a = await kontoauszugLesen(bytes);
  // PDF: Buchungen, die schon aus einem CSV-Export da sind (gleicher Tag + Betrag), nicht doppelt anlegen.
  if (a.format === "pdf" && a.umsaetze.length) {
    const tage = a.umsaetze.map((u) => u.buchungstag).sort();
    const da = await db
      .select({ tag: U.buchungstag, betrag: U.betrag, schluessel: U.schluessel })
      .from(U)
      .where(and(eq(U.tenantId, tenantId), eq(U.bereich, bereich), wer(bereich, userId), gte(U.buchungstag, tage[0]), sql`${U.buchungstag} <= ${tage[tage.length - 1]}`));
    const eigene = new Set(a.umsaetze.map((u) => u.schluessel));
    const frei = new Map<string, number>();
    for (const x of da) if (!eigene.has(x.schluessel)) frei.set(`${x.tag}|${x.betrag.toFixed(2)}`, (frei.get(`${x.tag}|${x.betrag.toFixed(2)}`) ?? 0) + 1);
    a.umsaetze = a.umsaetze.filter((u) => {
      const k = `${u.buchungstag}|${u.betrag.toFixed(2)}`;
      const n = frei.get(k) ?? 0;
      if (n > 0) frei.set(k, n - 1);
      return n === 0;
    });
  }
  if (!a.umsaetze.length && !a.salden.length) return { neu: 0, doppelt: 0, von: null as string | null, bis: null as string | null, salden: 0, format: a.format, summe: 0, konto: a.konto, endsaldo: null as { datum: string; saldo: number } | null, kontrolle: a.kontrolle ?? null, unsicher: a.unsicher ?? 0, anfangPdf: a.anfang ?? null };
  const werte = a.umsaetze.map((u) => ({
    tenantId,
    bereich,
    userId: bereich === "privat" ? userId : null,
    schluessel: u.schluessel,
    konto: u.konto ?? a.konto,
    buchungstag: u.buchungstag,
    valuta: u.valuta,
    betrag: u.betrag,
    waehrung: u.waehrung,
    gegenpartei: u.gegenpartei,
    zweck: u.zweck.slice(0, 1000),
    gegenIban: u.iban,
    firma: bereich === "geschaeft" ? (o.firma ?? null) : null,
    buchungstext: u.buchungstext,
    glaeubigerId: u.glaeubigerId,
    mandat: u.mandat,
    gruppe: createHash("sha256").update(gruppeVon(u)).digest("hex").slice(0, 32),
  }));
  let neu = 0;
  for (let i = 0; i < werte.length; i += 500) {
    const r = await db.insert(U).values(werte.slice(i, i + 500)).onConflictDoNothing().returning({ id: U.id });
    neu += r.length;
  }
  const tage = a.umsaetze.map((u) => u.buchungstag).sort();
  const salden = [...a.salden.map((s) => ({ ...s, quelle: a.format })), ...(o.saldoBank !== null && o.saldoBank !== undefined && tage.length ? [{ datum: tage[tage.length - 1], saldo: o.saldoBank, quelle: "hand" as const }] : [])];
  for (const s of salden) {
    const v = { tenantId, bereich, userId: bereich === "privat" ? userId : null, konto: a.konto ?? "", datum: s.datum, saldo: s.saldo, quelle: s.quelle };
    await db.insert(S).values(v).onConflictDoUpdate({ target: [S.tenantId, S.bereich, S.konto, S.datum], set: { saldo: s.saldo, quelle: s.quelle } });
  }
  const summe = Math.round(a.umsaetze.reduce((n, u) => n + u.betrag, 0) * 100) / 100;
  return { neu, doppelt: werte.length - neu, von: tage[0] ?? null, bis: tage[tage.length - 1] ?? null, salden: salden.length, format: a.format, summe, konto: a.konto, endsaldo: salden.sort((x, y) => y.datum.localeCompare(x.datum))[0] ?? null, kontrolle: a.kontrolle ?? null, unsicher: a.unsicher ?? 0, anfangPdf: a.anfang ?? null };
}

const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;
/** Rückmeldung nach dem Einlesen – mit Saldo-Kontrolle beim PDF. */
export function importMeldung(r: Awaited<ReturnType<typeof kontoauszugImportieren>>): string {
  const teile = [`${r.neu} neue Buchungen${r.doppelt ? `, ${r.doppelt} schon vorhanden` : ""}${r.von ? ` (${r.von.split("-").reverse().join(".")} bis ${r.bis!.split("-").reverse().join(".")})` : ""}`];
  if (r.format === "pdf" && r.kontrolle) {
    if (r.kontrolle.differenz === null) teile.push("PDF ohne Anfangs-/Endsaldo – Kontrolle nicht möglich");
    else if (Math.abs(r.kontrolle.differenz) < 0.01) teile.push(`Saldo-Kontrolle passt${r.endsaldo ? ` (Endsaldo ${eur(r.endsaldo.saldo)})` : ""}`);
    else teile.push(`Achtung: Saldo-Kontrolle weicht um ${eur(r.kontrolle.differenz)} ab – bitte Buchungen prüfen oder den CSV-Export nehmen`);
    if (r.unsicher) teile.push(`${r.unsicher} Buchung${r.unsicher === 1 ? "" : "en"} ohne erkennbares Vorzeichen`);
  } else if (r.salden) teile.push("Kontostand übernommen");
  else if (r.format === "csv") teile.push("ohne Kontostand: bitte „Kontostand laut Bank“ mit angeben");
  return `${teile.join(" · ")}.`;
}

/** Aktueller Kontostand: jüngster bekannter Saldo + spätere Umsätze (je Konto summiert). */
export async function kontostand(tenantId: string, bereich: Bereich, userId: string | null, heute: string): Promise<{ saldo: number; stand: string; konten: number } | null> {
  const anker = await db.select().from(S).where(and(eq(S.tenantId, tenantId), eq(S.bereich, bereich), werSaldo(bereich, userId))).orderBy(desc(S.datum));
  if (!anker.length) return null;
  const jeKonto = new Map<string, (typeof anker)[number]>();
  for (const a of anker) if (!jeKonto.has(a.konto)) jeKonto.set(a.konto, a);
  let summe = 0;
  let stand = "";
  for (const a of jeKonto.values()) {
    const spaeter = await db
      .select({ buchungstag: U.buchungstag, betrag: U.betrag })
      .from(U)
      .where(and(eq(U.tenantId, tenantId), eq(U.bereich, bereich), wer(bereich, userId), sql`coalesce(${U.konto}, '') = ${a.konto}`, sql`${U.buchungstag} > ${a.datum}`));
    summe += saldoAm({ datum: a.datum, saldo: a.saldo }, spaeter, heute) ?? 0;
    const letzter = spaeter.reduce((m, u) => (u.buchungstag > m ? u.buchungstag : m), a.datum);
    if (letzter > stand) stand = letzter;
  }
  return { saldo: Math.round(summe * 100) / 100, stand, konten: jeKonto.size };
}

export async function umsaetzeSeit(tenantId: string, bereich: Bereich, userId: string | null, seit: string) {
  return db
    .select({ id: U.id, buchungstag: U.buchungstag, betrag: U.betrag, gegenpartei: U.gegenpartei, zweck: U.zweck, glaeubigerId: U.glaeubigerId, mandat: U.mandat, iban: sql<string | null>`null`, gruppe: U.gruppe, kategorie: U.kategorie, konto: U.konto })
    .from(U)
    .where(and(eq(U.tenantId, tenantId), eq(U.bereich, bereich), wer(bereich, userId), gte(U.buchungstag, seit)))
    .orderBy(desc(U.buchungstag));
}

/** Wiederkehrende Abbuchungen der letzten 13 Monate (Fixkosten, Kreditkarte). */
export async function wiederkehrend(tenantId: string, bereich: Bereich, userId: string | null, heute: string): Promise<(Wiederkehrend & { gruppeHash: string })[]> {
  const u = await umsaetzeSeit(tenantId, bereich, userId, addDaysIso(heute, -400));
  const hash = (g: string) => createHash("sha256").update(g).digest("hex").slice(0, 32);
  return erkenneWiederkehrend(
    u.map((x) => ({ ...x, gegenpartei: x.gegenpartei ?? "", zweck: x.zweck ?? "" })),
    heute,
  ).map((w) => ({ ...w, gruppeHash: hash(w.gruppe) }));
}

export async function letzterImport(tenantId: string, bereich: Bereich, userId: string | null) {
  const [r] = await db.select({ am: sql<Date | null>`max(${U.createdAt})`, bis: sql<string | null>`max(${U.buchungstag})`, n: sql<number>`count(*)::int` }).from(U).where(and(eq(U.tenantId, tenantId), eq(U.bereich, bereich), wer(bereich, userId)));
  return r;
}
