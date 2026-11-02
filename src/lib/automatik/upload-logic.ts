// Browser-Automatik: Hat ein Datei-Upload geklappt? Reine Logik (tests/upload-logic.test.ts).
// Befund 02.11.: BQool hat alle Länder angenommen, die Automatik meldete trotzdem „Keine Erfolgsmeldung“ – die Seite
// zeigt keinen der erwarteten Texte bzw. nur kurz einen Hinweis. Darum zählen jetzt mehrere Zeichen, und zwar nur, was
// NACH dem Klick neu ist (feste Texte der Seite wie eine Verlaufstabelle mit „Completed/Failed“ zählen nicht):
//  1. neuer Fehlertext oder abgelehnte Upload-Anfrage (HTTP ≥ 400 bzw. JSON mit success:false/error) → Fehler
//  2. neuer Erfolgstext (auch ein Hinweis, der gleich wieder verschwindet) → ok
//  3. der Dateiname taucht neu auf der Seite auf (z. B. in der Upload-Liste) → ok
//  4. am Ende: Server hat die Upload-Anfrage angenommen (HTTP 2xx/3xx) → ok („vom Server angenommen“)
//  5. sonst „unklar“ – kein Fehler, sondern „bitte kurz im Dienst prüfen“

export type UploadAntwort = { methode: string; status: number; mitDatei: boolean; fehlerText?: string | null };
export type UploadBefund = { art: "ok" | "fehler" | "offen"; wie?: "text" | "liste" | "server"; grund?: string };

/** Erweiterte Erfolgswörter (deutsch/englisch), u. a. „submitted“, „wird verarbeitet“, „in der Warteschlange“. */
export const UPLOAD_ERFOLG = /erfolgreich|successfully|success|importiert|imported|uploaded|hochgeladen|abgeschlossen|completed|submitted|eingereicht|received|empfangen|wird verarbeitet|in bearbeitung|processing|queued|warteschlange|übernommen|accepted|angenommen/i;
export const UPLOAD_FEHLER = /fehlgeschlagen|failed|ungültig|invalid format|invalid file|error:|abgelehnt|rejected|unsuccessful|nicht erfolgreich/i;

const alle = (re: RegExp) => new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
const anzahl = (re: RegExp, text: string) => (text.match(alle(re)) ?? []).length;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Kurzer Ausschnitt rund um den ersten Treffer (für die Meldung). */
function ausschnitt(re: RegExp, text: string): string {
  const m = new RegExp(re.source, re.flags.replace("g", "")).exec(text);
  if (!m) return "";
  const zeile = text.slice(Math.max(0, text.lastIndexOf("\n", m.index) + 1)).split("\n")[0] ?? m[0];
  return zeile.trim().slice(0, 160);
}

/** Fehlertext aus einer (kleinen) JSON-Antwort der Upload-Anfrage, sonst null. */
export function jsonFehler(body: string): string | null {
  const t = body.trim();
  if (!t.startsWith("{")) return null;
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    const nein = j.success === false || j.ok === false || j.status === "error" || j.status === "failed";
    const msg = [j.error, j.message, j.msg, j.errorMessage].find((x) => typeof x === "string" && x.trim()) as string | undefined;
    if (nein) return (msg ?? "vom Server abgelehnt").slice(0, 160);
    if (typeof j.error === "string" && j.error.trim()) return j.error.slice(0, 160);
    return null;
  } catch {
    return null;
  }
}

export function uploadBewerten(o: {
  /** Seitentext direkt vor dem Klick (Datei schon gewählt). */
  vorher: string;
  /** Seitentext jetzt. */
  jetzt: string;
  /** Seit dem Klick neu eingefügter Text (auch Hinweise, die wieder verschwunden sind). */
  neu: string;
  datei: string;
  antworten: UploadAntwort[];
  erfolg: RegExp;
  fehler?: RegExp;
  /** Wartezeit vorbei – jetzt auch „vom Server angenommen“ bzw. „unklar“ entscheiden. */
  fertig: boolean;
}): UploadBefund {
  const upload = o.antworten.filter((a) => a.methode !== "GET" && a.mitDatei);
  if (o.fehler) {
    if (anzahl(o.fehler, o.jetzt) > anzahl(o.fehler, o.vorher)) return { art: "fehler", grund: ausschnitt(o.fehler, o.jetzt) || "Fehler" };
    if (o.fehler.test(o.neu)) return { art: "fehler", grund: ausschnitt(o.fehler, o.neu) || "Fehler" };
  }
  const abgelehnt = upload.find((a) => a.status >= 400 || a.fehlerText);
  if (abgelehnt) return { art: "fehler", grund: abgelehnt.fehlerText ? `vom Server abgelehnt: ${abgelehnt.fehlerText}` : `vom Server abgelehnt (HTTP ${abgelehnt.status})` };
  if (anzahl(o.erfolg, o.jetzt) > anzahl(o.erfolg, o.vorher) || o.erfolg.test(o.neu)) return { art: "ok", wie: "text", grund: ausschnitt(o.erfolg, o.neu) || ausschnitt(o.erfolg, o.jetzt) };
  const name = new RegExp(esc(o.datei), "i");
  if (o.datei && anzahl(name, o.jetzt) > anzahl(name, o.vorher)) return { art: "ok", wie: "liste", grund: "Datei steht in der Upload-Liste" };
  if (!o.fertig) return { art: "offen" };
  const angenommen = upload.find((a) => a.status >= 200 && a.status < 400);
  if (angenommen) return { art: "ok", wie: "server", grund: `vom Server angenommen (HTTP ${angenommen.status}), ohne Textmeldung` };
  return { art: "offen", grund: upload.length ? "keine Bestätigung erkannt" : "keine Upload-Anfrage gesehen" };
}

/** Text für Protokoll und Anzeige je Erkennungsweg. */
export const WIE_TEXT: Record<NonNullable<UploadBefund["wie"]>, string> = {
  text: "Bestätigung auf der Seite",
  liste: "Datei in der Upload-Liste",
  server: "vom Server angenommen",
};
