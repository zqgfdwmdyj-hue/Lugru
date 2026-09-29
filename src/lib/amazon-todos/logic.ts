// Amazon-ToDos: Grobfilter, KI-Auftrag und -Antwort, Einstufung ohne KI, automatisches Erledigen.
// Ohne Server-Abhängigkeiten, damit alles mit Beispielmails testbar ist.

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
];

export function noiseReason(m: { from: string; subject: string }): string | null {
  if (!isAmazonSystemMail(m.from)) return "kein Amazon-Systemabsender";
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
export const CLOSABLE = new Set(["reaktivierung", "echtheitspruefung", "entsorgung_drohung", "produktsicherheit", "remission_aufforderung", "konto", "sonstiges"]);

/** Welche offenen Aufgaben schließt eine neue Freigabe-Mail? Nur ältere mit gemeinsamer ASIN. */
export function todosClosedBy(info: { category: string; asins: string[]; receivedAt: string }, open: { id: string; category: string; asins: string[]; receivedAt: string }[]): string[] {
  if (info.category !== "freigabe_info" || info.asins.length === 0) return [];
  const set = new Set(info.asins);
  return open.filter((o) => CLOSABLE.has(o.category) && o.receivedAt <= info.receivedAt && o.asins.some((a) => set.has(a))).map((o) => o.id);
}

// ---- Anzeige ------------------------------------------------------------------------------

export const CATEGORY_LABEL: Record<string, string> = {
  produktsicherheit: "Produktsicherheit",
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
  auto_remission: "Automatische Remission",
  sonstiges: "Sonstiges",
};

export const categoryLabel = (c: string) => CATEGORY_LABEL[c] ?? c.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase());
