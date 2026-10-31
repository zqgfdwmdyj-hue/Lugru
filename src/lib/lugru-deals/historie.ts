import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSettings } from "@/lib/settings";
import { historienRef, historienText, historienZeile, kanalName, TEST_KANAL_SQL as TEST_KANAL_RE } from "./historie-logic";

// B19.1: Lugru-Deals ohne Eingang (History aus Lugru Deals bzw. Discord) in den Deal-Eingang nachtragen – neueste
// zuerst (erst die letzten 90 Tage, dann rückwärts bis zur Aufbewahrungsfrist des Deal-Eingangs). Ampel nach den
// Regeln der Deal-Ampel aus den Zahlen des Posts und dem Keepa-Schnappschuss beim Posten: keine neuen Keepa-Abfragen,
// kein Push, keine Meldung. Testkanäle („test“, „test1“) bleiben draußen.

const L = schema.lugruDealsHistorie;
const E = schema.dealEingaenge;

export type HistorieLauf = { neu: number; verknuepft: number; offen: number };

export async function lugruHistorieEingaenge(tenantId: string, max = 200, jetzt = new Date()): Promise<HistorieLauf> {
  const s = await getSettings(tenantId);
  const grenze = new Date(jetzt);
  grenze.setMonth(grenze.getMonth() - s.dealEingang.aufbewahrungMonate);
  // Frische Deals (≤ 2 Std.) macht der Live-Weg mit voller Prüfung und Push.
  const bis = new Date(jetzt.getTime() - 2 * 3600_000);
  const offenWo = and(eq(L.tenantId, tenantId), isNull(L.eingangId), gte(L.gepostetAm, grenze), lte(L.gepostetAm, bis), sql`coalesce(btrim(${L.kanal}), '') !~* ${TEST_KANAL_RE}`);
  const rows = await db.select().from(L).where(offenWo).orderBy(desc(L.gepostetAm)).limit(Math.max(1, Math.min(1000, max)));
  const lauf: HistorieLauf = { neu: 0, verknuepft: 0, offen: 0 };
  if (rows.length) {
    const refs = rows.map((r) => historienRef(r));
    const schon = new Map((await db.select({ id: E.id, ref: E.quelleRef, ampel: E.ampel }).from(E).where(and(eq(E.tenantId, tenantId), inArray(E.quelleRef, refs)))).map((e) => [e.ref!, e]));
    const pauschal = { provision: s.pricing.referralRate, fba: s.pricing.defaultFbaFee };
    for (const r of rows) {
      const ref = historienRef(r);
      const da = schon.get(ref);
      if (da) {
        await db.update(L).set({ eingangId: da.id, ...(da.ampel ? { ampel: da.ampel } : {}) }).where(eq(L.id, r.id));
        lauf.verknuepft++;
        continue;
      }
      const kanal = kanalName(r.kanal) ?? "deals";
      const z = historienZeile({ ...r, kanal }, s.dealAmpel, { pauschal, zielRoi: s.dealEingang.zielRoi, jetzt });
      const text = [
        `Lugru Deals (#${kanal}) – aus der History nachgetragen (gepostet ${r.gepostetAm.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })})${r.shop ? ` · Shop: ${r.shop}` : ""}`,
        r.titel?.trim() || null,
        `Laut Lugru Deals: EK ${r.ekEur ?? "–"} € ${r.ekNetto === true ? "netto" : r.ekNetto === false ? "brutto" : "(netto/brutto unklar)"} · VK ${r.vkEur ?? "–"} €${r.zielmarkt ? ` (${r.zielmarkt})` : ""}${r.gewinnEur !== null ? ` · Gewinn ${r.gewinnEur} €` : ""}${r.margeProzent !== null ? ` · Marge ${r.margeProzent} %` : ""}${r.verkaeufeMonat ? ` · ${r.verkaeufeMonat}+ Verkäufe/Monat` : ""}`,
        `ASIN ${r.asin}`,
        r.shopUrl ? `Einkauf: ${r.shopUrl}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      const [neu] = await db
        .insert(E)
        .values({
          tenantId,
          userId: null,
          weg: "lugru",
          quelleRef: ref,
          angebote: [z.angebot],
          quelle: `Lugru Deals · #${kanal}`.slice(0, 80),
          rohtext: text,
          inhaltKennung: createHash("sha256").update(`lugru-historie:${ref}`).digest("hex"),
          pruefung: "fertig",
          status: r.gekauftErkannt ? "gekauft" : "neu",
          grund: r.gekauftErkannt ? `Kauf automatisch erkannt (${r.gekauftErkanntRef ?? "Bestellung"})`.slice(0, 300) : null,
          ampel: z.ampel,
          zusammenfassung: historienText(z),
          zeilen: [z],
          ohneKi: true,
          geprueftAm: jetzt,
          historisch: true,
          createdAt: r.gepostetAm,
        })
        .onConflictDoNothing({ target: [E.tenantId, E.quelleRef] })
        .returning({ id: E.id });
      const id = neu?.id ?? (await db.select({ id: E.id }).from(E).where(and(eq(E.tenantId, tenantId), eq(E.quelleRef, ref))))[0]?.id;
      if (!id) continue;
      await db.update(L).set({ eingangId: id, ampel: z.ampel }).where(eq(L.id, r.id));
      if (neu) lauf.neu++;
      else lauf.verknuepft++;
    }
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(L).where(offenWo);
  lauf.offen = n;
  return lauf;
}

/** Fortschritt für Seite und Werkzeuge: wie viele Lugru-Deals schon im Deal-Eingang sind (ohne Testkanäle). */
export async function lugruHistorieStand(tenantId: string) {
  const [z] = await db
    .select({ gesamt: sql<number>`count(*)::int`, imEingang: sql<number>`count(${L.eingangId})::int`, mitAmpel: sql<number>`count(${L.ampel})::int` })
    .from(L)
    .where(and(eq(L.tenantId, tenantId), sql`coalesce(btrim(${L.kanal}), '') !~* ${TEST_KANAL_RE}`));
  return { gesamt: z?.gesamt ?? 0, imEingang: z?.imEingang ?? 0, mitAmpel: z?.mitAmpel ?? 0 };
}
