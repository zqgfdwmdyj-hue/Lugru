import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIso } from "@/lib/dates";
import type { DealAnkauf } from "@/db/tables/deal-eingang";
import { ANKAUF_AUSGANG, ANKAUF_WISSEN, ankaufAktiv, ankaufCheckliste, ankaufFrist, ankaufLeer, ankaufWarnung, type AnkaufAusgang } from "./ankauf-logic";
import { DealEingangFehler } from "./service";

// B34.4/5 Ankauf als Ausstiegsweg am Deal: Felder speichern, beim Kauf Checkliste (Warnung, kein Stopp) und Aufgabe
// „Ankauf bestätigen“ mit Frist, Ausgang (angekauft / liegt / Verlust) → Lernschleife (B28.8). Keine Kauf-Bots, kein
// Mitlesen fremder Discord-Server; alles nur intern (Insider-Wissen), nie in Texten nach außen.

const E = schema.dealEingaenge;
const aufgabeKey = (id: string) => `ankauf-bestaetigen:${id}`;

async function deal(tenantId: string, id: string) {
  const [e] = await db.select().from(E).where(and(eq(E.tenantId, tenantId), eq(E.id, id)));
  if (!e) throw new DealEingangFehler("Eingang nicht gefunden.");
  return e;
}

/** Wissenseintrag „Ankaufserver“ (insider, Herkunft Call) einmal je Mandant anlegen. */
export async function ankaufWissenSicherstellen(tenantId: string) {
  const K = schema.knowledgeEntries;
  const [da] = await db.select({ id: K.id, body: K.body }).from(K).where(and(eq(K.tenantId, tenantId), eq(K.title, ANKAUF_WISSEN.title))).limit(1);
  if (da) {
    // Vom System angelegter Eintrag: neue Hinweise (z. B. „Einsteiger bekommen kaum Deals“) nachziehen.
    if (da.body !== ANKAUF_WISSEN.body) await db.update(K).set({ body: ANKAUF_WISSEN.body }).where(eq(K.id, da.id));
    return da.id;
  }
  const [neu] = await db
    .insert(K)
    .values({ tenantId, kind: "article", category: "Aus Calls", title: ANKAUF_WISSEN.title, body: ANKAUF_WISSEN.body, tags: ["ankauf", "ausstieg", "insider"], origin: "call", insider: true, quelleDatum: ANKAUF_WISSEN.quelleDatum, quelleWer: ANKAUF_WISSEN.quelleWer, erkenntnis: "erfahrung" })
    .returning({ id: K.id });
  return neu.id;
}

export async function ankaufWissenId(tenantId: string) {
  const K = schema.knowledgeEntries;
  const [da] = await db.select({ id: K.id }).from(K).where(and(eq(K.tenantId, tenantId), eq(K.title, ANKAUF_WISSEN.title))).limit(1);
  return da?.id ?? null;
}

/** Aufgabe „Ankauf bestätigen“ (einmal je Deal) – Frist: Annahmefrist bzw. in 2 Tagen; offene Punkte in den Notizen. */
async function aufgabeAnlegen(tenantId: string, e: typeof E.$inferSelect, a: DealAnkauf, menge: number | null) {
  const heute = todayIso();
  const z = e.zeilen.find((x) => x.nr === a.zeile) ?? e.zeilen.find((x) => x.asin) ?? null;
  const titel = (z?.titel ?? z?.angebot.name ?? z?.asin ?? "Deal").slice(0, 60);
  const offen = ankaufCheckliste(a, menge, heute).filter((p) => !p.ok);
  await db
    .insert(schema.tasks)
    .values({
      tenantId,
      title: `Ankauf bestätigen: ${titel}${menge ? ` (${menge} Stk${a.ankaeufer ? ` an ${a.ankaeufer}` : ""})` : a.ankaeufer ? ` (${a.ankaeufer})` : ""}`,
      notes: [`Ankaufspreis ${a.preis?.toFixed(2).replace(".", ",")} € netto je Stück.`, offen.length ? `Offen: ${offen.map((p) => `${p.punkt} – ${p.hinweis}`).join("; ")}.` : "Checkliste vollständig.", "Danach unter „Ausstieg“ den Ausgang eintragen (angekauft / liegt / Verlust)."].join(" "),
      dueDate: ankaufFrist(a, heute),
      priority: offen.some((p) => p.punkt.startsWith("Menge")) ? "critical" : "normal",
      category: "einkauf",
      systemKey: aufgabeKey(e.id),
      link: `/deal-eingang/${e.id}#ankauf`,
    })
    .onConflictDoNothing();
}

/** Felder des Ankaufs speichern (Ankaufspreis, Ankäufer, Legit-Check, Menge angemeldet, Annahmefrist, Zahlungsziel, Rückvergütung). */
export async function ankaufSpeichern(tenantId: string, id: string, f: Partial<Omit<DealAnkauf, "ausgang" | "ausgangAm" | "ausgangNotiz" | "geaendertAm">>): Promise<DealAnkauf> {
  const e = await deal(tenantId, id);
  if (f.preis !== undefined && f.preis !== null && !(f.preis > 0 && f.preis < 100_000)) throw new DealEingangFehler("Ankaufspreis unplausibel.");
  if (f.mengeAngemeldet !== undefined && f.mengeAngemeldet !== null && !(f.mengeAngemeldet >= 0 && f.mengeAngemeldet <= 100_000)) throw new DealEingangFehler("Angemeldete Menge unplausibel.");
  if (f.annahmefrist && !/^\d{4}-\d{2}-\d{2}$/.test(f.annahmefrist)) throw new DealEingangFehler("Annahmefrist bitte als Datum.");
  if (f.versandfrist && !/^\d{4}-\d{2}-\d{2}$/.test(f.versandfrist)) throw new DealEingangFehler("Versandfrist bitte als Datum.");
  if (f.ankauftBestaetigtAm && !/^\d{4}-\d{2}-\d{2}$/.test(f.ankauftBestaetigtAm)) throw new DealEingangFehler("„Kauft noch an“ bitte als Datum.");
  if (f.zeile !== undefined && f.zeile !== null && !e.zeilen.some((z) => z.nr === f.zeile)) throw new DealEingangFehler("Angebotszeile nicht gefunden.");
  const alt = e.ankauf ?? ankaufLeer();
  const neu: DealAnkauf = { ...alt, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)), geaendertAm: new Date().toISOString() };
  if (neu.zeile === null) neu.zeile = e.zeilen.find((z) => z.asin)?.nr ?? e.zeilen[0]?.nr ?? null;
  await db.update(E).set({ ankauf: neu }).where(eq(E.id, e.id));
  if (ankaufAktiv(neu)) {
    await ankaufWissenSicherstellen(tenantId).catch((x) => console.error("[Ankauf] Wissen:", x instanceof Error ? x.message : x));
    // Ankauf erst nach dem Kauf eingetragen → Aufgabe jetzt anlegen (sonst beim „Gekauft“).
    if (e.status === "gekauft" && e.gekauftAm && !neu.ausgang) await aufgabeAnlegen(tenantId, e, neu, e.gekauftMenge);
  }
  return neu;
}

/**
 * Beim „Gekauft“ (Knopf, Bestellmail, Claude, Sprache): ist der Deal ein Ankauf-Deal, Checkliste prüfen (Warnung,
 * kein Stopp) und die Aufgabe „Ankauf bestätigen“ anlegen. Rückgabe: Warntext oder Hinweis auf die Aufgabe.
 */
export async function ankaufNachKauf(tenantId: string, id: string, menge: number): Promise<string | null> {
  const e = await deal(tenantId, id);
  if (!ankaufAktiv(e.ankauf)) return null;
  await aufgabeAnlegen(tenantId, e, e.ankauf, menge);
  const warnung = ankaufWarnung(ankaufCheckliste(e.ankauf, menge, todayIso()));
  const frist = ankaufFrist(e.ankauf, todayIso());
  return `${warnung ? `${warnung} ` : ""}Aufgabe „Ankauf bestätigen“ bis ${frist.split("-").reverse().join(".")} angelegt.`;
}

/**
 * Ausgang des Ankaufs: angekauft / liegt / Verlust. Erledigt die Aufgabe; „liegt“ und „Verlust“ kommen als Frage in die
 * Lernschleife (Nie wieder / Pech / Weiß nicht warum) und fließen so als ähnlicher Fehlkauf in den Deal-Wert.
 */
export async function ankaufAusgangSetzen(tenantId: string, id: string, ausgang: AnkaufAusgang, notiz: string | null): Promise<string> {
  const e = await deal(tenantId, id);
  if (!ankaufAktiv(e.ankauf)) throw new DealEingangFehler("Erst den Ankaufspreis eintragen.");
  const a: DealAnkauf = { ...e.ankauf, ausgang, ausgangAm: todayIso(), ausgangNotiz: notiz?.trim().slice(0, 500) || null, geaendertAm: new Date().toISOString() };
  await db.update(E).set({ ankauf: a }).where(eq(E.id, e.id));
  await db.update(schema.tasks).set({ status: "done" }).where(and(eq(schema.tasks.tenantId, tenantId), eq(schema.tasks.systemKey, aufgabeKey(e.id)), eq(schema.tasks.status, "open")));
  if (ausgang === "angekauft") return "Ausgang gespeichert: angekauft – Aufgabe erledigt.";
  const z = e.zeilen.find((x) => x.nr === a.zeile) ?? e.zeilen.find((x) => x.asin) ?? null;
  const ek = e.gekauftPreis ?? z?.ekNetto ?? null;
  const menge = e.gekauftMenge ?? a.mengeAngemeldet ?? null;
  const L = schema.lernschleifeFragen;
  await db
    .insert(L)
    .values({
      tenantId,
      monat: todayIso().slice(0, 7),
      schluessel: `ANKAUF|${e.id}`,
      asin: z?.asin ?? null,
      skus: [],
      titel: z?.titel ?? z?.angebot.name ?? null,
      units: menge,
      gewinn: ausgang === "verlust" && ek !== null && menge ? -Math.round(ek * menge * 100) / 100 : null,
      marke: z?.merkmale?.marke ?? null,
      kategorie: z?.merkmale?.kategorie ?? null,
      quelle: e.quelle,
      angebote: z?.merkmale?.angeboteMinLand ?? null,
      letzterEinkauf: e.gekauftAm?.toISOString().slice(0, 10) ?? null,
      gruende: [`Ankauf: ${ANKAUF_AUSGANG[ausgang]}`],
      freitext: a.ausgangNotiz,
    })
    .onConflictDoNothing();
  return `Ausgang gespeichert: ${ANKAUF_AUSGANG[ausgang]} – Aufgabe erledigt, Frage in der Lernschleife (Deal-Eingang → Lernen).`;
}
