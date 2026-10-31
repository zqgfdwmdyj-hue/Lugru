import "server-only";
import { zerlegeUstId } from "./logic";

// USt-IdNr. bei der EU prüfen (VIES, REST). Mit eigener USt-IdNr. als Anfragender gibt VIES eine Kennung der
// qualifizierten Abfrage zurück – sie dient als Nachweis für Reverse Charge.

const URL_VIES = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";

export type ViesErgebnis = { gueltig: boolean | null; name: string | null; adresse: string | null; kennung: string | null; fehler: string | null };

const FEHLER: Record<string, string> = {
  INVALID_INPUT: "USt-IdNr. hat ein ungültiges Format.",
  MS_UNAVAILABLE: "Der Prüfdienst dieses Landes ist gerade nicht erreichbar – später erneut prüfen.",
  MS_MAX_CONCURRENT_REQ: "Zu viele Anfragen an das Land – in ein paar Minuten erneut prüfen.",
  SERVICE_UNAVAILABLE: "VIES ist gerade nicht erreichbar – später erneut prüfen.",
  TIMEOUT: "VIES hat nicht rechtzeitig geantwortet – später erneut prüfen.",
  INVALID_REQUESTER_INFO: "Die eigene USt-IdNr. (Einstellungen → B2B-Deals) ist ungültig.",
};

export async function viesPruefen(ustId: string, eigene?: string | null): Promise<ViesErgebnis> {
  const z = zerlegeUstId(ustId);
  if (!z) return { gueltig: false, name: null, adresse: null, kennung: null, fehler: FEHLER.INVALID_INPUT };
  const ich = zerlegeUstId(eigene);
  try {
    const res = await fetch(process.env.VIES_URL || URL_VIES, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ countryCode: z.land, vatNumber: z.nummer, ...(ich ? { requesterMemberStateCode: ich.land, requesterNumber: ich.nummer } : {}) }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await res.json().catch(() => ({}))) as { valid?: boolean; name?: string; address?: string; requestIdentifier?: string; errorWrappers?: { error?: string }[]; actionSucceed?: boolean };
    const code = j.errorWrappers?.[0]?.error;
    if (code || j.actionSucceed === false || typeof j.valid !== "boolean") return { gueltig: null, name: null, adresse: null, kennung: null, fehler: FEHLER[code ?? ""] ?? `VIES-Fehler ${code ?? res.status}` };
    const leer = (s?: string) => (s && s.trim() !== "---" ? s.trim() : null);
    return { gueltig: j.valid, name: leer(j.name), adresse: leer(j.address), kennung: leer(j.requestIdentifier), fehler: null };
  } catch (e) {
    return { gueltig: null, name: null, adresse: null, kennung: null, fehler: `VIES nicht erreichbar (${e instanceof Error ? e.message : String(e)}).` };
  }
}
