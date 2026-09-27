const RETRY_DELAY_MS = 2000;

function extractErrorMessage(json: unknown, status: number): string {
  const errors = (json as { errors?: { message?: string; longMessage?: string }[] })?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return errors.map((e) => e.longMessage ?? e.message ?? '').filter(Boolean).join(' | ') || `HTTP ${status}`;
  }
  return `HTTP ${status}`;
}

export class EbayHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** eBays errorId-Liste — stabiler als der lokalisierte Meldungstext. */
    public readonly errorIds: number[] = []
  ) {
    super(message);
  }

  /** Trägt die Antwort eine bestimmte eBay-Fehlernummer? */
  has(errorId: number): boolean {
    return this.errorIds.includes(errorId);
  }
}

function extractErrorIds(json: unknown): number[] {
  const errors = (json as { errors?: { errorId?: number }[] })?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.map((e) => e.errorId).filter((id): id is number => typeof id === 'number');
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Vorübergehend, ein zweiter Versuch kann klappen: Drosselung und eBay-eigene Aussetzer. */
function isTransient(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Führt einen eBay-API-Request aus. Bei Drosselung (429) und bei eBay-seitigen
 * Serverfehlern (5xx, z.B. „Interner Core Inventory Service-Fehler", errorId
 * 25001) wird einmal nach kurzer Pause wiederholt — solche Fehler sind
 * regelmäßig vorübergehend. 4xx wird nicht wiederholt: ein abgelehnter Payload
 * wird beim zweiten Mal nicht besser. Fehler werden als EbayHttpError mit der
 * Meldung aus errors[] geworfen. 204-Antworten liefern null.
 */
export async function ebayFetch(
  url: string,
  init: RequestInit & { headers: Record<string, string> }
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if (isTransient(res.status) && attempt === 0) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    if (res.status === 204) return null;
    const text = await res.text();
    const json = text ? safeParse(text) : null;
    if (!res.ok) throw new EbayHttpError(extractErrorMessage(json, res.status), res.status, extractErrorIds(json));
    return json;
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
