// KI-Anbindung (Claude): Reisepläne aus Dateien/Text lesen, Assistent mit Änderungsvorschlägen
// und Beitragstexte für Social Media. Ohne ANTHROPIC_API_KEY ist alles abgeschaltet.
import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { DATA_DIR, lesen, schreiben, exklusiv } from "./speicher.mjs";
import { docxText } from "./docx.mjs";
import { fehler } from "./konten.mjs";
import { ausflugKosten, zeitplan, startpunkt, hotelKosten, festeZeit, zimmerVon, KATEGORIEN, QUELLEN, REISEARTEN, VERKEHRSMITTEL } from "../public/rechnen.js";

const MODELL = process.env.KI_MODELL || "claude-opus-5-5";
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
export const kiAktiv = () => Boolean(client);

// Lehnt die KI ab, übernimmt serverseitig automatisch ein passendes Ersatzmodell.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

function pruefeAntwort(msg) {
  if (msg.stop_reason === "refusal") throw fehler(422, "Die KI hat diese Anfrage abgelehnt. Bitte anders formulieren.");
  if (msg.stop_reason === "max_tokens") throw fehler(502, "Die Antwort der KI war zu lang und wurde abgeschnitten. Bitte in kleineren Teilen versuchen.");
  return msg;
}

function kiFehler(e) {
  if (e.status && !(e instanceof Anthropic.APIError)) return e; // eigene Fehler durchreichen
  if (e instanceof Anthropic.AuthenticationError) return fehler(502, "Der KI-Schlüssel (ANTHROPIC_API_KEY) ist ungültig.");
  if (e instanceof Anthropic.RateLimitError) return fehler(429, "Die KI ist gerade ausgelastet. Bitte gleich noch einmal versuchen.");
  if (e instanceof Anthropic.BadRequestError) return fehler(400, `Die KI konnte die Anfrage nicht verarbeiten: ${e.message}`);
  if (e instanceof Anthropic.APIError) return fehler(502, `KI-Dienst nicht erreichbar (${e.status ?? "Netz"}).`);
  return e;
}

const textAus = (msg) => msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();

// ---------- Reiseplan lesen ----------

const zahlOderNull = { anyOf: [{ type: "number" }, { type: "null" }] };
const str = { type: "string" };
const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

const PLAN_SCHEMA = obj({
  name: str,
  art: { type: "string", enum: Object.keys(REISEARTEN) },
  schiff: str,
  personen: { type: "array", items: obj({ name: str, typ: { type: "string", enum: ["erwachsen", "kind"] }, alter: zahlOderNull }) },
  stationen: {
    type: "array",
    items: obj({ datum: str, art: { type: "string", enum: ["hafen", "seetag", "ort"] }, name: str, land: str, ankunft: str, abfahrt: str, allesAnBord: str, notiz: str }),
  },
  hotels: {
    type: "array",
    items: obj({ name: str, ort: str, anreise: str, abreise: str, preis: zahlOderNull, preisArt: { type: "string", enum: ["nacht", "gesamt"] }, verpflegung: { type: "string", enum: ["", "ohne", "fruehstueck", "halbpension", "vollpension", "all"] }, status: { type: "string", enum: ["idee", "favorit", "gebucht"] }, link: str, notiz: str }),
  },
  ausfluege: {
    type: "array",
    items: obj({
      datum: str,
      ort: str,
      titel: str,
      kategorie: { type: "string", enum: Object.keys(KATEGORIEN) },
      quelle: { type: "string", enum: Object.keys(QUELLEN) },
      status: { type: "string", enum: ["idee", "favorit", "gebucht"] },
      beginn: str,
      dauerMin: zahlOderNull,
      preisArt: { type: "string", enum: ["person", "gruppe"] },
      preisErw: zahlOderNull,
      preisKind: zahlOderNull,
      preisGruppe: zahlOderNull,
      anzahl: zahlOderNull,
      link: str,
      notiz: str,
    }),
  },
  kosten: { type: "array", items: obj({ titel: str, betrag: zahlOderNull, status: { type: "string", enum: ["idee", "favorit", "gebucht"] } }) },
  hinweise: str,
});

const IMPORT_SYSTEM = `Du überträgst Reisepläne in das Datenformat eines Reiseplaners. Die Vorlagen sind z. B. mit ChatGPT ausgearbeitete Pläne, Buchungsbestätigungen, Reiseverläufe von Kreuzfahrten (etwa Mein Schiff), Ausflugslisten oder Screenshots.

Regeln:
- Übernimm nur, was in der Vorlage steht. Erfinde keine Preise, Zeiten, Links oder Orte; Unbekanntes bleibt leer ("") bzw. null.
- Datum als JJJJ-MM-TT. Fehlt das Jahr, nimm das nächste passende Datum ab heute. Zeiten als HH:MM (24 h).
- Kreuzfahrt: jeder Tag ist eine Station (art "hafen" mit Ankunft/Abfahrt, "seetag" für Tage auf See). "Alle an Bord" nur, wenn angegeben.
- Alle anderen Reisearten (Hotel, Rundreise, Städtereise, Roadtrip/Wohnmobil, Ferienwohnung, Camping, Ski, Tagesausflug): Tage an Land als art "ort" mit dem Ort als Name; Unterkünfte (auch Ferienwohnung, Campingplatz) unter "hotels".
- Ausflüge: dem Tag über "datum" und dem Ort über "ort" zuordnen. Dauer in Minuten (aus „Zeit: 08:15–11:45“ berechnen).
- Preise in Euro als Zahl. Steht ein Gesamtpreis da („Preis gesamt für 6 Personen: 275 €“, „Gesamtpreis … 544 €“, „Für 3 Taucher: 597,60 €“), dann preisArt "gruppe" und preisGruppe = dieser Betrag, preisErw/preisKind null; gilt er nur für einen Teil der Gruppe, "anzahl" = Zahl der Teilnehmenden. Sonst preisArt "person" mit preisErw/preisKind. Steht neben Dollar auch ein Euro-Betrag, den Euro-Betrag nehmen; nur Dollar → grob umrechnen und in "notiz" vermerken.
- Status: gebucht/reserviert → "gebucht"; fest geplant → "favorit"; Alternativen, Anfragen, Optionen → "idee". Backups („TUI BACKUP GEBUCHT“) sind "gebucht" mit Hinweis in der Notiz.
- quelle: "schiff" für Ausflüge der Reederei, "getyourguide"/"viator"/"tiqets"/"civitatis", wenn genannt, "eigene" für Unternehmungen auf eigene Faust, sonst "sonstige".
- Weitere Kosten (Flug, Mietwagen, Trinkgeld, Versicherung …) unter "kosten".
- In "hinweise" kurz auf Deutsch, was unklar war oder fehlt (leer, wenn nichts).`;

const BILD_TYPEN = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const TEXT_ENDUNGEN = /\.(txt|md|markdown|csv|json|html?|ics|eml)$/i;

function dateiBlock(d) {
  const daten = String(d.daten ?? "");
  const roh = Buffer.from(daten, "base64");
  if (d.typ === "application/pdf" || /\.pdf$/i.test(d.name)) {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: daten }, title: String(d.name).slice(0, 200) };
  }
  if (BILD_TYPEN.has(d.typ)) return { type: "image", source: { type: "base64", media_type: d.typ, data: daten } };
  if (/\.docx$/i.test(d.name) || d.typ === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return { type: "text", text: `Datei „${d.name}“:\n${docxText(roh)}` };
  }
  if (TEXT_ENDUNGEN.test(d.name) || String(d.typ).startsWith("text/")) return { type: "text", text: `Datei „${d.name}“:\n${roh.toString("utf8")}` };
  throw fehler(400, `„${d.name}“: Dieses Dateiformat wird nicht unterstützt (PDF, Word, Text oder Bilder gehen).`);
}

export async function reiseplanLesen({ text, dateien = [], heute }) {
  if (!client) throw fehler(501, "Keine KI hinterlegt (ANTHROPIC_API_KEY fehlt).");
  if (!String(text ?? "").trim() && !dateien.length) throw fehler(400, "Bitte Text einfügen oder eine Datei wählen.");
  const inhalt = dateien.slice(0, 10).map(dateiBlock);
  inhalt.push({ type: "text", text: `Heute ist ${heute}.${String(text ?? "").trim() ? `\n\nVorlage:\n${text}` : ""}\n\nÜbertrage den Reiseplan.` });
  try {
    const stream = client.beta.messages.stream({
      ...FALLBACK,
      model: MODELL,
      max_tokens: 64000,
      system: IMPORT_SYSTEM,
      output_config: { effort: "medium", format: { type: "json_schema", schema: PLAN_SCHEMA } },
      messages: [{ role: "user", content: inhalt }],
    });
    const msg = pruefeAntwort(await stream.finalMessage());
    return JSON.parse(textAus(msg));
  } catch (e) {
    if (e instanceof SyntaxError) throw fehler(502, "Die KI-Antwort war nicht lesbar. Bitte erneut versuchen.");
    throw kiFehler(e);
  }
}

// ---------- Assistent ----------

const SYSTEM_CHAT = `Du bist der Reiseassistent in einem privaten Reiseplaner einer Familie. Du hilfst, Landausflüge, Hotels und Tage zu planen, zu vergleichen und zu hinterfragen – auf Deutsch, freundlich und knapp.

Die Reise kann eine Kreuzfahrt, ein Hotel-, Städte-, Ski- oder Campingurlaub, ein Roadtrip oder ein Tagesausflug sein. Mit jeder Nachricht bekommst du (wenn er sich geändert hat) den aktuellen Stand der Reise als JSON: Personen (ggf. mit Familie), Tage mit Zeiten und fester Zeit (z. B. „Alle an Bord“, Check-out, Abflug), Verbindungen, Unterkünfte, Ausflüge mit berechneten Kosten, Zeitplan und Puffer bis zur festen Zeit, sowie Bewertungen.

So arbeitest du:
- Antworte auf Grundlage der Reisedaten. Wenn du aktuelle Infos brauchst (Öffnungszeiten, Wetter, Erfahrungsberichte, Preise), nutze die Websuche und nenne die Quelle.
- Feste Zeiten (Schiff, Flug, Check-out …) brauchen genug Puffer – das Schiff oder der Flieger wartet nicht. Weise auf Risiken hin.
- Achte auf die Kinder (Alter), Tauchen (Flugverbot nach dem Tauchen, Tiefen), Fahrzeiten und Kosten.
- Änderungen machst du nicht selbst: Schlage sie mit den Werkzeugen vor (ausflug_vorschlagen, aenderung_vorschlagen, station_vorschlagen, hotel_vorschlagen). Die Familie übernimmt sie mit einem Klick. Sag im Text kurz, was du vorgeschlagen hast.
- Verwende für Änderungen die IDs aus den Reisedaten. Erfinde keine Preise oder Links – lass sie leer, wenn du sie nicht sicher weißt.`;

const FELDER = ["titel", "status", "kategorie", "beginn", "dauerMin", "preisErw", "preisKind", "preisGruppe", "zusatzkosten", "interesse", "link", "notiz", "name", "land", "ankunft", "abfahrt", "allesAnBord", "anreise", "abreise", "preis", "preisArt", "verpflegung"];

const WERKZEUGE = [
  {
    name: "ausflug_vorschlagen",
    description: "Schlägt einen neuen Ausflug für einen Tag/Hafen der Reise vor. Die Familie entscheidet in der App, ob er übernommen wird.",
    strict: true,
    input_schema: obj({
      stationId: { type: "string", description: "ID des Tages/Hafens aus den Reisedaten" },
      titel: str,
      kategorie: { type: "string", enum: Object.keys(KATEGORIEN) },
      quelle: { type: "string", enum: Object.keys(QUELLEN) },
      beginn: { type: "string", description: "HH:MM oder leer" },
      dauerMin: zahlOderNull,
      preisErw: zahlOderNull,
      preisKind: zahlOderNull,
      link: { type: "string", description: "Nur echte, bekannte Links, sonst leer" },
      zielName: { type: "string", description: "Ort/Treffpunkt für die Karte, z. B. „Loro Parque, Puerto de la Cruz“, oder leer" },
      notiz: str,
      begruendung: { type: "string", description: "Ein Satz, warum der Ausflug passt" },
    }),
  },
  {
    name: "aenderung_vorschlagen",
    description: "Schlägt Änderungen an einem vorhandenen Ausflug, Tag/Hafen oder Hotel vor (z. B. Status, Beginn, Preis, Notiz).",
    strict: true,
    input_schema: obj({
      zielArt: { type: "string", enum: ["ausflug", "station", "hotel"] },
      zielId: str,
      aenderungen: { type: "array", items: obj({ feld: { type: "string", enum: FELDER }, wert: { type: "string", description: "Neuer Wert als Text (Zahlen mit Punkt)" } }) },
      begruendung: str,
    }),
  },
  {
    name: "station_vorschlagen",
    description: "Schlägt einen neuen Reisetag vor (Hafen, Seetag oder Tag an Land).",
    strict: true,
    input_schema: obj({ datum: str, art: { type: "string", enum: ["hafen", "seetag", "ort"] }, name: str, land: str, ankunft: str, abfahrt: str, allesAnBord: str, notiz: str, begruendung: str }),
  },
  {
    name: "hotel_vorschlagen",
    description: "Schlägt eine Unterkunft zum Vergleichen vor.",
    strict: true,
    input_schema: obj({ name: str, ort: str, anreise: str, abreise: str, preis: zahlOderNull, preisArt: { type: "string", enum: ["nacht", "gesamt"] }, verpflegung: { type: "string", enum: ["", "ohne", "fruehstueck", "halbpension", "vollpension", "all"] }, link: str, notiz: str, begruendung: str }),
  },
  { type: "web_search_20260209", name: "web_search", max_uses: 5, user_location: { type: "approximate", country: "DE" } },
];

/** Kompakter Stand der Reise für die KI (ohne Fotos, ohne interne Felder). */
export function reiseStand(reise, beitraege, benutzer) {
  const personen = reise.personen ?? [];
  const namen = Object.fromEntries(benutzer.map((b) => [b.id, b.name]));
  const stationen = [...(reise.haefen ?? [])].sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
  return {
    name: reise.name,
    art: reise.art ?? "kreuzfahrt",
    schiff: reise.schiff ?? "",
    reiseart: REISEARTEN[reise.art ?? "kreuzfahrt"] ?? "",
    personen: personen.map((p) => ({ name: p.name, typ: p.typ, alter: p.alter || null, familie: (reise.familien ?? []).find((f) => f.id === p.familie)?.name ?? "" })),
    stationen: stationen.map((h) => {
      const fest = festeZeit(h, reise);
      return { id: h.id, datum: h.datum, art: h.art ?? (h.seetag ? "seetag" : "hafen"), name: h.name, land: h.land ?? "", ankunft: h.ankunft ?? "", abfahrt: h.abfahrt ?? "", allesAnBord: h.allesAnBord ?? "", festeZeit: fest ? `${fest.zeit} ${fest.titel}` : "", notiz: h.notiz ?? "" };
    }),
    // Nur Fahrplandaten – keine Buchungsnummern
    verbindungen: (reise.verbindungen ?? []).filter((v) => v.status !== "verworfen").map((v) => ({ art: VERKEHRSMITTEL[v.art]?.name ?? v.art, titel: v.titel ?? "", von: v.von ?? "", nach: v.nach ?? "", datum: v.datum, abfahrt: v.abZeit ?? "", ankunft: [v.anDatum, v.anZeit].filter(Boolean).join(" "), status: v.status })),
    // Ohne WLAN-Passwort, Zugangscodes, Telefon und Adresse
    hotels: (reise.hotels ?? []).map((h) => ({ id: h.id, name: h.name, ort: h.ort ?? "", anreise: h.anreise ?? "", abreise: h.abreise ?? "", checkin: h.checkin ?? "", checkout: h.checkout ?? "", status: h.status, verpflegung: h.verpflegung ?? "", kosten: hotelKosten(h, personen, zimmerVon(reise, h.id)).summe, notiz: h.notiz ?? "" })),
    ausfluege: (reise.ausfluege ?? []).map((a) => {
      const h = stationen.find((s) => s.id === a.hafenId);
      const z = zeitplan(a, h, reise);
      const k = ausflugKosten(a, personen);
      const bew = beitraege.bewertungen.filter((b) => b.zielArt === "ausflug" && b.zielId === a.id);
      return {
        id: a.id,
        stationId: a.hafenId,
        titel: a.titel,
        kategorie: a.kategorie ?? "ausflug",
        anbieter: a.quelle,
        status: a.status,
        beginn: a.beginn ?? "",
        dauerMin: a.dauerMin ?? null,
        wegAbStartMin: a.quelle === "schiff" ? 0 : a.fahrzeitMin ?? null,
        startpunkt: startpunkt(h, reise.hotels)?.name ?? "",
        preisErw: a.preisErw ?? null,
        preisKind: a.preisKind ?? null,
        kostenGesamt: k.summe,
        teilnehmer: personen.filter((p) => (a.teilnehmer ?? []).includes(p.id)).map((p) => p.name),
        pufferBisFesteZeitMin: z.puffer,
        festeZeit: z.fest ? `${z.fest.zeit} ${z.fest.titel}` : "",
        warnungen: z.warnungen,
        interesse: a.interesse ?? 3,
        link: a.link ?? "",
        notiz: a.notiz ?? "",
        bewertungen: bew.map((b) => ({ von: namen[b.autorId] ?? "", sterne: b.sterne, text: b.text ?? "" })),
      };
    }),
    tauchgaenge: beitraege.tauchgaenge.map((t) => ({ datum: t.datum, tauchplatz: t.tauchplatz, maxTiefe: t.maxTiefe, tauchzeitMin: t.tauchzeitMin, taucher: namen[t.taucherId] ?? "" })),
    sonstigeKosten: (reise.kosten ?? []).map((k) => ({ titel: k.titel, betrag: k.betrag, status: k.status })),
  };
}

const chatDatei = (userId, reiseId) => path.join(DATA_DIR, "chats", `${userId}_${reiseId}.json`);
const LEERER_CHAT = { nachrichten: [], anzeige: [] };
const STAND_MARKE = "Aktueller Stand der Reise (JSON):";

export async function chatLesen(userId, reiseId) {
  return (await lesen(chatDatei(userId, reiseId), LEERER_CHAT)).anzeige;
}

export async function chatLoeschen(userId, reiseId) {
  await exklusiv(chatDatei(userId, reiseId), () => schreiben(chatDatei(userId, reiseId), LEERER_CHAT));
}

/**
 * Eine Frage an den Assistenten. Der Verlauf wird auf dem Server gespeichert und nur angehängt
 * (nie umgeschrieben), damit die Denkschritte der KI gültig bleiben und der Cache greift.
 */
export async function chatFragen({ userId, reiseId, frage, stand }) {
  if (!client) throw fehler(501, "Keine KI hinterlegt (ANTHROPIC_API_KEY fehlt).");
  frage = String(frage ?? "").trim().slice(0, 8000);
  if (!frage) throw fehler(400, "Bitte eine Frage eingeben.");
  await mkdir(path.dirname(chatDatei(userId, reiseId)), { recursive: true });
  return exklusiv(chatDatei(userId, reiseId), async () => {
    const chat = await lesen(chatDatei(userId, reiseId), LEERER_CHAT);
    // Sehr lange Gespräche (z. B. viele Websuchen) neu beginnen – die Anzeige bleibt erhalten.
    if (JSON.stringify(chat.nachrichten).length > 1_500_000) {
      chat.nachrichten = [];
      chat.standHash = null;
      chat.anzeige.push({ rolle: "hinweis", text: "Das Gespräch war sehr lang – die KI beginnt ab hier neu (mit dem aktuellen Reisestand).", zeit: new Date().toISOString() });
    }
    const standText = JSON.stringify(stand);
    const standHash = createHash("sha256").update(standText).digest("hex");
    const inhalt = [];
    if (chat.standHash !== standHash) inhalt.push({ type: "text", text: `${STAND_MARKE}\n${standText}` });
    inhalt.push({ type: "text", text: frage });
    const nachrichten = [...chat.nachrichten, { role: "user", content: inhalt }];
    const vorschlaege = [];
    const texte = [];
    try {
      for (let runde = 0; runde < 6; runde++) {
        const msg = pruefeAntwort(
          await client.beta.messages.create({
            ...FALLBACK,
            model: MODELL,
            max_tokens: 16000,
            system: SYSTEM_CHAT,
            tools: WERKZEUGE,
            output_config: { effort: "medium" },
            cache_control: { type: "ephemeral" },
            messages: nachrichten,
          }),
        );
        nachrichten.push({ role: "assistant", content: msg.content });
        const t = textAus(msg);
        if (t) texte.push(t);
        if (msg.stop_reason === "pause_turn") continue;
        const aufrufe = msg.content.filter((b) => b.type === "tool_use");
        if (msg.stop_reason !== "tool_use" || !aufrufe.length) break;
        nachrichten.push({
          role: "user",
          content: aufrufe.map((a) => {
            vorschlaege.push({ id: a.id, typ: a.name, daten: a.input });
            return { type: "tool_result", tool_use_id: a.id, content: "Vorschlag wird der Familie in der App angezeigt; sie entscheidet, ob er übernommen wird." };
          }),
        });
      }
    } catch (e) {
      throw kiFehler(e);
    }
    const antwort = texte.join("\n\n") || (vorschlaege.length ? "Hier sind meine Vorschläge:" : "Keine Antwort erhalten.");
    const zeit = new Date().toISOString();
    chat.nachrichten = nachrichten;
    chat.standHash = standHash;
    chat.anzeige.push({ rolle: "nutzer", text: frage, zeit }, { rolle: "ki", text: antwort, vorschlaege, zeit });
    await schreiben(chatDatei(userId, reiseId), chat);
    return { antwort, vorschlaege };
  });
}

// ---------- Tagesbriefing und Ausflug-Check ----------

const WEB_SUCHE = { type: "web_search_20260209", name: "web_search", max_uses: 4, user_location: { type: "approximate", country: "DE" } };
const WEB_ABRUF = { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3, max_content_tokens: 20000 };

/** Ruft Claude mit Werkzeugen auf, bis die Antwort fertig ist (Websuche kann pausieren). */
async function mitWerkzeugen({ system, inhalt, tools, effort = "medium", fertig }) {
  const nachrichten = [{ role: "user", content: inhalt }];
  const texte = [];
  for (let runde = 0; runde < 6; runde++) {
    const msg = pruefeAntwort(
      await client.beta.messages.create({ ...FALLBACK, model: MODELL, max_tokens: 16000, system, tools, output_config: { effort }, messages: nachrichten }),
    );
    nachrichten.push({ role: "assistant", content: msg.content });
    const t = textAus(msg);
    if (t) texte.push(t);
    if (msg.stop_reason === "pause_turn") continue;
    const aufrufe = msg.content.filter((b) => b.type === "tool_use");
    const ergebnis = fertig?.(aufrufe);
    if (ergebnis) return { ergebnis, texte };
    if (msg.stop_reason !== "tool_use" || !aufrufe.length) break;
    nachrichten.push({ role: "user", content: aufrufe.map((a) => ({ type: "tool_result", tool_use_id: a.id, content: "Unbekanntes Werkzeug.", is_error: true })) });
  }
  return { ergebnis: null, texte };
}

const SYSTEM_BRIEFING = `Du schreibst das Tagesbriefing für eine Familie (oder mehrere Familien) auf Reise – Kreuzfahrt, Hotel-, Städte-, Ski- oder Campingurlaub, Roadtrip oder Tagesausflug –, das sie morgens aufs Handy bekommt. Deutsch, freundlich, knapp, gut lesbar auf dem Handy.

Aufbau (genau diese Überschriften mit „## “, nur wenn es etwas dazu zu sagen gibt):
## Heute
Ort, Ankunft/Abfahrt bzw. Verbindungen des Tages, die feste Zeit (z. B. „Alle an Bord“, Check-out, Abflug), Wetter in einem Satz.
## Ablauf
Zeitlich sortiert als Liste („- 09:30 …“), mit Treffpunkt und wann man spätestens zurück sein muss.
## Rechtzeitig zurück
Konkrete Uhrzeit, wann man spätestens zurück zum Schiff, zur Unterkunft oder zum Flughafen/Bahnhof aufbrechen sollte (mit Reserve). Warnung, wenn ein Ausflug knapp ist. Bei Roadtrips: Fahrstrecke des Tages und Pausen.
## Mitnehmen
Kurze Liste passend zum Tag (z. B. Bordkarte, Ausweis, Tickets, Bargeld in Landeswährung, Badesachen, Skipass, Tauchschein).
## Tipps
2–4 kurze, aktuelle Tipps zum Ort (Landeswährung, Trinkgeld, Tender, Sicherheit, Öffnungszeiten). Nutze die Websuche für Aktuelles und nenne bei wichtigen Angaben die Quelle in Klammern.

Regeln: Nur Fakten aus den Reisedaten oder der Websuche, nichts erfinden. Kein Markdown außer „## “-Überschriften, „- “-Listen und **fett**. Höchstens ca. 250 Wörter.`;

export async function tagesbriefing({ stand, hafenId, wetter, heute }) {
  if (!client) throw fehler(501, "Keine KI hinterlegt (ANTHROPIC_API_KEY fehlt).");
  const tag = stand.stationen.find((s) => s.id === hafenId);
  if (!tag) throw fehler(404, "Tag nicht gefunden.");
  const inhalt = [
    { type: "text", text: `Reisedaten (JSON):\n${JSON.stringify({ ...stand, ausfluege: stand.ausfluege.filter((a) => a.stationId === hafenId && a.status !== "verworfen") })}` },
    { type: "text", text: `Heute ist ${heute}. Schreibe das Briefing für den Tag ${tag.datum} (${tag.art === "seetag" ? "Seetag" : tag.name}${tag.land ? `, ${tag.land}` : ""}).${wetter ? `\nWettervorhersage: ${wetter}` : ""}` },
  ];
  try {
    const { texte } = await mitWerkzeugen({ system: SYSTEM_BRIEFING, inhalt, tools: [WEB_SUCHE], effort: "medium" });
    const text = texte.at(-1) ?? "";
    if (!text) throw fehler(502, "Die KI hat kein Briefing geliefert. Bitte erneut versuchen.");
    return text.slice(0, 8000);
  } catch (e) {
    throw kiFehler(e);
  }
}

const CHECK_ERGEBNIS = {
  name: "ergebnis_melden",
  description: "Meldet das Ergebnis der Prüfung. Am Ende genau einmal aufrufen.",
  strict: true,
  input_schema: obj({
    ampel: { type: "string", enum: ["gruen", "gelb", "rot"], description: "gruen = sicher zurück, gelb = knapp/unsicher, rot = zu riskant" },
    zusammenfassung: { type: "string", description: "1–2 Sätze" },
    rueckkehr: { type: "string", description: "Voraussichtliche Rückkehr am Schiff/Startpunkt/Ziel als HH:MM, oder leer" },
    pufferMin: zahlOderNull,
    risiken: { type: "array", items: str, description: "Kurze Stichpunkte" },
    empfehlung: str,
    quellen: { type: "array", items: str, description: "Geprüfte Links" },
  }),
};

const SYSTEM_CHECK = `Du prüfst für eine Familie auf Reise, ob ein Ausflug (z. B. von GetYourGuide, Viator oder auf eigene Faust) sicher vor der festen Zeit des Tages zurück ist – „Alle an Bord“ bei Kreuzfahrten (das Schiff wartet bei fremden Anbietern nicht), sonst z. B. Check-out, Abflug, Zug oder Fähre.

Vorgehen:
1. Lies die Ausflugsdaten (Beginn, Dauer, Treffpunkt, Weg ab Schiff, berechneter Puffer).
2. Wenn ein Link angegeben ist, rufe die Seite ab (web_fetch) und prüfe Dauer, Startzeiten, Treffpunkt, Abholung am Hafen, Hinweise für Kreuzfahrtgäste und „Rückkehr zum Schiff garantiert“. Nutze bei Bedarf die Websuche (Erfahrungsberichte, Entfernung Hafen–Treffpunkt, Verkehr).
3. Rechne: Weg zum Treffpunkt + Dauer + Rückweg + Reserve gegen die feste Zeit (im Feld „festeZeit“). Unter 60 Minuten Reserve ist „gelb“, keine Reserve oder unklare Rückkehr ist „rot“. Gibt es keine feste Zeit, prüfe Öffnungszeiten, Dauer und ob der Ablauf realistisch ist.
4. Rufe zum Schluss genau einmal ergebnis_melden auf. Antworte auf Deutsch, nichts erfinden – Unklares als Risiko nennen.`;

export async function ausflugPruefen({ stand, ausflugId }) {
  if (!client) throw fehler(501, "Keine KI hinterlegt (ANTHROPIC_API_KEY fehlt).");
  const a = stand.ausfluege.find((x) => x.id === ausflugId);
  if (!a) throw fehler(404, "Ausflug nicht gefunden.");
  const tag = stand.stationen.find((s) => s.id === a.stationId);
  const inhalt = [
    { type: "text", text: `Tag (JSON):\n${JSON.stringify(tag)}\n\nAusflug (JSON):\n${JSON.stringify(a)}\n\nPersonen: ${JSON.stringify(stand.personen)}` },
    { type: "text", text: `Prüfe diesen Ausflug${a.link ? ` (Link: ${a.link})` : ""}.` },
  ];
  try {
    const { ergebnis, texte } = await mitWerkzeugen({
      system: SYSTEM_CHECK,
      inhalt,
      tools: [WEB_SUCHE, WEB_ABRUF, CHECK_ERGEBNIS],
      effort: "medium",
      fertig: (aufrufe) => aufrufe.find((x) => x.name === "ergebnis_melden")?.input,
    });
    if (!ergebnis) throw fehler(502, texte.at(-1) ? `Die KI hat kein eindeutiges Ergebnis gemeldet: ${texte.at(-1).slice(0, 300)}` : "Die KI hat kein Ergebnis geliefert. Bitte erneut versuchen.");
    return {
      ampel: ["gruen", "gelb", "rot"].includes(ergebnis.ampel) ? ergebnis.ampel : "gelb",
      zusammenfassung: String(ergebnis.zusammenfassung ?? "").slice(0, 1000),
      rueckkehr: /^\d{1,2}:\d{2}$/.test(ergebnis.rueckkehr ?? "") ? ergebnis.rueckkehr : "",
      pufferMin: Number.isFinite(ergebnis.pufferMin) ? Math.round(ergebnis.pufferMin) : null,
      risiken: (ergebnis.risiken ?? []).slice(0, 8).map((x) => String(x).slice(0, 300)),
      empfehlung: String(ergebnis.empfehlung ?? "").slice(0, 1000),
      quellen: (ergebnis.quellen ?? []).filter((q) => /^https?:\/\//.test(q)).slice(0, 5),
    };
  } catch (e) {
    throw kiFehler(e);
  }
}

// ---------- Gute-Nacht-Geschichte und Ideen für die nächste Reise ----------

export async function geschichte({ reise, tag, kinder, tiere, tagebuch }) {
  if (!client) throw fehler(501, "Keine KI hinterlegt (ANTHROPIC_API_KEY fehlt).");
  const ausfluege = (reise.ausfluege ?? []).filter((a) => a.hafenId === tag.id && a.status === "gebucht").map((a) => a.titel);
  const daten = { reise: reise.art ?? "kreuzfahrt", schiff: reise.schiff ?? "", tag: { datum: tag.datum, seetag: tag.art === "seetag", ort: tag.name, land: tag.land ?? "" }, erlebnisse: ausfluege, kinder, gesehene_tiere: tiere, aus_dem_tagebuch: tagebuch.slice(0, 4) };
  try {
    const msg = pruefeAntwort(
      await client.beta.messages.create({
        ...FALLBACK,
        model: MODELL,
        max_tokens: 4000,
        output_config: { effort: "low" },
        system: "Du schreibst liebevolle Gute-Nacht-Geschichten für Kinder (3–10 Jahre) auf Deutsch, zum Vorlesen. Die Kinder sind die Helden, der Tag ihrer Reise ist die Grundlage (Ort, Erlebnisse, Tiere). Etwas Fantasie ist erwünscht, aber nichts Gruseliges, keine Gefahr, ruhiges, schläfriges Ende. 250–400 Wörter, kurze Sätze, ein Titel in der ersten Zeile mit „## “. Keine weitere Formatierung.",
        messages: [{ role: "user", content: `Heute (JSON):\n${JSON.stringify(daten)}\n\nSchreibe die Gute-Nacht-Geschichte.` }],
      }),
    );
    return textAus(msg).slice(0, 6000);
  } catch (e) {
    throw kiFehler(e);
  }
}

export async function naechsteReise({ reisen, kinder, wunsch, heute }) {
  if (!client) throw fehler(501, "Keine KI hinterlegt (ANTHROPIC_API_KEY fehlt).");
  try {
    const { texte } = await mitWerkzeugen({
      system: "Du bist Reiseberater für eine Familie. Aus ihren bisherigen Reisen (Orte, Bewertungen mit Sternen, Tauchgänge) erkennst du, was ihnen gefällt, und schlägst 3–5 passende nächste Reiseziele vor – mit Reiseart (z. B. Kreuzfahrt, Hotel, Rundreise), beste Reisezeit, warum es passt (Bezug auf ihre Bewertungen), Highlights für Kinder und ggf. Tauchen, grobe Kosten-Einschätzung. Nutze bei Bedarf die Websuche für aktuelle Infos (z. B. neue Kreuzfahrtrouten). Deutsch, gut lesbar: „## “ je Vorschlag, „- “ für Stichpunkte, **fett** sparsam.",
      inhalt: [{ type: "text", text: `Heute ist ${heute}.\nBisherige Reisen (JSON):\n${JSON.stringify(reisen)}\nKinder: ${JSON.stringify(kinder)}${wunsch ? `\nWunsch der Familie: ${wunsch}` : ""}` }],
      tools: [WEB_SUCHE],
      effort: "medium",
    });
    const text = texte.at(-1) ?? "";
    if (!text) throw fehler(502, "Die KI hat keine Vorschläge geliefert. Bitte erneut versuchen.");
    return text.slice(0, 12000);
  } catch (e) {
    throw kiFehler(e);
  }
}

// ---------- Beitragstexte für Social Media ----------

export async function beitragstext({ inhalt, plattform, sprache, creatorName }) {
  if (!client) throw fehler(501, "Keine KI hinterlegt (ANTHROPIC_API_KEY fehlt).");
  const kurz = {
    titel: inhalt.titel,
    unterzeile: inhalt.unterzeile,
    kategorie: inhalt.kategorie,
    sterne: inhalt.sterne,
    bewertungen: (inhalt.bewertungen ?? []).map((b) => ({ sterne: b.sterne, text: b.text })),
    tauchgang: inhalt.tauchgang ? { maxTiefe: inhalt.tauchgang.maxTiefe, tauchzeitMin: inhalt.tauchgang.tauchzeitMin, wasserTemp: inhalt.tauchgang.wasserTemp, sicht: inhalt.tauchgang.sicht, sichtungen: inhalt.tauchgang.sichtungen } : undefined,
    eintraege: inhalt.eintraege?.slice(0, 15).map((e) => ({ titel: e.titel, unterzeile: e.unterzeile, sterne: e.sterne, texte: e.bewertungen.map((b) => b.text).filter(Boolean).slice(0, 2) })),
  };
  const plattformText = { tripadvisor: "Tripadvisor-Bewertung (Überschrift in der ersten Zeile, dann 4–8 Sätze sachlich und hilfreich für andere Familien, keine Hashtags, keine Emojis)", google: "Google-Bewertung (3–6 Sätze, sachlich, hilfreich, keine Hashtags)", holidaycheck: "HolidayCheck-Bewertung (Überschrift, dann Absätze zu Lage, Angebot, Kinderfreundlichkeit, Preis-Leistung; keine Hashtags)", instagram: "Instagram (Caption, Emojis erlaubt, 15–25 Hashtags am Ende)", tiktok: "TikTok (sehr kurz, 3–6 Hashtags)", facebook: "Facebook (2–4 Absätze, wenige Hashtags)", x: "X/Twitter (max. 270 Zeichen inkl. 2–3 Hashtags)", youtube: "YouTube (Titel in der ersten Zeile, dann Beschreibung und Hashtags)" }[plattform] ?? "Instagram";
  try {
    const msg = pruefeAntwort(
      await client.beta.messages.create({
        ...FALLBACK,
        model: MODELL,
        max_tokens: 4000,
        output_config: { effort: "low" },
        system: ["tripadvisor", "google", "holidaycheck"].includes(plattform)
          ? "Du schreibst ehrliche, hilfreiche Bewertungen für Bewertungsportale aus Sicht einer reisenden Familie. Nur auf Basis der gelieferten Bewertungen und Sterne – nichts erfinden, keine Übertreibungen. Gib nur den fertigen Text aus, ohne Vorrede."
          : "Du schreibst authentische Social-Media-Beiträge für Reise-Content-Creator (Familie, viel unterwegs, taucht gern). Nur auf Basis der gelieferten Erlebnisse – nichts erfinden. Gib nur den fertigen Beitragstext aus, ohne Vorrede.",
        messages: [{ role: "user", content: `Plattform: ${plattformText}\nSprache: ${sprache === "en" ? "Englisch" : "Deutsch"}${creatorName ? `\nAccount-Name: ${creatorName}` : ""}\n\nErlebnis (JSON):\n${JSON.stringify(kurz)}` }],
      }),
    );
    return textAus(msg);
  } catch (e) {
    throw kiFehler(e);
  }
}
