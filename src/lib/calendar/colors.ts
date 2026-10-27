// Kalenderfarben unterscheidbar machen: Eigene Kalender (iCloud/Google …) bringen ihre Farben mit – oft
// ähnlich (z. B. „Familie“ und „Privat“ beide gelb-orange). Liegen zwei Farben zu nah beieinander, bekommt
// der spätere Kalender eine deutlich andere Ersatzfarbe. Dazu ein Kürzel je Kalender und ein Symbol je
// Systemkategorie – die Bedeutung hängt nie allein an der Farbe. Reine Logik, damit testbar.

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
function toLab(h: string): [number, number, number] {
  const [r, g, b] = hex(h).map(lin);
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Farbabstand CIEDE2000 (ab ca. 18 klar verschieden, unter 12 leicht verwechselbar). */
export function colorDistance(h1: string, h2: string): number {
  const [L1, a1, b1] = toLab(h1);
  const [L2, a2, b2] = toLab(h2);
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hue = (a: number, b: number) => {
    const v = Math.atan2(b, a) / rad;
    return v < 0 ? v + 360 : v;
  };
  const h1p = hue(a1p, b1), h2p = hue(a2p, b2);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = h2p - h1p;
  if (C1p * C2p === 0) dhp = 0;
  else if (dhp > 180) dhp -= 360;
  else if (dhp < -180) dhp += 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lm = (L1 + L2) / 2, Cmp = (C1p + C2p) / 2;
  let hm = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hm += h1p + h2p < 360 ? 360 : -360;
    hm /= 2;
  }
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const dTh = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2), Sc = 1 + 0.045 * Cmp, Sh = 1 + 0.015 * Cmp * T;
  const Rt = -Math.sin(2 * dTh * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

/** Systemkategorien im Geschäftskalender: Farbe (passend zum Bereich) und Symbol. */
export const SYSTEM_CATEGORIES: Record<string, { color: string; icon: string; label: string }> = {
  Aufgabe: { color: "#2563eb", icon: "☑", label: "Aufgabe" },
  Fall: { color: "#b91c1c", icon: "⚖", label: "Frist" },
  Ansprüche: { color: "#57534e", icon: "€", label: "Ansprüche" },
  Versand: { color: "#0f766e", icon: "📦", label: "Versand" },
  Geld: { color: "#7e22ce", icon: "💶", label: "Geld" },
};

/** Ersatzfarben – untereinander klar verschieden; bewusst ohne Grün (Grün heißt „erledigt“). */
const FALLBACK = ["#0891b2", "#9333ea", "#1e40af", "#be123c", "#ea580c", "#a16207", "#7c2d12", "#334155", "#db2777", "#0f766e"];
const MIN_DISTANCE = 18;
const isHex = (c: string | null | undefined): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);

/**
 * Farbe je Kalender: die eigene, solange sie sich von bereits vergebenen (und den reservierten, z. B. den
 * Systemkategorien) deutlich unterscheidet – sonst die Ersatzfarbe mit dem größten Abstand. Reihenfolge nach
 * Name, damit die Zuordnung stabil bleibt.
 */
export function distinctCalendarColors(calendars: { name: string; color: string | null | undefined }[], reserved: string[] = []): Map<string, string> {
  const out = new Map<string, string>();
  const used = reserved.filter(isHex);
  const unique = [...new Map(calendars.map((c) => [c.name, c])).values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
  for (const c of unique) {
    const own = isHex(c.color) ? c.color : null;
    const minTo = (h: string) => used.reduce((m, u) => Math.min(m, colorDistance(h, u)), Infinity);
    let pick = own && minTo(own) >= MIN_DISTANCE ? own : null;
    if (!pick) pick = [...FALLBACK].sort((x, y) => minTo(y) - minTo(x))[0];
    out.set(c.name, pick);
    used.push(pick);
  }
  return out;
}

/** Kurzes, eindeutiges Kürzel je Kalender („Familie“ → „Fa“, „Lugru Arbeit“ → „LA“). */
export function calendarAbbreviations(names: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const name of [...new Set(names)].sort((a, b) => a.localeCompare(b, "de"))) {
    const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
    const first = words[0] ?? name;
    const title = (t: string) => (t.length === 2 ? t[0].toUpperCase() + t[1].toLowerCase() : t.toUpperCase());
    const tries = [
      words.length >= 2 ? `${words[0][0]}${words[1][0]}`.toUpperCase() : title(`${first[0] ?? "?"}${first[1] ?? ""}`),
      ...[...first.slice(2)].map((ch) => title(`${first[0]}${ch}`)),
    ];
    let abbr = tries.find((t) => !taken.has(t.toLowerCase())) ?? "";
    for (let n = 2; !abbr || taken.has(abbr.toLowerCase()); n++) abbr = `${(first[0] ?? "K").toUpperCase()}${n}`;
    taken.add(abbr.toLowerCase());
    out.set(name, abbr);
  }
  return out;
}

const luminance = (h: string) => {
  const [r, g, b] = hex(h).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Schriftfarbe auf einer Kalenderfarbe: weiß oder fast schwarz – je nachdem, was mehr Kontrast hat. */
export function textOn(bg: string | null | undefined): string {
  if (!bg || !isHex(bg)) return "#fff";
  const L = luminance(bg);
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) ? "#fff" : "#111";
}
