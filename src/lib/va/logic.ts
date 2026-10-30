// VA über Discord – reine Logik: Thread-Texte (≤ 2000 Zeichen je Nachricht), Antworten im Thread erkennen
// (✅/„erledigt“, ❓/Frage), neue Nachrichten im Kanal einordnen (KI-Auftrag + Regeln als Rückfall),
// Fälligkeit aus dem Text, Ruhezeiten/Zeitzone, Erinnerungen und die Feierabend-Zeile.

export const DISCORD_MAX = 2000;

/** Text in Discord-taugliche Stücke teilen (an Zeilenenden, notfalls hart). */
export function teilen(text: string, max = 1900): string[] {
  const out: string[] = [];
  let cur = "";
  for (const zeile of text.split("\n")) {
    let z = zeile;
    while (z.length > max) {
      if (cur) out.push(cur);
      cur = "";
      out.push(z.slice(0, max));
      z = z.slice(max);
    }
    if ((cur ? cur.length + 1 : 0) + z.length > max) {
      out.push(cur);
      cur = z;
    } else cur = cur ? `${cur}\n${z}` : z;
  }
  if (cur.trim()) out.push(cur);
  return out.length ? out : [""];
}

/** Thread-Namen: Discord erlaubt höchstens 100 Zeichen. */
export const threadName = (titel: string) => (titel.replace(/\s+/g, " ").trim() || "Aufgabe").slice(0, 95);

/** Beträge entfernen, wenn die VA den Bereich der Aufgabe nicht sehen darf („Inhalt ohne sensible Felder“). */
export const ohneBetraege = (text: string) => text.replace(/-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,2})?\s?(?:€|EUR)|(?:€|EUR)\s?-?\d[\d.,]*/gi, "[Betrag]");

const PRIO: Record<string, string> = { critical: "🔴 wichtig", normal: "normal", low: "niedrig" };
const datumDe = (iso: string) => iso.split("-").reverse().join(".");

export type AnleitungKurz = { titel: string; zweck?: string; schritte: string[]; zugaenge?: string[]; fehler?: string[] };

export function aufgabenText(a: { titel: string; faellig: string | null; prioritaet: string; notiz: string | null; zusatz: string | null; link: string | null; anleitungen: AnleitungKurz[]; anhaenge: string[]; vaId?: string | null }): string {
  const zeilen = [
    `${a.vaId ? `<@${a.vaId}> ` : ""}📋 **Neue Aufgabe: ${a.titel}**`,
    `Fällig: ${a.faellig ? datumDe(a.faellig) : "ohne Frist"} · Priorität: ${PRIO[a.prioritaet] ?? a.prioritaet}`,
  ];
  if (a.zusatz?.trim()) zeilen.push("", `📝 ${a.zusatz.trim()}`);
  if (a.notiz?.trim()) zeilen.push("", a.notiz.trim().slice(0, 1500));
  if (a.link) zeilen.push("", `🔗 ${a.link}`);
  for (const an of a.anleitungen) {
    zeilen.push("", `📖 **Anleitung: ${an.titel}**`);
    if (an.zweck) zeilen.push(an.zweck);
    an.schritte.forEach((s, i) => zeilen.push(`${i + 1}. ${s}`));
    if (an.zugaenge?.length) zeilen.push(`Zugänge: ${an.zugaenge.join(", ")}`);
    if (an.fehler?.length) zeilen.push(`Typische Fehler: ${an.fehler.join("; ")}`);
  }
  if (a.anhaenge.length) zeilen.push("", `📎 Anhänge: ${a.anhaenge.join(", ")}`);
  zeilen.push("", "Wenn fertig: ✅ auf diese Nachricht oder „erledigt“ schreiben. Frage? ❓ oder einfach hier fragen.");
  return zeilen.join("\n");
}

const NEIN = /\b(nicht|noch nicht|kein|keine|nie)\s+(\w+\s+){0,2}(erledigt|fertig|gemacht|done)\b/i;
const ERLEDIGT = /(✅|☑️|✔️|\b(erledigt|fertig|done|ist raus|hab ich gemacht|habe ich gemacht|abgeschlossen)\b)/i;

/** Antwort der VA im Aufgaben-Thread: erledigt, Rückfrage oder Notiz. */
export function threadAntwortArt(text: string): "erledigt" | "rueckfrage" | "notiz" {
  const t = text.trim();
  if (/❓|\?\s*$|\?\s/.test(t) || /^(wie|was|wo|wann|warum|wieso|welche[rsn]?|soll|sollen|kann|darf|muss|brauche|gibt es)\b/i.test(t)) return "rueckfrage";
  if (ERLEDIGT.test(t) && !NEIN.test(t)) return "erledigt";
  return "notiz";
}

/** Reaktionen an der Aufgaben-Nachricht (ohne die des Bots). */
export function reaktionsArt(reaktionen: { emoji: { name: string | null }; count: number; me?: boolean }[] | undefined): { erledigt: boolean; frage: boolean } {
  const fremd = (namen: string[]) => (reaktionen ?? []).some((r) => r.emoji.name && namen.includes(r.emoji.name) && r.count - (r.me ? 1 : 0) > 0);
  return { erledigt: fremd(["✅", "☑️", "✔️"]), frage: fremd(["❓", "❔"]) };
}

// ---- Einordnung neuer VA-Nachrichten im Kanal ------------------------------------------------------

export type AnfrageTyp = "rechnung" | "sendung" | "anspruch" | "auftrag" | "produkt" | "anleitung";
export type Einordnung = {
  art: "bitte" | "frage" | "info" | "erledigt" | "smalltalk";
  titel: string;
  faellig: string | null;
  anfrage: { typ: AnfrageTyp; asin: string | null; sku: string | null; marke: string | null; lieferant: string | null; sendung: string | null; auftrag: string | null; suchtext: string | null } | null;
  /** Nummer der passenden offenen Aufgabe (1-basiert aus der Liste im Auftrag) bei Info/Erledigt. */
  aufgabe: number | null;
};

export function kiEinordnenAuftrag(text: string, offeneAufgaben: string[], heute: string): string {
  return [
    "Ordne die Nachricht der Assistenz (VA) aus dem Discord-Kanal ein. Antworte nur mit JSON:",
    '{"art":"bitte|frage|info|erledigt|smalltalk","titel":"kurzer Aufgabentitel (max. 80 Zeichen)","faellig":"YYYY-MM-DD oder null","anfrage":null oder {"typ":"rechnung|sendung|anspruch|auftrag|produkt|anleitung","asin":null,"sku":null,"marke":null,"lieferant":null,"sendung":null,"auftrag":null,"suchtext":null},"aufgabe":null oder Nummer}',
    "Regeln:",
    "- bitte = die VA bittet um etwas oder braucht etwas; frage = sie fragt nach einer Entscheidung oder Auskunft; info = reine Mitteilung; erledigt = sie meldet etwas als erledigt; smalltalk = Gruß, Dank, Emoji ohne Inhalt.",
    "- anfrage nur, wenn sie Daten aus dem System haben will: Rechnung(en) zu ASIN/SKU/Marke/Lieferant, Sendung/Shipment-ID und Fehlmengen, Ansprüche (Claims), Aufträge/Bestellungen, Produktdaten (EAN, FNSKU, EK, Bestand) oder eine Anleitung. Entscheidungsfragen („Soll ich …?“) haben keine anfrage.",
    "- asin = 10 Zeichen ab B0; sendung = FBA-Shipment-ID (FBA…); auftrag = Bestellnummer; suchtext = sonstiger Suchbegriff (Produktname).",
    `- faellig nur, wenn im Text ein Termin steht („bis morgen“, „bis Freitag“, Datum); heute ist ${heute}.`,
    "- aufgabe: bei info/erledigt die Nummer der passenden offenen Aufgabe, sonst null.",
    "",
    "Offene Aufgaben der VA:",
    offeneAufgaben.length ? offeneAufgaben.map((t, i) => `${i + 1}. ${t}`).join("\n") : "(keine)",
    "",
    "Nachricht:",
    text.slice(0, 3000),
  ].join("\n");
}

const ARTEN = new Set(["bitte", "frage", "info", "erledigt", "smalltalk"]);
const TYPEN = new Set(["rechnung", "sendung", "anspruch", "auftrag", "produkt", "anleitung"]);
const str = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export function leseEinordnung(raw: string, text: string, heute: string): Einordnung | null {
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const art = String(j.art ?? "");
  if (!ARTEN.has(art)) return null;
  const a = j.anfrage as Record<string, unknown> | null | undefined;
  const typ = a && TYPEN.has(String(a.typ)) ? (String(a.typ) as AnfrageTyp) : null;
  const faellig = typeof j.faellig === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.faellig) && j.faellig >= heute ? j.faellig : null;
  const asin = str(a?.asin, 10)?.toUpperCase() ?? null;
  return {
    art: art as Einordnung["art"],
    titel: str(j.titel, 80) ?? titelAus(text),
    faellig,
    anfrage: typ && a ? { typ, asin: asin && /^B0[A-Z0-9]{8}$/.test(asin) ? asin : null, sku: str(a.sku, 60), marke: str(a.marke, 60), lieferant: str(a.lieferant, 80), sendung: str(a.sendung, 30), auftrag: str(a.auftrag, 40), suchtext: str(a.suchtext, 80) } : null,
    aufgabe: typeof j.aufgabe === "number" && j.aufgabe >= 1 ? Math.floor(j.aufgabe) : null,
  };
}

export const titelAus = (text: string) => {
  const z = text.replace(/<@!?\d+>/g, "").replace(/\s+/g, " ").trim();
  return z.length > 80 ? `${z.slice(0, 77)}…` : z || "Nachricht der VA";
};

/** Regeln, wenn keine KI angebunden ist (oder sie nicht antwortet). */
export function regelEinordnung(text: string, heute: string, offeneAufgaben: string[]): Einordnung {
  const t = text.replace(/<@!?\d+>/g, "").trim();
  const asin = /\b(B0[A-Z0-9]{8})\b/i.exec(t)?.[1]?.toUpperCase() ?? null;
  const sendung = /\b(FBA[0-9A-Z]{6,12})\b/i.exec(t)?.[1]?.toUpperCase() ?? null;
  const auftrag = /\b(\d{3}-\d{7}-\d{7}|\d{2}-\d{5}-\d{5})\b/.exec(t)?.[1] ?? null;
  const vorAsin = asin ? /([A-ZÄÖÜ][\wÄÖÜäöüß&.-]{1,30})\s+B0[A-Z0-9]{8}/.exec(t)?.[1] ?? null : null;
  const marke = vorAsin && !/^(Rechnung|Rechnungen|Für|ASIN|Artikel|Produkt)$/i.test(vorAsin) ? vorAsin : null;
  const basis = { asin, sku: /\bSKU[:\s]+([\w.-]{3,40})/i.exec(t)?.[1] ?? null, marke, lieferant: /\b(?:lieferant(?:en)?|von)\s+([A-ZÄÖÜ][\w&.-]+(?:\s+(?:GmbH|AG|KG|SE|Ltd))?)/.exec(t)?.[1] ?? null, sendung, auftrag, suchtext: null as string | null };
  let anfrage: Einordnung["anfrage"] = null;
  if (/rechnung|invoice|beleg/i.test(t)) anfrage = { typ: "rechnung", ...basis };
  else if (sendung || /\b(sendung|shipment|fehlmenge)/i.test(t)) anfrage = { typ: "sendung", ...basis };
  else if (/\b(anspruch|ansprüche|claim|erstattung)/i.test(t) && !/^soll/i.test(t)) anfrage = { typ: "anspruch", ...basis };
  else if (auftrag || /\b(auftrag|bestellung|order)\b/i.test(t)) anfrage = { typ: "auftrag", ...basis };
  else if (/\b(ean|fnsku|ek|einkaufspreis|bestand|lagerbestand)\b/i.test(t) && (asin || basis.sku)) anfrage = { typ: "produkt", ...basis };
  else if (/\banleitung|\bwie (geht|mache|funktioniert)/i.test(t)) anfrage = { typ: "anleitung", ...basis, suchtext: t.replace(/^.*?(anleitung( für| zu)?|wie (geht|mache ich|funktioniert))\s*/i, "").replace(/[?!.]+$/, "").slice(0, 80) || null };
  const entscheidung = /^(soll|sollen|darf|dürfen|kann ich|können wir|muss ich)\b/i.test(t);
  if (entscheidung) anfrage = null;
  const frage = /\?|❓/.test(t) || entscheidung;
  const kurz = t.replace(/[^\p{L}\p{N}]/gu, "").length;
  let art: Einordnung["art"];
  if (!anfrage && (kurz < 3 || /^(danke|dankeschön|vielen dank|hallo|hi|hey|guten (morgen|abend|tag)|gute nacht|ok|okay|alles klar|super|top|perfekt|👍|🙏)[\s!.😊🙂👍🙏]*$/i.test(t))) art = "smalltalk";
  else if (anfrage) art = "bitte";
  else if (frage) art = "frage";
  else if (/\b(brauche|bitte|kannst du|könntest du)\b/i.test(t)) art = "bitte";
  else if (ERLEDIGT.test(t) && !NEIN.test(t)) art = "erledigt";
  else art = "info";
  return { art, titel: titelAus(t), faellig: faelligAus(t, heute), anfrage, aufgabe: art === "info" || art === "erledigt" ? passendeAufgabe(t, offeneAufgaben) : null };
}

/** Passende Aufgabe über gemeinsame Wörter (≥ 2 bzw. ein langes Wort). */
export function passendeAufgabe(text: string, titel: string[]): number | null {
  const woerter = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4));
  const w = woerter(text);
  let best: { i: number; n: number } | null = null;
  titel.forEach((t, i) => {
    const gemeinsam = [...woerter(t)].filter((x) => w.has(x));
    const n = gemeinsam.length + (gemeinsam.some((x) => x.length >= 8) ? 1 : 0);
    if (n >= 2 && (!best || n > best.n)) best = { i, n };
  });
  return best ? (best as { i: number }).i + 1 : null;
}

const WOCHENTAGE = ["sonntag", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag"];
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Nächster Werktag (Mo–Fr). */
export function naechsterWerktag(heute: string): string {
  let d = plus(heute, 1);
  while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = plus(d, 1);
  return d;
}

/** Termin aus dem Text („heute“, „morgen“, „bis Freitag“, „05.11.“); null = keiner genannt. */
export function faelligAus(text: string, heute: string): string | null {
  const t = text.toLowerCase();
  if (/\b(heute|asap|sofort|dringend)\b/.test(t)) return heute;
  if (/\bübermorgen\b/.test(t)) return plus(heute, 2);
  if (/\bmorgen\b/.test(t)) return plus(heute, 1);
  const d = /\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/.exec(t);
  if (d) {
    const jahr = d[3] ? (d[3].length === 2 ? `20${d[3]}` : d[3]) : heute.slice(0, 4);
    const iso = `${jahr}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}`;
    if (!Number.isNaN(Date.parse(iso))) return iso < heute && !d[3] ? `${Number(jahr) + 1}${iso.slice(4)}` : iso;
  }
  const wt = WOCHENTAGE.findIndex((w) => new RegExp(`\\b(bis |am |nächsten |kommenden )?${w}\\b`).test(t));
  if (wt >= 0) {
    const heuteWt = new Date(`${heute}T12:00:00Z`).getUTCDay();
    return plus(heute, ((wt - heuteWt + 7) % 7) || 7);
  }
  return null;
}

// ---- Zeitzone, Ruhezeiten, Erinnerungen -------------------------------------------------------------

/** Datum und Uhrzeit in der Zeitzone der VA. */
export function lokal(jetzt: Date, zeitzone: string): { datum: string; zeit: string } {
  let tz = zeitzone;
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: tz });
  } catch {
    tz = "Europe/Berlin";
  }
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(jetzt).map((x) => [x.type, x.value]));
  return { datum: `${p.year}-${p.month}-${p.day}`, zeit: `${p.hour}:${p.minute}` };
}

/** Ruhezeit (z. B. 20:00–08:00, über Mitternacht): keine Erinnerungen, neue Nachrichten ohne Benachrichtigung. */
export function inRuhezeit(zeit: string, von: string, bis: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(von) || !/^\d{2}:\d{2}$/.test(bis) || von === bis) return false;
  return von < bis ? zeit >= von && zeit < bis : zeit >= von || zeit < bis;
}

/** Erinnerung fällig? Am Fälligkeitstag einmal (nach der Ruhezeit), überfällig täglich (Einstellung). */
export function erinnerungFaellig(o: { faellig: string | null; heute: string; letzte: string | null; ruhe: boolean; ueberfaelligTaeglich: boolean }): "heute" | "ueberfaellig" | null {
  if (!o.faellig || o.ruhe || o.letzte === o.heute) return null;
  if (o.faellig === o.heute) return "heute";
  if (o.faellig < o.heute && o.ueberfaelligTaeglich) return "ueberfaellig";
  return null;
}

export function erinnerungText(art: "heute" | "ueberfaellig", titel: string, faellig: string, vaId: string | null): string {
  const an = vaId ? `<@${vaId}> ` : "";
  return art === "heute" ? `${an}⏰ Heute fällig: **${titel}**` : `${an}⏰ Überfällig seit ${datumDe(faellig)}: **${titel}** – bitte erledigen oder hier kurz schreiben, was fehlt.`;
}

/** Feierabend-Zeile für Ludwig. */
export function vaHeuteText(z: { erledigt: number; rueckfragen: number; auto: number; offen?: number }): string {
  return `VA heute: ${z.erledigt} erledigt, ${z.rueckfragen} ${z.rueckfragen === 1 ? "Rückfrage" : "Rückfragen"}, ${z.auto} automatisch beantwortet${z.offen ? ` · ${z.offen} unbeantwortet` : ""}`;
}

// ---- Antworten aus Werkzeug-Ergebnissen -------------------------------------------------------------

const WEG = new Set(["link", "links", "datenstand", "hinweis", "quelle", "zeitraum", "id"]);
const istUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v);

function wert(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return String(Math.round(v * 100) / 100).replace(".", ",");
  if (typeof v === "boolean") return v ? "ja" : "nein";
  if (typeof v === "string") return istUuid(v) || /^https?:\/\//.test(v) ? null : v.slice(0, 120);
  if (Array.isArray(v)) return v.length && v.every((x) => typeof x !== "object") ? v.slice(0, 6).join(", ") : null;
  if (typeof v === "object")
    return (
      Object.entries(v as Record<string, unknown>)
        .filter(([k]) => !WEG.has(k))
        .map(([k, x]) => (wert(x) !== null && typeof x !== "object" ? `${k} ${wert(x)}` : null))
        .filter(Boolean)
        .join(", ") || null
    );
  return null;
}

/** Größte Liste im Ergebnis (sendungen, produkte, treffer …). */
export function hauptliste(obj: unknown): Record<string, unknown>[] | null {
  if (!obj || typeof obj !== "object") return null;
  let best: Record<string, unknown>[] | null = null;
  for (const v of Object.values(obj as Record<string, unknown>)) {
    if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === "object" && !Array.isArray(x)) && (!best || v.length > best.length)) best = v as Record<string, unknown>[];
  }
  if (best) return best;
  for (const v of Object.values(obj as Record<string, unknown>)) if (Array.isArray(v) && v.length === 0) return [];
  return null;
}

/** Eine Zeile je Treffer, ohne Links/IDs. */
export function trefferZeile(o: Record<string, unknown>): string {
  return (
    "• " +
    Object.entries(o)
      .filter(([k]) => !WEG.has(k))
      .map(([k, v]) => {
        const w = wert(v);
        return w === null ? null : `${k.replace(/_/g, " ")}: ${w}`;
      })
      .filter(Boolean)
      .join(" · ")
      .slice(0, 400)
  );
}

/** Eindeutig genug für eine automatische Antwort? 1–5 Treffer; bei Suche nach einer genauen Kennung höchstens 3. */
export function eindeutig(anzahl: number, genau: boolean): "keins" | "ok" | "mehrdeutig" {
  if (anzahl === 0) return "keins";
  return anzahl <= (genau ? 3 : 5) ? "ok" : "mehrdeutig";
}

export type RechnungKurz = { datum: string | null; lieferant: string | null; nummer: string | null; datei: string | null };

export function rechnungenText(wofuer: string, r: RechnungKurz[], mitDateien: number): string {
  const z = [`🧾 Rechnungen für ${wofuer}: ${r.length}`];
  for (const x of r.slice(0, 8)) z.push(`• ${x.datum ? datumDe(x.datum) : "ohne Datum"} · ${x.lieferant ?? "Lieferant unbekannt"} · Nr. ${x.nummer ?? "–"}${x.datei ? ` · ${x.datei}` : ""}`);
  if (r.length > 8) z.push(`… und ${r.length - 8} weitere`);
  if (mitDateien) z.push(`📎 ${mitDateien === 1 ? "Datei hängt an" : `${mitDateien} Dateien hängen an`}.`);
  return z.join("\n");
}

export const ANFRAGE_TEXT: Record<AnfrageTyp, string> = {
  rechnung: "Rechnungen",
  sendung: "Sendung",
  anspruch: "Ansprüche",
  auftrag: "Aufträge",
  produkt: "Produktdaten",
  anleitung: "Anleitung",
};
