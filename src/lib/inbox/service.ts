import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { simpleParser } from "mailparser";
import { db, schema } from "@/db";
import { addDaysIso, todayIso } from "@/lib/dates";
import { gmailFetchRaw, graphFetch, type GraphMessage } from "@/lib/integrations/clients/mail";
import { mailboxCredentials } from "@/lib/mail/accounts";
import { imapFetchRaw, MailFehler, type ImapKopf } from "@/lib/mail/connect";
import { empfaengerAus } from "@/lib/mail/ordner";
import { getSettings } from "@/lib/settings";
import { classifyMail, MANUAL_RULE, marktplatzQuelle, regelFuer, TOPIC_LABEL, type Classification, type Topic } from "./classify";
import { istBestellMail } from "@/lib/amazon-todos/versand";
import { isAmazonSystemMail, noiseReason, vonFallZentraleErledigt } from "@/lib/amazon-todos/logic";
import type { MassenKopf } from "./persoenlich-logic";

export type ParsedMail = {
  messageKey: string;
  providerMessageId?: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  receivedAt: Date;
  text: string;
  /** Tabellen-Anhänge (CSV/Excel) – für Preislisten von Lieferanten (B2B-Deals); werden nicht gespeichert. */
  tabellen?: { name: string; data: Uint8Array }[];
  /** Weitere Anhänge (Bilder, PDF, Tabellen) – nur für den Deal-Eingang, sonst nicht gespeichert. */
  anhaenge?: { name: string; mime: string; data: Uint8Array }[];
  /** Empfangsadresse (Delivered-To bzw. „An“). */
  an?: string | null;
  /** Ordner/Label, aus dem die Mail kam. */
  ordner?: string | null;
  /** Antwort auf (Message-IDs aus In-Reply-To/References) – z. B. Lieferanten-Antwort auf eine Bestellmail. */
  antwortAuf?: string[];
  /** Namen aller Anhänge (z. B. „Rechnung_123.pdf“). */
  anhangNamen?: string[];
  /** Listen-/Bulk-Kopfzeilen (Newsletter, Systemmails) – persönliche Mails sind das nie. */
  kopf?: MassenKopf;
  /** Alle Empfänger (An) – bei gesendeten Mails die Gegenseite. */
  empfaenger?: { adresse: string; name: string | null }[];
};

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const headerTexte = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).map((x) => (typeof x === "string" ? x : ((x as { text?: string } | null)?.text ?? ""))).filter(Boolean);

export async function parseRaw(raw: Buffer, providerMessageId?: string, ordner?: string | null): Promise<ParsedMail> {
  const m = await simpleParser(raw);
  const from = m.from?.value?.[0];
  const an = empfaengerAus([...headerTexte(m.headers.get("delivered-to")), ...headerTexte(m.headers.get("x-original-to"))], (Array.isArray(m.to) ? m.to : m.to ? [m.to] : []).flatMap((t) => t.value.map((v) => v.address ?? "")));
  const text = m.text?.trim() || (typeof m.html === "string" ? htmlToText(m.html) : "");
  const zeile = (k: string) => {
    const l = m.headerLines?.find((h) => h.key === k)?.line;
    return l ? l.slice(l.indexOf(":") + 1).trim() : null;
  };
  const empfaenger = (Array.isArray(m.to) ? m.to : m.to ? [m.to] : []).flatMap((t) => t.value.map((v) => ({ adresse: (v.address ?? "").toLowerCase(), name: v.name || null }))).filter((e) => e.adresse);
  return {
    messageKey: m.messageId ?? createHash("sha1").update(raw).digest("hex"),
    providerMessageId,
    fromAddress: from?.address ?? "",
    fromName: from?.name || null,
    subject: m.subject ?? "",
    receivedAt: m.date ?? new Date(),
    text,
    tabellen: (m.attachments ?? [])
      .filter((a) => /\.(csv|xlsx|xls)$/i.test(a.filename ?? "") && a.size <= 5_000_000)
      .slice(0, 3)
      .map((a) => ({ name: a.filename ?? "Preisliste", data: new Uint8Array(a.content) })),
    anhaenge: (m.attachments ?? [])
      .filter((a) => (/^image\//.test(a.contentType) || a.contentType === "application/pdf" || /\.(csv|xlsx|xls)$/i.test(a.filename ?? "")) && a.size <= 10_000_000)
      .slice(0, 5)
      .map((a) => ({ name: a.filename ?? "Anhang", mime: a.contentType, data: new Uint8Array(a.content) })),
    an,
    ordner: ordner ?? null,
    antwortAuf: [...new Set([...(m.inReplyTo ? [m.inReplyTo] : []), ...(Array.isArray(m.references) ? m.references : m.references ? [m.references] : [])])],
    anhangNamen: (m.attachments ?? []).map((a) => a.filename ?? "").filter(Boolean),
    kopf: { listUnsubscribe: zeile("list-unsubscribe"), listId: zeile("list-id"), precedence: zeile("precedence"), autoSubmitted: zeile("auto-submitted") },
    empfaenger,
  };
}

function fromGraph(g: GraphMessage): ParsedMail {
  const body = g.body?.contentType === "html" ? htmlToText(g.body.content) : (g.body?.content ?? g.bodyPreview ?? "");
  return {
    messageKey: g.internetMessageId ?? `graph:${g.id}`,
    providerMessageId: g.id,
    fromAddress: g.from?.emailAddress?.address ?? "",
    fromName: g.from?.emailAddress?.name ?? null,
    subject: g.subject ?? "",
    receivedAt: new Date(g.receivedDateTime),
    text: body,
    an: empfaengerAus([], (g.toRecipients ?? []).map((r) => r.emailAddress?.address ?? "")),
    ordner: "Outlook (alle Ordner)",
    empfaenger: (g.toRecipients ?? []).map((r) => ({ adresse: (r.emailAddress?.address ?? "").toLowerCase(), name: r.emailAddress?.name ?? null })).filter((e) => e.adresse),
  };
}

const CATEGORY_FOR_TASK: Record<string, (typeof schema.TASK_CATEGORIES)[number]> = { amazon: "amazon", ebay: "ebay", tiktok: "support", temu: "support", dhl: "versand" };
const CASE_TYPE: Partial<Record<Topic, (typeof schema.CASE_TYPES)[number]>> = {
  a_to_z: "a_to_z",
  chargeback: "chargeback",
  ebay_case: "ebay_not_received",
  return_request: "return_request",
  account_health: "account_health",
};

/** Speichert eine Mail (Dubletten über alle Postfächer hinweg erkannt) und legt Aufgaben an. */
/** Amazon-Mails, die weiter als Einzelaufgabe/Fall laufen (Fälle-Modul). */
const KEEP_AS_TASK = new Set<Topic>(["a_to_z", "chargeback", "case_update", "return_request", "buyer_message", "registration", "payment_problem"]);

export async function ingestMail(tenantId: string, mailboxId: string | null, m: ParsedMail): Promise<"new" | "duplicate" | "ignored"> {
  // Deal-Eingang: eigenes Deal-Postfach (Einstellung) oder Betreff mit „#deal“ / „Deal prüfen“ → dorthin statt in den Posteingang.
  const { ausMail } = await import("@/lib/deal-eingang/mail");
  const deal = await ausMail(tenantId, mailboxId, m).catch((e) => {
    console.error("[Deal-Eingang] Mail:", e instanceof Error ? e.message : e);
    return null;
  });
  if (deal) return deal === "neu" ? "new" : "duplicate";
  // Abschnitt 10: Bestellbestätigung (Amazon/Shop) zu einem offenen Deal → als gekauft markieren; die Mail läuft normal weiter.
  await import("@/lib/deal-eingang/kauf")
    .then((k) => k.gekauftAusMail(tenantId, { messageKey: m.messageKey, fromAddress: m.fromAddress, fromName: m.fromName ?? null, subject: m.subject, text: m.text }))
    .catch((e) => console.error("[Deal-Eingang] Bestellbestätigung:", e instanceof Error ? e.message : e));
  // Preisliste eines bekannten Lieferanten im Anhang → in dessen „per Mail“-Preisliste übernehmen (B2B-Deals).
  if (m.tabellen?.length) {
    const { preislisteAusMail } = await import("@/lib/b2b/preislisten-mail");
    await preislisteAusMail(tenantId, { messageKey: m.messageKey, fromAddress: m.fromAddress, subject: m.subject, tabellen: m.tabellen }).catch((e) => console.error("[Preisliste aus Mail]", e instanceof Error ? e.message : e));
  }
  const fromLine = `${m.fromName ?? ""} <${m.fromAddress}>`;
  const quelle = marktplatzQuelle(fromLine);
  const cfg = (await getSettings(tenantId)).posteingang;
  // B32.5 Postausgang: eigene Absenderadresse (Gesendet-Ordner, Gmail „Alle Nachrichten“) → Verlauf zuordnen.
  const P = await import("./persoenlich");
  const eigene = await P.eigeneAdressen(tenantId);
  const vonMir = eigene.has(m.fromAddress.trim().toLowerCase());
  if (vonMir && (m.empfaenger ?? []).some((e) => !eigene.has(e.adresse))) {
    if (cfg.ausgangMitlesen === false) return "ignored";
    // Vom System selbst verschickt (Rechnungen, Anfragen, Antworten) – schon bekannt.
    if (!(await P.unbekannt(tenantId, [m.messageKey])).has(m.messageKey)) return "duplicate";
    const { ausgangErfassen } = await import("./ausgang");
    const r = await ausgangErfassen(tenantId, mailboxId, m, new Set(eigene.keys())).catch((e) => {
      console.error("[Postausgang]", e instanceof Error ? e.message : e);
      return "bekannt" as const;
    });
    return r === "bekannt" ? "duplicate" : "new";
  }
  // B34.3: Antwort eines Händlers auf ein Restposten-Anschreiben (Bezug „AV-…“) → Aufgabe/Sperrliste; die Mail
  // landet immer im geschäftlichen Posteingang (nie privat, nie „unwichtig“). Eigene Mails zählen nicht als Antwort.
  const abverkauf = vonMir
    ? false
    : await import("@/lib/abverkauf/service")
        .then((a) => a.antwortAusMail(tenantId, { messageKey: m.messageKey, fromAddress: m.fromAddress, subject: m.subject, text: m.text }))
        .catch((e) => {
          console.error("[Abverkauf] Antwort:", e instanceof Error ? e.message : e);
          return false;
        });
  // Rechtsfälle (B14): Mails vom Anwalt bzw. mit bekanntem Aktenzeichen → in den Verlauf des Falls, nicht hierher.
  if (!quelle) {
    const { rechtsMailZuordnen } = await import("@/lib/recht/service");
    const rf = await rechtsMailZuordnen(tenantId, { messageKey: m.messageKey, fromAddress: m.fromAddress, fromName: m.fromName ?? null, subject: m.subject, text: m.text, receivedAt: m.receivedAt }).catch((e) => {
      console.error("[Rechtsfall-Mail]", e instanceof Error ? e.message : e);
      return null;
    });
    if (rf) return rf.ergebnis === "bekannt" ? "duplicate" : "new";
  }
  // Antworten bekannter Lieferanten (Profil-E-Mail bzw. Firmen-Domain) gelten als wichtig.
  const lieferant = quelle ? null : await import("@/lib/b2b/preislisten-mail").then((x) => x.lieferantZuAbsender(tenantId, m.fromAddress)).catch(() => null);
  // Gericht/Behörde/Gegenseite (B14) ist nie unwichtig – auch von unbekannten Absendern.
  const behoerde = !quelle && (await import("@/lib/recht/logic")).behoerdenMail({ from: fromLine, subject: m.subject, body: m.text });
  // B32.5: Antwort auf eine eigene ausgehende Mail (B2B-Anfrage, Lieferant …) – immer wichtig, Nachfassen erledigt.
  const ausgang = quelle ? null : await import("./ausgang").then((x) => x.antwortAufAusgang(tenantId, m)).catch(() => null);
  const kontakt = quelle ? null : await P.kontaktLesen(tenantId, m.fromAddress).catch(() => null);
  // Termin-Mails (Arzt, Handwerker, Amt, Schule) sind privat: nur in den Privatkalender des Inhabers, nie hier.
  // (Absender, die ausdrücklich als „persönlich“ festgelegt sind, bekommen stattdessen Nachricht + Entwurf.)
  if (!quelle && !abverkauf && cfg.terminMails && kontakt?.art !== "persoenlich") {
    const { terminMailUebernehmen, terminMelden } = await import("@/lib/private/termin-mail-service");
    const t = await terminMailUebernehmen(tenantId, { messageKey: m.messageKey, from: fromLine, subject: m.subject, body: m.text, receivedAt: m.receivedAt }, todayIso()).catch((e) => {
      console.error("[Termin-Mail]", e instanceof Error ? e.message : e);
      return null;
    });
    if (t) {
      await terminMelden(tenantId, t);
      return t.ergebnis === "bekannt" ? "duplicate" : "new";
    }
  }
  const c = classifyMail({ from: fromLine, subject: m.subject, body: m.text }, new Date(), { lieferant: Boolean(lieferant) });
  // Eigene Regeln je Absender/Betreff/Thema: archivieren, als Aufgabe, an Zuständigen.
  const regeln = await db.select().from(schema.mailRegeln).where(and(eq(schema.mailRegeln.tenantId, tenantId), eq(schema.mailRegeln.aktiv, true))).orderBy(schema.mailRegeln.createdAt);
  const regel = regeln.length ? regelFuer({ from: fromLine, subject: m.subject, topic: c.relevant ? c.topic : null }, regeln) : null;
  // B32 Persönliche Mails (Personen, Praxen, Dienstleister) → nur Privatbereich des Inhabers, nie hierher. Vorrang
  // haben: Marktplätze, Rechtsfälle, Lieferanten, Behörden, Antworten auf eigene Mails, eigene Regeln und alles, was
  // die Einstufung schon als geschäftlich erkennt (außer der Absender ist ausdrücklich „persönlich“).
  if (!quelle && !vonMir && !lieferant && !behoerde && !ausgang && !abverkauf && !regel && (!c.relevant || kontakt?.art === "persoenlich") && cfg.persoenlich.aktiv !== false) {
    const kunden = await db.select({ email: schema.b2bKunden.email }).from(schema.b2bKunden).where(eq(schema.b2bKunden.tenantId, tenantId));
    const istKunde = kunden.some((k) => (k.email ?? "").trim().toLowerCase() === m.fromAddress.trim().toLowerCase());
    if (!istKunde) {
      const owner = await import("@/lib/private/termin-mail-service").then((x) => x.inhaberPrivatSitzung(tenantId)).catch(() => null);
      const eingang = { messageKey: m.messageKey, fromAddress: m.fromAddress, fromName: m.fromName, subject: m.subject, text: m.text, receivedAt: m.receivedAt, antwortAuf: m.antwortAuf, kopf: m.kopf };
      const p = await P.persoenlichPruefen(tenantId, eingang, owner?.name ?? null).catch((e) => {
        console.error("[Persönliche Mail] Prüfen:", e instanceof Error ? e.message : e);
        return null;
      });
      if (p?.stufe === "ignorieren") return "ignored";
      if (p) {
        const r = await P.persoenlichErfassen(tenantId, mailboxId, eingang, p.stufe, p.einstufung).catch((e) => {
          console.error("[Persönliche Mail] Erfassen:", e instanceof Error ? e.message : e);
          return null;
        });
        // Ohne Inhaber mit Privat-Zugang: nicht in den geschäftlichen Posteingang (VA sähe sie sonst).
        return r ?? "ignored";
      }
    }
  }
  // Absender als „geschäftlich“ festgelegt bzw. Antwort auf eigene ausgehende Mail: wichtig, auch wenn unbekannt.
  const erzwungen = !c.relevant && (Boolean(ausgang) || abverkauf || kontakt?.art === "geschaeftlich") ? (ausgang ? "Antwort auf ausgehende Mail" : abverkauf ? "Antwort auf Restposten-Angebot" : "Kontakt: geschäftlich") : null;
  if (!c.relevant && !behoerde && !erzwungen && (!regel || regel.aktion === "archivieren")) return "ignored";
  const r: Classification = c.relevant ? c : { ...c, relevant: true, category: "action", topic: "other", rule: behoerde && !regel ? "Gericht/Behörde" : erzwungen && !regel ? erzwungen : "eigene Regel", dueInDays: behoerde && !regel ? 1 : 2 };
  const regelZeile = regel ? regeln.find((x) => x.id === regel.id)! : null;
  // Beim Eingang archivieren: eigene Regel „archivieren“ oder (Einstellung) Newsletter und Versand-/Lieferbestätigungen.
  // Bestell-Mails („Verkauft, jetzt liefern“) bleiben offen – der Versand-Abgleich der Amazon-ToDos braucht sie.
  const autoArchiv = !behoerde && !erzwungen && (regel?.aktion === "archivieren" || (cfg.autoArchiv && !regel && (r.topic === "marketing" || (r.topic === "order_info" && !istBestellMail(m.subject)))));
  const [row] = await db
    .insert(schema.emails)
    .values({
      tenantId,
      mailboxId,
      providerMessageId: m.providerMessageId ?? null,
      messageKey: m.messageKey,
      fromAddress: m.fromAddress,
      fromName: m.fromName,
      subject: clip(m.subject, 500),
      receivedAt: m.receivedAt,
      snippet: clip(m.text.replace(/\s+/g, " "), 300),
      bodyText: clip(m.text, 20_000),
      an: m.an ?? null,
      ordner: m.ordner ? clip(m.ordner, 200) : null,
      category: r.category,
      topic: r.topic,
      matchedRule: regel ? `regel · ${regel.aktion}` : r.rule,
      references: r.references,
      archived: autoArchiv,
      regelId: regel?.id ?? null,
      antwortAuf: (m.antwortAuf ?? []).slice(0, 30),
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return "duplicate";
  if (ausgang) await import("./ausgang").then((x) => x.antwortVerknuepfen(tenantId, ausgang.id, row.id)).catch((e) => console.error("[Postausgang] Antwort:", e instanceof Error ? e.message : e));
  // B28.5: Antwort des Lieferanten auf eine Bestellmail (Rechnung, Sendungsnummer) → am Deal und im Einkauf vermerken.
  await import("@/lib/deal-eingang/bestellmail")
    .then((b) => b.antwortZuordnen(tenantId, { id: row.id, fromAddress: m.fromAddress, subject: m.subject, text: m.text, receivedAt: m.receivedAt, antwortAuf: m.antwortAuf ?? [], anhangNamen: m.anhangNamen ?? [] }))
    .catch((e) => console.error("[Bestellmail-Antwort]", e instanceof Error ? e.message : e));
  if (regelZeile) await db.update(schema.mailRegeln).set({ treffer: sql`${schema.mailRegeln.treffer} + 1` }).where(eq(schema.mailRegeln.id, regelZeile.id));
  if (autoArchiv) return "new";
  // Gericht/Behörde/Gegenseite ohne Fall → Entwurf an den Anwalt + Aufgabe „an Anwalt weitergeben?“ (nie automatisch gesendet).
  // Dann keine zweite, allgemeine Mail-Aufgabe.
  if (behoerde && !regel) {
    const ok = await import("@/lib/recht/service")
      .then((x) => x.anAnwaltVorschlagen(tenantId, { id: row.id, fromAddress: m.fromAddress, fromName: m.fromName ?? null, subject: m.subject, text: m.text, receivedAt: m.receivedAt }))
      .catch((e) => {
        console.error("[An Anwalt weitergeben]", e instanceof Error ? e.message : e);
        return false;
      });
    if (ok) return "new";
  }
  // Regel „Aufgabe“/„weiterleiten“: immer als Aufgabe (weiterleiten = mit Zuständigkeit), auch bei „Info“.
  const erzwingen = regel?.aktion === "aufgabe" || regel?.aktion === "weiterleiten";
  // B34.3: Antwort auf ein Restposten-Anschreiben hat schon ihre eigene Aufgabe – keine zweite, allgemeine.
  if (abverkauf && !erzwingen) return "new";
  await createMailTask(tenantId, { id: row.id, subject: m.subject, fromName: m.fromName ?? null, fromAddress: m.fromAddress, receivedAt: m.receivedAt }, erzwingen && r.category !== "critical" ? { ...r, category: "action" } : r, {
    erzwingen,
    zustaendigId: regel?.aktion === "weiterleiten" ? (regelZeile?.zustaendigId ?? null) : null,
  });
  // B32: Käuferfrage bzw. Lieferanten-Antwort → Antwortentwurf vorbereiten (gesendet wird nur nach Prüfung).
  if (r.topic === "buyer_message" || (lieferant && r.category !== "noise")) {
    await import("./entwurf-geschaeftlich")
      .then((x) => x.geschaeftsEntwurf(tenantId, { id: row.id, fromAddress: m.fromAddress, fromName: m.fromName ?? null, subject: m.subject, text: m.text, lieferant: lieferant?.name ?? null }))
      .catch((e) => console.error("[Antwortentwurf]", e instanceof Error ? e.message : e));
  }
  return "new";
}

/** Kritische und „Handeln“-Mails als Aufgabe (und ggf. als Fall) anlegen – beim Eingang und beim Hochstufen. */
async function createMailTask(
  tenantId: string,
  mail: { id: string; subject: string; fromName: string | null; fromAddress: string; receivedAt: Date },
  c: Pick<Classification, "category" | "topic" | "source" | "references" | "dueInDays">,
  opts: { erzwingen?: boolean; zustaendigId?: string | null } = {},
) {
  // Amazon-Systemmails (Produktsicherheit, Reaktivierung, Echtheitsprüfung …) führt das Modul
  // Amazon-ToDos mit Frist und KI-Einstufung – hier keine zusätzliche Einzelaufgabe.
  const fromLine = `${mail.fromName ?? ""} <${mail.fromAddress}>`;
  // B20.5: Auszahlung, Bewertungsanfrage, Buy-Box-Hinweis erledigt die Fall-Zentrale – auch keine Einzelaufgabe.
  const handledByTodos = !opts.erzwingen && ((noiseReason({ from: fromLine, subject: mail.subject }) === null && !KEEP_AS_TASK.has(c.topic)) || (isAmazonSystemMail(fromLine) && vonFallZentraleErledigt({ subject: mail.subject }) !== null));
  if ((c.category === "critical" || c.category === "action") && !handledByTodos) {
    const refs = Object.values(c.references).join(" · ");
    const due = c.dueInDays !== null ? addDaysIso(todayIso(mail.receivedAt), c.dueInDays) : null;
    const [task] = await db
      .insert(schema.tasks)
      .values({
        tenantId,
        title: clip(`${TOPIC_LABEL[c.topic]}: ${mail.subject}`, 280),
        notes: clip(`${mail.fromName ?? mail.fromAddress}${refs ? ` · ${refs}` : ""}`, 500),
        priority: c.category === "critical" ? "critical" : "normal",
        category: CATEGORY_FOR_TASK[c.source ?? ""] ?? "support",
        dueDate: due,
        link: `/posteingang/${mail.id}`,
        systemKey: `mail:${mail.id}`,
        assigneeId: opts.zustaendigId ?? null,
      })
      .returning({ id: schema.tasks.id });
    await db.update(schema.emails).set({ taskId: task.id }).where(eq(schema.emails.id, mail.id));

    const caseType = CASE_TYPE[c.topic];
    if (caseType) {
      await db.insert(schema.cases).values({
        tenantId,
        channel: c.source === "ebay" ? "ebay" : c.source === "tiktok" ? "tiktok" : c.source === "temu" ? "temu" : "amazon",
        type: caseType,
        title: clip(mail.subject, 200),
        externalId: c.references.caseId ?? null,
        orderRef: c.references.amazonOrder ?? c.references.ebayOrder ?? null,
        deadline: due,
        notes: `Aus Mail vom ${mail.receivedAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}`,
      });
    }
    if (c.references.caseId) {
      const claims = await db.select({ id: schema.claims.id }).from(schema.claims).where(and(eq(schema.claims.tenantId, tenantId), eq(schema.claims.amazonCaseId, c.references.caseId)));
      for (const cl of claims) await db.insert(schema.claimEvents).values({ tenantId, claimId: cl.id, action: "Mail zum Fall", note: clip(mail.subject, 200) });
    }
  }
}

// --- Einstufung mit neuen Regeln prüfen ------------------------------------------------------

const RANK = { noise: 0, info: 1, action: 2, critical: 3 } as const;

/**
 * Welche offenen Mails der letzten Wochen würden mit den aktuellen Regeln höher eingestuft (z. B. Zahlungsprobleme,
 * die früher als „Info“ ankamen)? Nie herabstufen, von Hand korrigierte Mails nie anfassen.
 */
export async function mailUpgrades(tenantId: string, days = 60) {
  const E = schema.emails;
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({ id: E.id, subject: E.subject, fromName: E.fromName, fromAddress: E.fromAddress, bodyText: E.bodyText, receivedAt: E.receivedAt, category: E.category, topic: E.topic, taskId: E.taskId })
    .from(E)
    .where(and(eq(E.tenantId, tenantId), eq(E.archived, false), gte(E.receivedAt, since), inArray(E.category, ["noise", "info", "action"]), or(isNull(E.matchedRule), ne(E.matchedRule, MANUAL_RULE))))
    .limit(1000);
  return rows
    .map((r) => ({ r, c: classifyMail({ from: `${r.fromName ?? ""} <${r.fromAddress ?? ""}>`, subject: r.subject ?? "", body: r.bodyText ?? "" }, r.receivedAt) }))
    .filter((x) => x.c.relevant && RANK[x.c.category] > RANK[x.r.category]);
}

/** Hochstufen übernehmen (nur auf Klick): Einstufung, Thema, Regel; fehlende Aufgabe anlegen, Priorität anheben. */
export async function applyMailUpgrades(tenantId: string): Promise<number> {
  const list = await mailUpgrades(tenantId);
  for (const { r, c } of list) {
    await db.update(schema.emails).set({ category: c.category, topic: c.topic, matchedRule: c.rule }).where(and(eq(schema.emails.tenantId, tenantId), eq(schema.emails.id, r.id)));
    if (r.taskId) {
      if (c.category === "critical") await db.update(schema.tasks).set({ priority: "critical" }).where(and(eq(schema.tasks.tenantId, tenantId), eq(schema.tasks.id, r.taskId)));
    } else {
      await createMailTask(tenantId, { id: r.id, subject: r.subject ?? "", fromName: r.fromName, fromAddress: r.fromAddress ?? "", receivedAt: r.receivedAt }, c);
    }
  }
  return list.length;
}

// --- Postfächer abrufen ---------------------------------------------------------------

/** Termin-Hinweise im Betreff (Arzt, Doctolib …) – solche Systemmails nie schon beim Vorfilter verwerfen. */
const TERMIN_BETREFF = /termin|erinnerung|appointment|buchung|absage|verschieb/i;

/**
 * Postfach abrufen. `schnell` (jede Minute): nur Posteingang der letzten 2 Stunden, `lastSyncAt` bleibt – der volle
 * Abruf (alle 14 Min.) liest weiter alle Ordner samt Gesendet. Bekannte Mails werden nicht noch einmal geladen.
 */
const laufend = new Map<string, Promise<unknown>>();

export async function syncMailbox(tenantId: string, mailboxId: string, o: { schnell?: boolean } = {}): Promise<{ new: number }> {
  // Nie zwei Abrufe desselben Postfachs gleichzeitig (sonst doppelte Einträge): der schnelle setzt aus, der volle wartet.
  const vorher = laufend.get(mailboxId);
  if (vorher && o.schnell) return { new: 0 };
  const lauf = (vorher ?? Promise.resolve()).catch(() => null).then(() => abrufen(tenantId, mailboxId, o));
  laufend.set(mailboxId, lauf);
  try {
    return await lauf;
  } finally {
    if (laufend.get(mailboxId) === lauf) laufend.delete(mailboxId);
  }
}

async function abrufen(tenantId: string, mailboxId: string, o: { schnell?: boolean }): Promise<{ new: number }> {
  const [mb] = await db.select().from(schema.mailboxes).where(and(eq(schema.mailboxes.id, mailboxId), eq(schema.mailboxes.tenantId, tenantId)));
  if (!mb || mb.provider === "upload" || !mb.active) return { new: 0 };
  const since = o.schnell ? new Date(Date.now() - 2 * 3600_000) : mb.lastSyncAt ? new Date(mb.lastSyncAt.getTime() - 3600_000) : new Date(Date.now() - 14 * 86400_000);
  let count = 0;
  const { gesehenMerken, unbekannt } = await import("./persoenlich");
  try {
    const creds = await mailboxCredentials(mb);
    const settings = await getSettings(tenantId);
    // Deal-Postfach (Einstellung Deal-Eingang): alle Absender abrufen, nicht nur Marktplätze.
    const dealAdresse = settings.dealEingang.mailAdresse?.trim().toLowerCase();
    const gesendet = settings.posteingang.ausgangMitlesen !== false;
    // B32: alle Absender – aber nur, was neu ist; Newsletter (Listen-Kopf) gar nicht erst laden.
    const vorfilter = async (k: ImapKopf[]) => {
      const neu = await unbekannt(tenantId, k.map((x) => x.messageId ?? "").filter(Boolean));
      return Promise.all(
        k.map(async (x) => {
          if (x.messageId && !neu.has(x.messageId)) return false;
          const massen = Boolean(x.kopf.listUnsubscribe || x.kopf.listId || /^(bulk|list|junk)$/i.test(x.kopf.precedence ?? ""));
          if (massen && !x.markt && !x.gesendet && !TERMIN_BETREFF.test(x.subject)) {
            if (x.messageId) await gesehenMerken(tenantId, x.messageId, "massen");
            return false;
          }
          return true;
        }),
      );
    };
    const mails =
      creds.kind === "gmail"
        ? await Promise.all((await gmailFetchRaw(creds.accessToken, Math.floor(since.getTime() / 1000), 150, async (ids) => new Set([...(await unbekannt(tenantId, ids.map((id) => `p:${id}`)))].map((k) => k.slice(2))))).map((r) => parseRaw(r.raw, r.id, r.gesendet ? "Gesendet (Gmail)" : "Alle Nachrichten (Gmail)")))
        : creds.kind === "outlook"
          ? (await graphFetch(creds.accessToken, since)).map(fromGraph)
          : await Promise.all(
              (await imapFetchRaw(creds.account, since, { ordner: mb.ordner, alleAbsender: Boolean(dealAdresse) && mb.address.trim().toLowerCase() === dealAdresse, gesendet, nurPosteingang: o.schnell, vorfilter })).map((r) => parseRaw(r.raw, r.id, r.ordner)),
            );
    for (const m of mails) {
      const r = await ingestMail(tenantId, mb.id, m);
      if (r === "new") count++;
      await gesehenMerken(tenantId, m.messageKey, r);
      if (m.providerMessageId && creds.kind === "gmail") await gesehenMerken(tenantId, `p:${m.providerMessageId}`, r);
    }
    if (!o.schnell) await db.update(schema.mailboxes).set({ lastSyncAt: new Date(), lastError: null, fehlerArt: null, updatedAt: new Date() }).where(eq(schema.mailboxes.id, mb.id));
  } catch (e) {
    await db.update(schema.mailboxes).set({ lastError: e instanceof Error ? e.message : String(e), fehlerArt: e instanceof MailFehler ? e.art : "sonst", updatedAt: new Date() }).where(eq(schema.mailboxes.id, mb.id));
    throw e;
  }
  return { new: count };
}

/** Schneller Abruf (jede Minute): nur neue Mails im Posteingang – damit persönliche Mails in ≤ 2 Min. gemeldet werden. */
export async function syncSchnell(tenantId: string) {
  const boxes = await db.select({ id: schema.mailboxes.id, provider: schema.mailboxes.provider, lastSyncAt: schema.mailboxes.lastSyncAt }).from(schema.mailboxes).where(and(eq(schema.mailboxes.tenantId, tenantId), eq(schema.mailboxes.active, true)));
  let neu = 0;
  for (const b of boxes) {
    // Erst nach dem ersten vollen Abruf (sonst holt der volle Abruf die letzten 14 Tage).
    if (b.provider === "upload" || b.provider === "outlook" || !b.lastSyncAt) continue;
    neu += (await syncMailbox(tenantId, b.id, { schnell: true }).catch(() => ({ new: 0 }))).new;
  }
  return neu;
}

export async function syncAllMailboxes(tenantId: string) {
  const boxes = await db.select().from(schema.mailboxes).where(and(eq(schema.mailboxes.tenantId, tenantId), eq(schema.mailboxes.active, true)));
  const results: { address: string; new?: number; error?: string }[] = [];
  for (const b of boxes) {
    if (b.provider === "upload") continue;
    try {
      results.push({ address: b.address, ...(await syncMailbox(tenantId, b.id)) });
    } catch (e) {
      results.push({ address: b.address, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
