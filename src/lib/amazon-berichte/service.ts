import "server-only";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysIso, todayIso } from "@/lib/dates";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { entfernungBald, gebuehrArt, gebundenesKapital, GEBUEHR_TEXT, kontoBewerten, leseKontozustand, weitereJeMonat, type GebuehrArt, type GesperrtZeile, type GestrandetZeile, type KontoMarkt, type KontoStufe, type ZusatzZeile } from "./logic";

// Amazon-Berichte 1–4: speichern, bewerten, Aufgaben (Fall-Zentrale-Frühwarnung, gebundenes Kapital) und Übersicht
// für Fall-Zentrale, Kapital-Ampel, Verlust-Stopp und Claude. Kein Bericht verändert Bestand oder Preise.

const KZ = schema.amazonKontozustand;
const GS = schema.amazonGestrandet;
const ZG = schema.amazonZusatzgebuehren;
const r2 = (n: number) => Math.round(n * 100) / 100;
const eur = (n: number) => `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const RANG: Record<KontoStufe, number> = { gut: 0, warnung: 1, kritisch: 2 };

async function landVon(mp: string): Promise<string | null> {
  const { landVonId } = await import("@/lib/amazon-markt/logic");
  return mp ? (landVonId(mp) ?? null) : null;
}

// ---- 1. Kontozustand ------------------------------------------------------------------------------------------

/** Leistungsbericht übernehmen: je Marktplatz eine Zeile, Bewertung gegen den letzten Stand, Aufgabe bei Warnung. */
export async function kontozustandSpeichern(tenantId: string, bytes: Uint8Array): Promise<{ maerkte: number; stufe: KontoStufe; gruende: string[] }> {
  const json = JSON.parse(new TextDecoder("utf-8").decode(bytes)) as unknown;
  const maerkte = leseKontozustand(json);
  let gesamt: KontoStufe = "gut";
  const gruende: string[] = [];
  for (const m of maerkte) {
    const [alt] = await db.select().from(KZ).where(and(eq(KZ.tenantId, tenantId), eq(KZ.marktplatz, m.marktplatz))).orderBy(desc(KZ.abgerufenAm)).limit(1);
    const altM: KontoMarkt | null = alt ? { marktplatz: alt.marktplatz, ahrStatus: alt.ahrStatus, ahrScore: alt.ahrScore, werte: alt.werte, verstoesse: alt.verstoesse } : null;
    const b = kontoBewerten(m, altM);
    const land = await landVon(m.marktplatz);
    await db.insert(KZ).values({ tenantId, marktplatz: m.marktplatz, land, ahrStatus: m.ahrStatus, ahrScore: m.ahrScore, werte: m.werte, verstoesse: m.verstoesse, stufe: b.stufe, gruende: b.gruende });
    if (RANG[b.stufe] > RANG[gesamt]) gesamt = b.stufe;
    gruende.push(...b.gruende.map((g) => `${land ?? m.marktplatz}: ${g}`));
  }
  if (gesamt === "gut") await resolveSystemTask(db, tenantId, "amazon-kontozustand");
  else
    await upsertSystemTask(db, tenantId, "amazon-kontozustand", {
      title: `Amazon-Kontozustand ${gesamt === "kritisch" ? "gefährdet" : "prüfen"}: ${gruende.slice(0, 2).join(" · ")}`.slice(0, 280),
      notes: `${gruende.join("\n")}\n\nSeller Central → Leistung → Kontozustand. Details in der Fall-Zentrale.`,
      priority: gesamt === "kritisch" ? "critical" : "normal",
      category: "amazon",
      link: "/amazon-faelle#kontozustand",
    });
  return { maerkte: maerkte.length, stufe: gesamt, gruende };
}

/** Letzter Stand je Marktplatz. */
export async function kontozustandAktuell(tenantId: string) {
  const rows = await db
    .select()
    .from(KZ)
    .where(and(eq(KZ.tenantId, tenantId), sql`${KZ.abgerufenAm} = (select max(k2.abgerufen_am) from amazon_kontozustand k2 where k2.tenant_id = ${KZ.tenantId} and k2.marktplatz = ${KZ.marktplatz})`))
    .orderBy(KZ.land);
  const stufe = rows.reduce<KontoStufe>((s, r) => (RANG[r.stufe] > RANG[s] ? r.stufe : s), "gut");
  return { maerkte: rows, stufe: rows.length ? stufe : null, abgerufen: rows.length ? new Date(Math.max(...rows.map((r) => r.abgerufenAm.getTime()))) : null };
}

// ---- 2. Gestrandet + gesperrt ---------------------------------------------------------------------------------

/** Bericht ersetzt den Stand der Art (Amazon liefert immer die vollständige Liste). */
export async function gestrandetSpeichern(tenantId: string, art: "gestrandet" | "gesperrt", zeilen: (GestrandetZeile | GesperrtZeile)[]): Promise<number> {
  const jetzt = new Date();
  const uniq = [...new Map(zeilen.map((z) => [z.sku, z])).values()];
  await db.transaction(async (tx) => {
    await tx.delete(GS).where(and(eq(GS.tenantId, tenantId), eq(GS.art, art)));
    for (let i = 0; i < uniq.length; i += 400)
      await tx.insert(GS).values(
        uniq.slice(i, i + 400).map((z) => ({
          tenantId,
          art,
          sku: z.sku,
          asin: z.asin,
          fnsku: "fnsku" in z ? z.fnsku : null,
          titel: z.titel,
          status: "status" in z ? z.status : null,
          grund: z.grund,
          seit: z.seit,
          autoEntfernung: "autoEntfernung" in z ? z.autoEntfernung : null,
          menge: "menge" in z ? z.menge : 0,
          preis: "preis" in z ? z.preis : null,
          aktion: "aktion" in z ? z.aktion : null,
          abgerufenAm: jetzt,
        })),
      );
  });
  await gestrandetAufgaben(tenantId);
  return uniq.length;
}

export async function gestrandetUebersicht(tenantId: string, heute = todayIso()) {
  const rows = await db.select().from(GS).where(eq(GS.tenantId, tenantId)).orderBy(desc(GS.menge));
  const { skuCostMap } = await import("@/lib/money/costs");
  const kosten = await skuCostMap(tenantId);
  const ek = new Map([...kosten].map(([sku, c]) => [sku, c.cost]));
  const teil = (art: "gestrandet" | "gesperrt") => {
    const z = rows.filter((r) => r.art === art);
    const k = gebundenesKapital(z, ek);
    return {
      anzahl: z.length,
      stueck: k.stueck,
      gebunden: k.summe,
      ohne_ek: k.ohneEk,
      entfernung_bald: z.filter((r) => entfernungBald(r.autoEntfernung, heute)).length,
      abgerufen: z.length ? new Date(Math.max(...z.map((r) => r.abgerufenAm.getTime()))) : null,
      zeilen: z.slice(0, 50).map((r) => ({ sku: r.sku, asin: r.asin, titel: r.titel, grund: r.grund, status: r.status, seit: r.seit, auto_entfernung: r.autoEntfernung, menge: r.menge, gebunden: ek.get(r.sku) ? r2((ek.get(r.sku) ?? 0) * r.menge) : null, aktion: r.aktion })),
    };
  };
  return { gestrandet: teil("gestrandet"), gesperrt: teil("gesperrt") };
}

/** Aufgaben: gebundenes Kapital (dringend, wenn Amazon bald automatisch entfernt) und gesperrte Angebote. */
export async function gestrandetAufgaben(tenantId: string) {
  const u = await gestrandetUebersicht(tenantId);
  const g = u.gestrandet;
  if (!g.anzahl) await resolveSystemTask(db, tenantId, "amazon-gestrandet");
  else
    await upsertSystemTask(db, tenantId, "amazon-gestrandet", {
      title: `Gestrandeter Bestand bei Amazon: ${g.anzahl} SKU${g.anzahl === 1 ? "" : "s"}, ${g.stueck} Stück${g.gebunden ? `, ${eur(g.gebunden)} gebunden` : ""}${g.entfernung_bald ? ` – ${g.entfernung_bald} bald automatisch entfernt` : ""}`.slice(0, 280),
      notes: `Ware liegt bei Amazon, ist aber nicht verkäuflich (kein aktives Angebot).\n${g.zeilen.slice(0, 15).map((z) => `${z.sku}: ${z.menge} Stk – ${z.grund ?? "ohne Grund"}${z.auto_entfernung ? ` (Entfernung ab ${z.auto_entfernung})` : ""}`).join("\n")}\n\nSeller Central → Bestand → Bestandsplanung → Gestrandeter Bestand.`,
      priority: g.entfernung_bald ? "critical" : "normal",
      category: "amazon",
      link: "/amazon-faelle#gestrandet",
    });
  const s = u.gesperrt;
  if (!s.anzahl) await resolveSystemTask(db, tenantId, "amazon-gesperrt");
  else
    await upsertSystemTask(db, tenantId, "amazon-gesperrt", {
      title: `Gesperrte Angebote bei Amazon: ${s.anzahl} SKU${s.anzahl === 1 ? "" : "s"}`,
      notes: `${s.zeilen.slice(0, 15).map((z) => `${z.sku}: ${z.grund ?? z.status ?? "ohne Grund"}`).join("\n")}\n\nSeller Central → Bestand → Angebote verbessern → Unterdrückt.`,
      priority: "normal",
      category: "amazon",
      link: "/amazon-faelle#gestrandet",
    });
}

// ---- 4. Weitere Gebühren --------------------------------------------------------------------------------------

export async function zusatzSpeichern(tenantId: string, zeilen: ZusatzZeile[]): Promise<number> {
  let neu = 0;
  for (let i = 0; i < zeilen.length; i += 400) {
    const res = await db
      .insert(ZG)
      .values(zeilen.slice(i, i + 400).map((z) => ({ tenantId, ...z })))
      .onConflictDoUpdate({ target: [ZG.tenantId, ZG.rowKey], set: { betrag: sql`excluded.betrag`, menge: sql`excluded.menge`, text: sql`excluded.text` } })
      .returning({ neu: sql<boolean>`(xmax = 0)` });
    neu += res.filter((r) => r.neu).length;
  }
  return neu;
}

/**
 * Weitere Gebühren je Monat (letzte `monate` Monate): Langzeitlager und Inbound-Mängel aus den Berichten, sonst aus
 * dem Transaktionsbericht; Lagerlimit/Lagerauslastung und Inbound-Platzierung nur aus den Transaktionen.
 */
export async function weitereGebuehren(tenantId: string, monate = 3, heute = todayIso()) {
  const ab = `${addDaysIso(`${heute.slice(0, 7)}-01`, -31 * (monate - 1)).slice(0, 7)}-01`;
  const T = schema.amazonTransactions;
  const [bericht, tx] = await Promise.all([
    db.select({ art: ZG.art, monat: ZG.monat, betrag: sql<number>`sum(${ZG.betrag})::float` }).from(ZG).where(and(eq(ZG.tenantId, tenantId), gte(ZG.monat, ab.slice(0, 7)))).groupBy(ZG.art, ZG.monat),
    db.select({ date: T.date, type: T.type, description: T.description, total: T.total }).from(T).where(and(eq(T.tenantId, tenantId), gte(T.date, ab))),
  ]);
  const ausTx: { art: GebuehrArt; monat: string; betrag: number }[] = [];
  for (const t of tx) {
    const art = gebuehrArt(`${t.type ?? ""} ${t.description ?? ""}`);
    if (art && t.date && t.total !== null) ausTx.push({ art, monat: t.date.slice(0, 7), betrag: t.total });
  }
  const zeilen = weitereJeMonat(bericht.map((b) => ({ art: b.art as GebuehrArt, monat: b.monat, betrag: b.betrag })), ausTx);
  const summe = (art: GebuehrArt) => r2(zeilen.filter((z) => z.art === art).reduce((n, z) => n + z.betrag, 0));
  return {
    ab: ab.slice(0, 7),
    je_art: (Object.keys(GEBUEHR_TEXT) as GebuehrArt[]).map((art) => ({ art, text: GEBUEHR_TEXT[art], summe: summe(art) })),
    gesamt: r2(zeilen.reduce((n, z) => n + z.betrag, 0)),
    zeilen,
  };
}

/** Langzeit-Lagergebühr des letzten Monats je ASIN (für Kapital-Ampel/Lagerkosten). */
export async function langzeitJeAsin(tenantId: string, asins?: string[]): Promise<Map<string, { monat: string; betrag: number }>> {
  if (asins && !asins.length) return new Map();
  const [letzter] = await db.select({ monat: sql<string | null>`max(${ZG.monat})` }).from(ZG).where(and(eq(ZG.tenantId, tenantId), eq(ZG.art, "langzeitlager")));
  if (!letzter?.monat) return new Map();
  const rows = await db
    .select({ asin: ZG.asin, betrag: sql<number>`sum(${ZG.betrag})::float` })
    .from(ZG)
    .where(and(eq(ZG.tenantId, tenantId), eq(ZG.art, "langzeitlager"), eq(ZG.monat, letzter.monat), asins ? inArray(ZG.asin, asins) : sql`${ZG.asin} is not null`))
    .groupBy(ZG.asin);
  return new Map(rows.filter((r) => r.asin).map((r) => [r.asin!, { monat: letzter.monat!, betrag: r2(r.betrag) }]));
}

// ---- 3. Umsatzsteuer-Transaktionsbericht per Schnittstelle ----------------------------------------------------

/** VAT-Transaktionsbericht direkt von Amazon → Buchhaltung (ersetzt hochgeladene Dateien desselben Monats). */
export async function ustVonSchnittstelle(tenantId: string, bytes: Uint8Array) {
  const M = schema.memberships;
  const [inh] = await db.select({ userId: M.userId }).from(M).where(and(eq(M.tenantId, tenantId), eq(M.role, "owner"), isNull(M.deaktiviertAm))).limit(1);
  const { ustBerichtImportieren } = await import("@/lib/buchhaltung/service");
  return ustBerichtImportieren({ tenantId, userId: inh?.userId ?? "", name: "Amazon-Schnittstelle" }, null, { name: "SP-API GET_VAT_TRANSACTION_DATA", bytes }, { quelle: "api" });
}

// ---- Übersicht ------------------------------------------------------------------------------------------------

/** Für Fall-Zentrale und Claude: Kontozustand, gestrandet/gesperrt, weitere Gebühren. */
export async function kontoBerichte(tenantId: string) {
  const [k, g, w] = await Promise.all([kontozustandAktuell(tenantId), gestrandetUebersicht(tenantId), weitereGebuehren(tenantId)]);
  return {
    kontozustand: {
      stufe: k.stufe,
      abgerufen: k.abgerufen?.toISOString() ?? null,
      maerkte: k.maerkte.map((m) => ({ land: m.land ?? m.marktplatz, status: m.ahrStatus, wert: m.ahrScore, stufe: m.stufe, gruende: m.gruende, verstoesse: m.verstoesse.filter((v) => v.anzahl > 0) })),
    },
    ...g,
    weitere_gebuehren: w,
  };
}
