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

/** Orte am Flughafen, die man bewerten kann. */
export const FLUGHAFEN_ARTEN = { lounge: "🛋️ Lounge", essen: "🍽️ Restaurant / Café", spielplatz: "🛝 Spielplatz / Familienbereich", ruhe: "😴 Ruheraum", shop: "🛍️ Shop", sicherheit: "🛂 Sicherheitskontrolle", sonstiges: "📍 Sonstiges" };

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

/**
 * Ist der Preis für diese Person unbekannt? Leeres Feld = „Preis offen“, eine eingetragene 0 = kostenlos.
 * Kinder unter „gratis unter“ sind immer bekannt (0 €).
 */
export function preisOffenFuer(ausflug, person) {
  if (ausflug.preisArt === "gruppe") return zahl(ausflug.preisGruppe) == null;
  if (!istKind(person)) return zahl(ausflug.preisErw) == null;
  const frei = zahl(ausflug.kostenlosBis);
  const alter = zahl(person.alter);
  if (frei != null && alter != null && alter < frei) return false;
  return zahl(ausflug.preisKind) == null && zahl(ausflug.preisErw) == null;
}

/** Gesamtpreis eines Ausflugs und Aufteilung je Person. `offen`: Preis (teilweise) unbekannt. */
export function ausflugKosten(ausflug, personen) {
  const dabei = teilnehmer(ausflug, personen);
  const jePerson = {};
  let summe = 0;
  const offen = dabei.some((p) => preisOffenFuer(ausflug, p));
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
  return { summe: runde(summe), jePerson, anzahl: dabei.length, erwachsene, kinder: dabei.length - erwachsene, offen };
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
    offen: [], // gezählte Posten ohne Preis – die Summen sind dann unvollständig
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
    if (k.offen) ergebnis.offen.push({ art: "Unterkunft", titel: h.name, status: h.status });
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
    if (zahl(s.betrag) == null) ergebnis.offen.push({ art: "Kosten", titel: s.titel || "Posten ohne Namen", status: s.status });
    const k = zahl(s.betrag) ?? 0;
    posten(ergebnis.sonstiges, s.status, k);
    verteilen(k);
  }
  for (const a of reise.ausfluege ?? []) {
    if (!zaehlt(a, "geplant")) continue;
    const k = ausflugKosten(a, personen);
    if (k.offen) ergebnis.offen.push({ art: "Ausflug", titel: a.titel, status: a.status, hafenId: a.hafenId, teilweise: k.summe > 0 });
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
    offen: !mitPreis.length && zahl(hotel.preis) == null,
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
    // Ohne „Alle an Bord“ gilt Abfahrt − 30 Min. – ausdrücklich als Annahme gekennzeichnet
    const angegeben = zeitZuMin(tag.allesAnBord);
    const anBord = angegeben ?? (zeitZuMin(tag.abfahrt) != null ? zeitZuMin(tag.abfahrt) - 30 : null);
    if (anBord != null) {
      kandidaten.push({
        min: anBord, titel: "Alle an Bord", kurz: "Alle an Bord", ort: tagOrt, angenommen: angegeben == null,
        grundlage: angegeben != null ? `„Alle an Bord“ ${tag.allesAnBord} laut Reiseplan` : `angenommen: Abfahrt ${tag.abfahrt} − 30 Min. („Alle an Bord“ fehlt)`,
      });
    }
  }
  const eigene = zeitZuMin(tag.festeZeit?.zeit);
  if (eigene != null) kandidaten.push({ min: eigene, titel: tag.festeZeit.titel || "Feste Zeit", kurz: tag.festeZeit.titel || "Feste Zeit", ort: tagOrt, grundlage: `feste Zeit ${tag.festeZeit.zeit}${tag.festeZeit.titel ? ` (${tag.festeZeit.titel})` : ""}` });
  for (const h of reise?.hotels ?? []) {
    if (h.status !== "gebucht" || h.abreise !== tag.datum || zeitZuMin(h.checkout) == null) continue;
    kandidaten.push({ min: zeitZuMin(h.checkout), titel: `Check-out ${h.name}`, kurz: "Check-out", ort: Number.isFinite(h.lat) ? { lat: h.lat, lng: h.lng, name: h.name } : null, grundlage: `Check-out ${h.checkout} (${h.name})` });
  }
  for (const v of reise?.verbindungen ?? []) {
    if (v.status === "verworfen" || v.datum !== tag.datum || zeitZuMin(v.abZeit) == null) continue;
    const vm = VERKEHRSMITTEL[v.art] ?? VERKEHRSMITTEL.sonstiges;
    const vorlauf = zahl(v.vorlaufMin) ?? vm.vorlauf;
    const ortName = v.von || vm.ort;
    kandidaten.push({
      min: zeitZuMin(v.abZeit) - vorlauf, titel: `${vorlauf ? `Spätestens ${ortName}` : ortName} – ${v.titel || vm.name} um ${v.abZeit}`, kurz: vorlauf ? `${vm.ort} (${v.titel || vm.name})` : v.titel || vm.name, ort: Number.isFinite(v.vonOrt?.lat) ? v.vonOrt : null,
      grundlage: `Abfahrt ${v.titel || vm.name} ${v.abZeit}${vorlauf ? ` − ${vorlauf} Min. Vorlauf${zahl(v.vorlaufMin) == null ? " (Standardwert)" : ""}` : ""}`, angenommen: Boolean(vorlauf) && zahl(v.vorlaufMin) == null,
    });
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
  // Ohne Beginn: Start angenommen 30 Min. nach Ankunft (nur Schätzung, wird gekennzeichnet)
  const losVomSchiff = beginn != null ? beginn - weg : ankunft != null ? ankunft + 30 : null;
  const startAngenommen = beginn == null && losVomSchiff != null;
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
  const annahmen = [];
  if (puffer != null && startAngenommen) annahmen.push(`Beginn fehlt – angenommen ${minZuZeit(start)} (Ankunft + 30 Min.)`);
  if (puffer != null && fest?.angenommen) annahmen.push(fest.grundlage);
  // Rechenweg für die Anzeige: Rückkehr = Beginn + Dauer (+ Rückweg) → Puffer bis zur festen Zeit
  const rechenweg = puffer != null ? `Zurück ca. ${minZuZeit(zurueck)} (${beginn != null ? "Beginn" : "angen. Beginn"} ${minZuZeit(start)} + ${dauerText(dauer)}${weg ? ` + ${weg} Min. Rückweg` : ""}) · ${fest.titel} ${fest.zeit}` : "";
  return { losVomSchiff, start, zurueck, puffer, landgang, warnungen, fest, startAngenommen, annahmen, rechenweg };
}

/** Punktwert für den Vergleich innerhalb eines Hafens (höher = sinnvoller). */
export function bewertung(ausflug, hafen, personen, reise = null) {
  const k = ausflugKosten(ausflug, personen);
  const z = zeitplan(ausflug, hafen, reise);
  const interesse = zahl(ausflug.interesse) ?? 3; // 1–5
  const sterne = zahl(ausflug.sterne); // z. B. 4,7 von GetYourGuide
  const dauer = zahl(ausflug.dauerMin) ?? 0;
  const anzahl = Math.max(k.anzahl, 1);
  const proPersonStunde = dauer > 0 && !k.offen ? k.summe / anzahl / (dauer / 60) : null;
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

/** Erklärung des Punktwerts („Sinnvollste zuerst“) – dieselbe Rechnung wie in bewertung(). */
export function punkteErklaerung(ausflug, b) {
  const teile = [`Interesse ${zahl(ausflug.interesse) ?? 3}/5 = ${(zahl(ausflug.interesse) ?? 3) * 20}`];
  const sterne = zahl(ausflug.sterne);
  if (sterne != null) teile.push(`Anbieter-Bewertung ${String(sterne).replace(".", ",")} ★: ${sterne >= 4 ? "+" : "−"}${Math.abs(Math.round((sterne - 4) * 15))}`);
  if (b.proPersonStunde != null) teile.push(`Preis je Person und Stunde: −${Math.round(Math.min(b.proPersonStunde, 60) * 0.4)}`);
  else if (b.kosten.offen) teile.push("Preis offen: kein Preisabzug");
  const z = b.zeit;
  if (z.puffer != null) {
    if (z.puffer < 0) teile.push("zu spät zurück: −80");
    else if (ausflug.quelle !== "schiff" && z.puffer < 60) teile.push("knapper Puffer: −25");
    else if (z.puffer >= 90) teile.push("viel Puffer: +5");
  }
  const weg = ausflug.quelle !== "schiff" ? Math.round(Math.min(zahl(ausflug.fahrzeitMin) ?? 0, 90) * 0.1) : 0;
  if (weg) teile.push(`Anfahrt: −${weg}`);
  return `${b.punkte} Punkte: ${teile.join(", ")}. Höher = besser für euch; nur innerhalb eines Tages vergleichbar.`;
}

// ---------- Dubletten, Alternativen und Buchungskonflikte ----------

const FUELLWOERTER = new Set(["der", "die", "das", "den", "dem", "des", "und", "mit", "von", "vom", "zum", "zur", "zu", "im", "in", "am", "an", "auf", "fur", "ein", "eine", "einer", "the", "and", "of", "to", "tour", "tours", "ausflug", "inkl", "ca", "per", "pro", "fuer"]);
/** Wortstämme eines Titels (klein, ohne Umlaute/Satzzeichen, je Wort die ersten 6 Zeichen). */
export function titelWoerter(titel) {
  return new Set(
    String(titel ?? "")
      .toLowerCase()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !FUELLWOERTER.has(w))
      .map((w) => w.slice(0, 6)),
  );
}

/** Ähnliche Titel: gleich, oder die Wörter des kürzeren stecken fast alle im längeren (mind. 2 gemeinsame bzw. 1 bei Ein-Wort-Titeln). */
export function titelAehnlich(a, b) {
  const x = titelWoerter(a);
  const y = titelWoerter(b);
  if (!x.size || !y.size) return false;
  const gemeinsam = [...x].filter((w) => y.has(w)).length;
  const kleiner = Math.min(x.size, y.size);
  if (kleiner === 1) return gemeinsam === 1 && Math.max(x.size, y.size) <= 2;
  return gemeinsam >= 2 && gemeinsam / kleiner >= 0.6;
}

/** Mögliche Dubletten innerhalb eines Tages (ohne verworfene und ohne als „keine Dublette“ markierte). */
export function moeglicheDubletten(ausfluege) {
  const paare = [];
  const liste = (ausfluege ?? []).filter((a) => a.status !== "verworfen");
  for (let i = 0; i < liste.length; i++) {
    for (let j = i + 1; j < liste.length; j++) {
      const a = liste[i];
      const b = liste[j];
      if (a.hafenId !== b.hafenId) continue;
      if ((a.keineDublette ?? []).includes(b.id) || (b.keineDublette ?? []).includes(a.id)) continue;
      if ((a.alternativen ?? []).includes(b.id) || (b.alternativen ?? []).includes(a.id)) continue;
      if (titelAehnlich(a.titel, b.titel)) paare.push([a, b]);
    }
  }
  return paare;
}

/**
 * Buchungskonflikte je Ausflug: gebuchte Einträge am selben Tag, die sich zeitlich überschneiden und
 * dieselbe Person betreffen – oder ausdrücklich verknüpfte Alternativen, die beide gebucht sind.
 * Ergebnis: Map ausflugId → [{ mit, personen, grund, angenommen }]
 */
export function buchungsKonflikte(reise) {
  const ergebnis = new Map();
  const merken = (a, b, eintrag) => {
    if (!ergebnis.has(a.id)) ergebnis.set(a.id, []);
    ergebnis.get(a.id).push({ mit: b, ...eintrag });
  };
  const personen = reise.personen ?? [];
  const tage = new Map((reise.haefen ?? []).map((h) => [h.id, h]));
  const gebucht = (reise.ausfluege ?? []).filter((a) => a.status === "gebucht");
  for (let i = 0; i < gebucht.length; i++) {
    for (let j = i + 1; j < gebucht.length; j++) {
      const a = gebucht[i];
      const b = gebucht[j];
      if (a.hafenId !== b.hafenId) continue;
      const alternative = (a.alternativen ?? []).includes(b.id) || (b.alternativen ?? []).includes(a.id);
      const gemeinsam = personen.filter((p) => (a.teilnehmer ?? []).includes(p.id) && (b.teilnehmer ?? []).includes(p.id)).map((p) => p.name);
      let grund = "";
      let angenommen = false;
      if (alternative) grund = "Beide Alternativen sind gebucht";
      else if (gemeinsam.length) {
        const tag = tages(tage, a.hafenId);
        const za = zeitplan(a, tag, reise);
        const zb = zeitplan(b, tag, reise);
        const vonA = za.losVomSchiff ?? za.start;
        const vonB = zb.losVomSchiff ?? zb.start;
        if (vonA != null && vonB != null && za.zurueck != null && zb.zurueck != null && vonA < zb.zurueck && vonB < za.zurueck) {
          grund = "Zeitliche Überschneidung";
          angenommen = za.startAngenommen || zb.startAngenommen;
        }
      }
      if (!grund) continue;
      const eintrag = { personen: gemeinsam, grund, angenommen };
      merken(a, b, eintrag);
      merken(b, a, eintrag);
    }
  }
  return ergebnis;
}
const tages = (tage, id) => tage.get(id) ?? null;

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

/** Tiefenprofil eines Tauchgangs als SVG ([Minute, Meter]-Paare, z. B. vom Tauchcomputer). */
export function tauchProfilSvg(profil, { breite = 360, hoehe = 150 } = {}) {
  const p = (Array.isArray(profil) ? profil : []).filter((x) => Array.isArray(x) && Number.isFinite(x[0]) && Number.isFinite(x[1]));
  if (p.length < 2) return "";
  const rand = { l: 34, r: 8, o: 8, u: 22 };
  const maxMin = Math.max(...p.map((x) => x[0])) || 1;
  const maxM = Math.max(5, Math.ceil(Math.max(...p.map((x) => x[1])) / 5) * 5);
  const x = (min) => (rand.l + (min / maxMin) * (breite - rand.l - rand.r)).toFixed(1);
  const y = (m) => (rand.o + (m / maxM) * (hoehe - rand.o - rand.u)).toFixed(1);
  const linie = p.map((q) => `${x(q[0])},${y(q[1])}`).join(" ");
  const flaeche = `${x(p[0][0])},${y(0)} ${linie} ${x(p.at(-1)[0])},${y(0)}`;
  const tief = p.reduce((a, q) => (q[1] > a[1] ? q : a), p[0]);
  const stufe = maxM <= 10 ? 2 : maxM <= 30 ? 5 : 10;
  const raster = Array.from({ length: Math.floor(maxM / stufe) + 1 }, (_, i) => i * stufe)
    .map((m) => `<line x1="${rand.l}" x2="${breite - rand.r}" y1="${y(m)}" y2="${y(m)}" stroke="currentColor" stroke-opacity=".15"/><text x="${rand.l - 4}" y="${Number(y(m)) + 4}" text-anchor="end" font-size="11" fill="currentColor" fill-opacity=".7">${m} m</text>`)
    .join("");
  const zeitStufe = maxMin <= 20 ? 5 : maxMin <= 60 ? 10 : 20;
  const zeiten = Array.from({ length: Math.floor(maxMin / zeitStufe) + 1 }, (_, i) => i * zeitStufe)
    .map((min) => `<text x="${x(min)}" y="${hoehe - 6}" text-anchor="middle" font-size="11" fill="currentColor" fill-opacity=".7">${min}′</text>`)
    .join("");
  return `<svg class="tauchprofil" viewBox="0 0 ${breite} ${hoehe}" role="img" aria-label="Tiefenprofil: maximal ${String(tief[1]).replace(".", ",")} m nach ${Math.round(tief[0])} Minuten" style="width:100%;height:auto;display:block">
${raster}${zeiten}<polygon points="${flaeche}" fill="#1e88c8" fill-opacity=".25"/><polyline points="${linie}" fill="none" stroke="#1e88c8" stroke-width="2" stroke-linejoin="round"/><circle cx="${x(tief[0])}" cy="${y(tief[1])}" r="3.5" fill="#1e88c8"/></svg>`;
}
