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

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

/**
 * Basis für Links, die am Handy aufgehen sollen (Seiten mit Anmeldung, z. B. /schnell): die eingestellte Adresse
 * (APP_URL), sonst die Adresse, unter der die Anfrage ankam (X-Forwarded-Host) – nie „localhost“ oder ein internes
 * Netz, solange es eine öffentliche gibt. `request.url` taugt hinter dem Webserver nicht (zeigt den internen Port).
 * PUBLIC_URL (Claude-Adresse) nur als letzte Wahl: dort sind die Seiten absichtlich nicht freigegeben.
 */
export function linkBasis(request: Request, env: Record<string, string | undefined> = process.env): string {
  const kandidaten: (string | null)[] = [];
  const app = origin(env.APP_URL);
  if (app) kandidaten.push(`${app.protocol}//${app.host}`);
  const h = request.headers;
  const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() || "https";
  for (const host of [h.get("x-forwarded-host"), h.get("host")]) {
    const x = (host ?? "").split(",")[0].trim();
    if (x && /^[a-z0-9.-]+(:\d+)?$/i.test(x)) kandidaten.push(`${proto === "http" ? "http" : "https"}://${x}`);
  }
  const offen = kandidaten.find((k) => k && !PRIVATE_HOST.test(new URL(k).hostname) && (!publicUrl(env) || new URL(k).host !== new URL(publicUrl(env)!).host));
  return offen ?? kandidaten.find((k) => k && !PRIVATE_HOST.test(new URL(k).hostname)) ?? publicUrl(env) ?? kandidaten[0] ?? new URL(request.url).origin;
}

export type AddressFinding = { ok: boolean; text: string };
export type AddressReport = {
  appUrl: string | null;
  publicUrl: string | null;
  findings: AddressFinding[];
  /** Beispiele der Links, die das System mit diesen Adressen baut. */
  links: { label: string; url: string }[];
};

function origin(raw: string | undefined | null): URL | null {
  if (!raw?.trim()) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/**
 * Adressen-Check für Einstellungen und Abnahme: Stimmen APP_URL (Links in Meldungen, Google/Microsoft-Anmeldung,
 * Anmelde-Cookie) und PUBLIC_URL (Claude, Kunden-Links)? `current` = Adresse, unter der der Browser gerade aufruft.
 */
export function addressCheck(env: Record<string, string | undefined> = process.env, current?: string | null): AddressReport {
  const findings: AddressFinding[] = [];
  const app = origin(env.APP_URL);
  const pub = origin(env.PUBLIC_URL);
  const appBase = app ? `${app.protocol}//${app.host}` : null;
  const pubBase = pub ? `${pub.protocol}//${pub.host}` : null;
  if (!app) findings.push({ ok: false, text: "APP_URL fehlt – Links in Meldungen und die Google/Microsoft-Anmeldung nehmen die Adresse des jeweiligen Aufrufs." });
  else {
    findings.push(app.protocol === "https:" ? { ok: true, text: "APP_URL mit https – Anmelde-Cookie nur verschlüsselt." } : { ok: false, text: "APP_URL ohne https – Anmelde-Cookie und Links unverschlüsselt." });
    findings.push(PRIVATE_HOST.test(app.hostname) ? { ok: false, text: `APP_URL ist eine interne Adresse (${app.hostname}) – Links in Meldungen gehen unterwegs nicht auf.` } : { ok: true, text: "APP_URL ist eine öffentliche Adresse." });
  }
  if (pub) {
    const r = claudeReachable(pubBase!);
    findings.push(r.ok ? { ok: true, text: "PUBLIC_URL (Claude, Kunden-Links) mit https und öffentlich." } : { ok: false, text: `PUBLIC_URL: ${r.reason}.` });
  }
  const cur = origin(current ?? undefined);
  if (cur && app && cur.host !== app.host && (!pub || cur.host !== pub.host))
    findings.push({ ok: false, text: `Du rufst das System gerade unter ${cur.protocol}//${cur.host} auf, Links zeigen auf ${appBase}. Am besten nur noch ${appBase} benutzen.` });
  if (cur && cur.protocol === "http:" && !PRIVATE_HOST.test(cur.hostname))
    findings.push({ ok: false, text: `Aufruf über http (${cur.host}) – unverschlüsselt. Port nach außen schließen: deploy/absichern.sh.` });
  const base = appBase ?? (cur ? `${cur.protocol}//${cur.host}` : "http://localhost:3000");
  const share = pubBase ?? base;
  return {
    appUrl: appBase,
    publicUrl: pubBase,
    findings,
    links: [
      { label: "Meldung zu einer Sendung", url: `${base}/paletten/sendungen/…` },
      { label: "Kunden-Link einer Sendung", url: `${share}/sendung/…` },
      { label: "Google-Anmeldung (Weiterleitung)", url: `${base}/api/oauth/google/callback` },
      { label: "Microsoft-Anmeldung (Weiterleitung)", url: `${base}/api/oauth/microsoft/callback` },
      { label: "Claude-Konnektor", url: `${pubBase ?? base}/api/mcp` },
    ],
  };
}
