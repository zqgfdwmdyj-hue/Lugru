// B25.8: Fahrzeit vor Terminen mit Ort schätzen – ohne Tesla und ohne Kartendienst. Grundlage sind die Postleitzahlen
// von Termin-Ort und „zu Hause“ (Einstellungen → Handy & Tesla): ungefährer Mittelpunkt je PLZ-Leitregion (erste zwei
// Ziffern), Luftlinie × 1,3 bei Ø 70 km/h plus 10 Min. Puffer. Ohne PLZ gilt die eingestellte Standard-Fahrzeit.
// Online-Termine (Zoom, Teams, Link, Telefon) bekommen keine Fahrzeit. Reine Logik (tests/b25.test.ts).

/** Ungefährer Mittelpunkt je PLZ-Leitregion (größte Stadt der Region), Breite/Länge. */
const LEITREGION: Record<string, [number, number]> = {
  "01": [51.05, 13.74], "02": [51.18, 14.42], "03": [51.76, 14.33], "04": [51.34, 12.37], "06": [51.48, 11.97], "07": [50.88, 12.08], "08": [50.72, 12.49], "09": [50.83, 12.92],
  "10": [52.52, 13.4], "12": [52.46, 13.43], "13": [52.56, 13.32], "14": [52.4, 13.06], "15": [52.35, 14.55], "16": [52.83, 13.82], "17": [53.56, 13.26], "18": [54.09, 12.1], "19": [53.63, 11.41],
  "20": [53.55, 10.0], "21": [53.47, 9.98], "22": [53.6, 10.05], "23": [53.87, 10.69], "24": [54.32, 10.14], "25": [54.0, 9.3], "26": [53.14, 8.21], "27": [53.55, 8.58], "28": [53.08, 8.8], "29": [52.62, 10.08],
  "30": [52.37, 9.73], "31": [52.15, 9.95], "32": [52.11, 8.67], "33": [52.02, 8.53], "34": [51.31, 9.48], "35": [50.58, 8.68], "36": [50.55, 9.68], "37": [51.54, 9.93], "38": [52.27, 10.52], "39": [52.13, 11.63],
  "40": [51.23, 6.78], "41": [51.19, 6.44], "42": [51.26, 7.15], "44": [51.51, 7.47], "45": [51.46, 7.01], "46": [51.5, 6.86], "47": [51.43, 6.76], "48": [51.96, 7.63], "49": [52.28, 8.05],
  "50": [50.94, 6.96], "51": [50.99, 7.13], "52": [50.78, 6.08], "53": [50.74, 7.1], "54": [49.75, 6.64], "55": [50.0, 8.27], "56": [50.36, 7.59], "57": [50.87, 8.02], "58": [51.36, 7.47], "59": [51.68, 7.82],
  "60": [50.11, 8.68], "61": [50.23, 8.62], "63": [50.1, 8.9], "64": [49.87, 8.65], "65": [50.08, 8.24], "66": [49.24, 6.99], "67": [49.45, 7.95], "68": [49.49, 8.47], "69": [49.4, 8.69],
  "70": [48.78, 9.18], "71": [48.89, 9.19], "72": [48.49, 9.21], "73": [48.7, 9.55], "74": [49.14, 9.22], "75": [48.89, 8.7], "76": [49.01, 8.4], "77": [48.47, 7.94], "78": [48.06, 8.46], "79": [47.99, 7.85],
  "80": [48.14, 11.58], "81": [48.12, 11.6], "82": [48.0, 11.34], "83": [47.86, 12.12], "84": [48.54, 12.15], "85": [48.76, 11.42], "86": [48.37, 10.9], "87": [47.73, 10.31], "88": [47.78, 9.61], "89": [48.4, 9.99],
  "90": [49.45, 11.08], "91": [49.6, 11.0], "92": [49.55, 12.0], "93": [49.01, 12.1], "94": [48.57, 13.43], "95": [50.1, 11.7], "96": [49.89, 10.89], "97": [49.79, 9.95], "98": [50.61, 10.69], "99": [50.98, 11.03],
};

const ONLINE_RE = /\b(?:zoom|teams|meet\.google|google meet|webex|skype|whereby|jitsi|online|video(?:call|konferenz)?|telefon(?:isch)?|anruf|call)\b|https?:\/\//i;

/** Erste deutsche Postleitzahl im Text (5 Ziffern, nicht Teil einer längeren Zahl). */
export function plzAus(text: string | null | undefined): string | null {
  const m = /(?<!\d)(\d{5})(?!\d)/.exec(text ?? "");
  return m && LEITREGION[m[1].slice(0, 2)] ? m[1] : null;
}

function km(a: [number, number], b: [number, number]): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const d = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(d));
}

export type FahrzeitSchaetzung = { minuten: number; grund: string };

/**
 * Fahrzeit (Minuten) vom Start („zu Hause“) zum Termin-Ort. Gleiche PLZ 10 Min., gleiche ersten drei Ziffern 20 Min.,
 * gleiche Leitregion 30 Min., sonst Luftlinie × 1,3 / 70 km/h + 10 Min. (höchstens 4 Std.).
 */
export function fahrzeitSchaetzen(ort: string | null | undefined, start: string | null | undefined, standardMin: number): FahrzeitSchaetzung {
  const o = (ort ?? "").trim();
  if (!o) return { minuten: 0, grund: "kein Ort" };
  if (ONLINE_RE.test(o)) return { minuten: 0, grund: "online" };
  const ziel = plzAus(o);
  const von = plzAus(start);
  if (!ziel || !von) return { minuten: Math.max(0, standardMin), grund: ziel ? "Standard (PLZ zu Hause fehlt)" : "Standard (keine PLZ im Ort)" };
  if (ziel === von) return { minuten: 10, grund: `geschätzt, gleiche PLZ ${ziel}` };
  if (ziel.slice(0, 3) === von.slice(0, 3)) return { minuten: 20, grund: `geschätzt, PLZ ${von} → ${ziel}` };
  if (ziel.slice(0, 2) === von.slice(0, 2)) return { minuten: 30, grund: `geschätzt, PLZ ${von} → ${ziel}` };
  const strecke = km(LEITREGION[von.slice(0, 2)], LEITREGION[ziel.slice(0, 2)]) * 1.3;
  const minuten = Math.min(240, Math.round((10 + (strecke / 70) * 60) / 5) * 5);
  return { minuten, grund: `geschätzt, ca. ${Math.round(strecke)} km (PLZ ${von} → ${ziel})` };
}
