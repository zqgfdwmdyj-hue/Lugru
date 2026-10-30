// Sprache für die VA: Der VA spricht Englisch, Ludwig Deutsch. Reine Logik (testbar): Glossar, Schutz von
// Nummern/Beträgen/Links vor der Übersetzung, Spracherkennung, KI-Auftrag und die festen Bot-Texte je Sprache.

export type Sprache = "de" | "en";

/** Fachbegriffe für einheitliche Übersetzungen (Einstellungen, erweiterbar). */
export const GLOSSAR_STANDARD: Record<string, string> = {
  Anspruch: "reimbursement claim",
  Freischaltung: "ungating / approval",
  Remission: "removal order",
  Fall: "case",
  Rechnung: "invoice",
  Sendung: "shipment",
  Fehlmenge: "shortage",
  Lageralter: "inventory age",
};

/** Glossar aus Textzeilen „Deutsch = Englisch“ (Einstellungen). Leere oder kaputte Zeilen fallen weg. */
export function glossarAusText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const z of text.split(/\r?\n/)) {
    const m = /^\s*([^\s=→][^=→]*?)\s*(?:=|→|->)\s*(\S.*?)\s*$/.exec(z);
    if (m && m[1].length <= 60 && m[2].length <= 80) out[m[1]] = m[2];
  }
  return out;
}
export const glossarAlsText = (g: Record<string, string>) => Object.entries(g).map(([de, en]) => `${de} = ${en}`).join("\n");

// ---- Schutz: was nie übersetzt oder verändert werden darf -------------------------------------------------

const SCHUTZ: RegExp[] = [
  /https?:\/\/\S+/g, // Links
  /\/datei\/[0-9a-f-]{36}/gi, // Dateilinks
  /<@!?\d+>/g, // Discord-Erwähnungen
  /\bFBA[0-9A-Z]{6,12}\b/g, // Sendungen
  /\bB0[A-Z0-9]{8}\b/g, // ASINs
  /\b\d{3}-\d{7}-\d{7}\b/g, // Bestellnummern
  /\b\d{8,14}\b/g, // Fall-, EAN- und sonstige lange Nummern
  /\b(?:SKU|MSKU)[:\s]+[\w.\-/]{3,40}/gi, // SKU mit Angabe
  /\b[A-Z0-9]{2,}(?:-[A-Z0-9]{2,}){1,5}\b/g, // SKUs wie TEST-NIKE-1, 8U-P4IG-LL5O
  /-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,2})?\s?(?:€|EUR)|(?:€|EUR)\s?-?\d[\d.,]*/gi, // Beträge
];

/** Geschützte Stellen durch ⟦0⟧, ⟦1⟧ … ersetzen (für die KI); `teile` setzt sie danach wieder ein. */
export function schuetzen(text: string): { text: string; teile: string[] } {
  const teile: string[] = [];
  let out = text;
  for (const re of SCHUTZ) {
    out = out.replace(re, (m) => {
      if (/^⟦\d+⟧$/.test(m)) return m;
      const i = teile.indexOf(m);
      if (i >= 0) return `⟦${i}⟧`;
      teile.push(m);
      return `⟦${teile.length - 1}⟧`;
    });
  }
  return { text: out, teile };
}

/** Platzhalter zurücksetzen; null, wenn die Übersetzung Platzhalter verloren oder erfunden hat. */
export function wiederherstellen(text: string, teile: string[]): string | null {
  const gefunden = [...text.matchAll(/⟦(\d+)⟧/g)].map((m) => Number(m[1]));
  if (gefunden.some((i) => i >= teile.length)) return null;
  for (let i = 0; i < teile.length; i++) if (!gefunden.includes(i)) return null;
  return text.replace(/⟦(\d+)⟧/g, (_, i: string) => teile[Number(i)]);
}

// ---- Spracherkennung (einfach, ohne KI) ------------------------------------------------------------------

const DE_WORT = /\b(und|oder|nicht|bitte|ich|du|der|die|das|den|dem|ist|sind|habe|hast|für|mit|auf|noch|schon|kannst|soll|wurde|erledigt|danke|rechnung|sendung|frist|heute|morgen)\b|[äöüß]/gi;
const EN_WORT = /\b(and|or|not|please|the|is|are|have|has|for|with|on|still|already|can|could|should|would|you|me|my|done|thanks|thank|invoice|shipment|due|today|tomorrow|check|send|also)\b/gi;

/** Sprache eines Textes grob erkennen: de, en oder null (zu kurz/unklar). */
export function spracheErkennen(text: string): Sprache | null {
  const t = text.replace(/https?:\/\/\S+|<@!?\d+>|\bB0[A-Z0-9]{8}\b/g, " ");
  const de = (t.match(DE_WORT) ?? []).length;
  const en = (t.match(EN_WORT) ?? []).length;
  if (de === 0 && en === 0) return null;
  if (en > de) return "en";
  if (de > en) return "de";
  return null;
}

// ---- KI-Auftrag ---------------------------------------------------------------------------------------

export function uebersetzungsAuftrag(text: string, nach: Sprache, glossar: Record<string, string>): string {
  const ziel = nach === "en" ? "Englisch" : "Deutsch";
  const g = Object.entries(glossar);
  return [
    `Übersetze den Text ins ${ziel} für die Zusammenarbeit zwischen einem Amazon-Händler (Deutsch) und seiner virtuellen Assistenz (Englisch).`,
    "Regeln:",
    "- Platzhalter wie ⟦0⟧, ⟦1⟧ unverändert und vollständig übernehmen (dahinter stehen ASINs, SKUs, Bestell-/Fallnummern, Beträge, Links).",
    "- Ton und Formatierung (Zeilen, Aufzählungen, Emojis, **fett**) beibehalten; nichts hinzufügen oder weglassen.",
    g.length ? `- Fachbegriffe immer so übersetzen (Deutsch → Englisch${nach === "de" ? ", hier umgekehrt" : ""}): ${g.map(([de, en]) => `${de} → ${en}`).join("; ")}.` : "",
    "- Antworte nur mit der Übersetzung, ohne Erklärung.",
    "",
    "Text:",
    text.slice(0, 6000),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Glossar ohne KI anwenden (Notlösung, wenn kein Schlüssel hinterlegt ist): nur ganze Wörter, Groß/klein egal. */
export function glossarErsetzen(text: string, glossar: Record<string, string>, nach: Sprache): string {
  let out = text;
  for (const [de, en] of Object.entries(glossar)) {
    const [von, zu] = nach === "en" ? [de, en.split(" / ")[0]] : [en.split(" / ")[0], de];
    out = out.replace(new RegExp(`\\b${von.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), zu);
  }
  return out;
}

/**
 * Notizen für eine nicht-deutschsprachige VA: Der Block „Text DE:“ (vorbereiteter Amazon-Text auf Deutsch) entfällt –
 * die VA reicht die englische Fassung ein („Text EN:“), die Amazon auf allen EU-Marktplätzen annimmt.
 */
export function notizFuerSprache(notiz: string, s: Sprache): string {
  if (s === "de") return notiz;
  return notiz.replace(/(^|\n)Text DE:\n[\s\S]*?(?=\n\nText EN:|$)/, "$1").replace(/^\n+/, "");
}

// ---- Feste Bot-Texte je Sprache --------------------------------------------------------------------------

const MONATE_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Datum für die VA: „02.11.2026“ (de) bzw. „Nov 2“ (en, im laufenden Jahr) / „Nov 2, 2027“. */
export function datum(iso: string, s: Sprache, jahrJetzt = new Date().getFullYear()): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (s === "de") return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${y}`;
  return `${MONATE_EN[m - 1]} ${d}${y !== jahrJetzt ? `, ${y}` : ""}`;
}

export const BOT = {
  de: {
    neueAufgabe: "Neue Aufgabe",
    faellig: "Fällig",
    ohneFrist: "ohne Frist",
    prioritaet: "Priorität",
    prio: { critical: "🔴 wichtig", normal: "normal", low: "niedrig" } as Record<string, string>,
    anleitung: "Anleitung",
    zugaenge: "Zugänge",
    fehler: "Typische Fehler",
    anhaenge: "Anhänge",
    fertig: "Wenn fertig: ✅ auf diese Nachricht oder „erledigt“ schreiben. Frage? ❓ oder einfach hier fragen.",
    erneut: "🔁 Erneut zugewiesen:",
    erledigtDanke: (notiz: boolean) => `👍 Danke – als erledigt abgehakt${notiz ? " (deine Nachricht steht als Notiz an der Aufgabe)" : ""}.`,
    rueckfrageBeiLudwig: "📌 Rückfrage ist bei Ludwig – die Antwort kommt hier.",
    angekommen: "📌 Ist bei Ludwig angekommen – die Antwort kommt hier in diesen Thread.",
    imSystemErledigt: "✅ Im Seller-System erledigt – danke!",
    andereZustaendig: "ℹ️ Diese Aufgabe liegt jetzt bei jemand anderem.",
    erinnerungHeute: (titel: string) => `⏰ Erinnerung: „${titel}“ ist heute fällig.`,
    erinnerungUeber: (titel: string, f: string) => `⏰ Überfällig seit ${f}: „${titel}“ – bitte erledigen oder kurz melden, was fehlt.`,
    autoUebersetzt: "",
    rechnungen: (wofuer: string, n: number) => `🧾 Rechnungen für ${wofuer}: ${n}`,
    nr: "Nr.",
    angehaengt: (n: number) => `(${n} Datei${n === 1 ? "" : "en"} angehängt)`,
    ohneDatei: "ohne Datei im System",
    treffer: { rechnung: "Rechnungen", sendung: "Sendungen", anspruch: "Ansprüche", auftrag: "Aufträge", produkt: "Produkte", anleitung: "Anleitungen" } as Record<string, string>,
    zu: "zu",
  },
  en: {
    neueAufgabe: "New task",
    faellig: "Due",
    ohneFrist: "no due date",
    prioritaet: "Priority",
    prio: { critical: "🔴 important", normal: "normal", low: "low" } as Record<string, string>,
    anleitung: "Instructions",
    zugaenge: "Access",
    fehler: "Common mistakes",
    anhaenge: "Attachments",
    fertig: "When done: react ✅ to this message or write “done”. Question? ❓ or just ask here.",
    erneut: "🔁 Reassigned:",
    erledigtDanke: (notiz: boolean) => `👍 Thanks – marked as done${notiz ? " (your message is saved as a note on the task)" : ""}.`,
    rueckfrageBeiLudwig: "📌 Your question is with Ludwig – the answer will come here.",
    angekommen: "📌 Ludwig has received this – the answer will come here in this thread.",
    imSystemErledigt: "✅ Done in the Seller-System – thank you!",
    andereZustaendig: "ℹ️ This task is now with someone else.",
    erinnerungHeute: (titel: string) => `⏰ Reminder: “${titel}” is due today.`,
    erinnerungUeber: (titel: string, f: string) => `⏰ Overdue since ${f}: “${titel}” – please finish it or let us know what is missing.`,
    autoUebersetzt: " _(auto-translated)_",
    rechnungen: (wofuer: string, n: number) => `🧾 Invoices for ${wofuer}: ${n}`,
    nr: "No.",
    angehaengt: (n: number) => `(${n} file${n === 1 ? "" : "s"} attached)`,
    ohneDatei: "no file in the system",
    treffer: { rechnung: "Invoices", sendung: "Shipments", anspruch: "Reimbursement claims", auftrag: "Orders", produkt: "Products", anleitung: "Instructions" } as Record<string, string>,
    zu: "for",
  },
} as const;
