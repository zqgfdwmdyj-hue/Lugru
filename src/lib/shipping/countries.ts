// ISO-3166 alpha-2 → alpha-3 (DHL erwartet alpha-3).
const MAP: Record<string, string> = {
  DE: "DEU", AT: "AUT", CH: "CHE", NL: "NLD", BE: "BEL", LU: "LUX", FR: "FRA", IT: "ITA", ES: "ESP", PT: "PRT",
  PL: "POL", CZ: "CZE", SK: "SVK", HU: "HUN", SI: "SVN", HR: "HRV", DK: "DNK", SE: "SWE", FI: "FIN", NO: "NOR",
  IE: "IRL", GB: "GBR", GR: "GRC", RO: "ROU", BG: "BGR", EE: "EST", LV: "LVA", LT: "LTU", LI: "LIE", MT: "MLT", CY: "CYP",
  US: "USA",
};
const NAMES: Record<string, string> = { deutschland: "DEU", germany: "DEU", österreich: "AUT", austria: "AUT", schweiz: "CHE", niederlande: "NLD", frankreich: "FRA", italien: "ITA", spanien: "ESP", belgien: "BEL", polen: "POL" };

export function toIso3(country: string | null | undefined): string {
  const c = (country ?? "").trim();
  if (!c) return "DEU";
  if (c.length === 3) return c.toUpperCase();
  if (c.length === 2) return MAP[c.toUpperCase()] ?? c.toUpperCase();
  return NAMES[c.toLowerCase()] ?? c.toUpperCase().slice(0, 3);
}

/** "Musterstraße 12a" → { street: "Musterstraße", houseNo: "12a" } */
export function splitStreet(line: string): { street: string; houseNo: string } {
  const m = /^(.*?)[\s,]+(\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?)$/.exec(line.trim());
  if (m) return { street: m[1].trim(), houseNo: m[2].replace(/\s+/g, "") };
  const n = /^(\d+\s*[a-zA-Z]?)\s+(.*)$/.exec(line.trim());
  if (n) return { street: n[2].trim(), houseNo: n[1].replace(/\s+/g, "") };
  return { street: line.trim(), houseNo: "" };
}
