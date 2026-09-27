import { Response as Res, type Request as Req, type Router } from './router';

/**
 * Führt einen Aufruf gegen die Router aus – wie Express im bisherigen Tool, einschließlich
 * der zentralen Fehlerbehandlung (verständliche Meldung als JSON, Status 400).
 */
export async function dispatch(
  routers: Router[],
  opts: { method: string; path: string; query?: URLSearchParams; body?: unknown }
): Promise<Response> {
  for (const router of routers) {
    const hit = router.match(opts.method, opts.path);
    if (!hit) continue;
    const req: Req = { params: hit.params, query: Object.fromEntries(opts.query ?? []), body: opts.body ?? {} };
    const res = new Res();
    let error: unknown;
    await hit.handler(req, res, (err) => {
      error = err ?? new Error('Unbekannter Fehler');
    });
    if (error !== undefined) {
      let message = error instanceof Error ? error.message : String(error);
      if (message === 'NOT_CONNECTED') {
        message = 'Keine eBay-Verbindung. Bitte in den Einstellungen „Mit eBay verbinden" ausführen.';
      }
      if (!(error instanceof Error)) console.error('[eBay]', error);
      return Response.json({ error: message }, { status: 400 });
    }
    return res.toResponse();
  }
  return Response.json({ error: 'Unbekannte Adresse.' }, { status: 404 });
}
