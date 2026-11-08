import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIso } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { liquidationsName, type ExportLand } from "./export-logic";
import { istGebraucht, leiterPruefen, plusTage, schnelldreherEnde, schnelldreherKandidat, tageZwischen, ueberSeitFortschreiben, type LeiterStand, type Zustand } from "./leiter-logic";

// B31.6b/B31.7/B31.8: täglicher Lauf der Regel-Leiter (nach dem BQool-Ist, vor dem Soll). Alles sind Vorschläge;
// nach Freigabe steht die neue Soll-Regel (bzw. der Schnelldreher-Schutz) in der nächsten BQool-Datei (B31.2).

const V = schema.bqoolVorschlaege;
const P = schema.bqoolSkuPflege;
const LQ = schema.bqoolLiquidationen;
const TASK_ZUSTAND = "bqool-zustand-pruefen";
const TASK_LEITER = "bqool-leiter";

export type VorschlagArt = "stufe_1_2" | "stufe_1_3" | "stufe_2_3" | "stufe_2_1" | "schnelldreher" | "schnelldreher_ende" | "aktivieren" | "ebay";
export const VORSCHLAG_TEXT: Record<VorschlagArt, string> = {
  stufe_1_2: "Stufe 1 → 2 (Abverkauf)",
  stufe_1_3: "Stufe 1 → Liquidation (Brücke)",
  stufe_2_3: "Stufe 2 → 3 (Liquidation)",
  stufe_2_1: "Stufe 2 → 1 (Nachschub)",
  schnelldreher: "Schnelldreher-Schutz setzen",
  schnelldreher_ende: "Schnelldreher-Schutz endet",
  aktivieren: "pausiertes Angebot aktivieren",
  ebay: "gebraucht – auf eBay verkaufen?",
};

/** Offenen Vorschlag anlegen bzw. auffrischen; abgelehnte kommen 14 Tage nicht wieder, „später“ ruht bis zum Datum. */
async function vorschlagSetzen(tenantId: string, heute: string, v: { land: string; sku: string; art: VorschlagArt; vonRegel?: string | null; nachRegel?: string | null; min?: number | null; gruende: string[]; daten?: Record<string, unknown>; potenzial?: number | null }): Promise<boolean> {
  const alt = await db.select().from(V).where(and(eq(V.tenantId, tenantId), eq(V.land, v.land), eq(V.sku, v.sku), eq(V.art, v.art), inArray(V.status, ["offen", "spaeter", "abgelehnt"])));
  const offen = alt.find((a) => a.status === "offen" || a.status === "spaeter");
  const abgelehnt = alt.find((a) => a.status === "abgelehnt" && a.entschiedenAm && tageZwischen(a.entschiedenAm.toISOString().slice(0, 10), heute) < 14);
  if (abgelehnt && !offen) return false;
  const werte = { vonRegel: v.vonRegel ?? null, nachRegel: v.nachRegel ?? null, min: v.min ?? null, gruende: v.gruende, daten: v.daten ?? {}, potenzial: v.potenzial ?? null, updatedAt: new Date() };
  if (offen) {
    const status = offen.status === "spaeter" && offen.spaeterBis && offen.spaeterBis <= heute ? "offen" : offen.status;
    await db.update(V).set({ ...werte, status, spaeterBis: status === "offen" ? null : offen.spaeterBis }).where(eq(V.id, offen.id));
    return status === "offen";
  }
  await db.insert(V).values({ tenantId, land: v.land, sku: v.sku, art: v.art, ...werte });
  return true;
}

/** Offene Vorschläge einer Art, die heute nicht mehr zutreffen, als veraltet markieren. */
async function veraltenAusser(tenantId: string, arten: VorschlagArt[], aktuell: Set<string>) {
  const offen = await db.select({ id: V.id, land: V.land, sku: V.sku, art: V.art }).from(V).where(and(eq(V.tenantId, tenantId), inArray(V.art, arten), inArray(V.status, ["offen", "spaeter"])));
  const weg = offen.filter((o) => !aktuell.has(`${o.art}|${o.land}|${o.sku}`)).map((o) => o.id);
  if (weg.length) await db.update(V).set({ status: "veraltet", updatedAt: new Date() }).where(inArray(V.id, weg));
}

export async function leiterPflegen(tenantId: string, heute = todayIso()): Promise<LeiterStand> {
  const s = await getSettings(tenantId);
  const b = s.bqool;
  const e = b.leiter;
  const { bqoolVorschau } = await import("./export-service");
  const v = await bqoolVorschau(tenantId, { heute });
  const zeilen = v.laender.flatMap((l) => l.zeilen);
  // Kapital-Ampel (Reichweite, Kapital, Verkäufe), Hebel „Ladenhüter“, Buy-Box-Quote (BQool Listing Performance)
  const kap = await import("@/lib/money/kapital-service").then((x) => x.kapitalAmpel(tenantId, heute)).catch(() => null);
  const kapJe = new Map((kap?.zeilen ?? []).map((z) => [z.sku, z]));
  const ladenhueter = await import("@/lib/hebel/service")
    .then((x) => x.loadHebel(tenantId))
    .then((h) => new Set(h.list.filter((x) => x.type === "ladenhueter").map((x) => x.sku)))
    .catch(() => new Set<string>());
  const seit30 = plusTage(heute, -30);
  const leistung = await db
    .select({ land: schema.bqoolLeistung.land, sku: schema.bqoolLeistung.sku, bb: schema.bqoolLeistung.bbWins, stichtag: schema.bqoolLeistung.stichtag })
    .from(schema.bqoolLeistung)
    .where(and(eq(schema.bqoolLeistung.tenantId, tenantId), gte(schema.bqoolLeistung.stichtag, seit30)));
  const bbJe = new Map<string, { bb: number | null; stichtag: string }>();
  for (const l of leistung) {
    const k = `${l.land}|${l.sku}`;
    const alt = bbJe.get(k);
    if (!alt || l.stichtag > alt.stichtag) bbJe.set(k, { bb: l.bb, stichtag: l.stichtag });
  }
  const pflege = new Map((await db.select().from(P).where(eq(P.tenantId, tenantId))).map((p) => [`${p.land}|${p.sku}`, p]));
  const ist = await db.select({ land: schema.bqoolListings.marktplatz, sku: schema.bqoolListings.sku, eigene: schema.bqoolListings.eigeneBuybox, status: schema.bqoolListings.status, min: schema.bqoolListings.min, max: schema.bqoolListings.max }).from(schema.bqoolListings).where(eq(schema.bqoolListings.tenantId, tenantId));
  const istJe = new Map(ist.map((i) => [`${i.land}|${i.sku}`, i]));
  const liq = liquidationsName(b.katalog);
  const aktuell = new Set<string>();
  let schnellUnterMin = 0;
  let schnellUnterMinTage = 0;
  let gebrauchtNeupreis = 0;
  for (const z of zeilen) {
    // Nur SKUs, die im Land bei BQool stehen (BQool-Ist vorhanden) – sonst gäbe es Vorschläge für nicht gelistete Länder.
    if (z.istRegel === null) continue;
    const key = `${z.land}|${z.sku}`;
    const pf = pflege.get(key);
    const k = kapJe.get(z.sku);
    const reichweite = k?.reichweite ?? null;
    const verkaeufe30 = k?.verkaufProTag != null ? Math.round(k.verkaufProTag * 30) : null;
    const bbQuote = bbJe.get(key)?.bb ?? null;
    const gebraucht = istGebraucht(z.zustand as Zustand);
    const i = istJe.get(key);
    // Zähler „effektiver Min über Buy Box seit“ und „ohne Buy Box seit“
    const ueberSeit = ueberSeitFortschreiben({ effMin: z.effMin, buybox: z.buybox, ueberSeit: pf?.ueberSeit ?? null, heute });
    const ohneBuyboxSeit = i?.eigene === false ? (pf?.ohneBuyboxSeit ?? heute) : i?.eigene === true ? null : (pf?.ohneBuyboxSeit ?? null);
    const schnelldreher = !!pf?.schnelldreher && !gebraucht;
    if (ueberSeit !== (pf?.ueberSeit ?? null) || ohneBuyboxSeit !== (pf?.ohneBuyboxSeit ?? null) || !pf) {
      await db
        .insert(P)
        .values({ tenantId, land: z.land, sku: z.sku, ueberSeit, ohneBuyboxSeit })
        .onConflictDoUpdate({ target: [P.tenantId, P.land, P.sku], set: { ueberSeit, ohneBuyboxSeit, updatedAt: new Date() } });
    }
    if (schnelldreher && ueberSeit) {
      schnellUnterMin++;
      schnellUnterMinTage = Math.max(schnellUnterMinTage, tageZwischen(ueberSeit, heute));
    }
    // Gebrauchte, die in BQool noch mit dem Neupreis-Min stehen (Vollständigkeitsprüfung)
    if (gebraucht && i?.min != null && z.effMinStufe1 !== null && i.min >= z.effMinStufe1 - 0.005) gebrauchtNeupreis++;

    // B31.6b Regel-Leiter (Stufe 3 pflegt liquidation.ts)
    const lv = leiterPruefen(
      { land: z.land, stufe: z.stufe, regel: z.regel, effMin: z.effMin, effMinStufe1: z.effMinStufe1, effMinStufe2: z.effMinStufe2, breakEven: z.breakEven, buybox: z.buybox, ueberSeit, heute, reichweite, alterTage: z.alterTage, kapital: k?.kapital ?? null, ladenhueter: ladenhueter.has(z.sku), bbQuote, schnelldreher, gebraucht },
      e,
      b.abverkaufRegel,
      liq,
      b.standardRegel,
    );
    if (lv) {
      const art = `stufe_${lv.von}_${lv.nach}` as VorschlagArt;
      aktuell.add(`${art}|${key}`);
      await vorschlagSetzen(tenantId, heute, { land: z.land, sku: z.sku, art, vonRegel: z.regel, nachRegel: lv.regel, min: lv.min, gruende: lv.gruende, daten: { titel: z.titel, buybox: z.buybox, effMin: z.effMin, effMinStufe2: z.effMinStufe2, breakEven: z.breakEven, alterTage: z.alterTage, reichweite, kapital: k?.kapital ?? null, bbQuote, zustand: z.zustand } });
    }

    // B31.8 Schnelldreher: Kennzeichen vorschlagen bzw. Ende des Schutzes
    if (!gebraucht && !pf?.schnelldreher && schnelldreherKandidat({ verkaeufe30, reichweite, alterTage: z.alterTage, bbQuote }, e.schnell)) {
      aktuell.add(`schnelldreher|${key}`);
      await vorschlagSetzen(tenantId, heute, { land: z.land, sku: z.sku, art: "schnelldreher", gruende: [`${verkaeufe30 ?? "?"} Verkäufe in 30 Tagen`, `Lageralter ${z.alterTage} Tage`, `Buy-Box-Quote ${Math.round(bbQuote ?? 0)} %`], daten: { titel: z.titel, boden: e.schnell.margeBoden } });
    }
    if (pf?.schnelldreher && (!pf.schnellBis || pf.schnellBis < heute)) {
      const ende = schnelldreherEnde({ ohneBuyboxSeit, heute, verkaeufe30, alterTage: z.alterTage, reichweite }, e.schnell);
      if (ende) {
        aktuell.add(`schnelldreher_ende|${key}`);
        await vorschlagSetzen(tenantId, heute, { land: z.land, sku: z.sku, art: "schnelldreher_ende", gruende: [ende], daten: { titel: z.titel } });
      }
    }

    // B31.7c: pausierte Retouren/Gebrauchte aktivieren, sobald Min/Max gesetzt sind; eBay-Alternative unter Break-even
    if (gebraucht && i?.status === "pausiert" && !pf?.aktivieren && z.min > 0 && z.max > 0) {
      aktuell.add(`aktivieren|${key}`);
      await vorschlagSetzen(tenantId, heute, { land: z.land, sku: z.sku, art: "aktivieren", gruende: [`gebraucht (${z.zustand}), Min ${z.min.toFixed(2)} / Max ${z.max.toFixed(2)} gesetzt`], daten: { titel: z.titel } });
    }
    if (gebraucht && z.zielpreis !== null && z.breakEven !== null && z.zielpreis < z.breakEven - 0.005) {
      const { ebayVergleich } = await import("./leiter-logic");
      const r = ebayVergleich({ preis: z.zielpreis, ust: { DE: 0.19, FR: 0.2, IT: 0.22, ES: 0.21 }[z.land] ?? 0.19, provision: z.provision, fba: z.fba, ebayGebuehr: e.zustand.ebayGebuehr, ebayVersand: e.zustand.ebayVersand });
      if (r.besser === "ebay") {
        aktuell.add(`ebay|${key}`);
        await vorschlagSetzen(tenantId, heute, { land: z.land, sku: z.sku, art: "ebay", gruende: [`Zielpreis ${z.zielpreis.toFixed(2)} unter Amazon-Break-even ${z.breakEven.toFixed(2)}`, `netto Amazon ≈ ${r.amazon.toFixed(2)} € gegen eBay ≈ ${r.ebay.toFixed(2)} € (5 % Gebühr + Versand)`], daten: { titel: z.titel, zielpreis: z.zielpreis } });
      }
    }
  }
  await veraltenAusser(tenantId, ["stufe_1_2", "stufe_1_3", "stufe_2_3", "stufe_2_1", "schnelldreher", "schnelldreher_ende", "aktivieren", "ebay"], aktuell);

  // Aufgaben: Zustand prüfen, offene Vorschläge
  const unbekannt = [...new Map(v.zustandUnbekannt.map((u) => [u.sku, u])).values()];
  if (unbekannt.length) await upsertSystemTask(db, tenantId, TASK_ZUSTAND, { title: `Zustand prüfen: ${unbekannt.length} SKU${unbekannt.length === 1 ? "" : "s"} ohne Zustand (kein BQool-Upload)`, notes: `Kein Einkauf, kein Amazon-Zustand, keine Retouren-Station – Zustand von Hand setzen (Repricer → Zustand).\n${unbekannt.slice(0, 25).map((u) => `• ${u.sku}${u.titel ? ` – ${u.titel.slice(0, 50)}` : ""}`).join("\n")}`, category: "amazon", link: "/repricer?zustand=unbekannt#bqool-liste" });
  else await resolveSystemTask(db, tenantId, TASK_ZUSTAND);
  const [{ n: offen }] = await db.select({ n: sql<number>`count(*)::int` }).from(V).where(and(eq(V.tenantId, tenantId), eq(V.status, "offen"), sql`${V.art} not like 'check_%'`));
  if (offen) {
    // Die betroffenen SKUs gleich in der Aufgabe nennen (höchstens 15) – entschieden wird auf der Freigabe-Seite.
    const liste = await db.select({ land: V.land, sku: V.sku, art: V.art }).from(V).where(and(eq(V.tenantId, tenantId), eq(V.status, "offen"), sql`${V.art} not like 'check_%'`)).orderBy(V.sku).limit(15);
    const ART: Record<string, string> = { stufe_1_2: "Stufe 1 → 2 (Abverkauf)", stufe_1_3: "Stufe 1 → 3 (Liquidation)", stufe_2_3: "Stufe 2 → 3 (Liquidation)", stufe_2_1: "zurück auf Stufe 1", schnelldreher: "Schnelldreher?", schnelldreher_ende: "Schnelldreher ohne Buy Box", aktivieren: "aktivieren", ebay: "eBay statt Amazon" };
    const zeilen = liste.map((l) => `• ${l.sku} (${l.land}): ${ART[l.art] ?? l.art}`).join("\n");
    // Bei wenigen Vorschlägen die SKU im Titel – ein neuer Fall öffnet die Aufgabe dann wieder (Titel ändert sich).
    const wer = offen <= 2 ? ` – ${liste.map((l) => l.sku).join(", ")}` : "";
    await upsertSystemTask(db, tenantId, TASK_LEITER, { title: `BQool Regel-Leiter: ${offen} Vorschl${offen === 1 ? "ag" : "äge"} zur Freigabe${wer}`.slice(0, 200), notes: `Stufenwechsel (ia → Abverkauf → Liquidation), Schnelldreher-Schutz, gebrauchte Ware. Erst nach Freigabe kommt der Wechsel in die nächste BQool-Datei.\n${zeilen}${offen > liste.length ? `\n… und ${offen - liste.length} weitere` : ""}`, category: "amazon", link: "/repricer/bqool#leiter" });
  }
  else await resolveSystemTask(db, tenantId, TASK_LEITER);

  // Stand für Morgenbericht/Kapital-Ampel: Stufen nach BQool-Ist
  const lq = await db.select({ status: LQ.status, bis: LQ.bis, dauerhaft: LQ.dauerhaft, minGesetzt: LQ.minGesetzt, breakEven: LQ.breakEven, verlaengertAm: LQ.updatedAt, verlaengert: LQ.verlaengert }).from(LQ).where(and(eq(LQ.tenantId, tenantId), inArray(LQ.status, ["aktiv", "zurueck_vorgeschlagen"])));
  const stufe2 = zeilen.filter((z) => z.istStufe === 2).length;
  const stufe3 = zeilen.filter((z) => z.istStufe === 3).length;
  const unterBe = zeilen.filter((z) => z.istStufe === 3 && z.breakEven !== null && z.min < z.breakEven - 0.005).length;
  const stand: LeiterStand = {
    am: heute,
    stufe2,
    stufe3,
    unterBe,
    ueberfaellig: lq.filter((l) => l.status === "zurueck_vorgeschlagen" && l.bis && !l.dauerhaft && l.bis < heute).length,
    verlaengert: lq.filter((l) => l.status === "aktiv" && l.verlaengert > 0 && l.verlaengertAm.toISOString().slice(0, 10) === heute).length,
    schnellUnterMin,
    schnellUnterMinTage,
    gebrauchtNeupreis,
    zustandUnbekannt: unbekannt.length,
    vorschlaege: offen,
  };
  const { bqoolEinstellungenSpeichern } = await import("./export-service");
  await bqoolEinstellungenSpeichern(tenantId, { leiterStand: stand });
  return stand;
}

export type Entscheidung = "freigeben" | "ablehnen" | "spaeter" | "verlaengern" | "abverkauf" | "min_manuell";

/** Vorschlag entscheiden: Stufenwechsel → Soll-Regel (Zuweisung „Regel-Leiter“), Schnelldreher setzen/verlängern/beenden. */
export async function vorschlagEntscheiden(tenantId: string, id: string, entscheidung: Entscheidung, userId: string | null): Promise<string> {
  const [x] = await db.select().from(V).where(and(eq(V.tenantId, tenantId), eq(V.id, id)));
  if (!x || (x.status !== "offen" && x.status !== "spaeter")) return "Vorschlag nicht (mehr) offen.";
  const heute = todayIso();
  const fertig = async (status: "freigegeben" | "abgelehnt" | "spaeter" | "erledigt", spaeterBis: string | null = null) =>
    db.update(V).set({ status, spaeterBis, entschiedenAm: new Date(), entschiedenVon: userId, updatedAt: new Date() }).where(eq(V.id, x.id));
  if (entscheidung === "ablehnen") {
    await fertig("abgelehnt");
    return `${x.sku} (${x.land}): abgelehnt – kommt frühestens in 14 Tagen wieder.`;
  }
  if (entscheidung === "spaeter") {
    await fertig("spaeter", plusTage(heute, 7));
    return `${x.sku} (${x.land}): auf später gelegt (7 Tage).`;
  }
  const s = await getSettings(tenantId);
  const e = s.bqool.leiter;
  const pflege = (werte: Partial<typeof P.$inferInsert>) =>
    db.insert(P).values({ tenantId, land: x.land, sku: x.sku, ...werte }).onConflictDoUpdate({ target: [P.tenantId, P.land, P.sku], set: { ...werte, updatedAt: new Date() } });
  if (x.art.startsWith("stufe_") && x.nachRegel) {
    const { zuweisungSetzen } = await import("./export-service");
    await zuweisungSetzen(tenantId, { land: x.land as ExportLand, sku: x.sku, regel: x.nachRegel, untergrenze: x.min ?? null, quelle: "leiter", grund: `Regel-Leiter: ${(x.gruende ?? []).join("; ")}`.slice(0, 300) });
    if (x.min !== null && x.nachRegel === liquidationsName(s.bqool.katalog)) {
      const d = x.daten as { effMinStufe2?: number | null; breakEven?: number | null };
      const werte = { grund: "leiter" as const, regelVorher: x.vonRegel, minGewuenscht: x.min, minGesetzt: x.min, effMinVorher: d.effMinStufe2 ?? null, breakEven: d.breakEven ?? null, status: "vorgeschlagen" as const, updatedAt: new Date() };
      await db.insert(LQ).values({ tenantId, land: x.land, sku: x.sku, ...werte }).onConflictDoUpdate({ target: [LQ.tenantId, LQ.land, LQ.sku], set: { ...werte, beendetAm: null, bis: null, dauerhaft: false, verlaengert: 0, ablaufGemeldetAm: null, rueckkehrGrund: null, rueckkehrRegel: null } });
    }
    await fertig("freigegeben");
    return `${x.sku} (${x.land}): ${x.vonRegel ?? "?"} → ${x.nachRegel}${x.min !== null ? ` (Min ${x.min.toFixed(2)})` : ""} – kommt mit der nächsten BQool-Datei (Upload-Freigabe bleibt nötig).`;
  }
  if (x.art === "schnelldreher") {
    await pflege({ schnelldreher: true, schnellQuelle: "auto", schnellSeit: new Date(), schnellBis: null });
    await fertig("freigegeben");
    return `${x.sku} (${x.land}): Schnelldreher – Min mindestens Break-even + ${e.schnell.margeBoden} %, kein Abverkauf/Liquidation.`;
  }
  if (x.art === "schnelldreher_ende") {
    if (entscheidung === "verlaengern") {
      await pflege({ schnellBis: plusTage(heute, e.schnell.verlaengernTage) });
      await fertig("erledigt");
      return `${x.sku} (${x.land}): Schutz um ${e.schnell.verlaengernTage} Tage verlängert.`;
    }
    if (entscheidung === "abverkauf") {
      await pflege({ schnelldreher: false, schnellQuelle: null, schnellBis: null });
      await fertig("erledigt");
      return `${x.sku} (${x.land}): Schutz beendet – die Regel-Leiter gilt wieder.`;
    }
    await fertig("erledigt");
    return `${x.sku} (${x.land}): Min von Hand unter „Soll-Regeln“ setzen.`;
  }
  if (x.art === "aktivieren") {
    await pflege({ aktivieren: true });
    await fertig("freigegeben");
    return `${x.sku} (${x.land}): wird mit der nächsten Datei aktiviert (Enable Repricing = 1).`;
  }
  await fertig("erledigt");
  return `${x.sku} (${x.land}): erledigt.`;
}

/** Schnelldreher von Hand setzen/entfernen (Repricer-Seite, Mehrfachauswahl). */
export async function schnelldreherSetzen(tenantId: string, eintraege: { land: string; sku: string }[], an: boolean) {
  for (const x of eintraege) {
    const werte = an ? { schnelldreher: true, schnellQuelle: "hand" as const, schnellSeit: new Date(), schnellBis: null } : { schnelldreher: false, schnellQuelle: null, schnellBis: null };
    await db.insert(P).values({ tenantId, land: x.land, sku: x.sku, ...werte }).onConflictDoUpdate({ target: [P.tenantId, P.land, P.sku], set: { ...werte, updatedAt: new Date() } });
  }
}

/** Zustand von Hand setzen (land „*“ = alle Marktplätze); „automatisch“ löscht den Handeintrag. */
export async function zustandSetzen(tenantId: string, skus: string[], zustand: Zustand | "auto", userId: string | null) {
  const Z = schema.artikelZustand;
  for (const sku of skus) {
    if (zustand === "auto") {
      await db.delete(Z).where(and(eq(Z.tenantId, tenantId), eq(Z.land, "*"), eq(Z.sku, sku)));
      continue;
    }
    await db
      .insert(Z)
      .values({ tenantId, land: "*", sku, zustand, quelle: "hand", gesetztVon: userId })
      .onConflictDoUpdate({ target: [Z.tenantId, Z.land, Z.sku], set: { zustand, quelle: "hand", gesetztVon: userId, updatedAt: new Date() } });
  }
}

export async function vorschlaegeOffen(tenantId: string, o: { nurCheck?: boolean } = {}) {
  return db
    .select()
    .from(V)
    .where(and(eq(V.tenantId, tenantId), eq(V.status, "offen"), o.nurCheck ? sql`${V.art} like 'check_%'` : sql`${V.art} not like 'check_%'`))
    .orderBy(V.art, V.land, V.sku);
}
