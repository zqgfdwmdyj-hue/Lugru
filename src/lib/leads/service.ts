import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { askClaude, askClaudeWithWeb, modelFor } from "@/lib/ai/claude";
import { getIntegration } from "@/lib/integrations/store";
import { sendMail } from "@/lib/mail/accounts";
import { ensureSupplier } from "@/lib/purchasing/service";
import { getSettings } from "@/lib/settings";
import { upsertSystemTask } from "@/lib/tasks/system";
import type { LeadFinding } from "@/db/schema";
import { BRANDS_WAITING, contactBlocker, isBrandNote, isGenericMailDomain, nameKey, priorContact, type ContactRef, mailLanguageFor, parseLucidPayload, parseResearch, preAssess, validEmail, type LucidImportProducer } from "./logic";
import { brandsOf, LucidSessionError, LucidThrottledError, LucidUnavailableError, openSession, PAUSE_MS, searchProducers, sleep, type LucidProducer, type Session } from "./lucid";

type Lead = typeof schema.supplierLeads.$inferSelect;
const L = schema.supplierLeads;

/** Höchstens so viele Anfragen pro Tag – schützt den Absender (Spam-Einstufung) und vor Massenmails. */
export const DAILY_MAIL_LIMIT = 25;

const clean = (s: string | null | undefined) => (s ?? "").trim() || null;

// ---- 1. Register abfragen ----------------------------------------------------------------

/**
 * Firmen zu einer Marke aus dem Verpackungsregister holen und vorab einstufen.
 * Die Markenlisten je Firma kommen danach im Hintergrund (eine Abfrage je Firma).
 */
export async function importFromLucid(tenantId: string, brand: string, opts: { onlyActive: boolean }) {
  const b = brand.trim();
  if (b.length < 2) throw new Error("Bitte eine Marke mit mindestens 2 Zeichen eingeben.");
  const { producers, total, session } = await searchProducers({ brand: b });
  const r = await storeProducers(tenantId, b, producers.map((p) => ({ ...p, brands: null, brandsComplete: false })), opts);
  // Markenlisten im Hintergrund – die Seite zeigt den Fortschritt.
  void loadMissingBrands(tenantId, { session, force: true }).catch((e) => console.error("[Großhändler] Marken:", e instanceof Error ? e.message : e));
  return { total, read: producers.length, ...r };
}

/** Daten vom Register-Lesezeichen (Abfrage im eigenen Browser) übernehmen – Markenlisten sind schon dabei. */
export async function importLucidPayload(tenantId: string, raw: string, opts: { onlyActive: boolean }) {
  const parsed = parseLucidPayload(raw);
  if (!parsed.ok) throw new Error(parsed.message);
  if (parsed.mode === "brands") {
    // Nur fehlende Markenlisten zu vorhandenen Kontakten.
    let updated = 0;
    for (const p of parsed.producers) {
      if (!p.brands) continue;
      const [l] = await db.select().from(L).where(and(eq(L.tenantId, tenantId), eq(L.source, "lucid"), eq(L.sourceId, p.ManufacturerId)));
      if (!l) continue;
      await applyBrands(l, p.brands, p.brandsComplete);
      updated++;
    }
    return { mode: "brands" as const, brand: "", total: parsed.producers.length, read: parsed.producers.length, stored: updated, created: 0 };
  }
  const r = await storeProducers(tenantId, parsed.brand, parsed.producers, opts);
  await db.insert(schema.supplierLeadSearches).values({
    tenantId,
    brand: parsed.brand,
    source: "lucid",
    status: "fertig",
    message: `über den Browser: ${parsed.total} Einträge, ${r.stored} übernommen (${r.created} neu)`,
    found: r.stored,
    created: r.created,
    finishedAt: new Date(),
  });
  return { mode: "full" as const, brand: parsed.brand, total: parsed.total, read: parsed.producers.length, ...r };
}

async function storeProducers(tenantId: string, b: string, producers: LucidImportProducer[], opts: { onlyActive: boolean }) {
  let created = 0;
  const ids: string[] = [];
  const now = new Date().toISOString();
  // Schon über Amazon, eBay, Messe … bekannte Firma (gleicher Name, noch ohne Registereintrag)?
  // Dann wird dieser Kontakt zum Registereintrag – statt einer zweiten Zeile.
  const known = await db.select({ id: L.id, companyName: L.companyName, source: L.source }).from(L).where(and(eq(L.tenantId, tenantId), ne(L.source, "lucid")));
  const byName = new Map(known.map((k) => [nameKey(k.companyName), k.id]));
  const lucidIds = new Set(
    (await db.select({ sourceId: L.sourceId }).from(L).where(and(eq(L.tenantId, tenantId), eq(L.source, "lucid"), inArray(L.sourceId, producers.map((p) => p.ManufacturerId).concat(""))))).map((r) => r.sourceId),
  );
  for (const p of producers) {
    if (opts.onlyActive && p.RegistrationEndDate) continue;
    const pre = preAssess({ companyName: p.CompanyName, brands: p.brands, searchBrand: b, registrationEnd: clean(p.RegistrationEndDate), brandsComplete: p.brandsComplete });
    const finding: LeadFinding = { source: "lucid", label: "Verpackungsregister", detail: clean(p.RegisterNumber) ?? undefined, brand: b, at: now };
    const mergeId = !lucidIds.has(p.ManufacturerId) ? byName.get(nameKey(p.CompanyName)) : undefined;
    if (mergeId) {
      const [l] = await db.select().from(L).where(eq(L.id, mergeId));
      const f = fieldsOf(p);
      await db
        .update(L)
        .set({
          source: "lucid",
          sourceId: p.ManufacturerId,
          registerNumber: f.registerNumber,
          street: l.street ?? f.street,
          zip: l.zip ?? f.zip,
          city: l.city ?? f.city,
          country: l.country ?? f.country,
          phone: l.phone ?? f.phone,
          registeredAt: f.registeredAt,
          registrationEnd: f.registrationEnd,
          isForeign: f.isForeign,
          ...(p.brands ? { brands: p.brands } : {}),
          searchBrands: [...new Set([...l.searchBrands, b])],
          score: Math.max(l.score, pre.score),
          findings: [...l.findings.filter((x) => !(x.source === "lucid" && x.brand === b)), finding],
          updatedAt: new Date(),
        })
        .where(eq(L.id, mergeId));
      byName.delete(nameKey(p.CompanyName));
      ids.push(mergeId);
      continue;
    }
    const [row] = await db
      .insert(L)
      .values({
        tenantId,
        source: "lucid",
        sourceId: p.ManufacturerId,
        searchBrands: [b],
        ...fieldsOf(p),
        brands: p.brands,
        score: pre.score,
        kind: pre.kind,
        findings: [finding],
        ...(pre.exactBrand === false ? { status: "ausgeschlossen" as const, notes: pre.reasons[0] } : {}),
      })
      .onConflictDoUpdate({
        target: [L.tenantId, L.source, L.sourceId],
        set: {
          ...fieldsOf(p),
          ...(p.brands ? { brands: p.brands, score: pre.score } : {}),
          searchBrands: sql`(select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements_text(${L.searchBrands} || ${JSON.stringify([b])}::jsonb) x)`,
          findings: sql`(select coalesce(jsonb_agg(f), '[]'::jsonb) from jsonb_array_elements(${L.findings}) f where not (f->>'source' = 'lucid' and f->>'brand' = ${b})) || ${JSON.stringify([finding])}::jsonb`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: L.id, inserted: sql<boolean>`(xmax = 0)` });
    ids.push(row.id);
    if (row.inserted) created++;
  }
  return { stored: ids.length, created };
}

function fieldsOf(p: LucidProducer) {
  return {
    companyName: p.CompanyName.trim(),
    registerNumber: clean(p.RegisterNumber),
    street: clean([p.Street, p.StreetNumber].filter(Boolean).join(" ")),
    zip: clean(p.ZipCode),
    city: clean(p.Location),
    country: clean(p.Country),
    phone: clean(p.TelephoneNumber),
    registeredAt: clean(p.RegisterDate),
    registrationEnd: clean(p.RegistrationEndDate),
    isForeign: Boolean(p.IsForeignProducer),
  };
}

// ---- Markenlisten nachladen ---------------------------------------------------------------
// Je Firma eine Abfrage. Das Register drosselt nach vielen schnellen Abfragen (HTTP 503) – dann
// nicht weiter nachfragen, sondern pausieren und später (Hintergrund-Lauf alle 30 Min) weitermachen.

/** So lange nach einer Drosselung keine neuen Versuche. */
export const THROTTLE_PAUSE_MS = 20 * 60_000;
type BrandLoadState = { running: boolean; throttledUntil: number; pauseMs: number };
// Prozessweit (globalThis): Seite, Knöpfe und Hintergrund-Lauf können in getrennten Bundles laufen.
const g = globalThis as typeof globalThis & { __lucidBrandLoad?: Map<string, BrandLoadState> };
const brandLoad = (g.__lucidBrandLoad ??= new Map<string, BrandLoadState>());
const freshState = (): BrandLoadState => ({ running: false, throttledUntil: 0, pauseMs: PAUSE_MS });
export const brandLoadStatus = (tenantId: string) => brandLoad.get(tenantId) ?? freshState();

const missingBrandsWhere = (tenantId: string) =>
  and(eq(L.tenantId, tenantId), eq(L.source, "lucid"), isNull(L.brands), notInArray(L.status, ["ausgeschlossen", "kein_interesse"]));

export async function missingBrandCount(tenantId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(L).where(missingBrandsWhere(tenantId));
  return r?.n ?? 0;
}

/** Kennungen der Firmen ohne Markenliste (für das Lesezeichen im Browser). */
export async function missingBrandIds(tenantId: string, limit = 400) {
  const rows = await db.select({ id: L.sourceId }).from(L).where(missingBrandsWhere(tenantId)).orderBy(desc(L.score)).limit(limit);
  return rows.map((r) => r.id);
}

/**
 * Fehlende Markenlisten nachladen (nacheinander, mit Pause). Läuft je Mandant nur einmal gleichzeitig.
 * `force`: auch kurz nach einer Drosselung versuchen (Knopf „Jetzt nachladen“).
 */
export async function loadMissingBrands(tenantId: string, opts: { session?: Session; limit?: number; force?: boolean } = {}) {
  const state = brandLoad.get(tenantId) ?? freshState();
  if (state.running) return { loaded: 0, left: await missingBrandCount(tenantId), note: "läuft schon" };
  if (!opts.force && state.throttledUntil > Date.now()) return { loaded: 0, left: await missingBrandCount(tenantId), note: "Register drosselt noch" };
  state.running = true;
  brandLoad.set(tenantId, state);
  let loaded = 0;
  let note: string | null = null;
  try {
    const todo = await db.select().from(L).where(missingBrandsWhere(tenantId)).orderBy(desc(L.score), L.createdAt).limit(opts.limit ?? 300);
    if (!todo.length) return { loaded: 0, left: 0, note: null };
    await db.update(L).set({ busy: "marken" }).where(inArray(L.id, todo.map((l) => l.id)));
    let session = opts.session ?? null;
    let failures = 0;
    for (let i = 0; i < todo.length; i++) {
      const l = todo[i];
      try {
        session ??= await openSession();
        let r: { brands: string[]; complete: boolean };
        try {
          r = await brandsOf(session, l.sourceId);
        } catch (e) {
          if (!(e instanceof LucidSessionError)) throw e;
          session = await openSession();
          r = await brandsOf(session, l.sourceId);
        }
        await applyBrands(l, r.brands, r.complete);
        loaded++;
        failures = 0;
      } catch (e) {
        if (e instanceof LucidUnavailableError) {
          // Gedrosselt oder gesperrt: aufhören, Rest bleibt für später – und künftig langsamer fragen.
          state.throttledUntil = Date.now() + THROTTLE_PAUSE_MS;
          if (e instanceof LucidThrottledError) state.pauseMs = Math.min(12_000, state.pauseMs * 2);
          note = e.message;
          const rest = todo.slice(i).map((x) => x.id);
          await db.update(L).set({ busy: null, checkError: e instanceof LucidThrottledError ? BRANDS_WAITING : `Markenliste nicht geladen: ${e.message}` }).where(inArray(L.id, rest));
          break;
        }
        failures++;
        await db.update(L).set({ busy: null, checkError: `Markenliste nicht geladen: ${e instanceof Error ? e.message : String(e)}` }).where(eq(L.id, l.id));
        if (failures >= 3) {
          await db.update(L).set({ busy: null }).where(inArray(L.id, todo.slice(i + 1).map((x) => x.id)));
          note = "mehrere Fehler hintereinander – später erneut";
          break;
        }
      }
      if (i < todo.length - 1) await sleep(state.pauseMs);
    }
  } finally {
    state.running = false;
    // Was nicht mehr drankam (z. B. Abbruch), nicht ewig als „lädt“ markieren.
    await db.update(L).set({ busy: null }).where(and(eq(L.tenantId, tenantId), eq(L.busy, "marken")));
  }
  return { loaded, left: await missingBrandCount(tenantId), note };
}

async function applyBrands(l: Lead, brands: string[], complete: boolean) {
  const searchBrand = l.searchBrands[0] ?? "";
  const pre = preAssess({ companyName: l.companyName, brands, searchBrand, registrationEnd: l.registrationEnd, brandsComplete: complete });
  await db
    .update(L)
    .set({
      brands,
      score: pre.score,
      // Eine schon per Websuche geprüfte oder anderswo eindeutige Einstufung bleibt.
      kind: l.checkedAt ? l.kind : pre.kind,
      // „Wella“ nur als Wortteil (z. B. „Pawella“): kein Treffer für die Suche.
      status: pre.exactBrand === false && l.status === "neu" ? "ausgeschlossen" : l.status,
      notes: pre.exactBrand === false && !l.notes ? pre.reasons[0] : l.notes,
      checkError: isBrandNote(l.checkError) ? null : l.checkError,
      busy: null,
      updatedAt: new Date(),
    })
    .where(eq(L.id, l.id));
}

/** Knopf „Jetzt nachladen“ und Hintergrund-Lauf: startet das Nachladen, ohne zu warten. */
export async function startBrandLoading(tenantId: string, force: boolean) {
  const left = await missingBrandCount(tenantId);
  if (!left) return "Alle Markenlisten sind da.";
  const st = brandLoadStatus(tenantId);
  if (st.running) return "Die Markenlisten werden schon geladen.";
  void loadMissingBrands(tenantId, { force }).catch((e) => console.error("[Großhändler] Marken:", e instanceof Error ? e.message : e));
  return `${left} Markenlisten werden nacheinander geladen (ca. ${Math.max(1, Math.round((Math.min(left, 300) * (st.pauseMs + 700)) / 60_000))} Min). Drosselt das Register, geht es automatisch später weiter.`;
}

// ---- 2. Per Websuche prüfen ---------------------------------------------------------------

export function researchPrompt(l: Pick<Lead, "companyName" | "street" | "zip" | "city" | "country" | "phone" | "brands" | "searchBrands"> & { source?: string }): string {
  const brand = l.searchBrands[0] ?? "";
  return [
    "Du prüfst für einen deutschen Online-Händler (Amazon/eBay), ob eine Firma als Bezugsquelle (Großhändler/Distributor) in Frage kommt.",
    `Firma: ${l.companyName}`,
    `Adresse laut ${l.source === "lucid" ? "Verpackungsregister" : "Fundstelle"}: ${[l.street, [l.zip, l.city].filter(Boolean).join(" "), l.country].filter(Boolean).join(", ") || "unbekannt"}`,
    l.phone ? `Telefon laut Register: ${l.phone}` : "",
    `Gesuchte Marke: ${brand}`,
    l.brands?.length ? `Im Register gemeldete Marken: ${l.brands.slice(0, 25).join(", ")}` : "",
    "",
    "Aufgabe – mit der Websuche:",
    "1. Offizielle Website der Firma finden (passend zu Name und Ort; Impressum prüfen).",
    "2. Einstufen: grosshandel (verkauft an Händler/Wiederverkäufer: B2B-Shop, Händlerregistrierung, Großhandel/Wholesale/Distribution, Staffelpreise, Gewerbenachweis), haendler (verkauft nur an Endkunden, z. B. Onlineshop/Amazon-Shop), hersteller (Markeninhaber/Produzent), salon (Friseur/Kosmetikstudio), marktplatz, privat, unklar.",
    `3. Führt die Firma die Marke ${brand}?`,
    "4. Geschäftliche E-Mail-Adresse für Händler-/Einkaufsanfragen (B2B/Vertrieb/Info, aus Impressum oder Kontaktseite). Keine erfundenen Adressen.",
    "5. Link zur B2B-/Händler-Registrierung, falls vorhanden.",
    "",
    "Regeln: Nur belegbare Angaben aus den Suchergebnissen; Unbekanntes als null. Belege mit Quelle (URL).",
    "Antworte am Ende NUR mit diesem JSON:",
    '{"website":"https://…","email":"…","phone":"…","kind":"grosshandel|haendler|hersteller|salon|marktplatz|privat|unklar","wholesale":true,"sellsBrand":true,"b2bUrl":"https://…","summary":"1–2 Sätze auf Deutsch","evidence":[{"label":"B2B-Shop","value":"…","url":"https://…"}]}',
  ]
    .filter((x) => x !== "")
    .join("\n");
}

async function aiConfig(tenantId: string) {
  const ai = await getIntegration(tenantId, "anthropic");
  if (!ai?.apiKey) throw new Error("Für die Prüfung unter Anbindungen → KI (Claude) einen Schlüssel eintragen.");
  return ai;
}

/** Ausgewählte Firmen im Hintergrund prüfen (je Firma einige Websuchen). */
export async function startResearch(tenantId: string, ids: string[]) {
  await aiConfig(tenantId);
  const rows = await db.select({ id: L.id }).from(L).where(and(eq(L.tenantId, tenantId), inArray(L.id, ids), isNull(L.busy)));
  if (!rows.length) return 0;
  await db.update(L).set({ busy: "pruefen", checkError: null }).where(inArray(L.id, rows.map((r) => r.id)));
  void runPool(rows.map((r) => r.id), 2, (id) => researchOne(tenantId, id)).catch((e) => console.error("[Großhändler] Prüfung:", e));
  return rows.length;
}

async function runPool(ids: string[], size: number, fn: (id: string) => Promise<void>) {
  const queue = [...ids];
  await Promise.all(Array.from({ length: size }, async () => {
    for (let id = queue.shift(); id; id = queue.shift()) await fn(id);
  }));
}

const SOURCE_EVIDENCE = new Set(["Amazon-Verkäufer", "eBay-Verkäufer", "USt-ID", "Handelsregister", "Vertreten durch", "Hersteller laut GPSR", "EU-Verantwortlicher laut GPSR", "Websuche"]);

export async function researchOne(tenantId: string, id: string) {
  const [l] = await db.select().from(L).where(and(eq(L.id, id), eq(L.tenantId, tenantId)));
  if (!l) return;
  try {
    const ai = await aiConfig(tenantId);
    const r = await askClaudeWithWeb(ai.apiKey, researchPrompt(l), { model: modelFor(ai, "simple"), maxSearches: 4, maxTokens: 2000 });
    const parsed = parseResearch(r.text);
    if (!parsed) throw new Error("Die KI hat kein auswertbares Ergebnis geliefert.");
    await db
      .update(L)
      .set({
        website: parsed.website ?? l.website,
        email: parsed.email ?? l.email,
        phone: l.phone ?? parsed.phone,
        b2bUrl: parsed.b2bUrl,
        sellsBrand: parsed.sellsBrand,
        summary: parsed.summary,
        // Belege aus der Fundstelle (Amazon-/eBay-Impressum, GPSR) bleiben, die der Websuche kommen neu dazu.
        evidence: [
          ...l.evidence.filter((e) => SOURCE_EVIDENCE.has(e.label)),
          ...(parsed.evidence.length ? parsed.evidence : r.sources.slice(0, 3).map((u) => ({ label: "Quelle", value: new URL(u).hostname, url: u }))),
        ].slice(0, 12),
        kind: parsed.kind,
        status: l.status === "neu" ? "geprueft" : l.status,
        checkedAt: new Date(),
        checkError: null,
        busy: null,
        updatedAt: new Date(),
      })
      .where(eq(L.id, id));
    // Website selbst lesen (Impressum/Kontakt): findet die Adresse auch, wenn die Websuche sie nicht zeigt.
    if (!parsed.email && !validEmail(l.email)) {
      const { findEmailFor } = await import("./email-service");
      await findEmailFor(tenantId, id, { ai: false });
    }
  } catch (e) {
    await db.update(L).set({ busy: null, checkError: e instanceof Error ? e.message : String(e) }).where(eq(L.id, id));
  }
}

// ---- 3. Anschreiben ----------------------------------------------------------------------

type Sender = { company: string; person: string; address: string; email: string; phone: string; about: string };

export async function senderInfo(tenantId: string, userId: string): Promise<Sender> {
  const s = await getSettings(tenantId);
  const [u] = await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId));
  const a = s.shipper;
  return {
    company: [a.name1, a.name2].filter(Boolean).join(" ") || "",
    person: u?.name ?? "",
    address: [[a.street, a.houseNo].filter(Boolean).join(" "), [a.zip, a.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    email: a.email ?? "",
    phone: a.phone ?? "",
    about: "Online-Händler mit Verkauf über Amazon und eBay",
  };
}

export function mailPrompt(l: Lead, sender: Sender, wish: string, lang: "de" | "en"): string {
  const brands = l.searchBrands.filter(Boolean);
  const fair = l.findings.find((f) => f.source === "messe");
  return [
    `Schreibe eine kurze, persönliche Einkaufsanfrage per E-Mail ${lang === "de" ? "auf Deutsch (Sie-Form)" : "auf Englisch"} an einen möglichen Lieferanten.`,
    `Empfänger: ${l.companyName}${l.city ? ` (${l.city}, ${l.country ?? ""})` : ""}`,
    l.summary ? `Was wir über die Firma wissen: ${l.summary}` : "",
    fair ? `Woher wir die Firma kennen: Aussteller auf der Messe ${fair.detail?.split(" · ")[0] ?? ""}.` : "",
    `Absender: ${sender.company || "[Firma]"}, ${sender.about}.`,
    `Anliegen: ${brands.length ? `Bezug von Produkten der Marke${brands.length > 1 ? "n" : ""} ${brands.join(", ")}` : "Bezug von Waren aus dem Sortiment der Firma"} – Händlerkonditionen/Preisliste anfragen und eine Zusammenarbeit anbieten.${wish ? ` Zusatz vom Absender: ${wish}` : ""}`,
    "",
    "Regeln:",
    "- Höchstens 120 Wörter, sachlich, freundlich, keine Floskeln, keine Übertreibungen, nichts erfinden (keine Mengen, Umsätze oder Referenzen, die oben nicht stehen).",
    "- Konkrete Bitte: Preisliste bzw. Händlerkonditionen und Mindestbestellmenge.",
    `- Letzter Satz: ${lang === "de" ? "Falls kein Interesse besteht, genügt eine kurze Antwort – dann melden wir uns nicht erneut." : "If you are not interested, a short reply is enough and we will not contact you again."}`,
    "- Keine Grußformel und keine Signatur (wird automatisch angefügt).",
    'Antworte NUR mit JSON: {"subject":"…","body":"…"}',
  ]
    .filter((x) => x !== "")
    .join("\n");
}

export function signature(sender: Sender, lang: "de" | "en"): string {
  return [lang === "de" ? "Mit freundlichen Grüßen" : "Kind regards", sender.person, sender.company, sender.address, sender.phone ? `Tel. ${sender.phone}` : "", sender.email]
    .filter(Boolean)
    .join("\n");
}

/** Entwürfe im Hintergrund erstellen – versendet wird erst nach Freigabe. */
export async function startDrafts(tenantId: string, userId: string, ids: string[], wish: string) {
  const ai = await aiConfig(tenantId);
  const sender = await senderInfo(tenantId, userId);
  if (!sender.company) throw new Error("Bitte zuerst unter Einstellungen → Versand die Absenderfirma eintragen – sie steht in jeder Anfrage.");
  const ctx = await contactContext(tenantId);
  const rows = (await db.select().from(L).where(and(eq(L.tenantId, tenantId), inArray(L.id, ids), isNull(L.busy)))).filter((l) => {
    const block = sendBlocker(l, ctx);
    return !block || block === "keine E-Mail-Adresse";
  });
  if (!rows.length) return 0;
  await db.update(L).set({ busy: "entwurf", mailError: null }).where(inArray(L.id, rows.map((r) => r.id)));
  void runPool(rows.map((r) => r.id), 3, async (id) => {
    const l = rows.find((r) => r.id === id)!;
    const lang = mailLanguageFor(l.country);
    try {
      const r = await askClaude(ai.apiKey, mailPrompt(l, sender, wish, lang), { model: modelFor(ai, "creative"), task: "creative", maxTokens: 900 });
      const j = JSON.parse(r.text.slice(r.text.indexOf("{"), r.text.lastIndexOf("}") + 1)) as { subject?: string; body?: string };
      if (!j.subject || !j.body) throw new Error("Entwurf unvollständig.");
      await db
        .update(L)
        .set({ mailLanguage: lang, mailSubject: j.subject.slice(0, 200), mailBody: `${j.body.trim()}\n\n${signature(sender, lang)}`, status: l.status === "neu" || l.status === "geprueft" ? "entwurf" : l.status, busy: null, updatedAt: new Date() })
        .where(eq(L.id, id));
    } catch (e) {
      await db.update(L).set({ busy: null, mailError: `Entwurf: ${e instanceof Error ? e.message : String(e)}` }).where(eq(L.id, id));
    }
  });
  return rows.length;
}

/** Bereits angeschriebene Kontakte und Lieferanten – für die Doppelt-Prüfung. */
export async function contactContext(tenantId: string) {
  const [contacted, suppliers] = await Promise.all([
    db
      .select({ id: L.id, companyName: L.companyName, email: L.email, website: L.website, mailedAt: L.mailedAt, mailedTo: L.mailedTo, searchBrands: L.searchBrands })
      .from(L)
      .where(and(eq(L.tenantId, tenantId), isNotNull(L.mailedAt))),
    db.select({ name: schema.suppliers.name, code: schema.suppliers.code }).from(schema.suppliers).where(eq(schema.suppliers.tenantId, tenantId)),
  ]);
  return { contacted: contacted as ContactRef[], suppliers: suppliers.flatMap((x) => [x.name, x.code].filter((n): n is string => Boolean(n))) };
}

/** Warum diese Firma nicht (noch einmal) angeschrieben werden soll – oder null. */
export function sendBlocker(l: Lead, ctx: Awaited<ReturnType<typeof contactContext>>) {
  return contactBlocker(l) ?? priorContact(l, ctx.contacted, ctx.suppliers);
}

export async function sentToday(tenantId: string) {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  // Erste Anfragen und Nachfass-Mails zählen beide zum Tageslimit.
  const [r] = await db
    .select({ n: sql<number>`(count(*) filter (where ${L.mailedAt} >= ${since}) + count(*) filter (where ${L.followUpAt} >= ${since}))::int` })
    .from(L)
    .where(and(eq(L.tenantId, tenantId), sql`(${L.mailedAt} >= ${since} or ${L.followUpAt} >= ${since})`));
  return r?.n ?? 0;
}

/** Freigegebene Entwürfe senden – nie doppelt, nie an gesperrte Kontakte, mit Tageslimit. */
export async function sendDrafts(tenantId: string, ids: string[]) {
  const rows = await db.select().from(L).where(and(eq(L.tenantId, tenantId), inArray(L.id, ids)));
  const ctx = await contactContext(tenantId);
  let sent = 0;
  const skipped: string[] = [];
  let left = DAILY_MAIL_LIMIT - (await sentToday(tenantId));
  for (const l of rows) {
    const block = sendBlocker(l, ctx);
    if (block || !l.mailSubject || !l.mailBody) {
      skipped.push(`${l.companyName}: ${block ?? "kein Entwurf"}`);
      continue;
    }
    if (left <= 0) {
      skipped.push(`${l.companyName}: Tageslimit (${DAILY_MAIL_LIMIT}) erreicht`);
      continue;
    }
    // Erst sperren, dann senden – ein zweiter Klick schickt nichts doppelt.
    const [claimed] = await db.update(L).set({ mailedAt: new Date(), mailedTo: l.email }).where(and(eq(L.id, l.id), isNull(L.mailedAt))).returning({ id: L.id });
    if (!claimed) continue;
    try {
      await sendMail(tenantId, { to: l.email!, subject: l.mailSubject, text: l.mailBody });
      await db.update(L).set({ status: "angeschrieben", mailError: null, updatedAt: new Date() }).where(eq(L.id, l.id));
      // Gleiche Firma in derselben Auswahl (andere Marke/Quelle) nicht noch einmal.
      ctx.contacted.push({ ...l, mailedAt: new Date(), mailedTo: l.email });
      sent++;
      left--;
    } catch (e) {
      await db.update(L).set({ mailedAt: null, mailedTo: null, mailError: e instanceof Error ? e.message : String(e) }).where(eq(L.id, l.id));
      skipped.push(`${l.companyName}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { sent, skipped };
}

// ---- 4. Antworten erkennen ------------------------------------------------------------------

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";

/** Eingegangene Mails von angeschriebenen Firmen (gleiche Domain) → Status „Antwort“ und Aufgabe. */
export async function detectReplies(tenantId: string) {
  const open = await db.select().from(L).where(and(eq(L.tenantId, tenantId), inArray(L.status, ["angeschrieben", "follow_up"])));
  let found = 0;
  for (const l of open) {
    if (!l.mailedTo || !l.mailedAt || !validEmail(l.mailedTo)) continue;
    const domain = domainOf(l.mailedTo);
    const generic = isGenericMailDomain(domain);
    const E = schema.emails;
    const [hit] = await db
      .select({ id: E.id, subject: E.subject, receivedAt: E.receivedAt })
      .from(E)
      .where(
        and(
          eq(E.tenantId, tenantId),
          gte(E.receivedAt, l.mailedAt),
          generic ? sql`lower(${E.fromAddress}) = ${l.mailedTo.toLowerCase()}` : sql`lower(${E.fromAddress}) like ${"%@" + domain}`,
        ),
      )
      .limit(1);
    if (!hit) continue;
    found++;
    await db.update(L).set({ status: "antwort", repliedAt: hit.receivedAt, updatedAt: new Date() }).where(eq(L.id, l.id));
    await upsertSystemTask(db, tenantId, `lead-reply:${l.id}`, {
      title: `Antwort von ${l.companyName} auf die Einkaufsanfrage`,
      notes: hit.subject ?? null,
      category: "einkauf",
      link: `/lieferanten/finden/${l.id}`,
    });
  }
  return found;
}

/** Als Lieferant übernehmen (Einkauf/Bestellungen). */
export async function leadToSupplier(tenantId: string, id: string) {
  const [l] = await db.select().from(L).where(and(eq(L.id, id), eq(L.tenantId, tenantId)));
  if (!l) throw new Error("Kontakt nicht gefunden.");
  const supplierId = await db.transaction((tx) => ensureSupplier(tx, tenantId, l.companyName));
  await db.update(L).set({ supplierId, updatedAt: new Date() }).where(eq(L.id, id));
  return supplierId;
}
