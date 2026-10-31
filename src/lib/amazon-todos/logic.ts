// Amazon-ToDos: Grobfilter, KI-Auftrag und -Antwort, Einstufung ohne KI, automatisches Erledigen.
// Ohne Server-Abhängigkeiten, damit alles mit Beispielmails testbar ist.

import { BESTELL_MAIL_RE, FBA_VERSAND_RE } from "./versand";

export type TodoPriority = "high" | "medium" | "low";

export type TriageMail = { key: string; from: string; subject: string; date: string; text: string };

export type TriageResult = {
  key: string;
  relevant: boolean;
  actionNeeded: boolean;
  category: string;
  priority: TodoPriority;
  deadline: string | null;
  asins: string[];
  summary: string;
};

// ---- Grobfilter (ohne KI) -------------------------------------------------------------------

/** Mails von Amazon an den Verkäufer (nicht Käufernachrichten über marketplace.amazon). */
export function isAmazonSystemMail(from: string): boolean {
  return /amazon\./i.test(from) && !/marketplace\.amazon/i.test(from);
}

/** Absender, die nie eine Handlung verlangen. Neue Rauschquellen hier ergänzen, nicht in der KI. */
export const NOISE_FROM: RegExp[] = [
  /(auto-confirm|order-update|shipment-tracking|ship-confirm|versandbestaetigung|bestellbestaetigung|confirmar|conferma|confirmation)@amazon/i,
  /(order|shipping|tracking|delivery|package|pickup|locker|return-?address)[-a-z]*@amazon/i,
  /(promotion|promotions|marketing|advertising|ads|sponsored|deals|newsletter|news|webinar|events?|coaching|seller-?university|accelerator)[-a-z0-9]*@amazon/i,
  /(developer|sp-?api|mws|registration)[-a-z]*@amazon/i,
  /(freight|carrier|amazon-?freight|relay)[-a-z]*@amazon/i,
  /(payments?|disbursement|auszahlung|billing|invoice|rechnung|lending)[-a-z]*@amazon/i,
  /no-?reply@amazon\.(de|com)\b.*(prime|video|music|kindle)/i,
];

export const NOISE_SUBJ: RegExp[] = [
  /\[CASE|\[Fall(nummer|-ID)?|\bFall-ID\b|Case ID:/i, // gehört ins Fälle-Modul
  /bestellbestätigung|versandbestätigung|ihre bestellung (wurde|ist)|order confirmation|has shipped|wurde versandt|zugestellt|delivered/i,
  /auszahlung|disbursement|zahlung.*(überwiesen|veranlasst)|kontoauszug|abrechnung verfügbar/i,
  /vielen dank|danke für|thank you for/i,
  /\bprime\b|prime day|webinar|seminar|\bdeal(s)?\b|blitzangebot|angebotstipp|verkaufschancen|wachstumschancen|tipps? für|empfehlungen für ihr/i,
  /automatische remission|automated removal|automatische rücksendung/i, // Inhaber-Entscheidung: ignorieren
  /amazon hat ihre artikel versandt|verkauft[,!]? jetzt (liefern|versenden)|sold[,!]? ship now|kapazitätslimit|capacity limit|inventory (storage )?limits?/i, // Routine
];

export function noiseReason(m: { from: string; subject: string }): string | null {
  if (!isAmazonSystemMail(m.from)) return "kein Amazon-Systemabsender";
  // Bestell-Mails folgen dem Auftrag (Versand-Abgleich), FBA-Versandinfos werden archiviert – nie ein ToDo.
  if (BESTELL_MAIL_RE.test(m.subject)) return "Bestell-Mail – folgt dem Auftrag";
  if (FBA_VERSAND_RE.test(m.subject)) return "FBA-Versandinfo";
  const f = NOISE_FROM.find((r) => r.test(m.from));
  if (f) return `Absender-Muster ${f.source.slice(0, 40)}`;
  const s = NOISE_SUBJ.find((r) => r.test(m.subject));
  if (s) return `Betreff-Muster ${s.source.slice(0, 40)}`;
  return null;
}

// ---- KI-Auftrag und -Antwort ----------------------------------------------------------------

export const BATCH_SIZE = 10;
export const TEXT_CHARS = 900;
export const MAX_TOKENS = 4800;

export function triagePrompt(mails: TriageMail[]): string {
  const list = mails
    .map((m, i) => `### Mail ${i + 1} (id ${m.key})\nVon: ${m.from}\nDatum: ${m.date.slice(0, 10)}\nBetreff: ${m.subject}\nText: ${m.text.replace(/\s+/g, " ").slice(0, TEXT_CHARS)}`)
    .join("\n\n");
  return [
    "Du sortierst Amazon-Systemmails für einen Amazon-Händler (FBA und FBM). Bewerte jede Mail:",
    "- relevant: betrifft den Verkäufer-Betrieb (Angebote, Bestand, Compliance, Konto, Claims). Nein bei Werbung, Bestätigungen, privaten Einkäufen.",
    "- aktion_noetig: der Händler muss etwas tun (einreichen, beauftragen, antworten, Frist wahren). Nein bei reinen Erfolgs- oder Info-Meldungen.",
    "- kategorie: ein Schlagwort in snake_case, bevorzugt: produktsicherheit, reaktivierung, echtheitspruefung, entsorgung_drohung, remission_aufforderung, rueckruf, claim, erstattung_abgelehnt, konto, freigabe_info, logistik_info.",
    "  freigabe_info = etwas wurde erledigt/freigegeben (Bestand freigegeben, Angebot wieder aktiv, Widerspruch angenommen).",
    "- prioritaet: hoch (Frist, Vernichtung, Kontorisiko), mittel (Aufforderung ohne akute Frist), niedrig (Info).",
    "- frist: ISO-Datum JJJJ-MM-TT; „innerhalb von 30 Tagen“ ab Maildatum rechnen; sonst leer.",
    "- asins: betroffene ASINs aus der Mail (10 Zeichen, meist B0…).",
    "- zusammenfassung: ein Satz auf Deutsch: was ist zu tun.",
    "",
    list,
    "",
    'Antworte NUR mit einem JSON-Array, ein Objekt je Mail in derselben Reihenfolge: [{"id":"…","relevant":true,"aktion_noetig":true,"kategorie":"…","prioritaet":"hoch","frist":"2026-10-30","asins":["B0…"],"zusammenfassung":"…"}]',
  ].join("\n");
}

const PRIO: Record<string, TodoPriority> = { hoch: "high", high: "high", mittel: "medium", medium: "medium", niedrig: "low", low: "low" };

export function extractAsins(text: string): string[] {
  return [...new Set((text.toUpperCase().match(/\bB0[A-Z0-9]{8}\b/g) ?? []))];
}

const snake = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "sonstiges";

/**
 * Liest die KI-Antwort. Robust gegen Codeblöcke und Text drumherum; ein abgeschnittenes Array
 * liefert die vollständigen Objekte davor. Mails ohne Antwort fehlen im Ergebnis (nächster Lauf).
 */
export function parseTriage(text: string, mails: TriageMail[]): TriageResult[] {
  const start = text.indexOf("[");
  if (start < 0) return [];
  let body = text.slice(start);
  let items: unknown[] | null = null;
  try {
    items = JSON.parse(body.slice(0, body.lastIndexOf("]") + 1));
  } catch {
    // Abgeschnitten: bis zum letzten vollständigen Objekt kürzen.
    const lastObj = body.lastIndexOf("}");
    if (lastObj > 0) {
      body = `${body.slice(0, lastObj + 1)}]`;
      try {
        items = JSON.parse(body);
      } catch {
        items = null;
      }
    }
  }
  if (!Array.isArray(items)) return [];
  const byKey = new Map(mails.map((m) => [m.key, m]));
  const out: TriageResult[] = [];
  items.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") return;
    const r = raw as Record<string, unknown>;
    const mail = (typeof r.id === "string" && byKey.get(r.id)) || mails[i];
    if (!mail || out.some((o) => o.key === mail.key)) return;
    const frist = typeof r.frist === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.frist) && !Number.isNaN(Date.parse(r.frist)) ? r.frist : null;
    const asins = Array.isArray(r.asins) ? r.asins.map((a) => String(a).trim().toUpperCase()).filter((a) => /^[A-Z0-9]{10}$/.test(a)) : [];
    out.push({
      key: mail.key,
      relevant: r.relevant !== false,
      actionNeeded: r.aktion_noetig !== false,
      category: snake(String(r.kategorie ?? "sonstiges")),
      priority: PRIO[String(r.prioritaet ?? "").toLowerCase()] ?? "medium",
      deadline: frist,
      asins: [...new Set([...asins, ...extractAsins(`${mail.subject} ${mail.text}`)])].slice(0, 50),
      summary: String(r.zusammenfassung ?? "").trim().slice(0, 400) || mail.subject,
    });
  });
  return out;
}

// ---- Einstufung ohne KI (wenn kein Schlüssel hinterlegt ist) ---------------------------------

const RULES: { re: RegExp; category: string; priority: TodoPriority; action: boolean }[] = [
  { re: /(bestand|inventar|angebot|listing|asin).*(freigegeben|wieder aktiv|reaktiviert|reinstated)|widerspruch.*(angenommen|genehmigt)|appeal.*(approved|accepted)/i, category: "freigabe_info", priority: "low", action: false },
  { re: /vernicht|entsorg|dispos|destroy/i, category: "entsorgung_drohung", priority: "high", action: true },
  { re: /echtheit|authentizit|authenticity|lagerbestandsprüfung|inventory (review|verification)|fälschung|counterfeit/i, category: "echtheitspruefung", priority: "high", action: true },
  { re: /rückruf|recall/i, category: "rueckruf", priority: "high", action: true },
  { re: /produktsicherheit|product safety|gpsr|compliance|konformität|sicherheitsdatenblatt|dokumente? (einreichen|erforderlich)/i, category: "produktsicherheit", priority: "high", action: true },
  { re: /remission|rücksendung.*(beauftragen|anfordern)|removal order.*(required|create)/i, category: "remission_aufforderung", priority: "high", action: true },
  { re: /reaktivier|deaktiviert|deactivated|suppressed|unterdrückt|entfernt|removed/i, category: "reaktivierung", priority: "medium", action: true },
  { re: /erstattung.*(abgelehnt|nicht)|reimbursement.*(denied|declined)/i, category: "erstattung_abgelehnt", priority: "medium", action: true },
  { re: /safe-?t|a-bis-z|a-to-z|claim|anspruch|garantieantrag/i, category: "claim", priority: "medium", action: true },
  { re: /konto|account|richtlinie|policy|verstoß|violation|verkaufsrecht/i, category: "konto", priority: "high", action: true },
  { re: /sendung|shipment|inbound|lager|warehouse/i, category: "logistik_info", priority: "low", action: false },
];

/** Frist aus dem Text: „innerhalb von 30 Tagen“, „bis zum 12.10.2026“, „by October 12, 2026“. */
export function deadlineFromText(text: string, mailDate: string): string | null {
  const t = text.replace(/\s+/g, " ");
  const within = /(?:innerhalb|binnen|within)(?: von)? (\d{1,3}) (?:tag|day)/i.exec(t);
  if (within) {
    const d = new Date(`${mailDate.slice(0, 10)}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + Number(within[1]));
    return d.toISOString().slice(0, 10);
  }
  const de = /(?:bis (?:zum|spätestens)?|vor dem|frist[^0-9]{0,20})\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/i.exec(t);
  if (de) return `${de[3]}-${de[2].padStart(2, "0")}-${de[1].padStart(2, "0")}`;
  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const en = /by (january|february|march|april|may|june|july|august|september|october|november|december) (\d{1,2}),? (\d{4})/i.exec(t);
  if (en) return `${en[3]}-${String(MONTHS.indexOf(en[1].toLowerCase()) + 1).padStart(2, "0")}-${en[2].padStart(2, "0")}`;
  return null;
}

export function triageByRules(m: TriageMail): TriageResult {
  const hay = `${m.subject} ${m.text.slice(0, 2000)}`;
  const rule = RULES.find((r) => r.re.test(hay));
  const deadline = deadlineFromText(m.text, m.date);
  return {
    key: m.key,
    relevant: true,
    actionNeeded: rule ? rule.action : true,
    category: rule?.category ?? "sonstiges",
    priority: rule?.priority === "medium" && deadline ? "high" : (rule?.priority ?? "medium"),
    deadline,
    asins: extractAsins(hay),
    summary: m.subject,
  };
}

// ---- Automatisch erledigen ----------------------------------------------------------------

/** Kategorien, die eine Freigabe-Mail zur selben ASIN erledigt. */
export const CLOSABLE = new Set(["reaktivierung", "echtheitspruefung", "entsorgung_drohung", "produktsicherheit", "remission_aufforderung", "konto", "sonstiges", "compliance_epr", "compliance_daten", "preisfehler", "marke", "dokument"]);

/** Welche offenen Aufgaben schließt eine neue Freigabe-Mail? Nur ältere mit gemeinsamer ASIN. */
export function todosClosedBy(info: { category: string; asins: string[]; receivedAt: string }, open: { id: string; category: string; asins: string[]; receivedAt: string }[]): string[] {
  if (info.category !== "freigabe_info" || info.asins.length === 0) return [];
  const set = new Set(info.asins);
  return open.filter((o) => CLOSABLE.has(o.category) && o.receivedAt <= info.receivedAt && o.asins.some((a) => set.has(a))).map((o) => o.id);
}

// ---- Anzeige ------------------------------------------------------------------------------

export const CATEGORY_LABEL: Record<string, string> = {
  produktsicherheit: "Produktsicherheit",
  compliance_epr: "Compliance: EPR / Batterien / Verpackung",
  compliance_daten: "Compliance: EU-Datengesetz",
  preisfehler: "Preisfehler",
  marke: "Marke / Markenautorisierung",
  dokument: "Dokument einreichen",
  reaktivierung: "Reaktivierung",
  echtheitspruefung: "Echtheitsprüfung",
  entsorgung_drohung: "Entsorgungsdrohung",
  remission_aufforderung: "Remissionsaufforderung",
  rueckruf: "Rückruf",
  claim: "Claim",
  erstattung_abgelehnt: "Erstattung abgelehnt",
  konto: "Konto",
  freigabe_info: "Freigabe",
  logistik_info: "Logistik-Info",
  versand_ueberfaellig: "Versandfrist abgelaufen (FBM)",
  versand_unbestaetigt: "Versendet, bei Amazon nicht bestätigt",
  import_luecke: "Bestellung fehlt im Tool",
  auto_remission: "Automatische Remission",
  sonstiges: "Sonstiges",
};

export const categoryLabel = (c: string) => CATEGORY_LABEL[c] ?? c.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase());

// ---- Pflicht-ToDos: Deaktivierung, Dokumente, Compliance (alle EU-Sprachen) ----------------------------------
// Diese Mails werden nie der KI überlassen: sie ergeben immer ein Amazon-ToDo (hohe Priorität) mit ASINs/SKUs,
// Marktplatz und Link „Kontozustand“ – Grundlage für die Amazon-Fall-Zentrale.

const PFLICHT: { category: string; re: RegExp }[] = [
  // Batterien/EPR, Verpackung, WEEE – Registrierungsnummern
  { category: "compliance_epr", re: /\bEPR\b|batter(y|ies|ie|ij|ia|ías?|ien)|batteri(er|e)|registration numbers?|registrierungsnummer|registratienummer|numéro d'enregistrement|numero di registrazione|número de registro|numer rejestrow|registreringsnummer|\bWEEE\b|\bLUCID\b|verpackungsregister/i },
  // EU-Datengesetz (Data Act)
  { category: "compliance_daten", re: /data act|datengesetz|gegevenswet|loi sur les données|legge sui dati|ley de datos|akt o danych|dataförordning|eu-?gegevens|daten(gesetz|verordnung)/i },
  // Produktsicherheit (GPSR)
  { category: "produktsicherheit", re: /\bGPSR\b|product safety|produktsicherheit|productveiligheid|sécurité (générale )?des produits|sicurezza (generale )?dei prodotti|seguridad (general )?de (los )?productos|bezpieczeństw\w* produkt|produktsäkerhet|safety (information|attributes)|sicherheitsinformationen/i },
  // Preisfehler
  { category: "preisfehler", re: /pric(e|ing) errors?|preisfehler|potenziell(er|e) preisfehler|prijsfout|erreur(s)? de prix|errore (di|nel) prezzo|error(es)? de precio|błęd\w* cen|prisfel/i },
  // Marke / Markenautorisierung
  { category: "marke", re: /trademark|brand authori[sz]ation|markenautori|marken(genehmigung|nachweis)|merkautori|autorisation de (la )?marque|autorizzazione (del )?marchio|autorización de (la )?marca|autoryzacj\w* mark|varumärkes/i },
  // Dokument/Unterlagen einreichen bzw. erneut einreichen
  { category: "dokument", re: /(re)?submit (a |the |your )?(document|invoice|information)|document(s|ation)? (required|requested)|resubmission|unterlagen (einreichen|nachreichen|erforderlich)|dokument\w* (erforderlich|einreichen|nachreichen|erneut)|opnieuw indienen|document\w* vereist|verstrek gegevens|indienen van|documents? requis|soumettre|fournir (les|des) (documents|informations)|documento? richiest|invia(re)? (i |il )?document|fornire (i |le )?(document|informazion)|documentaci[oó]n (requerida|necesaria)|enviar (los |la )?document|proporcion(ar|e) (la )?informaci|wymagan\w* dokument|prześlij|dokument (krävs|begärs)|skicka in/i },
  // Deaktivierung / Reaktivierung / Entfernung von Angeboten
  { category: "reaktivierung", re: /deactivat|reactivat|reinstat|suppress|listings? (removed|blocked|inactive)|deaktivier|reaktivier|gesperrt|entfernt|gedeactiveerd|deactiver|deactivering|heractiver|opnieuw activeren|verwijderd|désactiv|réactiv|supprim|disattiv|riattiv|rimoss|desactiv|reactiv|eliminad|dezaktyw|reaktyw|usunięt|inaktiver|avaktiver|återaktiver|borttag/i },
];

const TLD_LAND: Record<string, string> = { de: "DE", fr: "FR", it: "IT", es: "ES", nl: "NL", "com.be": "BE", pl: "PL", se: "SE", "co.uk": "UK", ie: "IE", ae: "AE", sa: "SA", "com.tr": "TR", eg: "EG", com: "US" };

const LAND_TLD: Record<string, string> = Object.fromEntries(Object.entries(TLD_LAND).map(([t, l]) => [l, t]));

// Sprache der Mail → Marktplatz (nur EU-Sprachen; Englisch bleibt offen, weil UK/IE/US/EU-Englisch).
const SPRACHE_LAND: [string, RegExp][] = [
  ["DE", /\b(?:ihre?|ihr|ihren|bestellung|versandt|zahlung|auszahlung|verkauft|jetzt|liefern|wichtige|informationen|artikel)\b/gi],
  ["FR", /\b(?:votre|vos|commande|exp[ée]di[ée]e?s?|paiement|vendu|livrer|maintenant|articles?)\b/gi],
  ["ES", /\b(?:tu|tus|pedido|enviado|est[áa]|pago|vendido|ahora|camino|art[íi]culos?)\b/gi],
  ["IT", /\b(?:tuo|tuoi|ordine|spedit[oi]|pagamento|venduto|spedisci|arrivo|articoli)\b/gi],
  ["NL", /\b(?:uw|bestelling|verzonden|betaling|verkocht|onderweg|artikelen)\b/gi],
  ["PL", /\b(?:twoje?|zam[óo]wienie|wys[łl]an[oay]?|p[łl]atno[śs][ćc]|sprzedano)\b/gi],
  ["SE", /\b(?:din|ditt|best[äa]llning|skickat|betalning|s[åa]ld|p[åa] v[äa]g)\b/gi],
];

/** Sprache aus Betreff + Textanfang: Land mit den meisten Treffern (mind. 2, eindeutig), sonst null. */
export function landAusSprache(text: string): string | null {
  const t = text.slice(0, 800);
  const z = SPRACHE_LAND.map(([land, re]) => [land, (t.match(re) ?? []).length] as const).sort((a, b) => b[1] - a[1]);
  return z[0][1] >= 2 && z[0][1] > z[1][1] ? z[0][0] : null;
}

/**
 * Marktplatz aus der Absender-Domain (amazon.nl → NL). amazon.com ist auch ein allgemeiner Absender für EU-Mails –
 * dann zählt der Inhalt (amazon.fr/sellercentral.amazon.es im Text, sonst die Sprache). „US“ nur mit klarem Hinweis
 * (sellercentral.amazon.com oder Dollarbetrag), sonst bleibt der Marktplatz offen.
 */
export function marktplatzAus(from: string, text = ""): { land: string | null; tld: string | null } {
  const DOM = /amazon\.(com\.be|co\.uk|com\.tr|de|fr|it|es|nl|pl|se|ie|ae|sa|eg|com)\b/i;
  const ab = DOM.exec(from);
  const absTld = ab?.[1].toLowerCase() ?? null;
  if (absTld && absTld !== "com") return { land: TLD_LAND[absTld] ?? null, tld: absTld };
  const spez = /(?:sellercentral\.|www\.|\b)amazon\.(com\.be|co\.uk|com\.tr|de|fr|it|es|nl|pl|se|ie|ae|sa|eg)\b/i.exec(text);
  if (spez) {
    const tld = spez[1].toLowerCase();
    return { land: TLD_LAND[tld] ?? null, tld };
  }
  // Land/Währung im Text (z. B. UAE-Mail von amazon.com: „AED“, „United Arab Emirates“).
  const hinweis: [string, RegExp][] = [
    // Währungskürzel nur in Großbuchstaben („try“ ist ein englisches Wort).
    ["AE", /\bAED\b|\bUAE\b|[Uu]nited [Aa]rab [Ee]mirates|[Vv]ereinigte [Aa]rabische [Ee]mirate/],
    ["SA", /\bSAR\b|[Ss]audi[ -][Aa]rabi(?:a|en)/],
    ["UK", /£\s?\d|\bGBP\b|[Uu]nited [Kk]ingdom/],
    ["TR", /\bTRY\b|[Tt]ürkiye|amazon\.com\.tr/],
  ];
  const hw = hinweis.find(([, re]) => re.test(text));
  if (hw) return { land: hw[0], tld: LAND_TLD[hw[0]] ?? null };
  const sprache = landAusSprache(text);
  if (sprache) return { land: sprache, tld: LAND_TLD[sprache] ?? null };
  if (/sellercentral\.amazon\.com\b(?!\.)|(?:US\$|\$\s?\d)/i.test(text)) return { land: "US", tld: "com" };
  return { land: null, tld: absTld };
}

/** Link „Kontozustand“ in Seller Central des Marktplatzes (Europa: amazon.de als Standard). */
export const kontozustandLink = (tld: string | null) => `https://sellercentral.amazon.${tld && tld !== "com" ? tld : "de"}/performance/account/health`;

export function extractSkus(text: string): string[] {
  const out = new Set<string>();
  // Satzzeichen am Ende („SKU: ABC-1.“) gehören nicht zur SKU.
  for (const m of text.matchAll(/\b(?:SKU|Händler-SKU|Seller SKU|MSKU)\s*[:#]?\s*([A-Za-z0-9][\w.\-/]{2,39})/gi)) {
    const sku = m[1].replace(/[.\-/]+$/, "");
    if (sku.length >= 3) out.add(sku);
  }
  return [...out].slice(0, 30);
}

/** Pflicht-Muster: Kategorie (Compliance vor Deaktivierung), sonst null. */
export function pflichtRegel(m: { subject: string; text: string }): { category: string } | null {
  const hay = `${m.subject}\n${m.text.slice(0, 3000)}`;
  // Reine Freigaben („wieder aktiv“) sind keine Pflicht-ToDos.
  if (/(wieder aktiv|reactivated successfully|has been reinstated|wurde reaktiviert|is weer actief|est de nouveau actif|è di nuovo attiv|vuelve a estar activ)/i.test(m.subject)) return null;
  for (const p of PFLICHT) if (p.re.test(m.subject)) return { category: p.category };
  for (const p of PFLICHT.slice(0, 5)) if (p.re.test(hay) && /(deactivat|deaktivier|gedeactiveerd|deactivering|désactiv|disattiv|desactiv|dezaktyw|inaktiver|remov|entfernt|required|erforderlich|vereist|requis|richiest|requerid|wymagan|krävs)/i.test(hay)) return { category: p.category };
  return null;
}
