import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysIso } from "@/lib/dates";
import { erkenneWiederkehrend, gruppeVon, leseKontoauszug, saldoAm, type Wiederkehrend } from "./logic";

// Kontoauszüge speichern und auswerten. Geschäft und Privat strikt getrennt (bereich); Privat zusätzlich je Person.

const U = schema.bankUmsaetze;
const S = schema.bankSalden;
type Bereich = "geschaeft" | "privat";
const wer = (bereich: Bereich, userId: string | null) => (bereich === "privat" ? eq(U.userId, userId ?? "00000000-0000-0000-0000-000000000000") : isNull(U.userId));
const werSaldo = (bereich: Bereich, userId: string | null) => (bereich === "privat" ? eq(S.userId, userId ?? "00000000-0000-0000-0000-000000000000") : isNull(S.userId));

export async function kontoauszugImportieren(tenantId: string, bereich: Bereich, userId: string | null, bytes: Uint8Array, o: { saldoBank?: number | null; firma?: string | null } = {}) {
  const a = leseKontoauszug(bytes);
  if (!a.umsaetze.length && !a.salden.length) return { neu: 0, doppelt: 0, von: null as string | null, bis: null as string | null, salden: 0, format: a.format, summe: 0, konto: a.konto, endsaldo: null as { datum: string; saldo: number } | null };
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
  return { neu, doppelt: werte.length - neu, von: tage[0] ?? null, bis: tage[tage.length - 1] ?? null, salden: salden.length, format: a.format, summe, konto: a.konto, endsaldo: salden.sort((x, y) => y.datum.localeCompare(x.datum))[0] ?? null };
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
