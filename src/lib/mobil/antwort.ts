// Einheitliche Antworten der Handy-Endpunkte (/api/mobil/*): immer JSON, nie gecacht. Fehler tragen neben `error`
// auch `antwort` – Kurzbefehle lesen dieses Feld vor, auch wenn etwas schiefgeht.

const KOPF = { "Cache-Control": "no-store" } as const;

export function mobilOk<T extends Record<string, unknown>>(daten: T, status = 200): Response {
  return Response.json({ ok: true, ...daten }, { status, headers: KOPF });
}

export function mobilFehler(status: number, text: string, extra: Record<string, string> = {}): Response {
  return Response.json({ ok: false, error: text, antwort: text }, { status, headers: { ...KOPF, ...extra } });
}

/** Falsche Methode (z. B. Kurzbefehl steht noch auf GET). */
export const mobilNurPost = () => mobilFehler(405, "Bitte als POST senden (Kurzbefehl: Methode POST, JSON-Feld „text“).", { Allow: "POST" });
