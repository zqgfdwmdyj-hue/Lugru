// Amazon-Fall-Zentrale – reine Logik: Amazon-Mails einordnen (Bereich, Phase, Bezüge, Frist, Dringlichkeit), zu
// bestehenden Vorgängen zuordnen und Pakete (Freischaltung, Fall-Antwort) vorbereiten. Alle EU-Sprachen
// (DE, EN, FR, IT, ES, NL, PL, SV). Ohne Datenbank – getestet in tests/amazon-faelle.test.ts.

import { deadlineFromText, extractAsins, extractSkus, marktplatzAus } from "@/lib/amazon-todos/logic";
import { BESTELL_MAIL_RE, FBA_VERSAND_RE } from "@/lib/amazon-todos/versand";

export const BEREICHE = ["freischaltung", "fall", "erstattung_kunde", "entschaedigung", "marke", "angebot", "kontozustand", "a_bis_z", "fba_sendung", "info", "sonstiges"] as const;
export type Bereich = (typeof BEREICHE)[number];

export const BEREICH_LABEL: Record<Bereich, string> = {
  freischaltung: "Freischaltung",
  fall: "Fall (Seller Support)",
  erstattung_kunde: "Erstattung an Kunden",
  entschaedigung: "Entschädigung von Amazon",
  marke: "Markenbeschwerde / Echtheit",
  angebot: "Angebot deaktiviert / unterdrückt",
  kontozustand: "Kontozustand / Richtlinie",
  a_bis_z: "A-bis-z / Rückbuchung",
  fba_sendung: "FBA-Sendung",
  info: "Nur Info",
  sonstiges: "Sonstiges",
};

/** Phasen je Bereich (Freischaltung und Fall haben eigene Abläufe, der Rest „offen“/„info“). */
export const PHASEN = ["beantragt", "genehmigt", "abgelehnt", "nachreichen", "entzogen", "eroeffnet", "antwort_noetig", "beantwortet", "geloest", "geschlossen_ohne", "wieder_offen", "eingereicht", "offen", "info"] as const;
export type Phase = (typeof PHASEN)[number];

export const PHASE_LABEL: Record<Phase, string> = {
  beantragt: "beantragt",
  genehmigt: "genehmigt",
  abgelehnt: "abgelehnt",
  nachreichen: "Unterlagen nachreichen",
  entzogen: "entzogen",
  eroeffnet: "eröffnet",
  antwort_noetig: "Antwort nötig",
  beantwortet: "von Amazon beantwortet",
  geloest: "gelöst",
  geschlossen_ohne: "geschlossen ohne Lösung",
  wieder_offen: "wieder geöffnet",
  eingereicht: "eingereicht – wartet auf Amazon",
  offen: "offen",
  info: "Info",
};

export type Dringlichkeit = "rot" | "gelb" | "grau";

export const ABLEHNUNGSGRUND_LABEL = {
  rechnung_zu_alt: "Rechnung zu alt (> 180 Tage)",
  menge_zu_gering: "Menge zu gering (< 10 Stück)",
  kein_hersteller: "Lieferant ist kein Hersteller/Großhändler",
  adresse_passt_nicht: "Adresse/Firmenname passt nicht zum Konto",
  unleserlich: "Rechnung unleserlich/unvollständig",
  preise_geschwaerzt: "Preise geschwärzt",
  kontakt_fehlt: "Kontaktdaten des Lieferanten fehlen",
  autorisierung: "Autorisierungsschreiben nötig",
  sonstiges: "sonstiger Grund",
} as const;
export type Ablehnungsgrund = keyof typeof ABLEHNUNGSGRUND_LABEL;

export const VERLANGT_LABEL = {
  pod: "Zustellnachweis (POD)",
  shipment_id: "Sendungsnummer (Shipment-ID)",
  rechnung: "Rechnung",
  fotos: "Fotos",
  seriennummer: "Seriennummer",
  packliste: "Packliste / Lieferschein",
  tracking: "Sendungsverfolgung (Tracking)",
} as const;
export type Verlangt = keyof typeof VERLANGT_LABEL;

export type Einordnung = {
  bereich: Bereich;
  phase: Phase;
  dringlichkeit: Dringlichkeit;
  /** 0–1; unter 0,6 = „bitte prüfen“. */
  sicherheit: number;
  fallnummer: string | null;
  asins: string[];
  skus: string[];
  marktplatz: string | null;
  bestellnummer: string | null;
  shipmentId: string | null;
  betrag: number | null;
  frist: string | null;
  ablehnungsgruende: Ablehnungsgrund[];
  verlangt: Verlangt[];
  /** Bestell-/Versand-/Zahlungsmail – nie ein Vorgang. */
  routine: boolean;
  /** B19.4: welche Routine – „zahlung_fehler“ (Zahlung abgelehnt) wird eine Aufgabe je Bestellung, der Rest archiviert. */
  routineArt: RoutineArt | null;
  /** Woher die Frist stammt: aus der Mail oder Standardfrist (Tage je Bereich/Phase). */
  fristQuelle: "mail" | "standard" | null;
};

export const UNSICHER_AB = 0.6;

// ---- Muster (alle EU-Sprachen) ------------------------------------------------------------------------------

const FALLNUMMER = [
  /(?:fall-?id|fallnummer|case[- ]?id|case number|id (?:de|du) cas|id(?:entificativo)? (?:del )?caso|id del caso|n[uú]mero de caso|zaak-?id|zaaknummer|id zg[lł]oszenia|numer zg[lł]oszenia|ärende-?id|ärendenummer)\s*[:#]?\s*(\d{8,12})/i,
  /\[\s*case\s*[:#]?\s*(\d{8,12})\s*\]/i,
  /\b(?:case|fall|cas|caso|zaak|ärende)\s*#\s*(\d{8,12})/i,
];

const RE = {
  freischaltung: /approval|freischalt|verkaufsgenehmigung|genehmigung zum verkauf|zulassung (?:zum verkauf|der marke|der kategorie)|selling application|ungat|restricted (?:brand|category|product)|eingeschränkte (?:marke|kategorie)|demande d'approbation|approbation pour vendre|richiesta di approvazione|approvazione (?:alla vendita|per vendere)|solicitud de aprobaci[oó]n|aprobaci[oó]n para vender|goedkeuring (?:aanvragen|om te verkopen|voor)|verkoopgoedkeuring|zatwierdzeni[ae] (?:do sprzedaży|sprzedaży)|wniosek o zatwierdzenie|godkännande (?:för att sälja|att sälja)|ansökan om godkännande/i,
  // Nur echte Rechte-/Echtheitsmails – keine nackten Wörter wie „copyright“/„patent“, die in Fußzeilen stehen.
  marke: /rechteinhaber|rights owner|intellectual property (?:complaint|rights?|violation|infringement|policy)|notice of (?:claimed )?infringement|(?:verletzung|verstoß) (?:von |gegen )?(?:geistige|marken|urheber|patent)|geistige[sn]? eigentum(?:s)?(?:srecht)?[^.\n]{0,40}(?:verletz|beschwerde)|markenrechtsverletzung|markenrecht(?:e|s)? (?:verletz|beschwerde)|trademark (?:infringement|complaint)|markenverletzung|urheberrechtsverletzung|copyright (?:infringement|complaint|violation)|patent ?(?:infringement|complaint|violation)|patentverletzung|counterfeit|fälschung|gefälscht|inauthentic|nicht authentisch|authenticity (?:complaint|concern|issue|of)|echtheitsbeschwerde|echtheit (?:der|ihrer|von|des)|(?:beschwerde|bedenken) (?:wegen|über|zur|bezüglich) (?:der )?echtheit|contrefaçon|atteinte (?:à la|aux droits de) propriété intellectuelle|contraffa|violazione (?:della |dei diritti di )?propriet[aà] intellettuale|falsificaci[oó]n|infracci[oó]n de (?:la )?propiedad intelectual|namaak|inbreuk op (?:het )?intellectueel eigendom|podróbk|naruszeni[ae] własności intelektualnej|förfalskning|intrång i immateriell/i,
  kontozustand: /kontozustand|account health|verkäuferkonto (?:wurde )?(?:deaktiviert|gesperrt|eingeschränkt)|account (?:has been )?(?:deactivated|suspended|at risk)|richtlinienversto|policy violation|santé du compte|salute dell'account|estado de la cuenta|accountstatus|kondycja konta|kontohälsa/i,
  a_bis_z: /a-bis-z|a-to-z|a-z-garantie|garantie de a à z|garanzia dalla a alla z|garant[ií]a de la a a la z|a-tot-z|gwarancja od a do z|a-till-ö|rückbelastung|chargeback|zahlungsstreit|rétrofacturation|riaddebito|contracargo|terugboeking|obciążenie zwrotne|återdebitering/i,
  entschaedigung: /reimbursement|entschädigung|erstattung (?:für|von) (?:verlorene|beschädigte)|fba-erstattung|indemnisation|remboursement fba|rimborso (?:fba|per)|reembolso (?:de )?fba|vergoeding|rekompensat|ersättning/i,
  erstattung_kunde: /refund (?:initiated|issued|processed)|erstattung (?:veranlasst|eingeleitet|ausgelöst|durchgeführt)|rückerstattung (?:veranlasst|eingeleitet)|remboursement (?:initié|effectué)|rimborso (?:avviato|emesso)|reembolso (?:iniciado|emitido)|terugbetaling (?:gestart|uitgevoerd)|zwrot (?:zainicjowany|środków)|återbetalning (?:initierad|genomförd)/i,
  fba_sendung: /(?:sendung|shipment|envoi|spedizione|env[ií]o|zending|przesyłk|försändelse)[^.\n]{0,60}(?:geschlossen|closed|abweich|discrepan|fehlmenge|shortage|clôtur|chius|cerrad|gesloten|zamknięt|stängd)|\bFBA[A-Z0-9]{8,10}\b[^.\n]{0,80}(?:geschlossen|closed|abweich|discrepan|fehl|missing)/i,
  angebot: /deaktiviert|deactivat|unterdrückt|suppressed|angebot (?:wurde )?entfernt|listing (?:has been )?removed|preisfehler|pricing error|gpsr|produktsicherheit|product safety|sicherheitsdatenblatt|safety data sheet|gefahrgut|hazmat|dangerous goods|désactiv|disattivat|desactivad|gedeactiveerd|dezaktywowan|inaktiverad|reaktivier|reactivat|reinstat/i,
  info: /gebühr(?:en)?änderung|änderungen? (?:an|der|bei) (?:den )?(?:gebühren|richtlinien)|fee (?:change|update)|changes to (?:fees|our)|newsletter|webinar|seller university|neuigkeiten|news for sellers|jetzt anmelden|prime day|black friday/i,
};

const PHASE_RE = {
  entzogen: /revoked|entzogen|widerrufen|removed your (?:approval|ability)|no longer (?:approved|able to sell)|nicht mehr (?:berechtigt|freigeschaltet)|révoqu|revocat|revocad|ingetrokken|cofnięt|återkallad/i,
  genehmigt: /\b(?:approved|genehmigt|freigeschaltet|zugelassen|approuvée?|approvat[ao]|aprobad[ao]|goedgekeurd|zatwierdzon[aey]|godkänd)\b|you (?:can|are now able to) (?:now )?(?:sell|list)|sie können jetzt (?:verkaufen|anbieten)/i,
  abgelehnt: /\b(?:denied|rejected|declined|abgelehnt|nicht genehmigt|refusée?|rejetée?|rifiutat[ao]|respint[ao]|rechazad[ao]|denegad[ao]|afgewezen|geweigerd|odrzucon[aey]|nie zatwierdzon|avslag|avslagen|nekad)\b|(?:could not|cannot|are unable to) approve|konnten (?:wir )?(?:ihren antrag )?nicht genehmigen/i,
  nachreichen: /additional (?:information|documents?|documentation)|weitere (?:informationen|unterlagen|dokumente)|zusätzliche (?:informationen|unterlagen|dokumente)|unterlagen nachreichen|documents? supplémentaires|informations supplémentaires|documenti aggiuntivi|informazioni aggiuntive|documentaci[oó]n adicional|informaci[oó]n adicional|aanvullende (?:informatie|documenten)|dodatkowe (?:informacje|dokumenty)|ytterligare (?:information|dokument)/i,
  beantragt: /(?:received|erhalten|eingegangen)[^.\n]{0,40}(?:application|antrag|anfrage)|(?:application|antrag)[^.\n]{0,40}(?:received|erhalten|eingegangen|in bearbeitung|under review|wird geprüft)|demande (?:reçue|en cours)|richiesta ricevuta|solicitud recibida|aanvraag ontvangen|wniosek otrzymany|ansökan mottagen/i,
  wieder_offen: /reopened|wieder (?:geöffnet|eröffnet)|erneut geöffnet|rouvert|riaperto|reabierto|heropend|ponownie otwart|återöppnat/i,
  antwort_noetig: /(?:please|bitte) (?:provide|send|reply|respond|submit|stellen sie|senden sie|antworten sie|reichen sie)|we need (?:the following|more|additional)|wir benötigen|benötigen (?:wir|noch)|requires? your (?:response|action)|ihre antwort (?:ist )?erforderlich|antworten sie (?:auf|bis)|veuillez (?:fournir|répondre|nous envoyer)|nous avons besoin|si prega di (?:fornire|rispondere|inviare)|abbiamo bisogno|por favor,? (?:proporcione|env[ií]e|responda)|necesitamos|graag (?:ontvangen|reageren)|wij hebben .* nodig|prosimy o (?:przesłanie|odpowiedź|dostarczenie)|potrzebujemy|vänligen (?:skicka|svara|tillhandahåll)|vi behöver/i,
  geschlossen_ohne: /(?:closed|geschlossen|clôturé|chiuso|cerrado|gesloten|zamknięt|stängd)[^\n]{0,160}(?:unable|cannot|not eligible|nicht berechtigt|nicht möglich|keine erstattung|no reimbursement|denied|abgelehnt|impossible|non idoneo|no es posible|niet in aanmerking|nie kwalifikuje|inte berättigad)|(?:not eligible|nicht berechtigt|keinen anspruch|no reimbursement|keine erstattung)[^.\n]{0,80}(?:closed|geschlossen|abgeschlossen)/i,
  geloest: /\b(?:resolved|gelöst|erledigt|résolu|risolto|resuelto|opgelost|rozwiązan[aey]|löst)\b|we (?:have )?reimbursed|(?:wir haben|haben wir)[^.\n]{0,40}(?:erstattet|gutgeschrieben)|nous avons rembours|abbiamo rimborsato|hemos reembolsado|hebben (?:wij )?vergoed|zwróciliśmy|vi har ersatt/i,
  beantwortet: /thank you for contacting|vielen dank für ihre (?:nachricht|anfrage|kontaktaufnahme)|merci de nous avoir contacté|grazie per averci contattato|gracias por contactar|bedankt voor uw (?:bericht|contact)|dziękujemy za kontakt|tack för att du kontaktade/i,
};

const GRUND_RE: [Ablehnungsgrund, RegExp][] = [
  ["rechnung_zu_alt", /180 (?:days|tage|jours|giorni|d[ií]as|dagen|dni|dagar)|(?:older|älter) (?:than|als)|nicht älter|invoice (?:date|is too old)|zu alt|trop ancienne|troppo vecchia|demasiado antigua|te oud|zbyt stara|för gammal/i],
  ["menge_zu_gering", /\b10 (?:units|einheiten|stück|stk|unités|unità|unidades|eenheden|sztuk|enheter)\b|minimum (?:of )?(?:10|ten)|mindestens (?:10|zehn)|quantité minimale|quantità minima|cantidad m[ií]nima/i],
  ["kein_hersteller", /manufacturer or distributor|hersteller oder (?:groß|gross)händler|(?:großhändler|distributor|wholesaler) (?:or|oder) (?:hersteller|manufacturer)|fabricant ou (?:un )?distributeur|produttore o distributore|fabricante o distribuidor|fabrikant of distributeur|producent(?:a)? lub dystrybutor|tillverkare eller distributör/i],
  ["adresse_passt_nicht", /(?:name|address|adresse|firmenname|anschrift)[^.\n]{0,60}(?:match|übereinstimm|identisch|correspond|corrispond|coincid|overeen|zgodn|stämm)/i],
  ["unleserlich", /illegible|unreadable|unleserlich|nicht lesbar|unvollständig|incomplete|illisible|incomplet|illeggibile|incomplet[ao]|ilegible|onleesbaar|onvolledig|nieczyteln|niekompletn|oläslig|ofullständig/i],
  ["preise_geschwaerzt", /(?:prices?|preise|prix|prezzi|precios|prijzen|ceny|priser)[^.\n]{0,40}(?:redacted|geschwärzt|removed|unkenntlich|masqu|oscurat|tachad|zwart|zamazan|maskerad)/i],
  ["kontakt_fehlt", /contact (?:information|details)|kontaktdaten|kontaktinformationen|telefonnummer|website des lieferanten|coordonnées|informazioni di contatto|informaci[oó]n de contacto|contactgegevens|dane kontaktowe|kontaktuppgifter/i],
  ["autorisierung", /letter of authori[sz]ation|authori[sz]ation letter|autorisierungsschreiben|genehmigungsschreiben|vollmacht|lettre d'autorisation|lettera di autorizzazione|carta de autorizaci[oó]n|machtigingsbrief|list autoryzacyjny|auktorisationsbrev/i],
];

const VERLANGT_RE: [Verlangt, RegExp][] = [
  ["pod", /proof of delivery|\bPOD\b|zustellnachweis|liefernachweis|empfangsbestätigung|preuve de livraison|prova di consegna|prueba de entrega|bewijs van (?:levering|aflevering)|dowód dostawy|leveransbevis/i],
  ["shipment_id", /shipment id|sendungs-?id|sendungsnummer|\bFBA[A-Z0-9]{8,10}\b|id (?:de l'|d')?envoi|id spedizione|id de env[ií]o|zending-?id|identyfikator przesyłki|försändelse-?id/i],
  ["rechnung", /\binvoices?\b|rechnung|facture|fattura|factura|factuur|faktur/i],
  ["fotos", /photos?|pictures?|images?|fotos?|bilder?|immagini|fotografi|zdjęci/i],
  ["seriennummer", /serial number|seriennummer|numéro de série|numero di serie|n[uú]mero de serie|serienummer|numer seryjny|serienummer/i],
  ["packliste", /packing (?:list|slip)|packliste|packzettel|lieferschein|liste de colisage|bolla|lista de embalaje|paklijst|list przewozowy|packsedel/i],
  ["tracking", /tracking|sendungsverfolgung|trackingnummer|suivi|tracciamento|seguimiento|track ?& ?trace|śledzenie|spårning/i],
];

/**
 * Routinemails (Bestellung, Versand, Zahlung) sind nie ein Fall – egal was in der Fußzeile steht (B10/B17).
 * Geprüft wird nur der Betreff.
 */
const ROUTINE_RE = [
  BESTELL_MAIL_RE,
  FBA_VERSAND_RE,
  /bestellbestätigung|versandbestätigung|ihre bestellung (?:wurde|ist)|order confirmation|has shipped|wurde (?:versandt|zugestellt)|\bzugestellt\b|\bdelivered\b|confirmation de commande|conferma (?:dell'ordine|d'ordine)|confirmaci[oó]n (?:del|de) pedido|orderbevestiging/i,
  /(?:tu|ihre?|your|votre|il tuo|uw|je|twoja|din) (?:pago|zahlung|auszahlung|payment|paiement|pagamento|betaling|p[łl]atno[śs][ćc]|utbetalning|betalning)\b[^\n]{0,40}(?:est[áa] en camino|ist unterwegs|wurde (?:veranlasst|überwiesen|gesendet)|is on (?:its|the) way|has been sent|est en route|a été envoyé|è in arrivo|è stato inviato|is onderweg|is verzonden|jest w drodze|została wysłana|är på väg|har skickats)/i,
  /\bauszahlung\b|\bdisbursement\b|zahlung (?:wurde )?(?:überwiesen|veranlasst)|abrechnung (?:ist )?verfügbar|settlement report|virement (?:envoyé|effectué)|transferencia (?:enviada|realizada)|bonifico (?:inviato|effettuato)/i,
];

/** B19.4: eigene Einkäufe (auch Amazon Business), Versand in allen EU-Sprachen, Zahlungen (bestätigt oder abgelehnt). */
const EINKAUF_RE = /amazon business[^\n]{0,40}(?:bestellung|order|ordine|commande|pedido|bestelling|zamówieni|beställning)|(?:bestellung|order|ordine|commande|pedido|bestelling|zamówieni|beställning)[^\n]{0,40}amazon business|(?:ihre|deine|your|votre|ta|tu|il tuo|la tua|uw|je|twoje|din) (?:amazon(?:\.[a-z.]+)?[- ]?)?(?:bestellung|order|commande|pedido|ordine|bestelling|zamówienie|beställning)\b/i;
/** Wort-Grenzen auch für Umlaute/Akzente („expédié“, „płatność“) – \b kennt nur ASCII. */
const wort = (muster: string) => new RegExp(muster.replace(/\\b/g, "(?:(?<![\\p{L}\\p{N}])(?=[\\p{L}\\p{N}])|(?<=[\\p{L}\\p{N}])(?![\\p{L}\\p{N}]))"), "iu");
const VERSAND_RE = wort(String.raw`\ba expédié\b|\bexpédiée?s?\b|\bè stat[oa] spedit[oa]\b|\bspedit[oa]\b|\bha sido enviad[oa]\b|\bse ha enviado\b|\bis verzonden\b|\bzostał[oa]? wysłan[aey]?\b|\bhar skickats\b|\bist unterwegs\b|\bon (?:its|the) way\b|\bout for delivery\b|\ben cours de livraison\b|\bin consegna\b|\ben reparto\b`);
const ZAHLUNG = String.raw`\b(?:pagamento|payment|zahlung|paiement|pago|betaling|płatność|betalning)\b[^\n]{0,30}`;
const ZAHLUNG_FEHLER_RE = wort(String.raw`${ZAHLUNG}\b(?:rifiutat[oa]|non riuscit[oa]|declined|failed|abgelehnt|fehlgeschlagen|refusé|échoué|rechazad[oa]|fallid[oa]|geweigerd|mislukt|odrzucon[aey]|nieudan[aey]|nekad|misslyckad)\b`);
const ZAHLUNG_OK_RE = wort(String.raw`${ZAHLUNG}\b(?:elaborat[oa]|riuscit[oa]|ricevut[oa]|confermat[oa]|received|processed|successful|confirmed|erfolgreich|eingegangen|bestätigt|verarbeitet|reçu|accepté|effectué|réussi|recibid[oa]|procesad[oa]|realizad[oa]|confirmad[oa]|ontvangen|geslaagd|verwerkt|przyjęt[aey]|zrealizowan[aey]|mottagen|genomförd)\b|\bcon successo\b|\berfolgreich (?:verarbeitet|abgeschlossen)\b|\bsuccessfully processed\b|\btraité avec succès\b|\bprocesado correctamente\b`);
/** „erfolgreich/elaborato/successo“ – nie A-bis-z (B19.4). */
export const ERFOLG_RE = wort(String.raw`\berfolgreich\b|\belaborat[oa]\b|\bsuccess(?:o|ful(?:ly)?)?\b|\bréussi\b|\bavec succès\b|\bexitos[oa]\b|\bcorrectamente\b|\bgeslaagd\b`);

export type RoutineArt = "bestellung" | "versand" | "zahlung" | "zahlung_fehler" | "auszahlung";

/** Echte Fall-Themen im Betreff gehen vor Routine (A-bis-z zu „your order“ bleibt ein Fall). */
const FALL_IM_BETREFF = (b: string) => RE.a_bis_z.test(b) || RE.marke.test(b) || RE.kontozustand.test(b) || RE.freischaltung.test(b) || RE.entschaedigung.test(b);

/** Welche Routine-Mail (nur Betreff) – null = keine. */
export function routineArt(betreff: string): RoutineArt | null {
  if (ZAHLUNG_FEHLER_RE.test(betreff)) return "zahlung_fehler";
  if (ZAHLUNG_OK_RE.test(betreff)) return "zahlung";
  if (ROUTINE_RE[4].test(betreff) || ROUTINE_RE[3].test(betreff)) return "auszahlung";
  if (FALL_IM_BETREFF(betreff)) return null;
  if (ROUTINE_RE[1].test(betreff) || VERSAND_RE.test(betreff) || /versandbestätigung|has shipped|wurde (?:versandt|zugestellt)|\bzugestellt\b|\bdelivered\b/i.test(betreff)) return "versand";
  if (ROUTINE_RE.some((re) => re.test(betreff)) || EINKAUF_RE.test(betreff)) return "bestellung";
  return null;
}

export const istRoutineMail = (betreff: string) => routineArt(betreff) !== null;

/**
 * B19.4: Ist der Vorgang ein echter Fall (für „zuständig: VA“ und die VA-Automatik)? Nicht bei Info/Routine, nicht bei
 * „Sonstiges“ und nicht, solange er als „bitte prüfen“ (unsicher) markiert ist.
 */
export const echterFall = (v: { status: string; bereich: string; unsicher: boolean }) => v.status === "offen" && !v.unsicher && v.bereich !== "info" && v.bereich !== "sonstiges";

/** Steuer-/VAT-Hinweise (USt, TVA, IVA, BTW, Moms) – Info, außer die Mail nennt selbst eine Frist. */
export const STEUER_RE = /\b(?:vat|ust(?:-id(?:nr)?)?|umsatzsteuer|mehrwertsteuer|tva|iva|btw|moms|vat-?nummer)\b/i;

/** Fußzeilen (Copyright, Rechtehinweis, Abmelden) – zählen nicht für die Einordnung. */
export function ohneFusszeile(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((z) => !/©|\bcopyright\s*(?:\(c\)\s*)?\d{4}|all rights reserved|alle rechte vorbehalten|tous droits réservés|todos los derechos reservados|tutti i diritti riservati|alle rechten voorbehouden|wszelkie prawa zastrzeżone|med ensamrätt|amazon\.com,? inc\.? (?:or its affiliates|und verbundene|oder (?:seine|ihre) tochter)|abmelden|unsubscribe|se désabonner|cancelar (?:la )?suscripci[oó]n|annulla l'iscrizione|afmelden/i.test(z))
    .join("\n");
}

/** Fall-ID (8–12 Ziffern) aus Betreff und Text. */
export function fallnummerAus(text: string): string | null {
  for (const re of FALLNUMMER) {
    const m = re.exec(text);
    if (m) return m[1];
  }
  return null;
}

/** Betrag „123,45 €“, „EUR 123.45“, „€ 1.234,56“, „£ 12.30“ – der erste. */
export function betragAus(text: string): number | null {
  const m = /(?:€|EUR|£|GBP)\s*(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|\d+(?:[.,]\d{2})?)|(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|\d+(?:[.,]\d{2}))\s*(?:€|EUR|£|GBP)/.exec(text);
  if (!m) return null;
  const roh = (m[1] ?? m[2]).replace(/\s/g, "");
  const n = /,\d{2}$/.test(roh) ? Number(roh.replace(/\./g, "").replace(",", ".")) : Number(roh.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** Standardfristen je Bereich/Phase (Tage ab Mail), wenn die Mail keine nennt – pflegbar in den Einstellungen. */
export const STANDARD_FRISTEN: Record<string, number> = { antwort_noetig: 3, nachreichen: 7, abgelehnt: 14, entzogen: 3, marke: 2, kontozustand: 2, angebot: 7, a_bis_z: 3, fba_sendung: 30 };

const plusTage = (iso: string, n: number) => new Date(Date.parse(`${iso.slice(0, 10)}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function dringlichkeitVon(b: Bereich, p: Phase, frist: string | null, heute: string): Dringlichkeit {
  if (p === "entzogen" || b === "marke" || b === "kontozustand") return "rot";
  if (p === "antwort_noetig" && frist && frist <= plusTage(heute, 2)) return "rot";
  if (p === "antwort_noetig" || p === "abgelehnt" || p === "nachreichen" || p === "geschlossen_ohne" || b === "angebot" || b === "a_bis_z") return "gelb";
  return "grau";
}

/**
 * Eine Amazon-Mail einordnen. `gelernt`: von Hand korrigierte Zuordnungen (Muster aus dem Betreff → Bereich/Phase),
 * gehen vor den festen Mustern.
 */
export function einordnen(
  m: { from: string; subject: string; text: string; date: string },
  o: { heute?: string; fristen?: Record<string, number>; gelernt?: { muster: string; bereich: Bereich; phase: Phase }[] } = {},
): Einordnung {
  const heute = o.heute ?? m.date.slice(0, 10);
  const text = ohneFusszeile(m.text);
  const hay = `${m.subject}\n${text.slice(0, 6000)}`;
  const kopf = `${m.subject}\n${text.slice(0, 600)}`;
  const fallnummer = fallnummerAus(hay);
  const asins = extractAsins(hay);
  const skus = extractSkus(hay);
  const { land } = marktplatzAus(m.from, `${m.subject}\n${m.text}`);
  const rArt = fallnummer ? null : routineArt(m.subject);
  const routine = rArt !== null;
  const bestellnummer = /\b\d{3}-\d{7}-\d{7}\b/.exec(hay)?.[0] ?? null;
  const shipmentId = /\bFBA[A-Z0-9]{8,10}\b/.exec(hay)?.[0] ?? null;
  const betrag = betragAus(hay);

  let bereich: Bereich = "sonstiges";
  let sicherheit = 0.4;
  const muster = musterVon(m.subject);
  const gelernt = o.gelernt?.find((g) => g.muster === muster);
  if (gelernt) {
    bereich = gelernt.bereich;
    sicherheit = 1;
  } else if (routine) {
    bereich = "info";
    sicherheit = 0.95;
  } else {
    // Reihenfolge = Vorrang: Entzug/Freischaltung vor Angebot; Marke/Konto vor allem Übrigen.
    const reihenfolge: Bereich[] = ["kontozustand", "marke", "freischaltung", "a_bis_z", "entschaedigung", "erstattung_kunde", "fba_sendung", "angebot", "info"];
    const imKopf = reihenfolge.find((b) => RE[b as keyof typeof RE].test(kopf));
    const imText = imKopf ?? reihenfolge.find((b) => RE[b as keyof typeof RE].test(hay));
    if (imKopf) {
      bereich = imKopf;
      sicherheit = 0.9;
    } else if (imText) {
      bereich = imText;
      sicherheit = 0.7;
    }
    // B19.4: „Zahlung erfolgreich / elaborato con successo“ ist nie A-bis-z (A-bis-z-Hinweis steht oft nur in der Fußzeile).
    if (bereich === "a_bis_z" && ERFOLG_RE.test(m.subject)) {
      bereich = "info";
      sicherheit = 0.9;
    }
    // Fall-Mails (mit Fall-ID) ohne eigenes Thema: Seller Support.
    if (fallnummer && (bereich === "sonstiges" || bereich === "info")) {
      bereich = "fall";
      sicherheit = 0.85;
    }
    // Steuer-/VAT-Hinweise ohne eigene Frist in der Mail: Info (keine Steuerberatung, keine erfundene Frist).
    if (!fallnummer && (bereich === "sonstiges" || bereich === "info") && STEUER_RE.test(m.subject)) {
      const eigeneFrist = deadlineFromText(text, m.date);
      bereich = eigeneFrist ? "sonstiges" : "info";
      sicherheit = eigeneFrist ? 0.5 : 0.8;
    }
  }

  let phase: Phase = gelernt?.phase ?? "offen";
  if (!gelernt) {
    if (bereich === "freischaltung") {
      phase = PHASE_RE.entzogen.test(kopf) ? "entzogen" : PHASE_RE.nachreichen.test(hay) && !PHASE_RE.genehmigt.test(kopf) ? "nachreichen" : PHASE_RE.abgelehnt.test(hay) ? "abgelehnt" : PHASE_RE.genehmigt.test(kopf) ? "genehmigt" : PHASE_RE.beantragt.test(hay) ? "beantragt" : "beantragt";
    } else if (bereich === "fall" || (fallnummer && bereich !== "info")) {
      phase = PHASE_RE.wieder_offen.test(hay)
        ? "wieder_offen"
        : PHASE_RE.geschlossen_ohne.test(hay)
          ? "geschlossen_ohne"
          : PHASE_RE.geloest.test(hay)
            ? "geloest"
            : PHASE_RE.antwort_noetig.test(hay)
              ? "antwort_noetig"
              : PHASE_RE.beantwortet.test(hay)
                ? "beantwortet"
                : "eroeffnet";
    } else if (bereich === "info") phase = "info";
    else if (bereich === "angebot" && PHASE_RE.genehmigt.test(kopf) && /reaktiviert|reactivated|reinstated|wieder aktiv/i.test(kopf)) phase = "geloest";
    else if (bereich === "entschaedigung" || bereich === "erstattung_kunde") phase = "info";
    else phase = PHASE_RE.antwort_noetig.test(hay) ? "antwort_noetig" : "offen";
  }

  const ausText = deadlineFromText(text, m.date);
  const fristTage = { ...STANDARD_FRISTEN, ...(o.fristen ?? {}) };
  // „Sonstiges“ bekommt keine Standardfrist – nur eine Frist, die in der Mail steht.
  const std = bereich === "sonstiges" ? undefined : (fristTage[phase] ?? fristTage[bereich]);
  const offen = !["genehmigt", "geloest", "info", "beantragt", "beantwortet"].includes(phase);
  const frist = ausText ?? (offen && std ? plusTage(m.date, std) : null);

  return {
    bereich,
    phase,
    dringlichkeit: dringlichkeitVon(bereich, phase, frist, heute),
    sicherheit,
    fallnummer,
    asins,
    skus,
    marktplatz: land,
    bestellnummer,
    shipmentId,
    betrag,
    frist,
    ablehnungsgruende: bereich === "freischaltung" && (phase === "abgelehnt" || phase === "nachreichen" || phase === "entzogen") ? ablehnungsgruende(hay) : [],
    verlangt: phase === "antwort_noetig" ? verlangtAus(hay) : [],
    routine,
    routineArt: rArt,
    fristQuelle: ausText ? "mail" : frist ? "standard" : null,
  };
}

export function ablehnungsgruende(text: string): Ablehnungsgrund[] {
  const g = GRUND_RE.filter(([, re]) => re.test(text)).map(([k]) => k);
  return g.length ? g : ["sonstiges"];
}

export function verlangtAus(text: string): Verlangt[] {
  return VERLANGT_RE.filter(([, re]) => re.test(text)).map(([k]) => k);
}

/** Muster aus dem Betreff zum Lernen: ohne Zahlen, ASINs, Fall-IDs, Satzzeichen; Kleinbuchstaben. */
export function musterVon(betreff: string): string {
  return betreff
    .toLowerCase()
    .replace(/\bB0[A-Z0-9]{8}\b/gi, "")
    .replace(/\bFBA[A-Z0-9]{8,10}\b/gi, "")
    .replace(/\d+/g, "")
    .replace(/^(?:re|aw|wg|fw|fwd)\s*:\s*/g, "")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

// ---- Zuordnung zu bestehenden Vorgängen --------------------------------------------------------------------

export type VorgangKurz = { id: string; bereich: Bereich; status: string; fallnummer: string | null; asins: string[]; shipmentId: string | null; bestellnummer: string | null; letzteMailAm: string };

/**
 * Gehört die Mail zu einem bestehenden Vorgang? Gleiche Fall-ID → immer. Sonst gleicher Bereich mit gemeinsamer
 * ASIN, Sendung oder Bestellung, letzte Mail höchstens 60 Tage alt (auch erledigte – eine neue Mail öffnet ihn wieder).
 */
export function zuordnen(e: Pick<Einordnung, "bereich" | "fallnummer" | "asins" | "shipmentId" | "bestellnummer">, vorgaenge: VorgangKurz[], mailDatum: string): string | null {
  if (e.fallnummer) {
    const f = vorgaenge.find((v) => v.fallnummer === e.fallnummer);
    if (f) return f.id;
  }
  if (e.bereich === "info") return null;
  const grenze = plusTage(mailDatum, -60);
  const neueste = (xs: VorgangKurz[]) => xs.sort((a, b) => b.letzteMailAm.localeCompare(a.letzteMailAm))[0]?.id ?? null;
  const jung = vorgaenge.filter((v) => v.letzteMailAm.slice(0, 10) >= grenze);
  if (e.bereich !== "sonstiges") {
    const gleich = neueste(jung.filter((v) => v.bereich === e.bereich).filter((v) => (e.asins.length && v.asins.some((a) => e.asins.includes(a))) || (e.shipmentId && v.shipmentId === e.shipmentId) || (e.bestellnummer && v.bestellnummer === e.bestellnummer)));
    if (gleich) return gleich;
  }
  // B19.4: Mails zur selben Bestellnummer gehören zusammen – auch „Sonstiges“ und über Bereiche hinweg.
  return e.bestellnummer ? neueste(jung.filter((v) => v.bereich !== "info" && v.bestellnummer === e.bestellnummer)) : null;
}

/** Status eines Vorgangs nach der Phase: erledigt (genehmigt, gelöst), Info oder offen. */
export const statusVonPhase = (p: Phase): "offen" | "erledigt" | "info" => (p === "genehmigt" || p === "geloest" ? "erledigt" : p === "info" ? "info" : "offen");

// ---- Pakete -------------------------------------------------------------------------------------------------

export type BelegKandidat = { id: string; datum: string | null; lieferant: string | null; nummer: string | null; menge: number | null; kontakt: boolean; fileId: string | null };
export type BelegPruefung = BelegKandidat & { ok: boolean; gruende: string[] };

/** Rechnung gegen die Kriterien von Amazon prüfen: ≤ 180 Tage, ≥ 10 Stück, Lieferant mit Kontaktdaten. */
export function belegPruefen(b: BelegKandidat, heute: string, o: { maxTage?: number; minMenge?: number } = {}): BelegPruefung {
  const maxTage = o.maxTage ?? 180;
  const minMenge = o.minMenge ?? 10;
  const gruende: string[] = [];
  if (!b.datum) gruende.push("ohne Rechnungsdatum");
  else if (b.datum < plusTage(heute, -maxTage)) gruende.push(`älter als ${maxTage} Tage`);
  if (b.menge === null) gruende.push("Menge unbekannt");
  else if (b.menge < minMenge) gruende.push(`nur ${b.menge} Stück (mind. ${minMenge})`);
  if (!b.lieferant) gruende.push("Lieferant unbekannt");
  if (!b.kontakt) gruende.push("Kontaktdaten des Lieferanten fehlen");
  return { ...b, ok: gruende.length === 0 || (gruende.length === 1 && gruende[0] === "Kontaktdaten des Lieferanten fehlen"), gruende };
}

export type Paket = {
  art: "freischaltung" | "fall_antwort" | "wieder_oeffnen" | "marke" | "angebot" | "allgemein";
  texte: { de: string; en: string };
  checkliste: string[];
  belege: { id: string; name: string; fileId: string | null }[];
  fehlt: string[];
  erstellt: string;
};

const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "–");

/**
 * Freischaltung abgelehnt/nachreichen/entzogen: passende Rechnungen wählen (höchstens 3, neueste zuerst). Ohne
 * passenden Beleg kein aussichtsloses Paket, sondern „fehlt …“ mit Vorschlag (Kleinbestellung beim letzten Lieferanten).
 */
export function freischaltungsPaket(x: {
  marke: string | null;
  asins: string[];
  marktplatz: string | null;
  gruende: Ablehnungsgrund[];
  belege: BelegKandidat[];
  heute: string;
  firma: string | null;
  letzterLieferant?: { name: string; ek: number | null } | null;
  entzogen?: boolean;
}): Paket {
  const geprueft = x.belege.map((b) => belegPruefen(b, x.heute)).sort((a, b) => (b.datum ?? "").localeCompare(a.datum ?? ""));
  const gut = geprueft.filter((b) => b.ok).slice(0, 3);
  const was = x.marke ? `die Marke ${x.marke}` : x.asins.length ? `ASIN ${x.asins.slice(0, 3).join(", ")}` : "das Produkt";
  const whatEn = x.marke ? `the brand ${x.marke}` : x.asins.length ? `ASIN ${x.asins.slice(0, 3).join(", ")}` : "the product";
  const fehlt: string[] = [];
  if (!gut.length) {
    const vorschlag = x.letzterLieferant ? ` – Vorschlag: Kleinbestellung (≥ 10 Stück) bei ${x.letzterLieferant.name}${x.letzterLieferant.ek !== null ? ` (letzter EK ${x.letzterLieferant.ek.toFixed(2).replace(".", ",")} €)` : ""}` : "";
    fehlt.push(`Rechnung über ≥ 10 Stück von Hersteller/Großhändler, nicht älter als 180 Tage, mit Kontaktdaten des Lieferanten${vorschlag}`);
  }
  if (x.gruende.includes("autorisierung")) fehlt.push("Autorisierungsschreiben des Herstellers/Markeninhabers");
  if (x.gruende.includes("adresse_passt_nicht")) fehlt.push(`Rechnungsadresse muss genau dem Firmennamen im Konto entsprechen${x.firma ? ` (${x.firma})` : ""}`);
  const belegZeilen = gut.map((b) => `- Rechnung ${b.nummer ?? "ohne Nr."} vom ${dmy(b.datum)} – ${b.lieferant ?? "Lieferant"}, ${b.menge} Stück`);
  const grundText = x.gruende.filter((g) => g !== "sonstiges").map((g) => ABLEHNUNGSGRUND_LABEL[g]);
  const de = [
    x.entzogen ? `Widerspruch gegen den Entzug der Verkaufsberechtigung für ${was}${x.marktplatz ? ` (${x.marktplatz})` : ""}.` : `Antrag auf Freischaltung für ${was}${x.marktplatz ? ` (${x.marktplatz})` : ""}.`,
    "",
    "Wir beziehen die Ware ausschließlich über autorisierte Hersteller bzw. Großhändler. Anbei:",
    ...(belegZeilen.length ? belegZeilen : ["- (Beleg fehlt noch – siehe Liste „fehlt“)"]),
    "",
    grundText.length ? `Zum letzten Ablehnungsgrund (${grundText.join(", ")}): die beigefügten Rechnungen erfüllen die Anforderungen (Datum, Menge, Lieferantenangaben).` : "",
    "Rechnungsadresse und Firmenname entsprechen unserem Verkäuferkonto.",
  ]
    .filter((z, i, a) => z !== "" || a[i - 1] !== "")
    .join("\n")
    .trim();
  const en = [
    x.entzogen ? `Appeal against the removal of our selling approval for ${whatEn}${x.marktplatz ? ` (${x.marktplatz})` : ""}.` : `Application for approval to sell ${whatEn}${x.marktplatz ? ` (${x.marktplatz})` : ""}.`,
    "",
    "We source exclusively from authorised manufacturers or distributors. Attached:",
    ...(gut.length ? gut.map((b) => `- Invoice ${b.nummer ?? "(no number)"} dated ${b.datum ?? "–"} – ${b.lieferant ?? "supplier"}, ${b.menge} units`) : ["- (document still missing)"]),
    "",
    "The billing address and company name match our seller account.",
  ].join("\n");
  return {
    art: "freischaltung",
    texte: { de, en },
    checkliste: [
      "Seller Central öffnen → Katalog → Produkte hinzufügen → ASIN suchen → „Verkaufsberechtigung beantragen“ (bzw. Kontozustand → Widerspruch).",
      "Rechnungen hochladen (PDF, unverändert; Preise dürfen geschwärzt sein, Mengen und Adressen nicht).",
      "Text oben einfügen, absenden.",
      "Fallnummer/Antragsnummer im Seller-System beim Vorgang eintragen („eingereicht“).",
    ],
    belege: gut.map((b) => ({ id: b.id, name: belegName(b), fileId: b.fileId })),
    fehlt,
    erstellt: x.heute,
  };
}

const belegName = (b: { datum: string | null; lieferant: string | null; nummer: string | null }) =>
  `${b.datum ?? "ohne-datum"}_${(b.lieferant ?? "Lieferant").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40)}_${(b.nummer ?? "ohne-nr").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 30)}.pdf`;

/** Fall „Antwort nötig“: Antwort DE/EN mit den vorhandenen Daten, fehlende Angaben ausdrücklich auflisten. */
export function fallAntwort(x: {
  fallnummer: string | null;
  verlangt: Verlangt[];
  sendung?: { id: string; name?: string | null; datum: string | null; stueck: number | null; tracking: string[]; spediteur: string | null } | null;
  bestellnummer: string | null;
  rechnungen: { id: string; name: string; fileId: string | null }[];
  heute: string;
}): Paket {
  const fehlt: string[] = [];
  const de: string[] = [`Guten Tag,`, "", `zu Fall ${x.fallnummer ?? "(Fall-ID)"} senden wir die angeforderten Angaben:`];
  const en: string[] = ["Hello,", "", `regarding case ${x.fallnummer ?? "(case ID)"}, please find the requested information below:`];
  // Sendungsdaten gehören immer dazu, wenn es um Sendung, Tracking oder Zustellnachweis geht.
  const mitSendung = x.verlangt.some((v) => v === "shipment_id" || v === "pod" || v === "tracking");
  for (const v of mitSendung && !x.verlangt.includes("shipment_id") ? (["shipment_id", ...x.verlangt] as Verlangt[]) : x.verlangt) {
    if (v === "shipment_id") {
      if (x.sendung) {
        de.push(`- Sendung: ${x.sendung.id}${x.sendung.name ? ` (${x.sendung.name})` : ""}${x.sendung.datum ? `, versendet am ${dmy(x.sendung.datum)}` : ""}${x.sendung.stueck ? `, ${x.sendung.stueck} Einheiten` : ""}`);
        en.push(`- Shipment: ${x.sendung.id}${x.sendung.datum ? `, shipped on ${x.sendung.datum}` : ""}${x.sendung.stueck ? `, ${x.sendung.stueck} units` : ""}`);
      } else fehlt.push(VERLANGT_LABEL.shipment_id);
    }
    if (v === "tracking" || v === "pod") {
      if (x.sendung?.tracking.length) {
        de.push(`- Sendungsverfolgung${x.sendung.spediteur ? ` (${x.sendung.spediteur})` : ""}: ${x.sendung.tracking.slice(0, 10).join(", ")}`);
        en.push(`- Tracking${x.sendung.spediteur ? ` (${x.sendung.spediteur})` : ""}: ${x.sendung.tracking.slice(0, 10).join(", ")}`);
      } else fehlt.push(VERLANGT_LABEL.tracking);
      if (v === "pod") fehlt.push(`${VERLANGT_LABEL.pod} – beim Spediteur/Paketdienst anfordern (unterschriebener Lieferschein bzw. Zustellbeleg)`);
    }
    if (v === "rechnung") {
      if (x.rechnungen.length) {
        de.push(`- Rechnung(en) im Anhang: ${x.rechnungen.map((r) => r.name).join(", ")}`);
        en.push(`- Invoice(s) attached: ${x.rechnungen.map((r) => r.name).join(", ")}`);
      } else fehlt.push(VERLANGT_LABEL.rechnung);
    }
    if (v === "fotos") fehlt.push(VERLANGT_LABEL.fotos);
    if (v === "seriennummer") fehlt.push(VERLANGT_LABEL.seriennummer);
    if (v === "packliste") fehlt.push(VERLANGT_LABEL.packliste);
  }
  if (x.bestellnummer) {
    de.push(`- Bestellung: ${x.bestellnummer}`);
    en.push(`- Order: ${x.bestellnummer}`);
  }
  de.push("", "Bitte prüfen Sie den Fall erneut. Vielen Dank.");
  en.push("", "Please review the case again. Thank you.");
  return {
    art: "fall_antwort",
    texte: { de: de.join("\n"), en: en.join("\n") },
    checkliste: ["Seller Central → Hilfe → Fallprotokoll → Fall öffnen.", "Text einfügen, Anhänge hochladen, absenden.", "Im Seller-System: Vorgang auf „beantwortet“ setzen (oder in Discord ✅)."],
    belege: x.rechnungen,
    fehlt: [...new Set(fehlt)],
    erstellt: x.heute,
  };
}

/** Geschlossen ohne Lösung: Textbaustein zum Wiederöffnen mit Bezug auf Richtlinie und Belege. */
export function wiederOeffnenPaket(x: { fallnummer: string | null; runden: number; betrag: number | null; heute: string }): Paket {
  const eskalation = x.runden >= 2;
  return {
    art: "wieder_oeffnen",
    texte: {
      de: `Guten Tag,\n\nder Fall ${x.fallnummer ?? "(Fall-ID)"} wurde ohne Lösung geschlossen. Laut FBA-Erstattungsrichtlinie besteht ein Anspruch${x.betrag ? ` über ${x.betrag.toFixed(2).replace(".", ",")} €` : ""}; die Belege liegen bei. Bitte öffnen Sie den Fall erneut und prüfen Sie ihn mit den beigefügten Nachweisen.\n\nVielen Dank.`,
      en: `Hello,\n\ncase ${x.fallnummer ?? "(case ID)"} was closed without resolution. Under the FBA reimbursement policy we are eligible${x.betrag ? ` for ${x.betrag.toFixed(2)} EUR` : ""}; supporting documents are attached. Please reopen the case and review it with the evidence provided.\n\nThank you.`,
    },
    checkliste: eskalation
      ? ["Schon 2 Runden ohne Erfolg – Ludwig entscheidet: Eskalation über Premium-Support/PSTAM oder SAS-Consultant.", "Bis dahin nichts erneut einreichen."]
      : ["Fallprotokoll → Fall öffnen → „Fall erneut öffnen“.", "Text einfügen, Belege anhängen, absenden.", "Neue Fallnummer (falls vergeben) im Seller-System eintragen."],
    belege: [],
    fehlt: [],
    erstellt: x.heute,
  };
}

// ---- Lernen: Erfolgsquote je Marke ------------------------------------------------------------------------

/** Freischaltungen je Marke: beantragt/genehmigt/abgelehnt, häufigste Ablehnungsgründe. */
export function freischaltungsQuote(v: { marke: string | null; phase: Phase; gruende: Ablehnungsgrund[] }[]) {
  const je = new Map<string, { marke: string; genehmigt: number; abgelehnt: number; offen: number; gruende: Map<Ablehnungsgrund, number> }>();
  for (const x of v) {
    const k = x.marke ?? "(ohne Marke)";
    const z = je.get(k) ?? { marke: k, genehmigt: 0, abgelehnt: 0, offen: 0, gruende: new Map() };
    if (x.phase === "genehmigt") z.genehmigt++;
    else if (x.phase === "abgelehnt" || x.phase === "entzogen") z.abgelehnt++;
    else z.offen++;
    for (const g of x.gruende) z.gruende.set(g, (z.gruende.get(g) ?? 0) + 1);
    je.set(k, z);
  }
  return [...je.values()].map((z) => ({ marke: z.marke, genehmigt: z.genehmigt, abgelehnt: z.abgelehnt, offen: z.offen, haeufigsteGruende: [...z.gruende.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => ABLEHNUNGSGRUND_LABEL[g]) }));
}
