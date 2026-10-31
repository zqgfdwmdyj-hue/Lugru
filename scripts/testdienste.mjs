// Testdienste für die Testumgebung und die automatischen Prüfungen: ein kleiner Server, der Claude, Deutsche Post
// (Internetmarke), DHL (Labels + Sendungsverfolgung), Amazon, eBay, Temu, Keepa und die EZB-Kurse nachbildet.
// Nichts geht an echte Dienste. Schreibende Aufrufe (Label kaufen, Versand melden, Preis ändern …) werden nur
// angenommen und mitgeschrieben („simuliert“). Erfundene Antworten.
//
// Start:  node scripts/testdienste.mjs           (Port TESTDIENSTE_PORT, Standard 4010)
// Im Seller-System (TESTUMGEBUNG=1) zeigen die *_BASE_URL-Variablen hierher, z. B.
//   ANTHROPIC_BASE_URL=http://testdienste:4010/anthropic   INTERNETMARKE_BASE_URL=http://testdienste:4010/im
// Übersicht:  GET /__log (alle Aufrufe), GET /__ki (Anfragen an die Test-KI), POST /__reset
import http from "node:http";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { PDFDocument, StandardFonts } from "pdf-lib";

const PORT = Number(process.env.TESTDIENSTE_PORT || 4010);
const SELF = (process.env.TESTDIENSTE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, "");
let log = [];
let ki = [];
const remember = (list, entry, max = 500) => {
  list.push(entry);
  if (list.length > max) list.splice(0, list.length - max);
};

const pdf = async (lines) => {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (const l of lines) {
    const p = d.addPage([283, 562]);
    p.drawText("TESTLABEL – KEIN PORTO", { x: 20, y: 530, size: 12, font: f });
    p.drawText(l.slice(0, 60), { x: 20, y: 500, size: 10, font: f });
  }
  return Buffer.from(await d.save());
};

// ---------------------------------------------------------------------------------------------------------
// Test-KI (Claude-Messages-API). Befehle im Text der letzten Frage:
//   „werkzeug:NAME {json}“ → ruft genau dieses Werkzeug auf (auch wenn es NICHT angeboten wurde)
//   „prep“ → prep_center (3 Monate) · „palette“ → sendungen · „aufgabe X“ → aufgabe_anlegen · „auftr“ → auftraege
// Denk-Schritte sind an Grundtext + Werkzeugliste gebunden („sig:<hash>“). Passt eine Signatur im Verlauf nicht mehr,
// antwortet die Test-KI wie die echte API mit 400 – außer die Anfrage verlangt block_binding „drop_block“.
let n = 0;
const prefixHash = (b) => createHash("sha256").update(JSON.stringify(b.system ?? "") + JSON.stringify((b.tools ?? []).map((t) => t.name))).digest("hex").slice(0, 16);
const reply = (b, content, stop) => ({ id: `msg_test_${++n}`, type: "message", role: "assistant", model: b.model, content: [{ type: "thinking", thinking: "", signature: `sig:${prefixHash(b)}` }, ...content], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 120, output_tokens: 30 } });
const use = (name, input) => ({ type: "tool_use", id: `toolu_test_${++n}`, name, input });

function kiAnswer(req, b) {
  const msgs = b.messages ?? [];
  const want = `sig:${prefixHash(b)}`;
  const stale = msgs.filter((m) => m.role === "assistant" && Array.isArray(m.content)).flatMap((m) => m.content.filter((p) => p.type === "thinking")).filter((p) => p.signature !== want).length;
  const drop = b.thinking?.block_binding?.prefix_mismatch_behavior === "drop_block";
  const last = msgs[msgs.length - 1] ?? { content: "" };
  const parts = typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content;
  const text = parts.filter((p) => p.type === "text" && !String(p.text).startsWith("<kontext>")).map((p) => p.text).join(" ");
  const results = parts.filter((p) => p.type === "tool_result");
  const resultText = results.map((r) => (typeof r.content === "string" ? r.content : (r.content ?? []).map((x) => x.text).join(""))).join("\n");
  remember(ki, { at: new Date().toISOString(), beta: req.headers["anthropic-beta"] ?? null, thinking: b.thinking ?? null, tools: (b.tools ?? []).map((t) => t.name), prefix: prefixHash(b), staleThinking: stale, dropBlock: drop, text, toolResult: resultText || null, toolError: results.some((r) => r.is_error) });
  // Retouren-Station: Etikett, Lieferschein, Produktabgleich, Code, Falltext – feste erfundene JSON-Antworten.
  // B2B: Spalten einer Preisliste zuordnen (erfundene, aber nachvollziehbare Regeln wie eine KI)
  if (/Ordne die Spalten einer Großhändler-Preisliste zu/.test(text) && !stale) {
    let kopf = [];
    try {
      kopf = JSON.parse(/Spalten: (\[.*\])/.exec(text)?.[1] ?? "[]");
    } catch {}
    const finde = (re) => kopf.find((h) => re.test(h)) ?? null;
    const m = { ean: finde(/barcode|ean|gtin/i), asin: finde(/amazon|asin/i), supplierSku: finde(/code|art|sku/i), title: finde(/produkt|bezeichnung|name/i), price: finde(/netto|preis|ek/i), stock: finde(/lager|bestand/i), moq: finde(/vpe|mindest|moq/i), url: null };
    return [200, reply(b, [{ type: "text", text: JSON.stringify(m) }], "end_turn")];
  }
  // Deal-Eingang: Angebote aus der Nachricht – je Zeile mit Preis ein Angebot (wie eine KI, erfundene Regeln):
  // ASIN/EAN übernehmen, Preis vor „netto/brutto/€“, „ab N“ = Mindestmenge, „6x/6er“ = Packung; Absender aus „Name:“.
  if (/Erkenne die Angebote in dieser Nachricht/.test(text) && !stale) {
    // „Screenshot lesen“: erfundene Testbilder tragen den sichtbaren Text hinter der Marke TESTOCR.
    const bildText = parts
      .filter((p) => p.type === "image" && p.source?.data)
      .map((p) => /TESTOCR\n([\s\S]*)$/.exec(Buffer.from(p.source.data, "base64").toString("latin1"))?.[1] ?? "")
      .join("\n");
    const nachricht = [/Nachricht:\n([\s\S]*)$/.exec(text)?.[1] ?? "", bildText].filter(Boolean).join("\n");
    const angebote = [];
    let quelle = null;
    for (const roh of nachricht.split("\n")) {
      const q = /^\s*(?:\[[^\]]+\]\s*)?([A-ZÄÖÜ][\wäöüß]{1,20}):\s/.exec(roh);
      if (q) quelle ??= q[1];
      const z = roh.replace(/^\s*(?:\[[^\]]+\]\s*)?[^:]{1,25}:\s*/, "");
      const preis = /(\d{1,5}[.,]\d{2})\s*(?:€|eur)?\s*(netto|brutto)?/i.exec(z.replace(/\b\d{8,14}\b/g, ""));
      if (!preis) continue;
      const asin = /\b(B0[A-Z0-9]{8})\b/.exec(z)?.[1] ?? null;
      const ean = /\b(\d{13})\b/.exec(z)?.[1] ?? null;
      const name = z.slice(0, z.indexOf(preis[1])).replace(/\b(B0[A-Z0-9]{8}|\d{13})\b/g, "").trim() || null;
      angebote.push({ asin, ean, name, marke: name ? name.split(" ")[0] : null, ek: Number(preis[1].replace(",", ".")), ek_netto: preis[2] ? preis[2].toLowerCase() === "netto" : null, waehrung: "EUR", menge: null, moq: Number(/ab\s*(\d+)/i.exec(z)?.[1] ?? 0) || null, packung: Number(/(\d+)\s*(?:x|er)\b/i.exec(name ?? "")?.[1] ?? 0) || null });
    }
    return [200, reply(b, [{ type: "text", text: JSON.stringify({ quelle, angebote }) }], "end_turn")];
  }
  // Briefe von Schule/Kita (Modul 8): erfundene Testbilder tragen den Text hinter „TESTOCR“; je Zeile mit Datum ein
  // Vorschlag – „bis“/„mitbringen“/„Unterschrift“ = Aufgabe, sonst Termin; „Kind A“ wird erkannt.
  if (/^Lies den Brief der Schule bzw\. Kita/m.test(text) && !stale) {
    const roh = parts
      .filter((p) => (p.type === "image" || p.type === "document") && p.source?.data)
      .map((p) => /TESTOCR\n([\s\S]*)$/.exec(Buffer.from(p.source.data, "base64").toString("latin1"))?.[1] ?? "")
      .join("\n");
    const vorschlaege = [];
    for (const z of Buffer.from(roh, "latin1").toString("utf8").split("\n")) {
      const d = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(z);
      if (!d) continue;
      const tag = `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}`;
      const uhr = /(\d{1,2}):(\d{2})/.exec(z.slice(d.index + d[0].length));
      const aufgabe = /\bbis\b|mitbringen|unterschr/i.test(z);
      const titel = z.replace(d[0], "").replace(/\b(am|bis|um)\b/gi, "").replace(/\d{1,2}:\d{2}( Uhr)?/, "").replace(/Kind A:?/, "").replace(/\s+/g, " ").replace(/[,:\s]+$/, "").trim();
      vorschlaege.push({ art: aufgabe ? "aufgabe" : "termin", titel, tag, uhrzeit: uhr ? `${uhr[1].padStart(2, "0")}:${uhr[2]}` : null, kind: /Kind A/.test(z) ? "Kind A" : null, notiz: /mitbringen/i.test(z) ? z.split(/,\s*/).find((x) => /mitbringen/i.test(x)) ?? null : null });
    }
    return [200, reply(b, [{ type: "text", text: JSON.stringify({ vorschlaege }) }], "end_turn")];
  }
  // Übersetzen (VA Deutsch ↔ Englisch): feste erfundene Regeln wie eine KI; Platzhalter ⟦n⟧ bleiben erhalten.
  if (/^Übersetze den Text ins (Englisch|Deutsch)/.test(text) && !stale) {
    const nachEn = /^Übersetze den Text ins Englisch/.test(text);
    let t = (/\nText:\n([\s\S]*)$/.exec(text)?.[1] ?? "").trim();
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const regeln = nachEn
      ? [
          [/Anspruch für Sendung (⟦\d+⟧) einreichen, Frist (\d{1,2})\.(\d{1,2})\.?/g, (_m, s, d, mo) => `File reimbursement claim for shipment ${s}, due ${MON[Number(mo) - 1]} ${Number(d)}`],
          [/Ja, bitte eskalieren/g, "Yes, please escalate"],
          [/Erfundene Testaufgabe/g, "Fictional test task"],
          [/Erfundene Testanleitung/g, "Fictional test instructions"],
          [/Testanleitung/g, "Test instructions"],
          [/Bericht öffnen/g, "Open report"],
          [/Pakete zählen/g, "Count parcels"],
          [/Bitte heute/g, "Please today"],
          [/Rechnungen/g, "Invoices"],
          [/Rechnung/g, "invoice"],
          [/Sendung/g, "shipment"],
          [/Anspruch/g, "reimbursement claim"],
          [/prüfen/g, "check"],
          [/Testantwort/g, "test answer"],
        ]
      : [
          [/Can you send me the invoice for (⟦\d+⟧)\?/g, "Kannst du mir die Rechnung für $1 schicken?"],
          [/Also please check the case (⟦\d+⟧)\./g, "Bitte prüfe auch den Fall $1."],
          [/Should I escalate the case/gi, "Soll ich den Fall eskalieren"],
          [/\bdone\b/gi, "erledigt"],
          [/\binvoice\b/gi, "Rechnung"],
          [/\bshipment\b/gi, "Sendung"],
          [/\bplease\b/gi, "bitte"],
        ];
    const vorher = t;
    for (const [re, zu] of regeln) t = t.replace(re, zu);
    if (t === vorher) t = `${nachEn ? "[EN]" : "[DE]"} ${t}`;
    return [200, reply(b, [{ type: "text", text: t }], "end_turn")];
  }
  // VA über Discord: Nachricht der Assistenz einordnen (erfundene Regeln wie eine KI).
  if (/Ordne die Nachricht der Assistenz/.test(text) && !stale) {
    const n = (/Nachricht:\n([\s\S]*)$/.exec(text)?.[1] ?? "").trim();
    const asin = /\b(B0[A-Z0-9]{8})\b/.exec(n)?.[1] ?? null;
    const marke = asin ? /([A-ZÄÖÜ][\wäöüß]+)\s+B0[A-Z0-9]{8}/.exec(n)?.[1] ?? null : null;
    const sendung = /\b(FBA[0-9A-Z]{6,12})\b/.exec(n)?.[1] ?? null;
    let o;
    if (/rechnung|invoice/i.test(n)) o = { art: "bitte", titel: `Rechnung ${[marke, asin].filter(Boolean).join(" ")}`.trim(), faellig: null, anfrage: { typ: "rechnung", asin, sku: null, marke, lieferant: null, sendung: null, auftrag: null, suchtext: null }, aufgabe: null };
    else if (sendung) o = { art: "frage", titel: `Sendung ${sendung}`, faellig: null, anfrage: { typ: "sendung", asin: null, sku: null, marke: null, lieferant: null, sendung, auftrag: null, suchtext: null }, aufgabe: null };
    else if (/^(danke|hallo|guten morgen|ok)\b/i.test(n)) o = { art: "smalltalk", titel: "Gruß", faellig: null, anfrage: null, aufgabe: null };
    else if (/\?/.test(n)) o = { art: "frage", titel: n.replace(/\?.*$/, "").slice(0, 80), faellig: /morgen/i.test(n) ? null : null, anfrage: null, aufgabe: null };
    else o = { art: "info", titel: n.slice(0, 80), faellig: null, anfrage: null, aufgabe: /aufgabe 1|remission/i.test(n) ? 1 : null };
    return [200, reply(b, [{ type: "text", text: JSON.stringify(o) }], "end_turn")];
  }
  // Discord-Kanäle (B14): Zusammenfassung mit einer Erkenntnis, deren Titel die erste Nachricht enthält (eindeutig je Lauf).
  if (/^Fasse die Chat-Nachrichten aus dem Kanal „([^“]+)“/.test(text) && !stale) {
    const kanal = /^Fasse die Chat-Nachrichten aus dem Kanal „([^“]+)“/.exec(text)[1];
    const zeilen = text.split("\nNachrichten:\n")[1]?.split("\n").filter(Boolean) ?? [];
    const erste = (zeilen[0] ?? "").replace(/^Nutzer [A-Z]\d*: /, "").slice(0, 60);
    return [200, reply(b, [{ type: "text", text: JSON.stringify({ ueberblick: `Test-Zusammenfassung ${kanal}: ${zeilen.length} Nachrichten (erfunden).`, themen: [{ name: "Allgemein", punkte: [erste || "–"] }], tipps: ["Test-Tipp: Preise vor dem Einkauf prüfen"], warnungen: [], fragen: [], tools: [], erkenntnisse: [{ titel: `Chat-Tipp ${erste}`, text: `Erfundener Testinhalt aus ${kanal}: ${erste}`, art: "tipp" }] }) }], "end_turn")];
  }
  if (/^Fasse den Stand des Rechtsfalls/.test(text) && !stale) {
    const letzte = text.trim().split("\n").pop() ?? "";
    return [200, reply(b, [{ type: "text", text: `Stand (Test): ${letzte.replace(/^\d{4}-\d{2}-\d{2}: /, "").slice(0, 120)}` }], "end_turn")];
  }
  // Wissen aus Calls: zwei erfundene Einträge je Call (Titel mit dem Call-Titel, damit nichts doppelt aussieht).
  if (/Ziehe das Wissen heraus/.test(text) && !stale) {
    const call = /\nCall: (.*) am \d{4}-\d{2}-\d{2}\n/.exec(text)?.[1] ?? "Test-Call";
    const wissen = [
      { titel: `Testwissen (${call}): Black-Week-Deals nur mit Gewinn`, inhalt: "Erfundener Testinhalt: In der Black Week nur Deals fahren, die nach allen Gebühren noch Gewinn bringen.", kategorie: "Amazon-Richtlinien", stichworte: ["Black Week", "Test"], zitat: "Black-Week-Deals nur mit Gewinn", einschaetzung: "bestaetigt", art: "regel", wer: "ich" },
      { titel: `Testwissen (${call}): Markenliste vor dem Audit bereithalten`, inhalt: "Erfundener Testinhalt: Für den Marken-Audit vorab eine Liste der zehn wichtigsten Marken vorbereiten.", kategorie: "Tools & Abläufe", stichworte: ["Audit"], zitat: "Liste der zehn Marken", einschaetzung: "einzelmeinung", art: "tipp", wer: "Consultant (Test)" },
    ];
    return [200, reply(b, [{ type: "text", text: JSON.stringify({ wissen }) }], "end_turn")];
  }
  // Call-Archiv: Punkte aus dem Test-Transkript (wörtliche Zitate, damit die Call-Stelle gefunden wird).
  if (/Du liest das Transkript eines (Calls mit dem Amazon-Consultant|Wochen-Calls einer Deal-Gruppe)/.test(text) && !stale) {
    const punkte = [
      { art: "aufgabe", text: "Liste der zehn Audit-Marken an den Consultant schicken", verantwortlich: "ich", frist: "2026-10-23", zitat: "Schick mir bis Freitag die Liste der zehn Marken" },
      { art: "aufgabe", text: "Mindestrabatt für Bundles intern klären", verantwortlich: "consultant", frist: null, zitat: "Das kläre ich intern" },
      { art: "frage", text: "Gilt der Mindestrabatt auch für Bundles?", verantwortlich: null, frist: null, zitat: "Gilt der Mindestrabatt auch für Bundles?" },
      { art: "entscheidung", text: "Black-Week-Deals nur mit Gewinn", verantwortlich: null, frist: null, zitat: "Black-Week-Deals nur mit Gewinn" },
    ];
    return [200, reply(b, [{ type: "text", text: JSON.stringify({ ueberblick: "Test-Call: Markenliste für den Audit, Mindestrabatt bei Bundles, Black-Week-Deals.", teilnehmer: ["Consultant (Test)", "Ludwig (Test)"], themen: [{ name: "Audit", punkte: ["Liste der zehn Marken bis Freitag"] }], punkte }) }], "end_turn")];
  }
  const st = stationKi(text);
  if (st && !stale) return [200, reply(b, [{ type: "text", text: JSON.stringify(st) }], "end_turn")];
  if (stale && !drop) {
    const i = msgs.findIndex((m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((p) => p.type === "thinking" && p.signature !== want));
    return [400, { type: "error", error: { type: "invalid_request_error", message: `messages.${i}.content.0: Invalid \`signature\` in \`thinking\` block. The block is bound to a different conversation. Remove the block, or set block_binding.prefix_mismatch_behavior to "drop_block".` } }];
  }
  if (results.length) {
    const prev = msgs[msgs.length - 2];
    const name = prev?.content?.find?.((p) => p.type === "tool_use")?.name;
    const r = results[0];
    const content = typeof r.content === "string" ? r.content : (r.content ?? []).map((x) => x.text).join("");
    if (name === "prep_center" && !r.is_error) {
      const d = JSON.parse(content);
      const v = (d.verlauf ?? []).map((x) => `${x.monat}: ${x.sendungen} Sendungen, ${x.stueck} Stück${x.erwartete_kosten !== undefined ? `, ${x.erwartete_kosten} €` : ""}`).join("; ");
      return [200, reply(b, [{ type: "text", text: `${d.prep_center} im ${d.monat}: ${d.sendungen} Sendungen, ${d.stueck} Stück, erwartete Kosten ${d.erwartete_kosten ?? "–"} €. Verlauf: ${v}. So funktioniert es: ${d.so_funktioniert_es}` }], "end_turn")];
    }
    if (name === "sendungen" && !r.is_error) {
      const d = JSON.parse(content);
      return [200, reply(b, [{ type: "text", text: `Es sind **${d.anzahl} offene Sendungen** im Palettenlager.` }], "end_turn")];
    }
    return [200, reply(b, [{ type: "text", text: `Ergebnis von ${name}: ${r.is_error ? "FEHLER " : ""}${content.slice(0, 300)}` }], "end_turn")];
  }
  const cmd = /werkzeug:([a-z_]+)\s*(\{.*\})?/i.exec(text);
  if (cmd) return [200, reply(b, [{ type: "text", text: `Ich rufe ${cmd[1]} auf.` }, use(cmd[1], cmd[2] ? JSON.parse(cmd[2]) : {})], "tool_use")];
  if (/prep/i.test(text)) return [200, reply(b, [use("prep_center", { monate: 3 })], "tool_use")];
  if (/palette/i.test(text)) return [200, reply(b, [use("sendungen", { nur_offen: true })], "tool_use")];
  const auf = /aufgabe (.+)$/i.exec(text);
  if (auf) return [200, reply(b, [{ type: "text", text: "Ich lege das an:" }, use("aufgabe_anlegen", { titel: auf[1].trim(), faellig: "2026-11-02" })], "tool_use")];
  if (/auftr/i.test(text)) return [200, reply(b, [use("auftraege", {})], "tool_use")];
  return [200, reply(b, [{ type: "text", text: `Hallo aus der Test-KI (${stale ? `${stale} alter Denk-Schritt verworfen` : "kein alter Denk-Schritt"}).` }], "end_turn")];
}

/** Test-KI für die Retouren-Station (Remission „ZtestRem01“, Sendung TESTTRACK0001; Testtasse = „passt nicht“). */
function stationKi(text) {
  if (/Versandetikett eines Pakets/.test(text)) return { sendungsnummer: "TESTTRACK0001", versender: "DHL", remissions_id: null, absender: "Amazon Testlager (erfunden)", unsicher: false };
  if (/Lieferschein \(Packliste\)/.test(text))
    return { remissions_id: "ZtestRem01", positionen: [{ sku: "TEST-SOCKEN", fnsku: "X00TEST0001", titel: "Testsocken (erfunden)", menge: 2 }, { sku: "TEST-TASSE", fnsku: "X00TEST0002", titel: "Testtasse (erfunden)", menge: 1 }], unsicher: false };
  if (/Du prüfst Amazon-Kundenretouren/.test(text))
    return /Testtasse/.test(text)
      ? { passt: "nein", begruendung: "Foto zeigt keine Tasse (Test)", sichtbare_maengel: [], vollstaendig: "unklar", gebrauchsspuren: "keine", vorschlag_befund: "falsches_produkt", code_text: null }
      : { passt: "ja", begruendung: "Passt zum Titel (Test)", sichtbare_maengel: [], vollstaendig: "ja", gebrauchsspuren: "keine", vorschlag_befund: "ok", code_text: null };
  if (/Lies auf diesem Foto die LPN/.test(text)) return { code: null };
  if (/Seller Support: Eine Kundenretoure/.test(text)) {
    const lpn = /LPN: (\S+)/.exec(text)?.[1] ?? "–";
    const best = /Bestellnummer: (\S+)/.exec(text)?.[1] ?? "–";
    return { betreff: `Kundenretoure nicht im erstatteten Zustand – ${best}`, text_de: `Guten Tag,\n\ndie Kundenretoure zur Bestellung ${best} (LPN ${lpn}) kam leer zurück. Fotos 1–5 im Anhang. (Testtext)`, text_en: `Hello,\n\nthe customer return for order ${best} (LPN ${lpn}) arrived empty. See photos 1–5. (test text)` };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
const lex = { kontakte: new Map(), belege: new Map(), bezahlt: new Set(), nr: 0, gnr: 0 };
// Tesla Fleet API und SMS (Twilio) – erfunden, nur im Speicher: Navi-Ziele, Klima, Status, Fahrten, gesendete SMS.
const tesla = { navi: [], klima: 0, ziel: null, minuten: null, fahrten: [] };
let smsListe = [];
// Asana (B14): zwei Projekte (geschäftlich/privat); Aufgaben und Kommentare legen die Prüfungen über /__asana an.
let asana = { projekte: [{ gid: "1200000000000101", name: "Mandat LuGru (Test)" }, { gid: "1200000000000102", name: "Privat Grunert (Test)" }], aufgaben: [], kommentare: [], schreibversuche: 0 };
async function lexoffice(req, p, url, b) {
  const json = (o, code = 200) => [code, o];
  const uuid = () => crypto.randomUUID();
  if (p === "/v1/profile") return json({ companyName: "Test Prep GmbH", organizationId: "test-org" });
  if (p === "/v1/contacts" && req.method === "POST") {
    if (!b.company?.name) return json({ message: "company.name fehlt" }, 406);
    const id = uuid();
    lex.kontakte.set(id, b);
    return json({ id, resourceUri: `/v1/contacts/${id}`, version: 1 });
  }
  const summe = (b) => {
    let netto = 0;
    let steuer = 0;
    for (const li of b.lineItems ?? []) {
      const n = Math.round(li.quantity * li.unitPrice.netAmount * 100) / 100;
      netto += n;
      steuer += Math.round(n * (li.unitPrice.taxRatePercentage ?? 0)) / 100;
    }
    netto = Math.round(netto * 100) / 100;
    steuer = Math.round(steuer * 100) / 100;
    return { currency: "EUR", totalNetAmount: netto, totalTaxAmount: steuer, totalGrossAmount: Math.round((netto + steuer) * 100) / 100 };
  };
  const neu = (art, b) => {
    if (!lex.kontakte.has(b.address?.contactId)) return json({ message: "Kontakt unbekannt" }, 406);
    if (art === "credit-notes" && !lex.belege.has(url.searchParams.get("precedingSalesVoucherId"))) return json({ message: "Vorgänger unbekannt" }, 406);
    const id = uuid();
    const voucherNumber = art === "invoices" ? `RE-TEST-${String(++lex.nr).padStart(4, "0")}` : `GS-TEST-${String(++lex.gnr).padStart(4, "0")}`;
    lex.belege.set(id, { id, art, voucherNumber, totalPrice: summe(b), taxType: b.taxConditions?.taxType, vorgaenger: url.searchParams.get("precedingSalesVoucherId"), b });
    return json({ id, resourceUri: `/v1/${art}/${id}`, version: 1 });
  };
  if ((p === "/v1/invoices" || p === "/v1/credit-notes") && req.method === "POST") return neu(p.slice(4), b);
  const m = /^\/v1\/(invoices|credit-notes)\/([0-9a-f-]{36})(\/file)?$/.exec(p);
  if (m && req.method === "GET") {
    const x = lex.belege.get(m[2]);
    if (!x) return json({ message: "nicht gefunden" }, 404);
    if (m[3]) return [200, await pdf([`${x.art === "invoices" ? "Rechnung" : "Gutschrift"} ${x.voucherNumber}`, `Brutto ${x.totalPrice.totalGrossAmount} EUR (Testbeleg)`]), "application/pdf"];
    return json({ id: x.id, voucherNumber: x.voucherNumber, voucherStatus: lex.bezahlt.has(x.id) ? "paid" : "open", totalPrice: x.totalPrice, taxConditions: { taxType: x.taxType } });
  }
  const z = /^\/v1\/payments\/([0-9a-f-]{36})$/.exec(p);
  if (z) {
    const x = lex.belege.get(z[1]);
    if (!x) return json({ message: "nicht gefunden" }, 404);
    const paid = lex.bezahlt.has(x.id);
    return json({ openAmount: paid ? 0 : x.totalPrice.totalGrossAmount, paymentStatus: paid ? "balanced" : "openRevenue", currency: "EUR", voucherType: "invoice", voucherStatus: paid ? "paid" : "open" });
  }
  return json({ message: "nicht nachgebildet" }, 404);
}

const carts = new Map();
let viesNr = 0;
let discord = [];
let pushes = [];
let shopOrder = 900000;
let shipNo = 3400000000;

// Discord-Nachbau für den VA-Kanal (Kanal-IDs mit „8“ am Anfang): Threads, Nachrichten (JSON oder multipart),
// Reaktionen, Anhänge. Prüf-Hilfen: /__discord-va (Zustand), /__discord-va/nachricht, /__discord-va/reaktion.
const DC_BOT = "600000000000000001";
const DC_VA = "700000000000000001";
let dcSeq = 910000000000000000n;
// Ältere Nachrichten (History): IDs unterhalb aller übrigen, absteigend vergeben.
let dcAlt = 900000000000000000n;
let dcVa = { kanaele: new Map(), nachrichten: [], anhaenge: new Map() };
const dcId = () => String(++dcSeq);
const dcKanal = (id) => dcVa.kanaele.get(id) ?? (id.startsWith("8") ? (dcVa.kanaele.set(id, { id, name: "va-test", type: 0, guild_id: "500000000000000001" }), dcVa.kanaele.get(id)) : null);
function dcNachricht(channel_id, author, content, attachments = []) {
  const m = { id: dcId(), channel_id, type: 0, content, timestamp: new Date().toISOString(), author, attachments, reactions: [] };
  dcVa.nachrichten.push(m);
  gwSenden("MESSAGE_CREATE", { ...m, guild_id: "500000000000000001" });
  return m;
}

// Discord-Gateway (WebSocket) – Nachbau nur so weit wie nötig: Hello, Identify → READY, Herzschlag, Resume,
// MESSAGE_CREATE/MESSAGE_UPDATE an alle verbundenen Bots. Prüf-Hilfe: /__discord-gateway (Verbindungen, Intents).
const gw = { sockets: new Set(), seq: 0, identify: [] };
function wsRahmen(text) {
  const daten = Buffer.from(text, "utf8");
  const kopf = daten.length < 126 ? Buffer.from([0x81, daten.length]) : daten.length < 65536 ? Buffer.from([0x81, 126, daten.length >> 8, daten.length & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(daten.length), 2); return b; })();
  return Buffer.concat([kopf, daten]);
}
function wsSenden(sock, obj) {
  try {
    sock.write(wsRahmen(JSON.stringify(obj)));
  } catch {
    /* Verbindung weg */
  }
}
function gwSenden(t, d) {
  for (const sock of gw.sockets) if (sock.bereit) wsSenden(sock, { op: 0, t, s: ++gw.seq, d });
}
function wsLesen(sock, puffer) {
  // Client-Rahmen sind maskiert; nur Text (0x1) und Schließen (0x8).
  let buf = Buffer.concat([sock.rest ?? Buffer.alloc(0), puffer]);
  while (buf.length >= 2) {
    const op = buf[0] & 0x0f;
    let laenge = buf[1] & 0x7f;
    let pos = 2;
    if (laenge === 126) { if (buf.length < 4) break; laenge = buf.readUInt16BE(2); pos = 4; }
    else if (laenge === 127) { if (buf.length < 10) break; laenge = Number(buf.readBigUInt64BE(2)); pos = 10; }
    const maske = (buf[1] & 0x80) !== 0;
    if (buf.length < pos + (maske ? 4 : 0) + laenge) break;
    const key = maske ? buf.subarray(pos, pos + 4) : null;
    pos += maske ? 4 : 0;
    const daten = Buffer.from(buf.subarray(pos, pos + laenge));
    if (key) for (let i = 0; i < daten.length; i++) daten[i] ^= key[i % 4];
    buf = buf.subarray(pos + laenge);
    if (op === 0x8) { sock.end(); gw.sockets.delete(sock); return; }
    if (op !== 0x1) continue;
    let p;
    try { p = JSON.parse(daten.toString("utf8")); } catch { continue; }
    if (p.op === 1) wsSenden(sock, { op: 11, d: null });
    else if (p.op === 2) {
      gw.identify.push({ at: new Date().toISOString(), intents: p.d?.intents ?? null, token: p.d?.token === "test-bot-token" });
      if (p.d?.token !== "test-bot-token") { sock.end(Buffer.from([0x88, 2, 0x0f, 0xa4])); gw.sockets.delete(sock); return; }
      sock.bereit = true;
      wsSenden(sock, { op: 0, t: "READY", s: ++gw.seq, d: { v: 10, session_id: `test-session-${gw.identify.length}`, resume_gateway_url: SELF.replace(/^http/, "ws") + "/discord-gateway", user: { id: DC_BOT, username: "Seller-Bot (Test)", bot: true } } });
    } else if (p.op === 6) { sock.bereit = true; wsSenden(sock, { op: 0, t: "RESUMED", s: ++gw.seq, d: null }); }
  }
  sock.rest = buf;
}
function discordVa(req, p, url, body) {
  if (p === "/discord-api/users/@me") return [200, { id: DC_BOT, username: "Seller-Bot (Test)", bot: true }];
  const t = /^\/discord-api\/channels\/(\d+)(\/.*)?$/.exec(p);
  if (!t) return null;
  const k = dcKanal(t[1]);
  if (!k) return null;
  const rest = t[2] ?? "";
  if (!rest) return [200, k];
  if (rest === "/threads" && req.method === "POST") {
    const b = JSON.parse(body || "{}");
    const th = { id: dcId(), name: String(b.name ?? "").slice(0, 100), type: 11, parent_id: k.id, guild_id: k.guild_id };
    dcVa.kanaele.set(th.id, th);
    return [201, th];
  }
  const ausNachricht = /^\/messages\/(\d+)\/threads$/.exec(rest);
  if (ausNachricht && req.method === "POST") {
    if (dcVa.kanaele.has(ausNachricht[1])) return [400, { message: "A thread has already been created for this message", code: 160004 }];
    const b = JSON.parse(body || "{}");
    const th = { id: ausNachricht[1], name: String(b.name ?? "").slice(0, 100), type: 11, parent_id: k.id, guild_id: k.guild_id };
    dcVa.kanaele.set(th.id, th);
    return [201, th];
  }
  if (rest === "/messages" && req.method === "POST") {
    let b;
    const dateien = [];
    if (String(req.headers["content-type"] ?? "").startsWith("multipart/form-data")) {
      b = JSON.parse(/name="payload_json"\r\n(?:Content-Type:[^\r]*\r\n)?\r\n([\s\S]*?)\r\n--/.exec(body)?.[1] ?? "{}");
      for (const f of body.matchAll(/filename="([^"]+)"/g)) dateien.push({ id: dcId(), filename: f[1], size: 1 });
    } else b = JSON.parse(body || "{}");
    if (String(b.content ?? "").length > 2000) return [400, { message: "Invalid Form Body", code: 50035 }];
    const m = dcNachricht(k.id, { id: DC_BOT, bot: true, username: "Seller-Bot (Test)" }, String(b.content ?? ""), dateien);
    m.flags = b.flags ?? 0;
    m.erwaehnt = b.allowed_mentions?.users ?? [];
    return [200, m];
  }
  if (rest === "/messages" && req.method === "GET") {
    const nach = url.searchParams.get("after");
    const vor = url.searchParams.get("before");
    const limit = Number(url.searchParams.get("limit") ?? 50);
    let liste = dcVa.nachrichten.filter((m) => m.channel_id === k.id);
    if (nach) liste = liste.filter((m) => BigInt(m.id) > BigInt(nach)).slice(0, limit);
    else if (vor) liste = liste.filter((m) => BigInt(m.id) < BigInt(vor)).slice(-limit);
    else liste = liste.slice(-limit);
    return [200, [...liste].reverse()];
  }
  const eine = /^\/messages\/(\d+)$/.exec(rest);
  if (eine && req.method === "GET") {
    const m = dcVa.nachrichten.find((x) => x.id === eine[1] && x.channel_id === k.id);
    return m ? [200, m] : [404, { message: "Unknown Message", code: 10008 }];
  }
  return [404, { message: "nicht nachgebildet", code: 0 }];
}

async function route(req, url, body) {
  const p = url.pathname;
  const json = (o) => [200, o];
  const parsed = () => {
    try {
      return JSON.parse(body || "{}");
    } catch {
      return {};
    }
  };
  // Claude
  if (p.startsWith("/anthropic/")) return p.endsWith("/v1/messages") ? kiAnswer(req, parsed()) : [404, { type: "error", error: { type: "not_found_error", message: "nicht nachgebildet" } }];
  // Deutsche Post INTERNETMARKE
  if (p === "/im/user") return new URLSearchParams(body).get("password") === "falsch" ? [401, { statusCode: "401", title: "Unauthorized", detail: "user account is not valid" }] : json({ access_token: "test-im-token", expires_in: 3000, walletBalance: 100000 });
  if (p === "/im/app/catalog") return json({ pageFormats: [{ id: 1, name: "DIN A4 Normalpapier", isAddressPossible: true, pageLayout: { labelCount: { labelX: 1, labelY: 1 } } }, { id: 26, name: "Testrolle 62 mm", isAddressPossible: true, pageLayout: { labelCount: { labelX: 1, labelY: 1 } } }] });
  if (p === "/im/app/shoppingcart" && req.method === "POST") return json({ shopOrderId: String(++shopOrder) });
  if (p === "/im/app/shoppingcart/pdf") {
    const b = parsed();
    carts.set(b.shopOrderId, (b.positions ?? []).map((x) => x.address?.receiver?.name ?? "?"));
    return json({ link: `${SELF}/im/pdf/${b.shopOrderId}`, shoppingCart: { shopOrderId: b.shopOrderId, voucherList: (b.positions ?? []).map((_, i) => ({ voucherId: `A00TEST${b.shopOrderId}${i}`, trackId: "" })) }, walletBallance: 100000 - (b.total ?? 0), type: "CheckoutShoppingCartAppResponse" });
  }
  if (p.startsWith("/im/pdf/")) return [200, await pdf((carts.get(p.split("/").pop()) ?? []).map((x) => `Warensendung an ${x}`)), "application/pdf"];
  // DHL Paket (Labels)
  if (p.startsWith("/dhl/") && p.endsWith("/orders") && req.method === "POST") {
    const items = [];
    for (const s of parsed().shipments ?? []) items.push({ shipmentNo: String(++shipNo), sstatus: { statusCode: 200 }, label: { b64: (await pdf([`DHL ${s.product} an ${s.consignee?.name1 ?? "?"} ${s.details?.weight?.value ?? "?"} kg`])).toString("base64") } });
    return json({ items });
  }
  // DHL Sendungsverfolgung
  if (p.startsWith("/dhl-track")) {
    const no = url.searchParams.get("trackingNumber") ?? "";
    const st = (statusCode, description, locality) => ({ statusCode, status: statusCode.toUpperCase(), description, timestamp: new Date().toISOString(), location: { address: { addressLocality: locality } } });
    if (/^TEST-ZUGESTELLT|E2EDHL2/.test(no)) return json({ shipments: [{ id: no, service: "parcel-de", status: st("delivered", "Die Sendung wurde zugestellt.", "Musterstadt") }] });
    if (/^TEST-|E2EDHL1/.test(no)) return json({ shipments: [{ id: no, service: "freight", status: st("transit", "Die Sendung ist auf dem Weg zum Empfänger.", "Testhausen"), estimatedTimeOfDelivery: "2026-11-05T10:00:00Z" }] });
    return [404, { title: "No result found", detail: "No shipment with given tracking number found." }];
  }
  // Amazon (Anmeldung + Selling Partner API)
  if (p.startsWith("/amazon-lwa")) return json({ access_token: "test-amazon-token", token_type: "bearer", expires_in: 3600 });
  if (p.startsWith("/amazon-doc/")) {
    const r = berichte.get(p.split("/").pop());
    if (!r) return [404, { errors: [{ code: "NotFound", message: "Dokument unbekannt" }] }];
    return [200, r.typ === "GET_SALES_AND_TRAFFIC_REPORT" ? gzipSync(Buffer.from(JSON.stringify(salesTraffic(r)))) : Buffer.from(berichtTsv(r)), r.typ === "GET_SALES_AND_TRAFFIC_REPORT" ? "application/gzip" : "text/tab-separated-values; charset=utf-8"];
  }
  if (p === "/amazon/reports/2021-06-30/reports" && req.method === "POST") {
    const b = parsed();
    const id = `TESTREP${++berichtNr}`;
    berichte.set(id, { typ: b.reportType, mp: (b.marketplaceIds ?? [])[0] ?? "A1PA6795UKMFR9", von: b.dataStartTime ?? null, bis: b.dataEndTime ?? null });
    return json({ reportId: id });
  }
  const rep = /^\/amazon\/reports\/2021-06-30\/(reports|documents)\/([A-Z0-9]+)$/.exec(p);
  if (rep && req.method === "GET") {
    const r = berichte.get(rep[2]);
    // Berichte je Land sind sofort fertig; andere Reports kennt der Nachbau nicht (wie bisher).
    if (r && MARKT_TYPEN.has(r.typ)) return json(rep[1] === "reports" ? { reportId: rep[2], reportType: r.typ, processingStatus: "DONE", reportDocumentId: rep[2] } : { reportDocumentId: rep[2], url: `${SELF}/amazon-doc/${rep[2]}`, ...(r.typ === "GET_SALES_AND_TRAFFIC_REPORT" ? { compressionAlgorithm: "GZIP" } : {}) });
  }
  const kat = /^\/amazon\/catalog\/2022-04-01\/items\/([^/]+)$/.exec(p);
  if (kat && req.method === "GET") return json({ asin: kat[1], images: [{ marketplaceId: url.searchParams.get("marketplaceIds") ?? "A1PA6795UKMFR9", images: [{ variant: "MAIN", link: `${SELF}/amazon-bild/${kat[1]}.jpg`, height: 1000, width: 1000 }] }] });
  // Erfundenes „Produktbild“ (JPEG-Kopf genügt dem Nachbau)
  if (p.startsWith("/amazon-bild/")) return [200, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]), "image/jpeg"];
  // Gebühren je ASIN und Land (erfunden): Provision 15 % (ASINs mit „ELEK“ 8 %), FBA 3,20 € (DE) bzw. 3,60 € (sonst).
  const fee = /^\/amazon\/products\/fees\/v0\/items\/([^/]+)\/feesEstimate$/.exec(p);
  if (fee && req.method === "POST") {
    const asin = decodeURIComponent(fee[1]);
    const b = parsed().FeesEstimateRequest ?? {};
    const preis = Number(b.PriceToEstimateFees?.ListingPrice?.Amount ?? 0);
    const cur = b.PriceToEstimateFees?.ListingPrice?.CurrencyCode ?? "EUR";
    if (asin.startsWith("B0FEHLT")) return [400, { errors: [{ code: "InvalidInput", message: "ASIN unbekannt (Test)" }] }];
    const ref = Math.round(preis * (asin.includes("ELEK") ? 0.08 : 0.15) * 100) / 100;
    const fba = b.MarketplaceId === "A1PA6795UKMFR9" ? 3.2 : 3.6;
    return json({ payload: { FeesEstimateResult: { Status: "Success", FeesEstimateIdentifier: { SellerInputIdentifier: b.Identifier }, FeesEstimate: { TotalFeesEstimate: { CurrencyCode: cur, Amount: Math.round((ref + fba) * 100) / 100 }, FeeDetailList: [{ FeeType: "ReferralFee", FinalFee: { CurrencyCode: cur, Amount: ref } }, { FeeType: "FBAFees", FinalFee: { CurrencyCode: cur, Amount: fba } }] } } } });
  }
  const off = /^\/amazon\/products\/pricing\/v0\/items\/([^/]+)\/offers$/.exec(p);
  if (off && req.method === "GET") return angebote(decodeURIComponent(off[1]), url.searchParams.get("MarketplaceId") ?? "");
  if (p.startsWith("/amazon/")) {
    if (req.method !== "GET") return json({ payload: {}, status: "ACCEPTED", feedId: `TEST-${Date.now()}` });
    return json({ payload: { Orders: [], NextToken: null }, orders: [], items: [], inventorySummaries: [], pagination: {} });
  }
  // eBay
  if (p.startsWith("/ebay/identity/")) return json({ access_token: "test-ebay-token", expires_in: 7200, token_type: "User Access Token" });
  if (p.startsWith("/ebay/")) return req.method === "GET" ? json({ total: 0, orders: [], inventoryItems: [], offers: [], href: url.href }) : json({ simuliert: true });
  // Temu, Keepa, EZB
  if (p.startsWith("/temu/")) return json({ success: true, result: {} });
  if (p.startsWith("/keepa/product") && url.searchParams.get("code")) {
    // EAN → ASIN: erfundene ASIN aus den letzten Ziffern; mit Marktdaten wie bei der ASIN-Abfrage
    const asins = url.searchParams.get("code").split(",").map((c) => `B0EAN${c.slice(-5)}`);
    url.searchParams.set("asin", asins.join(","));
    return json(keepaProdukte(url));
  }
  if (p.startsWith("/keepa/product")) return json(keepaProdukte(url));
  if (p.startsWith("/keepa/search")) {
    // Titelsuche: einzeln und als 6er-Pack (erfunden) – zum Prüfen der Packungsgröße
    const term = url.searchParams.get("term") ?? "";
    const basis = term.replace(/\b\d+\s*(x|er)\b/gi, "").replace(/\s+/g, " ").trim();
    return json({ tokensLeft: keepaTokens, products: [{ asin: "B0TESTW001", title: `${basis} (erfunden)`, stats: { current: [] } }, { asin: "B0TESTW006", title: `${basis} 6er Pack (erfunden)`, packageQuantity: 6, stats: { current: [] } }] });
  }
  if (p.startsWith("/keepa/")) return json({ tokensLeft: keepaTokens, products: [], asinList: [] });
  if (p.startsWith("/ecb")) return [200, `<?xml version="1.0"?><gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><Cube><Cube time="2026-10-28"><Cube currency="USD" rate="1.08"/><Cube currency="GBP" rate="0.85"/><Cube currency="PLN" rate="4.30"/><Cube currency="SEK" rate="11.50"/></Cube></Cube></gesmes:Envelope>`, "application/xml"];
  // EU-Prüfung USt-IdNr. (VIES): Nummer mit „999“ ungültig, mit „000“ Land nicht erreichbar, sonst gültig.
  if (p.startsWith("/vies")) {
    const b = parsed();
    const nr = String(b.vatNumber ?? "");
    if (nr.startsWith("000")) return json({ actionSucceed: false, errorWrappers: [{ error: "MS_UNAVAILABLE" }] });
    const valid = !nr.startsWith("999");
    return json({ countryCode: b.countryCode, vatNumber: nr, requestDate: new Date().toISOString(), valid, requestIdentifier: b.requesterNumber ? `WAPITEST${String(++viesNr).padStart(6, "0")}` : "", name: valid ? `Testhandel ${b.countryCode} SARL` : "---", address: valid ? "1 Rue de l'Exemple, 75000 Paris" : "---" });
  }
  // Asana (erfunden, NUR LESEN): Projekte, Aufgaben (Fälle), Kommentare – Schlüssel „test-asana-token“.
  if (p.startsWith("/asana/api/1.0/")) {
    if ((req.headers.authorization ?? "") !== "Bearer test-asana-token") return [401, { errors: [{ message: "Not Authorized" }] }];
    if (req.method !== "GET") {
      asana.schreibversuche++;
      return [403, { errors: [{ message: "Testdienst: nur lesen" }] }];
    }
    const r = p.slice("/asana/api/1.0".length);
    if (r === "/workspaces") return json({ data: [{ gid: "1200000000000001", name: "Kanzlei (Test)" }] });
    if (r === "/projects") return json({ data: asana.projekte });
    let m = /^\/projects\/(\d+)$/.exec(r);
    if (m) {
      const pr = asana.projekte.find((x) => x.gid === m[1]);
      return pr ? json({ data: pr }) : [404, { errors: [{ message: "Unknown object" }] }];
    }
    m = /^\/projects\/(\d+)\/tasks$/.exec(r);
    if (m) return json({ data: asana.aufgaben.filter((a) => a.projekt === m[1]).map(({ projekt, abschnitt, ...a }) => ({ notes: "", completed: false, due_on: null, modified_at: new Date().toISOString(), permalink_url: `https://app.asana.example/0/${projekt}/${a.gid}`, ...a, memberships: [{ project: { gid: projekt }, section: { name: abschnitt ?? "In Bearbeitung" } }] })) });
    m = /^\/tasks\/(\d+)\/stories$/.exec(r);
    if (m) return json({ data: [{ gid: `9${m[1]}`, type: "system", text: "hat das Fälligkeitsdatum geändert", created_at: new Date().toISOString() }, ...asana.kommentare.filter((k) => k.aufgabe === m[1]).map(({ aufgabe, ...k }) => ({ type: "comment", created_by: { name: "Kanzlei (Test)" }, ...k }))] });
    return [404, { errors: [{ message: "nicht nachgebildet" }] }];
  }
  // Tesla Fleet API (erfunden): Status, Navi-Ziel, Klima, Fahrten – Schlüssel „test-tesla-token“.
  if (p.startsWith("/tesla/api/1/vehicles/")) {
    if ((req.headers.authorization ?? "") !== "Bearer test-tesla-token") return [401, { error: "invalid_token" }];
    if (p.endsWith("/vehicle_data")) return json({ response: { display_name: "Testwagen (erfunden)", state: "online", drive_state: { active_route_destination: tesla.ziel, active_route_minutes_to_arrival: tesla.minuten, latitude: tesla.lat ?? 50.1, longitude: tesla.lon ?? 8.6 }, charge_state: { battery_level: 78, battery_range: 217.5 }, climate_state: { inside_temp: 17.5, is_climate_on: tesla.klimaAn ?? false }, vehicle_state: { locked: true, fd_window: 0, fp_window: 0, rd_window: 0, rp_window: 0, tpms_soft_warning_fl: false, tpms_soft_warning_fr: false, tpms_soft_warning_rl: false, tpms_soft_warning_rr: false, software_update: { status: "" } } } });
    if (p.endsWith("/command/set_temps")) {
      tesla.temp = parsed()?.driver_temp ?? null;
      return json({ response: { result: true, reason: "" } });
    }
    if (p.endsWith("/command/auto_conditioning_stop")) {
      tesla.klimaAn = false;
      tesla.klimaAus = (tesla.klimaAus ?? 0) + 1;
      return json({ response: { result: true, reason: "" } });
    }
    if (p.endsWith("/command/navigation_request")) {
      const b = parsed();
      tesla.navi.push(b?.value?.["android.intent.extra.TEXT"] ?? "");
      return json({ response: { result: true, reason: "" } });
    }
    if (p.endsWith("/command/auto_conditioning_start")) {
      tesla.klima++;
      tesla.klimaAn = true;
      return json({ response: { result: true, reason: "" } });
    }
    if (p.endsWith("/fahrten")) return json({ response: tesla.fahrten });
    return [404, { error: "nicht nachgebildet" }];
  }
  // Twilio (SMS, erfunden): Senden merkt sich die SMS; Konto-Abfrage für den Verbindungstest.
  if (p.startsWith("/twilio/2010-04-01/Accounts/")) {
    if (p.endsWith("/Messages.json") && req.method === "POST") {
      const f = new URLSearchParams(body);
      smsListe.push({ an: f.get("To"), von: f.get("From"), text: f.get("Body"), at: new Date().toISOString() });
      return json({ sid: `SMTEST${String(smsListe.length).padStart(4, "0")}`, status: "queued" });
    }
    if (p.endsWith(".json")) return json({ friendly_name: "Testkonto (erfunden)", status: "active" });
  }
  // Lexware Office (Lexoffice): Kontakte, Rechnungen, Zahlungsstand, Gutschriften, PDF – alles nur im Speicher.
  if (p.startsWith("/lexoffice/")) return lexoffice(req, p.slice("/lexoffice".length), url, parsed());
  // Google Docs (öffentlicher Export): Dokumente, deren ID mit „TESTCALL“ beginnt, liefern ein erfundenes Transkript.
  if (p.startsWith("/gdocs/document/d/")) {
    const id = p.split("/")[4] ?? "";
    if (!id.startsWith("TESTCALL")) return [302, "", "text/html"];
    return [200, `Consultant-Call (Testdaten, erfunden) ${id}\n\nConsultant: Hallo Ludwig, schön dass es klappt.\nLudwig: Hallo! Wie besprochen habe ich die Markenliste vorbereitet.\nConsultant: Super. Schick mir bis Freitag die Liste der zehn Marken für den Audit.\nLudwig: Mache ich. Gilt der Mindestrabatt auch für Bundles?\nConsultant: Das kläre ich intern und melde mich bis nächste Woche.\nLudwig: Gut, dann machen wir Black-Week-Deals nur mit Gewinn.\nConsultant: Bis dann. (Testnotiz ${id})\n`, "text/plain; charset=utf-8"];
  }
  // Discord-API: VA-Kanal (mit Zustand: Threads, Nachrichten, Reaktionen) und Call-Kanal (eine feste Nachricht).
  if (p.startsWith("/discord-api/")) {
    if (req.headers.authorization !== "Bot test-bot-token") return [401, { message: "401: Unauthorized", code: 0 }];
    if (p === "/discord-api/gateway/bot") return [200, { url: SELF.replace(/^http/, "ws") + "/discord-gateway", shards: 1, session_start_limit: { total: 1000, remaining: 999, reset_after: 0, max_concurrency: 1 } }];
    const va = discordVa(req, p, url, body);
    if (va) return va;
  }
  if (p.startsWith("/discord-api/channels/")) {
    if (p.endsWith("/messages")) return json([{ id: "900000000000000001", timestamp: "2026-10-21T15:00:00.000Z", content: "Consultant-Call 21.10.2026 https://docs.google.com/document/d/TESTCALLdiscord0000000001/edit" }]);
    return json({ id: p.split("/")[3], name: "calls-test" });
  }
  // Discord-Webhook (B2B-Kanal): Nachricht nur mitschreiben.
  if (p.startsWith("/discord/")) {
    remember(discord, { at: new Date().toISOString(), content: String(parsed().content ?? "") });
    return [204, ""];
  }
  return [404, { title: "Nicht nachgebildet", path: p }];
}

// Keepa-Nachbau: erfundener Verlauf über 365 Tage je ASIN und Land (Amazon zeitweise nicht auf Lager, Buy Box
// wechselt zwischen Amazon, einem FBA- und einem FBM-Händler). ASINs, die mit „B0FEHLT“ beginnen, kennt Keepa nicht.
// „B0ALT…“: Keepas Stand ist 21 Tage alt, solange kein „update“ angefordert wird; „B0ALTFEST…“ bleibt auch dann alt.
let keepaTokens = 1200;
const KEEPA_LAND = {
  3: { basis: 1999, verkauft: 50, amazon: "A3JWKAKR8XB7XF" },
  4: { basis: 2149, verkauft: 20, amazon: "A1X6FK5RDHNB96" },
  8: { basis: 2099, verkauft: 0, amazon: "A11IL2PNWYJU7H" },
  9: { basis: 2249, verkauft: 30, amazon: "A1AT7YVPFBWXBL" },
  2: { basis: 1799, verkauft: 100, amazon: "A3P5ROKL5A1OLE" },
};
function keepaProdukte(url) {
  const asins = (url.searchParams.get("asin") ?? "").split(",").filter(Boolean);
  const land = KEEPA_LAND[Number(url.searchParams.get("domain"))] ?? KEEPA_LAND[3];
  keepaTokens -= asins.length * (1 + (url.searchParams.get("buybox") === "1" ? 2 : 0));
  const now = Date.now();
  const km = (ms) => Math.round(ms / 60000) - 21564000;
  const products = asins
    .filter((a) => !a.startsWith("B0FEHLT"))
    .map((asin) => {
      const csv = [];
      const [amazon, rang, angebote, bb, fba, fbm, bbHist] = [[], [], [], [], [], [], []];
      for (let d = 365; d >= 0; d -= 5) {
        const t = km(now - d * 86400000 - 3600000);
        const phase = Math.floor(d / 5) % 6;
        amazon.push(t, phase === 4 ? -1 : land.basis + phase * 50);
        bb.push(t, land.basis - 50 + phase * 40, phase === 5 ? 299 : 0);
        rang.push(t, 2000 + phase * 500);
        angebote.push(t, 10 + phase);
        fba.push(t, 6 + phase);
        fbm.push(t, 4);
        bbHist.push(String(t), phase === 4 ? "A1TESTFBA00001" : phase === 5 ? "A2TESTFBM00002" : land.amazon);
      }
      Object.assign(csv, { 0: amazon, 3: rang, 11: angebote, 18: bb, 34: fba, 35: fbm });
      return {
        asin,
        title: `Testprodukt ${asin} (erfunden)`,
        csv: Array.from({ length: 36 }, (_, i) => csv[i] ?? null),
        availabilityAmazon: 0,
        monthlySold: land.verkauft,
        lastUpdate: km(now - (asin.startsWith("B0ALTFEST") || (asin.startsWith("B0ALT") && url.searchParams.get("update") === null) ? 21 * 86400000 : 3600000)),
        stats: { outOfStockPercentage30: [17], outOfStockPercentage90: [17], outOfStockPercentageInInterval: [17], buyBoxStats: { [land.amazon]: { percentageWon: 67, isFBA: true }, A1TESTFBA00001: { percentageWon: 17, isFBA: true }, A2TESTFBM00002: { percentageWon: 16, isFBA: false } } },
        buyBoxSellerIdHistory: bbHist,
      };
    });
  return { tokensLeft: keepaTokens, products };
}

// ---------------------------------------------------------------------------------------------------------
// Amazon-Berichte je Land (Buy Box, Alle Angebote, Bestandsplanung) und Angebote live. Erfundene Testartikel
// TEST-SOCKEN (B0TEST0001), TEST-TASSE (B0TEST0002), TEST-KABEL (B0TEST0003). DE: alle drei, FR: Tasse fehlt.
const berichte = new Map();
let berichtNr = 0;
const MARKT_TYPEN = new Set(["GET_SALES_AND_TRAFFIC_REPORT", "GET_MERCHANT_LISTINGS_ALL_DATA", "GET_FBA_INVENTORY_PLANNING_DATA"]);
const MP = {
  A1PA6795UKMFR9: { land: "DE", amazon: "A3JWKAKR8XB7XF", cur: "EUR" },
  A13V1IB3VIYZZH: { land: "FR", amazon: "A1X6FK5RDHNB96", cur: "EUR" },
  APJ6JRA9NG5V4: { land: "IT", amazon: "A11IL2PNWYJU7H", cur: "EUR" },
  A1RKKUPIHCS9HS: { land: "ES", amazon: "A1AT7YVPFBWXBL", cur: "EUR" },
  A1F83G8C2ARO7P: { land: "UK", amazon: "A3P5ROKL5A1OLE", cur: "GBP" },
};
const mpOf = (id) => MP[id] ?? MP.A1PA6795UKMFR9;

function salesTraffic(r) {
  const m = mpOf(r.mp);
  const z = (asin, sku, units, preis, sessions, bb) => ({
    parentAsin: asin,
    childAsin: asin,
    sku,
    salesByAsin: { unitsOrdered: units, orderedProductSales: { amount: Math.round(units * preis * 100) / 100, currencyCode: m.cur }, totalOrderItems: units },
    trafficByAsin: { sessions, pageViews: Math.round(sessions * 1.3), buyBoxPercentage: bb, unitSessionPercentage: Math.round((units / sessions) * 1000) / 10 },
  });
  const zeilen = m.land === "DE" ? [z("B0TEST0001", "TEST-SOCKEN", 42, 9.99, 310, 92.5), z("B0TEST0002", "TEST-TASSE", 6, 14.9, 240, 41.2)] : [z("B0TEST0001", "TEST-SOCKEN", 8, 10.49, 95, 63)];
  return { reportSpecification: { reportType: r.typ, reportOptions: { dateGranularity: "DAY", asinGranularity: "CHILD" }, dataStartTime: r.von ?? "2026-09-28", dataEndTime: r.bis ?? "2026-10-27", marketplaceIds: [r.mp] }, salesAndTrafficByDate: [], salesAndTrafficByAsin: zeilen };
}

function berichtTsv(r) {
  const m = mpOf(r.mp);
  const tsv = (head, rows) => [head, ...rows].map((x) => x.join("\t")).join("\n") + "\n";
  if (r.typ === "GET_MERCHANT_LISTINGS_ALL_DATA") {
    // DE liefert die Spalten auf Deutsch, die anderen Länder auf Englisch – wie Amazon.
    const head = m.land === "DE" ? ["Artikelbezeichnung", "Angebotsnummer", "Händler-SKU", "Preis", "Menge", "Erstellungsdatum", "ASIN 1", "Versender", "Status"] : ["item-name", "listing-id", "seller-sku", "price", "quantity", "open-date", "asin1", "fulfillment-channel", "status"];
    const de = m.land === "DE";
    const rows = [["Testsocken (erfunden)", "1001TEST", "TEST-SOCKEN", de ? "9,99" : "10.49", "", "2025-03-14 10:22:33 MEZ", "B0TEST0001", "AMAZON_EU", de ? "Aktiv" : "Active"]];
    if (de) rows.push(["Testtasse (erfunden)", "1002TEST", "TEST-TASSE", "14,90", "5", "2025-05-02 08:00:00 MESZ", "B0TEST0002", "DEFAULT", "Aktiv"]);
    rows.push(["Testkabel (erfunden)", "1003TEST", "TEST-KABEL", de ? "4,99" : "5.49", "0", "2024-11-20 12:00:00 MEZ", "B0TEST0003", "DEFAULT", de ? "Inaktiv" : "Inactive"]);
    return tsv(head, rows);
  }
  const head = ["snapshot-date", "sku", "fnsku", "asin", "product-name", "condition", "available", "inv-age-0-to-90-days", "inv-age-91-to-180-days", "inv-age-181-to-270-days", "inv-age-271-to-365-days", "inv-age-365-plus-days", "currency", "estimated-storage-cost-next-month", "quantity-to-be-charged-ais-181-210-days", "estimated-ais-181-210-days", "quantity-to-be-charged-ais-211-240-days", "estimated-ais-211-240-days", "recommended-action", "fba-inventory-level-health-status"];
  const rows = m.land === "DE"
    ? [
        ["2026-10-28", "TEST-SOCKEN", "X00TEST0001", "B0TEST0001", "Testsocken (erfunden)", "New", "25", "15", "4", "6", "0", "0", m.cur, "0.84", "4", "2.28", "2", "1.14", "Create removal order", "Excess"],
        ["2026-10-28", "TEST-TASSE", "X00TEST0002", "B0TEST0002", "Testtasse (erfunden)", "New", "5", "5", "0", "0", "0", "0", m.cur, "0.21", "0", "0", "0", "0", "No action required", "Healthy"],
      ]
    : [["2026-10-28", "TEST-SOCKEN", "X00TEST0001", "B0TEST0001", "Testsocken (erfunden)", "New", "3", "3", "0", "0", "0", "0", m.cur, "0.09", "0", "0", "0", "0", "No action required", "Healthy"]];
  return tsv(head, rows);
}

// getItemOffers: B0TEST0001 – wir haben die Buy Box (DE), B0TEST0002 – Amazon hat sie; „B0FEHLT…“ kennt Amazon nicht.
function angebote(asin, mpId) {
  if (/^B0FEHLT/i.test(asin)) return [400, { errors: [{ code: "InvalidInput", message: `Client Referenced Invalid ASIN ${asin}`, details: "" }] }];
  const m = mpOf(mpId);
  const money = (Amount) => ({ Amount, CurrencyCode: m.cur });
  const offer = (SellerId, preis, versand, fba, bb, mine = false, rating = 98) => ({ SellerId, MyOffer: mine, SubCondition: "new", ListingPrice: money(preis), Shipping: money(versand), IsFulfilledByAmazon: fba, IsBuyBoxWinner: bb, IsFeaturedMerchant: true, SellerFeedbackRating: { SellerPositiveFeedbackRating: rating, FeedbackCount: 1200 } });
  const wir = asin.toUpperCase() === "B0TEST0001" && m.land === "DE";
  const offers = wir
    ? [offer("TESTSELLER", 9.99, 0, true, true, true), offer("A1TESTFBA00001", 10.49, 0, true, false), offer("A2TESTFBM00002", 8.99, 2.99, false, false, false, 91)]
    : [offer(m.amazon, 14.9, 0, true, true, false, 100), offer("TESTSELLER", 15.49, 0, true, false, true), offer("A2TESTFBM00002", 13.99, 3.5, false, false, false, 91)];
  const fba = offers.filter((o) => o.IsFulfilledByAmazon);
  const fbm = offers.filter((o) => !o.IsFulfilledByAmazon);
  const land = (o) => Math.round((o.ListingPrice.Amount + o.Shipping.Amount) * 100) / 100;
  const winner = offers.find((o) => o.IsBuyBoxWinner);
  return [200, { payload: {
    ASIN: asin, status: "Success", ItemCondition: "New", marketplaceId: mpId,
    Identifier: { MarketplaceId: mpId, ASIN: asin, ItemCondition: "New" },
    Summary: {
      TotalOfferCount: offers.length,
      NumberOfOffers: [{ condition: "new", fulfillmentChannel: "Amazon", OfferCount: fba.length }, { condition: "new", fulfillmentChannel: "Merchant", OfferCount: fbm.length }],
      LowestPrices: [{ condition: "new", fulfillmentChannel: "Amazon", LandedPrice: money(Math.min(...fba.map(land))), ListingPrice: money(Math.min(...fba.map((o) => o.ListingPrice.Amount))), Shipping: money(0) }, { condition: "new", fulfillmentChannel: "Merchant", LandedPrice: money(Math.min(...fbm.map(land))), ListingPrice: money(Math.min(...fbm.map((o) => o.ListingPrice.Amount))), Shipping: money(Math.min(...fbm.map((o) => o.Shipping.Amount))) }],
      BuyBoxPrices: [{ condition: "New", LandedPrice: money(land(winner)), ListingPrice: winner.ListingPrice, Shipping: winner.Shipping }],
      SalesRankings: [{ ProductCategoryId: "test_display_on_website", Rank: wir ? 1234 : 5678 }],
    },
    Offers: offers,
  } }];
}

// ---------------------------------------------------------------------------------------------------------
// Web-Nachbau für die Browser-Automatik (sellerboard-Kostenimport, BQool-Upload): Anmeldeseite (E-Mail mit „2fa“ →
// Bestätigungscode, Passwort „falsch“ → Anmeldung wieder), Upload-Seite nur mit Sitzungs-Cookie, Erfolgsmeldung.
const webUploads = [];
function webNachbau(req, res, url, body) {
  const [, dienst, seite] = /^\/web-([a-z]+)\/([a-z]+)/.exec(url.pathname) ?? [];
  const html = (code, inhalt, extra = {}) => {
    res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", ...extra });
    res.end(`<!doctype html><html><body><h1>${dienst} (Testnachbau)</h1>${inhalt}</body></html>`);
  };
  const angemeldet = (req.headers.cookie ?? "").includes(`sid=ok-${dienst}`);
  if (seite === "login" && req.method === "POST") {
    const f = new URLSearchParams(body);
    if ((f.get("email") ?? "").includes("2fa")) return html(200, '<p>Zwei-Faktor-Anmeldung: Bitte Bestätigungscode eingeben</p><form method="post"><input autocomplete="one-time-code" name="code"><button type="submit">Weiter</button></form>');
    if (f.get("password") === "falsch") return html(200, '<p>Falsches Passwort</p><form method="post"><input type="email" name="email"><input type="password" name="password"><button type="submit">Anmelden</button></form>');
    res.writeHead(302, { Location: `/web-${dienst}/upload`, "Set-Cookie": `sid=ok-${dienst}; Path=/` });
    return res.end();
  }
  if (seite === "login") return html(200, '<form method="post"><input type="email" name="email"><input type="password" name="password"><button type="submit">Anmelden</button></form>');
  if (!angemeldet) {
    res.writeHead(302, { Location: `/web-${dienst}/login` });
    return res.end();
  }
  if (seite === "upload" && req.method === "POST") {
    const name = /filename="([^"]+)"/.exec(body)?.[1] ?? "?";
    webUploads.push({ dienst, name, groesse: body.length, at: new Date().toISOString() });
    return html(200, `<p>Import erfolgreich: ${name} übernommen</p>`);
  }
  return html(200, '<form method="post" enctype="multipart/form-data"><input type="file" name="datei"><button type="submit">Hochladen</button></form>');
}

const dienstOf = (p) => (p.startsWith("/anthropic") ? "Claude" : p.startsWith("/im") ? "Deutsche Post" : p.startsWith("/dhl-track") ? "DHL Verfolgung" : p.startsWith("/dhl") ? "DHL Paket" : p.startsWith("/amazon") ? "Amazon" : p.startsWith("/ebay") ? "eBay" : p.startsWith("/temu") ? "Temu" : p.startsWith("/keepa") ? "Keepa" : p.startsWith("/ecb") ? "EZB" : p.startsWith("/vies") ? "VIES" : p.startsWith("/discord") ? "Discord" : p.startsWith("/gdocs") ? "Google Docs" : p.startsWith("/lexoffice") ? "Lexoffice" : p.startsWith("/asana") ? "Asana" : "?");

http
  .createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const url = new URL(req.url, "http://x");
    const send = (code, data, type = "application/json") => {
      res.writeHead(code, { "Content-Type": type, "request-id": "req_test" });
      res.end(Buffer.isBuffer(data) || typeof data === "string" ? data : JSON.stringify(data));
    };
    if (url.pathname === "/__log") return send(200, log);
    if (url.pathname === "/__web") return send(200, webUploads);
    if (url.pathname.startsWith("/web-")) return webNachbau(req, res, url, body);
    if (url.pathname === "/__ki") return send(200, ki);
    if (url.pathname === "/__discord") return send(200, discord);
    // Web-Push-Dienst (Nachbau): nimmt Anstöße an, merkt sich Adresse und VAPID-Kopf.
    if (url.pathname.startsWith("/push/") && req.method === "POST") {
      pushes.push({ at: new Date().toISOString(), pfad: url.pathname, vapid: String(req.headers.authorization ?? "").startsWith("vapid t="), laenge: body.length });
      return send(201, "");
    }
    if (url.pathname === "/__push") return send(200, pushes);
    if (url.pathname === "/__discord-va") return send(200, { kanaele: [...dcVa.kanaele.values()], nachrichten: dcVa.nachrichten });
    // Nachricht als VA (im Kanal oder Thread), optional mit Anhang (Text-Inhalt).
    if (url.pathname === "/__discord-va/nachricht" && req.method === "POST") {
      const b = JSON.parse(body || "{}");
      if (!dcKanal(String(b.kanal))) return send(404, { fehler: "Kanal unbekannt" });
      const anh = b.anhang ? [{ id: dcId(), filename: b.anhang.name, content_type: b.anhang.typ ?? "text/plain", size: b.anhang.groesse ?? String(b.anhang.inhalt ?? "").length, url: `${SELF}/discord-cdn/${encodeURIComponent(b.anhang.name)}` }] : [];
      if (b.anhang) dcVa.anhaenge.set(b.anhang.name, String(b.anhang.inhalt ?? ""));
      return send(200, dcNachricht(String(b.kanal), { id: String(b.autor ?? DC_VA), username: "VA (Test)" }, String(b.text ?? ""), anh));
    }
    // ProfitPath-Bot: Meldung mit Embed (Titel, Amazon-Link, Felder) in einen Kanal (IDs mit „8“ am Anfang).
    if (url.pathname === "/__discord-va/profitpath" && req.method === "POST") {
      const b = JSON.parse(body || "{}");
      const k = dcKanal(String(b.kanal));
      if (!k) return send(404, { fehler: "Kanal unbekannt" });
      if (b.name) k.name = b.name;
      const m = dcNachricht(k.id, { id: "650000000000000001", bot: true, username: "ProfitPath (Test)" }, "", []);
      m.embeds = [{ title: b.titel, url: `https://www.amazon.de/dp/${b.asin}`, fields: [{ name: "Buy Cost", value: b.ek }, { name: "Sell Price", value: b.vk ?? "€29,90" }, { name: "Profit", value: b.gewinn ?? "€5,00" }, { name: "ROI", value: b.roi ?? "30%" }, { name: "Store", value: "Testshop" }] }];
      return send(200, m);
    }
    // Lugru Deals: Post als Webhook (reiner Text im Lugru-Format); „alt“ = älter als die übrigen (für die History).
    if (url.pathname === "/__discord-va/lugru" && req.method === "POST") {
      const b = JSON.parse(body || "{}");
      const k = dcKanal(String(b.kanal));
      if (!k) return send(404, { fehler: "Kanal unbekannt" });
      if (b.name) k.name = b.name;
      const m = dcNachricht(k.id, { id: "660000000000000001", bot: true, username: "Lugru Deals (Test)" }, String(b.text ?? ""), []);
      m.webhook_id = "660000000000000001";
      if (b.alt) {
        // Ältere Snowflake (vor allen bisherigen) und Zeitstempel in der Vergangenheit.
        const tage = Number(b.alt) || 30;
        m.id = String(--dcAlt);
        m.timestamp = new Date(Date.now() - tage * 86400000).toISOString();
        dcVa.nachrichten.sort((x, y) => (BigInt(x.id) < BigInt(y.id) ? -1 : 1));
      }
      return send(200, m);
    }
    // Nachricht bearbeiten (Text und/oder Anhang ersetzen) → MESSAGE_UPDATE an verbundene Bots.
    if (url.pathname === "/__discord-va/bearbeiten" && req.method === "POST") {
      const b = JSON.parse(body || "{}");
      const m = dcVa.nachrichten.find((x) => x.id === String(b.nachricht));
      if (!m) return send(404, { fehler: "Nachricht unbekannt" });
      if (typeof b.text === "string") m.content = b.text;
      if (b.anhang) {
        dcVa.anhaenge.set(b.anhang.name, String(b.anhang.inhalt ?? ""));
        m.attachments = [{ id: dcId(), filename: b.anhang.name, content_type: b.anhang.typ ?? "text/plain", size: b.anhang.groesse ?? String(b.anhang.inhalt ?? "").length, url: `${SELF}/discord-cdn/${encodeURIComponent(b.anhang.name)}` }];
      }
      m.edited_timestamp = new Date().toISOString();
      gwSenden("MESSAGE_UPDATE", { ...m, guild_id: "500000000000000001" });
      return send(200, m);
    }
    if (url.pathname === "/__discord-gateway") return send(200, { verbunden: [...gw.sockets].filter((x) => x.bereit).length, identify: gw.identify });
    if (url.pathname === "/__discord-va/reaktion" && req.method === "POST") {
      const b = JSON.parse(body || "{}");
      const m = dcVa.nachrichten.find((x) => x.id === String(b.nachricht));
      if (!m) return send(404, { fehler: "Nachricht unbekannt" });
      const r = m.reactions.find((x) => x.emoji.name === b.emoji);
      if (r) r.count++;
      else m.reactions.push({ emoji: { id: null, name: b.emoji }, count: 1, me: false });
      return send(200, m);
    }
    if (url.pathname.startsWith("/discord-cdn/")) {
      const name = decodeURIComponent(url.pathname.slice("/discord-cdn/".length));
      return dcVa.anhaenge.has(name) ? send(200, dcVa.anhaenge.get(name), "text/plain") : send(404, "nicht gefunden", "text/plain");
    }
    // Prüf-Hilfen Tesla/SMS: Zustand ansehen, Navi-Ziel/Ankunft/Fahrten setzen, gesendete SMS ansehen.
    if (url.pathname === "/__tesla" && req.method === "GET") return send(200, tesla);
    if (url.pathname === "/__tesla" && req.method === "POST") {
      const b = JSON.parse(body || "{}");
      if ("ziel" in b) tesla.ziel = b.ziel;
      if ("minuten" in b) tesla.minuten = b.minuten;
      if (Array.isArray(b.fahrten)) tesla.fahrten = b.fahrten;
      if ("lat" in b) tesla.lat = b.lat;
      if ("lon" in b) tesla.lon = b.lon;
      return send(200, tesla);
    }
    if (url.pathname === "/__sms") return send(200, smsListe);
    // Prüf-Hilfen Asana: Zustand ansehen; Aufgaben/Kommentare anlegen bzw. ersetzen (gleiche gid).
    if (url.pathname === "/__asana" && req.method === "GET") return send(200, asana);
    if (url.pathname === "/__asana" && req.method === "POST") {
      const b = JSON.parse(body || "{}");
      for (const a of b.aufgaben ?? []) asana.aufgaben = [...asana.aufgaben.filter((x) => x.gid !== a.gid), a];
      for (const k of b.kommentare ?? []) asana.kommentare = [...asana.kommentare.filter((x) => x.gid !== k.gid), k];
      return send(200, asana);
    }
    // Prüf-Hilfen Lexoffice: Belege ansehen, Rechnungen als bezahlt markieren (wie ein Zahlungseingang).
    if (url.pathname === "/__lexoffice") return send(200, [...lex.belege.values()].map((x) => ({ id: x.id, art: x.art, nummer: x.voucherNumber, brutto: x.totalPrice.totalGrossAmount, netto: x.totalPrice.totalNetAmount, steuerArt: x.taxType, vorgaenger: x.vorgaenger, menge: x.b.lineItems?.[0]?.quantity, bezahlt: lex.bezahlt.has(x.id) })));
    if (url.pathname.startsWith("/__lexoffice/bezahlt/") && req.method === "POST") {
      lex.bezahlt.add(url.pathname.split("/").pop());
      return send(200, { ok: true });
    }
    if (url.pathname === "/__reset" && req.method === "POST") {
      log = [];
      ki = [];
      discord = [];
      dcVa = { kanaele: new Map(), nachrichten: [], anhaenge: new Map() };
      pushes = [];
      return send(200, { ok: true });
    }
    if (url.pathname === "/__gesund") return send(200, { ok: true });
    try {
      const [code, data, type] = await route(req, url, body);
      const write = req.method !== "GET" && !url.pathname.startsWith("/anthropic") && !/token|\/user$|identity|lwa/.test(url.pathname);
      remember(log, { at: new Date().toISOString(), dienst: dienstOf(url.pathname), method: req.method, path: url.pathname, status: code, simuliert: write });
      send(code, data, type);
    } catch (e) {
      remember(log, { at: new Date().toISOString(), dienst: dienstOf(url.pathname), method: req.method, path: url.pathname, status: 500, simuliert: false });
      send(500, { title: "Testdienst-Fehler", detail: String(e?.message ?? e) });
    }
  })
  .on("upgrade", (req, sock) => {
    if (!String(req.url ?? "").startsWith("/discord-gateway")) return sock.destroy();
    const key = String(req.headers["sec-websocket-key"] ?? "");
    const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    gw.sockets.add(sock);
    sock.on("data", (d) => wsLesen(sock, d));
    sock.on("close", () => gw.sockets.delete(sock));
    sock.on("error", () => gw.sockets.delete(sock));
    wsSenden(sock, { op: 10, d: { heartbeat_interval: 41250 } });
  })
  .listen(PORT, () => console.log(`Testdienste bereit auf Port ${PORT}`));
