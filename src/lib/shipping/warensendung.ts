// Passt eine Sendung als Warensendung (Deutsche Post)? Bedingungen laut Post: nur innerhalb Deutschlands,
// höchstens 35,3 × 25 × 5 cm, bis 1.000 g (2,70 €), Waren ohne persönliche Mitteilung (Lieferschein/Rechnung
// erlaubt). Die Maße kennt das System nicht – dafür je Artikel „passt bis N Stück“ (einmal festgelegt).
// Reine Logik, testbar.

export const WS_LIMITS = { lengthCm: 35.3, widthCm: 25, heightCm: 5, maxGrams: 1000 } as const;
/** „35,3 × 25 × 5 cm“ */
export const WS_SIZE = `${WS_LIMITS.lengthCm.toLocaleString("de-DE")} × ${WS_LIMITS.widthCm} × ${WS_LIMITS.heightCm} cm`;

export type WsItem = { quantity: number; title: string; wsMax: number | null };
export type WsCheck = { ok: boolean; reason: string; /** Artikel ohne Festlegung – einmal eintragen. */ needsSetup: boolean };

const short = (t: string) => (t.length > 40 ? `${t.slice(0, 38)} …` : t);

export function warensendungCheck(o: { country: string | undefined; items: WsItem[]; weightKg: number }): WsCheck {
  const items = o.items.filter((i) => i.quantity > 0);
  if ((o.country ?? "DEU") !== "DEU") return { ok: false, reason: "Ausland – Warensendung nur innerhalb Deutschlands", needsSetup: false };
  if (!items.length) return { ok: false, reason: "keine Positionen", needsSetup: false };
  const unset = items.filter((i) => i.wsMax === null);
  if (unset.length) return { ok: false, reason: `Warensendung für „${short(unset[0].title)}“ noch nicht festgelegt`, needsSetup: true };
  const never = items.find((i) => i.wsMax === 0);
  if (never) return { ok: false, reason: `„${short(never.title)}“ passt nicht als Warensendung`, needsSetup: false };
  // Mehrere Artikel teilen sich den Platz: Anteil je Artikel = Stück / passende Stück, zusammen höchstens 1.
  const fill = items.reduce((n, i) => n + i.quantity / (i.wsMax as number), 0);
  if (fill > 1 + 1e-9) {
    const one = items.length === 1 ? items[0] : null;
    return { ok: false, reason: one ? `${one.quantity} Stück – als Warensendung passen nur ${one.wsMax} (max. ${WS_SIZE})` : `zu viel für eine Warensendung (max. ${WS_SIZE})`, needsSetup: false };
  }
  if (o.weightKg * 1000 > WS_LIMITS.maxGrams) return { ok: false, reason: `${o.weightKg.toLocaleString("de-DE")} kg – Warensendung nur bis 1 kg`, needsSetup: false };
  const count = items.reduce((n, i) => n + i.quantity, 0);
  return { ok: true, reason: `passt als Warensendung (${count} Stück, ${o.weightKg.toLocaleString("de-DE")} kg)`, needsSetup: false };
}

/** Auswahl für „Warensendung bis … Stück“: leer = nicht festgelegt, 0 = nie. */
export const WS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "nicht festgelegt" },
  { value: "0", label: "nie (immer DHL)" },
  ...Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: `bis ${i + 1} Stück` })),
];

/** „“ → null, „0“…„99“ → Zahl, sonst undefined (ungültig). */
export function parseWsMax(v: string): number | null | undefined {
  const t = v.trim();
  if (t === "") return null;
  if (!/^\d{1,2}$/.test(t)) return undefined;
  return Number(t);
}
