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
  sport: "Sport & Action",
  sonstiges: "Sonstiges",
};

export const VERPFLEGUNG = {
  ohne: "Nur Übernachtung",
  fruehstueck: "Frühstück",
  halbpension: "Halbpension",
  vollpension: "Vollpension",
  all: "All inclusive",
};

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

/** Gesamtkosten der Reise: je Hafen, je Person, nach Status. */
export function reiseKosten(reise) {
  const personen = reise.personen ?? [];
  const ergebnis = {
    gebucht: 0,
    geplant: 0, // gebucht + Favoriten
    ausfluege: { gebucht: 0, geplant: 0 },
    hotels: { gebucht: 0, geplant: 0 },
    sonstiges: { gebucht: 0, geplant: 0 },
    jeHafen: {},
    jeHotel: {},
    jePerson: Object.fromEntries(personen.map((p) => [p.id, 0])),
    jeQuelle: {},
  };
  const verteilen = (betrag) => {
    if (!personen.length) return;
    for (const p of personen) ergebnis.jePerson[p.id] += betrag / personen.length;
  };
  for (const h of reise.hotels ?? []) {
    if (!zaehlt(h, "geplant")) continue;
    const k = hotelKosten(h, personen).summe;
    ergebnis.hotels.geplant += k;
    if (h.status === "gebucht") ergebnis.hotels.gebucht += k;
    ergebnis.jeHotel[h.id] = k;
    verteilen(k);
  }
  for (const s of reise.kosten ?? []) {
    if (!zaehlt(s, "geplant")) continue;
    const k = zahl(s.betrag) ?? 0;
    ergebnis.sonstiges.geplant += k;
    if (s.status === "gebucht") ergebnis.sonstiges.gebucht += k;
    verteilen(k);
  }
  for (const a of reise.ausfluege ?? []) {
    if (!zaehlt(a, "geplant")) continue;
    const k = ausflugKosten(a, personen);
    ergebnis.ausfluege.geplant += k.summe;
    if (a.status === "gebucht") ergebnis.ausfluege.gebucht += k.summe;
    ergebnis.jeHafen[a.hafenId] = (ergebnis.jeHafen[a.hafenId] ?? 0) + k.summe;
    ergebnis.jeQuelle[a.quelle] = (ergebnis.jeQuelle[a.quelle] ?? 0) + k.summe;
    for (const [id, betrag] of Object.entries(k.jePerson)) ergebnis.jePerson[id] = (ergebnis.jePerson[id] ?? 0) + betrag;
  }
  for (const teil of [ergebnis.ausfluege, ergebnis.hotels, ergebnis.sonstiges]) {
    teil.gebucht = runde(teil.gebucht);
    teil.geplant = runde(teil.geplant);
    ergebnis.gebucht += teil.gebucht;
    ergebnis.geplant += teil.geplant;
  }
  ergebnis.gebucht = runde(ergebnis.gebucht);
  ergebnis.geplant = runde(ergebnis.geplant);
  return ergebnis;
}

/** Anzahl Nächte zwischen zwei ISO-Daten. */
export function naechte(anreise, abreise) {
  if (!anreise || !abreise) return 0;
  const n = Math.round((new Date(`${abreise}T12:00:00`) - new Date(`${anreise}T12:00:00`)) / 86400_000);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Kosten einer Unterkunft: Preis pro Nacht × Nächte × Zimmer oder Gesamtpreis. */
export function hotelKosten(hotel, personen = []) {
  const n = naechte(hotel.anreise, hotel.abreise);
  const preis = zahl(hotel.preis) ?? 0;
  const zimmer = Math.max(1, zahl(hotel.zimmer) ?? 1);
  const summe = runde(hotel.preisArt === "nacht" ? preis * n * zimmer : preis);
  const anzahl = personen.length || 1;
  return {
    summe,
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
 * Zeitplan eines Ausflugs am Hafentag.
 * Bei Schiffsausflügen ist der Transfer in der Dauer enthalten; bei allen anderen kommen
 * Hin- und Rückweg (fahrzeitMin je Richtung) dazu. Puffer = „Alle an Bord“ minus Rückkehr.
 */
export function zeitplan(ausflug, hafen) {
  const ankunft = zeitZuMin(hafen?.ankunft);
  const anBord = zeitZuMin(hafen?.allesAnBord) ?? (zeitZuMin(hafen?.abfahrt) != null ? zeitZuMin(hafen.abfahrt) - 30 : null);
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
    if (puffer < 0) warnungen.push(`Endet ${dauerText(-puffer)} nach „Alle an Bord“!`);
    else if (ausflug.quelle !== "schiff" && puffer < 60) {
      warnungen.push("Weniger als 1 Std. Puffer – bei eigenen Ausflügen wartet das Schiff nicht.");
    }
  }
  return { losVomSchiff, start, zurueck, puffer, landgang, warnungen };
}

/** Punktwert für den Vergleich innerhalb eines Hafens (höher = sinnvoller). */
export function bewertung(ausflug, hafen, personen) {
  const k = ausflugKosten(ausflug, personen);
  const z = zeitplan(ausflug, hafen);
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
    for (const zeile of zeilen) {
      const preise = [...zeile.matchAll(preisRe)].map((m) => zahl(m[1] ?? m[2]));
      if (!preise.length) continue;
      if (/kind|child|junior/i.test(zeile) && !/erw|adult/i.test(zeile)) preisKind ??= preise[0];
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
      preisErw,
      preisKind,
      dauerMin,
      beginn: uhr ? uhr[1].replace(".", ":").padStart(5, "0") : "",
      code: code ? code[1] : "",
      notiz: rest,
    };
  });
}
