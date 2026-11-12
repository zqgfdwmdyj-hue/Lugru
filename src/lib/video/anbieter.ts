import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getIntegration } from "@/lib/integrations/store";
import { claudeNutzung, kostenPosition } from "./logic";
import { kostenBuchen, videoEinstellungen, type Worker } from "./service";

// B36 Anbieter-Brücke: Der Worker ruft Claude, ElevenLabs und OpenAI über das Seller-System auf. Die Schlüssel bleiben
// verschlüsselt hier (Anbindungen), der Worker kennt nur sein Worker-Token. Jeder Aufruf wird dem Auftrag (Kopf
// „x-auftrag“) zugeordnet und die Kosten werden aus der Antwort gezählt (Tokens/Websuchen, Zeichen, Bilder).
// Nur diese drei Pfade sind erlaubt – keine offene Weiterleitung.

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
    const m = /^v1\/text-to-speech\/([A-Za-z0-9]{6,40})$/.exec(p);
    if (!m) return { fehler: "Pfad nicht erlaubt", status: 404 };
    const k = await getIntegration(tenantId, "elevenlabs");
    if (!k?.apiKey) return { fehler: "ElevenLabs-Schlüssel fehlt (Anbindungen → ElevenLabs)", status: 424 };
    const fmt = new URLSearchParams(q).get("output_format");
    const query = fmt && /^[a-z0-9_]{3,30}$/.test(fmt) ? `?output_format=${fmt}` : "";
    return { anbieter, url: `${basis(process.env.ELEVENLABS_BASE_URL, "https://api.elevenlabs.io")}/v1/text-to-speech/${m[1]}${query}`, kopf: { "xi-api-key": k.apiKey, "content-type": "application/json", accept: "audio/mpeg" } };
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
  const preise = (await videoEinstellungen(w.tenantId)).preise;
  let res: Response;
  try {
    res = await fetch(z.url, { method: "POST", headers: z.kopf, body: roh, signal: AbortSignal.any([request.signal, AbortSignal.timeout(z.anbieter === "anthropic" ? 600_000 : 180_000)]) });
  } catch (e) {
    return fehler(502, `Anbieter nicht erreichbar: ${e instanceof Error ? e.message : "Fehler"}`);
  }
  const kopf = new Headers();
  for (const h of ["content-type", "request-id", "x-request-id", "retry-after"]) {
    const v = res.headers.get(h);
    if (v) kopf.set(h, v);
  }
  kopf.set("cache-control", "no-store");

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
  if (res.ok) {
    const pos = z.anbieter === "elevenlabs" ? kostenPosition("elevenlabs", preise, { zeichen: String(body.text ?? "").length }) : kostenPosition("openai", preise, { bilder: typeof body.n === "number" ? body.n : 1, motiv: body.size === "1024x1024" });
    await kostenBuchen(w.tenantId, auftragId, pos);
  }
  return new Response(daten, { status: res.status, headers: kopf });
}

/** Motiv mit Stil-Referenzbildern (gpt-image-1 „edits“, multipart): Prompt, Anzahl und Bilder prüfen, weiterreichen, zählen. */
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
  const raus = new FormData();
  for (const [k, v] of form.entries()) raus.append(k, v);
  const preise = (await videoEinstellungen(w.tenantId)).preise;
  let res: Response;
  try {
    res = await fetch(z.url, { method: "POST", headers: z.kopf, body: raus, signal: AbortSignal.any([request.signal, AbortSignal.timeout(300_000)]) });
  } catch (e) {
    return fehler(502, `Anbieter nicht erreichbar: ${e instanceof Error ? e.message : "Fehler"}`);
  }
  const daten = new Uint8Array(await res.arrayBuffer());
  if (res.ok) await kostenBuchen(w.tenantId, auftragId, kostenPosition("openai", preise, { bilder: n, motiv: form.get("size") === "1024x1024" }));
  return new Response(daten, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
}
