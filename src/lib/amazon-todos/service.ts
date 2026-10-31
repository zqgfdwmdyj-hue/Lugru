import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, notExists, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { askClaude, modelFor } from "@/lib/ai/claude";
import { addDaysIso, todayIso } from "@/lib/dates";
import { notifyDiscord } from "@/lib/integrations/clients/discord";
import { getIntegration } from "@/lib/integrations/store";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { BATCH_SIZE, categoryLabel, deadlineFromText, extractAsins, extractSkus, kontozustandLink, marktplatzAus, MAX_TOKENS, noiseReason, parseTriage, pflichtRegel, todosClosedBy, triageByRules, triagePrompt, type TriageMail, type TriageResult } from "./logic";
import { altToDosSchliessen, anAmazonBestaetigt, bestellMailsAbgleichen, bestellnummernAus, istBestellMail, istFbaVersandMail, SAMMEL, sammelWiederOeffnen, ueberfaellig, versandfrist, type AuftragKurz } from "./versand";

// Amazon-ToDos: Amazon-Systemmails aus allen verbundenen Postfächern einstufen und als Aufgaben
// mit Frist führen. Läuft nach jedem Postfach-Abruf; die Erledigung passiert im Seller Central.

const T = schema.amazonTodos;
const SEEN = schema.amazonMailSeen;
const E = schema.emails;

export type RunResult = { checked: number; created: number; irrelevant: number; filtered: number; high: number; closedAuto: number; errors: string[]; ai: boolean; versand?: VersandErgebnis };

const running = new Map<string, Promise<RunResult>>();

/** Ein Lauf je Firma zur Zeit – ein zweiter Aufruf bekommt den laufenden. */
export function runAmazonTodos(tenantId: string, opts: { sinceDays?: number; max?: number } = {}): Promise<RunResult> {
  const cur = running.get(tenantId);
  if (cur) return cur;
  const p = runOnce(tenantId, opts.sinceDays ?? 3, opts.max ?? 40).finally(() => running.delete(tenantId));
  running.set(tenantId, p);
  return p;
}

export const isRunning = (tenantId: string) => running.has(tenantId);

async function runOnce(tenantId: string, sinceDays: number, max: number): Promise<RunResult> {
  const result: RunResult = { checked: 0, created: 0, irrelevant: 0, filtered: 0, high: 0, closedAuto: 0, errors: [], ai: false };
  try {
    result.versand = await versandAbgleich(tenantId);
  } catch (e) {
    result.errors.push(`Versand-Abgleich: ${e instanceof Error ? e.message : String(e)}`);
  }
  const since = new Date(Date.now() - sinceDays * 86400_000);
  // Bekannte Mails (schon Aufgabe oder schon verworfen) überspringen.
  const candidates = await db
    .select({ id: E.id, key: E.messageKey, fromAddress: E.fromAddress, fromName: E.fromName, subject: E.subject, receivedAt: E.receivedAt, body: E.bodyText })
    .from(E)
    .where(
      and(
        eq(E.tenantId, tenantId),
        gte(E.receivedAt, since),
        ilike(E.fromAddress, "%amazon.%"),
        notExists(db.select({ x: sql`1` }).from(T).where(and(eq(T.tenantId, tenantId), eq(T.messageKey, E.messageKey)))),
        notExists(db.select({ x: sql`1` }).from(SEEN).where(and(eq(SEEN.tenantId, tenantId), eq(SEEN.messageKey, E.messageKey)))),
      ),
    )
    .orderBy(desc(E.receivedAt))
    .limit(500);
  result.checked = candidates.length;

  // 0. Pflicht-ToDos (Deaktivierung, Dokumente, Compliance in allen EU-Sprachen) – immer, ohne KI.
  // Bestell- und FBA-Versand-Mails sind nie Pflicht-ToDos (z. B. „Verkauft, jetzt liefern: … Batterien AA“).
  const pflicht = candidates.map((c) => ({ c, p: /marketplace\.amazon/i.test(c.fromAddress ?? "") || istBestellMail(c.subject) || istFbaVersandMail(c.subject) ? null : pflichtRegel({ subject: c.subject ?? "", text: c.body ?? "" }) })).filter((x) => x.p);
  const pflichtKeys = new Set(pflicht.map((x) => x.c.key));
  const pflichtResults: TriageResult[] = pflicht.map(({ c, p }) => ({
    key: c.key,
    relevant: true,
    actionNeeded: true,
    category: p!.category,
    priority: "high",
    deadline: deadlineFromText(c.body ?? "", c.receivedAt.toISOString()),
    asins: extractAsins(`${c.subject ?? ""} ${c.body ?? ""}`),
    summary: c.subject ?? "",
  }));

  // 1. Grobfilter ohne KI.
  const noise = candidates.filter((c) => !pflichtKeys.has(c.key)).map((c) => ({ c, reason: noiseReason({ from: `${c.fromName ?? ""} <${c.fromAddress ?? ""}>`, subject: c.subject ?? "" }) }));
  const filtered = noise.filter((n) => n.reason);
  if (filtered.length) {
    await db.insert(SEEN).values(filtered.map((n) => ({ tenantId, messageKey: n.c.key, reason: `Grobfilter: ${n.reason}` }))).onConflictDoNothing();
    result.filtered = filtered.length;
  }
  const todo = noise.filter((n) => !n.reason).map((n) => n.c).slice(0, max);
  if (todo.length === 0 && pflicht.length === 0) {
    await refreshTodoTask(tenantId);
    return result;
  }

  // 2. Einstufen – mit KI in Blöcken, sonst nach Regeln.
  const mails: TriageMail[] = todo.map((c) => ({ key: c.key, from: `${c.fromName ?? ""} <${c.fromAddress ?? ""}>`.trim(), subject: c.subject ?? "", date: c.receivedAt.toISOString(), text: c.body ?? "" }));
  const ai = await getIntegration(tenantId, "anthropic");
  const results: TriageResult[] = [];
  if (ai?.apiKey) {
    result.ai = true;
    for (let i = 0; i < mails.length; i += BATCH_SIZE) {
      const batch = mails.slice(i, i + BATCH_SIZE);
      try {
        const r = await askClaude(ai.apiKey, triagePrompt(batch), { model: modelFor(ai, "simple"), task: "simple", maxTokens: MAX_TOKENS });
        const parsed = parseTriage(r.text, batch);
        if (parsed.length < batch.length) console.warn(`[Amazon-ToDos] KI-Block unvollständig: ${parsed.length}/${batch.length} – Rest beim nächsten Lauf.`);
        results.push(...parsed);
      } catch (e) {
        // Block bleibt unbekannt und kommt beim nächsten Lauf erneut dran.
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  } else {
    results.push(...mails.map(triageByRules));
  }

  // 3. Speichern (Pflicht-ToDos zuerst).
  const byKey = new Map([...todo, ...pflicht.map((x) => x.c)].map((c) => [c.key, c]));
  const created: (typeof T.$inferSelect)[] = [];
  for (const r of [...pflichtResults, ...results]) {
    const mail = byKey.get(r.key);
    if (!mail) continue;
    if (!r.relevant) {
      await db.insert(SEEN).values({ tenantId, messageKey: r.key, reason: "KI: nicht relevant" }).onConflictDoNothing();
      result.irrelevant++;
      continue;
    }
    const [row] = await db
      .insert(T)
      .values({
        tenantId,
        messageKey: r.key,
        emailId: mail.id,
        receivedAt: mail.receivedAt,
        sender: mail.fromName || mail.fromAddress,
        subject: mail.subject,
        category: r.category,
        priority: r.priority,
        deadline: r.deadline,
        asins: r.asins,
        skus: extractSkus(`${mail.subject ?? ""}\n${mail.body ?? ""}`),
        marktplatz: marktplatzAus(mail.fromAddress ?? "", mail.body ?? "").land,
        bestellnummern: bestellnummernAus(`${mail.subject ?? ""}\n${mail.body ?? ""}`),
        link: kontozustandLink(marktplatzAus(mail.fromAddress ?? "", mail.body ?? "").tld),
        bodyShort: (mail.body ?? "").slice(0, 1500),
        status: r.actionNeeded ? "open" : "done",
        infoOnly: !r.actionNeeded,
        closedBy: r.actionNeeded ? null : "nur Info",
        closedAt: r.actionNeeded ? null : new Date(),
        source: pflichtKeys.has(r.key) || !result.ai ? "rules" : "ai",
      })
      .onConflictDoNothing()
      .returning();
    if (!row) continue;
    created.push(row);
    result.created++;
    if (row.status === "open" && row.priority === "high") result.high++;
  }

  // 4. Freigabe-Mails erledigen ältere Aufgaben zur selben ASIN.
  for (const info of created.filter((c) => c.category === "freigabe_info" && c.asins.length)) {
    result.closedAuto += await autoClose(tenantId, info);
  }

  // 5. Neue Aufgaben mit hoher Priorität sofort melden.
  const high = created.filter((c) => c.status === "open" && c.priority === "high");
  if (high.length) {
    const base = (process.env.APP_URL || "").replace(/\/$/, "");
    const lines = high.slice(0, 8).map((c) => `• **${categoryLabel(c.category)}**${c.deadline ? ` (Frist ${fmt(c.deadline)})` : ""}: ${c.summary ?? c.subject}${c.asins.length ? ` – ${c.asins.slice(0, 3).join(", ")}` : ""}`);
    await notifyDiscord(tenantId, [`📋 **${high.length} neue Amazon-ToDo${high.length === 1 ? "" : "s"} mit hoher Priorität**`, ...lines, high.length > 8 ? `… und ${high.length - 8} weitere` : "", base ? `${base}/amazon-todos` : ""].filter(Boolean).join("\n"));
    // SMS (B13, falls eingerichtet): Konto/Deaktivierung/Marke als rote Meldung – kurz, ohne Kundendaten.
    const rot = high.filter((c) => /account|konto|deaktiv|compliance|marke|brand|ip_|listing_blocked/i.test(c.category));
    if (rot.length) {
      const { smsMelden } = await import("@/lib/mobil/sms");
      await smsMelden(tenantId, { art: "konto", rot: true, kern: `${rot.length === 1 ? categoryLabel(rot[0].category) : `${rot.length} Konto-/Angebots-Themen`}${rot[0].deadline ? `, Frist ${fmt(rot[0].deadline)}` : ""}`, schluessel: `amazon:${rot.map((c) => c.category).join(",")}:${new Date().toISOString().slice(0, 13)}` }).catch(() => null);
    }
  }

  await refreshTodoTask(tenantId);
  if (result.created || result.irrelevant) console.log(`[Amazon-ToDos] ${JSON.stringify({ geprueft: result.checked, neu: result.created, irrelevant: result.irrelevant, gefiltert: result.filtered, hochprio: result.high, auto_erledigt: result.closedAuto })}`);
  return result;
}

const fmt = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

async function autoClose(tenantId: string, info: typeof T.$inferSelect): Promise<number> {
  const open = await db
    .select({ id: T.id, category: T.category, asins: T.asins, receivedAt: T.receivedAt })
    .from(T)
    .where(and(eq(T.tenantId, tenantId), eq(T.status, "open"), sql`${T.asins} ?| ${sql.raw(`array[${info.asins.map((a) => `'${a.replace(/[^A-Z0-9]/g, "")}'`).join(",")}]`)}`));
  const ids = todosClosedBy(
    { category: info.category, asins: info.asins, receivedAt: info.receivedAt.toISOString() },
    open.map((o) => ({ ...o, receivedAt: o.receivedAt.toISOString() })),
  );
  if (!ids.length) return 0;
  await db
    .update(T)
    .set({ status: "done", closedAt: new Date(), closedBy: `automatisch: ${info.summary ?? info.subject ?? "Freigabe"} (${info.receivedAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })})`, updatedAt: new Date() })
    .where(and(eq(T.tenantId, tenantId), inArray(T.id, ids)));
  return ids.length;
}

/** Eine Sammelaufgabe auf der Startseite statt Hunderter Einzelaufgaben. */
export async function refreshTodoTask(tenantId: string) {
  const s = await todoStats(tenantId);
  if (s.open === 0) {
    await resolveSystemTask(db, tenantId, "amazon-todos");
    return;
  }
  const [next] = await db
    .select({ d: T.deadline })
    .from(T)
    .where(and(eq(T.tenantId, tenantId), eq(T.status, "open"), isNotNull(T.deadline), gte(T.deadline, todayIso())))
    .orderBy(asc(T.deadline))
    .limit(1);
  await upsertSystemTask(db, tenantId, "amazon-todos", {
    title: `Amazon-ToDos: ${s.open} offen (${s.high} hoch)${s.dueSoon ? `, ${s.dueSoon} mit Frist ≤ 7 Tage` : ""}${s.overdue ? `, ${s.overdue} Frist abgelaufen` : ""}`,
    notes: "Im Seller Central erledigen und in der Liste abhaken.",
    priority: s.dueSoon || s.overdue ? "critical" : "normal",
    category: "amazon",
    link: "/amazon-todos",
    dueDate: next?.d ?? null,
  });
}

export async function todoStats(tenantId: string) {
  const today = todayIso();
  const [r] = await db
    .select({
      open: sql<number>`count(*) filter (where ${T.status} = 'open')::int`,
      high: sql<number>`count(*) filter (where ${T.status} = 'open' and ${T.priority} = 'high')::int`,
      dueSoon: sql<number>`count(*) filter (where ${T.status} = 'open' and ${T.deadline} between ${today}::date and ${addDaysIso(today, 7)}::date)::int`,
      overdue: sql<number>`count(*) filter (where ${T.status} = 'open' and ${T.deadline} < ${today}::date)::int`,
      done: sql<number>`count(*) filter (where ${T.status} = 'done')::int`,
      ignored: sql<number>`count(*) filter (where ${T.status} = 'ignored')::int`,
    })
    .from(T)
    .where(eq(T.tenantId, tenantId));
  return r ?? { open: 0, high: 0, dueSoon: 0, overdue: 0, done: 0, ignored: 0 };
}

export async function setTodoStatus(tenantId: string, id: string, status: "open" | "done" | "ignored", userName?: string) {
  await db
    .update(T)
    .set({ status, closedAt: status === "open" ? null : new Date(), closedBy: status === "open" ? null : `von Hand${userName ? ` (${userName})` : ""}`, updatedAt: new Date() })
    .where(and(eq(T.tenantId, tenantId), eq(T.id, id)));
  await refreshTodoTask(tenantId);
}

export async function setTodoNote(tenantId: string, id: string, note: string) {
  await db.update(T).set({ note: note.trim().slice(0, 2000) || null, updatedAt: new Date() }).where(and(eq(T.tenantId, tenantId), eq(T.id, id)));
}

/** Offene Fristen je Tag – für den Kalender. */
export async function todoDeadlines(tenantId: string, from: string, to: string) {
  return db
    .select({ deadline: T.deadline, category: T.category, n: sql<number>`count(*)::int`, high: sql<number>`count(*) filter (where ${T.priority} = 'high')::int` })
    .from(T)
    .where(and(eq(T.tenantId, tenantId), eq(T.status, "open"), isNotNull(T.deadline), gte(T.deadline, from), lte(T.deadline, to)))
    .groupBy(T.deadline, T.category);
}

// ---- Versand-Abgleich (B10) -------------------------------------------------------------------
// Bestell-Mails („Verkauft, jetzt liefern“) sind keine ToDos: Sie folgen dem Auftrag. Ist er versendet (Label,
// Sendungsnummer, Prep Center, von Hand) oder storniert, wird die Mail archiviert; FBA-Versandinfos sofort.
// Echte Probleme stehen in je EINEM Sammel-ToDo: FBM-Aufträge nach Versandfrist offen, Mail ohne Auftrag im Tool.

export type VersandErgebnis = { archiviert: number; ueberfaellig: number; fehlend: number; altGeschlossen: number };

export async function versandAbgleich(tenantId: string, now = Date.now()): Promise<VersandErgebnis> {
  const O = schema.orders;
  const seit = new Date(now - 30 * 86_400_000);
  // Bestell- und FBA-Versand-Mails der letzten 30 Tage, die noch im Posteingang liegen
  const roh = await db
    .select({ id: E.id, subject: E.subject, receivedAt: E.receivedAt, body: sql<string>`left(coalesce(${E.bodyText}, ''), 4000)` })
    .from(E)
    .where(and(eq(E.tenantId, tenantId), eq(E.archived, false), gte(E.receivedAt, seit), ilike(E.fromAddress, "%amazon.%")));
  const mails = roh.filter((m) => istBestellMail(m.subject) || istFbaVersandMail(m.subject));
  const offeneTodos = await db.select({ id: T.id, subject: T.subject, category: T.category, bodyShort: T.bodyShort }).from(T).where(and(eq(T.tenantId, tenantId), eq(T.status, "open")));
  const alt = offeneTodos.filter((t) => istBestellMail(t.subject) || istFbaVersandMail(t.subject));
  const nummern = [...new Set([...mails.flatMap((m) => bestellnummernAus(`${m.subject ?? ""}\n${m.body}`)), ...alt.flatMap((t) => bestellnummernAus(`${t.subject ?? ""}\n${t.bodyShort ?? ""}`))])];
  const auftragSpalten = { id: O.id, externalId: O.externalId, status: O.status, fulfillment: O.fulfillment, shipBy: O.shipBy, orderDate: O.orderDate, trackingUploadedAt: O.trackingUploadedAt, externalStatus: O.externalStatus };
  const kurz = (r: { id: string; externalId: string; status: string; fulfillment: string; shipBy: Date | null; orderDate: Date; trackingUploadedAt: Date | null; externalStatus: string | null }): AuftragKurz => ({ id: r.id, externalId: r.externalId, status: r.status, fulfillment: r.fulfillment, shipBy: r.shipBy?.toISOString() ?? null, orderDate: r.orderDate.toISOString(), bestaetigt: anAmazonBestaetigt(r) });
  const zuMails = nummern.length ? (await db.select(auftragSpalten).from(O).where(and(eq(O.tenantId, tenantId), eq(O.channel, "amazon"), inArray(O.externalId, nummern)))).map(kurz) : [];
  // Offene Amazon-FBM-Aufträge der letzten 30 Tage für „nach Versandfrist noch offen“
  const offen = (await db.select(auftragSpalten).from(O).where(and(eq(O.tenantId, tenantId), eq(O.channel, "amazon"), eq(O.fulfillment, "FBM"), eq(O.status, "open"), gte(O.orderDate, seit)))).map(kurz);

  const ab = bestellMailsAbgleichen(mails.map((m) => ({ emailId: m.id, subject: m.subject ?? "", text: m.body, receivedAt: m.receivedAt.toISOString() })), zuMails, now);
  if (ab.archivieren.length) await db.update(E).set({ archived: true }).where(and(eq(E.tenantId, tenantId), inArray(E.id, ab.archivieren)));

  // Altbestand: einzelne ToDos aus Bestell-/FBA-Versand-Mails schließen
  const zu = altToDosSchliessen(alt, zuMails);
  for (const z of zu) await db.update(T).set({ status: "done", closedAt: new Date(now), closedBy: z.grund, updatedAt: new Date(now) }).where(and(eq(T.tenantId, tenantId), eq(T.id, z.id), eq(T.status, "open")));

  const ueber = ueberfaellig(offen, now);
  const dmy = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" });
  await sammelToDo(tenantId, now, {
    ...SAMMEL.ueberfaellig,
    nummern: ueber.map((a) => a.externalId),
    titel: (n) => `${n} FBM-Auftr${n === 1 ? "ag" : "äge"} nach Versandfrist noch offen`,
    priority: "high",
    deadline: ueber[0] ? ueber[0].frist.slice(0, 10) : null,
    text: ueber.map((a) => `${a.externalId} – Versandfrist ${dmy(versandfrist(a))}`).join("\n"),
  });
  // B15: versendet, aber Amazon weiß es nicht (ohne Schnittstelle) – Versandbestätigung als Datei hochladen.
  const { offeneBestaetigungen } = await import("@/lib/orders/bestaetigung");
  const unb = await offeneBestaetigungen(tenantId, new Date(now));
  await sammelToDo(tenantId, now, {
    ...SAMMEL.unbestaetigt,
    nummern: unb.map((a) => a.externalId),
    titel: (n) => `${n} FBM-Auftr${n === 1 ? "ag" : "äge"} versendet, aber bei Amazon nicht bestätigt`,
    priority: "high",
    deadline: unb[0]?.frist ? unb[0].frist.slice(0, 10) : null,
    text: `Versandbestätigung als Datei hochladen: Aufträge → „Meldung offen“ → Datei laden → in Seller Central hochladen → „Hochgeladen“ bestätigen.\n${unb.map((a) => `${a.externalId}${a.frist ? ` – Frist ${dmy(a.frist)}` : ""}${a.tracking ? "" : " – ohne Sendungsnummer"}`).join("\n")}`,
  });
  await sammelToDo(tenantId, now, {
    ...SAMMEL.fehlt,
    nummern: ab.fehlend.map((f) => f.bestellnummer),
    titel: (n) => `${n} Bestell-Mail${n === 1 ? "" : "s"} zu Bestellungen, die im Tool fehlen (Import-Lücke)`,
    priority: "medium",
    deadline: null,
    text: ab.fehlend.map((f) => `${f.bestellnummer} – Mail vom ${dmy(f.receivedAt)}: ${f.subject.slice(0, 80)}`).join("\n"),
  });
  if (zu.length || ab.archivieren.length) await refreshTodoTask(tenantId);
  return { archiviert: ab.archivieren.length, ueberfaellig: ueber.length, fehlend: ab.fehlend.length, altGeschlossen: zu.length };
}

async function sammelToDo(
  tenantId: string,
  now: number,
  o: { key: string; category: string; nummern: string[]; titel: (n: number) => string; priority: "high" | "medium"; deadline: string | null; text: string },
) {
  const [alt] = await db.select().from(T).where(and(eq(T.tenantId, tenantId), eq(T.messageKey, o.key)));
  const jetzt = new Date(now);
  if (!o.nummern.length) {
    // Nichts mehr offen: schließen und die Liste leeren (eine neue Nummer öffnet es später wieder).
    if (alt && (alt.status === "open" || alt.bestellnummern.length)) await db.update(T).set({ ...(alt.status === "open" ? { status: "done" as const, closedAt: jetzt, closedBy: `automatisch: nichts mehr offen (zuletzt ${alt.bestellnummern.slice(0, 10).join(", ")})` } : {}), bestellnummern: [], updatedAt: jetzt }).where(eq(T.id, alt.id));
    return;
  }
  const werte = { subject: o.titel(o.nummern.length), summary: o.titel(o.nummern.length), category: o.category, priority: o.priority, deadline: o.deadline, bestellnummern: o.nummern.slice(0, 200), bodyShort: o.text.slice(0, 4000), updatedAt: jetzt };
  if (!alt) {
    await db.insert(T).values({ tenantId, messageKey: o.key, receivedAt: jetzt, sender: "Seller-System (Versand-Abgleich)", source: "rules", status: "open", ...werte }).onConflictDoNothing();
    return;
  }
  const oeffnen = alt.status !== "open" && sammelWiederOeffnen(alt.bestellnummern, o.nummern);
  await db.update(T).set({ ...werte, ...(oeffnen ? { status: "open" as const, closedAt: null, closedBy: null, receivedAt: jetzt } : {}) }).where(eq(T.id, alt.id));
}
