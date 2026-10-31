// B20.5: Muster für Amazon-Mails, die nie ein Fall sind – in allen EU-Sprachen (DE, EN, FR, IT, ES, NL, PL, SV).
// Reine Logik ohne Abhängigkeiten (genutzt von Fall-Zentrale und Amazon-ToDos), getestet in tests/amazon-faelle.test.ts.

/** Auszahlungsmitteilung im Betreff („Votre paiement est en cours“, „Ihre Auszahlung ist unterwegs“ …). */
export const AUSZAHLUNG_BETREFF_RE =
  /votre (?:paiement|versement) est en cours|tentative de versement|(?:ihre|deine) auszahlung (?:ist unterwegs|wurde veranlasst)|your (?:payment|disbursement|payout) is on (?:its|the) way|il tuo pagamento (?:è|e) in corso|tu pago est(?:á|a) en camino|(?:uw|je) (?:betaling|uitbetaling) is onderweg|twoja (?:płatność|wypłata) jest w drodze|din utbetalning är på väg/i;

/** „Zahlung wird bearbeitet / paiement en cours“ – Info, nie A-bis-z (vom Auszahlungs-Absender: Auszahlung). */
export const ZAHLUNG_IN_BEARBEITUNG_RE =
  /paiement (?:est )?en cours|zahlung wird (?:bearbeitet|verarbeitet)|payment (?:is )?(?:being processed|in progress|pending)|pagamento (?:è |e )?in (?:corso|elaborazione)|pago (?:en proceso|pendiente)|betaling wordt verwerkt|płatność (?:jest )?przetwarzana|betalningen behandlas/i;

/** Absender der Auszahlungsmitteilungen. */
export const AUSZAHLUNG_ABSENDER_RE = /donotreply@amazon\.|payments?(?:-messages|-notification)?@amazon\./i;

/** Bewertungsanfragen („Transaktion bewerten“, „Recensione“, „How did we do?“) – Archiv, nie „Antwort nötig“. */
export const BEWERTUNG_RE =
  /transaktion bewerten|bewerten sie|bitte bewerten|bewertungsanfrage|wie (?:war|zufrieden waren sie mit) (?:ihre|unsere?)|rate (?:your|this|our)|how (?:did we do|was your (?:experience|support))|\brecensione\b|lascia una recensione|valuta (?:la tua|il nostro)|(?:é|e)valuez|donnez votre avis|valora (?:tu|la|nuestro)|beoordeel|oceń (?:transakcję|naszą)|betygsätt|feedback(?:-| )?(?:request|anfrage)|(?:your|ihr) feedback (?:zu|on|about)/i;

/** Buy-Box-Hinweis: Angebot nicht (mehr) berechtigt für das Einkaufswagen-Feld / die Buy Box. */
export const BUYBOX_RE = new RegExp(
  [
    String.raw`nicht (?:mehr )?(?:für das |im |in das )?einkaufswagen-?feld (?:berechtigt|qualifiziert)`,
    String.raw`einkaufswagen-?feld[^\n]{0,80}nicht (?:mehr )?(?:berechtigt|qualifiziert)`,
    String.raw`nicht (?:mehr )?berechtigt[^\n]{0,80}einkaufswagen-?feld`,
    String.raw`(?:not|no longer) eligible[^\n]{0,60}(?:buy box|featured offer)`,
    String.raw`(?:buy box|featured offer)[^\n]{0,60}(?:not eligible|ineligible|eligibility)`,
    String.raw`(?:n'est pas|ne sont pas|n'est plus|ne sont plus) (?:é|e)ligibles?[^\n]{0,80}(?:buy box|offre (?:mise en avant|en vedette)|encadr(?:é|e) d'achat)`,
    String.raw`non (?:è |e |sono )?(?:più )?idone[oaie][^\n]{0,80}(?:buy box|offerta in evidenza)`,
    String.raw`no (?:es |son )?(?:apt[oa]s?|elegibles?)[^\n]{0,80}(?:buy box|oferta destacada)`,
    String.raw`niet (?:meer )?in aanmerking[^\n]{0,80}(?:buy box|aanbevolen aanbieding)`,
    String.raw`nie kwalifikuj(?:e|ą) się[^\n]{0,80}(?:buy box|polecan)`,
    String.raw`inte (?:längre )?berättigad[^\n]{0,80}(?:buy box|utvalt erbjudande)`,
  ].join("|"),
  "i",
);

const pad = (n: number) => String(n).padStart(2, "0");
const plusTage = (iso: string, n: number) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

export type Auszahlung = { betrag: number | null; waehrung: "EUR" | "GBP" | "SEK" | "PLN"; kontoEndung: string | null; datum: string; erwartetVon: string; erwartetBis: string };

/**
 * Auszahlungsmitteilung lesen: Betrag, Währung, Konto-Endung und Datum der Mail; der Eingang wird in 3–5 Tagen
 * erwartet (Amazon: „in 3 bis 5 Werktagen“). Marktplatz kommt vom Aufrufer (Absender-Domain bzw. Sprache).
 */
export function auszahlungAus(m: { subject: string; text: string; date: string }): Auszahlung {
  const hay = `${m.subject}\n${m.text}`.slice(0, 8000);
  // Beträge deutsch („1.115,52“), englisch („1,115.52“) oder schlicht („369.71“/„369,71“).
  const zahl = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d{1,3}(?:[.\s ]\d{3})*,\d{2}|\d+(?:[.,]\d{2})?`;
  const betragRe = new RegExp(String.raw`(?:€|EUR|£|GBP|SEK|PLN|zł)\s*(${zahl})|(${zahl})\s*(?:€|EUR|£|GBP|SEK|kr|PLN|zł)`);
  const b = betragRe.exec(hay);
  let betrag: number | null = null;
  if (b) {
    const roh = (b[1] ?? b[2]).replace(/[\s ]/g, "");
    const n = /,\d{2}$/.test(roh) ? Number(roh.replace(/\./g, "").replace(",", ".")) : Number(roh.replace(/,/g, ""));
    betrag = Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  }
  const w = b?.[0] ?? "";
  const waehrung = /£|GBP/.test(w) ? "GBP" : /SEK|kr/.test(w) ? "SEK" : /PLN|zł/.test(w) ? "PLN" : "EUR";
  const konto =
    /(?:ending (?:in|with)|endet (?:auf|mit)|endend auf|mit der endung|se terminant par|terminant par|che termina (?:con|in|per)|que termina en|eindigend op|eindigt op|kończąc\w* się na|som slutar på)\s*[:\-]?\s*[*•xX.\s]*(\d{2,4})\b/i.exec(hay)?.[1] ??
    /(?:[*•xX]{2,}|…)\s?(\d{2,4})\b/.exec(hay)?.[1] ??
    null;
  const datum = m.date.slice(0, 10);
  return { betrag, waehrung, kontoEndung: konto, datum, erwartetVon: plusTage(datum, 3), erwartetBis: plusTage(datum, 5) };
}
