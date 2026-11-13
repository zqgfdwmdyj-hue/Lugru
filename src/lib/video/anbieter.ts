import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getIntegration } from "@/lib/integrations/store";
import { bildModellFehlt, bildModellReihenfolge, claudeMitPlatz, claudeNutzung, kostenPosition, stimmeMitTempo, schluesselAbgelehnt, type BildModell } from "./logic";
import { kostenBuchen, videoEinstellungen, type Worker } from "./service";

// B36 Anbieter-Brücke: Der Worker ruft Claude, ElevenLabs und OpenAI über das Seller-System auf. Die Schlüssel bleiben
// verschlüsselt hier (Anbindungen), der Worker kennt nur sein Worker-Token. Jeder Aufruf wird dem Auftrag (Kopf
// „x-auftrag“) zugeordnet und die Kosten werden aus der Antwort gezählt (Tokens/Websuchen, Zeichen, Bilder).
// Nur diese drei Pfade sind erlaubt – keine offene Weiterleitung.
// Bilder: Das Modell setzt die Brücke aus den Video-Einstellungen (die Angabe des Workers zählt nicht – so laufen auch
// ältere Worker nach einer Abschaltung bei OpenAI weiter). Fehlt das Modell im Konto, nimmt sie das nächste.
// Abgelehnter Schlüssel (401): eigene klare Meldung, nie der Text des Anbieters (der zeigt Teile des Schlüssels).

type Ziel = { anbieter: "anthropic" | "elevenlabs" | "openai"; url: string; kopf: Record<string, string> };

const basis = (env: string | undefined, standard: string) => (env || standard).replace(/\/$/, "");

const WEITER_ANTHROPIC = ["anthropic-version", "anthropic-beta", "content-type", "accept"];

async function ziel(tenantId: string, anbieter: string, pfad: string[], request: Request): Promise<Ziel | { fehler: string; status: number }> {
  const p = pfad.join("/");
  const q = new URL(request.url).search;
  if (anbieter === "anthropic") {
    if (p !== "v1/messages") return { fehler: "Pfad nicht erlaubt", status: 404 };
    const k = await getIntegration(tenantId, "anthropic");
    if (!k?.apiKey) return { fehler: "Claude-Schlüssel fehlt (Anbindungen → KI (Claude))", status: 424 };
    const kopf: Record<string, string> = { "x-api-key": k.apiKey };
    for (const h of WEITER_ANTHROPIC) {
      const v = request.headers.get(h);
      if (v) kopf[h] = v;
    }
    kopf["anthropic-version"] ??= "2023-06-01";
    return { anbieter, url: `${basis(process.env.ANTHROPIC_BASE_URL, "https://api.anthropic.com")}/v1/messages`, kopf };
  }
  if (anbieter === "elevenlabs") {
    // B36.10: „/with-timestamps“ liefert Audio (base64) + Zeichenzeiten → Motive erscheinen beim Schlüsselwort (gleicher Preis)
    const m = /^v1\/text-to-speech\/([A-Za-z0-9]{6,40})(\/with-timestamps)?$/.exec(p);
    if (!m) return { fehler: "Pfad nicht erlaubt", status: 404 };
    const k = await getIntegration(tenantId, "elevenlabs");
    if (!k?.apiKey) return { fehler: "ElevenLabs-Schlüssel fehlt (Anbindungen → ElevenLabs)", status: 424 };
    const fmt = new URLSearchParams(q).get("output_format");
    const query = fmt && /^[a-z0-9_]{3,30}$/.test(fmt) ? `?output_format=${fmt}` : "";
    return { anbieter, url: `${basis(process.env.ELEVENLABS_BASE_URL, "https://api.elevenlabs.io")}/v1/text-to-speech/${m[1]}${m[2] ?? ""}${query}`, kopf: { "xi-api-key": k.apiKey, "content-type": "application/json", accept: m[2] ? "application/json" : "audio/mpeg" } };
  }
  if (anbieter === "openai") {
    // generations: Bild aus Text (JSON); edits: Motiv mit Stil-Referenzbildern (multipart, B36.9)
    if (p !== "v1/images/generations" && p !== "v1/images/edits") return { fehler: "Pfad nicht erlaubt", status: 404 };
    const k = await getIntegration(tenantId, "openai");
    if (!k?.apiKey) return { fehler: "OpenAI-Schlüssel fehlt (Anbindungen → OpenAI Bilder)", status: 424 };
    return { anbieter, url: `${basis(process.env.OPENAI_BASE_URL, "https://api.openai.com")}/${p}`, kopf: p === "v1/images/edits" ? { authorization: `Bearer ${k.apiKey}` } : { authorization: `Bearer ${k.apiKey}`, "content-type": "application/json" } };
  }
  return { fehler: "Unbekannter Anbieter", status: 404 };
}

// Gespeicherte Einstellungen je Stimme (10 Min. gemerkt): die Brücke ergänzt damit voice_settings (Sprechtempo)
const stimmenCache = new Map<string, { bis: number; werte: Record<string, unknown> | null }>();
async function stimmeEinstellungen(tenantId: string, z: Ziel): Promise<Record<string, unknown> | null> {
  const stimme = /\/v1\/text-to-speech\/([A-Za-z0-9]+)/.exec(z.url)?.[1];
  if (!stimme) return null;
  const k = `${tenantId}:${stimme}`;
  const c = stimmenCache.get(k);
  if (c && c.bis > Date.now()) return c.werte;
  let werte: Record<string, unknown> | null = null;
  try {
    const r = await fetch(`${basis(process.env.ELEVENLABS_BASE_URL, "https://api.elevenlabs.io")}/v1/voices/${stimme}/settings`, { headers: { "xi-api-key": z.kopf["xi-api-key"] ?? "" }, signal: AbortSignal.timeout(15_000) });
    if (r.ok) werte = (await r.json()) as Record<string, unknown>;
  } catch {
    werte = null;
  }
  stimmenCache.set(k, { bis: Date.now() + 10 * 60_000, werte });
  return werte;
}

const fehler = (status: number, text: string) => Response.json({ type: "error", error: { type: "seller_bruecke", message: text } }, { status });

/** Prüft, ob der Text erlaubt ist (Bildideen und Sprache laufen ohnehin durch den Filter im Worker). */
function bodyPruefen(anbieter: Ziel["anbieter"], body: Record<string, unknown>): string | null {
  if (anbieter === "openai") {
    if (typeof body.prompt !== "string" || !body.prompt.trim()) return "prompt fehlt";
    const n = typeof body.n === "number" ? body.n : 1;
    if (n < 1 || n > 2) return "höchstens 2 Bilder je Aufruf";
  }
  if (anbieter === "elevenlabs" && (typeof body.text !== "string" || body.text.length > 6000)) return "text fehlt oder zu lang (höchstens 6000 Zeichen je Szene)";
  return null;
}

export async function weiterleiten(w: Worker, anbieter: string, pfad: string[], request: Request): Promise<Response> {
  if (request.method !== "POST") return fehler(405, "Nur POST");
  const auftragId = request.headers.get("x-auftrag") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(auftragId)) return fehler(400, "Kopf x-auftrag fehlt");
  const [a] = await db.select({ id: schema.videoAuftraege.id, status: schema.videoAuftraege.status }).from(schema.videoAuftraege).where(and(eq(schema.videoAuftraege.tenantId, w.tenantId), eq(schema.videoAuftraege.id, auftragId)));
  if (!a) return fehler(404, "Auftrag nicht gefunden");
  if (a.status === "abgebrochen") return fehler(409, "Auftrag abgebrochen");
  const z = await ziel(w.tenantId, anbieter, pfad, request);
  if ("fehler" in z) return fehler(z.status, z.fehler);
  if (z.anbieter === "openai" && z.url.endsWith("/v1/images/edits")) return bildBearbeiten(w, auftragId, z, request);
  const roh = await request.text();
  if (roh.length > 2_000_000) return fehler(413, "Anfrage zu groß");
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(roh) as Record<string, unknown>;
  } catch {
    return fehler(400, "Kein JSON");
  }
  const falsch = bodyPruefen(z.anbieter, body);
  if (falsch) return fehler(400, falsch);
  const cfg = await videoEinstellungen(w.tenantId);
  const preise = cfg.preise;
  if (z.anbieter === "openai") {
    // Bild aus Text: Modell aus den Einstellungen, bei „Modell fehlt“ das nächste
    const r = await mitBildModell(w.tenantId, cfg.bildModell, (modell) => fetch(z.url, { method: "POST", headers: z.kopf, body: JSON.stringify({ ...body, model: modell }), signal: AbortSignal.any([request.signal, AbortSignal.timeout(180_000)]) }));
    if (r instanceof Response) return r;
    if (r.res.ok) await kostenBuchen(w.tenantId, auftragId, kostenPosition("openai", preise, { bilder: typeof body.n === "number" ? body.n : 1, motiv: body.size === "1024x1024", bildModell: r.modell }));
    return new Response(r.daten, { status: r.res.status, headers: antwortKopf(r.res) });
  }
  // Claude: mindestens CLAUDE_PLATZ_MIN Tokens Platz (Denken zählt mit) – hilft auch Workern vor 1.2.1
  // ElevenLabs: Sprechtempo (voice_settings.speed) mit den gespeicherten Einstellungen der Stimme zusammenführen
  const mehrPlatz = z.anbieter === "anthropic" ? claudeMitPlatz(body) : z.anbieter === "elevenlabs" && body.voice_settings ? stimmeMitTempo(body, await stimmeEinstellungen(w.tenantId, z)) : null;
  const raus = mehrPlatz ? JSON.stringify(mehrPlatz) : roh;
  let res: Response;
  try {
    res = await fetch(z.url, { method: "POST", headers: z.kopf, body: raus, signal: AbortSignal.any([request.signal, AbortSignal.timeout(z.anbieter === "anthropic" ? 600_000 : 180_000)]) });
  } catch (e) {
    return fehler(502, `Anbieter nicht erreichbar: ${e instanceof Error ? e.message : "Fehler"}`);
  }
  if (res.status === 401) {
    await res.body?.cancel().catch(() => undefined);
    return fehler(401, schluesselAbgelehnt(z.anbieter));
  }
  const kopf = antwortKopf(res);

  if (z.anbieter === "anthropic") {
    if (!res.body) return new Response(null, { status: res.status, headers: kopf });
    // Durchreichen (auch Streaming) und dabei mitlesen; am Ende Tokens/Websuchen verbuchen.
    const dec = new TextDecoder();
    let text = "";
    const mitlesen = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        if (text.length < 4_000_000) text += dec.decode(chunk, { stream: true });
        ctrl.enqueue(chunk);
      },
      async flush() {
        if (!res.ok) return;
        const n = claudeNutzung(text);
        await kostenBuchen(w.tenantId, auftragId, kostenPosition("anthropic", preise, { eingabe: n.eingabe, ausgabe: n.ausgabe, websuchen: n.websuchen, modell: typeof body.model === "string" ? body.model : null })).catch(() => undefined);
      },
    });
    return new Response(res.body.pipeThrough(mitlesen), { status: res.status, headers: kopf });
  }

  let daten: ArrayBuffer;
  try {
    daten = await res.arrayBuffer();
  } catch (e) {
    // Verbindung zum Anbieter mitten in der Antwort abgebrochen – der Worker wiederholt bei 502 von selbst
    return fehler(502, `Antwort des Anbieters abgebrochen: ${e instanceof Error ? e.message : "Fehler"}`);
  }
  if (res.ok) await kostenBuchen(w.tenantId, auftragId, kostenPosition("elevenlabs", preise, { zeichen: String(body.text ?? "").length }));
  return new Response(daten, { status: res.status, headers: kopf });
}

function antwortKopf(res: Response): Headers {
  const kopf = new Headers();
  for (const h of ["content-type", "request-id", "x-request-id", "retry-after"]) {
    const v = res.headers.get(h);
    if (v) kopf.set(h, v);
  }
  kopf.set("cache-control", "no-store");
  return kopf;
}

// Zuletzt funktionierendes Bildmodell je Mandant (30 Min.): nach einem Ausweichen nicht jedes Bild erst mit dem fehlenden versuchen.
const bildModellOk = new Map<string, { gewaehlt: BildModell; modell: BildModell; bis: number }>();

/** OpenAI-Aufruf mit dem gewählten Bildmodell; meldet OpenAI „Modell gibt es nicht / nicht freigeschaltet“, das nächste. */
async function mitBildModell(tenantId: string, gewaehlt: BildModell, senden: (modell: BildModell) => Promise<Response>): Promise<Response | { res: Response; daten: ArrayBuffer; modell: BildModell }> {
  const g = bildModellOk.get(tenantId);
  const reihe = bildModellReihenfolge(gewaehlt, g && g.gewaehlt === gewaehlt && g.bis > Date.now() ? g.modell : null);
  const fehlt: string[] = [];
  for (const modell of reihe) {
    let res: Response;
    let daten: ArrayBuffer;
    try {
      res = await senden(modell);
    } catch (e) {
      return fehler(502, `Anbieter nicht erreichbar: ${e instanceof Error ? e.message : "Fehler"}`);
    }
    try {
      daten = await res.arrayBuffer();
    } catch (e) {
      return fehler(502, `Antwort des Anbieters abgebrochen: ${e instanceof Error ? e.message : "Fehler"}`);
    }
    if (res.status === 401) return fehler(401, schluesselAbgelehnt("openai"));
    if (!res.ok && bildModellFehlt(res.status, new TextDecoder().decode(daten.slice(0, 4000)))) {
      fehlt.push(modell);
      continue;
    }
    if (res.ok) bildModellOk.set(tenantId, { gewaehlt, modell, bis: Date.now() + 30 * 60_000 });
    return { res, daten, modell };
  }
  return fehler(400, `Kein Bildmodell im OpenAI-Konto nutzbar (versucht: ${fehlt.join(", ")}). Im OpenAI-Konto prüfen: Projekt → erlaubte Modelle, ggf. Settings → Organization → „Verify Organization“. Danach unter Anbindungen → OpenAI „Verbindung testen“.`);
}

/** Motiv mit Stil-Referenzbildern (OpenAI „edits“, multipart): Prompt, Anzahl und Bilder prüfen, weiterreichen, zählen. */
async function bildBearbeiten(w: Worker, auftragId: string, z: Ziel, request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fehler(400, "Kein multipart/form-data");
  }
  const prompt = form.get("prompt");
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 32_000) return fehler(400, "prompt fehlt oder zu lang");
  const n = Number(form.get("n") ?? 1) || 1;
  if (n < 1 || n > 2) return fehler(400, "höchstens 2 Bilder je Aufruf");
  const bilder = [...form.getAll("image[]"), ...form.getAll("image")].filter((x): x is File => typeof x !== "string");
  if (!bilder.length || bilder.length > 8) return fehler(400, "1–8 Referenzbilder nötig");
  if (bilder.some((b) => b.size > 10 * 1024 ** 2 || !/^image\/(png|jpeg|webp)$/.test(b.type))) return fehler(400, "Referenzbilder nur PNG/JPG/WebP bis 10 MB");
  const cfg = await videoEinstellungen(w.tenantId);
  const r = await mitBildModell(w.tenantId, cfg.bildModell, (modell) => {
    const raus = new FormData();
    for (const [k, v] of form.entries()) if (k !== "model") raus.append(k, v);
    raus.set("model", modell);
    return fetch(z.url, { method: "POST", headers: z.kopf, body: raus, signal: AbortSignal.any([request.signal, AbortSignal.timeout(300_000)]) });
  });
  if (r instanceof Response) return r;
  if (r.res.ok) await kostenBuchen(w.tenantId, auftragId, kostenPosition("openai", cfg.preise, { bilder: n, motiv: form.get("size") === "1024x1024", bildModell: r.modell }));
  return new Response(r.daten, { status: r.res.status, headers: { "content-type": r.res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
}
