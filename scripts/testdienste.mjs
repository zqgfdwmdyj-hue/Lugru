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
import { createHash, randomUUID } from "node:crypto";
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
  // B36 Video-Pipeline (Worker über die Anbieter-Brücke): feste erfundene Gliederung/Skript/Paket, auf Wunsch als Stream.
  const video = /^\[video:(research|script|package)\]/.test(text) ? videoAntwort(text) : null;
  if (video) {
    if (b.stream) return [200, videoSse(b, video), "text/event-stream"];
    const content = [...(video.suche ? [{ type: "server_tool_use", id: "srvtoolu_test_1", name: "web_search", input: { query: "Studie" } }, { type: "web_search_tool_result", tool_use_id: "srvtoolu_test_1", content: video.suche.map((x) => ({ type: "web_search_result", url: x.url, title: x.title, encrypted_content: "test", page_age: null })) }] : []), { type: "text", text: video.text }];
    return [200, { id: `msg_test_${++n}`, type: "message", role: "assistant", model: b.model, content, stop_reason: "end_turn", stop_sequence: null, usage: video.usage }];
  }
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
  // B32: Antwortentwurf (persönlich/geschäftlich) – JSON mit Zusammenfassung und kurzem Entwurf, Regeln wie im Auftrag.
  if (/^Schreibe einen Antwortentwurf für eine (persönliche|geschäftliche) Mail\./.test(text) && !stale) {
    const du = /Anrede: Du/.test(text);
    const unterschrift = /Unterschrift: ([^.\n]*)\./.exec(text)?.[1]?.trim() ?? "";
    const name = (/Absender: ([^<\n]*)</.exec(text)?.[1] ?? "").trim();
    const art = /Erkannter Termin-Bezug: (\w+)/.exec(text)?.[1] ?? null;
    const slots = /Freie Termine zum Vorschlagen: ([^\n]*)\./.exec(text)?.[1] ?? "";
    const mail = text.split("\nMail:\n")[1] ?? "";
    const gruss = du ? `Hallo ${name.split(/\s+/)[0] || "zusammen"},` : name ? `Guten Tag ${name},` : "Guten Tag,";
    let kern;
    let zus;
    if (art === "absage") {
      kern = du ? `danke, dass du Bescheid gibst – gute Besserung! Lass uns einen neuen Termin finden${slots ? `, z. B. ${slots}` : ""}.` : `vielen Dank für Ihre Nachricht und gute Besserung! Gern finden wir einen neuen Termin${slots ? `, etwa ${slots}` : ""}.`;
      zus = "Termin abgesagt (krank) – neuer Termin gewünscht.";
    } else if (art === "bestaetigung") {
      kern = du ? "danke, ist notiert – bis dann!" : "vielen Dank, der Termin ist notiert.";
      zus = "Termin bestätigt.";
    } else if (art === "verschiebung" || art === "vorschlag") {
      kern = du ? "danke, der neue Termin passt mir [bitte prüfen]." : "vielen Dank, der vorgeschlagene Termin passt mir [bitte prüfen].";
      zus = "Neuer Terminvorschlag.";
    } else {
      kern = du ? "danke für deine Nachricht! [Antwort ergänzen]" : "vielen Dank für Ihre Nachricht. [Antwort ergänzen]";
      zus = (mail.replace(/^\s*(hallo|guten tag|sehr geehrte[rs]?)[^\n,]*,?\s*/i, "").split(/[.!?\n]/)[0] ?? "").trim().slice(0, 120) || "Nachricht ohne klaren Bezug.";
    }
    const entwurf = [gruss, "", kern, "", du ? "Viele Grüße" : "Freundliche Grüße", unterschrift].join("\n");
    return [200, reply(b, [{ type: "text", text: "```json\n" + JSON.stringify({ zusammenfassung: zus, entwurf }) + "\n```" }], "end_turn")];
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
  // DHL-Label aus Chat: Versandadresse aus Text bzw. Testbild (Text hinter „TESTOCR“) – erfundene Regeln wie eine KI.
  // „?“ hinter einem Wert = unsicher (gelb). Antwort nur JSON.
  if (/^Lies die Versandadresse aus/m.test(text) && !stale) {
    const bildText = parts
      .filter((p) => p.type === "image" && p.source?.data)
      .map((p) => Buffer.from(/TESTOCR\n([\s\S]*)$/.exec(Buffer.from(p.source.data, "base64").toString("latin1"))?.[1] ?? "", "latin1").toString("utf8"))
      .join("\n");
    const zeilen = [/Nachricht:\n([\s\S]*)$/.exec(text)?.[1] ?? "", bildText]
      .join("\n")
      .split("\n")
      .map((z) => z.replace(/^\s*\[[^\]]*\]\s*/, "").trim())
      .filter(Boolean);
    const a = { name: "", name2: "", strasse: "", hausnummer: "", plz: "", ort: "", land: "DE", telefon: "", email: "", packstation: "", postnummer: "", unsicher: [] };
    for (const z0 of zeilen) {
      const unsicher = z0.endsWith("?");
      const z = z0.replace(/\?$/, "").trim();
      let m;
      if ((m = /^Postnummer\s*:?\s*(\d{6,10})$/i.exec(z))) { a.postnummer = m[1]; continue; }
      if ((m = /^Packstation\s*(\d{3})$/i.exec(z))) { a.packstation = `Packstation ${m[1]}`; continue; }
      const roh = z;
      const zz = roh.replace(/^(?:PLZ\s*\/\s*Ort|[A-ZÄÖÜ][a-zäöüß]{1,15})\s*:\s+/, "");
      if (zz !== roh && /^(Name|Empfänger)/i.test(roh) && !a.name) { a.name = zz; continue; }
      if ((m = /^(?:Tel\.?|Telefon|Handy)?\s*:?\s*(\+?[\d][\d\s/()-]{7,})$/i.exec(zz)) && !/^\d{4,5}\s+\D/.test(zz)) { a.telefon = m[1].replace(/[^\d+]/g, ""); continue; }
      if ((m = /^(\d{4,5})\s+([^\d].*)$/.exec(zz))) { a.plz = m[1]; a.ort = m[2]; if (unsicher) a.unsicher.push("ort"); continue; }
      if ((m = /^(.*[a-zäöüß]{3,}.*?)\s+(\d+\s*[a-zA-Z]?)$/.exec(zz))) { a.strasse = m[1]; a.hausnummer = m[2].replace(/\s/g, ""); if (unsicher) a.unsicher.push("hausnummer"); continue; }
      if ((m = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(zz))) { a.email = m[0]; continue; }
      if (!a.name && /^[A-ZÄÖÜ][\wäöüß.-]+(\s+[A-ZÄÖÜ][\wäöüß.-]+){1,3}$/.test(zz) && !/^(Hallo|Hi|Danke|Viele|Liebe|Gruß)/.test(zz)) a.name = zz;
    }
    return [200, reply(b, [{ type: "text", text: JSON.stringify(a) }], "end_turn")];
  }
  // Rechnungsstation (erfundene Regeln wie eine KI): Testbilder/-PDFs tragen den Belegtext hinter „TESTOCR“ –
  // Zeilen „ART:“, „LIEFERANT:“, „NR:“, „BESTELLNR:“, „DATUM:“, „NETTO:“, „BRUTTO:“, „UST: 19 19,00“, „POS: ASIN EAN Artikel | Menge | EK“,
  // „ZIEL: 14“, „ZAHLUNG:“, „FOLGESEITE“, „UNSICHER: datum,nummer“. PDF-Stapel: Seiten getrennt durch „=== SEITE n ===“.
  if ((/^Lies den Beleg von der Rechnungsstation/m.test(text) || /^Lies den PDF-Stapel vom Einzugsscanner/m.test(text)) && !stale) {
    const roh = parts
      .filter((p) => (p.type === "image" || p.type === "document") && p.source?.data)
      .map((p) => Buffer.from(/TESTOCR\n([\s\S]*)$/.exec(Buffer.from(p.source.data, "base64").toString("latin1"))?.[1] ?? "", "latin1").toString("utf8"))
      .join("\n");
    const zahl = (v) => (v == null ? null : Number(String(v).replace(/\./g, "").replace(",", ".")));
    const lesen = (t) => {
      const o = { art: "sonstiges", lieferant: null, rechnungsnummer: null, bestellnummer: null, datum: null, netto: null, brutto: null, ust: [], positionen: [], zahlungsziel_tage: null, faellig_am: null, zahlungsart: null, folgeseite: false, unsicher: [] };
      for (const z0 of t.split("\n")) {
        const z = z0.trim();
        let m;
        if ((m = /^ART:\s*(\w+)/.exec(z))) o.art = m[1];
        else if ((m = /^LIEFERANT:\s*(.+)$/.exec(z))) o.lieferant = m[1];
        else if ((m = /^NR:\s*(.+)$/.exec(z))) o.rechnungsnummer = m[1];
        else if ((m = /^BESTELLNR:\s*(.+)$/.exec(z))) o.bestellnummer = m[1];
        else if ((m = /^DATUM:\s*(\d{4}-\d{2}-\d{2})/.exec(z))) o.datum = m[1];
        else if ((m = /^NETTO:\s*([\d.,]+)/.exec(z))) o.netto = zahl(m[1]);
        else if ((m = /^BRUTTO:\s*([\d.,]+)/.exec(z))) o.brutto = zahl(m[1]);
        else if ((m = /^UST:\s*(\d+)\s+([\d.,]+)/.exec(z))) o.ust.push({ satz: Number(m[1]), betrag: zahl(m[2]) });
        else if ((m = /^POS:\s*(.+)$/.exec(z))) {
          const [kopf, menge, ek] = m[1].split("|").map((x) => x.trim());
          const asin = /\b(B0[A-Z0-9]{8})\b/.exec(kopf)?.[1] ?? null;
          const ean = /\b(\d{13})\b/.exec(kopf)?.[1] ?? null;
          o.positionen.push({ asin, ean, artikel: kopf.replace(asin ?? "", "").replace(ean ?? "", "").trim() || null, menge: zahl(menge), ek: zahl(ek) });
        } else if ((m = /^ZIEL:\s*(\d+)/.exec(z))) o.zahlungsziel_tage = Number(m[1]);
        else if ((m = /^ZAHLUNG:\s*(.+)$/.exec(z))) o.zahlungsart = m[1];
        else if (/^FOLGESEITE$/.test(z)) o.folgeseite = true;
        else if ((m = /^UNSICHER:\s*(.+)$/.exec(z))) o.unsicher = m[1].split(/[,\s]+/).filter(Boolean);
      }
      return o;
    };
    if (/^Lies den Beleg von der Rechnungsstation/m.test(text)) return [200, reply(b, [{ type: "text", text: JSON.stringify(lesen(roh)) }], "end_turn")];
    // PDF-Stapel: Seiten gruppieren – gleiche Rechnungsnummer bzw. Folgeseite ohne Nummer gehört zum vorigen Beleg.
    const seiten = roh.split(/^=== SEITE \d+ ===$/m).map((x) => x.trim()).filter(Boolean).map(lesen);
    const belege = [];
    seiten.forEach((s, i) => {
      const vor = belege.at(-1);
      if (vor && ((s.rechnungsnummer && s.rechnungsnummer === vor.rechnungsnummer) || (s.folgeseite && !s.rechnungsnummer))) {
        vor.seiten.push(i + 1);
        vor.positionen.push(...s.positionen);
        for (const k of ["netto", "brutto", "zahlungsziel_tage", "zahlungsart"]) if (s[k] != null) vor[k] = s[k];
        if (s.ust.length) vor.ust = s.ust;
      } else belege.push({ seiten: [i + 1], ...s });
    });
    return [200, reply(b, [{ type: "text", text: JSON.stringify({ belege }) }], "end_turn")];
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
          [/^bitte Rechnung (\S+) prüfen$/gi, "Please check the $1 invoice"],
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
    const vorAsin = asin ? /([A-ZÄÖÜ][\wäöüß]+)\s+B0[A-Z0-9]{8}/.exec(n)?.[1] ?? null : null;
    const marke = vorAsin && !/^B0[A-Z0-9]{8}$/.test(vorAsin) ? vorAsin : null;
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
  // B34.3 Restposten-Anschreiben an einen Händler (erfundener Brieftext aus Empfänger und Artikeln)
  if (/^Schreibe ein kurzes, sachliches Geschäftsanschreiben/.test(text)) {
    const empf = /Empfänger: ([^.(\n]+)/.exec(text)?.[1]?.trim() ?? "Ihr Geschäft";
    const art = /Artikel: (.+)\.\s*$/m.exec(text)?.[1] ?? "einige Artikel";
    return [200, reply(b, [{ type: "text", text: `Sehr geehrte Damen und Herren,\n\nfür ${empf} haben wir ein Restposten-Angebot zusammengestellt: ${art}. Alle Artikel sind Neuware und originalverpackt. Bei Interesse senden wir Ihnen gern weitere Informationen oder ein Muster.` }], "end_turn")];
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
let sbMock = { aufrufe: 0, limit: false, quotaVoll: true, werkzeuge: [] };
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
// Thread im Nachbau anlegen (Bot über die API oder VA über /__discord-va/thread).
function dcThread(id, name, k, owner, archiviert = false) {
  const th = { id, name: String(name ?? "").slice(0, 100), type: 11, parent_id: k.id, guild_id: k.guild_id, owner_id: owner, thread_metadata: { archived: archiviert, create_timestamp: new Date().toISOString() } };
  dcVa.kanaele.set(th.id, th);
  return th;
}

function discordVa(req, p, url, body) {
  if (p === "/discord-api/users/@me") return [200, { id: DC_BOT, username: "Seller-Bot (Test)", bot: true }];
  // Direktnachricht (DM) an eine Person: eigener Kanal je Empfänger (type 1, ohne Server).
  if (p === "/discord-api/users/@me/channels" && req.method === "POST") {
    const b = JSON.parse(body || "{}");
    const id = `85${String(b.recipient_id ?? "0").slice(-16).padStart(16, "0")}`;
    if (!dcVa.kanaele.has(id)) dcVa.kanaele.set(id, { id, type: 1, name: null, recipients: [{ id: String(b.recipient_id ?? "") }] });
    return [200, dcVa.kanaele.get(id)];
  }
  const gilde = /^\/discord-api\/guilds\/(\d+)\/threads\/active$/.exec(p);
  if (gilde && req.method === "GET") return [200, { threads: [...dcVa.kanaele.values()].filter((x) => x.type === 11 && x.guild_id === gilde[1] && !x.thread_metadata?.archived), members: [] }];
  const t = /^\/discord-api\/channels\/(\d+)(\/.*)?$/.exec(p);
  if (!t) return null;
  const k = dcKanal(t[1]);
  if (!k) return null;
  const rest = t[2] ?? "";
  if (!rest) return [200, k];
  if (rest === "/threads" && req.method === "POST") {
    const b = JSON.parse(body || "{}");
    return [201, dcThread(dcId(), b.name, k, DC_BOT)];
  }
  if (rest === "/threads/archived/public" && req.method === "GET") return [200, { threads: [...dcVa.kanaele.values()].filter((x) => x.type === 11 && x.parent_id === k.id && x.thread_metadata?.archived), members: [], has_more: false }];
  const ausNachricht = /^\/messages\/(\d+)\/threads$/.exec(rest);
  if (ausNachricht && req.method === "POST") {
    if (dcVa.kanaele.has(ausNachricht[1])) return [400, { message: "A thread has already been created for this message", code: 160004 }];
    const b = JSON.parse(body || "{}");
    return [201, dcThread(ausNachricht[1], b.name, k, DC_BOT)];
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
  const reaktion = /^\/messages\/(\d+)\/reactions\/([^/]+)\/@me$/.exec(rest);
  if (reaktion && req.method === "PUT") {
    const m = dcVa.nachrichten.find((x) => x.id === reaktion[1] && x.channel_id === k.id);
    if (!m) return [404, { message: "Unknown Message", code: 10008 }];
    const name = decodeURIComponent(reaktion[2]);
    const r = m.reactions.find((x) => x.emoji.name === name);
    if (r && !r.me) Object.assign(r, { count: r.count + 1, me: true });
    else if (!r) m.reactions.push({ emoji: { id: null, name }, count: 1, me: true });
    return [204, ""];
  }
  const eine = /^\/messages\/(\d+)$/.exec(rest);
  if (eine && req.method === "GET") {
    const m = dcVa.nachrichten.find((x) => x.id === eine[1] && x.channel_id === k.id);
    return m ? [200, m] : [404, { message: "Unknown Message", code: 10008 }];
  }
  return [404, { message: "nicht nachgebildet", code: 0 }];
}

// Abholungen (DHL/UPS): empfangene Aufträge und Stornos – Prüf-Hilfe GET /__abholung.
const abholungen = [];
const dhlAbholAuftraege = new Set();
const upsAbholAuftraege = new Set();
let upsPrn = 0;

// B34.2 Google Drive (Nachbau): Dateien/Ordner im Speicher. Lesen (Liste mit q, Download), Ordner anlegen, verschieben/
// umbenennen (PATCH addParents/removeParents), Papierkorb (trashed). Prüf-Hilfe: POST /__drive (Dateien anlegen),
// GET /__drive (Stand mit Pfaden). Token: POST /google-oauth/token (Signatur wird nicht geprüft).
const drive = { dateien: new Map(), n: 0 };
const driveQ = (q) => {
  const wert = (re) => {
    const m = re.exec(q);
    return m ? m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\") : null;
  };
  return { eltern: wert(/'((?:[^'\\]|\\.)*)' in parents/), name: wert(/name = '((?:[^'\\]|\\.)*)'/), mime: wert(/mimeType = '((?:[^'\\]|\\.)*)'/), ohnePapierkorb: /trashed = false/.test(q) };
};
const driveSicht = (f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, createdTime: f.createdTime, modifiedTime: f.createdTime, trashed: f.trashed, size: f.inhalt ? String(f.inhalt.length) : undefined });
function drivePfad(f) {
  const teile = [];
  let p = f.parents[0];
  while (p && drive.dateien.has(p)) {
    const o = drive.dateien.get(p);
    teile.unshift(o.name);
    p = o.parents[0];
  }
  return teile.join("/");
}
function driveRoute(req, url, p, b) {
  if (p === "/google-oauth/token") return [200, { access_token: `test-drive-token-${++drive.n}`, token_type: "Bearer", expires_in: 3600 }];
  // Dienstkonto (Rechnungsordner) oder Google-Anmeldung (B36 Video-Ablage, drive.file)
  if (!/^Bearer (test-drive-token-|yt-access)/.test(req.headers.authorization ?? "")) return [401, { error: { code: 401, message: "Invalid Credentials" } }];
  if (p === "/drive/v3/files" && req.method === "GET") {
    const q = driveQ(url.searchParams.get("q") ?? "");
    const files = [...drive.dateien.values()].filter((f) => (!q.eltern || f.parents.includes(q.eltern)) && (!q.name || f.name === q.name) && (!q.mime || f.mimeType === q.mime) && (!q.ohnePapierkorb || !f.trashed));
    return [200, { files: files.map(driveSicht) }];
  }
  if (p === "/drive/v3/files" && req.method === "POST") {
    const id = `drv-${++drive.n}`;
    drive.dateien.set(id, { id, name: String(b.name ?? "Ordner"), mimeType: b.mimeType ?? "application/octet-stream", parents: Array.isArray(b.parents) ? b.parents : [], createdTime: new Date().toISOString(), trashed: false, inhalt: null });
    return [200, { id }];
  }
  const m = /^\/drive\/v3\/files\/([^/]+)$/.exec(p);
  const f = m ? drive.dateien.get(decodeURIComponent(m[1])) : null;
  if (!f) return [404, { error: { code: 404, message: "File not found" } }];
  if (req.method === "GET" && url.searchParams.get("alt") === "media") return [200, f.inhalt ?? Buffer.alloc(0), f.mimeType];
  if (req.method === "GET") return [200, driveSicht(f)];
  if (req.method === "PATCH") {
    const weg = (url.searchParams.get("removeParents") ?? "").split(",").filter(Boolean);
    const dazu = (url.searchParams.get("addParents") ?? "").split(",").filter(Boolean);
    f.parents = [...f.parents.filter((x) => !weg.includes(x)), ...dazu.filter((x) => !f.parents.includes(x))];
    if (typeof b.name === "string" && b.name) f.name = b.name;
    if (b.trashed === true) f.trashed = true;
    return [200, driveSicht(f)];
  }
  if (req.method === "DELETE") return [403, { error: { code: 403, message: "Löschen ist im Nachbau gesperrt – das Seller-System darf nur in den Papierkorb legen." } }];
  return [405, { error: { code: 405, message: "nicht nachgebildet" } }];
}

// B34.3a Briefversand (Nachbau): LetterXpress API v3 (Anmeldung im Body, auch bei GET; mode „test“ = Warenkorb) und
// eBrief (Basic → Bearer, Jobs). Erfundene Preise: 0,90 € netto 1. Blatt + 0,10 € je weitere Seite. Nichts wird gedruckt.
// Prüf-Hilfen: GET /__briefe (Aufträge), POST /__briefe {id|alle, status, tracking_status} (Status weiterschalten).
const briefe = { jobs: new Map(), n: 7000 };
const briefPreis = (seiten) => Math.round((0.9 + Math.max(0, seiten - 1) * 0.1) * 100) / 100;
async function pdfSeiten(b64) {
  try {
    return (await PDFDocument.load(Buffer.from(b64, "base64"))).getPageCount();
  } catch {
    return 0;
  }
}
async function letterxpress(req, p, b) {
  const a = b.auth ?? {};
  if (!a.username || !a.apikey) return [401, { status: 401, message: "Unauthorized" }];
  if (a.apikey === "falsch") return [401, { status: 401, message: "Unauthorized" }];
  const pfad = p.slice("/letterxpress/v3".length);
  if (pfad === "/balance") return [200, { status: 200, message: "OK", data: { balance: 100.0, currency: "EUR" } }];
  if (pfad === "/price") return [200, { status: 200, message: "OK", data: { price: briefPreis(Number(b.letter?.specification?.pages ?? 1)), letter: b.letter ?? {} } }];
  if (pfad === "/printjobs" && req.method === "POST") {
    const l = b.letter ?? {};
    if (!l.base64_file || createHash("md5").update(String(l.base64_file)).digest("hex") !== l.base64_file_checksum) return [400, { status: 400, message: "checksum mismatch" }];
    const seiten = await pdfSeiten(l.base64_file);
    if (!seiten) return [400, { status: 400, message: "invalid pdf" }];
    const id = ++briefe.n;
    const job = { id, anbieter: "letterxpress", mode: a.mode === "live" ? "live" : "test", status: a.mode === "live" ? "queue" : "draft", seiten, amount: briefPreis(seiten), spec: l.specification ?? {}, tracking_status: null, tracking_code: null, at: new Date().toISOString() };
    briefe.jobs.set(String(id), job);
    return [200, { status: 200, message: "OK", data: lxpSicht(job) }];
  }
  const m = /^\/printjobs\/(\d+)$/.exec(pfad);
  const job = m ? briefe.jobs.get(m[1]) : null;
  if (!job) return [404, { status: 404, message: "Not found" }];
  if (req.method === "DELETE") {
    if (job.status === "done") return [409, { status: 409, message: "already printed" }];
    job.status = "canceled";
    return [200, { status: 200, message: "OK", data: lxpSicht(job) }];
  }
  return [200, { status: 200, message: "OK", data: lxpSicht(job) }];
}
const lxpSicht = (j) => ({ id: j.id, shipping: j.spec.shipping ?? "national", mode: j.spec.mode ?? "simplex", color: j.spec.color ?? "1", status: j.status, items: [{ address: "Testanschrift (Nachbau)", pages: j.seiten, amount: j.amount, vat: Math.round(j.amount * 0.19 * 100) / 100, status: j.status === "done" ? "sent" : j.status, ...(j.tracking_code ? { tracking_code: j.tracking_code } : {}), ...(j.tracking_status ? { tracking_status: j.tracking_status } : {}) }] });
async function ebrief(req, p, b) {
  const pfad = p.slice("/ebrief".length);
  if (pfad === "/oauth2/token/generateBearerToken") {
    const roh = Buffer.from(String(req.headers.authorization ?? "").replace(/^Basic\s+/i, ""), "base64").toString();
    const [u, pw] = roh.split(":");
    if (!u || !pw || pw === "falsch") return [401, { title: "Unauthorized" }];
    return [200, { GenerateBearerTokenResult: "test-ebrief-token" }];
  }
  if (req.headers.authorization !== "Bearer test-ebrief-token") return [401, { ResultCode: "Unauthorized", ErrorMessage: "Token ungültig" }];
  const ok = (Result) => [200, { ResultCode: "Ok", ErrorMessage: null, Result }];
  if (pfad === "/Prices") return ok({ TotalSumNetto: briefPreis(Number(b.Attributes?.Pages ?? 1)) * Number(b.Amount ?? 1) });
  if (pfad === "/Jobs/singleFiles" && req.method === "POST") {
    const seiten = await pdfSeiten(b.Document?.FileContent ?? "");
    if (!seiten) return [400, { ResultCode: "BadRequest", ErrorMessage: "Dokument ungültig" }];
    const id = ++briefe.n;
    const job = { id, anbieter: "ebrief", mode: "test", status: "Created", seiten, amount: briefPreis(seiten), adresse: b.AddressInformation ?? null, at: new Date().toISOString() };
    briefe.jobs.set(String(id), job);
    return ok({ Jobs: [ebSicht(job)] });
  }
  const m = /^\/Jobs\/(\d+)$/.exec(pfad);
  const job = m ? briefe.jobs.get(m[1]) : null;
  if (!job) return [404, { ResultCode: "NotFound", ErrorMessage: "Job nicht gefunden" }];
  if (req.method === "PUT") {
    if (!b.IsRollback) {
      job.status = "Processing";
      job.mode = "live";
    }
    return ok({ Jobs: [ebSicht(job)] });
  }
  if (req.method === "DELETE") {
    job.status = "Deleted";
    return ok({ Jobs: [ebSicht(job)] });
  }
  return ok({ Jobs: [ebSicht(job)] });
}
const ebSicht = (j) => ({ Id: j.id, JobStatus: j.status, PriceNetto: j.amount, Documents: [{ DocumentStatus: j.status, LastEvent: j.tracking_status ?? j.status, PriceNetto: j.amount }] });

// B35 Lead-Quellen (Nachbau): Apify-Läufe mit steigenden Kosten, Google-Places-Textsuche, Firmenwebsites mit
// Impressum / robots.txt / Captcha. Nur erfundene Firmen (example.invalid).
const leadNb = { runs: new Map(), n: 0, abbrueche: [], places: [], abrufe: [], cfg: { usdSchritt: 0.05, endUsd: 0.2, items: null } };
const APIFY_STANDARD = () => [
  { title: "Testsalon Apify 1 GmbH", categoryName: "Friseur", street: "Testweg 1", city: "Musterstadt", postalCode: "12345", countryCode: "DE", website: "https://testsalon-apify1.example.invalid", location: { lat: 48.1, lng: 11.5 } },
  { title: "Testsalon Apify 2 UG", categoryName: "Friseur", street: "Testweg 2", city: "Musterstadt", postalCode: "12345", countryCode: "DE", website: "https://testsalon-apify2.example.invalid", location: { lat: 48.11, lng: 11.51 } },
  { title: "Testspielwaren Apify KG", categoryName: "Spielwarengeschäft", street: "Testweg 3", city: "Musterstadt", postalCode: "12345", countryCode: "DE", website: "https://testspielwaren-apify.example.invalid", location: { lat: 48.12, lng: 11.52 } },
];
const apifySicht = (r) => ({ data: { id: r.id, status: r.status, defaultDatasetId: `ds-${r.id}`, usageTotalUsd: Math.round(r.usd * 100) / 100 } });
function apifyNb(req, p, b) {
  const pfad = p.slice("/apify/v2".length);
  if (!String(req.headers.authorization ?? "").startsWith("Bearer ")) return [401, { error: { type: "token-not-provided", message: "Token fehlt" } }];
  if (pfad === "/users/me") return [200, { data: { username: "test-apify" } }];
  const start = /^\/acts\/([^/]+)\/runs$/.exec(pfad);
  if (start && req.method === "POST") {
    const id = `run${++leadNb.n}`;
    const r = { id, status: "RUNNING", usd: 0, actor: decodeURIComponent(start[1]), eingabe: b, items: leadNb.cfg.items ?? APIFY_STANDARD() };
    leadNb.runs.set(id, r);
    return [201, apifySicht(r)];
  }
  const ab = /^\/actor-runs\/([^/]+)\/abort$/.exec(pfad);
  if (ab && req.method === "POST") {
    const r = leadNb.runs.get(ab[1]);
    if (!r) return [404, { error: { type: "record-not-found" } }];
    if (r.status === "RUNNING") r.status = "ABORTED";
    leadNb.abbrueche.push({ id: r.id, usd: r.usd, at: new Date().toISOString() });
    return [200, apifySicht(r)];
  }
  const st = /^\/actor-runs\/([^/]+)$/.exec(pfad);
  if (st) {
    const r = leadNb.runs.get(st[1]);
    if (!r) return [404, { error: { type: "record-not-found" } }];
    if (r.status === "RUNNING") {
      r.usd += leadNb.cfg.usdSchritt;
      if (r.usd >= leadNb.cfg.endUsd - 1e-9) r.status = "SUCCEEDED";
    }
    return [200, apifySicht(r)];
  }
  const ds = /^\/datasets\/ds-([^/]+)\/items$/.exec(pfad);
  if (ds) {
    const r = leadNb.runs.get(ds[1]);
    // Bis zum Abbruch geliefert: ein Teil der Ergebnisse
    return [200, r ? (r.status === "ABORTED" ? r.items.slice(0, 1) : r.items) : []];
  }
  return [404, { error: { type: "page-not-found" } }];
}
function placesNb(req, b) {
  if (!req.headers["x-goog-api-key"]) return [403, { error: { code: 403, message: "API key fehlt", status: "PERMISSION_DENIED" } }];
  leadNb.places.push({ text: b.textQuery, pageToken: b.pageToken ?? null, bias: b.locationBias ?? null, feldmaske: req.headers["x-goog-fieldmask"] ?? null });
  const ort = (k) => [
    { longText: `Testweg ${k}`.replace(/ \d+$/, ""), types: ["route"] },
    { longText: String(k), types: ["street_number"] },
    { longText: "12345", types: ["postal_code"] },
    { longText: "Musterstadt", types: ["locality"] },
    { longText: "Deutschland", shortText: "DE", types: ["country"] },
  ];
  const seite2 = b.pageToken === "seite2";
  const basis = seite2 ? 20 : 10;
  const places = [1, 2].map((i) => ({ id: `place-test-${basis + i}`, displayName: { text: `Testfriseur Places ${basis + i} GmbH` }, addressComponents: ort(basis + i), location: { latitude: 48.1 + i / 100, longitude: 11.5 }, websiteUri: `https://testfriseur-places${basis + i}.example.invalid`, primaryTypeDisplayName: { text: "Friseursalon" } }));
  return [200, { places, ...(!seite2 && /mehr/i.test(String(b.textQuery ?? "")) ? { nextPageToken: "seite2" } : {}) }];
}
const IMPRESSUM = (firma, ust, mail) => `<!doctype html><html><body><h1>Impressum</h1><p>Angaben gemäß § 5 TMG</p><p>${firma}<br>Testweg 9<br>12345 Musterstadt</p><p>Handelsregister: HRB 99999, Amtsgericht Musterstadt</p><p>Umsatzsteuer-Identifikationsnummer: ${ust}</p><p>E-Mail: ${mail}</p></body></html>`;
function leadWebNb(req, p) {
  const [, , host, ...rest] = p.split("/");
  const pfad = `/${rest.join("/")}`;
  leadNb.abrufe.push({ at: Date.now(), host, pfad, ua: String(req.headers["user-agent"] ?? "") });
  const html = (code, text) => [code, text, "text/html; charset=utf-8"];
  const txt = (text) => [200, text, "text/plain; charset=utf-8"];
  if (host.startsWith("captcha")) return html(403, "<html><body><div class='g-recaptcha'>Bitte bestätigen: Sind Sie ein Mensch? (captcha)</div></body></html>");
  if (pfad === "/robots.txt") return host.startsWith("verboten") ? txt("User-agent: *\nDisallow: /") : txt("User-agent: *\nAllow: /");
  if (pfad === "/impressum" && host.endsWith(".example.invalid")) {
    const name = host.split(".")[0];
    return html(200, IMPRESSUM(`${name} GmbH`, host.includes("doppelt") ? "DE000000077" : "DE000000099", `info@${host}`));
  }
  return html(404, "<html><body>Nicht gefunden</body></html>");
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
  if (p.startsWith("/apify/v2/")) return apifyNb(req, p, parsed());
  if (p === "/places/v1/places:searchText" && req.method === "POST") return placesNb(req, parsed());
  if (p.startsWith("/leadweb/")) return leadWebNb(req, p);
  if (p.startsWith("/drive/v3/") || p === "/drive/v3/files" || p === "/google-oauth/token") return driveRoute(req, url, p, parsed());
  if (p.startsWith("/letterxpress/v3/")) return letterxpress(req, p, parsed());
  if (p.startsWith("/ebrief/")) return ebrief(req, p, parsed());
  // B36 Video: ElevenLabs, OpenAI-Bilder, YouTube
  if (p.startsWith("/elevenlabs/v1/text-to-speech/") && req.method === "POST") return elevenNb(req, p, parsed());
  if (p === "/openai/v1/images/generations" && req.method === "POST") return openaiBildNb(req, parsed());
  if (p.startsWith("/youtube")) return youtubeNb(req, url, p, body);
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
  // DHL Abholung (Parcel DE Pickup v1) – erfundene Regeln: PLZ „00000“ = 422; über 10 Pakete = EMA (einmalige Abholung,
  // nur Anfrage), mit Abrechnungsnummer = EZA, sonst BDA. Storno nur für bekannte Auftragsnummern.
  if (p === "/dhl-pickup/orders" && req.method === "POST") {
    if (!req.headers["dhl-api-key"]) return [401, { title: "Unauthorized", detail: "API-Key fehlt" }];
    const b = parsed();
    abholungen.push({ dienst: "dhl", body: b });
    if (b.pickupLocation?.pickupAddress?.postalCode === "00000") return [422, [{ errorCode: "PU-422", title: "Ungültige Abholadresse", detail: "Die Postleitzahl ist unbekannt." }]];
    const pakete = (b.shipmentDetails?.shipments ?? []).filter((x) => x.transportationType === "PAKET").length;
    const orderID = randomUUID().replace(/-/g, "");
    const pickupType = pakete > 10 ? "EMA" : b.customerDetails?.billingNumber ? "EZA" : "BDA";
    dhlAbholAuftraege.add(orderID);
    return [201, { confirmation: { type: "ORDERPICKUP", value: { orderID, pickupDate: b.pickupDetails?.pickupDate?.value, freeOfCharge: pickupType !== "EZA", pickupType, confirmedShipments: (b.shipmentDetails?.shipments ?? []).map((x) => ({ transportationType: x.transportationType })) } } }];
  }
  if (p === "/dhl-pickup/orders" && req.method === "DELETE") {
    const id = url.searchParams.get("orderID") ?? "";
    abholungen.push({ dienst: "dhl", storno: id });
    if (!dhlAbholAuftraege.delete(id)) return json({ confirmedCancellations: [], failedCancellations: [{ orderID: id, message: "Auftrag unbekannt" }] });
    return json({ confirmedCancellations: [{ orderID: id, orderState: "STORNIERT" }], failedCancellations: [] });
  }
  // UPS (OAuth + Pickup v2409) – erfundene Regeln: Secret „falsch“ = 401, PLZ „00000“ = 400; PRN fortlaufend.
  if (p === "/ups/security/v1/oauth/token" && req.method === "POST") {
    const [, secret] = Buffer.from(String(req.headers.authorization ?? "").replace(/^Basic /, ""), "base64").toString().split(":");
    if (!secret || secret === "falsch") return [401, { response: { errors: [{ code: "10401", message: "ClientId is Invalid" }] } }];
    return json({ token_type: "Bearer", access_token: "test-ups-token", expires_in: "14399", status: "approved" });
  }
  if (p === "/ups/api/pickupcreation/v2409/pickup" && req.method === "POST") {
    if (req.headers.authorization !== "Bearer test-ups-token") return [401, { response: { errors: [{ code: "250002", message: "Invalid Authentication Information." }] } }];
    const b = parsed();
    abholungen.push({ dienst: "ups", body: b });
    if (b.PickupCreationRequest?.PickupAddress?.PostalCode === "00000") return [400, { response: { errors: [{ code: "9510113", message: "Die Postleitzahl ist ungültig." }] } }];
    const prn = `2929TEST${String(++upsPrn).padStart(3, "0")}`;
    upsAbholAuftraege.add(prn);
    return json({ PickupCreationResponse: { Response: { ResponseStatus: { Code: "1", Description: "Success" } }, PRN: prn } });
  }
  if (p === "/ups/api/shipments/v2409/pickup/02" && req.method === "DELETE") {
    const prn = String(req.headers.prn ?? "");
    abholungen.push({ dienst: "ups", storno: prn });
    if (!upsAbholAuftraege.delete(prn)) return [400, { response: { errors: [{ code: "9510151", message: "Keine Abholung zu dieser PRN." }] } }];
    return json({ PickupCancelResponse: { Response: { ResponseStatus: { Code: "1", Description: "Success" } }, PickupType: "01" } });
  }
  // DHL Paket (Labels)
  // Erfundene Prüfregeln: PLZ „00000“ ungültig (abgelehnt), über 31,5 kg abgelehnt; 12345 erwartet „Musterstadt“
  // (sonst Hinweis mit Vorschlag). validate=true prüft nur (kein Label).
  if (p.startsWith("/dhl/") && p.endsWith("/orders") && req.method === "POST") {
    const items = [];
    let fehler = false;
    for (const s of parsed().shipments ?? []) {
      const c = s.consignee ?? {};
      const meldungen = [];
      if (c.postalCode === "00000") meldungen.push({ property: "consignee.postalCode", validationMessage: "Die Postleitzahl ist ungültig.", validationState: "Error" });
      if ((s.details?.weight?.value ?? 0) > 31.5) meldungen.push({ property: "details.weight", validationMessage: "Das Gewicht überschreitet das Höchstgewicht des Produkts.", validationState: "Error" });
      if (c.postalCode === "12345" && c.city && c.city !== "Musterstadt") meldungen.push({ property: "consignee.city", validationMessage: "Der Ort passt nicht zur Postleitzahl – Vorschlag: Musterstadt.", validationState: "Warning" });
      const err = meldungen.some((m) => m.validationState === "Error");
      fehler ||= err;
      if (err) items.push({ sstatus: { title: "Bad Request", statusCode: 400, detail: "Die Sendung ist nicht valide." }, validationMessages: meldungen });
      else if (url.searchParams.get("validate") === "true") items.push({ sstatus: { title: "OK", statusCode: 200 }, validationMessages: meldungen });
      else {
        const zusatz = [s.services?.visualCheckOfAge ? `Alterssicht ${s.services.visualCheckOfAge}` : "", s.services?.additionalInsurance ? `Versichert ${s.services.additionalInsurance.value} EUR` : ""].filter(Boolean).join(" ");
        items.push({ shipmentNo: String(++shipNo), sstatus: { statusCode: 200 }, validationMessages: meldungen, label: { b64: (await pdf([`DHL ${s.product} an ${c.name1 ?? c.name ?? "?"} ${s.details?.weight?.value ?? "?"} kg ${zusatz}`.trim()])).toString("base64") } });
      }
    }
    return fehler ? [400, { status: { title: "Bad Request", statusCode: 400, detail: "Fehlerhafte Sendung." }, items }] : json({ items });
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
    if (KONTO_TYPEN.has(r.typ)) return [200, Buffer.from(kontoBericht(r)), r.typ === "GET_V2_SELLER_PERFORMANCE_REPORT" ? "application/json" : "text/tab-separated-values; charset=utf-8"];
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
    if (r && (MARKT_TYPEN.has(r.typ) || KONTO_TYPEN.has(r.typ))) return json(rep[1] === "reports" ? { reportId: rep[2], reportType: r.typ, processingStatus: "DONE", reportDocumentId: rep[2] } : { reportDocumentId: rep[2], url: `${SELF}/amazon-doc/${rep[2]}`, ...(r.typ === "GET_SALES_AND_TRAFFIC_REPORT" ? { compressionAlgorithm: "GZIP" } : {}) });
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
// B28: „B0PFANNE…“ = Preisverlauf wie im Bauauftrag (Buy Box 79 €, vor 31–120 Tagen 57,99 € mit besserem Rang und
// „gekauft“-Verlauf), in IT nur 1 Angebot; „B0RANG…“ = ohne „x+ gekauft“, nur Keepa-Rang-Drops (30 T).
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
      const pfanne = asin.startsWith("B0PFANNE");
      const einzeln = pfanne && land === KEEPA_LAND[8];
      for (let d = 365; d >= 0; d -= 5) {
        const t = km(now - d * 86400000 - 3600000);
        const phase = Math.floor(d / 5) % 6;
        if (pfanne) {
          const billig = d > 30 && d <= 120;
          const preis = Math.round(((billig ? 5799 : 7900) * land.basis) / 1999);
          amazon.push(t, preis);
          bb.push(t, preis, 0);
          rang.push(t, billig ? 800 : 2500 + phase * 100);
          angebote.push(t, einzeln ? 1 : 6);
          fba.push(t, einzeln ? 1 : 4);
          fbm.push(t, einzeln ? 0 : 2);
        } else {
          amazon.push(t, phase === 4 ? -1 : land.basis + phase * 50);
          bb.push(t, land.basis - 50 + phase * 40, phase === 5 ? 299 : 0);
          rang.push(t, 2000 + phase * 500);
          angebote.push(t, 10 + phase);
          fba.push(t, 6 + phase);
          fbm.push(t, 4);
        }
        bbHist.push(String(t), phase === 4 ? "A1TESTFBA00001" : phase === 5 ? "A2TESTFBM00002" : land.amazon);
      }
      Object.assign(csv, { 0: amazon, 3: rang, 11: angebote, 18: bb, 34: fba, 35: fbm });
      return {
        asin,
        title: `Testprodukt ${asin} (erfunden)`,
        csv: Array.from({ length: 36 }, (_, i) => csv[i] ?? null),
        availabilityAmazon: 0,
        monthlySold: asin.startsWith("B0RANG") ? 0 : pfanne && land === KEEPA_LAND[3] ? 100 : land.verkauft,
        ...(pfanne && land === KEEPA_LAND[3] ? { monthlySoldHistory: [km(now - 130 * 86400000), 100, km(now - 115 * 86400000), 300, km(now - 28 * 86400000), 100] } : {}),
        lastUpdate: km(now - (asin.startsWith("B0ALTFEST") || (asin.startsWith("B0ALT") && url.searchParams.get("update") === null) ? 21 * 86400000 : 3600000)),
        stats: { ...(asin.startsWith("B0RANG") ? { salesRankDrops30: 12 } : {}), outOfStockPercentage30: [17], outOfStockPercentage90: [17], outOfStockPercentageInInterval: [17], buyBoxStats: { [land.amazon]: { percentageWon: 67, isFBA: true }, A1TESTFBA00001: { percentageWon: 17, isFBA: true }, A2TESTFBM00002: { percentageWon: 16, isFBA: false } } },
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
// Amazon-Berichte 1–4 (erfunden): Kontozustand (JSON), gestrandet/gesperrt, Langzeitlager, Inbound-Mängel, USt.
const KONTO_TYPEN = new Set(["GET_V2_SELLER_PERFORMANCE_REPORT", "GET_STRANDED_INVENTORY_UI_DATA", "GET_MERCHANTS_LISTINGS_FYP_REPORT", "GET_FBA_FBA_LONGTERM_STORAGE_FEE_CHARGES_DATA", "GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA", "GET_VAT_TRANSACTION_DATA"]);
function kontoBericht(r) {
  const tsv = (head, rows) => [head, ...rows].map((x) => x.join("\t")).join("\n") + "\n";
  const tag = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  if (r.typ === "GET_V2_SELLER_PERFORMANCE_REPORT") {
    const gut = (rate, ziel) => ({ status: "GOOD", rate, targetValue: ziel, targetCondition: "LESS_THAN" });
    const verstoesse = (ip) => ({ receivedIntellectualPropertyComplaints: { status: ip ? "POOR" : "GOOD", defectsCount: ip, targetValue: 0 }, listingPolicyViolations: { status: "GOOD", defectsCount: 0, targetValue: 0 }, productAuthenticityCustomerComplaints: { status: "GOOD", defectsCount: 0, targetValue: 0 } });
    return JSON.stringify({
      performanceMetrics: [
        { marketplaceId: "A1PA6795UKMFR9", accountHealthRating: { ahrStatus: "GOOD", ahrScore: 230 }, orderDefectRate: { afn: gut(0.002, 0.01), mfn: gut(0.004, 0.01) }, lateShipmentRate: gut(0.01, 0.04), preFulfillmentCancellationRate: gut(0, 0.025), validTrackingRate: { status: "GOOD", rate: 0.99, targetValue: 0.95 }, ...verstoesse(1) },
        { marketplaceId: "A13V1IB3VIYZZH", accountHealthRating: { ahrStatus: "GREAT", ahrScore: 320 }, orderDefectRate: { afn: gut(0, 0.01), mfn: gut(0, 0.01) }, lateShipmentRate: gut(0, 0.04), ...verstoesse(0) },
      ],
    });
  }
  if (r.typ === "GET_STRANDED_INVENTORY_UI_DATA")
    return tsv(["primary-action", "date-stranded", "Date-to-take-auto-removal", "status-primary", "status-secondary", "error-message", "stranded-reason", "asin", "sku", "fnsku", "product-name", "condition", "fulfilled-by", "fulfillable-qty", "your-price", "unfulfillable-qty", "reserved-quantity", "inbound-shipped-qty"], [
      ["Relist", tag(-12), tag(5), "Stranded", "", "Kein aktives Angebot", "No listing exists", "B0TEST0001", "TEST-SOCKEN", "X00TEST0001", "Testsocken (erfunden)", "New", "Amazon", "5", "9.99", "0", "0", "0"],
      ["Fix listing", tag(-3), "", "Stranded", "", "Angebot unterdrückt", "Listing suppressed", "B0TESTSTR2", "TEST-OHNE-EK-STR", "X00TESTSTR2", "Teststrand ohne EK (erfunden)", "New", "Amazon", "2", "", "1", "0", "0"],
    ]);
  if (r.typ === "GET_MERCHANTS_LISTINGS_FYP_REPORT")
    return tsv(["Status", "Reason", "SKU", "ASIN", "Product name", "Condition", "Status Change Date", "Issue Description"], [["Search Suppressed", "Missing information", "TEST-TASSE", "B0TEST0002", "Testtasse (erfunden)", "New", tag(-2), "Hauptbild fehlt"]]);
  if (r.typ === "GET_FBA_FBA_LONGTERM_STORAGE_FEE_CHARGES_DATA")
    return tsv(["snapshot-date", "sku", "fnsku", "asin", "product-name", "condition", "qty-charged", "per-unit-volume", "currency", "amount-charged", "volume-unit", "country", "surcharge-age-tier", "rate-surcharge"], [[tag(-10), "TEST-SOCKEN", "X00TEST0001", "B0TEST0001", "Testsocken (erfunden)", "New", "4", "0.5", "EUR", "3.40", "liters", "DE", "271-365", "1.70"]]);
  if (r.typ === "GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA")
    return tsv(["date", "problem-type", "shipment-id", "merchant-sku", "fnsku", "asin", "product-name", "problem-quantity", "expected-quantity", "received-quantity", "performance-measurement-unit", "coaching-level", "fee-type", "currency", "fee-total"], [[tag(-6), "Unplanned service: Labeling", "FBA15TESTINB", "TEST-SOCKEN", "X00TEST0001", "B0TEST0001", "Testsocken (erfunden)", "6", "10", "10", "Units", "Warning", "Unplanned prep service fee", "EUR", "1.20"]]);
  if (r.typ === "GET_VAT_TRANSACTION_DATA") {
    const kopf = ["UNIQUE_ACCOUNT_IDENTIFIER", "ACTIVITY_PERIOD", "SALES_CHANNEL", "MARKETPLACE", "PROGRAM_TYPE", "TRANSACTION_TYPE", "TRANSACTION_EVENT_ID", "TRANSACTION_COMPLETE_DATE", "SELLER_SKU", "ASIN", "QTY", "DEPARTURE_COUNTRY", "ARRIVAL_COUNTRY", "TAXABLE_JURISDICTION", "TAX_REPORTING_SCHEME", "TOTAL_ACTIVITY_VALUE_AMT_VAT_EXCL", "TOTAL_ACTIVITY_VALUE_VAT_AMT", "TOTAL_ACTIVITY_VALUE_AMT_VAT_INCL", "PRICE_OF_ITEMS_VAT_RATE_PERCENT", "TRANSACTION_CURRENCY_CODE"];
    const d = (r.von ?? new Date().toISOString()).slice(0, 10);
    const dm = `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
    const per = `${d.slice(0, 4)}-${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][Number(d.slice(5, 7)) - 1]}`;
    return tsv(kopf, [
      ["A1", per, "AFN", "amazon.de", "REGULAR", "SALE", "302-0000000-0000101", dm, "TEST-SOCKEN", "B0TEST0001", "2", "DE", "DE", "DE", "REGULAR", "16.80", "3.19", "19.99", "0.19", "EUR"],
      ["A1", per, "AFN", "amazon.fr", "REGULAR", "SALE", "302-0000000-0000102", dm, "TEST-SOCKEN", "B0TEST0001", "1", "DE", "FR", "FR", "UNION-OSS", "8.33", "1.67", "10.00", "0.20", "EUR"],
    ]);
  }
  return "";
}
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
// B31.2: BQool-Ist je Land (Testnachbau, erfundene SKUs): die Export-Seite liefert den Stand als Repricing-Datei
// („Download File“ → „Full Template“), ein Upload übernimmt die Zeilen der Datei – SKUs mit „FEHLER“ lehnt BQool ab.
// POST /__bqool { ist: { DE: [{ sku, regel, min, max, cost, enable }] }, zuruecksetzen } setzt den Stand, GET liest ihn.
const bqoolIst = {};
// B33: Gebühren je SKU in der Liste („Referral Fee“, „FBA Fee“) und Upload-Verlauf mit „View Processing Report“.
// POST /__bqool { gebuehren: { DE: { SKU: { fba, referral } } }, verlauf: { DE: [{ zeit, datei, fehler: [{ zeile, sku, text }] }] } }
const bqoolGeb = {};
const bqoolVerlauf = {};
const BQ_LAND = { amazonde: "DE", amazonfr: "FR", amazonit: "IT", amazones: "ES" };
const BQ_ERSTE = "FileType = repricing,  Version = 1.2.5 (Please do not edit this line or this will result in error when uploading)";
const BQ_KOPF = ["Channel", "SellerSKU", "Cost", "Additional Cost", "Rule Name", "Min Price", "Max Price", "Shipping", "add-delete", "Group", "Enable Repricing"];
const bqZahl = (n) => (n === null || n === undefined || n === "" ? "" : Number(n).toFixed(2));
function bqoolStandDatei(land) {
  const zeilen = [...(bqoolIst[land] ?? new Map()).entries()].map(([sku, z]) => [`Amazon ${land}`, sku, bqZahl(z.cost), "", z.regel ?? "", bqZahl(z.min), bqZahl(z.max), "0.00", "", "", z.enable ?? "1"].join("\t"));
  return [BQ_ERSTE + "\t".repeat(10), BQ_KOPF.join("\t"), ...zeilen].join("\r\n") + "\r\n";
}
/** B33.6: „Download listings“ – Liste der aktiven Angebote als CSV (wie BQool: Preise, Min/Max, Regel, Gebühren). */
function bqoolListeDatei(land) {
  const kopf = ["SKU", "ASIN", "Product Name", "Your Price", "Min Price", "Max Price", "Cost", "Rule Name", "Repricing Status", "Buy Box Price", "Referral Fee", "FBA Fee"];
  const g = bqoolGeb[land] ?? {};
  const zeilen = [...(bqoolIst[land] ?? new Map()).entries()].map(([sku, z]) => {
    const preis = z.preis ?? z.min;
    const f = g[sku] ?? {};
    return [sku, z.asin ?? "", `Testartikel ${sku}`, bqZahl(preis), bqZahl(z.min), bqZahl(z.max), bqZahl(z.cost), z.regel ?? "", z.enable === "0" ? "Paused" : "Active", bqZahl(z.buybox ?? ""), bqZahl(f.referral ?? ""), bqZahl(f.fba ?? "")].join(",");
  });
  return [kopf.join(","), ...zeilen].join("\r\n") + "\r\n";
}
function bqoolUebernehmen(land, text) {
  const zeilen = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const kopf = (zeilen[1] ?? "").split("\t").map((h) => h.trim().toLowerCase());
  const i = (n) => kopf.indexOf(n.toLowerCase());
  const stand = bqoolIst[land] ?? (bqoolIst[land] = new Map());
  let n = 0;
  const fehler = [];
  zeilen.slice(2).forEach((z, k) => {
    const c = z.split("\t");
    const sku = (c[i("SellerSKU")] ?? "").trim();
    if (!sku) return;
    if (sku.includes("FEHLER")) return fehler.push({ zeile: k + 3, sku });
    stand.set(sku, { regel: c[i("Rule Name")] ?? "", min: Number(c[i("Min Price")]), max: Number(c[i("Max Price")]), cost: Number(c[i("Cost")]), enable: c[i("Enable Repricing")] ?? "1" });
    n++;
  });
  return { n, fehler };
}
// B31.5: BQool-Berichte je Marktplatz – „Listing Performance“ (Zeitraum wählen, „Download“) und „Daily Sales“.
// Inhalt per POST /__bqool { leistung: { DE: "<TSV>" }, tages: { DE: "<TSV>" } }; ohne Vorgabe aus dem Ist erzeugt.
const bqoolBerichte = { leistung: {}, tages: {} };
const bqoolBerichtAbrufe = [];
const LP_KOPF = ["Products", "Rules", "Sales", "Sales %", "Orders", "Units Ordered", "Est. Profit", "Buy Box Wins", "Lowest Price Win %", "At Min %", "At Max %", "Below Min %", "Avg Offers", "Avg Position", "Reprice", "Price Up", "Price Down", "Price Changes", "Compete Amazon %", "Buy Box Lost Amazon %", "Buy Box Lost FBA %", "Buy Box Lost FBM %"];
function bqoolLeistungDatei(land) {
  if (bqoolBerichte.leistung[land]) return bqoolBerichte.leistung[land];
  const zeilen = [...(bqoolIst[land] ?? new Map()).entries()].map(([sku, z]) => [`Testartikel ${sku}\nSKU: ${sku}`, z.regel ?? "-", "100,00 €", "10,00%", "2", "2", "10,00 €", "50,00%", "10%", "0%", "0%", "0%", "3", "1", "4", "2", "2", "5,00 €", "0%", "0%", "0%", "0%"].map((v) => (v.includes("\n") ? `"${v}"` : v)).join("\t"));
  return "\uFEFF" + [LP_KOPF.join("\t"), ...zeilen].join("\r\n") + "\r\n";
}
function bqoolTagesDatei(land) {
  if (bqoolBerichte.tages[land]) return bqoolBerichte.tages[land];
  const heute = new Date();
  const tage = Array.from({ length: 7 }, (_, i) => new Date(heute.getTime() - (7 - i) * 86_400_000).toISOString().slice(0, 10));
  return "\uFEFF" + ["Date\tSales\tSales (FBA)\tSales (FBM)\tOrders\tUnits Ordered\tEst. Profit\tBuy Box Wins", ...tage.map((t) => `${t}\t100,00 €\t100,00 €\t0,00 €\t1\t1\t10,00 €\t50,00%`)].join("\r\n") + "\r\n";
}
const multipartFeld = (body, name) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(body)?.[1] ?? null;
const multipartDatei = (body) => /filename="[^"]*"\r\nContent-Type:[^\r\n]*\r\n\r\n([\s\S]*?)\r\n--/.exec(body)?.[1] ?? "";
function webNachbau(req, res, url, body) {
  const [, dienst, seite] = /^\/web-([a-z]+)\/([a-z]+)/.exec(url.pathname) ?? [];
  const html = (code, inhalt, extra = {}) => {
    res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", ...extra });
    res.end(`<!doctype html><html><body><h1>${dienst} (Testnachbau)</h1>${inhalt}</body></html>`);
  };
  const angemeldet = (req.headers.cookie ?? "").includes(`sid=ok-${dienst}`);
  // B24: Varianten – Browser-Prüfung (Cloudflare), Seite ohne Formular, Cookie-Banner + andere Feldnamen, Felder ohne
  // erkennbare Namen (nur mit eigenem Selektor zu finden).
  if (dienst === "captcha") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end('<!doctype html><html><head><title>Just a moment...</title></head><body><div class="cf-turnstile"></div><p>Checking your browser before accessing.</p></body></html>');
  }
  if (dienst === "leer" && seite === "login") return html(200, "<p>Wartungsarbeiten – bitte später wieder versuchen.</p>");
  if (dienst === "bqoolneu" && seite === "login" && req.method !== "POST")
    return html(200, '<div id="cookie" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9"><div style="background:#fff;padding:20px;margin:120px auto;width:320px">Wir verwenden Cookies. <button type="button" onclick="document.getElementById(\'cookie\').remove()">Alle akzeptieren</button></div></div><form method="post"><label>E-Mail-Adresse <input type="text" name="login_id" placeholder="Ihre E-Mail"></label><label>Kennwort <input type="password" name="pw"></label><button type="button" onclick="this.form.submit()">Log in</button></form>');
  if (dienst === "sonder" && seite === "login" && req.method !== "POST")
    return html(200, '<form method="post"><input name="kennung"><input type="password" name="geheim"><button type="submit">Los</button></form>');
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
  // B31.2: Export-Seite je Marktplatz – „Download File“ öffnet ein Menü, „Full Template“ lädt die Repricing-Datei.
  const exportLand = /\/export\/([a-z]+)/.exec(url.pathname)?.[1] ?? null;
  if (dienst === "bqool" && seite === "export" && exportLand) {
    const l = BQ_LAND[exportLand];
    if (!l) return html(200, "<p>Keine Exporte für diesen Marktplatz.</p>");
    if (url.pathname.endsWith("/datei")) {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="Repricing_Central_${exportLand}_Full_Template.txt"` });
      return res.end(bqoolStandDatei(l));
    }
    return html(200, `<main><h2>Repricing Central – Amazon ${l}</h2><button type="button" onclick="document.getElementById('menu').style.display='block'">Download File</button><div id="menu" style="display:none"><a href="/web-bqool/export/${exportLand}/datei" download>Full Template</a> <a href="#">Basic Template</a></div></main>`);
  }
  // B33.6: Listen-Seite je Marktplatz (…/repricing/amazonde) – „Download“ öffnet ein Menü, „Download listings“ lädt die Liste.
  const listeLand = /^\/web-bqool\/repricing\/([a-z]+)/.exec(url.pathname)?.[1] ?? null;
  if (dienst === "bqool" && seite === "repricing" && listeLand) {
    const l = BQ_LAND[listeLand];
    if (!l) return html(200, "<p>Keine Angebote für diesen Marktplatz.</p>");
    if (url.pathname.endsWith("/listings")) {
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="Active_Listings_${listeLand}.csv"` });
      return res.end(bqoolListeDatei(l));
    }
    return html(200, `<main><h2>Listings – Active Listings – Amazon ${l}</h2><button type="button" onclick="document.getElementById('menu').style.display='block'">Download</button><div id="menu" style="display:none"><a href="/web-bqool/repricing/${listeLand}/listings" download>Download listings</a> <a href="#">Download template</a></div></main>`);
  }
  // B31.5: Berichtsseiten je Marktplatz – Auswahl „Last 30 days“/„Last 7 days“, Link „Download“ lädt die Datei.
  const bericht = /\/(leistung|tages)\/([a-z]+)/.exec(url.pathname);
  if (dienst === "bqool" && bericht) {
    const [, art, slug] = bericht;
    const l = BQ_LAND[slug];
    if (!l) return html(200, "<p>Keine Berichte für diesen Marktplatz.</p>");
    const name = art === "leistung" ? "Listing_Performance" : "Daily_Sales";
    if (url.pathname.endsWith("/datei")) {
      const tage = url.searchParams.get("tage") ?? "30";
      bqoolBerichtAbrufe.push({ art, land: l, tage });
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${name}_${Date.now()}.txt"` });
      return res.end(art === "leistung" ? bqoolLeistungDatei(l) : bqoolTagesDatei(l));
    }
    const ziel = `/web-bqool/${art}/${slug}/datei`;
    return html(200, `<main><h2>${art === "leistung" ? "Listing Performance" : "Daily Sales"} – Amazon ${l}</h2><label>Zeitraum <select onchange="document.getElementById('dl').href='${ziel}?tage='+this.value"><option value="30">Last 30 days</option><option value="7">Last 7 days</option></select></label> <a id="dl" href="${ziel}?tage=30" download>Download</a></main>`);
  }
  // B23: Upload-Seite je Marktplatz (…/upload/amazonde, …/upload/amazonfr …); „kaputt“ = Upload wird abgelehnt.
  const land = /\/upload\/([a-z]+)/.exec(url.pathname)?.[1] ?? null;
  if (seite === "upload" && req.method === "POST") {
    const name = /filename="([^"]+)"/.exec(body)?.[1] ?? "?";
    // Befund 02.11.: Upload per Skript (wie BQool) – „toast“ = Hinweis nur 0,7 s sichtbar, „still“ = gar keine Meldung,
    // „ajaxfehler“ = Antwort {success:false}.
    if (req.headers["x-ajax"]) {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (land === "ajaxfehler") return res.end(JSON.stringify({ success: false, message: `Invalid header line in ${name}` }));
      webUploads.push({ dienst, name, land, groesse: body.length, at: new Date().toISOString() });
      return res.end(JSON.stringify({ success: true, code: 0 }));
    }
    if (land === "kaputt") return html(200, `<p>Import fehlgeschlagen: ${name} ungültig</p>`);
    // B31.2: BQool – Dateityp muss „Repricing Central File“ sein; Zeilen werden übernommen (Ist), Fehlerzeilen gemeldet.
    const typ = multipartFeld(body, "typ");
    if (dienst === "bqool" && typ !== null && typ !== "repricing") return html(200, `<p>Import fehlgeschlagen: falscher Dateityp (${typ})</p>`);
    webUploads.push({ dienst, name, land, groesse: body.length, at: new Date().toISOString(), ...(typ !== null ? { typ } : {}) });
    if (dienst === "bqool" && BQ_LAND[land]) {
      const r = bqoolUebernehmen(BQ_LAND[land], multipartDatei(body));
      return html(200, `<p>Import erfolgreich: ${name} übernommen – ${r.n} Zeilen übernommen, ${r.fehler.length} Fehler</p>${r.fehler.map((f) => `<p>Zeile ${f.zeile}: SKU ${f.sku} – Invalid Min Price</p>`).join("")}`);
    }
    return html(200, `<p>Import erfolgreich: ${name} übernommen</p>`);
  }
  if (["toast", "still", "ajaxfehler", "nichts"].includes(land ?? "")) {
    // Feste Verlaufstabelle mit „Completed“/„Failed“ – darf weder als Erfolg noch als Fehler zählen.
    const verlauf = '<table><tr><td>alt_1.txt</td><td>Completed</td></tr><tr><td>alt_2.txt</td><td>Failed</td></tr></table>';
    if (land === "nichts") return html(200, `<form><input type="file" name="datei"><button type="button">Hochladen</button></form>${verlauf}`);
    const toast = land === "toast" ? 'const t = document.createElement("div"); t.textContent = "Your file has been submitted."; document.body.appendChild(t); setTimeout(() => t.remove(), 700);' : "";
    return html(200, `<form id="f"><input type="file" name="datei"><button type="submit">Upload</button></form>${verlauf}<script>
document.getElementById("f").addEventListener("submit", async (e) => { e.preventDefault(); const r = await fetch(location.href, { method: "POST", body: new FormData(e.target), headers: { "X-Ajax": "1" } }); await r.json(); ${toast} });
</script>`);
  }
  // B33.6: Processing Report eines früheren Uploads (Upload-Verlauf je Marktplatz)
  const berichtNr = /\/upload\/[a-z]+\/bericht\/(\d+)/.exec(url.pathname)?.[1];
  if (dienst === "bqool" && berichtNr !== undefined && BQ_LAND[land]) {
    const v = (bqoolVerlauf[BQ_LAND[land]] ?? [])[Number(berichtNr)];
    if (!v) return html(404, "<p>Bericht nicht gefunden.</p>");
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end(["Row\tSellerSKU\tStatus\tMessage", ...(v.fehler ?? []).map((f) => `${f.zeile}\t${f.sku}\tError\t${f.text}`)].join("\r\n") + "\r\n");
  }
  // B31.2: BQool fragt nach dem Dateityp (Standard „Inventory File“ – die Automatik muss „Repricing Central File“ wählen).
  if (dienst === "bqool") {
    const verlauf = BQ_LAND[land] ? (bqoolVerlauf[BQ_LAND[land]] ?? []) : [];
    const tabelle = verlauf.length ? `<h3>Upload History</h3><table>${verlauf.map((v, i) => `<tr><td>${v.zeit}</td><td>${v.datei}</td><td>Completed</td><td>${(v.fehler ?? []).length} Error</td><td><a href="/web-bqool/upload/${land}/bericht/${i}">View Processing Report</a></td></tr>`).join("")}</table>` : "";
    return html(200, `<form method="post" enctype="multipart/form-data"><label>Dateityp <select name="typ"><option value="inventory">Inventory File</option><option value="repricing">Repricing Central File</option></select></label><input type="file" name="datei"><button type="submit">Hochladen</button></form>${tabelle}`);
  }
  return html(200, '<form method="post" enctype="multipart/form-data"><input type="file" name="datei"><button type="submit">Hochladen</button></form>');
}

// ---------------------------------------------------------------------------------------------------------
// ArbitrageOne-Nachbau: Export-Seite mit Karten und Download-Knöpfen (Einkäufe mit Zeitraum-Dialog, AccountOne alt + NEU,
// „Einkäufe“ auch in der Navigation – die Automatik muss die Karte im Hauptbereich finden). Inhalte erfunden; ein Test
// kann sie über POST /__ao setzen ({ dateien: { key: text }, ohne: [key] }). Downloads stehen unter GET /__ao.
const AO_STANDARD = {
  einkaeufe: "ASIN;SKU;Kaufdatum;Menge;EK netto;Lieferant;Rechnungsnummer\nB0AOTEST01;AOT_TEST_01;01.11.2026;2;10,00;Testshop;RE-T1\n",
  lagerbestand: "ASIN;SKU;Bestand;EK netto;Lagerwert\nB0AOTEST01;AOT_TEST_01;2;10,00;20,00\n",
  sellerboard: "ASIN;SKU;Cost\nB0AOTEST01;AOT_TEST_01;10,00\n",
  bqool: "FileType = repricing,  Version = 1.2.5 (Please do not edit this line or this will result in error when uploading)\t\t\t\t\t\t\t\t\t\t\nChannel\tSellerSKU\tCost\tAdditional Cost\tRule Name\tMin Price\tMax Price\tShipping\tadd-delete\tGroup\tEnable Repricing\nAmazon DE\tAOT_TEST_01\t11.90\t\tia\t19.99\t39.98\t0.00\t\t\t1\n",
  reimbursement: "approval-date\treimbursement-id\tcase-id\tamazon-order-id\treason\tsku\tfnsku\tasin\tproduct-name\tcondition\tcurrency-unit\tamount-per-unit\tamount-total\tquantity-reimbursed-cash\tquantity-reimbursed-inventory\tquantity-reimbursed-total\n2026-10-30\tAOTR1\t\t\tLost_Warehouse\tAOT_TEST_01\tX00AOTEST1\tB0AOTEST01\tTestartikel\tNew\tEUR\t9.00\t9.00\t1\t0\t1\n",
  accountone: "marketplace_article_nr;article_nr;ek_netto_euro\nB0AOTEST01;AOT_TEST_01;10,00\n",
};
const AO_NAMEN = { einkaeufe: "Einkaeufe.csv", lagerbestand: "Lagerbestand_Stichtag.csv", sellerboard: "ArbitrageOne_Sellerboard_Export.csv", bqool: "ArbitrageOne_BQool_Export.txt", reimbursement: "Inventory_Reimbursement.txt", accountone: "AccountOne_COG_NEU.csv" };
// B27: je Export ein Verhalten („async“ = Export wird erst erstellt und steht nach 3 s in „Meine Exporte“, „dialogfelder“ =
// Dialog mit Marktplatz + Zeitraum als Pflichtfelder, „nichts“ = Knopf ohne Reaktion), eigene Dateinamen und Binärdateien
// (base64, z. B. .xlsx).
const ao = { dateien: { ...AO_STANDARD }, ohne: new Set(), downloads: [], modus: {}, namen: {}, binaer: {}, angefordert: {} };
function aoNachbau(req, res, url, body) {
  const seite = /^\/web-arbitrageone\/([a-z]+)/.exec(url.pathname)?.[1];
  if (seite !== "export" && seite !== "datei" && seite !== "anfordern") return false;
  if (!(req.headers.cookie ?? "").includes("sid=ok-arbitrageone")) {
    res.writeHead(302, { Location: "/web-arbitrageone/login" });
    res.end();
    return true;
  }
  if (seite === "datei") {
    const key = url.pathname.split("/")[3];
    if (!(key in ao.dateien) || ao.ohne.has(key)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("nicht gefunden");
      return true;
    }
    ao.downloads.push({ key, at: new Date().toISOString() });
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${ao.namen[key] ?? AO_NAMEN[key]}"` });
    res.end(ao.binaer[key] ? Buffer.from(ao.binaer[key], "base64") : ao.dateien[key]);
    return true;
  }
  if (seite === "anfordern") {
    ao.angefordert[url.pathname.split("/")[3]] = Date.now();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"ok":true}');
    return true;
  }
  const link = (key, text = "Download") => `<a href="/web-arbitrageone/datei/${key}">${text}</a>`;
  const knopfFuer = (key, normal) => {
    const m = ao.modus[key];
    if (m === "nichts") return '<button type="button">Exportieren</button>';
    if (m === "async") return `<button type="button" onclick="fetch('/web-arbitrageone/anfordern/${key}',{method:'POST'}).then(()=>{document.getElementById('meldung').textContent='Export wird erstellt – die Datei steht gleich unter „Meine Exporte“.'})">Exportieren</button>`;
    if (m === "dialogfelder") return `<button type="button" onclick="document.getElementById('dlg-${key}').showModal()">Exportieren</button>`;
    return normal;
  };
  const karte = (key, titel, knopf) => (ao.ohne.has(key) ? "" : `<section class="card"><h3>${titel}</h3><p>Export für ${titel}</p>${knopfFuer(key, knopf)}</section>`);
  const dialoge = Object.entries(ao.modus)
    .filter(([, m]) => m === "dialogfelder")
    .map(([key]) => `<dialog id="dlg-${key}"><p>Zeitraum und Marktplatz wählen</p><select id="mp-${key}"><option value="">Bitte wählen</option><option value="de">Amazon DE</option><option value="alle">Alle Marktplätze</option></select><input type="date" id="von-${key}"><input type="date" id="bis-${key}"><p id="fehler-${key}"></p><button type="button" onclick="if(document.getElementById('mp-${key}').value==='alle'&&document.getElementById('von-${key}').value&&document.getElementById('bis-${key}').value){location.href='/web-arbitrageone/datei/${key}'}else{document.getElementById('fehler-${key}').textContent='Bitte alle Felder ausfüllen'}">Exportieren</button></dialog>`)
    .join("");
  // „Meine Exporte“: angeforderte Exporte sind nach 3 s fertig
  const liste = Object.entries(ao.angefordert)
    .map(([key, at]) => `<tr><td>${ao.namen[key] ?? AO_NAMEN[key]}</td><td>${Date.now() - at > 3000 ? link(key) : "in Bearbeitung"}</td></tr>`)
    .join("");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><body><nav><a href="/einkaeufe">Einkäufe</a> <a href="/lager">Lagerbestand</a></nav><main><h1>Export (Testnachbau)</h1>
${karte("einkaeufe", "Einkäufe", '<button type="button" onclick="document.getElementById(\'dlg\').showModal()">Exportieren</button>')}
<dialog id="dlg"><p>Zeitraum wählen</p>${link("einkaeufe", "Herunterladen")}</dialog>
${karte("lagerbestand", "Lagerbestand (Stichtag)", link("lagerbestand"))}
${karte("sellerboard", "Sellerboard", link("sellerboard"))}
${karte("stk", "STK", '<a href="/web-arbitrageone/datei/stk">Download</a>')}
${karte("bqool", "BQool", link("bqool"))}
${karte("reimbursement", "Inventory Reimbursement", link("reimbursement"))}
<section class="card"><h3>AccountOne COG</h3><a href="/web-arbitrageone/datei/accountone-alt">Download</a></section>
${karte("accountone", "AccountOne COG (NEU)", link("accountone"))}
<p id="meldung"></p>${dialoge}
<section><h2>Meine Exporte</h2><table>${liste}</table></section>
</main></body></html>`);
  return true;
}

const dienstOf = (p) => (p.startsWith("/elevenlabs") ? "ElevenLabs" : p.startsWith("/openai") ? "OpenAI" : p.startsWith("/youtube") ? "YouTube" : p.startsWith("/apify") ? "Apify" : p.startsWith("/places") ? "Google Places" : p.startsWith("/leadweb") ? "Firmenwebsite (Impressum)" : p.startsWith("/letterxpress") ? "LetterXpress" : p.startsWith("/ebrief") ? "eBrief" : p.startsWith("/drive") || p.startsWith("/google-oauth") ? "Google Drive" : p.startsWith("/anthropic") ? "Claude" : p.startsWith("/im") ? "Deutsche Post" : p.startsWith("/dhl-track") ? "DHL Verfolgung" : p.startsWith("/dhl-pickup") ? "DHL Abholung" : p.startsWith("/ups") ? "UPS" : p.startsWith("/dhl") ? "DHL Paket" : p.startsWith("/amazon") ? "Amazon" : p.startsWith("/ebay") ? "eBay" : p.startsWith("/temu") ? "Temu" : p.startsWith("/keepa") ? "Keepa" : p.startsWith("/ecb") ? "EZB" : p.startsWith("/vies") ? "VIES" : p.startsWith("/discord") ? "Discord" : p.startsWith("/gdocs") ? "Google Docs" : p.startsWith("/lexoffice") ? "Lexoffice" : p.startsWith("/asana") ? "Asana" : "?");

http
  .createServer(async (req, res) => {
    // Rohdaten (Binär-Uploads wie Videos nach Drive) und als Text für die JSON-Nachbauten
    const teile = [];
    for await (const c of req) teile.push(c);
    const roh = Buffer.concat(teile);
    const body = roh.toString("utf8");
    const url = new URL(req.url, "http://x");
    const send = (code, data, type = "application/json") => {
      res.writeHead(code, { "Content-Type": type, "request-id": "req_test" });
      res.end(Buffer.isBuffer(data) || typeof data === "string" ? data : JSON.stringify(data));
    };
    if (url.pathname === "/__log") return send(200, log);
    if (url.pathname === "/__abholung") return send(200, abholungen);
    if (url.pathname === "/__web") return send(200, webUploads);
    if (url.pathname === "/__bqool" && req.method === "POST") {
      const b = JSON.parse(body || "{}");
      if (b.zuruecksetzen) {
        for (const k of Object.keys(bqoolIst)) delete bqoolIst[k];
        for (const k of Object.keys(bqoolGeb)) delete bqoolGeb[k];
        for (const k of Object.keys(bqoolVerlauf)) delete bqoolVerlauf[k];
        bqoolBerichte.leistung = {};
        bqoolBerichte.tages = {};
        bqoolBerichtAbrufe.length = 0;
      }
      Object.assign(bqoolBerichte.leistung, b.leistung ?? {});
      Object.assign(bqoolBerichte.tages, b.tages ?? {});
      for (const [land, rows] of Object.entries(b.ist ?? {})) bqoolIst[land] = new Map(rows.map((r) => [r.sku, { regel: r.regel, min: r.min, max: r.max, cost: r.cost, enable: r.enable ?? "1", ...(r.preis !== undefined ? { preis: r.preis } : {}), ...(r.buybox !== undefined ? { buybox: r.buybox } : {}), ...(r.asin ? { asin: r.asin } : {}) }]));
      Object.assign(bqoolGeb, b.gebuehren ?? {});
      Object.assign(bqoolVerlauf, b.verlauf ?? {});
      return send(200, { ok: true });
    }
    if (url.pathname === "/__bqool") return send(200, { ist: Object.fromEntries(Object.entries(bqoolIst).map(([l, m]) => [l, [...m.entries()].map(([sku, z]) => ({ sku, ...z }))])), berichtAbrufe: bqoolBerichtAbrufe });
    if (url.pathname === "/__ao" && req.method === "POST") {
      const b = JSON.parse(body || "{}");
      if (b.zuruecksetzen) Object.assign(ao, { dateien: { ...AO_STANDARD }, ohne: new Set(), downloads: [], modus: {}, namen: {}, binaer: {}, angefordert: {} });
      for (const [k, v] of Object.entries(b.dateien ?? {})) ao.dateien[k] = String(v);
      Object.assign(ao.modus, b.modus ?? {});
      Object.assign(ao.namen, b.namen ?? {});
      Object.assign(ao.binaer, b.binaer ?? {});
      if (Array.isArray(b.ohne)) ao.ohne = new Set(b.ohne);
      return send(200, { ok: true });
    }
    if (url.pathname === "/__ao") return send(200, { downloads: ao.downloads, ohne: [...ao.ohne] });
    // B35: Lead-Quellen einstellen (Kosten je Abfrage, Ende) und ablesen (Abbrüche, Places-Abrufe, Website-Abrufe mit User-Agent)
    if (url.pathname === "/__leads" && req.method === "POST") {
      const b = JSON.parse(body || "{}");
      if (b.zuruecksetzen) Object.assign(leadNb, { runs: new Map(), abbrueche: [], places: [], abrufe: [], cfg: { usdSchritt: 0.05, endUsd: 0.2, items: null } });
      Object.assign(leadNb.cfg, b.cfg ?? {});
      return send(200, { ok: true });
    }
    if (url.pathname === "/__leads") return send(200, { runs: [...leadNb.runs.values()].map((r) => ({ id: r.id, status: r.status, usd: r.usd, actor: r.actor })), abbrueche: leadNb.abbrueche, places: leadNb.places, abrufe: leadNb.abrufe });
    if (url.pathname.startsWith("/web-arbitrageone/") && aoNachbau(req, res, url, body)) return;
    if (url.pathname.startsWith("/web-")) return webNachbau(req, res, url, body);
    if (url.pathname === "/__ki") return send(200, ki);
    if (url.pathname === "/__discord") return send(200, discord);
    // Web-Push-Dienst (Nachbau): nimmt Anstöße an, merkt sich Adresse und VAPID-Kopf.
    // Adressen mit „/push/kaputt-“ antworten 500 (Fehlversuch), mit „/push/weg-“ 410 (Abo beim Dienst gelöscht).
    if (url.pathname.startsWith("/push/") && req.method === "POST") {
      pushes.push({ at: new Date().toISOString(), pfad: url.pathname, vapid: String(req.headers.authorization ?? "").startsWith("vapid t="), laenge: body.length });
      if (url.pathname.startsWith("/push/kaputt-")) return send(500, "kaputt");
      if (url.pathname.startsWith("/push/weg-")) return send(410, "weg");
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
    // Die VA legt selbst einen Thread im Kanal an („… hat einen Thread begonnen“): Systemnachricht (Typ 18) im Kanal
    // mit Verweis auf den Thread, dann ihre Nachricht(en) im Thread. ohneSystemnachricht: nur über die Thread-Liste
    // zu finden; archiviert: in der Liste der archivierten Threads.
    if (url.pathname === "/__discord-va/thread" && req.method === "POST") {
      const b = JSON.parse(body || "{}");
      const k = dcKanal(String(b.kanal));
      if (!k) return send(404, { fehler: "Kanal unbekannt" });
      const va = { id: String(b.autor ?? DC_VA), username: "VA (Test)" };
      const th = dcThread(dcId(), b.name, k, va.id, !!b.archiviert);
      if (!b.ohneSystemnachricht) {
        const sys = { id: dcId(), channel_id: k.id, type: 18, content: th.name, timestamp: new Date().toISOString(), author: va, attachments: [], reactions: [], message_reference: { channel_id: th.id, guild_id: k.guild_id } };
        dcVa.nachrichten.push(sys);
      }
      const texte = Array.isArray(b.texte) ? b.texte : b.text != null ? [b.text] : [];
      const msgs = texte.map((t) => dcNachricht(th.id, va, String(t)));
      return send(200, { thread: th, nachrichten: msgs });
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
    // B29: sellerboard-MCP (Nachbau, nur erfundene Werte). Zählt Aufrufe wie sellerboard (usage_quota kostenlos);
    // POST /__sellerboard {limit: true} → jeder weitere Aufruf meldet „used up today's MCP call limit (125 of 125)“.
    if (url.pathname === "/__sellerboard" && req.method === "POST") {
      const b = body ? JSON.parse(body) : {};
      if (b.zuruecksetzen) sbMock = { aufrufe: 0, limit: false, quotaVoll: true, werkzeuge: [] };
      if (typeof b.limit === "boolean") sbMock.limit = b.limit;
      // quotaVoll: false → usage_quota meldet noch Luft, die Aufrufe scheitern trotzdem (prüft den Weg über den Fehlertext)
      if (typeof b.quotaVoll === "boolean") sbMock.quotaVoll = b.quotaVoll;
      if (typeof b.aufrufe === "number") sbMock.aufrufe = b.aufrufe;
      return send(200, sbMock);
    }
    if (url.pathname === "/__sellerboard") return send(200, sbMock);
    if (url.pathname === "/sellerboard/mcp" && req.method === "POST") {
      const rpc = JSON.parse(body || "{}");
      const name = rpc.params?.name ?? "";
      const antwort = (obj, isError = false) => send(200, { jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: isError ? obj : `${name}: success\n${JSON.stringify(obj)}` }], isError } });
      if (rpc.method !== "tools/call") return send(200, { jsonrpc: "2.0", id: rpc.id, result: {} });
      if (name === "usage_quota") {
        const used = sbMock.limit && sbMock.quotaVoll ? 125 : sbMock.aufrufe;
        return antwort({ used, limit: 125, remaining: 125 - used, resets_at: "00:00 UTC" });
      }
      if (sbMock.limit) return antwort(`You have used up today's MCP call limit (125 of 125). The counter resets at 00:00 UTC.`, true);
      sbMock.aufrufe++;
      sbMock.werkzeuge.push(name);
      const a = rpc.params?.arguments ?? {};
      if (name === "list_accounts") return antwort({ accounts: [{ account_id: "sb-test-1", name: "Testkonto (Nachbau)", has_ebay: false }] });
      if (name === "dashboard_period") return antwort({ status: "ok", result: (a.periods ?? []).map((p) => ({ start: p.start, end: p.end, has_data: true, data: { Info: { Sales: 100, Units: 5, Orders: 4, Refunds: 0, Advertising: 0, EstPayout: 70, GrossProfit: 30, NetProfit: 20 } } })) });
      if (["dashboard_table", "products", "inventory", "expenses"].includes(name)) return antwort({ result: [], total: 0 });
      if (name === "fba_shipments") return antwort({ result: [], total: 0, products: [] });
      return antwort(`Unbekanntes Werkzeug ${name}`, true);
    }
    if (url.pathname === "/__drive" && req.method === "POST") {
      const b = JSON.parse(body || "{}");
      if (b.zuruecksetzen) drive.dateien.clear();
      const ids = [];
      for (const o of b.ordner ?? []) {
        drive.dateien.set(o.id, { id: o.id, name: o.name ?? o.id, mimeType: "application/vnd.google-apps.folder", parents: o.parents ?? [], createdTime: new Date().toISOString(), trashed: false, inhalt: null });
        ids.push(o.id);
      }
      for (const d of b.dateien ?? []) {
        const id = d.id ?? `drv-${++drive.n}`;
        drive.dateien.set(id, { id, name: d.name, mimeType: d.mimeType ?? "application/pdf", parents: d.parents ?? [], createdTime: d.createdTime ?? new Date().toISOString(), trashed: false, inhalt: Buffer.from(d.base64 ?? "", "base64") });
        ids.push(id);
      }
      return send(200, { ids });
    }
    if (url.pathname === "/__drive") return send(200, [...drive.dateien.values()].filter((f) => f.mimeType !== "application/vnd.google-apps.folder").map((f) => ({ id: f.id, name: f.name, pfad: drivePfad(f), trashed: f.trashed, groesse: f.inhalt ? f.inhalt.length : 0 })));
    if (url.pathname === "/__briefe" && req.method === "POST") {
      const b = JSON.parse(body || "{}");
      if (b.zuruecksetzen) briefe.jobs.clear();
      for (const j of briefe.jobs.values()) {
        if (!b.alle && String(j.id) !== String(b.id)) continue;
        if (b.status) j.status = b.status;
        if ("tracking_status" in b) j.tracking_status = b.tracking_status;
        if ("tracking_code" in b) j.tracking_code = b.tracking_code;
      }
      return send(200, { ok: true });
    }
    if (url.pathname === "/__briefe") return send(200, [...briefe.jobs.values()].map((j) => ({ id: j.id, anbieter: j.anbieter, mode: j.mode, status: j.status, seiten: j.seiten, amount: j.amount })));
    if (url.pathname === "/__gesund") return send(200, { ok: true });
    if (url.pathname === "/__video" && req.method === "POST") {
      const b = JSON.parse(body || "{}");
      if (b.zuruecksetzen) Object.assign(videoNb, { eleven: [], bilder: [], youtube: [], untertitel: [], sitzungen: new Map(), n: 0 });
      if (typeof b.verzoegerungMs === "number") videoNb.verzoegerungMs = b.verzoegerungMs;
      return send(200, { ok: true });
    }
    if (url.pathname === "/__video") return send(200, { eleven: videoNb.eleven, bilder: videoNb.bilder, youtube: videoNb.youtube });
    if (url.pathname === "/openai/v1/images/edits" && req.method === "POST") {
      // B36.9: Motiv mit Stil-Referenzbildern (multipart) – Felder wie beim echten Endpunkt
      const form = await new Request("http://nb/", { method: "POST", headers: { "content-type": String(req.headers["content-type"] ?? "") }, body: roh }).formData().catch(() => null);
      const felder = form ? Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) : {};
      const bilder = form ? [...form.getAll("image[]"), ...form.getAll("image")].filter((v) => typeof v !== "string") : [];
      const [code, data] = await openaiBildNb(req, { ...felder, n: Number(felder.n ?? 1) }, { edits: true, referenzen: bilder.length });
      return send(code, data);
    }
    if (url.pathname === "/__video/untertitel") return send(200, videoNb.untertitel);
    if (url.pathname.startsWith("/drive-upload/") && driveUploadRoh(req, res, url, body, roh)) {
      remember(log, { at: new Date().toISOString(), dienst: "Google Drive", method: req.method, path: url.pathname, status: res.statusCode, simuliert: true });
      return;
    }
    if (url.pathname.startsWith("/youtube") && youtubeRoh(req, res, url, body)) {
      remember(log, { at: new Date().toISOString(), dienst: "YouTube", method: req.method, path: url.pathname, status: res.statusCode, simuliert: req.method !== "GET" });
      return;
    }
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

// ---------------------------------------------------------------------------------------------------------
// B36 Video-Pipeline: Nachbau ElevenLabs (stille MP3 je nach Textlänge), OpenAI-Bilder (PNG 1536×1024; Bildidee mit
// „TESTABLEHNUNG“ = Ablehnung wie der Sicherheitsfilter), YouTube (Anmeldung, resumable Upload, Sichtbarkeit,
// Thumbnail) und die Claude-Antworten für [video:research|script|package] (auch als Stream wie die echte API).
var videoNb = { eleven: [], bilder: [], youtube: [], untertitel: [], sitzungen: new Map(), n: 0, verzoegerungMs: 0 };

function crc32(buf) {
  let c;
  const t = (crc32.t ??= Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  let crc = 0xffffffff;
  for (const b of buf) crc = t[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const pngCache = new Map();
async function testPng(farbe) {
  if (pngCache.has(farbe)) return pngCache.get(farbe);
  const { deflateSync } = await import("node:zlib");
  const [w, h] = [1536, 1024];
  const zeile = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) zeile.set(farbe, 1 + x * 3);
  const roh = Buffer.concat(Array.from({ length: h }, () => zeile));
  const chunk = (typ, daten) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(daten.length);
    const td = Buffer.concat([Buffer.from(typ), daten]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(roh, { level: 1 })), chunk("IEND", Buffer.alloc(0))]);
  pngCache.set(farbe, png);
  return png;
}

/** Motiv 1024×1024: farbiger Kreis mit schwarzem Rand, Hintergrund transparent (RGBA) bzw. weiß. */
async function motivPng(farbe, transparent) {
  const k = `m${farbe.join(",")}${transparent}`;
  if (pngCache.has(k)) return pngCache.get(k);
  const { deflateSync } = await import("node:zlib");
  const n = 1024;
  const zeilen = [];
  for (let y = 0; y < n; y++) {
    const z = Buffer.alloc(1 + n * 4);
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - n / 2, y - n / 2);
      const px = d < 380 ? [...farbe, 255] : d < 410 ? [20, 20, 20, 255] : transparent ? [0, 0, 0, 0] : [255, 255, 255, 255];
      z.set(px, 1 + x * 4);
    }
    zeilen.push(z);
  }
  const chunk = (typ, daten) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(daten.length);
    const td = Buffer.concat([Buffer.from(typ), daten]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(zeilen), { level: 1 })), chunk("IEND", Buffer.alloc(0))]);
  pngCache.set(k, png);
  return png;
}

/** Stille MP3 (MPEG-1 Layer III, 128 kbit/s, 44,1 kHz): ein Rahmen = 417 Byte = 26,12 ms. */
function stilleMp3(sekunden) {
  const rahmen = Buffer.alloc(417);
  rahmen.set([0xff, 0xfb, 0x90, 0x64], 0);
  const n = Math.max(1, Math.ceil(sekunden / (1152 / 44100)));
  return Buffer.concat(Array.from({ length: n }, () => rahmen));
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

async function elevenNb(req, p, b) {
  if (!req.headers["xi-api-key"]) return [401, { detail: { status: "invalid_api_key", message: "Invalid API key" } }];
  const stimme = p.split("/").pop();
  const text = String(b.text ?? "");
  if (!text) return [422, { detail: { message: "text fehlt" } }];
  videoNb.eleven.push({ at: new Date().toISOString(), stimme, zeichen: text.length, hash: createHash("sha256").update(text).digest("hex").slice(0, 12) });
  if (videoNb.verzoegerungMs) await warte(videoNb.verzoegerungMs);
  const woerter = text.split(/\s+/).filter(Boolean).length;
  return [200, stilleMp3(woerter / 2.6), "audio/mpeg"];
}

async function openaiBildNb(req, b, extra = {}) {
  if (!String(req.headers.authorization ?? "").startsWith("Bearer ")) return [401, { error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } }];
  const prompt = String(b.prompt ?? "");
  const abgelehnt = prompt.includes("TESTABLEHNUNG");
  videoNb.bilder.push({ at: new Date().toISOString(), model: b.model, size: b.size, quality: b.quality, background: b.background ?? null, edits: !!extra.edits, referenzen: extra.referenzen ?? 0, prompt: prompt.slice(0, 600), abgelehnt });
  if (videoNb.verzoegerungMs) await warte(Math.round(videoNb.verzoegerungMs / 2));
  if (abgelehnt) return [400, { error: { message: "Your request was rejected as a result of our safety system.", type: "image_generation_user_error", code: "moderation_blocked" } }];
  const h = createHash("sha256").update(prompt).digest();
  const farbe = [40 + (h[0] % 120), 60 + (h[1] % 120), 80 + (h[2] % 120)];
  const png = b.background === "transparent" || b.size === "1024x1024" ? await motivPng(farbe, b.background === "transparent") : await testPng(farbe);
  return [200, { created: Math.floor(Date.now() / 1000), data: [{ b64_json: png.toString("base64") }], usage: { total_tokens: 1000 } }];
}

/** YouTube-Pfade, die eigene Kopfzeilen brauchen (Weiterleitung, Location, 308). Liefert true, wenn beantwortet. */
function youtubeRoh(req, res, url, body) {
  const p = url.pathname;
  if (p === "/youtube-auth") {
    const ziel = new URL(url.searchParams.get("redirect_uri") ?? "http://localhost");
    ziel.searchParams.set("code", "yt-test-code");
    ziel.searchParams.set("state", url.searchParams.get("state") ?? "");
    res.writeHead(302, { Location: ziel.toString() });
    res.end();
    return true;
  }
  if (p === "/youtube-upload/youtube/v3/videos" && req.method === "POST") {
    if (!String(req.headers.authorization ?? "").startsWith("Bearer yt-access")) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: 401, message: "Invalid Credentials" } }));
      return true;
    }
    const n = ++videoNb.n;
    let meta = {};
    try {
      meta = JSON.parse(body || "{}");
    } catch {}
    videoNb.sitzungen.set(String(n), { meta, groesse: Number(req.headers["x-upload-content-length"] ?? 0), fertig: null });
    res.writeHead(200, { Location: `${SELF}/youtube-upload/sitzung/${n}`, "Content-Type": "application/json" });
    res.end("{}");
    return true;
  }
  const m = /^\/youtube-upload\/sitzung\/(\d+)$/.exec(p);
  if (m && req.method === "PUT") {
    const s = videoNb.sitzungen.get(m[1]);
    if (!s) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: 404, message: "Upload-Sitzung unbekannt" } }));
      return true;
    }
    const range = String(req.headers["content-range"] ?? "");
    if (range.startsWith("bytes */") && !s.fertig) {
      res.writeHead(308, {});
      res.end();
      return true;
    }
    if (!s.fertig) {
      const id = `ytTEST${m[1]}`;
      s.fertig = { id, snippet: s.meta.snippet ?? {}, status: { privacyStatus: s.meta.status?.privacyStatus ?? "public", uploadStatus: "uploaded" } };
      videoNb.youtube.push({ at: new Date().toISOString(), id, titel: s.meta.snippet?.title, sichtbarkeit: s.fertig.status.privacyStatus, beschreibung: String(s.meta.snippet?.description ?? "").slice(0, 2000), tags: s.meta.snippet?.tags ?? [], groesse: Number(req.headers["content-length"] ?? 0), thumbnail: false });
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ kind: "youtube#video", ...s.fertig }));
    return true;
  }
  return false;
}

function youtubeNb(req, url, p, body) {
  if (p === "/youtube-oauth/token") {
    const f = new URLSearchParams(body);
    if (!f.get("client_id") || !f.get("client_secret")) return [401, { error: "invalid_client" }];
    if (f.get("grant_type") === "authorization_code") return f.get("code") === "yt-test-code" ? [200, { access_token: "yt-access-1", refresh_token: "yt-refresh-test", expires_in: 3599, token_type: "Bearer" }] : [400, { error: "invalid_grant" }];
    if (f.get("grant_type") === "refresh_token") return f.get("refresh_token") === "yt-refresh-test" ? [200, { access_token: "yt-access-2", expires_in: 3599, token_type: "Bearer" }] : [400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }];
    return [400, { error: "unsupported_grant_type" }];
  }
  if (!String(req.headers.authorization ?? "").startsWith("Bearer yt-access")) return [401, { error: { code: 401, message: "Invalid Credentials" } }];
  if (p === "/youtube-api/youtube/v3/channels") return [200, { items: [{ id: "UCtest", snippet: { title: "Testkanal (Nachbau)" } }] }];
  if (p === "/youtube-api/youtube/v3/videos") {
    const v = videoNb.youtube.find((x) => x.id === url.searchParams.get("id"));
    return [200, { items: v ? [{ id: v.id, status: { privacyStatus: v.sichtbarkeit } }] : [] }];
  }
  if (p === "/youtube-upload/youtube/v3/captions" && req.method === "POST") {
    // B36.9.4: Untertitel-Spur (multipart/related: JSON-Snippet + SRT)
    const meta = /\{[\s\S]*?"snippet"[\s\S]*?\}\s*\}/.exec(body);
    let snippet = {};
    try {
      snippet = JSON.parse(meta?.[0] ?? "{}").snippet ?? {};
    } catch {}
    const v = videoNb.youtube.find((x) => x.id === snippet.videoId);
    if (!v) return [404, { error: { code: 404, message: "videoNotFound" } }];
    const zeilen = (body.match(/-->/g) ?? []).length;
    videoNb.untertitel.push({ at: new Date().toISOString(), videoId: snippet.videoId, sprache: snippet.language, name: snippet.name, entwurf: snippet.isDraft, zeilen });
    return [200, { kind: "youtube#caption", id: `cap-${snippet.videoId}`, snippet: { videoId: snippet.videoId, language: snippet.language, name: snippet.name, isDraft: false } }];
  }
  if (p === "/youtube-upload/youtube/v3/thumbnails/set") {
    const v = videoNb.youtube.find((x) => x.id === url.searchParams.get("videoId"));
    if (v) v.thumbnail = true;
    return v ? [200, { items: [{ default: { url: "https://example.invalid/thumb.png" } }] }] : [404, { error: { code: 404, message: "videoNotFound" } }];
  }
  return [404, { error: { code: 404, message: "nicht nachgebildet" } }];
}

// Claude-Antworten für die Video-Pipeline ----------------------------------------------------------------------

const SATZ = ["Viele Paare kennen diese Situation besser, als sie zugeben möchten", "Studien zeigen, dass Alltagsstress die Nähe leise und unbemerkt verdrängt", "Wer offen darüber spricht, findet meistens schneller wieder zueinander", "Kleine Rituale im Alltag helfen dabei, wieder Verbindung herzustellen", "Wichtig ist, ohne Vorwürfe zu beginnen und gut zuzuhören", "Forscher haben dazu mehrere tausend Paare über Jahre hinweg begleitet", "Das Ergebnis überrascht viele, ist aber gut belegt und nachvollziehbar", "Am Ende geht es um Vertrauen, Zeit und echte Aufmerksamkeit füreinander"];
function fuelltext(n, start) {
  const w = [];
  for (let i = start; w.length < n; i++) w.push(...SATZ[i % SATZ.length].split(" ").map((x, j, a) => (j === a.length - 1 ? `${x}.` : x)));
  // Je Szene eindeutig (sonst nutzt der Worker die bezahlte Sprache gleicher Texte zu Recht wieder): „… Szene 7.“
  const t = [...w.slice(0, n - 2), "Szene", `${start}.`];
  t[t.length - 3] = t[t.length - 3].replace(/[.,]?$/, ".");
  return t.join(" ");
}

const WB_LAYOUTS = ["3er", "4er", "figur-liste", "gegenueberstellung", "5er"];
const WB_MOTIVE = ["sanduhr", "banane", "kirsche", "lineal", "wasserhahn", "wecker", "herz", "glas"];

function videoAntwort(text) {
  const thema = (/Thema: (.*)/.exec(text)?.[1] ?? "Testthema").trim();
  if (text.startsWith("[video:research]")) {
    const quellen = Array.from({ length: 6 }, (_, i) => ({ id: `Q${i + 1}`, titel: `Teststudie ${i + 1} zu Beziehung und Alltag`, url: `https://example.com/studie-${i + 1}`, jahr: 2014 + i, art: "Studie", autoren: `Testautor ${i + 1} et al.` }));
    const punkte = ["Stress im Alltag", "Unausgesprochene Konflikte", "Müdigkeit und Schlaf", "Routine statt Neugier", "Körperbild und Selbstwert"].map((titel, i) => ({ titel, kern: `Kernaussage ${i + 1} mit Studie`, quelle_ids: [`Q${i + 1}`] }));
    const json = { hook: `Warum ${thema.split("?")[0]} so viele betrifft`, angst: "Wer das Thema ignoriert, riskiert Distanz in der Beziehung.", punkte, fazit: "Fünf Gründe, ein Weg: reden.", cta: "Abonniere den Kanal für mehr fundierte Themen.", quellen };
    return { text: "Hier ist die Gliederung:\n```json\n" + JSON.stringify(json) + "\n```", usage: { input_tokens: 9000, output_tokens: 2500, server_tool_use: { web_search_requests: 4 } }, suche: quellen.map((q) => ({ url: q.url, title: q.titel })) };
  }
  if (text.startsWith("[video:script]")) {
    // Länge wie verlangt: „insgesamt 2.300–2.900 Wörter …, 27–45 Szenen“ → Mitte der Spanne, ~70 Wörter je Szene
    const zahl = (x) => Number(String(x).replace(/\./g, ""));
    const wm = /insgesamt ([\d.]+)–([\d.]+) Wörter/.exec(text);
    const sm = /(\d+)–(\d+) Szenen mit/.exec(text);
    const ziel = wm ? Math.round((zahl(wm[1]) + zahl(wm[2])) / 2) : 1600;
    const anzahlSzenen = Math.min(sm ? Number(sm[2]) : 99, Math.max(sm ? Number(sm[1]) : 12, Math.round(ziel / 70)));
    const jePunkt = Math.max(2, Math.floor((anzahlSzenen - 7) / 5));
    const plan = [["hook", 2], ["angst", 2], ...[1, 2, 3, 4, 5].map((p, i) => [`punkt-${p}`, jePunkt + (i < anzahlSzenen - 7 - jePunkt * 5 ? 1 : 0)]), ["zusammenfassung", 2], ["cta", 1]];
    const gesamt = plan.reduce((a, [, x]) => a + x, 0);
    const wb = text.includes("STIL WHITEBOARD-COLLAGE");
    const figur = /Feste Figuren[^\n]*:\n- ([a-z0-9-]+):/.exec(text)?.[1] ?? null;
    const szenen = [];
    let nr = 0;
    for (const [abschnitt, anzahl] of plan) {
      for (let k = 0; k < anzahl; k++) {
        nr++;
        const n = Math.floor(ziel / gesamt) + (nr <= ziel % gesamt ? 1 : 0);
        const punkt = /punkt-(\d)/.exec(abschnitt)?.[1];
        const bildidee = nr === 5 ? "Leeres Bett im Morgenlicht, Symbolbild" : nr === 9 ? "TESTABLEHNUNG Kalender an der Wand, Symbolbild" : `Symbolbild ${nr}: zwei Kaffeetassen, Pflanze und Licht`;
        if (wb) {
          // B36.9 Whiteboard: Layout, Texte, 3–5 Motive (wiederkehrende Schlüssel, Figur aus dem Kanalprofil, eine Ablehnung)
          const layout = WB_LAYOUTS[(nr - 1) % WB_LAYOUTS.length];
          const anzahl = { "3er": 3, "4er": 4, "5er": 5, "figur-liste": 1, gegenueberstellung: 2 }[layout];
          const motive = Array.from({ length: anzahl }, (_, i) => {
            if (layout === "figur-liste" && figur) return { key: figur, beschreibung: "Figur aus dem Kanalprofil" };
            if (nr === 2 && i === 0) return { key: "verboten", beschreibung: "TESTABLEHNUNG Motiv" };
            const key = WB_MOTIVE[(nr + i * 3) % WB_MOTIVE.length];
            return { key, beschreibung: `Cartoon ${key} mit Comic-Gesicht` };
          });
          szenen.push({
            abschnitt, text: fuelltext(n, nr), quelle_ids: punkt ? [`Q${punkt}`] : [], layout,
            ueberschrift: nr % 3 === 1 ? `Teil ${nr}: Was hilft` : "", balken: nr % 3 === 2 ? `Studie zeigt klaren Unterschied ${nr}` : "",
            kernaussage: nr % 2 === 0 ? "Das ist normal" : "", schritt: nr === 4 ? "Schritt 4: Arzt fragen" : "",
            liste: layout === "figur-liste" ? ["Bewegung", "Schlaf", "Weniger Alkohol"] : [], motive,
          });
          continue;
        }
        szenen.push({ abschnitt, text: fuelltext(n, nr), bildidee, einblendung: punkt && k === 0 ? `Studie Q${punkt} (${2013 + Number(punkt)})` : "", quelle_ids: punkt ? [`Q${punkt}`] : [] });
      }
    }
    return { text: JSON.stringify({ szenen }), usage: { input_tokens: 6000, output_tokens: 4500 } };
  }
  if (text.startsWith("[video:package]")) {
    const json = { titel: ["5 Gründe, über die keiner spricht", "Warum die Nähe verschwindet – und was hilft", "Das sagen Studien über Nähe im Alltag", "Kein Thema? Doch! 5 ehrliche Gründe", "Nähe zurückgewinnen: 5 Gründe verstehen"], beschreibung: "In diesem Video schauen wir uns fünf Gründe an, die Studien immer wieder finden.\n\nOhne Vorwürfe, mit konkreten Tipps für den Alltag.", tags: ["Beziehung", "Partnerschaft", "Nähe", "Studien", "Paare", "Alltag", "Kommunikation", "Stress", "Tipps", "Psychologie", "Liebe", "Vertrauen"], thumbnail_text: "5 Gründe keiner spricht" };
    return { text: JSON.stringify(json), usage: { input_tokens: 4000, output_tokens: 800 } };
  }
  return null;
}

function videoSse(b, antwort) {
  const ev = (typ, daten) => `event: ${typ}\ndata: ${JSON.stringify({ type: typ, ...daten })}\n\n`;
  const u = antwort.usage;
  let out = ev("message_start", { message: { id: `msg_test_${++n}`, type: "message", role: "assistant", model: b.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: u.input_tokens, output_tokens: 1 } } });
  let i = 0;
  if (antwort.suche) {
    out += ev("content_block_start", { index: i, content_block: { type: "server_tool_use", id: "srvtoolu_test_1", name: "web_search", input: {} } });
    out += ev("content_block_delta", { index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify({ query: "Studie Beziehung Alltag" }) } });
    out += ev("content_block_stop", { index: i++ });
    out += ev("content_block_start", { index: i, content_block: { type: "web_search_tool_result", tool_use_id: "srvtoolu_test_1", content: antwort.suche.map((s) => ({ type: "web_search_result", url: s.url, title: s.title, encrypted_content: "test", page_age: null })) } });
    out += ev("content_block_stop", { index: i++ });
  }
  out += ev("content_block_start", { index: i, content_block: { type: "text", text: "" } });
  for (let k = 0; k < antwort.text.length; k += 4000) out += ev("content_block_delta", { index: i, delta: { type: "text_delta", text: antwort.text.slice(k, k + 4000) } });
  out += ev("content_block_stop", { index: i });
  out += ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: u.output_tokens, ...(u.server_tool_use ? { server_tool_use: u.server_tool_use } : {}) } });
  out += ev("message_stop", {});
  return out;
}

/** B36 Video-Ablage: resumable Upload nach Drive (POST Metadaten → Location, PUT Datei → Datei-ID). */
var driveSitzungen = new Map();
function driveUploadRoh(req, res, url, body, roh) {
  const json = (code, o, kopf = {}) => {
    res.writeHead(code, { "Content-Type": "application/json", ...kopf });
    res.end(JSON.stringify(o));
    return true;
  };
  if (!/^Bearer (test-drive-token-|yt-access)/.test(req.headers.authorization ?? "")) return json(401, { error: { code: 401, message: "Invalid Credentials" } });
  if (url.pathname === "/drive-upload/drive/v3/files" && req.method === "POST" && url.searchParams.get("uploadType") === "resumable") {
    let meta = {};
    try {
      meta = JSON.parse(body || "{}");
    } catch {}
    const sid = `s${driveSitzungen.size + 1}-${Date.now().toString(36)}`;
    driveSitzungen.set(sid, { meta, mime: String(req.headers["x-upload-content-type"] ?? "application/octet-stream") });
    return json(200, {}, { Location: `${SELF}/drive-upload/sitzung/${sid}` });
  }
  const m = /^\/drive-upload\/sitzung\/([\w-]+)$/.exec(url.pathname);
  if (m && req.method === "PUT") {
    const sz = driveSitzungen.get(m[1]);
    if (!sz) return json(404, { error: { code: 404, message: "Upload-Sitzung unbekannt" } });
    const id = `drv-${++drive.n}`;
    drive.dateien.set(id, { id, name: String(sz.meta.name ?? "Datei"), mimeType: sz.mime, parents: Array.isArray(sz.meta.parents) ? sz.meta.parents : [], createdTime: new Date().toISOString(), trashed: false, inhalt: roh });
    driveSitzungen.delete(m[1]);
    return json(200, { id, webViewLink: `https://drive.google.com/file/d/${id}/view` });
  }
  return false;
}
