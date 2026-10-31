import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { AMPEL_REGELN } from "@/lib/deal-ampel/logic";
import { prozentText } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { historienRef, historienText, historienZeile, kanalName, TEST_KANAL_SQL as TEST_KANAL_RE } from "./historie-logic";

// B19.1/B20.2: Lugru-Deals ohne Eingang (History aus Lugru Deals bzw. Discord) in den Deal-Eingang nachtragen – neueste
// zuerst, ohne Zeitgrenze (B20.2: bis alle drin sind; Lugru-Eingänge fallen nicht unter die Aufbewahrungsfrist). Ampel
// nach den Regeln der Deal-Ampel aus den Zahlen des Posts und dem Keepa-Schnappschuss beim Posten: keine neuen
// Keepa-Abfragen, kein Push, keine Meldung. Testkanäle („test“, „test1“) bleiben draußen.

const L = schema.lugruDealsHistorie;
const E = schema.dealEingaenge;

/** Name des Hintergrund-Jobs (Scheduler und Knopf „Jetzt nachtragen“ protokollieren unter diesem Namen). */
export const NACHTRAG_JOB = "Lugru Deals: History → Deal-Eingang";

/** Zählbasis aller Lugru-Zahlen (B20.2): Deals im Deal-Eingang mit Ampel. */
export const ZAEHLBASIS = "Deals im Deal-Eingang mit Ampel";

export type HistorieLauf = { neu: number; verknuepft: number; offen: number };

export async function lugruHistorieEingaenge(tenantId: string, max = 200, jetzt = new Date()): Promise<HistorieLauf> {
  const s = await getSettings(tenantId);
  // Frische Deals (≤ 2 Std.) macht der Live-Weg mit voller Prüfung und Push.
  const bis = new Date(jetzt.getTime() - 2 * 3600_000);
  const offenWo = and(eq(L.tenantId, tenantId), isNull(L.eingangId), lte(L.gepostetAm, bis), sql`coalesce(btrim(${L.kanal}), '') !~* ${TEST_KANAL_RE}`);
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
        `Laut Lugru Deals: EK ${r.ekEur ?? "–"} € ${r.ekNetto === true ? "netto" : r.ekNetto === false ? "brutto" : "(netto/brutto unklar)"} · VK ${r.vkEur ?? "–"} €${r.zielmarkt ? ` (${r.zielmarkt})` : ""}${r.gewinnEur !== null ? ` · Gewinn ${r.gewinnEur} €` : ""}${r.margeProzent !== null ? ` · Marge ${prozentText(r.margeProzent)} %` : ""}${r.verkaeufeMonat ? ` · ${r.verkaeufeMonat}+ Verkäufe/Monat` : ""}`,
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

/**
 * B20.2: Historie-Eingänge, deren Ampel noch nach alten Regeln berechnet wurde, neu bewerten (gleiche Zahlen aus Post
 * und Keepa-Stand beim Posten). Entscheidung, Deal-Wert und Status bleiben; nur Ampel, Gründe und Kurztext ändern sich.
 */
export async function lugruHistorieNeuBewerten(tenantId: string, max = 500, jetzt = new Date()): Promise<{ neu: number; offen: number }> {
  const s = await getSettings(tenantId);
  const alt = and(eq(E.tenantId, tenantId), eq(E.weg, "lugru"), eq(E.historisch, true), sql`coalesce((${E.zeilen}->0->>'regeln')::int, 1) < ${AMPEL_REGELN}`);
  const rows = await db
    .select({ e: { id: E.id, zeilen: E.zeilen }, l: L })
    .from(E)
    .innerJoin(L, and(eq(L.tenantId, E.tenantId), eq(L.eingangId, E.id)))
    .where(alt)
    .limit(Math.max(1, Math.min(2000, max)));
  const pauschal = { provision: s.pricing.referralRate, fba: s.pricing.defaultFbaFee };
  let neu = 0;
  for (const { e, l } of rows) {
    const z = historienZeile({ ...l, kanal: kanalName(l.kanal) ?? "deals" }, s.dealAmpel, { pauschal, zielRoi: s.dealEingang.zielRoi, jetzt });
    const vorher = e.zeilen[0];
    const zeile = { ...z, wert: vorher?.wert ?? z.wert, merkmale: vorher?.merkmale ?? z.merkmale };
    await db.update(E).set({ ampel: zeile.ampel, zeilen: [zeile, ...e.zeilen.slice(1)], zusammenfassung: historienText(zeile) }).where(and(eq(E.tenantId, tenantId), eq(E.id, e.id)));
    await db.update(L).set({ ampel: zeile.ampel }).where(and(eq(L.tenantId, tenantId), eq(L.id, l.id)));
    neu++;
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(E).where(alt);
  return { neu, offen: n };
}

export type LugruZaehlung = { gepostet: number; basis: number; gruen: number; gelb: number; rot: number; anteilGruen: number | null };

/**
 * Eine Zählbasis für alle Lugru-Zahlen (B20.2): Deals im Deal-Eingang mit Ampel – Lugru-Seite, Kachel „Anteil grün“,
 * Trefferquote je Quelle, Deal-Eingang-Liste und Werkzeuge. „gepostet“ = alle Posts im selben Filter (ohne Testkanäle).
 */
export async function lugruZaehlung(tenantId: string, o: { von?: Date | null; bis?: Date | null; mitTest?: boolean } = {}): Promise<LugruZaehlung> {
  const w: SQL[] = [eq(L.tenantId, tenantId)];
  if (!o.mitTest) w.push(sql`coalesce(btrim(${L.kanal}), '') !~* ${TEST_KANAL_RE}`);
  if (o.von) w.push(gte(L.gepostetAm, o.von));
  if (o.bis) w.push(lte(L.gepostetAm, o.bis));
  const ampel = sql`coalesce(${L.ampel}, ${E.ampel})`;
  const imBasis = sql`${E.id} is not null and ${ampel} is not null`;
  const [z] = await db
    .select({
      gepostet: sql<number>`count(*)::int`,
      basis: sql<number>`count(*) filter (where ${imBasis})::int`,
      gruen: sql<number>`count(*) filter (where ${imBasis} and ${ampel} = 'gruen')::int`,
      gelb: sql<number>`count(*) filter (where ${imBasis} and ${ampel} = 'gelb')::int`,
      rot: sql<number>`count(*) filter (where ${imBasis} and ${ampel} = 'rot')::int`,
    })
    .from(L)
    .leftJoin(E, and(eq(E.tenantId, L.tenantId), eq(E.id, L.eingangId)))
    .where(and(...w));
  const basis = z?.basis ?? 0;
  return { gepostet: z?.gepostet ?? 0, basis, gruen: z?.gruen ?? 0, gelb: z?.gelb ?? 0, rot: z?.rot ?? 0, anteilGruen: basis ? Math.round(((z?.gruen ?? 0) / basis) * 100) : null };
}

/** Fortschritt für Seite und Werkzeuge: x / gesamt im Deal-Eingang mit Ampel, Stand = letzter Lauf des Nachtrags. */
export async function lugruHistorieStand(tenantId: string) {
  const J = schema.jobRuns;
  const [z, [job], [{ alt }]] = await Promise.all([
    lugruZaehlung(tenantId),
    db.select({ ok: J.lastOkAt, fehlerAm: J.lastErrorAt, fehler: J.lastError }).from(J).where(and(eq(J.tenantId, tenantId), eq(J.name, NACHTRAG_JOB))),
    db.select({ alt: sql<number>`count(*)::int` }).from(E).where(and(eq(E.tenantId, tenantId), eq(E.weg, "lugru"), eq(E.historisch, true), sql`coalesce((${E.zeilen}->0->>'regeln')::int, 1) < ${AMPEL_REGELN}`)),
  ]);
  return {
    gesamt: z.gepostet,
    /** = mitAmpel (Zählbasis); alte Felder bleiben für Aufrufer gleich benannt. */
    imEingang: z.basis,
    mitAmpel: z.basis,
    gruen: z.gruen,
    gelb: z.gelb,
    rot: z.rot,
    anteilGruen: z.anteilGruen,
    /** Historie-Ampeln, die noch nach den alten Regeln stehen (werden im Hintergrund neu bewertet). */
    alteRegeln: alt,
    stand: job?.ok ?? null,
    fehler: job?.fehlerAm && (!job.ok || job.fehlerAm > job.ok) ? job.fehler : null,
  };
}
