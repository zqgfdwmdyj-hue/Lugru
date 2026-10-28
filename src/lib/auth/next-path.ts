// Nach dem Login zurück, wohin man wollte – nur für die Claude-Freigabe (OAuth), kein offener Weiterleiter.
export function safeNext(v: unknown): string | null {
  const s = String(v ?? "");
  return s.length <= 3000 && /^\/oauth\/authorize(\?[^\s#\\]*)?$/.test(s) ? s : null;
}
