// Ganzen Reiseplan aus Text lesen – ohne KI. Gedacht für Pläne wie aus ChatGPT oder eigenen Notizen:
//   21.03.2027 – Castries, St. Lucia
//   Liegezeit: 07:30–19:00
//   AUSFLUG GEBUCHT:
//   TUI Cruises – Delfinbeobachtung
//   Zeit: 08:15–11:45
//   Preis gesamt für 6 Personen: 275 €
// Ergebnis hat dieselbe Form wie der KI-Import (name, art, schiff, personen, stationen, ausfluege …).
import { zahl, zeitZuMin, KATEGORIEN } from "./rechnen.js";

/** Grober Kurs für Angebote nur in US-Dollar (wird in der Notiz vermerkt). */
export const USD_IN_EUR = 0.89;

const ZEIT = String.raw`(\d{1,2}[:.]\d{2})`;
const STRICH = String.raw`\s*[–—-]\s*`;
const DATUM_ZEILE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s*[–—-]\s*(?!\d{1,2}\.\d{1,2}\.\d{2,4})(.+)$/;
const zeitNorm = (z) => (z ? z.replace(".", ":").padStart(5, "0") : "");

/** Überschrift wie „AUSFLUG GEBUCHT:“ oder „PRIVATE ALTERNATIVE – KOOL DOMINICA TOURS:“ */
function istUeberschrift(zeile) {
  const buchstaben = zeile.replace(/[^A-Za-zÄÖÜäöüß]/g, "");
  if (buchstaben.length < 5) return false;
  const gross = buchstaben.replace(/[^A-ZÄÖÜ]/g, "").length;
  return gross / buchstaben.length > 0.8 && /^[A-ZÄÖÜ]/.test(zeile);
}

function statusAus(ueberschrift) {
  const u = ueberschrift.toUpperCase();
  if (/ALTERNATIV|ANGEFRAGT|OPTION|IDEE/.test(u)) return "idee";
  if (/GEBUCHT|RESERVIERT|BEZAHLT/.test(u)) return "gebucht";
  if (/FEST|GEPLANT|ANSCHLIESSEND|ANSCHLIEẞEND/.test(u)) return "favorit";
  return "idee";
}

function kategorieAus(text) {
  const t = text.toLowerCase();
  const regeln = [
    ["tauchen", /tauch|dive|diver|taucher/],
    ["schnorcheln", /schnorchel|snorkel/],
    ["tiere", /delfin|\bwale?\b|walbeobacht|walsafari|rochen|stingray|leguan|schildkröt|schildkroet|zoo|tierpark/],
    ["boot", /boot|katamaran|segel|bootstour|fähre/],
    ["natur", /wasserfall|falls|krater|gorge|hot springs|schwefel|regenwald|vulkan|wander|natur|park/],
    ["strand", /strand|beach/],
    ["stadt", /stadt|festung|museum|filmset|altstadt|kirche|markt/],
    ["bord", /friseur|\bspa\b|massage|wellness|show|dinner|restaurant|kinderclub|an bord|bordprogramm|kurs\b/],
  ];
  return regeln.find(([, re]) => re.test(t))?.[0] ?? "ausflug";
}

function quelleAus(text) {
  if (/\bTUI\b|Mein Schiff|Schiffsausflug/i.test(text)) return "schiff";
  if (/getyourguide/i.test(text)) return "getyourguide";
  if (/viator/i.test(text)) return "viator";
  if (/tiqets/i.test(text)) return "tiqets";
  if (/civitatis/i.test(text)) return "civitatis";
  return "sonstige";
}

/** Beträge einer Zeile: [{ betrag, waehrung }] – „ca.“, „etwa“, Spannen (nimmt den höheren Wert). */
function betraege(zeile) {
  const out = [];
  const re = /(?:ca\.?|etwa|ungefähr|rund)?\s*(\d{1,5}(?:[.,]\d{1,2})?)(?:\s*[–-]\s*(\d{1,5}(?:[.,]\d{1,2})?))?\s*(€|EUR|Euro|USD|US-Dollar|\$)/gi;
  for (const m of zeile.matchAll(re)) {
    const betrag = zahl(m[2] ?? m[1]);
    if (betrag == null) continue;
    out.push({ betrag, waehrung: /usd|dollar|\$/i.test(m[3]) ? "USD" : "EUR" });
  }
  const vorDollar = /\$\s*(\d{1,5}(?:[.,]\d{1,2})?)/g;
  for (const m of zeile.matchAll(vorDollar)) out.push({ betrag: zahl(m[1]), waehrung: "USD" });
  return out;
}

const inEuro = (b) => (b.waehrung === "EUR" ? b.betrag : Math.round(b.betrag * USD_IN_EUR * 100) / 100);
const bevorzugtEuro = (liste) => liste.find((b) => b.waehrung === "EUR") ?? liste[0];

/** Preise eines Ausflugs aus seinen Zeilen. */
function preiseAus(zeilen) {
  let gesamt = null;
  let erw = null;
  let kind = null;
  let umgerechnet = false;
  let anzahl = null;
  for (let i = 0; i < zeilen.length; i++) {
    const z = zeilen[i];
    if (/\/\s*\d+\s*(Min|Minuten|Std)/i.test(z)) continue; // Preistabellen wie „25 USD / 15 Minuten“
    if (/Eintritt|Trinkgeld|Transport|Taxi:/i.test(z) && !/gesamt/i.test(z)) continue;
    let b = betraege(z);
    // Betrag in der nächsten Zeile („Gesamtpreis:“ ⏎ „610 USD, ca. 544 €“)
    if (!b.length && /:$/.test(z) && /gesamt/i.test(z) && zeilen[i + 1]) b = betraege(zeilen[i + 1]);
    if (!b.length) continue;
    const wahl = bevorzugtEuro(b);
    const fuer = /f(?:ü|ue)r\s+(\d+)\s+(?:Person|Personen|Taucher|Teilnehmer|Erwachsene)/i.exec(z);
    if (fuer && !/f(?:ü|ue)r\s+\d+\s+Erwachsene\s*\+/i.test(z)) anzahl = Number(fuer[1]);
    if (/gesamt|insgesamt|für alle|für unsere gruppe|f(?:ü|ue)r\s+\d+\s+(Person|Personen|Taucher|Teilnehmer)/i.test(z) || (/^(Preis|Angebot|Bisheriges Angebot)/i.test(z) && /für die (private )?Tour|privat/i.test(z))) {
      gesamt = inEuro(wahl);
      umgerechnet = wahl.waehrung !== "EUR";
    } else if (/kind/i.test(z) && /pro Person|p\.\s?P\.|je/i.test(z) && !/Eintritt/i.test(z)) {
      kind ??= inEuro(wahl);
      umgerechnet ||= wahl.waehrung !== "EUR";
    } else if (/pro Person|p\.\s?P\.|Erwachsene/i.test(z)) {
      erw ??= inEuro(wahl);
      umgerechnet ||= wahl.waehrung !== "EUR";
    } else if (gesamt == null && erw == null) {
      // Ohne Hinweis: als Preis für die ganze Gruppe werten (so stehen Familienpläne meist da)
      gesamt = inEuro(wahl);
      umgerechnet = wahl.waehrung !== "EUR";
    }
  }
  const kostenlosBis = zeilen.map((z) => /(\d{1,2})-?jährige[sr]? Kind kostenlos|Kinder unter (\d{1,2}) (Jahren )?(frei|kostenlos)/i.exec(z)).find(Boolean);
  return {
    preisArt: gesamt != null ? "gruppe" : "person",
    preisGruppe: gesamt,
    preisErw: gesamt != null ? null : erw,
    preisKind: gesamt != null ? null : kind,
    kostenlosBis: kostenlosBis ? Number(kostenlosBis[1] ?? kostenlosBis[2]) + (kostenlosBis[1] ? 1 : 0) : null,
    umgerechnet,
    anzahl,
  };
}

function zeitenAus(zeilen) {
  const text = zeilen.join("\n");
  let beginn = "";
  let dauerMin = null;
  const spanne = new RegExp(`(?:Zeit|Uhrzeit)[^:\\n]*:?\\s*${ZEIT}${STRICH}(?:ca\\.?\\s*)?${ZEIT}`, "i").exec(text);
  if (spanne) {
    beginn = zeitNorm(spanne[1]);
    const d = zeitZuMin(zeitNorm(spanne[2])) - zeitZuMin(beginn);
    if (d > 0) dauerMin = d;
  } else {
    const start = new RegExp(`(?:Start|Beginn|Treffpunkt|Abfahrt|Abholung)[^:\\n]*:\\s*${ZEIT}`, "i").exec(text);
    if (start) beginn = zeitNorm(start[1]);
  }
  if (dauerMin == null) {
    const d = /Dauer[^:\n]*:\s*(?:ca\.?\s*)?(\d{1,2}(?:[.,]\d)?)\s*(?:Std|Stunden|h\b)/i.exec(text);
    if (d) dauerMin = Math.round(zahl(d[1]) * 60);
  }
  return { beginn, dauerMin };
}

function ausflugAus(ueberschrift, zeilen, datum, ort, seetag = false) {
  const inhalt = zeilen.filter(Boolean);
  if (!inhalt.length) return null;
  const anbieterImKopf = /[–—-]\s*([^:]+):?$/.exec(ueberschrift)?.[1]?.trim();
  let quelle = quelleAus(`${ueberschrift}\n${inhalt.slice(0, 2).join("\n")}`);
  let titel = inhalt[0];
  let rest = inhalt.slice(1);
  // „TUI Cruises – Delfinbeobachtung“
  const mitAnbieter = /^(TUI Cruises|TUI|Mein Schiff|GetYourGuide|Viator|Tiqets|Civitatis)\s*[–—:-]\s*(.+)$/i.exec(titel);
  if (mitAnbieter) titel = mitAnbieter[2];
  // Nur Anbietername in der ersten Zeile („GetYourGuide“) → Titel aus der nächsten Zeile
  else if (/^(GetYourGuide|Viator|Tiqets|Civitatis|TUI Cruises|TUI)$/i.test(titel) && rest.length) {
    titel = rest[0];
    rest = rest.slice(1);
  }
  // Erste Zeile ist ein Anbieter („Ask-Iba Tours & Services“) → was gemacht wird, aus der nächsten Zeile
  const anbieterArtig = (z) => /\b(Tours?|Services|Excursions?|Dive|Divers|Center|Centre|Adventures?|Travel|GmbH|Ltd)\b/i.test(z);
  if (!mitAnbieter && anbieterArtig(titel) && rest.length) {
    titel = anbieterArtig(rest[0]) ? `${titel} / ${rest[0]}` : `${titel}: ${rest[0]}`;
    rest = rest.slice(1);
  }
  if (anbieterImKopf && !/GEBUCHT|GEPLANT|RESERVIERT|ALTERNATIV/i.test(anbieterImKopf)) {
    const name = anbieterImKopf.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
    titel = `${name}: ${titel}`;
  }
  const preise = preiseAus(inhalt);
  const zeiten = zeitenAus(inhalt);
  const kategorie = seetag ? "bord" : kategorieAus(`${titel}\n${rest.join("\n")}`);
  const status = statusAus(ueberschrift);
  const hinweise = [];
  if (/BACKUP/i.test(ueberschrift)) hinweise.push("Backup – stornieren, wenn die bevorzugte Alternative klappt.");
  if (/BEVORZUGT/i.test(ueberschrift)) hinweise.push("Bevorzugte Alternative.");
  if (preise.umgerechnet) hinweise.push(`Preis aus US-Dollar umgerechnet (1 USD ≈ ${String(USD_IN_EUR).replace(".", ",")} €) – bitte prüfen.`);
  if (preise.anzahl) hinweise.push(`Preis gilt für ${preise.anzahl} Teilnehmende – Teilnehmer bitte prüfen.`);
  return {
    datum,
    ort,
    titel: titel.replace(/[.:]$/, ""),
    kategorie: KATEGORIEN[kategorie] ? kategorie : "ausflug",
    quelle,
    status,
    beginn: zeiten.beginn,
    dauerMin: zeiten.dauerMin,
    preisArt: preise.preisArt,
    preisGruppe: preise.preisGruppe,
    preisErw: preise.preisErw,
    preisKind: preise.preisKind,
    kostenlosBis: preise.kostenlosBis,
    anzahl: preise.anzahl,
    interesse: /BEVORZUGT/i.test(ueberschrift) ? 5 : 3,
    link: (inhalt.join(" ").match(/https?:\/\/\S+/) ?? [""])[0],
    notiz: [...hinweise, ...rest].join("\n"),
  };
}

export function reiseplanAusText(text) {
  const zeilen = String(text ?? "").replace(/\r/g, "").split("\n").map((z) => z.trim());
  const plan = { name: "", art: "kreuzfahrt", schiff: "", personen: [], stationen: [], hotels: [], ausfluege: [], kosten: [], hinweise: "" };
  const alles = zeilen.join("\n");

  // Kopf: Name, Schiff, Personen
  const kopfEnde = zeilen.findIndex((z) => DATUM_ZEILE.test(z));
  const kopf = zeilen.slice(0, kopfEnde < 0 ? zeilen.length : kopfEnde).filter(Boolean);
  plan.name = kopf.find((z) => !/^REISE$/i.test(z) && !/^\d{1,2}\.\d{1,2}\.\d{4}/.test(z) && !/Reisegruppe|Erwachsene|Kinder/i.test(z)) ?? "Reise";
  plan.schiff = /Mein Schiff\s*\d+|Mein Schiff (Herz|Relax)/i.exec(alles)?.[0] ?? "";
  if (!/Liegezeit|Seetag|Schiff|Kreuzfahrt|Hafen|Alle an Bord/i.test(alles)) plan.art = "rundreise";
  const erw = /(\d+)\s*Erwachsene/i.exec(kopf.join(" "));
  const kinder = /(\d+)\s*Kind(?:er)?\s*(?:\(([^)]*)\))?/i.exec(kopf.join(" "));
  const alter = kinder?.[2] ? [...kinder[2].matchAll(/\d{1,2}/g)].map((m) => Number(m[0])) : [];
  for (let i = 1; i <= Number(erw?.[1] ?? 0); i++) plan.personen.push({ name: `Erwachsene/r ${i}`, typ: "erwachsen", alter: null });
  for (let i = 1; i <= Number(kinder?.[1] ?? 0); i++) plan.personen.push({ name: `Kind ${i}${alter[i - 1] != null ? ` (${alter[i - 1]})` : ""}`, typ: "kind", alter: alter[i - 1] ?? null });

  // Tage und Ausflüge
  let station = null;
  let ueberschrift = null;
  let block = [];
  const blockAbschliessen = () => {
    if (station && ueberschrift) {
      const a = ausflugAus(ueberschrift, block, station.datum, station.name, station.art === "seetag");
      if (a) plan.ausfluege.push(a);
    } else if (station && block.length) {
      station.notiz = [station.notiz, ...block.filter(Boolean)].filter(Boolean).join("\n");
    }
    ueberschrift = null;
    block = [];
  };
  for (const z of zeilen.slice(kopfEnde < 0 ? zeilen.length : kopfEnde)) {
    const tag = DATUM_ZEILE.exec(z);
    if (tag) {
      blockAbschliessen();
      const [, d, m, y, rest] = tag;
      const datum = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
      const seetag = /^seetag/i.test(rest);
      const [name, ...land] = rest.split(",").map((x) => x.trim());
      station = { datum, art: seetag ? "seetag" : plan.art === "kreuzfahrt" ? "hafen" : "ort", name: seetag ? "Seetag" : name, land: land.join(", "), ankunft: "", abfahrt: "", allesAnBord: "", notiz: "" };
      plan.stationen.push(station);
      continue;
    }
    if (!station) continue;
    const liege = new RegExp(`Liegezeit[^:]*:?\\s*${ZEIT}${STRICH}${ZEIT}`, "i").exec(z);
    if (liege && !ueberschrift) {
      station.ankunft = zeitNorm(liege[1]);
      station.abfahrt = zeitNorm(liege[2]);
      continue;
    }
    const ankunft = new RegExp(`^Ankunft[^:]*:?\\s*${ZEIT}`, "i").exec(z);
    if (ankunft && !ueberschrift) {
      station.ankunft = zeitNorm(ankunft[1]);
      continue;
    }
    const abfahrt = new RegExp(`^Abfahrt( Schiff)?[^:]*:?\\s*${ZEIT}`, "i").exec(z);
    if (abfahrt && !ueberschrift) {
      station.abfahrt = zeitNorm(abfahrt[2]);
      continue;
    }
    const anBord = new RegExp(`Alle an Bord[^:]*:?\\s*${ZEIT}`, "i").exec(z);
    if (anBord) {
      station.allesAnBord = zeitNorm(anBord[1]);
      continue;
    }
    if (istUeberschrift(z)) {
      blockAbschliessen();
      ueberschrift = z;
      continue;
    }
    block.push(z);
  }
  blockAbschliessen();

  const ohnePreis = plan.ausfluege.filter((a) => a.preisGruppe == null && a.preisErw == null).length;
  plan.hinweise = [
    `Ohne KI erkannt: ${plan.stationen.length} Tage, ${plan.ausfluege.length} Ausflüge.`,
    ohnePreis ? `${ohnePreis} Ausflüge ohne erkennbaren Preis.` : "",
    plan.ausfluege.some((a) => /umgerechnet/.test(a.notiz)) ? "Einige Preise wurden aus US-Dollar umgerechnet." : "",
  ].filter(Boolean).join(" ");
  return plan;
}
