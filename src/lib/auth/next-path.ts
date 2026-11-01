// Nach dem Login zurück, wohin man wollte – nur für die Claude-Freigabe (OAuth) und den Kauf-Kurzlink /k/17
// (Kaufen mit einem Tap), kein offener Weiterleiter.
export function safeNext(v: unknown): string | null {
  const s = String(v ?? "");
  if (s.length > 3000) return null;
  if (/^\/oauth\/authorize(\?[^\s#\\]*)?$/.test(s)) return s;
  if (/^\/k\/(\d{1,5}|[0-9a-f-]{36})(\?(code|produkt)=1)?$/i.test(s)) return s;
  return null;
}
