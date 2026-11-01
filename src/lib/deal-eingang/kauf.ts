import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { DealEingangZeile, DealKauf } from "@/db/tables/deal-eingang";
import { addDaysIso, todayIso } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { bestellbestaetigung, budgetPruefen, kaufText, passtZuDeal, type Budget } from "./kauf-logic";
import { wertSchwelleFuer } from "./logic";
import { DealEingangFehler } from "./service";
import { amazonProfil, gutscheinAus, istAmazon, kaufLink, kaufMenge, kaufNrGueltig, kaufNummerFrei, KAUF_NR_STUNDEN, monatsrahmenText, profileZusammen, profilFuer, shopLinkAus, type LinkArt, type ShopProfil } from "./shop-logic";
import { skuKaeufeLaden } from "./sku-kaeufe";

// „Kaufen mit einem Tap“: Push mit Warenkorb-Link (Amazon) bzw. Produktseite (andere Shops, Shop-Profile), Kauf-Nummer
// („Kaufen 17“, 24 Std.), „Kauf vorbereitet (Menge)“ beim Öffnen, nach 24 Std. Abgleich mit den sellerboard-SKUs,
// sonst Erinnerung. „gekauft“ per Knopf, Sprache/SMS, Claude oder Bestellbestätigungs-Mail → Bestellung „bestellt“.
// Kein automatischer Kauf, kein Kauf-Bot, keine Checkout-Seiten, keine Zahlungsdaten oder Logins im System.

const E = schema.dealEingaenge;
const SP = schema.shopProfile;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Montag dieser Woche (Europe/Berlin) als ISO-Tag. */
function wochenAnfang(heute: string): string {
  const wt = new Date(`${heute}T12:00:00Z`).getUTCDay() || 7;
  return addDaysIso(heute, 1 - wt);
}
const berlinTag = (d = new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);

/** Schon ausgegeben (gekaufte Deals) heute und in dieser Woche. */
export async function budgetVerbraucht(tenantId: string, jetzt = new Date()): Promise<{ tag: number; woche: number }> {
  const heute = berlinTag(jetzt);
  const mo = wochenAnfang(heute);
  const rows = await db
    .select({ tag: sql<string>`to_char(${E.gekauftAm} at time zone 'Europe/Berlin', 'YYYY-MM-DD')`, summe: sql<number>`coalesce(${E.gekauftMenge}, 0) * coalesce(${E.gekauftPreis}, 0)` })
    .from(E)
    .where(and(eq(E.tenantId, tenantId), gte(E.gekauftAm, new Date(`${mo}T00:00:00Z`))));
  let tag = 0;
  let woche = 0;
  for (const r of rows) {
    if (r.tag < mo) continue;
    woche += Number(r.summe);
    if (r.tag === heute) tag += Number(r.summe);
  }
  return { tag: r2(tag), woche: r2(woche) };
}

export async function budgetEinstellung(tenantId: string): Promise<Budget> {
  const d = (await getSettings(tenantId)).dealEingang;
  return { jeDeal: d.budgetJeDeal ?? 0, jeTag: d.budgetJeTag ?? 0, jeWoche: d.budgetJeWoche ?? 0 };
}

export type Monatseinkauf = { monat: string; summe: number; skuSumme: number; skus: number; skusOhneMenge: number; rechnungen: number; rechnungenAnzahl: number; rahmen: number; text: string };

/**
 * Einkaufssumme dieses Monats als Orientierung (keine Sperre): neue sellerboard-SKUs (EK netto × Menge, Kaufdatum
 * aus der SKU) plus Wareneinkaufs-Rechnungen des Monats, die noch keiner Charge zugeordnet sind (zugeordnete stecken
 * schon in den SKUs).
 */
export async function monatEingekauft(tenantId: string, jetzt = new Date()): Promise<Monatseinkauf> {
  const monat = berlinTag(jetzt).slice(0, 7);
  const ab = `${monat}-01`;
  const [y, m] = monat.split("-").map(Number);
  const bis = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  const { kaeufe } = await skuKaeufeLaden(tenantId, jetzt, ab);
  let skuSumme = 0;
  let skus = 0;
  let skusOhneMenge = 0;
  for (const k of kaeufe) {
    if (!k.tag.startsWith(monat)) continue;
    skus++;
    if (k.ekNetto && k.menge) skuSumme += k.ekNetto * k.menge;
    else skusOhneMenge++;
  }
  const I = schema.invoices;
  const [re] = await db
    .select({ summe: sql<string>`coalesce(sum(coalesce(${I.totalNet}, ${I.totalGross} / 1.19)), 0)`, anzahl: sql<number>`count(*)::int` })
    .from(I)
    .where(and(eq(I.tenantId, tenantId), eq(I.kind, "goods"), eq(I.docType, "rechnung"), notInArray(I.status, ["matched", "ignored"]), gte(I.invoiceDate, ab), sql`${I.invoiceDate} < ${bis}`));
  const rechnungen = r2(Number(re?.summe ?? 0));
  const rahmen = (await getSettings(tenantId)).dealEingang.monatsrahmen ?? 150_000;
  const summe = r2(skuSumme + rechnungen);
  return { monat, summe, skuSumme: r2(skuSumme), skus, skusOhneMenge, rechnungen, rechnungenAnzahl: re?.anzahl ?? 0, rahmen, text: monatsrahmenText(summe, rahmen) };
}

/** Shop-Profile: gespeicherte (Einstellungen) überschreiben die Start-Profile. */
export async function shopProfileLaden(tenantId: string): Promise<ShopProfil[]> {
  const rows = await db.select().from(SP).where(eq(SP.tenantId, tenantId));
  return profileZusammen(rows.map((r) => ({ kuerzel: r.kuerzel, name: r.name, domains: r.domains, linkArt: r.linkArt as LinkArt, linkMuster: r.linkMuster, hinweis: r.hinweis, payback: r.payback, aktiv: r.aktiv })));
}

type Eingang = typeof E.$inferSelect;
type Vorschlag = { z: DealEingangZeile; kauf: Omit<DealKauf, "am"> | null; schwelle: number; wert: number | null };

/**
 * Kauf vorbereiten: beste nicht rote Zeile mit ASIN (Grün vor Gelb, dann Gewinn × Menge), Einkaufs-Shop (Lugru-Post:
 * Shop/Quellmarkt; sonst erster Shop-Link der Nachricht), Profil → Link, Menge (Empfehlung, begrenzt durch max. Stück
 * und Budget je Deal), Gutschein aus dem Post, Payback-Hinweis.
 */
export async function kaufVorschlag(e: Eingang): Promise<Vorschlag | null> {
  const s = (await getSettings(e.tenantId)).dealEingang;
  const schwelle = wertSchwelleFuer(e.quelle, s);
  const rang = (z: DealEingangZeile) => (z.ampel === "gruen" ? 2 : (z.wert?.wert ?? 0) >= schwelle ? 1 : 0);
  const z = e.zeilen.filter((x) => x.asin && x.ampel !== "rot").sort((a, b) => rang(b) - rang(a) || (b.gewinn ?? 0) * (b.empfohlen ?? 1) - (a.gewinn ?? 0) * (a.empfohlen ?? 1))[0];
  if (!z) return null;
  const L = schema.lugruDealsHistorie;
  const [lg] = await db.select({ shop: L.shop, shopUrl: L.shopUrl, quellmarkt: L.quellmarkt, maxMenge: L.maxMenge }).from(L).where(and(eq(L.tenantId, e.tenantId), eq(L.eingangId, e.id))).limit(1);
  const profile = await shopProfileLaden(e.tenantId);
  let profil: ShopProfil | null = null;
  let produktUrl: string | null = null;
  let shopName: string | null = null;
  const fremd = (url: string, name: string | null): ShopProfil => ({ kuerzel: "", name: name ?? new URL(url).hostname.replace(/^www\./, ""), domains: [], linkArt: "produktseite", linkMuster: null, hinweis: null, payback: null, aktiv: true });
  if (lg?.shopUrl) {
    produktUrl = lg.shopUrl;
    profil = profilFuer(lg.shopUrl, profile) ?? fremd(lg.shopUrl, lg.shop);
    shopName = lg.shop;
  } else if (lg?.shop && /^amazon\./i.test(lg.shop)) {
    profil = amazonProfil(lg.quellmarkt, profile);
  } else {
    const link = shopLinkAus(e.rohtext);
    if (link) {
      produktUrl = link;
      profil = profilFuer(link, profile) ?? fremd(link, null);
    }
  }
  const wert = z.wert?.wert ?? null;
  if (!profil) return { z, kauf: null, schwelle, wert };
  const menge = kaufMenge(z.empfohlen, { maxMenge: lg?.maxMenge ?? z.angebot.menge, budgetJeDeal: s.budgetJeDeal, ekNetto: z.ekNetto });
  const link = kaufLink(profil, { asin: z.asin, menge, produktUrl, suche: z.titel ?? z.angebot.name });
  if (!link) return { z, kauf: null, schwelle, wert };
  const payback = profil.payback && !(istAmazon(profil) && s.paybackEingerichtet) ? profil.payback : null;
  return {
    z,
    schwelle,
    wert,
    kauf: { zeile: z.nr, asin: z.asin, menge, shop: profil.kuerzel ? profil.name : (shopName ?? profil.name), kuerzel: profil.kuerzel || null, url: link.url, fallbackUrl: link.fallbackUrl, warenkorb: link.warenkorb, hinweis: link.hinweis, gutschein: gutscheinAus(e.rohtext), payback },
  };
}

/** Kauf-Nummer vergeben (kleinste freie der letzten 24 Std.) bzw. die noch gültige behalten; Kauf speichern. */
async function kaufSpeichern(e: Eingang, kauf: Omit<DealKauf, "am">, jetzt = new Date()): Promise<{ nr: number; kauf: DealKauf }> {
  if (e.kaufNr && e.kauf && kaufNrGueltig(e.kauf.am, jetzt)) {
    const k = { ...kauf, am: e.kauf.am };
    await db.update(E).set({ kauf: k }).where(eq(E.id, e.id));
    return { nr: e.kaufNr, kauf: k };
  }
  const belegt = await db
    .select({ nr: E.kaufNr })
    .from(E)
    .where(and(eq(E.tenantId, e.tenantId), isNotNull(E.kaufNr), sql`(${E.kauf}->>'am')::timestamptz > ${new Date(jetzt.getTime() - KAUF_NR_STUNDEN * 3600_000).toISOString()}::timestamptz`));
  const nr = kaufNummerFrei(belegt.map((b) => b.nr!));
  const k: DealKauf = { ...kauf, am: jetzt.toISOString() };
  await db.update(E).set({ kaufNr: nr, kauf: k }).where(eq(E.id, e.id));
  return { nr, kauf: k };
}

export type KaufMeldung = { text: string; link: string; aktionen: { aktion: string; titel: string; link: string }[]; nr: number | null };

/**
 * Kauf-Meldung. Mit Einkaufs-Shop: für jede nicht rote Zeile (auch Gelb unter der Schwelle – Ludwig entscheidet):
 * Amazon „In den Warenkorb (n)“ + „Details“, andere Shops „Produktseite öffnen“ + „Code kopieren“/„Details“.
 * Ohne Shop (Lieferanten-Angebot): nur bei Grün bzw. Deal-Wert ≥ Schwelle „Details“ + „Gekauft …“.
 * Tippen auf die Meldung (iPhone: nur das geht) öffnet bei Grün/≥ Schwelle direkt den Warenkorb, sonst die Details.
 */
export async function kaufMeldung(e: Eingang, jetzt = new Date()): Promise<KaufMeldung | null> {
  const v = await kaufVorschlag(e);
  if (!v) return null;
  const { z, wert, schwelle } = v;
  const stark = z.ampel === "gruen" || (wert ?? 0) >= schwelle;
  if (!v.kauf && !stark) return null;
  const details = `/deal-eingang/${e.id}`;
  const gespeichert = v.kauf ? await kaufSpeichern(e, v.kauf, jetzt) : null;
  const nr = gespeichert?.nr ?? null;
  const k = gespeichert?.kauf ?? null;
  const zeilen = [kaufText({ titel: z.titel, name: z.angebot.name, ekNetto: z.ekNetto, bestesLand: z.bestesLand, roi: z.roi, gewinn: z.gewinn, empfohlen: z.empfohlen, kapitalbedarf: z.kapitalbedarf, maxEk: z.maxEk, gueltigBis: z.angebot.gueltigBis }, { nr, ampel: z.ampel, wert, menge: k?.menge })];
  if (k) zeilen.push(`${k.shop}: ${k.warenkorb ? `Warenkorb vorbereitet (${k.menge} Stk)` : `Produktseite öffnen${k.hinweis ? ` – ${k.hinweis}` : ""}`}${k.gutschein ? ` · Code: ${k.gutschein}` : ""}`);
  if (k?.payback) zeilen.push(istAmazon({ kuerzel: k.kuerzel ?? "" }) ? "Payback noch nicht eingerichtet – Punkte nur mit Start in der PAYBACK-App" : `Payback: ${k.payback}`);
  if (!stark && k) zeilen.push(`Unter der Schwelle (${wert ?? "–"}/${schwelle}) – Details ansehen, du entscheidest.`);
  const monat = await monatEingekauft(e.tenantId, jetzt).catch(() => null);
  if (monat) zeilen.push(monat.text);
  const b = await budgetEinstellung(e.tenantId);
  if (b.jeTag > 0 || b.jeWoche > 0) {
    const hinweis = budgetPruefen(k && z.ekNetto ? k.menge * z.ekNetto : z.kapitalbedarf, { ...b, jeDeal: 0 }, await budgetVerbraucht(e.tenantId, jetzt)).hinweis;
    if (hinweis) zeilen.push(`Hinweis ${hinweis}`);
  }
  let aktionen: KaufMeldung["aktionen"];
  if (k?.warenkorb) aktionen = [{ aktion: "warenkorb", titel: `In den Warenkorb (${k.menge})`, link: `/k/${nr}` }, { aktion: "details", titel: "Details", link: details }];
  else if (k) aktionen = [{ aktion: "produkt", titel: "Produktseite öffnen", link: `/k/${nr}` }, k.gutschein ? { aktion: "code", titel: "Code kopieren", link: `/k/${nr}?code=1` } : { aktion: "details", titel: "Details", link: details }];
  else aktionen = [{ aktion: "details", titel: "Details", link: details }, { aktion: "gekauft", titel: "Gekauft …", link: `/deal-eingang/${e.id}?zeile=${z.nr}#gekauft` }];
  return { text: zeilen.join("\n"), link: k?.warenkorb && stark ? `/k/${nr}` : details, aktionen, nr };
}

export type KaufOeffnen = { ok: true; url: string; eingangId: string; nr: number | null; menge: number; shop: string; warenkorb: boolean; gutschein: string | null } | { ok: false; grund: "unbekannt" | "abgelaufen" | "kein_link"; eingangId?: string };

/**
 * Link öffnen (Push-Knopf, /k/17, „Kaufen 17“): Deal per Kauf-Nummer (24 Std. gültig) oder ID finden, als
 * „Kauf vorbereitet (Menge)“ markieren und den Warenkorb- bzw. Produkt-Link zurückgeben. Gekauft ist damit nichts.
 * Ohne Nummer: neuester offener Deal mit Nummer der letzten 24 Std.
 */
export async function kaufOeffnen(tenantId: string, ref: { nr?: number | null; id?: string | null }, o: { produktseite?: boolean } = {}, jetzt = new Date()): Promise<KaufOeffnen> {
  const seit = new Date(jetzt.getTime() - KAUF_NR_STUNDEN * 3600_000).toISOString();
  let e: Eingang | undefined;
  if (ref.id) [e] = await db.select().from(E).where(and(eq(E.tenantId, tenantId), eq(E.id, ref.id)));
  else if (ref.nr) {
    const treffer = await db.select().from(E).where(and(eq(E.tenantId, tenantId), eq(E.kaufNr, ref.nr))).orderBy(desc(sql`(${E.kauf}->>'am')`)).limit(1);
    e = treffer[0];
    if (e && !kaufNrGueltig(e.kauf?.am, jetzt)) return { ok: false, grund: "abgelaufen", eingangId: e.id };
  } else {
    [e] = await db
      .select()
      .from(E)
      .where(and(eq(E.tenantId, tenantId), isNotNull(E.kaufNr), isNull(E.gekauftAm), sql`(${E.kauf}->>'am')::timestamptz > ${seit}::timestamptz`))
      .orderBy(desc(sql`(${E.kauf}->>'am')`))
      .limit(1);
  }
  if (!e) return { ok: false, grund: "unbekannt" };
  let kauf = e.kauf;
  let nr = e.kaufNr && kaufNrGueltig(e.kauf?.am, jetzt) ? e.kaufNr : null;
  if (!kauf || (ref.id && !nr)) {
    // Von der Detailseite ohne (gültigen) Push: jetzt vorbereiten und Nummer vergeben.
    const v = await kaufVorschlag(e);
    if (!v?.kauf) return { ok: false, grund: "kein_link", eingangId: e.id };
    const g = await kaufSpeichern(e, v.kauf, jetzt);
    kauf = g.kauf;
    nr = g.nr;
  }
  if (!e.gekauftAm) await db.update(E).set({ kaufVorbereitetAm: jetzt, kaufVorbereitetMenge: kauf.menge, kaufErinnertAm: null }).where(eq(E.id, e.id));
  return { ok: true, url: o.produktseite ? (kauf.fallbackUrl ?? kauf.url) : kauf.url, eingangId: e.id, nr, menge: kauf.menge, shop: kauf.shop, warenkorb: kauf.warenkorb && !o.produktseite, gutschein: kauf.gutschein };
}

/**
 * 24 Std. nach „Kauf vorbereitet“: sellerboard-SKU mit gleicher ASIN und Kaufdatum ab dem Vortag (bis 21 Tage) →
 * „gekauft (automatisch: sellerboard-SKU)“ mit Menge/EK aus der SKU. Sonst einmal Erinnerung „Deal 17 noch offen?“;
 * erscheint die SKU später (bis 21 Tage), wird trotzdem noch als gekauft erkannt.
 */
export async function kaufVorbereitetPruefen(tenantId: string, jetzt = new Date()): Promise<{ gekauft: number; erinnert: number }> {
  const faellig = await db
    .select()
    .from(E)
    .where(and(eq(E.tenantId, tenantId), isNotNull(E.kaufVorbereitetAm), lte(E.kaufVorbereitetAm, new Date(jetzt.getTime() - 24 * 3600_000)), gte(E.kaufVorbereitetAm, new Date(jetzt.getTime() - 21 * 86_400_000)), isNull(E.gekauftAm), notInArray(E.status, ["verworfen", "b2b", "preisliste"])))
    .limit(200);
  if (!faellig.length) return { gekauft: 0, erinnert: 0 };
  const frueh = faellig.reduce((m, e) => (e.kaufVorbereitetAm! < m ? e.kaufVorbereitetAm! : m), jetzt);
  const { kaeufe } = await skuKaeufeLaden(tenantId, jetzt, addDaysIso(berlinTag(frueh), -1));
  let gekauft = 0;
  let erinnert = 0;
  const offen: Eingang[] = [];
  for (const e of faellig) {
    const z = e.zeilen.find((x) => x.nr === e.kauf?.zeile) ?? e.zeilen.find((x) => x.asin) ?? null;
    const asin = (e.kauf?.asin ?? z?.asin ?? "").toUpperCase();
    const ab = addDaysIso(berlinTag(e.kaufVorbereitetAm!), -1);
    const bis = addDaysIso(ab, 22);
    const t = asin ? kaeufe.filter((k) => k.asin === asin && k.tag >= ab && k.tag <= bis).sort((a, b) => a.tag.localeCompare(b.tag))[0] : undefined;
    if (!t) {
      if (!e.kaufErinnertAm) offen.push(e);
      continue;
    }
    const r = await db
      .update(E)
      .set({ status: "gekauft", gekauftMenge: t.menge ?? e.kaufVorbereitetMenge ?? 1, gekauftPreis: t.ekNetto ?? z?.ekNetto ?? null, gekauftAm: new Date(`${t.tag}T12:00:00Z`), gekauftWeg: "automatisch", gekauftRef: t.ref.slice(0, 200), entschiedenAm: e.entschiedenAm ?? jetzt })
      .where(and(eq(E.id, e.id), isNull(E.gekauftAm)))
      .returning({ id: E.id });
    if (r.length) gekauft++;
  }
  if (offen.length) {
    const { empfaenger, melden } = await import("@/lib/push/service");
    const an = await empfaenger(tenantId, "dealeingang");
    for (const e of offen) {
      const z = e.zeilen.find((x) => x.nr === e.kauf?.zeile) ?? e.zeilen[0];
      const wann = e.kaufVorbereitetAm!.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      await melden(tenantId, an, {
        titel: `Deal ${e.kaufNr ?? ""} noch offen?`.replace("  ", " "),
        text: `${(z?.titel ?? z?.angebot.name ?? "Deal").slice(0, 50)}: Kauf vorbereitet am ${wann} (${e.kaufVorbereitetMenge ?? "?"} Stk${e.kauf?.shop ? `, ${e.kauf.shop}` : ""}) – in sellerboard noch keine passende SKU. Gekauft? Dann eintragen, sonst verwerfen.`,
        link: `/deal-eingang/${e.id}#gekauft`,
        aktionen: [{ aktion: "gekauft", titel: "Gekauft …", link: `/deal-eingang/${e.id}?zeile=${z?.nr ?? ""}#gekauft` }, { aktion: "details", titel: "Details", link: `/deal-eingang/${e.id}` }],
      });
      await db.update(E).set({ kaufErinnertAm: jetzt }).where(eq(E.id, e.id));
      erinnert++;
    }
  }
  return { gekauft, erinnert };
}

/** Wem gehört der Kauf (Bestellung anlegen)? Person des Eingangs, sonst der Inhaber. */
async function personFuer(tenantId: string, userId: string | null): Promise<string | null> {
  if (userId) return userId;
  const [o] = await db.select({ id: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.role, "owner"))).limit(1);
  return o?.id ?? null;
}

export type Gekauft = { menge: number; preis: number | null; nr?: number | null; weg: "knopf" | "mail" | "sprache" | "claude" | "sms"; ref?: string | null; bestellnr?: string | null; shop?: string | null };

/**
 * Deal als gekauft markieren (Menge, Preis netto je Stück). Legt die Einkaufs-Bestellung als „bestellt“ an (bzw. setzt
 * den Entwurf aus „In Bestellvorschläge“ auf bestellt): Wareneingang wird als Aufgabe erwartet, die Rechnung über die
 * Shop-Bestellnummer automatisch zugeordnet. Zweites „gekauft“ ändert nur Menge/Preis.
 */
export async function alsGekauft(tenantId: string, id: string, g: Gekauft, userId: string | null = null): Promise<{ bestellungId: string | null; zeile: number | null }> {
  if (!(g.menge > 0) || g.menge > 100_000) throw new DealEingangFehler("Bitte eine Menge angeben.");
  if (g.preis !== null && !(g.preis > 0 && g.preis < 100_000)) throw new DealEingangFehler("Preis unplausibel.");
  const [e] = await db.select().from(E).where(and(eq(E.tenantId, tenantId), eq(E.id, id)));
  if (!e) throw new DealEingangFehler("Eingang nicht gefunden.");
  const zeile = (g.nr ? e.zeilen.find((z) => z.nr === g.nr) : null) ?? e.zeilen.filter((z) => z.asin).sort((a, b) => (a.ampel === "gruen" ? -1 : 0) - (b.ampel === "gruen" ? -1 : 0))[0] ?? null;
  const preis = g.preis ?? zeile?.ekNetto ?? zeile?.angebot.ek ?? null;
  const schonGekauft = e.status === "gekauft" && e.gekauftAm;
  await db
    .update(E)
    .set({ status: "gekauft", gekauftMenge: g.menge, gekauftPreis: preis, gekauftAm: e.gekauftAm ?? new Date(), gekauftWeg: e.gekauftWeg ?? g.weg, gekauftRef: g.ref ?? e.gekauftRef, entschiedenAm: e.entschiedenAm ?? new Date() })
    .where(eq(E.id, e.id));
  if (schonGekauft || !zeile?.asin || !preis) return { bestellungId: e.bestellungId, zeile: zeile?.nr ?? null };

  // Bestellung: Entwurf weiterverwenden, sonst neu – Status „bestellt“, erwartet in 7 Tagen (bzw. Lieferzeit).
  const P = await import("@/lib/purchasing/service");
  const person = await personFuer(tenantId, userId ?? e.userId);
  const tage = Number(zeile.angebot.lieferzeit?.match(/(\d{1,2})\s*(?:tag|day|werktag)/i)?.[1] ?? 7) || 7;
  const PO = schema.purchaseOrders;
  const POI = schema.purchaseOrderItems;
  // Entwurf aus „In Bestellvorschläge“: nur übernehmen, wenn er allein diesen Artikel enthält – sonst würden andere
  // Vorschläge mitbestellt. Andernfalls neue Bestellung und den Artikel aus dem Entwurf nehmen.
  let poId: string | null = null;
  const [alt] = e.bestellungId ? await db.select({ status: PO.status }).from(PO).where(and(eq(PO.tenantId, tenantId), eq(PO.id, e.bestellungId))) : [];
  const altItems = alt?.status === "draft" ? await db.select({ id: POI.id, asin: POI.asin }).from(POI).where(and(eq(POI.tenantId, tenantId), eq(POI.poId, e.bestellungId!))) : [];
  if (alt?.status === "draft" && altItems.length && altItems.every((i) => i.asin === zeile.asin)) {
    poId = e.bestellungId;
  } else {
    if (!person) return { bestellungId: null, zeile: zeile.nr };
    poId = await P.createPurchaseOrder(tenantId, person, { supplier: g.shop ?? e.quelle ?? "Deal-Eingang", supplierOrderNo: g.bestellnr ?? undefined, expectedDate: addDaysIso(todayIso(), tage), notes: `Aus dem Deal-Eingang (${g.weg === "mail" ? "Bestellbestätigung" : "gekauft"}).` });
    await P.addItem(tenantId, poId, { asin: zeile.asin, quantity: g.menge, unitCostGross: r2(preis * 1.19), title: zeile.titel ?? zeile.angebot.name });
    for (const i of altItems.filter((x) => x.asin === zeile.asin)) await P.removeItem(tenantId, i.id);
  }
  await P.updatePurchaseOrder(tenantId, poId!, { status: "ordered", supplierOrderNo: g.bestellnr ?? undefined, expectedDate: addDaysIso(todayIso(), tage) });
  await db.update(E).set({ bestellungId: poId }).where(eq(E.id, e.id));
  return { bestellungId: poId, zeile: zeile.nr };
}

/**
 * Bestellbestätigung (Amazon/Shop) aus dem Postfach: passenden offenen Deal der letzten 14 Tage (ASIN, sonst Titel)
 * als gekauft markieren. Gibt die Deal-ID zurück oder null.
 */
export async function gekauftAusMail(tenantId: string, m: { messageKey: string; fromAddress: string; fromName?: string | null; subject: string; text: string }): Promise<string | null> {
  const b = bestellbestaetigung({ von: `${m.fromName ?? ""} <${m.fromAddress}>`, betreff: m.subject, text: m.text });
  if (!b) return null;
  const offen = await db
    .select()
    .from(E)
    .where(and(eq(E.tenantId, tenantId), inArray(E.status, ["neu", "bestellvorschlag"]), eq(E.historisch, false), isNull(E.gekauftAm), gte(E.createdAt, new Date(Date.now() - 14 * 86_400_000))))
    .orderBy(desc(E.createdAt))
    .limit(200);
  for (const pos of b.positionen) {
    for (const e of offen) {
      const z = e.zeilen.find((x) => passtZuDeal(pos, { asin: x.asin, titel: x.titel, name: x.angebot.name }, m.text));
      if (!z) continue;
      await alsGekauft(tenantId, e.id, { menge: pos.menge, preis: pos.preis, nr: z.nr, weg: "mail", ref: `mail:${m.messageKey}`.slice(0, 200), bestellnr: b.bestellnr, shop: b.shop });
      return e.id;
    }
  }
  return null;
}
