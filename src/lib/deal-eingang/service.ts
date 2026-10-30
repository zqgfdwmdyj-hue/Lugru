import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { DealEingangZeile, DealLandZeile } from "@/db/tables/deal-eingang";
import { askClaude, modelFor, type AiContent } from "@/lib/ai/claude";
import { dealPruefen } from "@/lib/deal-ampel/service";
import { getIntegration } from "@/lib/integrations/store";
import { keepaByCode, keepaKey, keepaSearch } from "@/lib/integrations/clients/keepa";
import { storeFile } from "@/lib/orders/service";
import { getSettings } from "@/lib/settings";
import {
  dreiGruende,
  einfacheErkennung,
  eingangAmpel,
  empfohleneMenge,
  istPreisliste,
  kiErkennungAuftrag,
  leseKiAngebote,
  maxEk,
  packungAus,
  packungsWarnung,
  pushText,
  quelleAusText,
  trefferquote,
  waehleTreffer,
  zeilenAmpel,
  type Angebot,
} from "./logic";

// Deal-Eingang: geteilte Nachricht/Screenshot/Datei speichern, Angebote erkennen (KI, sonst Regeln), je Angebot ASIN
// finden (ASIN → EAN → Titelsuche), Deal-Ampel (Modul 4) rechnen, eigene Lage (Bestand, Reichweite, Kapital-Ampel,
// letzter EK, Verlust-Stopp), Freigabe (Listing-Restrictions) und Liquidität prüfen, Ampel mit höchstens 3 Gründen.

const E = schema.dealEingaenge;
const TOK = schema.apiTokens;
const r2 = (n: number) => Math.round(n * 100) / 100;
const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

export type EingangDatei = { name: string; mime: string; bytes: Uint8Array };
export type Weg = "manuell" | "teilen" | "kurzbefehl" | "mail" | "claude" | "profitpath";

export class DealEingangFehler extends Error {}

const BILD = /^image\/(png|jpe?g|gif|webp)$/;
const istTabelle = (d: { name: string; mime: string }) => /\.(xlsx|xls|csv)$/i.test(d.name) || /spreadsheet|ms-excel|text\/csv/.test(d.mime);

// ---- Anlegen -----------------------------------------------------------------------------------------------------

/** Eingang speichern. Derselbe Inhalt innerhalb von 24 Stunden wird nicht doppelt angelegt. */
export async function eingangAnlegen(tenantId: string, userId: string | null, e: { weg: Weg; text: string; dateien?: EingangDatei[]; quelle?: string | null; tokenId?: string | null; quelleRef?: string | null; angebote?: Angebot[] | null }): Promise<{ id: string; neu: boolean }> {
  const text = (e.text ?? "").trim().slice(0, 50_000);
  const dateien = (e.dateien ?? []).filter((d) => d.bytes.length > 0).slice(0, 10);
  if (!text && !dateien.length) throw new DealEingangFehler("Bitte Text einfügen oder eine Datei (Screenshot, PDF, Tabelle) anhängen.");
  for (const d of dateien) if (d.bytes.length > 20 * 1024 * 1024) throw new DealEingangFehler(`${d.name} ist größer als 20 MB.`);
  if (e.quelleRef) {
    const [schon] = await db.select({ id: E.id }).from(E).where(and(eq(E.tenantId, tenantId), eq(E.quelleRef, e.quelleRef)));
    if (schon) return { id: schon.id, neu: false };
  }
  const h = createHash("sha256").update(text);
  for (const d of dateien) h.update(d.bytes);
  const kennung = h.digest("hex");
  const [doppelt] = await db.select({ id: E.id }).from(E).where(and(eq(E.tenantId, tenantId), eq(E.inhaltKennung, kennung), gte(E.createdAt, new Date(Date.now() - 24 * 3600_000))));
  if (doppelt) return { id: doppelt.id, neu: false };
  const ids: string[] = [];
  for (const d of dateien) ids.push(await storeFile(tenantId, d.name.slice(0, 200), d.mime || "application/octet-stream", Buffer.from(d.bytes)));
  const quelle = (e.quelle?.trim() || quelleAusText(text) || null)?.slice(0, 80) ?? null;
  const [row] = await db.insert(E).values({ tenantId, userId, weg: e.weg, tokenId: e.tokenId ?? null, quelle, rohtext: text, dateiIds: ids, dateiNamen: dateien.map((d) => d.name.slice(0, 200)), inhaltKennung: kennung, quelleRef: e.quelleRef ?? null, angebote: e.angebote?.length ? e.angebote : null }).returning({ id: E.id });
  return { id: row.id, neu: true };
}

async function dateienLaden(tenantId: string, ids: string[]): Promise<EingangDatei[]> {
  if (!ids.length) return [];
  const F = schema.files;
  const rows = await db.select({ name: F.name, mime: F.mimeType, data: F.data }).from(F).where(and(eq(F.tenantId, tenantId), inArray(F.id, ids)));
  return rows.map((r) => ({ name: r.name, mime: r.mime, bytes: new Uint8Array(r.data as Buffer) }));
}

// ---- Erkennen ----------------------------------------------------------------------------------------------------

async function erkennen(tenantId: string, text: string, dateien: EingangDatei[]): Promise<{ quelle: string | null; angebote: Angebot[]; ohneKi: boolean }> {
  const ai = await getIntegration(tenantId, "anthropic");
  const medien = dateien.filter((d) => BILD.test(d.mime) || d.mime === "application/pdf");
  if (ai?.apiKey) {
    const blocks: Exclude<AiContent, string> = [
      ...medien.map((d) =>
        d.mime === "application/pdf"
          ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(d.bytes).toString("base64") } } as const)
          : ({ type: "image", source: { type: "base64", media_type: d.mime.replace("jpg", "jpeg"), data: Buffer.from(d.bytes).toString("base64") } } as const),
      ),
      { type: "text", text: kiErkennungAuftrag(text) },
    ];
    try {
      const r = await askClaude(ai.apiKey, medien.length ? blocks : kiErkennungAuftrag(text), { model: modelFor(ai, "simple"), task: "simple", maxTokens: 4000, timeoutMs: 90_000 });
      const k = leseKiAngebote(r.text);
      if (k.angebote.length || !text) return { ...k, ohneKi: false };
    } catch {
      // KI nicht erreichbar → Regeln
    }
  }
  return { quelle: null, angebote: einfacheErkennung(text), ohneKi: true };
}

// ---- ASIN finden -------------------------------------------------------------------------------------------------

type Kandidat = { asin: string; titel: string; packung: number | null };
const kandidatAus = (p: Record<string, unknown>): Kandidat | null => {
  const asin = typeof p.asin === "string" ? p.asin : null;
  if (!asin) return null;
  const titel = typeof p.title === "string" ? p.title : asin;
  const items = typeof p.packageQuantity === "number" && p.packageQuantity > 0 ? p.packageQuantity : typeof p.numberOfItems === "number" && p.numberOfItems > 0 ? p.numberOfItems : null;
  return { asin, titel, packung: items ?? packungAus(titel) };
};

async function asinFinden(tenantId: string, a: Angebot): Promise<{ asin: string | null; zuordnung: DealEingangZeile["zuordnung"]; vorschlaege: Kandidat[]; titel: string | null; unsicher: string | null }> {
  if (a.asin) return { asin: a.asin, zuordnung: "asin", vorschlaege: [], titel: null, unsicher: null };
  const key = await keepaKey(tenantId);
  if (!key) return { asin: null, zuordnung: "keine", vorschlaege: [], titel: null, unsicher: "Ohne Keepa keine Zuordnung über EAN/Titel – bitte ASIN eintragen." };
  if (a.ean) {
    const { products } = await keepaByCode(key, [a.ean]).catch(() => ({ products: [] as Record<string, unknown>[] }));
    const k = products.map(kandidatAus).filter((x): x is Kandidat => !!x);
    if (k.length) {
      const w = waehleTreffer({ name: a.name, packung: a.packung }, k)!;
      return { asin: w.asin, zuordnung: "ean", vorschlaege: k.slice(0, 6), titel: w.titel, unsicher: k.length > 1 && !w.sicher ? `Zur EAN ${k.length} ASINs – Packungsgröße prüfen.` : null };
    }
  }
  if (a.name && a.name.length >= 4) {
    const { products } = await keepaSearch(key, [a.marke, a.name].filter(Boolean).join(" ")).catch(() => ({ products: [] }));
    const k: Kandidat[] = products.slice(0, 8).map((p) => ({ asin: p.asin, titel: p.title, packung: p.items ?? packungAus(p.title) }));
    if (k.length) {
      const w = waehleTreffer({ name: a.name, packung: a.packung }, k)!;
      return { asin: w.asin, zuordnung: "titel", vorschlaege: k.slice(0, 6), titel: w.titel, unsicher: w.sicher ? null : "Über die Titelsuche zugeordnet – bitte ASIN bestätigen." };
    }
  }
  return { asin: null, zuordnung: "keine", vorschlaege: [], titel: null, unsicher: null };
}

// ---- Eigene Lage -------------------------------------------------------------------------------------------------

type Lage = { kapital: Map<string, { ampel: "gruen" | "gelb" | "rot"; reichweite: number | null; gruende: string[]; ek: number | null }>; verlust: Map<string, string>; vorschlag: Set<string> };

async function eigeneLage(tenantId: string, heute: string): Promise<Lage> {
  const kapital = new Map<string, { ampel: "gruen" | "gelb" | "rot"; reichweite: number | null; gruende: string[]; ek: number | null }>();
  try {
    const { kapitalAmpel } = await import("@/lib/money/kapital-service");
    for (const z of (await kapitalAmpel(tenantId, heute)).zeilen) if (z.asin && !kapital.has(z.asin)) kapital.set(z.asin, { ampel: z.ampel, reichweite: z.reichweite, gruende: z.gruende, ek: z.ek });
  } catch {
    // ohne Bestandsdaten keine Kapital-Ampel
  }
  const verlust = new Map<string, string>();
  const T = schema.tasks;
  const v = await db.execute<{ asin: string; status: string }>(sql`select distinct on (i.asin) i.asin, t.status from ${T} t join sellerboard_inventory i on i.tenant_id = t.tenant_id and t.system_key = 'verlust-' || i.sku where t.tenant_id = ${tenantId} and i.asin is not null order by i.asin, t.created_at desc`);
  for (const r of v.rows) verlust.set(r.asin, r.status === "done" ? "Verlust-Stopp früher (erledigt)" : "Verlust-Stopp offen");
  const vorschlag = new Set<string>();
  try {
    const { sellerboardReorder } = await import("@/lib/purchasing/reorder");
    for (const r of (await sellerboardReorder(tenantId)).rows) if (r.asin && (r.timeToReorder ?? "").toUpperCase() === "YES") vorschlag.add(r.asin);
  } catch {
    // ohne Nachbestell-Daten
  }
  return { kapital, verlust, vorschlag };
}

// ---- Prüfen ------------------------------------------------------------------------------------------------------

export async function zeilePruefen(tenantId: string, nr: number, a: Angebot, lage: Lage, o: { now?: number } = {}): Promise<DealEingangZeile> {
  const s = await getSettings(tenantId);
  const de = s.dealEingang;
  const leer = (fehler: string | null, extra: Partial<DealEingangZeile> = {}): DealEingangZeile => ({ nr, angebot: a, asin: null, zuordnung: "keine", vorschlaege: [], titel: null, ampel: "gelb", gruende: [], bestesLand: null, ekNetto: null, gewinn: null, roi: null, marge: null, angebote: null, amazonProzent: null, verkaeufeMonat: null, empfohlen: null, kapitalbedarf: null, maxEk: [], laender: [], eigen: null, risiken: [], hinweise: [], fehler, geprueftAm: new Date().toISOString(), ...extra });
  const z = await asinFinden(tenantId, a);
  if (!z.asin) return leer(null, { gruende: [z.unsicher ?? "Keine ASIN gefunden – bitte ASIN oder EAN eintragen."], zuordnung: z.zuordnung, vorschlaege: z.vorschlaege });

  const ohneEk = a.ek === null || !(a.ek > 0);
  let p;
  try {
    p = await dealPruefen(tenantId, { code: z.asin, ek: ohneEk ? 0.01 : a.ek!, ekIstNetto: a.ekNetto !== false, menge: a.menge ?? a.moq ?? null }, o.now);
  } catch (e) {
    return leer(e instanceof Error ? e.message : String(e), { asin: z.asin, zuordnung: z.zuordnung, vorschlaege: z.vorschlaege, titel: z.titel, gruende: [e instanceof Error ? e.message.slice(0, 160) : "Prüfung fehlgeschlagen"] });
  }
  const rot: string[] = ohneEk ? [] : [...p.rot];
  const gelb: string[] = ohneEk ? [] : [...p.gelb];
  if (ohneEk) rot.push(...p.rot.filter((x) => !/Marge/.test(x)));
  const titel = p.titel ?? z.titel;

  // Max. EK je Land für den Ziel-ROI (beim 90-Tage-Mittel)
  const laender: DealLandZeile[] = p.laender.map((l) => {
    const k = l.schnitt90 ?? l.aktuell;
    const m = k ? maxEk({ vkNetto: k.vkNetto, gebuehren: k.gebuehren, prep: s.dealAmpel.nebenkosten, zielRoi: de.zielRoi }) : null;
    return { land: l.land, vkEur: l.vkEur, vk90Eur: l.vk90Eur, tief12Eur: l.tief12Eur, verkaeufeMonat: l.verkaeufeMonat, angebote: l.angebote, amazonProzent: l.amazonProzent, gewinn: ohneEk ? null : (l.schnitt90?.gewinn ?? null), gewinnAktuell: ohneEk ? null : (l.aktuell?.gewinn ?? null), roi: ohneEk ? null : (l.schnitt90?.roi ?? null), marge: ohneEk ? null : (l.schnitt90?.marge ?? null), maxEk: m, fehler: l.fehler };
  });
  const maxListe = laender.filter((l) => l.maxEk !== null).map((l) => ({ land: l.land, ek: l.maxEk! })).sort((x, y) => y.ek - x.ek);
  if (ohneEk) gelb.push(maxListe.length ? `EK fehlt – lohnt bis EK ${eur(maxListe[0].ek)} netto (${maxListe[0].land}).` : "EK fehlt.");
  if (a.ekNetto === null && !ohneEk) gelb.push("Netto/brutto nicht erkennbar – als netto gerechnet.");

  // Packungsgröße und unsichere Zuordnung
  const pw = packungsWarnung(a, titel);
  if (pw) gelb.unshift(pw);
  if (z.unsicher) gelb.unshift(z.unsicher);

  // Eigene Lage: Bestand/Reichweite (Kapital-Ampel), Bestellvorschlag, letzter EK, Verlust-Stopp
  const k = lage.kapital.get(z.asin) ?? null;
  const eigen = p.eigen || k ? { bestand: p.eigen?.bestand ?? 0, unterwegs: p.eigen?.unterwegs ?? 0, proTag: p.eigen?.proTag ?? null, reichweite: k?.reichweite ?? null, kapitalAmpel: k?.ampel ?? null, letzterEk: k?.ek ?? null, letzterEkQuelle: k?.ek !== null && k?.ek !== undefined ? "Seller-System" : null, verlustStopp: lage.verlust.get(z.asin) ?? null, bestellvorschlag: lage.vorschlag.has(z.asin) } : null;
  if (eigen?.reichweite !== null && eigen?.reichweite !== undefined) {
    const tage = eigen.reichweite >= 9999 ? null : eigen.reichweite;
    if (k?.ampel === "rot" && (tage === null || tage > s.kapital.rotReichweite)) rot.unshift(tage === null ? "Bestand verkauft sich nicht (keine Verkäufe)." : `Bestand reicht ${tage} Tage.`);
    else if (tage !== null && tage > de.maxReichweiteTage) gelb.push(`Bestand reicht schon ${tage} Tage.`);
  }
  if (eigen?.verlustStopp === "Verlust-Stopp offen") gelb.push("Verlust-Stopp für diese ASIN offen.");
  if (eigen?.letzterEk && !ohneEk && p.ekNetto > eigen.letzterEk * 1.05) gelb.push(`Teurer als unser letzter EK (${eur(eigen.letzterEk)}).`);

  // Empfohlene Menge (Reichweite ≤ N Tage, minus Bestand/unterwegs) und Mindestmenge
  const empfohlen = empfohleneMenge(p.abverkauf.unsProMonat, de.maxReichweiteTage, eigen);
  if (empfohlen !== null && a.moq && a.moq > empfohlen && empfohlen > 0) gelb.push(`Mindestmenge ${a.moq} Stk über der empfohlenen Menge (${empfohlen}).`);

  // Freigabe (Listing-Restrictions) – nur mit SP-API
  const risiken: string[] = [];
  try {
    const { listingRestrictions } = await import("@/lib/integrations/clients/amazon");
    const r = (await listingRestrictions(tenantId, [z.asin])).get(z.asin);
    if (r && !r.ok) rot.unshift(`Marke gesperrt: ${r.reason ?? "Freischaltung erforderlich"}.`);
  } catch {
    risiken.push("Verkaufsfreigabe nicht geprüft (SP-API nicht verbunden).");
  }
  risiken.push("Rechnung als Echtheitsnachweis tauglich? (Händler mit Anschrift, Artikel und Menge)");

  const b = p.bestes;
  const ampel = zeilenAmpel(rot, gelb);
  return {
    nr,
    angebot: a,
    asin: z.asin,
    zuordnung: z.zuordnung,
    vorschlaege: z.vorschlaege,
    titel,
    ampel,
    gruende: dreiGruende(rot, gelb),
    bestesLand: b?.land ?? null,
    ekNetto: ohneEk ? null : p.ekNetto,
    gewinn: ohneEk ? null : ((b?.schnitt90 ?? b?.aktuell)?.gewinn ?? null),
    roi: ohneEk ? null : ((b?.schnitt90 ?? b?.aktuell)?.roi ?? null),
    marge: ohneEk ? null : ((b?.schnitt90 ?? b?.aktuell)?.marge ?? null),
    angebote: b?.angebote ?? null,
    amazonProzent: b?.amazonProzent ?? null,
    verkaeufeMonat: b?.verkaeufeMonat ?? null,
    empfohlen,
    kapitalbedarf: empfohlen && !ohneEk ? r2(empfohlen * p.ekNetto) : null,
    maxEk: maxListe,
    laender,
    eigen,
    risiken,
    hinweise: p.hinweise,
    fehler: null,
    geprueftAm: new Date().toISOString(),
  };
}

/** Eingang prüfen: erkennen → (Preisliste?) → je Angebot prüfen → Liquidität → speichern. Fehler landen im Eingang. */
async function meldenNachPruefung(tenantId: string, id: string, update?: boolean) {
  const { benachrichtigen } = await import("./ablauf");
  await benachrichtigen(tenantId, id, { update }).catch((e) => console.error("[Deal-Eingang] Meldung:", e instanceof Error ? e.message : e));
}

export async function eingangPruefen(tenantId: string, id: string, o: { heute?: string; now?: number; update?: boolean } = {}): Promise<void> {
  const [e] = await db.select().from(E).where(and(eq(E.tenantId, tenantId), eq(E.id, id)));
  if (!e) return;
  await db.update(E).set({ pruefung: "laeuft", fehler: null }).where(eq(E.id, id));
  try {
    const s = await getSettings(tenantId);
    const dateien = await dateienLaden(tenantId, e.dateiIds);
    const tabellen = dateien.filter(istTabelle);
    // Schon strukturiert geliefert (ProfitPath, Claude) → keine KI-Erkennung nötig.
    const k = e.angebote?.length ? { quelle: null, angebote: e.angebote, ohneKi: false } : tabellen.length ? { quelle: null, angebote: [] as Angebot[], ohneKi: false } : await erkennen(tenantId, e.rohtext, dateien);
    const quelle = e.quelle ?? k.quelle;
    if (istPreisliste({ zeilen: k.angebote.length, tabellen: tabellen.length, ab: s.dealEingang.preislisteAbZeilen })) {
      const { alsPreisliste } = await import("./preisliste");
      const r = await alsPreisliste(tenantId, { quelle, tabellen, angebote: k.angebote });
      await db.update(E).set({ pruefung: "fertig", status: "preisliste", quelle, preislisteId: r.feedId, zusammenfassung: r.text, ohneKi: k.ohneKi, geprueftAm: new Date() }).where(eq(E.id, id));
      await meldenNachPruefung(tenantId, id, o.update);
      return;
    }
    if (!k.angebote.length) {
      await db.update(E).set({ pruefung: "fertig", quelle, ohneKi: k.ohneKi, zusammenfassung: "Keine Angebote erkannt – bitte Zeilen von Hand eintragen.", geprueftAm: new Date() }).where(eq(E.id, id));
      return;
    }
    const heute = o.heute ?? new Date().toISOString().slice(0, 10);
    const lage = await eigeneLage(tenantId, heute);
    const zeilen: DealEingangZeile[] = [];
    for (const [i, a] of k.angebote.slice(0, s.dealEingang.preislisteAbZeilen).entries()) zeilen.push(await zeilePruefen(tenantId, i + 1, a, lage, o));
    await liquiditaetPruefen(tenantId, zeilen, heute);
    const a = eingangAmpel(zeilen);
    await db.update(E).set({ pruefung: "fertig", quelle, zeilen, ampel: a.ampel, zusammenfassung: pushText(zeilen.map((z) => ({ ...z, name: z.angebot.name }))), ohneKi: k.ohneKi, geprueftAm: new Date() }).where(eq(E.id, id));
    await meldenNachPruefung(tenantId, id, o.update);
  } catch (err) {
    await db.update(E).set({ pruefung: "fehler", fehler: err instanceof Error ? err.message.slice(0, 500) : String(err) }).where(eq(E.id, id));
  }
}

/** Liquidität: Kapitalbedarf aller grünen/gelben Zeilen als „Was wäre wenn“ – tiefster Stand unter Reserve → Gelb. */
async function liquiditaetPruefen(tenantId: string, zeilen: DealEingangZeile[], heute: string) {
  const summe = r2(zeilen.filter((z) => z.ampel !== "rot").reduce((n, z) => n + (z.kapitalbedarf ?? 0), 0));
  if (!(summe > 0)) return;
  try {
    const { liquiditaet } = await import("@/lib/money/liquiditaet-service");
    const l = await liquiditaet(tenantId, { heute, wochen: 8, szenario: { betrag: -summe, datum: heute, label: "Deal-Eingang" } });
    const tief = l.wochen.reduce<number | null>((m, w) => (w.tiefster === null ? m : m === null || w.tiefster < m ? w.tiefster : m), null);
    if (tief !== null && tief < l.reserve) {
      for (const z of zeilen) if (z.ampel !== "rot" && z.kapitalbedarf) {
        z.gruende = dreiGruende([], [...z.gruende, `Liquidität: mit ${eur(summe)} Einkauf tiefster Stand ${eur(tief)} (Reserve ${eur(l.reserve)}).`]);
        z.ampel = z.ampel === "gruen" ? "gelb" : z.ampel;
      }
    }
  } catch {
    // ohne Bank-/Plandaten keine Liquiditätsprüfung
  }
}

/** Eine Zeile ändern (ASIN, EK, Menge …) und neu rechnen. */
export async function zeileAendern(tenantId: string, id: string, nr: number, aenderung: Partial<Pick<Angebot, "asin" | "ean" | "ek" | "ekNetto" | "menge" | "moq" | "packung" | "name">>) {
  const [e] = await db.select().from(E).where(and(eq(E.tenantId, tenantId), eq(E.id, id)));
  if (!e) throw new DealEingangFehler("Eingang nicht gefunden.");
  const alt = e.zeilen.find((z) => z.nr === nr);
  const a: Angebot = { ...(alt?.angebot ?? { asin: null, ean: null, name: null, marke: null, ek: null, ekNetto: true, waehrung: "EUR", menge: null, moq: null, staffel: null, versand: null, lieferzeit: null, zahlung: null, gueltigBis: null, zustand: null, packung: null }), ...aenderung };
  const lage = await eigeneLage(tenantId, new Date().toISOString().slice(0, 10));
  const neu = await zeilePruefen(tenantId, nr, a, lage);
  const zeilen = [...e.zeilen.filter((z) => z.nr !== nr), neu].sort((x, y) => x.nr - y.nr);
  const amp = eingangAmpel(zeilen);
  await db.update(E).set({ zeilen, ampel: amp.ampel, zusammenfassung: pushText(zeilen.map((z) => ({ ...z, name: z.angebot.name }))), pruefung: "fertig" }).where(eq(E.id, id));
  return neu;
}

// ---- Lesen und Entscheiden ---------------------------------------------------------------------------------------

export async function eingaenge(tenantId: string, f: { status?: string; quelle?: string; ampel?: string; seit?: Date; limit?: number } = {}) {
  const w = [eq(E.tenantId, tenantId)];
  if (f.status) w.push(eq(E.status, f.status as (typeof E.status.enumValues)[number]));
  if (f.ampel) w.push(eq(E.ampel, f.ampel as "gruen" | "gelb" | "rot"));
  if (f.quelle) w.push(sql`lower(${E.quelle}) = lower(${f.quelle})`);
  if (f.seit) w.push(gte(E.createdAt, f.seit));
  return db.select({ id: E.id, weg: E.weg, quelle: E.quelle, status: E.status, pruefung: E.pruefung, ampel: E.ampel, zusammenfassung: E.zusammenfassung, zeilen: E.zeilen, dateiNamen: E.dateiNamen, fehler: E.fehler, preislisteId: E.preislisteId, grund: E.grund, createdAt: E.createdAt }).from(E).where(and(...w)).orderBy(desc(E.createdAt)).limit(f.limit ?? 50);
}

export async function eingang(tenantId: string, id: string) {
  const [e] = await db.select().from(E).where(and(eq(E.tenantId, tenantId), eq(E.id, id)));
  return e ?? null;
}

export const STATUS_TEXT = { neu: "neu", gekauft: "gekauft", bestellvorschlag: "in Bestellvorschlägen", b2b: "als B2B-Deal", verworfen: "verworfen", preisliste: "als Preisliste" } as const;

export async function statusSetzen(tenantId: string, id: string, status: keyof typeof STATUS_TEXT, grund?: string | null) {
  const r = await db.update(E).set({ status, grund: grund?.trim().slice(0, 300) || null, entschiedenAm: new Date() }).where(and(eq(E.tenantId, tenantId), eq(E.id, id))).returning({ id: E.id });
  if (!r.length) throw new DealEingangFehler("Eingang nicht gefunden.");
}

export async function quellen(tenantId: string) {
  const rows = await db.select({ id: E.id, quelle: E.quelle, status: E.status, zeilen: E.zeilen, entschiedenAm: E.entschiedenAm }).from(E).where(eq(E.tenantId, tenantId));
  const { realerRoi } = await import("./ablauf");
  const real = await realerRoi(tenantId, rows.filter((r) => r.status === "gekauft" || r.status === "bestellvorschlag"));
  const quote = trefferquote(rows.map((r) => ({ quelle: r.quelle, status: r.status, zeilen: r.zeilen.map((z) => ({ ampel: z.ampel, roi: z.roi })) })));
  return quote.map((q) => {
    const werte = rows.filter((r) => (r.quelle?.trim() || "unbekannt") === q.quelle && real.has(r.id)).map((r) => real.get(r.id)!);
    return { ...q, roiReal: werte.length ? Math.round(werte.reduce((a, b) => a + b, 0) / werte.length) : null, roiRealN: werte.length };
  });
}

/** Aufbewahrung: Eingänge (mit Dateien) nach N Monaten löschen. */
export async function aufraeumen(tenantId: string, now = new Date()) {
  const s = await getSettings(tenantId);
  const grenze = new Date(now);
  grenze.setMonth(grenze.getMonth() - s.dealEingang.aufbewahrungMonate);
  const alt = await db.select({ id: E.id, dateiIds: E.dateiIds }).from(E).where(and(eq(E.tenantId, tenantId), lt(E.createdAt, grenze)));
  const dateiIds = alt.flatMap((a) => a.dateiIds);
  if (dateiIds.length) await db.delete(schema.files).where(and(eq(schema.files.tenantId, tenantId), inArray(schema.files.id, dateiIds)));
  if (alt.length) await db.delete(E).where(and(eq(E.tenantId, tenantId), inArray(E.id, alt.map((a) => a.id))));
  return alt.length;
}

// ---- Geräte-Schlüssel (iPhone-Kurzbefehl) -------------------------------------------------------------------------

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

/** Neuer Schlüssel je Gerät – wird nur jetzt im Klartext gezeigt. */
export async function tokenAnlegen(tenantId: string, userId: string, name: string): Promise<{ id: string; token: string }> {
  const token = `dk_${randomBytes(24).toString("base64url")}`;
  const [t] = await db.insert(TOK).values({ tenantId, userId, name: name.trim().slice(0, 80) || "Gerät", tokenHash: hash(token), anfang: token.slice(0, 7) }).returning({ id: TOK.id });
  return { id: t.id, token };
}

export async function tokenWiderrufen(tenantId: string, userId: string, id: string) {
  await db.update(TOK).set({ revokedAt: new Date() }).where(and(eq(TOK.tenantId, tenantId), eq(TOK.userId, userId), eq(TOK.id, id), isNull(TOK.revokedAt)));
}

export async function tokens(tenantId: string, userId: string) {
  return db.select({ id: TOK.id, name: TOK.name, anfang: TOK.anfang, lastUsedAt: TOK.lastUsedAt, revokedAt: TOK.revokedAt, createdAt: TOK.createdAt }).from(TOK).where(and(eq(TOK.tenantId, tenantId), eq(TOK.userId, userId))).orderBy(desc(TOK.createdAt));
}

/**
 * Schlüssel prüfen: gültig, nicht widerrufen, Nutzer hat (noch) Zugriff auf den Deal-Eingang. Rate-Limit: höchstens
 * 20 Eingänge in 10 Minuten und 200 am Tag je Schlüssel.
 */
export async function tokenPruefen(token: string): Promise<{ ok: true; tenantId: string; userId: string; tokenId: string } | { ok: false; status: number; fehler: string }> {
  if (!/^dk_[A-Za-z0-9_-]{20,}$/.test(token)) return { ok: false, status: 401, fehler: "Ungültiger Schlüssel." };
  const [t] = await db.select().from(TOK).where(eq(TOK.tokenHash, hash(token)));
  if (!t || t.revokedAt) return { ok: false, status: 401, fehler: t ? "Schlüssel widerrufen." : "Ungültiger Schlüssel." };
  const [m] = await db.select({ role: schema.memberships.role, areas: schema.memberships.areas, readOnly: schema.memberships.readOnly }).from(schema.memberships).where(and(eq(schema.memberships.tenantId, t.tenantId), eq(schema.memberships.userId, t.userId)));
  const { canAccess } = await import("@/lib/auth/areas");
  if (!m || !canAccess({ role: m.role, areas: m.areas ?? null, readOnly: m.role === "staff" && m.readOnly }, "dealeingang")) return { ok: false, status: 403, fehler: "Kein Zugriff auf den Deal-Eingang." };
  const [{ kurz, tag }] = (
    await db.execute<{ kurz: number; tag: number }>(sql`select count(*) filter (where created_at > now() - interval '10 minutes')::int as kurz, count(*) filter (where created_at > now() - interval '1 day')::int as tag from deal_eingaenge where token_id = ${t.id}`)
  ).rows;
  if (kurz >= 20 || tag >= 200) return { ok: false, status: 429, fehler: "Zu viele Eingänge – bitte später erneut." };
  await db.update(TOK).set({ lastUsedAt: new Date() }).where(eq(TOK.id, t.id));
  return { ok: true, tenantId: t.tenantId, userId: t.userId, tokenId: t.id };
}
