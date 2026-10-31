// B19.1: alte Lugru-Deals (History) in den Deal-Eingang – reine Logik. Gleiche Regeln wie die Deal-Ampel (Marge beim
// 90-Tage-Mittel, Amazon-Anteil, Preisverfall, Angebote, Abverkauf), aber ohne neue Keepa-Abfragen: Zahlen aus dem
// Post (EK, VK, Gewinn, Verkäufe) und dem Keepa-Schnappschuss beim Posten. Kein Push. Getestet in tests/lugru-historie.test.ts.

import type { DealEingangZeile, DealLandZeile, LugruKeepa } from "@/db/tables/deal-eingang";
import { dealAmpel, ekNettoAus, rechneLand, type DealAmpelEinstellungen, type LandMarkt } from "@/lib/deal-ampel/logic";
import { MWST } from "@/lib/b2b/logic";
import { dreiGruende, maxEk, pushText } from "@/lib/deal-eingang/logic";

export const HISTORIE_HINWEIS = "Historie: Ampel aus den Zahlen des Posts und dem Keepa-Stand beim Posten – nicht neu bei Keepa geprüft. Vor einem Kauf heute neu prüfen.";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Marktplatz aus der Angabe im Post („DE“, „Amazon.de“, „amazon.co.uk“, „GB“ …); unbekannt → DE. */
export function landAus(markt: string | null | undefined): string {
  const m = (markt ?? "").trim().toUpperCase();
  if (!m) return "DE";
  if (/CO\.UK|\bUK\b|\bGB\b/.test(m)) return "UK";
  const tld = m.match(/\.([A-Z]{2})\b/)?.[1];
  const code = tld ?? m.match(/^[A-Z]{2}$/)?.[0] ?? null;
  return code && MWST[code] !== undefined ? code : "DE";
}

/** Kanalname ohne Leerzeichen am Rand und doppelte Leerzeichen („B low Marge “ → „B low Marge“). */
export const kanalName = (roh: string | null | undefined): string | null => {
  const k = (roh ?? "").replace(/\s+/g, " ").trim();
  return k || null;
};

/** Testkanäle der Gruppe („test“, „test1“, „Test 2“) – standardmäßig ausgeblendet. */
export const istTestKanal = (k: string | null | undefined): boolean => /^test\s*\d*$/i.test((k ?? "").trim());
/** Dasselbe Muster für Postgres (~*). */
export const TEST_KANAL_SQL = "^test\\s*\\d*$";

export type HistorienDeal = {
  asin: string;
  titel: string | null;
  quellmarkt: string | null;
  zielmarkt: string | null;
  ekEur: number | null;
  ekNetto: boolean | null;
  vkEur: number | null;
  gewinnEur: number | null;
  margeProzent: number | null;
  verkaeufeMonat: number | null;
  shop: string | null;
  kanal: string | null;
  gepostetAm: Date;
  keepa: LugruKeepa | null;
};

/**
 * Gebühren je Stück wie im Post: vkNetto − Gewinn − EK. Aufgeteilt in Provision (Satz aus den Einstellungen) und
 * einen festen Rest, damit beim 90-Tage-Mittel mit passenden Gebühren gerechnet wird. Ohne Gewinn im Post: Pauschale.
 */
export function gebuehrenAusPost(o: { vk: number; mwst: number; gewinn: number | null; ekNetto: number }, pauschal: { provision: number; fba: number }): { provision: number; fba: number; ausPost: boolean } {
  if (o.gewinn === null) return { ...pauschal, ausPost: false };
  const geb = o.vk / (1 + o.mwst) - o.gewinn - o.ekNetto;
  if (!(geb > 0)) return { ...pauschal, ausPost: false };
  const prov = o.vk * pauschal.provision;
  return prov <= geb ? { provision: pauschal.provision, fba: r2(geb - prov), ausPost: true } : { provision: Math.round((geb / o.vk) * 10000) / 10000, fba: 0, ausPost: true };
}

/** Eine geprüfte Zeile für den Deal-Eingang (Ampel nach den Regeln der Deal-Ampel). */
export function historienZeile(d: HistorienDeal, cfg: DealAmpelEinstellungen, o: { pauschal: { provision: number; fba: number }; zielRoi: number; jetzt: Date }): DealEingangZeile {
  const land = landAus(d.zielmarkt);
  const mwst = MWST[land] ?? 0.2;
  const k = d.keepa;
  const vk = d.vkEur !== null && d.vkEur > 0 ? d.vkEur : (k?.buyBox ?? null);
  const ek = d.ekEur !== null && d.ekEur > 0 ? d.ekEur : null;
  const ekN = ek === null ? null : ekNettoAus(ek, d.ekNetto === true, MWST[landAus(d.quellmarkt)] ?? 0.19);
  const geb = vk !== null && ekN !== null ? gebuehrenAusPost({ vk, mwst, gewinn: d.gewinnEur, ekNetto: ekN }, o.pauschal) : { ...o.pauschal, ausPost: false };
  const fehler = vk === null ? "kein VK im Post und kein Keepa-Stand" : ekN === null ? "kein EK im Post" : null;
  const markt: LandMarkt = {
    land,
    vkEur: vk,
    vk90Eur: k?.buyBox90 ?? null,
    tief12Eur: null,
    mwstSatz: mwst,
    verkaeufeMonat: d.verkaeufeMonat ?? k?.gekauftImMonat ?? null,
    angebote: k?.angebote ?? null,
    amazonProzent: k?.amazonAnteil ?? null,
    aktionsmuster: null,
    fehler,
    gebuehren: { provision: geb.provision, fba: geb.fba },
  };
  const l = fehler ? { ...markt, aktuell: null, schnitt90: null } : rechneLand(markt, o.pauschal, ekN!, cfg.nebenkosten);
  const a = dealAmpel([l], null, cfg);
  const gelb = [...a.gelb];
  if (!k) gelb.push("Kein Keepa-Stand beim Posten – Preisverlauf, Angebote und Amazon-Anteil unbekannt.");
  if (d.ekNetto === null && ekN !== null) gelb.push("Netto/brutto im Post nicht erkennbar – als brutto gerechnet.");
  const ampel = a.rot.length ? "rot" : gelb.length ? "gelb" : "gruen";
  const b = a.bestes;
  const r = b?.schnitt90 ?? b?.aktuell ?? null;
  const basis = l.schnitt90 ?? l.aktuell;
  const mEk = basis ? maxEk({ vkNetto: basis.vkNetto, gebuehren: basis.gebuehren, prep: cfg.nebenkosten, zielRoi: o.zielRoi }) : null;
  const landZeile: DealLandZeile = { land, vkEur: vk, vk90Eur: markt.vk90Eur, tief12Eur: null, verkaeufeMonat: markt.verkaeufeMonat, angebote: markt.angebote, amazonProzent: markt.amazonProzent, gewinn: l.schnitt90?.gewinn ?? null, gewinnAktuell: l.aktuell?.gewinn ?? null, roi: l.schnitt90?.roi ?? null, marge: l.schnitt90?.marge ?? null, maxEk: mEk, fehler };
  const hinweise = [HISTORIE_HINWEIS, geb.ausPost ? "Gebühren aus dem Gewinn im Post abgeleitet." : "Gebühren pauschal (Einstellungen), im Post stand kein Gewinn."];
  if (d.gewinnEur !== null || d.margeProzent !== null) hinweise.push(`Laut Post: ${d.gewinnEur !== null ? `Gewinn ${String(d.gewinnEur).replace(".", ",")} €` : ""}${d.gewinnEur !== null && d.margeProzent !== null ? " · " : ""}${d.margeProzent !== null ? `Marge ${String(d.margeProzent).replace(".", ",")} %` : ""}.`);
  return {
    nr: 1,
    angebot: { asin: d.asin, ean: null, name: d.titel, marke: k?.marke ?? null, ek, ekNetto: d.ekNetto, waehrung: "EUR", menge: null, moq: null, staffel: null, versand: null, lieferzeit: null, zahlung: null, gueltigBis: null, zustand: "neu", packung: null },
    asin: d.asin,
    zuordnung: "asin",
    vorschlaege: [],
    titel: d.titel,
    ampel,
    gruende: dreiGruende(a.rot, gelb),
    bestesLand: b?.land ?? land,
    ekNetto: ekN,
    gewinn: r?.gewinn ?? null,
    roi: r?.roi ?? null,
    marge: r?.marge ?? null,
    angebote: markt.angebote,
    amazonProzent: markt.amazonProzent,
    verkaeufeMonat: markt.verkaeufeMonat,
    empfohlen: a.abverkauf.empfohlen?.bis ?? null,
    kapitalbedarf: null,
    maxEk: mEk !== null ? [{ land, ek: mEk }] : [],
    laender: [landZeile],
    eigen: null,
    risiken: [],
    hinweise,
    fehler: null,
    geprueftAm: o.jetzt.toISOString(),
  };
}

/** Kurztext wie im Push (aber ohne Push) für die Liste im Deal-Eingang. */
export const historienText = (z: DealEingangZeile) => pushText([{ ...z, name: z.angebot.name }]);

/** Kennung des Eingangs (gleich wie beim Live-Eingang, damit nichts doppelt entsteht). */
export const historienRef = (d: { discordNachrichtId: string | null; externId: number | null; id: string }) => (d.discordNachrichtId ? `lugru:${d.discordNachrichtId}` : d.externId !== null ? `lugru-app:${d.externId}` : `lugru-id:${d.id}`);
