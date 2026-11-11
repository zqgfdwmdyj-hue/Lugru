import "server-only";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { bestEmail, extractEmails } from "@/lib/leads/email-finder";
import { openPii, sealPii } from "@/lib/pii";
import { isTestEnv } from "@/lib/testenv";
import { impressumFakten, istCaptcha, laufBudget, LEAD_USER_AGENT, placesSuchenLesen, robotsErlaubt, stufe2Sperre } from "./lead-maschine-logic";
export { placesSuchenLesen, stufe2Sperre };
import { laufProtokoll, leadsSpeichern, monatsKosten } from "./lead-maschine";
import { leadsAusTabelle, type LeadEingabe } from "./logic";

// B35 Stufe 2 – automatische Läufe (Apify, Google Places, Impressum-Abruf) und die wöchentliche Charge-Vorbereitung.
// Gesperrt, bis die rechtliche Prüfung unter Leads → Quellen eingetragen ist; jede Quelle einzeln an/aus und nur mit
// Budget je Lauf und Monat (Abbruch bei Überschreitung). Ergebnisse landen als Leads – nie automatisch im Versand.
// Webseiten: robots.txt beachten, ≥ 6 s Pause, eigener User-Agent, nie parallel; Captcha/Sperre → überspringen + melden.

const L = schema.abverkaufLeads;
const R = schema.abverkaufLeadLaeufe;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PAUSE_MS = () => Math.max(0, Number(process.env.LEAD_PAUSE_MS ?? 6000));
const APIFY_TAKT_MS = () => Math.max(50, Number(process.env.APIFY_POLL_MS ?? 5000));
const APIFY_MAX_MS = () => Number(process.env.APIFY_MAX_MS ?? 15 * 60_000);
const heute = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());

type Quelle = "apify" | "places" | "impressum";
export type LaufErgebnis = { status: "fertig" | "abgebrochen" | "uebersprungen" | "fehler"; text: string };

async function cfgLaden(tenantId: string) {
  const { einstellungen } = await import("./service");
  return einstellungen(tenantId);
}

async function uebersprungen(tenantId: string, quelle: Quelle, grund: string): Promise<LaufErgebnis> {
  await laufProtokoll(tenantId, { quelle, status: "uebersprungen", meldung: grund });
  return { status: "uebersprungen", text: grund };
}

/** Ein Lauf je Quelle gleichzeitig. */
async function laeuftSchon(tenantId: string, quelle: Quelle) {
  const [r] = await db.select({ id: R.id }).from(R).where(and(eq(R.tenantId, tenantId), eq(R.quelle, quelle), eq(R.status, "laeuft"), sql`${R.gestartetAm} > now() - interval '2 hours'`)).limit(1);
  return !!r;
}

// ---- Apify ------------------------------------------------------------------------------------------------------

export async function apifyLauf(tenantId: string): Promise<LaufErgebnis> {
  const cfg = await cfgLaden(tenantId);
  const q = cfg.leadQuellen;
  const sperre = stufe2Sperre(q) ?? (!q.apify.aktiv ? "Apify ist ausgeschaltet" : !q.apify.actorId.trim() ? "Apify: Actor fehlt (Einstellungen)" : null);
  if (sperre) return uebersprungen(tenantId, "apify", sperre);
  if (await laeuftSchon(tenantId, "apify")) return { status: "uebersprungen", text: "Apify-Lauf läuft schon" };
  const { getIntegration } = await import("@/lib/integrations/store");
  const zugang = await getIntegration(tenantId, "apify");
  if (!zugang?.token) return uebersprungen(tenantId, "apify", "Apify-Zugang fehlt (Anbindungen)");
  const b = laufBudget({ budgetLauf: q.apify.budgetLauf, budgetMonat: q.apify.budgetMonat, monatBisher: await monatsKosten(tenantId, "apify") });
  if (!b.erlaubt) return uebersprungen(tenantId, "apify", `Apify: ${b.grund}`);
  let eingabe: unknown = {};
  try {
    eingabe = q.apify.eingabe.trim() ? JSON.parse(q.apify.eingabe) : {};
  } catch {
    return uebersprungen(tenantId, "apify", "Apify: Eingabe ist kein gültiges JSON (Einstellungen)");
  }
  const laufId = await laufProtokoll(tenantId, { quelle: "apify", status: "laeuft", waehrung: "USD", budget: b.erlaubt, meldung: `Actor ${q.apify.actorId}` });
  const fertig = async (status: LaufErgebnis["status"], text: string, o: { neu?: number; zus?: number; usd?: number } = {}) => {
    await db.update(R).set({ status, neu: o.neu ?? 0, zusammengefuehrt: o.zus ?? 0, kosten: Math.round((o.usd ?? 0) * 100) / 100, meldung: text.slice(0, 1000), beendetAm: new Date() }).where(eq(R.id, laufId));
    return { status, text } as LaufErgebnis;
  };
  const { apifyAbbrechen, apifyErgebnisse, apifyStarten, apifyStatus, flachTabelle } = await import("@/lib/integrations/clients/leadquellen");
  try {
    let run = await apifyStarten(zugang.token, q.apify.actorId, eingabe, { maxItems: q.apify.maxItems, maxUsd: b.erlaubt });
    const start = Date.now();
    let abgebrochen: string | null = null;
    while (["READY", "RUNNING"].includes(run.status)) {
      if (run.usd > b.erlaubt) {
        await apifyAbbrechen(zugang.token, run.id);
        abgebrochen = `Budget überschritten (${run.usd.toFixed(2)} $ > ${b.erlaubt.toFixed(2)} $) – Lauf abgebrochen`;
        break;
      }
      if (Date.now() - start > APIFY_MAX_MS()) {
        await apifyAbbrechen(zugang.token, run.id);
        abgebrochen = "Zeitlimit erreicht – Lauf abgebrochen";
        break;
      }
      await sleep(APIFY_TAKT_MS());
      run = await apifyStatus(zugang.token, run.id);
    }
    if (!abgebrochen && run.usd > b.erlaubt) abgebrochen = `Budget überschritten (${run.usd.toFixed(2)} $ > ${b.erlaubt.toFixed(2)} $)`;
    if (!abgebrochen && run.status !== "SUCCEEDED") return fertig("fehler", `Apify-Lauf endete mit ${run.status}`, { usd: run.usd });
    // Bis zum Abbruch gelieferte Ergebnisse werden übernommen (sie sind bezahlt) – nie Versand
    const items = run.datasetId ? await apifyErgebnisse(zugang.token, run.datasetId, q.apify.maxItems) : [];
    const t = flachTabelle(items);
    const r = leadsAusTabelle(t.headers, t.rows, { typ: "apify" });
    const e = await leadsSpeichern(tenantId, r.leads, { quelle: `Apify-Lauf (${q.apify.actorId.slice(0, 60)})`, quelleDatum: heute(), quelleTyp: "apify" });
    const text = `${abgebrochen ? `${abgebrochen}. ` : ""}${items.length} Ergebnisse: ${e.neu} neue Leads, ${e.doppelt + e.zusammengefuehrt} zusammengeführt, ${r.verworfen.length} verworfen · ${run.usd.toFixed(2)} $ von ${b.erlaubt.toFixed(2)} $`;
    return fertig(abgebrochen ? "abgebrochen" : "fertig", text, { neu: e.neu, zus: e.doppelt + e.zusammengefuehrt, usd: run.usd });
  } catch (err) {
    return fertig("fehler", `Apify: ${err instanceof Error ? err.message : "Fehler"}`);
  }
}

// ---- Google Places ------------------------------------------------------------------------------------------------

export async function placesLauf(tenantId: string): Promise<LaufErgebnis> {
  const cfg = await cfgLaden(tenantId);
  const q = cfg.leadQuellen;
  const suchen = placesSuchenLesen(q.places.suchen);
  const sperre = stufe2Sperre(q) ?? (!q.places.aktiv ? "Google Places ist ausgeschaltet" : !suchen.length ? "Google Places: keine Suche eingetragen" : !(q.places.preisJeAbruf && q.places.preisJeAbruf > 0) ? "Google Places: Preis je Abruf fehlt (Einstellungen)" : null);
  if (sperre) return uebersprungen(tenantId, "places", sperre);
  if (await laeuftSchon(tenantId, "places")) return { status: "uebersprungen", text: "Places-Lauf läuft schon" };
  const { getIntegration } = await import("@/lib/integrations/store");
  const zugang = await getIntegration(tenantId, "google_places");
  if (!zugang?.apiKey) return uebersprungen(tenantId, "places", "Google-Places-Zugang fehlt (Anbindungen)");
  const b = laufBudget({ budgetLauf: q.places.budgetLauf, budgetMonat: q.places.budgetMonat, monatBisher: await monatsKosten(tenantId, "places") });
  if (!b.erlaubt) return uebersprungen(tenantId, "places", `Google Places: ${b.grund}`);
  const laufId = await laufProtokoll(tenantId, { quelle: "places", status: "laeuft", budget: b.erlaubt });
  const { placesSuche } = await import("@/lib/integrations/clients/leadquellen");
  const preis = q.places.preisJeAbruf!;
  let kosten = 0;
  let abgebrochen: string | null = null;
  const eingang: LeadEingabe[] = [];
  try {
    for (const s of suchen) {
      let token: string | null = null;
      do {
        if (kosten + preis > b.erlaubt + 1e-9) {
          abgebrochen = `Budget erreicht (${kosten.toFixed(2)} € von ${b.erlaubt.toFixed(2)} €) – weitere Abrufe abgebrochen`;
          break;
        }
        const seite = await placesSuche(zugang.apiKey, { text: [s.begriff, s.ort].filter(Boolean).join(" in "), lat: cfg.lager.lat, lng: cfg.lager.lng, radiusM: s.radiusKm ? s.radiusKm * 1000 : null, pageToken: token });
        kosten += preis;
        for (const p of seite.treffer) eingang.push({ firma: p.name.slice(0, 200), strasse: p.strasse, plz: p.plz, ort: p.ort, land: (p.land ?? "DE").slice(0, 2).toUpperCase(), kategorie: p.kategorie ?? s.begriff, email: null, emailQuelle: null, website: p.website, adelprep: false, lat: p.lat, lng: p.lng, groesse: null, stueckJeArtikel: null, ustId: null, registerNr: null, marken: null, mitarbeiter: null, anzahlAsins: null, letzteAktivitaet: null, impressumUrl: null });
        token = seite.next;
        if (token) await sleep(Math.min(2000, PAUSE_MS()));
      } while (token);
      if (abgebrochen) break;
    }
    const e = await leadsSpeichern(tenantId, eingang, { quelle: `Google Places (${suchen.map((s) => s.begriff).join(", ").slice(0, 120)})`, quelleDatum: heute(), quelleTyp: "places" });
    const text = `${abgebrochen ? `${abgebrochen}. ` : ""}${eingang.length} Treffer: ${e.neu} neue Leads, ${e.doppelt + e.zusammengefuehrt} zusammengeführt · ${kosten.toFixed(2)} € von ${b.erlaubt.toFixed(2)} €`;
    await db.update(R).set({ status: abgebrochen ? "abgebrochen" : "fertig", neu: e.neu, zusammengefuehrt: e.doppelt + e.zusammengefuehrt, kosten: Math.round(kosten * 100) / 100, meldung: text, beendetAm: new Date() }).where(eq(R.id, laufId));
    return { status: abgebrochen ? "abgebrochen" : "fertig", text };
  } catch (err) {
    const text = `Google Places: ${err instanceof Error ? err.message : "Fehler"}`;
    await db.update(R).set({ status: "fehler", kosten: Math.round(kosten * 100) / 100, meldung: text, beendetAm: new Date() }).where(eq(R.id, laufId));
    return { status: "fehler", text };
  }
}

// ---- Impressum der Firmenwebsite ----------------------------------------------------------------------------------

export class CaptchaFehler extends Error {}

/** Abruf-Adresse: im Testbetrieb über den Nachbau (LEAD_WEB_BASE_URL/<host>/<pfad>), sonst nur öffentliche Adressen. */
async function zielUrl(raw: string): Promise<string> {
  const base = process.env.LEAD_WEB_BASE_URL;
  const u = new URL(raw);
  if (base && isTestEnv()) return `${base.replace(/\/$/, "")}/${u.hostname}${u.pathname}${u.search}`;
  const { assertPublicUrl } = await import("@/lib/suppliers/feed-service");
  return assertPublicUrl(raw).toString();
}

let letzterAbruf = 0;
/** Eine Seite holen: nie parallel, mindestens PAUSE_MS zwischen zwei Abrufen, eigener User-Agent, ohne Weiterleitung ins Nichtöffentliche. */
async function holen(raw: string): Promise<{ status: number; text: string }> {
  const warten = letzterAbruf + PAUSE_MS() - Date.now();
  if (warten > 0) await sleep(warten);
  letzterAbruf = Date.now();
  let url = await zielUrl(raw);
  for (let hop = 0; hop < 3; hop++) {
    const res = await fetch(url, { headers: { "User-Agent": LEAD_USER_AGENT, Accept: "text/html,text/plain", "Accept-Language": "de-DE,de;q=0.9" }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (next) {
      url = await zielUrl(new URL(next, raw).toString());
      continue;
    }
    const buf = await res.arrayBuffer();
    return { status: res.status, text: new TextDecoder().decode(buf.slice(0, 1024 * 1024)) };
  }
  return { status: 310, text: "" };
}

/** Impressum eines Leads abrufen (robots.txt, Pause, Captcha) – füllt nur leere Felder. */
export async function impressumAbrufen(tenantId: string, leadId: string, robotsCache = new Map<string, string | null>()): Promise<{ ok: boolean; hinweis: string; captcha?: boolean }> {
  const [l] = await db.select().from(L).where(and(eq(L.tenantId, tenantId), eq(L.id, leadId)));
  if (!l?.website) return { ok: false, hinweis: "keine Website" };
  let origin: string;
  try {
    const u = new URL(/^https?:\/\//i.test(l.website) ? l.website : `https://${l.website}`);
    origin = u.origin;
  } catch {
    return { ok: false, hinweis: "Website-Adresse ungültig" };
  }
  const merken = async (hinweis: string, extra: Partial<typeof L.$inferInsert> = {}) => {
    await db.update(L).set({ impressumAm: new Date(), impressumHinweis: hinweis.slice(0, 200), ...extra, verlauf: sql`(${L.verlauf} || ${JSON.stringify([{ am: new Date().toISOString(), was: `Impressum: ${hinweis}`.slice(0, 300) }])}::jsonb)` }).where(eq(L.id, l.id));
  };
  try {
    if (!robotsCache.has(origin)) {
      const r = await holen(`${origin}/robots.txt`);
      if (istCaptcha(r.status, r.text)) throw new CaptchaFehler(origin);
      robotsCache.set(origin, r.status === 200 ? r.text : null);
    }
    const robots = robotsCache.get(origin) ?? null;
    const pfade = [...new Set([l.impressumUrl ? new URL(l.impressumUrl, origin).pathname : null, "/impressum", "/imprint", "/impressum.html"].filter((x): x is string => !!x))];
    for (const pfad of pfade) {
      if (!robotsErlaubt(robots, pfad)) {
        await merken(`robots.txt verbietet ${pfad} – nicht abgerufen`);
        return { ok: false, hinweis: "robots.txt verbietet den Abruf" };
      }
      const seite = await holen(`${origin}${pfad}`);
      if (istCaptcha(seite.status, seite.text)) throw new CaptchaFehler(origin);
      if (seite.status !== 200 || !/impressum|imprint|angaben gem|§\s?5/i.test(seite.text)) continue;
      const f = impressumFakten(seite.text);
      const mail = bestEmail(extractEmails(seite.text, `${origin}${pfad}`), l.website);
      const extra: Partial<typeof L.$inferInsert> = { impressumUrl: l.impressumUrl ?? `${origin}${pfad}` };
      if (f.ustId && !l.ustId) extra.ustId = f.ustId;
      if (f.registerNr && !l.registerNr) extra.registerNr = f.registerNr;
      const strasseAlt = l.strasse ? openPii(l.strasse) : null;
      if (f.strasse && f.plz && f.ort && !strasseAlt && !l.plz) Object.assign(extra, { strasse: sealPii(f.strasse), plz: f.plz, ort: f.ort });
      if (mail && !l.email) Object.assign(extra, { email: sealPii(mail.email), emailQuelle: "Impressum (Website, automatischer Abruf)" });
      await merken(`abgerufen (${origin}${pfad})`, extra);
      return { ok: true, hinweis: "abgerufen" };
    }
    await merken("kein Impressum gefunden");
    return { ok: false, hinweis: "kein Impressum gefunden" };
  } catch (e) {
    if (e instanceof CaptchaFehler) {
      await merken(`Captcha/Sperre bei ${new URL(origin).hostname} – übersprungen, nicht erneut versucht`);
      return { ok: false, hinweis: "Captcha/Sperre", captcha: true };
    }
    await merken(`Fehler: ${e instanceof Error ? e.message.slice(0, 100) : "?"}`);
    return { ok: false, hinweis: "Fehler" };
  }
}

export async function impressumLauf(tenantId: string): Promise<LaufErgebnis> {
  const cfg = await cfgLaden(tenantId);
  const q = cfg.leadQuellen;
  const sperre = stufe2Sperre(q) ?? (!q.impressum.aktiv ? "Impressum-Abruf ist ausgeschaltet" : null);
  if (sperre) return uebersprungen(tenantId, "impressum", sperre);
  if (await laeuftSchon(tenantId, "impressum")) return { status: "uebersprungen", text: "Impressum-Abruf läuft schon" };
  const kandidaten = await db
    .select({ id: L.id })
    .from(L)
    .where(and(eq(L.tenantId, tenantId), sql`${L.website} is not null and ${L.website} <> ''`, isNull(L.impressumAm), sql`${L.status} <> 'gesperrt'`, or(isNull(L.email), isNull(L.ustId), isNull(L.plz))))
    .limit(Math.max(1, Math.min(200, q.impressum.maxJeLauf)));
  const laufId = await laufProtokoll(tenantId, { quelle: "impressum", status: "laeuft" });
  const robots = new Map<string, string | null>();
  let ok = 0;
  const captcha: string[] = [];
  for (const k of kandidaten) {
    const r = await impressumAbrufen(tenantId, k.id, robots);
    if (r.ok) ok++;
    if (r.captcha) captcha.push(k.id);
  }
  if (ok) await import("./lead-maschine").then((x) => x.leadsBewerten(tenantId, kandidaten.map((k) => k.id)));
  const text = `${kandidaten.length} Websites: ${ok} Impressum gelesen${captcha.length ? ` · ${captcha.length} mit Captcha/Sperre übersprungen (gemeldet, nicht erneut versucht)` : ""}`;
  await db.update(R).set({ status: "fertig", neu: 0, zusammengefuehrt: ok, meldung: text, beendetAm: new Date() }).where(eq(R.id, laufId));
  return { status: "fertig", text };
}

// ---- Wöchentlich: Läufe + Charge vorbereiten ------------------------------------------------------------------

async function inhaberSitzung(tenantId: string): Promise<Session | null> {
  const M = schema.memberships;
  const [m] = await db.select({ userId: M.userId }).from(M).where(and(eq(M.tenantId, tenantId), eq(M.role, "owner"))).limit(1);
  if (!m) return null;
  return { userId: m.userId, tenantId, role: "owner", areas: null, brandIds: null, readOnly: false, privateAccess: false, privateScope: "familie", privatePin: false, privateUnlockedUntil: null, sessionId: "zeitplan", email: "", name: "Zeitplan", tenantName: "" };
}

const WOCHENLAUF = "Wochenlauf";

/** Wöchentlicher Lauf (nur mit eingetragener rechtlicher Prüfung): Quellen, dann Charge vorbereiten – nie Versand.
 *  Der letzte Wochenlauf steht im Laufprotokoll (kein zweiter Lauf nach einem Neustart). */
export async function wochenLauf(tenantId: string, o: { erzwingen?: boolean } = {}): Promise<string[]> {
  const cfg = await cfgLaden(tenantId);
  const q = cfg.leadQuellen;
  if (stufe2Sperre(q)) return [];
  if (!q.apify.aktiv && !q.places.aktiv && !q.impressum.aktiv && !q.wochenCharge.aktiv) return [];
  if (!o.erzwingen) {
    const [letzter] = await db.select({ id: R.id }).from(R).where(and(eq(R.tenantId, tenantId), eq(R.quelle, "charge"), sql`${R.meldung} like ${`${WOCHENLAUF}%`}`, sql`${R.gestartetAm} > now() - interval '6 days 20 hours'`)).limit(1);
    if (letzter) return [];
  }
  await laufProtokoll(tenantId, { quelle: "charge", status: "fertig", meldung: `${WOCHENLAUF} gestartet` });
  const out: string[] = [];
  if (q.apify.aktiv) out.push(`Apify: ${(await apifyLauf(tenantId)).text}`);
  if (q.places.aktiv) out.push(`Places: ${(await placesLauf(tenantId)).text}`);
  if (q.impressum.aktiv) out.push(`Impressum: ${(await impressumLauf(tenantId)).text}`);
  if (q.wochenCharge.aktiv) {
    const s = await inhaberSitzung(tenantId);
    if (s) {
      const { chargeVorbereiten } = await import("./lead-maschine");
      out.push(await chargeVorbereiten(s, q.wochenCharge.anzahl).then((r) => r.text).catch((e) => `Charge: ${e instanceof Error ? e.message : "Fehler"}`));
    }
  }
  return out;
}

export async function quelleJetzt(s: Session, quelle: Quelle): Promise<LaufErgebnis> {
  if (s.role !== "owner" || s.readOnly) return { status: "uebersprungen", text: "Nur der Inhaber startet Läufe." };
  return quelle === "apify" ? apifyLauf(s.tenantId) : quelle === "places" ? placesLauf(s.tenantId) : impressumLauf(s.tenantId);
}
