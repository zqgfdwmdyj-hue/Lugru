// Geschäftliche Fristen – reine Logik (ohne Datenbank).

const plusTage = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Fälligkeit der USt-Voranmeldung: 10. des Folgemonats (Quartal: nach Quartalsende), mit Dauerfristverlängerung einen Monat später. */
export function ustvaTermine(heute: string, bis: string, rhythmus: "monatlich" | "quartal", dauerfrist: boolean): { datum: string; zeitraum: string }[] {
  const out: { datum: string; zeitraum: string }[] = [];
  let [j, m] = [Number(heute.slice(0, 4)), Number(heute.slice(5, 7)) - 2];
  for (let i = 0; i < 18; i++, m++) {
    const jahr = j + Math.floor(m / 12);
    const mon = ((m % 12) + 12) % 12; // 0-basiert: Monat des Zeitraums
    if (rhythmus === "quartal" && mon % 3 !== 2) continue;
    const f = new Date(Date.UTC(jahr, mon + 1 + (dauerfrist ? 1 : 0), 10)).toISOString().slice(0, 10);
    const zeitraum = rhythmus === "quartal" ? `Q${Math.floor(mon / 3) + 1}/${jahr}` : `${String(mon + 1).padStart(2, "0")}/${jahr}`;
    if (f >= plusTage(heute, -5) && f <= bis) out.push({ datum: f, zeitraum });
  }
  return out;
}
