// Abgleich Zahlung ↔ Beleg – reine Logik. Reihenfolge laut Bauauftrag: Rechnungsnummer im Verwendungszweck →
// Betrag + Lieferant/IBAN (±3 Tage, Teilzahlungen) → Betrag + Datum ±5 Tage. Sonderfälle vorab: Amex-Sammel-
// abbuchung (= Summe der Einzelumsätze des Abrechnungszeitraums), Amazon/eBay-Auszahlungen (Sammelposten mit
// der Abrechnung), Bankentgelte und Kartenausgleich (kein eigener Beleg nötig). Sicherheit hoch = automatisch.

import { istKartenausgleich } from "./amex";

export type Sicherheit = "hoch" | "mittel" | "niedrig";
export type ZuordnungArt = "beleg" | "amex_sammel" | "marktplatz" | "ohne_beleg";

export type Zahlung = { id: string; datum: string; betrag: number; gegenpartei: string; zweck: string; iban?: string | null; quelle: "bank" | "kreditkarte" };
export type Beleg = { id: string; datum: string | null; brutto: number | null; nummer: string | null; lieferant: string | null; iban?: string | null; gutschrift: boolean };
export type Abrechnung = { id: string; auszahlung: string | null; betrag: number | null; markt: "amazon" | "ebay" };

export type Vorschlag = {
  zahlungId: string;
  belegId: string | null;
  art: ZuordnungArt;
  /** Zugeordneter Betrag (bei Teilzahlung kleiner als der Beleg). */
  betrag: number;
  sicherheit: Sicherheit;
  regel: string;
  /** Amex-Sammelabbuchung: die Einzelumsätze auf dem Kartenkonto. */
  kartenUmsaetze?: string[];
  abrechnungId?: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const gleich = (a: number, b: number) => Math.abs(a - b) < 0.005;
const tage = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

/** Groß, ohne Leer-/Trennzeichen – für den Vergleich von Rechnungsnummern im Verwendungszweck. */
export const kompakt = (s: string) =>
  s
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]/g, "");

const RECHTSFORM = /^(gmbh|ag|kg|ohg|ug|mbh|co|se|sarl|s|a|r|l|ltd|limited|inc|bv|eu|europe|deutschland|germany|services|service|the|und|and)$/;
/** Merkmale eines Namens (Wörter ab 4 Zeichen, ohne Rechtsform). */
export function namensTeile(name: string | null | undefined): string[] {
  if (!name) return [];
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !RECHTSFORM.test(w));
}
const enthaeltName = (text: string, name: string | null) => {
  const t = text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const teile = namensTeile(name);
  return teile.length > 0 && teile.some((w) => t.includes(w));
};

/** Vorzeichen passt: Rechnung = Abgang (negativ), Gutschrift = Eingang (positiv). */
const richtungPasst = (z: Zahlung, b: Beleg) => (b.gutschrift ? z.betrag > 0 : z.betrag < 0);
const belegBetrag = (b: Beleg) => Math.abs(b.brutto ?? NaN);

const ist = {
  amexLastschrift: (z: Zahlung) => z.quelle === "bank" && z.betrag < 0 && /american express|\bamex\b/i.test(`${z.gegenpartei} ${z.zweck}`),
  amazon: (z: Zahlung) => z.betrag > 0 && /amazon (payments|eu|services|europe)|amzn|amazon\.de/i.test(`${z.gegenpartei} ${z.zweck}`),
  ebay: (z: Zahlung) => z.betrag > 0 && /\bebay\b/i.test(`${z.gegenpartei} ${z.zweck}`),
  bankentgelt: (z: Zahlung) => z.quelle === "bank" && /^(entgelt|entgeltabschluss|abschluss|rechnungsabschluss|kontofuehrung|kontoführung|zinsen)/i.test(z.zweck.trim()) && Math.abs(z.betrag) < 500,
  steuer: (z: Zahlung) => z.betrag < 0 && /finanzamt|finanzkasse|steuerverwaltung|bundeszentralamt/i.test(`${z.gegenpartei} ${z.zweck}`),
};

/**
 * Amex-Sammelabbuchung: zusammenhängender Zeitraum von Kartenumsätzen vor der Lastschrift, deren Summe genau dem
 * Lastschriftbetrag entspricht (Kartenausgleich-Zeilen zählen nicht).
 */
export function amexZeitraum(lastschrift: Zahlung, karte: Zahlung[]): { ids: string[]; von: string; bis: string } | null {
  const vorher = karte
    .filter((k) => !istKartenausgleich(`${k.gegenpartei} ${k.zweck}`) && k.datum < lastschrift.datum && tage(lastschrift.datum, k.datum) <= 75)
    .sort((a, b) => a.datum.localeCompare(b.datum) || a.id.localeCompare(b.id));
  for (let ende = vorher.length - 1; ende >= 0; ende--) {
    let summe = 0;
    for (let start = ende; start >= 0; start--) {
      summe += vorher[start].betrag;
      if (gleich(summe, lastschrift.betrag)) return { ids: vorher.slice(start, ende + 1).map((k) => k.id), von: vorher[start].datum, bis: vorher[ende].datum };
      if (summe < lastschrift.betrag - 0.005 && vorher.slice(0, start).every((k) => k.betrag <= 0)) break;
    }
  }
  return null;
}

/**
 * Alle Zahlungen einordnen. `belege` = offene Belege (noch ohne bestätigte Zuordnung), `karte` = alle Kartenumsätze
 * (auch bereits zugeordnete – für die Summenprüfung der Sammelabbuchung).
 */
export function abgleichen(zahlungen: Zahlung[], belege: Beleg[], o: { karte?: Zahlung[]; abrechnungen?: Abrechnung[] } = {}): { vorschlaege: Vorschlag[]; ohneZuordnung: Zahlung[] } {
  const vorschlaege: Vorschlag[] = [];
  const erledigt = new Set<string>();
  const belegRest = new Map(belege.map((b) => [b.id, belegBetrag(b)]));
  const nimm = (v: Vorschlag) => {
    vorschlaege.push(v);
    erledigt.add(v.zahlungId);
    if (v.belegId) belegRest.set(v.belegId, r2((belegRest.get(v.belegId) ?? 0) - v.betrag));
  };
  const frei = (b: Beleg) => (belegRest.get(b.id) ?? 0) > 0.005 && b.brutto !== null;
  const offen = () => zahlungen.filter((z) => !erledigt.has(z.id));

  // 0) Sonderfälle ohne Einzelbeleg.
  const verbrauchteKarte = new Set<string>();
  for (const z of offen()) {
    if (ist.amexLastschrift(z)) {
      const zr = amexZeitraum(z, (o.karte ?? []).filter((k) => !verbrauchteKarte.has(k.id)));
      if (zr) {
        zr.ids.forEach((id) => verbrauchteKarte.add(id));
        nimm({ zahlungId: z.id, belegId: null, art: "amex_sammel", betrag: Math.abs(z.betrag), sicherheit: "hoch", regel: `Amex-Sammelabbuchung = Summe von ${zr.ids.length} Kartenumsätzen ${dm(zr.von)}–${dm(zr.bis)}`, kartenUmsaetze: zr.ids });
      } else nimm({ zahlungId: z.id, belegId: null, art: "amex_sammel", betrag: Math.abs(z.betrag), sicherheit: "niedrig", regel: "Amex-Lastschrift – Summe der Kartenumsätze passt nicht (Amex-CSV des Zeitraums hochladen)" });
    } else if (z.quelle === "kreditkarte" && istKartenausgleich(`${z.gegenpartei} ${z.zweck}`)) {
      nimm({ zahlungId: z.id, belegId: null, art: "ohne_beleg", betrag: Math.abs(z.betrag), sicherheit: "hoch", regel: "Ausgleich des Kartenkontos (Lastschrift) – kein Beleg nötig" });
    } else if (ist.amazon(z) || ist.ebay(z)) {
      const markt = ist.amazon(z) ? "amazon" : "ebay";
      const a = (o.abrechnungen ?? []).find((x) => x.markt === markt && x.betrag !== null && gleich(x.betrag, z.betrag) && (!x.auszahlung || Math.abs(tage(z.datum, x.auszahlung)) <= 5));
      nimm(a
        ? { zahlungId: z.id, belegId: null, art: "marktplatz", betrag: z.betrag, sicherheit: "hoch", regel: `${markt === "amazon" ? "Amazon" : "eBay"}-Auszahlung = Abrechnung ${a.id}`, abrechnungId: a.id }
        : { zahlungId: z.id, belegId: null, art: "marktplatz", betrag: z.betrag, sicherheit: "mittel", regel: `${markt === "amazon" ? "Amazon" : "eBay"}-Auszahlung – passende Abrechnung fehlt (Abrechnungsbericht abrufen/hochladen)` });
    } else if (ist.bankentgelt(z)) {
      nimm({ zahlungId: z.id, belegId: null, art: "ohne_beleg", betrag: Math.abs(z.betrag), sicherheit: "hoch", regel: "Bankentgelt/Zinsen – der Kontoauszug ist der Beleg" });
    }
  }

  // 1) Rechnungsnummer im Verwendungszweck.
  for (const z of offen()) {
    const text = kompakt(`${z.zweck} ${z.gegenpartei}`);
    const treffer = belege.filter((b) => frei(b) && richtungPasst(z, b) && b.nummer && kompakt(b.nummer).length >= 4 && /\d/.test(b.nummer) && text.includes(kompakt(b.nummer)));
    if (!treffer.length) continue;
    const b = treffer.sort((x, y) => kompakt(y.nummer!).length - kompakt(x.nummer!).length)[0];
    const rest = belegRest.get(b.id)!;
    const betrag = Math.abs(z.betrag);
    if (gleich(betrag, rest)) nimm({ zahlungId: z.id, belegId: b.id, art: "beleg", betrag, sicherheit: "hoch", regel: `Rechnungsnummer ${b.nummer} im Verwendungszweck, Betrag passt` });
    else if (betrag < rest) nimm({ zahlungId: z.id, belegId: b.id, art: "beleg", betrag, sicherheit: "mittel", regel: `Rechnungsnummer ${b.nummer} im Verwendungszweck – Teilzahlung (${r2(rest - betrag)} € offen)` });
    else nimm({ zahlungId: z.id, belegId: b.id, art: "beleg", betrag: rest, sicherheit: "mittel", regel: `Rechnungsnummer ${b.nummer} im Verwendungszweck – Zahlung höher als Beleg` });
  }

  // 2) Betrag + Lieferant/IBAN (±3 Tage hoch, bis 60 Tage nach Belegdatum mittel).
  for (const z of offen()) {
    const passend = belege
      .filter((b) => frei(b) && richtungPasst(z, b) && b.datum && gleich(Math.abs(z.betrag), belegRest.get(b.id)!) && ((b.iban && z.iban && b.iban === z.iban) || enthaeltName(`${z.gegenpartei} ${z.zweck}`, b.lieferant)))
      .map((b) => ({ b, d: tage(z.datum, b.datum!) }))
      .filter((x) => x.d >= -3 && x.d <= 60)
      .sort((x, y) => Math.abs(x.d) - Math.abs(y.d));
    if (!passend.length) continue;
    const { b, d } = passend[0];
    nimm({ zahlungId: z.id, belegId: b.id, art: "beleg", betrag: Math.abs(z.betrag), sicherheit: Math.abs(d) <= 3 ? "hoch" : "mittel", regel: `Betrag und ${b.iban && z.iban === b.iban ? "IBAN" : `Lieferant „${b.lieferant}“`} passen, ${Math.abs(d) <= 3 ? "±3 Tage" : `${d} Tage nach Belegdatum`}` });
  }
  // 2b) Teilzahlungen: mehrere Zahlungen an denselben Lieferanten ergeben zusammen den Beleg.
  for (const b of belege.filter(frei)) {
    const kand = offen()
      .filter((z) => richtungPasst(z, b) && b.datum && enthaeltName(`${z.gegenpartei} ${z.zweck}`, b.lieferant) && tage(z.datum, b.datum) >= -3 && tage(z.datum, b.datum) <= 90)
      .sort((x, y) => x.datum.localeCompare(y.datum));
    for (let n = 2; n <= Math.min(4, kand.length); n++) {
      const teil = kand.slice(0, n);
      if (gleich(teil.reduce((s, z) => s + Math.abs(z.betrag), 0), belegRest.get(b.id)!)) {
        teil.forEach((z, i) => nimm({ zahlungId: z.id, belegId: b.id, art: "beleg", betrag: Math.abs(z.betrag), sicherheit: "mittel", regel: `Teilzahlung ${i + 1}/${n} an „${b.lieferant}“ – zusammen = Beleg` }));
        break;
      }
    }
  }

  // 3) Betrag + Datum ±5 Tage (ohne Namensbezug): eindeutig = mittel, mehrere = niedrig.
  for (const z of offen()) {
    const passend = belege
      .filter((b) => frei(b) && richtungPasst(z, b) && b.datum && gleich(Math.abs(z.betrag), belegRest.get(b.id)!) && Math.abs(tage(z.datum, b.datum)) <= 5)
      .sort((x, y) => Math.abs(tage(z.datum, x.datum!)) - Math.abs(tage(z.datum, y.datum!)));
    if (!passend.length) continue;
    nimm({ zahlungId: z.id, belegId: passend[0].id, art: "beleg", betrag: Math.abs(z.betrag), sicherheit: passend.length === 1 ? "mittel" : "niedrig", regel: `Betrag passt, Datum ${tage(z.datum, passend[0].datum!)} Tage${passend.length > 1 ? ` (${passend.length} mögliche Belege)` : ""}` });
  }

  // Steuerzahlungen: Bescheid/Voranmeldung ist der Beleg – zur Bestätigung.
  for (const z of offen()) if (ist.steuer(z)) nimm({ zahlungId: z.id, belegId: null, art: "ohne_beleg", betrag: Math.abs(z.betrag), sicherheit: "mittel", regel: "Steuerzahlung – Bescheid bzw. Voranmeldung als Beleg ablegen" });

  return { vorschlaege, ohneZuordnung: offen() };
}

/** Abstimmungsgrad in %: Zahlungen mit (bestätigter oder automatischer) Zuordnung ÷ alle Zahlungen. */
export const abstimmungsgrad = (zugeordnet: number, gesamt: number) => (gesamt === 0 ? null : Math.round((zugeordnet / gesamt) * 100));
