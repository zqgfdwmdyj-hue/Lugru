// Sortiert Mails von Amazon, eBay, TikTok, Temu und DHL nach Wichtigkeit.
// Reine Regeln ohne KI – nachvollziehbar und schnell. Unklare Fälle landen bei „Info“.

import type { MailCategory } from "@/db/schema";

export type MailInput = { from: string; subject: string; body: string };

export type Topic =
  | "account_health"
  | "listing_blocked"
  | "payment_hold"
  | "payment_problem"
  | "ip_complaint"
  | "a_to_z"
  | "chargeback"
  | "ebay_case"
  | "buyer_message"
  | "registration"
  | "return_request"
  | "inbound_problem"
  | "case_update"
  | "negative_feedback"
  | "order_info"
  | "payout_info"
  | "marketing"
  | "other";

export const TOPIC_LABEL: Record<Topic, string> = {
  account_health: "Kontozustand",
  listing_blocked: "Angebot gesperrt / Nachweis gefordert",
  payment_hold: "Auszahlung einbehalten / fehlgeschlagen",
  payment_problem: "Zahlungsproblem",
  ip_complaint: "Rechteverletzung",
  a_to_z: "A-bis-Z-Garantie",
  chargeback: "Rückbelastung",
  ebay_case: "eBay-Fall",
  buyer_message: "Käufernachricht",
  registration: "Registrierung / Verifizierung",
  return_request: "Rücksendeanfrage",
  inbound_problem: "Problem mit FBA-Sendung",
  case_update: "Supportfall",
  negative_feedback: "Negative Bewertung",
  order_info: "Bestellung / Versand",
  payout_info: "Auszahlung / Abrechnung",
  marketing: "Werbung / Newsletter",
  other: "Sonstiges",
};

export type Classification = {
  relevant: boolean;
  source: "amazon" | "ebay" | "tiktok" | "temu" | "dhl" | null;
  category: MailCategory;
  topic: Topic;
  rule: string;
  /** Zuordnung wackelig: nur der Absender passte, nur der Text, oder gar keine Regel. */
  uncertain: boolean;
  references: Record<string, string>;
  dueInDays: number | null;
};

export const TOPICS = Object.keys(TOPIC_LABEL) as Topic[];

/** Markierung in `matched_rule`, damit die Unsicherheit ohne eigene Spalte erhalten bleibt. */
export const UNSICHER = "(unsicher)";
export const MANUAL_RULE = "von Hand";

export function isUncertainRule(rule: string | null | undefined): boolean {
  return !!rule && rule.includes(UNSICHER);
}

/** Lesbare Erklärung, warum eine Mail so eingeordnet wurde. */
export function describeRule(rule: string | null | undefined): string {
  if (!rule) return "unbekannt";
  if (rule === MANUAL_RULE) return "von Hand korrigiert";
  const [key, ...rest] = rule.replace(UNSICHER, "").trim().split(/\s*·\s*/);
  const why = rest.join(" · ");
  const label = (TOPIC_LABEL as Record<string, string>)[key];
  if (label) return `automatisch: ${label}${why ? ` (${why})` : ""}`;
  if (key === "keine regel") return "keine passende Regel – nur als Info abgelegt";
  if (key === "newsletter-merkmal") return "Abmeldelink im Text – als Werbung abgelegt";
  return key;
}

const SOURCES: [Classification["source"], RegExp][] = [
  ["amazon", /amazon\.(de|com|co\.uk|fr|it|es|nl|pl|se|com\.be)|marketplace\.amazon/i],
  ["ebay", /ebay\.(de|com|at|co\.uk)|@members\.ebay/i],
  ["tiktok", /tiktok/i],
  ["temu", /temu\.com|kuajing/i],
  ["dhl", /dhl\.(de|com)/i],
];

type Rule = {
  topic: Topic;
  category: MailCategory;
  subject?: RegExp;
  body?: RegExp;
  from?: RegExp;
  dueInDays?: number;
  /** Betreffmuster auch am Textanfang suchen. */
  bodyStart?: boolean;
  /** Eigenes (strengeres) Muster für den Textanfang statt des Betreffmusters. */
  head?: RegExp;
};

// ---- Geld: Auszahlungen und Zahlungsprobleme – lieber einmal zu oft „kritisch“ als übersehen.
const ANY = "[^.\\n]{0,40}";
/** Auszahlung an uns gestoppt, fehlgeschlagen oder einbehalten; Bankkonto für Auszahlungen ungültig. */
const PAYOUT_PROBLEM = new RegExp(
  [
    `auszahlung(en)?${ANY}(zurückgehalten|einbehalten|ausgesetzt|fehlgeschlagen|konnte nicht|gestoppt|verzögert|abgelehnt|nicht möglich|nicht durchgeführt|gesperrt|storniert)`,
    `zahlungen${ANY}(einbehalten|ausgesetzt|gesperrt|zurückgehalten)`,
    `(disbursement|payout|transfer)s?${ANY}(hold|deactivat|failed|suspend|delayed|unsuccessful|returned)`,
    `funds${ANY}(held|on hold|reserve)`,
    `(konto)?reserve${ANY}(erhöht|increased|angepasst|eingerichtet)`,
    `bank(konto|verbindung|daten)${ANY}(ungültig|abgelehnt|nicht verifiziert|nicht bestätigt|zurückgewiesen)`,
  ].join("|"),
  "i",
);
/** Zahlung von uns fehlgeschlagen/abgelehnt, offene Beträge, Mahnungen, Karte/Lastschrift-Probleme. */
const PAYMENT_PROBLEM = new RegExp(
  [
    `zahlung(en|smethode|sart|sinformationen|sdaten|smittel)?\\b${ANY}(fehlgeschlagen|abgelehnt|nicht (möglich|erfolgreich|durchgeführt|ausgeführt|verarbeitet)|konnte nicht|ausstehend|überfällig|offen\\b|aktualisieren|ungültig|abgelaufen|zurückgewiesen)`,
    `(aktualisieren|überprüfen|ändern|bestätigen) sie (ihre|die) (zahlungs\\w*|bankverbindung|kreditkarte|bankdaten|karte)`,
    `(kredit)?karte${ANY}(abgelehnt|abgelaufen|ungültig|nicht belastet|konnte nicht)`,
    `(lastschrift|abbuchung|einzug|sepa)${ANY}(fehlgeschlagen|zurück|nicht möglich|abgelehnt|konnte nicht)`,
    "rücklastschrift|zahlungserinnerung|mahnung|letzte erinnerung|inkasso|zahlungsverzug|zahlungsrückstand",
    "(offene[rn]?|ausstehende[rn]?|fällige[rn]?|negative[rn]?|unbezahlte[rn]?|überfällige[rn]?) (betrag|beträge|saldo|kontostand|rechnung|rechnungen|gebühren|forderung|zahlung|zahlungen)",
    `(saldo|kontostand|guthaben)${ANY}(negativ|im minus|nicht ausreichend|unzureichend)`,
    `(rechnung|gebühren|beiträge|abonnement)${ANY}(nicht bezahlt|unbezahlt|überfällig|konnten nicht (abgebucht|eingezogen))`,
    `payment${ANY}(failed|declined|unsuccessful|past due|overdue|required|issue|problem|on hold|rejected)`,
    `(card|payment method)${ANY}(declined|expired|failed|invalid)`,
    "update (your )?(payment|billing|card)",
    "(unpaid|outstanding|overdue|negative|past due) (balance|invoice|fees|amount)",
    "insufficient funds|account (is )?past due|final notice",
  ].join("|"),
  "i",
);
/** Für den Textanfang nur eindeutige Formulierungen (dort stehen auch „Zahlung erhalten“-Hinweise). */
const PAYMENT_PROBLEM_STRONG = /zahlung\w*[^.\n]{0,40}(fehlgeschlagen|abgelehnt|zurückgewiesen|konnte nicht)|rücklastschrift|mahnung|inkasso|zahlungsverzug|negative[rn]? (saldo|kontostand)|(saldo|kontostand)[^.\n]{0,40}(negativ|im minus)|(kredit)?karte[^.\n]{0,40}(abgelehnt|abgelaufen)|(lastschrift|abbuchung|einzug)[^.\n]{0,40}(fehlgeschlagen|abgelehnt|nicht möglich)|payment[^.\n]{0,40}(failed|declined|past due|overdue)|insufficient funds|card[^.\n]{0,40}declined|unpaid balance|past due/i;
/** Letztes Netz: Geld-Wort und Problem-Wort nah beieinander → mindestens „zu erledigen“. */
const MONEY_SIGNAL = /(zahlung|betrag|gebühr|rechnung|saldo|kontostand|auszahlung|lastschrift|kreditkarte|payment|invoice|balance|payout|fee)[^.\n]{0,60}(fehlgeschlagen|abgelehnt|offen|ausstehend|überfällig|gesperrt|ungültig|problem|failed|declined|overdue|suspended|due)|(fehlgeschlagen|abgelehnt|überfällig|gesperrt|failed|declined|overdue)[^.\n]{0,60}(zahlung|betrag|gebühr|rechnung|auszahlung|payment|invoice|payout)/i;

// Reihenfolge = Priorität. Die erste passende Regel gewinnt.
const RULES: Rule[] = [
  { topic: "account_health", category: "critical", subject: /kontozustand|account health|(konto|account).*(deaktivier|gesperrt|sperrung|suspend)|(deaktivier|sperrung).*(konto|verkaufsrecht)|verkäuferkonto.*(eingeschränkt|überprüf)|richtlinienversto|policy violation|handlungsbedarf|action required/i, dueInDays: 1 },
  { topic: "payment_hold", category: "critical", subject: PAYOUT_PROBLEM, dueInDays: 1 },
  { topic: "payment_problem", category: "critical", subject: PAYMENT_PROBLEM, head: PAYMENT_PROBLEM_STRONG, dueInDays: 1 },
  { topic: "ip_complaint", category: "critical", subject: /rechteinhaber|rechtsverletzung|urheberrecht|markenrecht|intellectual property|infring/i, dueInDays: 2 },
  { topic: "listing_blocked", category: "critical", subject: /(angebot|artikel|listing|asin).*(entfernt|deaktiviert|gesperrt|blockiert|removed|deactivated|suppressed)|rechnung(en)?.*(anfordern|vorlegen|einreichen)|echtheit|authenticit|produktsicherheit|produktkonformit|compliance.*(erforderlich|required)|dokumente.*(erforderlich|anfordern)/i, dueInDays: 2 },
  { topic: "a_to_z", category: "action", subject: /a-bis-z|a-to-z|a-z-garantie|garantieantrag/i, dueInDays: 2 },
  { topic: "chargeback", category: "action", subject: /rückbelastung|chargeback|zahlungsstreit/i, dueInDays: 3 },
  { topic: "ebay_case", category: "action", subject: /fall (eröffnet|wurde eröffnet)|artikel nicht erhalten|nicht wie beschrieben|entspricht nicht der beschreibung|case opened|item not received|not as described|käuferschutz/i, dueInDays: 2 },
  { topic: "return_request", category: "action", subject: /rücksendeanfrage|rücksendung.*(angefordert|beantragt|genehmigen)|return request|rückgabeantrag/i, dueInDays: 2 },
  { topic: "negative_feedback", category: "action", subject: /negative (bewertung|feedback)|neutrale bewertung|negative feedback/i, dueInDays: 3 },
  { topic: "inbound_problem", category: "action", subject: /(sendung|shipment|lieferung).*(problem|fehler|abweich|discrepan)|probleme beim wareneingang|inbound.*(problem|defect)|bearbeitungsgebühr|unplanned (service|prep)/i, dueInDays: 5 },
  // Rückfragen zur Verkäufer-Registrierung kommen oft über dieselben Absender wie Käufernachrichten – deshalb vorher.
  { topic: "registration", category: "action", subject: /registrierung|registration|verifizierung|verification|verifizieren|verify|identitätsprüfung|identität (bestätigen|überprüfen|nachweisen)|ausweis|kyc|know your customer|anmeldung (abschließen|fortsetzen)|onboarding/i, bodyStart: true, dueInDays: 3 },
  { topic: "buyer_message", category: "action", subject: /nachricht von (käufer|kunde|einem kunden)|anfrage von (käufer|kunde|einem kunden)|käuferanfrage|buyer message|message from (buyer|customer)|frage zu/i, dueInDays: 1 },
  { topic: "buyer_message", category: "action", from: /marketplace\.amazon|members\.ebay/i, dueInDays: 1 },
  { topic: "case_update", category: "action", subject: /fall-id|case id|ihr (support)?fall|your case|supportanfrage/i, dueInDays: 3 },
  { topic: "payout_info", category: "info", subject: /auszahlung|abrechnung|settlement|disbursement|zahlung.*überwiesen/i },
  { topic: "order_info", category: "info", subject: /bestellung|versandt|verkauft|sold|order|versandbestätigung|zugestellt|sendungsverfolgung/i },
  { topic: "marketing", category: "noise", subject: /newsletter|webinar|seller university|prime day|black friday|neuigkeiten|tipps|angebot für sie|werbe|promotion|umfrage|survey|event|einladung|jetzt anmelden/i },
];

const REF_PATTERNS: [string, RegExp][] = [
  ["amazonOrder", /\b\d{3}-\d{7}-\d{7}\b/],
  ["ebayOrder", /\b\d{2}-\d{5}-\d{5}\b/],
  ["asin", /\bB0[A-Z0-9]{8}\b/],
  ["caseId", /(?:fall-?id|case[- ]?id|fallnummer)[:\s#]*(\d{8,12})/i],
  ["fbaShipment", /\bFBA[A-Z0-9]{8,10}\b/],
  ["tracking", /\b(00340\d{15}|JJD\d{15,20}|\d{12,20})\b/],
];

export function extractReferences(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, re] of REF_PATTERNS) {
    const m = re.exec(text);
    if (m) out[k] = m[1] ?? m[0];
  }
  if (out.tracking && (out.tracking === out.amazonOrder?.replace(/-/g, "") || !/^(00340|JJD)/.test(out.tracking))) delete out.tracking;
  return out;
}

/** Frist aus dem Text: "innerhalb von 3 Tagen", "bis zum 30.09.2026". */
export function extractDeadlineDays(text: string, today: Date): number | null {
  const m = /innerhalb (?:von |der nächsten )?(\d{1,2}) (?:werk)?tag/i.exec(text) ?? /within (\d{1,2}) (?:business )?days/i.exec(text);
  if (m) return Number(m[1]);
  const d = /bis (?:zum |spätestens )?(\d{1,2})\.(\d{1,2})\.(\d{4})/i.exec(text);
  if (d) {
    const due = Date.UTC(Number(d[3]), Number(d[2]) - 1, Number(d[1]));
    const days = Math.ceil((due - today.getTime()) / 86400_000);
    if (days >= 0 && days < 120) return days;
  }
  return null;
}

export function classifyMail(m: MailInput, today = new Date()): Classification {
  const source = SOURCES.find(([, re]) => re.test(m.from))?.[0] ?? null;
  const text = `${m.subject}\n${m.body}`;
  const references = extractReferences(text);
  if (!source) {
    // Zahlungsprobleme auch von Bank, PayPal, Hosting, Lieferanten … – sonst würden sie gar nicht gespeichert.
    const money = PAYOUT_PROBLEM.test(m.subject) ? "payment_hold" : PAYMENT_PROBLEM.test(m.subject) ? "payment_problem" : null;
    if (money) {
      const due = extractDeadlineDays(text, today) ?? 1;
      return { relevant: true, source: null, category: "critical", topic: money, rule: `${money} · Betreff, Absender ohne Marktplatz`, uncertain: false, references, dueInDays: due };
    }
    return { relevant: false, source: null, category: "info", topic: "other", rule: "kein Marktplatz-Absender", uncertain: false, references, dueInDays: null };
  }
  const head = m.body.slice(0, 600);
  // Durchgang 1: Betreff (kritische Themen auch am Textanfang), Absender. Durchgang 2: übrige Textanfang-Regeln –
  // so gewinnt ein eindeutiger Betreff immer gegen ein Stichwort im Text.
  for (const pass of [1, 2]) {
    for (const r of RULES) {
      if (r.from && !r.from.test(m.from)) continue;
      let why = "Betreff";
      if (r.subject && !r.subject.test(m.subject)) {
        const bodyOk = r.category === "critical" ? pass === 1 : r.bodyStart && pass === 2;
        if (!bodyOk || !(r.head ?? r.subject).test(head)) continue;
        why = "nur im Text erkannt";
      } else if (pass === 2) continue;
      if (r.body && !r.body.test(m.body)) continue;
      if (!r.subject && !r.body) why = "nur Absender erkannt";
      const uncertain = why !== "Betreff";
      const due = extractDeadlineDays(text, today) ?? r.dueInDays ?? null;
      return { relevant: true, source, category: r.category, topic: r.topic, rule: uncertain ? `${r.topic} · ${why} ${UNSICHER}` : r.topic, uncertain, references, dueInDays: due };
    }
  }
  if (MONEY_SIGNAL.test(`${m.subject}\n${head}`)) {
    return { relevant: true, source, category: "action", topic: "payment_problem", rule: `payment_problem · Geld-Stichwort mit Problem-Wort ${UNSICHER}`, uncertain: true, references, dueInDays: extractDeadlineDays(text, today) ?? 2 };
  }
  const noise = /abbestellen|unsubscribe|newsletter/i.test(m.body);
  return { relevant: true, source, category: noise ? "noise" : "info", topic: noise ? "marketing" : "other", rule: noise ? "newsletter-merkmal" : `keine regel ${UNSICHER}`, uncertain: !noise, references, dueInDays: null };
}
