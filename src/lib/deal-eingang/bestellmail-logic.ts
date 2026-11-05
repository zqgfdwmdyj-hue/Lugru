// B28.5 Bestellmail an den Lieferanten bei „Gekauft“ – reine Logik: Lieferant zur Deal-Quelle finden, Mailtext aus
// der Vorlage, Antwort des Lieferanten zuordnen (In-Reply-To bzw. Absender + ASIN im Betreff) und darin Sendungsnummer
// und Rechnung erkennen. Gesendet wird nie automatisch – immer erst Entwurf, dann „Senden“ von Hand.

import { VERPACKUNG_TEXT, type DEAL_VERPACKUNG } from "@/db/tables/deal-eingang";

export type DealLieferant = {
  supplierId: string;
  name: string;
  email: string | null;
  ansprechpartner: string | null;
  zahlungsweg: string | null;
  rechnungMitEan: boolean;
  /** Stichworte der Deal-Quelle („Konrad“, „WhatsApp-Deals“) – Teil des Felds „Quelle“ am Deal. */
  dealQuellen: string[];
};

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** Lieferant zur Quelle eines Deals: Stichwort, Name oder Ansprechpartner kommt in der Quelle vor (längster Treffer gewinnt). */
export function lieferantFuerQuelle(quelle: string | null | undefined, liste: DealLieferant[]): DealLieferant | null {
  const q = norm(quelle);
  if (!q) return null;
  let best: { l: DealLieferant; n: number } | null = null;
  for (const l of liste) {
    for (const w of [...l.dealQuellen, l.name, l.ansprechpartner ?? ""].map(norm).filter((x) => x.length >= 3)) {
      if ((q === w || q.includes(w) || w.includes(q)) && (!best || w.length > best.n)) best = { l, n: w.length };
    }
  }
  return best?.l ?? null;
}

const eur = (n: number) => `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export type BestellArtikel = {
  titel: string | null;
  asin: string | null;
  ean: string | null;
  menge: number;
  preisNetto: number;
  zustand: string | null;
  verpackung: (typeof DEAL_VERPACKUNG)[number] | null;
};

/** Firma als Rechnungs- und Lieferadresse (mehrzeilig, erste Zeile = Name) und USt-IdNr. */
export type BestellFirma = { adresse: string; ustId: string | null; telefon: string | null; email: string | null };

/** Betreff mit ASIN – darüber wird auch eine Antwort ohne In-Reply-To zugeordnet. */
export function bestellBetreff(a: Pick<BestellArtikel, "titel" | "asin" | "menge">, firmaName: string) {
  const t = (a.titel ?? "Artikel").replace(/\s+/g, " ").trim();
  return `Bestellung ${firmaName}: ${a.menge} × ${t.length > 60 ? `${t.slice(0, 58)}…` : t}${a.asin ? ` (ASIN ${a.asin})` : ""}`;
}

/** Mailtext der Auftragsbestätigung (Entwurf, bearbeitbar). */
export function bestellmailText(o: { lieferant: Pick<DealLieferant, "name" | "ansprechpartner" | "zahlungsweg" | "rechnungMitEan">; firma: BestellFirma; artikel: BestellArtikel }): { betreff: string; text: string } {
  const a = o.artikel;
  const zeilen = o.firma.adresse.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const firmaName = zeilen[0] ?? "LuGru GmbH";
  const zustand = [a.zustand?.trim() || "neu", a.verpackung ? VERPACKUNG_TEXT[a.verpackung] : null].filter(Boolean).join(", ");
  const gesamt = Math.round(a.menge * a.preisNetto * 100) / 100;
  const text = [
    `Hallo ${o.lieferant.ansprechpartner?.trim() || o.lieferant.name},`,
    "",
    "hiermit bestätigen wir unsere Bestellung:",
    "",
    `Artikel: ${a.titel ?? "–"}`,
    ...(a.asin ? [`ASIN: ${a.asin}`] : []),
    ...(a.ean ? [`EAN: ${a.ean}`] : []),
    `Zustand/Verpackung: ${zustand}`,
    `Menge: ${a.menge} Stück`,
    `Preis: ${eur(a.preisNetto)} netto je Stück, gesamt ${eur(gesamt)} netto (zzgl. USt.)`,
    "",
    "Lieferadresse:",
    ...zeilen,
    "",
    "Bitte stellen Sie die Rechnung aus auf:",
    `${zeilen.join(", ")}${o.firma.ustId ? `, USt-IdNr. ${o.firma.ustId}` : ""}`,
    `Auf der Rechnung bitte: vollständige Anschrift, Artikelbezeichnung, Menge${o.lieferant.rechnungMitEan ? " und EAN je Position (Echtheitsnachweis für Amazon)" : ""}.`,
    "",
    `Zahlung: ${o.lieferant.zahlungsweg?.trim() || "wie vereinbart"}`,
    "",
    "Bitte senden Sie uns nach dem Versand die Sendungsnummer.",
    "",
    "Viele Grüße",
    firmaName,
    ...(o.firma.telefon ? [`Tel. ${o.firma.telefon}`] : []),
  ].join("\n");
  return { betreff: bestellBetreff(a, firmaName), text };
}

/** Sendungsnummer in der Antwort: nach Stichwort („Sendungsnummer“, „Tracking“ …) bzw. typische Formate (DHL JJD…, UPS 1Z…). */
export function sendungsnummerAus(text: string): string | null {
  const t = text.replace(/ /g, " ");
  const stich = /(?:sendungs(?:nummer|nr\.?)|tracking(?:[- ]?(?:nummer|nr\.?|number|id|code))?|paket(?:nummer|nr\.?)|sendungsverfolgung|track(?:ing)?[- ]?nr\.?)\s*(?:lautet|ist|is)?\s*[:#]?\s*([A-Z0-9][A-Z0-9 ]{7,34}[A-Z0-9])/i.exec(t);
  if (stich) {
    const n = stich[1].replace(/\s+/g, "");
    if (/\d{6,}/.test(n) && n.length >= 8 && n.length <= 35) return n.toUpperCase();
  }
  // Ohne Stichwort nur eindeutige Formate (eine 13-stellige Zahl könnte auch die EAN sein).
  const fest = /\b(JJD\d{16,20}|1Z[0-9A-Z]{16}|00\d{18})\b/.exec(t);
  return fest ? fest[1] : null;
}

/** Rechnung in der Antwort: Anhang bzw. Betreff mit „Rechnung/Invoice“. */
export const rechnungErkannt = (betreff: string, anhaenge: string[]) => anhaenge.some((n) => /rechnung|invoice|faktur|\bre[-_ ]?\d/i.test(n)) || /\b(rechnung|invoice|faktura)\b/i.test(betreff);

export type GesendeteBestellmail = { id: string; an: string; messageId: string | null; betreff: string; asin: string | null; gesendetAm: Date };

const adresse = (s: string) => (/<([^>]+)>/.exec(s)?.[1] ?? s).trim().toLowerCase();
const ohneKlammern = (s: string) => s.trim().replace(/^<|>$/g, "").toLowerCase();

/**
 * Welche gesendete Bestellmail beantwortet diese Mail? 1) In-Reply-To/References = Message-ID der Bestellmail;
 * 2) Absender = Empfänger der Bestellmail und Betreff mit ASIN bzw. „AW:/Re: <Betreff>“ (höchstens 60 Tage alt).
 */
export function bestellmailFuerAntwort(m: { fromAddress: string; subject: string; antwortAuf: string[]; receivedAt: Date }, gesendet: GesendeteBestellmail[]): string | null {
  const refs = new Set(m.antwortAuf.map(ohneKlammern));
  const perId = gesendet.find((g) => g.messageId && refs.has(ohneKlammern(g.messageId)));
  if (perId) return perId.id;
  const von = adresse(m.fromAddress);
  const betreff = norm(m.subject).replace(/^((re|aw|wg|fw|fwd)\s*:\s*)+/i, "");
  const kandidaten = gesendet
    .filter((g) => g.an.split(/[,;]/).map(adresse).includes(von) && m.receivedAt.getTime() >= g.gesendetAm.getTime() && m.receivedAt.getTime() - g.gesendetAm.getTime() <= 60 * 86_400_000)
    .filter((g) => (g.asin && norm(m.subject).includes(g.asin.toLowerCase())) || betreff === norm(g.betreff))
    .sort((a, b) => b.gesendetAm.getTime() - a.gesendetAm.getTime());
  return kandidaten[0]?.id ?? null;
}

/** Zeile der Firmenadresse aus dem DHL-Absender (Einstellungen → Versand), wenn keine eigene Bestelladresse eingetragen ist. */
export function adresseAusAbsender(a: { name1?: string; name2?: string; street?: string; houseNo?: string; zip?: string; city?: string } | null | undefined): string {
  if (!a?.name1) return "";
  return [a.name1, a.name2, [a.street, a.houseNo].filter(Boolean).join(" "), [a.zip, a.city].filter(Boolean).join(" ")].filter((x) => x && x.trim()).join("\n");
}
