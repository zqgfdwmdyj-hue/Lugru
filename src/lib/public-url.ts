// Öffentliche Adresse des Seller-Systems (PUBLIC_URL), wenn die App selbst nur im privaten Netz läuft (z. B. Tailscale).
// Claude (claude.ai) erreicht den Konnektor nur über eine öffentliche https-Adresse, und Kunden-Links für Sendungen
// müssen auch für Kunden außerhalb des eigenen Netzes aufgehen. Ohne PUBLIC_URL gilt die normale Adresse (APP_URL).
// Keine Datenbank, kein Next – auch in next.config und in Tests nutzbar.

/** PUBLIC_URL ohne Schrägstrich am Ende – nur http(s)-Adressen ohne Pfad, sonst null. */
export function publicUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.PUBLIC_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** Für Server Actions hinter einem Proxy (Tailscale Funnel …): Host der öffentlichen Adresse als erlaubter Ursprung. */
export function publicOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const p = publicUrl(env);
  if (!p) return [];
  const u = new URL(p);
  return [...new Set([u.host, u.hostname])];
}

/** Ist das eine Adresse, die Claude akzeptiert (https, kein privates Netz)? */
export function claudeReachable(base: string): { ok: boolean; reason?: string } {
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    return { ok: false, reason: "keine gültige Adresse" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "Claude verlangt https://" };
  const h = u.hostname;
  if (h === "localhost" || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h))
    return { ok: false, reason: "Adresse im privaten Netz – für Claude nicht erreichbar" };
  return { ok: true };
}
