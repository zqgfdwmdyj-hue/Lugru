// Tesla vorheizen/-kühlen nach Kalender (Modul 12): reine Logik. Nur Termine mit Ort, X Minuten vor der Abfahrt
// (Termin − Fahrzeit), nur wenn das Auto zu Hause steht; Ausnahme per Markierung im Termin („#nichtheizen“, „ohne Auto“,
// „mit Bahn“ …). Kein Laden.

export type HeizTermin = { key: string; titel: string; start: Date; ort: string | null; notiz?: string | null; privat: boolean };

/** Markierung im Titel/Notiz: kein Vorheizen. */
export const heizAusnahme = (text: string) => /#\s*nicht\s*heizen|\bnicht\s+(vor)?heizen\b|\bohne\s+auto\b|\bkein\s+auto\b|\bzu\s+fu(ß|ss)\b|\bmit\s+(der\s+)?(bahn|zug|rad|fahrrad|flugzeug)\b|\bonline\b|\bvideo(call|konferenz)?\b|\bteams\b|\bzoom\b/i.test(text);

/** Termin, für den jetzt vorgeheizt werden soll (frühester zuerst) – oder null. */
export function vorheizFaellig(termine: HeizTermin[], jetzt: Date, o: { fahrzeitMin: number; vorlaufMin: number }): (HeizTermin & { abfahrt: Date }) | null {
  for (const t of [...termine].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    if (!t.ort?.trim() || heizAusnahme(`${t.titel} ${t.notiz ?? ""} ${t.ort}`)) continue;
    const abfahrt = new Date(t.start.getTime() - Math.max(0, o.fahrzeitMin) * 60_000);
    const heiz = abfahrt.getTime() - Math.max(1, o.vorlaufMin) * 60_000;
    if (jetzt.getTime() >= heiz && jetzt.getTime() < abfahrt.getTime()) return { ...t, abfahrt };
  }
  return null;
}

/** Entfernung in Metern (Haversine). */
export function entfernungM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** Steht das Auto zu Hause? Ohne gespeicherten Heim-Standort: unbekannt (null) → nicht heizen. */
export function zuHause(auto: { lat: number | null; lon: number | null }, heim: { lat: number | null; lon: number | null }, radiusM = 300): boolean | null {
  if (auto.lat === null || auto.lon === null || heim.lat === null || heim.lon === null) return null;
  return entfernungM({ lat: auto.lat, lon: auto.lon }, { lat: heim.lat, lon: heim.lon }) <= radiusM;
}

/** Standort grob für Ansagen/Claude: „zu Hause“, „unterwegs nach …“, „unterwegs“ – keine Koordinaten. */
export function standortGrob(s: { lat: number | null; lon: number | null; ziel: string | null }, heim: { lat: number | null; lon: number | null }): string {
  const h = zuHause(s, heim);
  if (h) return "zu Hause";
  if (s.ziel) return `unterwegs nach ${s.ziel.split(",")[0].slice(0, 60)}`;
  return h === false ? "nicht zu Hause" : "unbekannt (Heim-Standort nicht gespeichert)";
}

/** Satz zum Vorlesen. */
export function statusSatz(s: { akku: number | null; reichweiteKm: number | null; innenTemp: number | null; verriegelt: boolean | null; fensterOffen: boolean | null; reifenWarnung: boolean | null; update: string | null }, ort: string): string {
  const teile = [
    s.akku !== null ? `Akku ${s.akku} Prozent${s.reichweiteKm !== null ? `, ${s.reichweiteKm} Kilometer Reichweite` : ""}.` : "Akku unbekannt.",
    `Auto ${ort}.`,
    s.innenTemp !== null ? `Innen ${Math.round(s.innenTemp)} Grad.` : "",
    s.verriegelt === false ? "Achtung: nicht verriegelt." : "",
    s.fensterOffen ? "Achtung: ein Fenster ist offen." : "",
    s.reifenWarnung ? "Reifendruck-Warnung." : "",
    s.update ? "Ein Software-Update steht an." : "",
  ];
  return teile.filter(Boolean).join(" ");
}
