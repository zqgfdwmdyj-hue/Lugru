import { mobilFehler, mobilOk } from "@/lib/mobil/antwort";
import { mobilPruefen } from "@/lib/mobil/token";

// Apple Watch (Bauauftrag Handy-Tesla §10): Kurzantworten für Siri-Kurzbefehle – höchstens 3 Zeilen / 160 Zeichen,
// dazu „sprich“ (vorlesen) und „zeige“ (Display). Anmeldung mit dem Handy-Schlüssel (Bearer mk_…), Rechte der Person.
//   stand, dringend, tesla        – nur lesen (GET oder POST)
//   deal                          – nur lesen, braucht Text („B0… für 19,99“)
//   erledigt, notiz, bestand      – ändern nur, was gesagt wurde (POST mit { text })

export const dynamic = "force-dynamic";

const LESEN = ["stand", "dringend", "tesla", "deal"] as const;
const AENDERN = ["erledigt", "notiz", "bestand"] as const;
type Aktion = (typeof LESEN)[number] | (typeof AENDERN)[number];
const istAktion = (a: string): a is Aktion => (LESEN as readonly string[]).includes(a) || (AENDERN as readonly string[]).includes(a);

/** Text aus JSON { text }, Formular, reinem Text oder ?text= lesen. */
async function textAus(request: Request): Promise<string> {
  const q = new URL(request.url).searchParams.get("text");
  if (request.method !== "POST") return q ?? "";
  const typ = request.headers.get("content-type") ?? "";
  if (typ.includes("application/json")) {
    const b = (await request.json().catch(() => null)) as { text?: unknown } | null;
    return typeof b?.text === "string" ? b.text : (q ?? "");
  }
  if (typ.includes("form")) {
    const v = (await request.formData().catch(() => null))?.get("text");
    return typeof v === "string" ? v : (q ?? "");
  }
  return ((await request.text().catch(() => "")) || q) ?? "";
}

async function bearbeiten(request: Request, { params }: { params: Promise<{ aktion: string }> }) {
  const { aktion } = await params;
  if (!istAktion(aktion)) return mobilFehler(404, "Unbekannter Watch-Befehl. Möglich: stand, dringend, erledigt, notiz, deal, bestand, tesla.");
  const schreibend = (AENDERN as readonly string[]).includes(aktion);
  if (schreibend && request.method !== "POST") return mobilFehler(405, "Bitte als POST senden (Kurzbefehl: Methode POST, JSON-Feld „text“).", { Allow: "POST" });
  const p = await mobilPruefen(request, `watch/${aktion}`, { schreibend });
  if (!p.ok) return mobilFehler(p.status, p.fehler);
  const text = (await textAus(request)).replace(/\s+/g, " ").trim().slice(0, 600);
  const w = await import("@/lib/mobil/watch");
  try {
    const r =
      aktion === "stand"
        ? await w.watchStand(p.session)
        : aktion === "dringend"
          ? await w.watchDringend(p.session)
          : aktion === "tesla"
            ? await w.watchTesla(p.session)
            : aktion === "deal"
              ? await w.watchDeal(p.session, text)
              : aktion === "erledigt"
                ? await w.watchErledigt(p.session, text)
                : aktion === "notiz"
                  ? await w.watchNotiz(p.session, text, { tokenId: p.tokenId })
                  : await w.watchBestand(p.session, text);
    // „antwort“ wie bei den anderen Handy-Endpunkten (Kurzbefehle lesen dieses Feld auch bei Fehlern).
    return mobilOk({ ...r, antwort: r.zeige }, r.ok ? 200 : 422);
  } catch (e) {
    console.error(`[Watch ${aktion}]`, e instanceof Error ? e.message : e);
    return mobilFehler(500, "Das ging gerade nicht – bitte am Handy öffnen.");
  }
}

export const GET = bearbeiten;
export const POST = bearbeiten;
