import "server-only";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { askClaude, askClaudeWithWeb, modelFor } from "@/lib/ai/claude";
import { getIntegration } from "@/lib/integrations/store";
import { sendMail } from "@/lib/mail/accounts";
import { ensureSupplier } from "@/lib/purchasing/service";
import { getSettings } from "@/lib/settings";
import { upsertSystemTask } from "@/lib/tasks/system";
import type { LeadFinding } from "@/db/schema";
import { contactBlocker, mailLanguageFor, parseLucidPayload, parseResearch, preAssess, validEmail, type LucidImportProducer } from "./logic";
import { brandsOf, PAUSE_MS, searchProducers, sleep, type LucidProducer } from "./lucid";

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
  void loadBrands(tenantId, b, session).catch((e) => console.error("[Großhändler] Marken:", e instanceof Error ? e.message : e));
  return { total, read: producers.length, ...r };
}

/** Daten vom Register-Lesezeichen (Abfrage im eigenen Browser) übernehmen – Markenlisten sind schon dabei. */
export async function importLucidPayload(tenantId: string, raw: string, opts: { onlyActive: boolean }) {
  const parsed = parseLucidPayload(raw);
  if (!parsed.ok) throw new Error(parsed.message);
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
  return { brand: parsed.brand, total: parsed.total, read: parsed.producers.length, ...r };
}

async function storeProducers(tenantId: string, b: string, producers: LucidImportProducer[], opts: { onlyActive: boolean }) {
  let created = 0;
  const ids: string[] = [];
  const now = new Date().toISOString();
  for (const p of producers) {
    if (opts.onlyActive && p.RegistrationEndDate) continue;
    const pre = preAssess({ companyName: p.CompanyName, brands: p.brands, searchBrand: b, registrationEnd: clean(p.RegistrationEndDate), brandsComplete: p.brandsComplete });
    const finding: LeadFinding = { source: "lucid", label: "Verpackungsregister", detail: clean(p.RegisterNumber) ?? undefined, brand: b, at: now };
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
  if (producers.some((p) => p.brands === null)) {
    await db.update(L).set({ busy: "marken" }).where(and(eq(L.tenantId, tenantId), inArray(L.id, ids), isNull(L.brands)));
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

async function loadBrands(tenantId: string, brand: string, session: Parameters<typeof brandsOf>[0]) {
  const todo = await db.select().from(L).where(and(eq(L.tenantId, tenantId), eq(L.busy, "marken")));
  for (const l of todo) {
    try {
      const { brands, complete } = await brandsOf(session, l.sourceId);
      const searchBrand = l.searchBrands.find((s) => s.toLowerCase() === brand.toLowerCase()) ?? brand;
      const pre = preAssess({ companyName: l.companyName, brands, searchBrand, registrationEnd: l.registrationEnd, brandsComplete: complete });
      await db
        .update(L)
        .set({
          brands,
          score: pre.score,
          // Eine schon per Websuche geprüfte Einstufung bleibt.
          kind: l.checkedAt ? l.kind : pre.kind,
          // „Wella“ nur als Wortteil (z. B. „Pawella“): kein Treffer für die Suche.
          status: pre.exactBrand === false && l.status === "neu" ? "ausgeschlossen" : l.status,
          notes: pre.exactBrand === false && !l.notes ? pre.reasons[0] : l.notes,
          busy: null,
          updatedAt: new Date(),
        })
        .where(eq(L.id, l.id));
    } catch (e) {
      await db.update(L).set({ busy: null, checkError: `Marken nicht geladen: ${e instanceof Error ? e.message : String(e)}` }).where(eq(L.id, l.id));
    }
    await sleep(PAUSE_MS);
  }
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
  const brand = l.searchBrands[0] ?? "";
  return [
    `Schreibe eine kurze, persönliche Einkaufsanfrage per E-Mail ${lang === "de" ? "auf Deutsch (Sie-Form)" : "auf Englisch"} an einen möglichen Lieferanten.`,
    `Empfänger: ${l.companyName}${l.city ? ` (${l.city}, ${l.country ?? ""})` : ""}`,
    l.summary ? `Was wir über die Firma wissen: ${l.summary}` : "",
    `Absender: ${sender.company || "[Firma]"}, ${sender.about}.`,
    `Anliegen: Bezug von ${brand}-Produkten – Händlerkonditionen/Preisliste anfragen und eine Zusammenarbeit anbieten.${wish ? ` Zusatz vom Absender: ${wish}` : ""}`,
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
  const rows = (await db.select().from(L).where(and(eq(L.tenantId, tenantId), inArray(L.id, ids), isNull(L.busy)))).filter((l) => {
    const block = contactBlocker(l);
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

export async function sentToday(tenantId: string) {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(L).where(and(eq(L.tenantId, tenantId), gte(L.mailedAt, since)));
  return r?.n ?? 0;
}

/** Freigegebene Entwürfe senden – nie doppelt, nie an gesperrte Kontakte, mit Tageslimit. */
export async function sendDrafts(tenantId: string, ids: string[]) {
  const rows = await db.select().from(L).where(and(eq(L.tenantId, tenantId), inArray(L.id, ids)));
  let sent = 0;
  const skipped: string[] = [];
  let left = DAILY_MAIL_LIMIT - (await sentToday(tenantId));
  for (const l of rows) {
    const block = contactBlocker(l);
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
  const open = await db.select().from(L).where(and(eq(L.tenantId, tenantId), eq(L.status, "angeschrieben")));
  let found = 0;
  for (const l of open) {
    if (!l.mailedTo || !l.mailedAt || !validEmail(l.mailedTo)) continue;
    const domain = domainOf(l.mailedTo);
    const generic = /^(gmail|googlemail|outlook|hotmail|live|yahoo|gmx|web|t-online|icloud|aol|mail)\./.test(domain);
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
