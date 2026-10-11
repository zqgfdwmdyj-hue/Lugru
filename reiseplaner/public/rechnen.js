// Reine Rechenfunktionen (Kosten, Zeiten, Puffer) – genutzt von der Oberfläche und den Tests.

export const QUELLEN = {
  schiff: { name: "Mein Schiff", farbe: "#0b5394" },
  getyourguide: { name: "GetYourGuide", farbe: "#ff5533" },
  viator: { name: "Viator", farbe: "#1a8f6b" },
  tiqets: { name: "Tiqets", farbe: "#7b3fb5" },
  civitatis: { name: "Civitatis", farbe: "#e69100" },
  eigene: { name: "Auf eigene Faust", farbe: "#555555" },
  sonstige: { name: "Sonstige", farbe: "#8a6d3b" },
};

export const KATEGORIEN = {
  ausflug: "Ausflug / Rundfahrt",
  tauchen: "Tauchen",
  schnorcheln: "Schnorcheln",
  boot: "Bootstour",
  stadt: "Stadt & Kultur",
  natur: "Natur & Wandern",
  strand: "Strand & Baden",
  tiere: "Tiere & Parks",
  essen: "Essen & Trinken",
  bord: "An Bord (Spa, Friseur, Show …)",
  tickets: "Tickets & Eintritt",
  park: "Freizeitpark",
  ski: "Ski & Snowboard",
  kinderclub: "Kinderclub & Kinderprogramm",
  sport: "Sport & Action",
  sonstiges: "Sonstiges",
};

/** Reisearten – alle außer Kreuzfahrt haben „Tage an Land“ (Startpunkt Unterkunft bzw. Zuhause). */
export const REISEARTEN = {
  kreuzfahrt: "🚢 Kreuzfahrt",
  hotel: "🏖️ Hotel- / Strandurlaub",
  rundreise: "🗺️ Rundreise",
  staedtereise: "🏙️ Städtereise",
  roadtrip: "🚐 Roadtrip / Wohnmobil",
  ferienwohnung: "🏡 Ferienwohnung / Ferienhaus",
  camping: "⛺ Camping",
  ski: "⛷️ Skiurlaub",
  tagesausflug: "🎢 Tagesausflug",
};

/** Verkehrsmittel und wie lange man vorher da sein sollte (Minuten). */
export const VERKEHRSMITTEL = {
  flug: { name: "✈️ Flug", vorlauf: 120, ort: "Flughafen" },
  zug: { name: "🚆 Zug", vorlauf: 15, ort: "Bahnhof" },
  faehre: { name: "⛴️ Fähre", vorlauf: 45, ort: "Fähranleger" },
  bus: { name: "🚌 Bus", vorlauf: 15, ort: "Haltestelle" },
  mietwagen: { name: "🚗 Mietwagen", vorlauf: 0, ort: "Station" },
  transfer: { name: "🚐 Transfer / Taxi", vorlauf: 0, ort: "Treffpunkt" },
  sonstiges: { name: "🧭 Sonstiges", vorlauf: 0, ort: "Treffpunkt" },
};

export const VERPFLEGUNG = {
  ohne: "Nur Übernachtung",
  fruehstueck: "Frühstück",
  halbpension: "Halbpension",
  vollpension: "Vollpension",
  all: "All inclusive",
};

/** Fotos eines Eintrags, die geteilt werden dürfen (ohne 🔒-Fotos, nichts bei privaten Einträgen). */
export function oeffentlicheFotos(eintrag) {
  if (!eintrag || eintrag.privat) return [];
  const privat = new Set(eintrag.fotosPrivat ?? []);
  return (eintrag.fotos ?? []).filter((f) => !privat.has(f));
}

/** Nur http(s)-Links zulassen (kein javascript: o. Ä.). */
export function sichereUrl(url) {
  const u = String(url ?? "").trim();
  return /^https?:\/\//i.test(u) ? u : "";
}

export const STATUS = {
  idee: "Idee",
  favorit: "Favorit",
  gebucht: "Gebucht",
  verworfen: "Verworfen",
};

/** "08:30" → 510 (Minuten seit Mitternacht), sonst null. */
export function zeitZuMin(zeit) {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(zeit ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 510 → "08:30" (über Mitternacht hinaus mit "+1"). */
export function minZuZeit(min) {
  if (min == null || !Number.isFinite(min)) return "–";
  const tag = Math.floor(min / 1440);
  const rest = ((Math.round(min) % 1440) + 1440) % 1440;
  const s = `${String(Math.floor(rest / 60)).padStart(2, "0")}:${String(rest % 60).padStart(2, "0")}`;
  return tag > 0 ? `${s} (+${tag})` : s;
}

/** 135 → "2 Std. 15 Min." */
export function dauerText(min) {
  if (min == null || !Number.isFinite(min) || min <= 0) return "–";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m} Min.`;
  return m ? `${h} Std. ${m} Min.` : `${h} Std.`;
}

export function euro(betrag, waehrung = "EUR") {
  const n = Number.isFinite(betrag) ? betrag : 0;
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: waehrung }).format(n);
}

/** Akzeptiert "59", "59,90", "1.234,50", "59.90" → Zahl oder null. */
export function zahl(wert) {
  if (wert == null || wert === "") return null;
  if (typeof wert === "number") return Number.isFinite(wert) ? wert : null;
  let s = String(wert).replace(/[€\s]/g, "").replace(/EUR/i, "");
  if (!s) return null;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Zählt nur Mitreisende als Kind, wenn sie so eingetragen sind. */
export function istKind(person) {
  return person?.typ === "kind";
}

/**
 * Preis eines Ausflugs für eine Person.
 * - Kinder unter `kostenlosBis` Jahren zahlen nichts.
 * - Ohne Kinderpreis zahlen Kinder den Erwachsenenpreis.
 */
export function preisFuerPerson(ausflug, person) {
  const erw = zahl(ausflug.preisErw) ?? 0;
  if (!istKind(person)) return erw;
  const frei = zahl(ausflug.kostenlosBis);
  const alter = zahl(person.alter);
  if (frei != null && alter != null && alter < frei) return 0;
  return zahl(ausflug.preisKind) ?? erw;
}

/** Teilnehmende Personen (nur solche, die es in der Reise noch gibt). */
export function teilnehmer(ausflug, personen) {
  const ids = new Set(ausflug.teilnehmer ?? []);
  return personen.filter((p) => ids.has(p.id));
}

/** Gesamtpreis eines Ausflugs und Aufteilung je Person. */
export function ausflugKosten(ausflug, personen) {
  const dabei = teilnehmer(ausflug, personen);
  const jePerson = {};
  let summe = 0;
  if (ausflug.preisArt === "gruppe") {
    summe = dabei.length ? zahl(ausflug.preisGruppe) ?? 0 : 0;
    for (const p of dabei) jePerson[p.id] = dabei.length ? summe / dabei.length : 0;
  } else {
    for (const p of dabei) {
      const preis = preisFuerPerson(ausflug, p);
      jePerson[p.id] = preis;
      summe += preis;
    }
  }
  // Zusatzkosten (Taxi, Eintritt vor Ort …) gelten für die ganze Gruppe und werden geteilt.
  const zusatz = dabei.length ? zahl(ausflug.zusatzkosten) ?? 0 : 0;
  summe += zusatz;
  for (const p of dabei) jePerson[p.id] += zusatz / dabei.length;
  const erwachsene = dabei.filter((p) => !istKind(p)).length;
  return { summe: runde(summe), jePerson, anzahl: dabei.length, erwachsene, kinder: dabei.length - erwachsene };
}

function runde(n) {
  return Math.round(n * 100) / 100;
}

/** Wird ein Ausflug in die Kosten eingerechnet? */
export function zaehlt(ausflug, modus) {
  if (modus === "gebucht") return ausflug.status === "gebucht";
  return ausflug.status === "gebucht" || ausflug.status === "favorit";
}

/** Familie (bzw. Haushalt) einer Person; ohne Familie ist jede Person ihre eigene Einheit. */
export function familieVon(person, reise) {
  return person?.familie && (reise?.familien ?? []).some((f) => f.id === person.familie) ? person.familie : `person:${person?.id}`;
}

/** Zimmer/Kabinen einer Unterkunft („schiff“ oder Hotel-ID). */
export const zimmerVon = (reise, unterkunft) => (reise?.zimmer ?? []).filter((z) => z.unterkunft === unterkunft);

/** Gesamtkosten der Reise: je Hafen, je Person, je Familie, nach Status. */
export function reiseKosten(reise) {
  const personen = reise.personen ?? [];
  const ids = new Set(personen.map((p) => p.id));
  const ergebnis = {
    gebucht: 0,
    geplant: 0, // gebucht + Favoriten
    ausfluege: { gebucht: 0, geplant: 0 },
    hotels: { gebucht: 0, geplant: 0 },
    verbindungen: { gebucht: 0, geplant: 0 },
    sonstiges: { gebucht: 0, geplant: 0 },
    jeHafen: {},
    jeHotel: {},
    jePerson: Object.fromEntries(personen.map((p) => [p.id, 0])),
    jeFamilie: {},
    jeQuelle: {},
  };
  // Gemeinsame Kosten: nach Köpfen oder zu gleichen Teilen je Familie (Einstellung der Reise)
  const verteilen = (betrag, nur = null) => {
    const kreis = nur?.length ? personen.filter((p) => nur.includes(p.id)) : personen;
    if (!kreis.length) return;
    if (reise.kostenTeilung === "familie") {
      const gruppen = new Map();
      for (const p of kreis) {
        const f = familieVon(p, reise);
        if (!gruppen.has(f)) gruppen.set(f, []);
        gruppen.get(f).push(p);
      }
      for (const g of gruppen.values()) for (const p of g) ergebnis.jePerson[p.id] += betrag / gruppen.size / g.length;
    } else for (const p of kreis) ergebnis.jePerson[p.id] += betrag / kreis.length;
  };
  const posten = (teil, status, betrag) => {
    teil.geplant += betrag;
    if (status === "gebucht") teil.gebucht += betrag;
  };
  for (const h of reise.hotels ?? []) {
    if (!zaehlt(h, "geplant")) continue;
    const zimmer = zimmerVon(reise, h.id);
    const k = hotelKosten(h, personen, zimmer);
    posten(ergebnis.hotels, h.status, k.summe);
    ergebnis.jeHotel[h.id] = k.summe;
    if (k.jeZimmer) {
      for (const z of zimmer) verteilen(k.jeZimmer[z.id] ?? 0, (z.personen ?? []).filter((p) => ids.has(p)));
    } else verteilen(k.summe);
  }
  // Kabinen mit Preis (Kreuzfahrt) zählen als Unterkunft und gehen an die Bewohner der Kabine
  for (const z of zimmerVon(reise, "schiff")) {
    const k = zahl(z.preis) ?? 0;
    if (!k) continue;
    posten(ergebnis.hotels, "gebucht", k);
    ergebnis.jeHotel.schiff = (ergebnis.jeHotel.schiff ?? 0) + k;
    verteilen(k, (z.personen ?? []).filter((p) => ids.has(p)));
  }
  for (const v of reise.verbindungen ?? []) {
    if (!zaehlt(v, "geplant")) continue;
    const k = zahl(v.preis) ?? 0;
    posten(ergebnis.verbindungen, v.status, k);
    verteilen(k, (v.personen ?? []).filter((p) => ids.has(p)));
  }
  for (const s of reise.kosten ?? []) {
    if (!zaehlt(s, "geplant")) continue;
    const k = zahl(s.betrag) ?? 0;
    posten(ergebnis.sonstiges, s.status, k);
    verteilen(k);
  }
  for (const a of reise.ausfluege ?? []) {
    if (!zaehlt(a, "geplant")) continue;
    const k = ausflugKosten(a, personen);
    posten(ergebnis.ausfluege, a.status, k.summe);
    ergebnis.jeHafen[a.hafenId] = (ergebnis.jeHafen[a.hafenId] ?? 0) + k.summe;
    ergebnis.jeQuelle[a.quelle] = (ergebnis.jeQuelle[a.quelle] ?? 0) + k.summe;
    for (const [id, betrag] of Object.entries(k.jePerson)) ergebnis.jePerson[id] = (ergebnis.jePerson[id] ?? 0) + betrag;
  }
  for (const teil of [ergebnis.ausfluege, ergebnis.hotels, ergebnis.verbindungen, ergebnis.sonstiges]) {
    teil.gebucht = runde(teil.gebucht);
    teil.geplant = runde(teil.geplant);
    ergebnis.gebucht += teil.gebucht;
    ergebnis.geplant += teil.geplant;
  }
  ergebnis.gebucht = runde(ergebnis.gebucht);
  ergebnis.geplant = runde(ergebnis.geplant);
  for (const p of personen) {
    const f = familieVon(p, reise);
    ergebnis.jeFamilie[f] = (ergebnis.jeFamilie[f] ?? 0) + ergebnis.jePerson[p.id];
  }
  for (const f of Object.keys(ergebnis.jeFamilie)) ergebnis.jeFamilie[f] = runde(ergebnis.jeFamilie[f]);
  return ergebnis;
}

/** Anzahl Nächte zwischen zwei ISO-Daten. */
export function naechte(anreise, abreise) {
  if (!anreise || !abreise) return 0;
  const n = Math.round((new Date(`${abreise}T12:00:00`) - new Date(`${anreise}T12:00:00`)) / 86400_000);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Kosten einer Unterkunft: Preis pro Nacht × Nächte × Zimmer oder Gesamtpreis.
 * Haben eingetragene Zimmer eigene Preise, gilt deren Summe (Preisart wie bei der Unterkunft).
 */
export function hotelKosten(hotel, personen = [], zimmerListe = []) {
  const n = naechte(hotel.anreise, hotel.abreise);
  const mitPreis = zimmerListe.filter((z) => zahl(z.preis) != null);
  let summe;
  let jeZimmer = null;
  if (mitPreis.length) {
    jeZimmer = Object.fromEntries(mitPreis.map((z) => [z.id, runde(hotel.preisArt === "nacht" ? zahl(z.preis) * n : zahl(z.preis))]));
    summe = runde(Object.values(jeZimmer).reduce((a, b) => a + b, 0));
  } else {
    const preis = zahl(hotel.preis) ?? 0;
    const zimmer = Math.max(1, zahl(hotel.zimmer) ?? 1);
    summe = runde(hotel.preisArt === "nacht" ? preis * n * zimmer : preis);
  }
  const anzahl = personen.length || 1;
  return {
    summe,
    jeZimmer,
    naechte: n,
    proNacht: n ? runde(summe / n) : null,
    proPersonNacht: n ? runde(summe / n / anzahl) : null,
  };
}

/** Ausgangspunkt eines Tages: der Hafen – oder an Land-Tagen das (gebuchte/Favoriten-)Hotel. */
export function startpunkt(station, hotels = []) {
  if (!station) return null;
  if (station.art === "ort") {
    const rang = { gebucht: 0, favorit: 1, idee: 2 };
    const passend = hotels
      .filter((h) => h.lat != null && h.anreise && h.abreise && h.anreise <= station.datum && station.datum < h.abreise && h.status !== "verworfen")
      .sort((x, y) => (rang[x.status] ?? 3) - (rang[y.status] ?? 3));
    if (passend[0]) return { lat: passend[0].lat, lng: passend[0].lng, name: passend[0].name, hotel: true };
  }
  return station.lat != null ? { lat: station.lat, lng: station.lng, name: station.name, hotel: false } : null;
}

/**
 * Feste Zeit eines Tages, bis zu der man zurück sein muss – die früheste von:
 * „Alle an Bord“ (Kreuzfahrt), selbst eingetragene feste Zeit, Check-out am Abreisetag,
 * Abfahrt einer Verbindung (Flug, Zug, Fähre …) abzüglich Vorlauf.
 * Ergebnis: { min, zeit, titel, kurz, ort } oder null.
 */
export function festeZeit(tag, reise = null) {
  if (!tag) return null;
  const kandidaten = [];
  const art = tag.art ?? (tag.seetag ? "seetag" : "hafen");
  const tagOrt = Number.isFinite(tag.lat) ? { lat: tag.lat, lng: tag.lng, name: tag.name } : null;
  if (art === "hafen") {
    const anBord = zeitZuMin(tag.allesAnBord) ?? (zeitZuMin(tag.abfahrt) != null ? zeitZuMin(tag.abfahrt) - 30 : null);
    if (anBord != null) kandidaten.push({ min: anBord, titel: "Alle an Bord", kurz: "Alle an Bord", ort: tagOrt });
  }
  const eigene = zeitZuMin(tag.festeZeit?.zeit);
  if (eigene != null) kandidaten.push({ min: eigene, titel: tag.festeZeit.titel || "Feste Zeit", kurz: tag.festeZeit.titel || "Feste Zeit", ort: tagOrt });
  for (const h of reise?.hotels ?? []) {
    if (h.status !== "gebucht" || h.abreise !== tag.datum || zeitZuMin(h.checkout) == null) continue;
    kandidaten.push({ min: zeitZuMin(h.checkout), titel: `Check-out ${h.name}`, kurz: "Check-out", ort: Number.isFinite(h.lat) ? { lat: h.lat, lng: h.lng, name: h.name } : null });
  }
  for (const v of reise?.verbindungen ?? []) {
    if (v.status === "verworfen" || v.datum !== tag.datum || zeitZuMin(v.abZeit) == null) continue;
    const vm = VERKEHRSMITTEL[v.art] ?? VERKEHRSMITTEL.sonstiges;
    const vorlauf = zahl(v.vorlaufMin) ?? vm.vorlauf;
    const ortName = v.von || vm.ort;
    kandidaten.push({ min: zeitZuMin(v.abZeit) - vorlauf, titel: `${vorlauf ? `Spätestens ${ortName}` : ortName} – ${v.titel || vm.name} um ${v.abZeit}`, kurz: vorlauf ? `${vm.ort} (${v.titel || vm.name})` : v.titel || vm.name, ort: Number.isFinite(v.vonOrt?.lat) ? v.vonOrt : null });
  }
  if (!kandidaten.length) return null;
  const f = kandidaten.sort((a, b) => a.min - b.min)[0];
  return { ...f, zeit: minZuZeit(f.min) };
}

/**
 * Zeitplan eines Ausflugs an einem Tag.
 * Bei Schiffsausflügen ist der Transfer in der Dauer enthalten; bei allen anderen kommen
 * Hin- und Rückweg (fahrzeitMin je Richtung) dazu. Puffer = feste Zeit (z. B. „Alle an Bord“,
 * Check-out, Abflug) minus Rückkehr.
 */
export function zeitplan(ausflug, hafen, reise = null) {
  const ankunft = zeitZuMin(hafen?.ankunft);
  const fest = festeZeit(hafen, reise);
  const anBord = fest?.min ?? null;
  const beginn = zeitZuMin(ausflug.beginn);
  const dauer = zahl(ausflug.dauerMin);
  const weg = ausflug.quelle === "schiff" ? 0 : zahl(ausflug.fahrzeitMin) ?? 0;
  const losVomSchiff = beginn != null ? beginn - weg : ankunft != null ? ankunft + 30 : null;
  const start = beginn ?? (losVomSchiff != null ? losVomSchiff + weg : null);
  const zurueck = start != null && dauer != null ? start + dauer + weg : null;
  const puffer = zurueck != null && anBord != null ? anBord - zurueck : null;
  const landgang = ankunft != null && anBord != null ? anBord - ankunft : null;
  const warnungen = [];
  if (losVomSchiff != null && ankunft != null && losVomSchiff < ankunft + 15) {
    warnungen.push("Beginnt sehr früh – kaum Zeit zum Ausschiffen.");
  }
  if (puffer != null) {
    if (puffer < 0) warnungen.push(`Endet ${dauerText(-puffer)} nach „${fest.kurz}“!`);
    else if (ausflug.quelle !== "schiff" && puffer < 60) {
      warnungen.push(fest.kurz === "Alle an Bord" ? "Weniger als 1 Std. Puffer – bei eigenen Ausflügen wartet das Schiff nicht." : `Weniger als 1 Std. Puffer bis „${fest.kurz}“ (${fest.zeit}).`);
    }
  }
  return { losVomSchiff, start, zurueck, puffer, landgang, warnungen, fest };
}

/** Punktwert für den Vergleich innerhalb eines Hafens (höher = sinnvoller). */
export function bewertung(ausflug, hafen, personen, reise = null) {
  const k = ausflugKosten(ausflug, personen);
  const z = zeitplan(ausflug, hafen, reise);
  const interesse = zahl(ausflug.interesse) ?? 3; // 1–5
  const sterne = zahl(ausflug.sterne); // z. B. 4,7 von GetYourGuide
  const dauer = zahl(ausflug.dauerMin) ?? 0;
  const anzahl = Math.max(k.anzahl, 1);
  const proPersonStunde = dauer > 0 ? k.summe / anzahl / (dauer / 60) : null;
  let punkte = interesse * 20; // 20–100
  if (sterne != null) punkte += (sterne - 4) * 15;
  if (proPersonStunde != null) punkte -= Math.min(proPersonStunde, 60) * 0.4;
  if (z.puffer != null) {
    if (z.puffer < 0) punkte -= 80;
    else if (ausflug.quelle !== "schiff" && z.puffer < 60) punkte -= 25;
    else if (z.puffer >= 90) punkte += 5;
  }
  if (ausflug.quelle !== "schiff") punkte -= Math.min(zahl(ausflug.fahrzeitMin) ?? 0, 90) * 0.1;
  return { punkte: Math.round(punkte), proPersonStunde, kosten: k, zeit: z };
}

/** Luftlinie in km (Haversine). */
export function entfernungKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const r = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/**
 * Liest eingefügten Text (z. B. aus der Mein-Schiff-App oder -Website kopiert) als Ausflugsliste.
 * Ausflüge sind durch Leerzeilen getrennt; die erste Zeile ist der Titel. Erkannt werden Preise
 * (Erwachsene/Kinder), Dauer und Beginn. Alles Übrige landet in der Notiz.
 */
export function textZuAusfluegen(text) {
  const bloecke = String(text ?? "")
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((b) => b.split("\n").map((z) => z.trim()).filter(Boolean))
    .filter((b) => b.length);
  const preisRe = /(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:€|EUR)|(?:€|EUR)\s*(\d{1,4}(?:[.,]\d{1,2})?)/gi;
  return bloecke.map((zeilen) => {
    const titel = zeilen[0].replace(/\s*[-–|]\s*$/, "");
    const rest = zeilen.slice(1).join("\n");
    const alles = zeilen.join("\n");
    let preisErw = null;
    let preisKind = null;
    let preisGruppe = null;
    for (const zeile of zeilen) {
      const preise = [...zeile.matchAll(preisRe)].map((m) => zahl(m[1] ?? m[2]));
      if (!preise.length) continue;
      if (/gesamt|insgesamt|für alle|pro Gruppe|f(?:ü|ue)r\s+\d+\s+(Person|Personen|Teilnehmer)/i.test(zeile)) preisGruppe ??= preise.at(-1);
      else if (/kind|child|junior/i.test(zeile) && !/erw|adult/i.test(zeile)) preisKind ??= preise[0];
      else if (/erw|adult/i.test(zeile) && /kind|child/i.test(zeile) && preise.length > 1) {
        const erwZuerst = zeile.search(/erw|adult/i) < zeile.search(/kind|child/i);
        preisErw ??= erwZuerst ? preise[0] : preise[1];
        preisKind ??= erwZuerst ? preise[1] : preise[0];
      } else preisErw ??= preise[0];
    }
    let dauerMin = null;
    const std = /(?:ca\.?\s*)?(\d{1,2}(?:[.,]\d)?)\s*(?:-\s*\d{1,2}\s*)?(?:Std|Stunden|Stunde|h\b|hrs?)/i.exec(alles);
    if (std) dauerMin = Math.round(zahl(std[1]) * 60);
    else {
      const min = /(\d{2,3})\s*(?:Min|Minuten)/i.exec(alles);
      if (min) dauerMin = Number(min[1]);
    }
    const uhr = /(?:ab|um|Beginn:?|Start:?|Treffpunkt:?)?\s*(\d{1,2}[:.]\d{2})\s*Uhr/i.exec(alles);
    const code = /\b([A-Z]{2,4}\s?\d{2,4}[A-Z]?)\b/.exec(alles);
    return {
      titel,
      preisArt: preisGruppe != null && preisErw == null ? "gruppe" : "person",
      preisGruppe,
      preisErw,
      preisKind,
      dauerMin,
      beginn: uhr ? uhr[1].replace(".", ":").padStart(5, "0") : "",
      code: code ? code[1] : "",
      notiz: rest,
    };
  });
}
