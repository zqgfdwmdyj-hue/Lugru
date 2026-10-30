import "server-only";
import { and, asc, desc, eq, ilike, inArray, lte, notInArray, or, sql } from "drizzle-orm";
import { LOGISTIK_KATEGORIEN } from "@/lib/amazon-todos/versand";
import { mailVorschlag } from "@/lib/inbox/classify";
import { z } from "zod";
import { db, schema } from "@/db";
import { addDaysIso } from "@/lib/dates";
import { needsReview } from "@/lib/invoices/review";
import { daysLeft } from "@/lib/stock/discrepancies";
import { anleitungText, normTypen } from "@/lib/knowledge/anleitung";
import { wissenSichtbar } from "@/lib/knowledge/sichtbar";
import { ERKENNTNIS_TEXT, wissenPruefen } from "@/lib/calls/logic";
import { todayIso } from "@/lib/dates";
import { defineTool } from "../types";
import { abs, berlinDateTime, json, likeOf, round2 } from "./common";

export const rechnungenOffen = defineTool({
  name: "rechnungen_offen",
  title: "Rechnungen zu prüfen",
  description: "Eingangsrechnungen, die noch geprüft oder zugeordnet werden müssen (neu, „prüfen“ oder mit offener Prüfung) – Lieferant, Nummer, Datum, Betrag. Optional nach Lieferant/Nummer filtern.",
  area: "buchhaltung",
  write: false,
  quelle: { text: "Rechnungen (Upload, Google Drive, Postfächer)", jobs: ["Rechnungen", "Postfächer"] },
  input: z.object({ suche: z.string().trim().max(80).optional(), limit: z.number().int().min(1).max(100).default(30) }),
  run: async (ctx, i) => {
    const R = schema.invoices;
    const where = [eq(R.tenantId, ctx.session.tenantId), needsReview];
    if (i.suche) where.push(or(ilike(R.vendor, likeOf(i.suche)), ilike(R.invoiceNumber, likeOf(i.suche)), ilike(R.fileName, likeOf(i.suche)))!);
    const [rows, [{ n }]] = await Promise.all([
      db.select().from(R).where(and(...where)).orderBy(desc(R.invoiceDate)).limit(i.limit),
      db.select({ n: sql<number>`count(*)::int` }).from(R).where(and(...where)),
    ]);
    return json({ anzahl: n, rechnungen: rows.map((r) => ({ id: r.id, lieferant: r.vendor, nummer: r.invoiceNumber, datum: r.invoiceDate, brutto: round2(r.totalGross), netto: round2(r.totalNet), art: r.kind, status: r.status, datei: r.fileName })), link: abs(ctx, "/rechnungen") });
  },
});

export const ansprueche = defineTool({
  name: "ansprueche",
  title: "Amazon-Ansprüche",
  description: "Offene Erstattungsansprüche gegenüber Amazon (verloren, beschädigt, Retouren …) mit erwartetem Betrag, sortiert nach Frist (früheste zuerst, ohne Frist am Ende) und Tagen bis zur Frist. Für „Wie viel Geld steht bei Amazon noch aus?“, „Welche Fristen laufen ab?“ – mit frist_in_tagen nur die bald fälligen.",
  area: "amazon",
  write: false,
  quelle: { text: "Ansprüche aus Amazon-Berichten", jobs: ["Ansprüche", "Amazon-Reports abholen"], importe: true },
  input: z.object({
    status: z.enum(["offen", "eingereicht", "alle_offenen"]).default("alle_offenen"),
    frist_in_tagen: z.number().int().min(0).max(365).optional().describe("Nur Ansprüche, deren Frist in höchstens so vielen Tagen abläuft (auch schon abgelaufene)"),
    limit: z.number().int().min(1).max(100).default(40),
  }),
  run: async (ctx, i) => {
    const C = schema.claims;
    const statuses = i.status === "offen" ? ["detected", "queued"] : i.status === "eingereicht" ? ["submitted"] : ["detected", "queued", "submitted"];
    const where = and(eq(C.tenantId, ctx.session.tenantId), inArray(C.status, statuses as (typeof C.$inferSelect.status)[]), i.frist_in_tagen !== undefined ? lte(C.deadline, addDaysIso(ctx.today, i.frist_in_tagen)) : undefined);
    const [rows, [sum]] = await Promise.all([
      db.select().from(C).where(where).orderBy(sql`${C.deadline} asc nulls last`).limit(i.limit),
      db.select({ n: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${C.expectedAmount}),0)::float` }).from(C).where(where),
    ]);
    return json({
      anzahl: sum.n,
      erwartet_gesamt: round2(sum.total),
      sortierung: "nach Frist, früheste zuerst",
      ansprueche: rows.map((c) => {
        const d = daysLeft(ctx.today, c.deadline);
        return { id: c.id, titel: c.title, art: c.type, status: c.status, sku: c.sku, menge: c.quantity, erwartet: round2(c.expectedAmount), frist: c.deadline, tage_bis_frist: d ?? undefined, frist_abgelaufen: d !== null && d < 0 ? true : undefined, amazon_fall: c.amazonCaseId, link: abs(ctx, `/ansprueche/${c.id}`) };
      }),
      link: abs(ctx, "/ansprueche"),
    });
  },
});

export const amazonTodos = defineTool({
  name: "amazon_todos",
  title: "Amazon-ToDos",
  description: "Offene ToDos aus Amazon-Systemmails (Kontozustand, Angebote gesperrt, Dokumente angefordert …) mit Priorität und Frist – die einzelnen Aufforderungen. Zusammengefasst als Vorgang mit Verlauf und Paket: amazon_faelle.",
  area: "amazon",
  ownerOnly: true,
  write: false,
  quelle: { text: "Amazon-ToDos aus Seller-Central-Mails", jobs: ["Amazon-ToDos"] },
  input: z.object({
    kategorie: z.string().trim().max(40).optional().describe("Nur diese Kategorie, z. B. logistik_info, versand_ueberfaellig, compliance_epr; „alle“ = auch Logistik-Infos. Standard: alles außer Logistik-Infos"),
    limit: z.number().int().min(1).max(100).default(30),
  }),
  run: async (ctx, i) => {
    const A = schema.amazonTodos;
    const t = ctx.session.tenantId;
    const where = [eq(A.tenantId, t), eq(A.status, "open")];
    if (i.kategorie && i.kategorie !== "alle") where.push(eq(A.category, i.kategorie));
    else if (!i.kategorie) where.push(notInArray(A.category, [...LOGISTIK_KATEGORIEN]));
    const rows = await db
      .select()
      .from(A)
      .where(and(...where))
      // Compliance/Konto vor Versand-Sammel-ToDos vor Logistik; dann Priorität und Frist
      .orderBy(sql`case when ${A.category} in ('logistik_info') then 2 when ${A.category} in ('versand_ueberfaellig', 'import_luecke') then 1 else 0 end`, sql`case ${A.priority} when 'high' then 0 when 'medium' then 1 else 2 end`, sql`${A.deadline} asc nulls last`)
      .limit(i.limit);
    const [ausgeblendet] = i.kategorie ? [undefined] : await db.select({ n: sql<number>`count(*)::int` }).from(A).where(and(eq(A.tenantId, t), eq(A.status, "open"), inArray(A.category, [...LOGISTIK_KATEGORIEN])));
    const nummern = [...new Set(rows.flatMap((x) => x.bestellnummern))];
    const O = schema.orders;
    const auftraege = new Map(nummern.length ? (await db.select({ id: O.id, ext: O.externalId, status: O.status }).from(O).where(and(eq(O.tenantId, t), inArray(O.externalId, nummern)))).map((o) => [o.ext, o] as const) : []);
    return json({
      anzahl: rows.length,
      sortierung: "Compliance/Konto zuerst, dann Versand-Sammel-ToDos, dann Logistik; je Gruppe Priorität und Frist",
      logistik_ausgeblendet: ausgeblendet?.n || undefined,
      todos: rows.map((x) => ({
        id: x.id,
        betreff: x.subject,
        kategorie: x.category,
        prioritaet: x.priority,
        frist: x.deadline,
        zusammenfassung: x.summary,
        asins: x.asins,
        skus: x.skus.length ? x.skus : undefined,
        bestellungen: x.bestellnummern.length ? x.bestellnummern.slice(0, 50).map((n) => { const o = auftraege.get(n); return o ? { bestellnummer: n, status: o.status, link: abs(ctx, `/auftraege/${o.id}`) } : { bestellnummer: n, status: "fehlt im Tool" }; }) : undefined,
        marktplatz: x.marktplatz ?? undefined,
        kontozustand: x.link ?? undefined,
        eingegangen: berlinDateTime(x.receivedAt),
      })),
      hinweis: "Bestell-Mails („Verkauft, jetzt liefern“) sind keine ToDos: Sie folgen dem Auftrag und werden nach dem Versand archiviert. Überfällige FBM-Aufträge und Bestellungen, die im Tool fehlen, stehen gebündelt in je einem ToDo.",
      link: abs(ctx, "/amazon-todos"),
    });
  },
});

export const posteingang = defineTool({
  name: "posteingang",
  title: "Posteingang",
  description:
    "Neueste Mails aus den verbundenen Postfächern (nicht archiviert) mit Absender, Empfangsadresse (an), Ordner/Label, Betreff, Einstufung, Vorschau und `vorschlag` (archivieren/aufgabe/weiterleiten/antworten) – optional nur wichtige oder nach Text gefiltert. Newsletter und Versand-/Lieferbestätigungen werden beim Eingang archiviert; Termin-Mails (Arzt, Handwerker, Amt, Schule) gehen nicht in den Posteingang, sondern in den Privatkalender (mit Privat-Freigabe als `termin_mails` gezählt).",
  area: "posteingang",
  write: false,
  quelle: { text: "Verbundene Postfächer", jobs: ["Postfächer"] },
  input: z.object({ nur_wichtige: z.boolean().default(false), suche: z.string().trim().max(80).optional(), limit: z.number().int().min(1).max(50).default(20) }),
  run: async (ctx, i) => {
    const M = schema.emails;
    const R = schema.mailRegeln;
    const where = [eq(M.tenantId, ctx.session.tenantId), eq(M.archived, false)];
    if (i.nur_wichtige) where.push(eq(M.category, "critical"));
    if (i.suche) where.push(or(ilike(M.subject, likeOf(i.suche)), ilike(M.fromAddress, likeOf(i.suche)), ilike(M.fromName, likeOf(i.suche)))!);
    const rows = await db.select({ m: M, regelAktion: R.aktion }).from(M).leftJoin(R, and(eq(R.id, M.regelId), eq(R.tenantId, ctx.session.tenantId))).where(and(...where)).orderBy(desc(M.receivedAt)).limit(i.limit);
    // Termin-Mails liegen im Privatkalender – nur mit Privat-Freigabe (Claude des Inhabers) als Zahl, ohne Inhalte.
    const termine = ctx.privat ? await (await import("@/lib/private/termin-mail-service")).terminMailsZuletzt(ctx.session).catch(() => null) : null;
    return json({
      mails: rows.map(({ m, regelAktion }) => ({
        id: m.id,
        von: m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress,
        an: m.an ?? undefined,
        ordner: m.ordner ?? undefined,
        betreff: m.subject,
        eingegangen: berlinDateTime(m.receivedAt),
        einstufung: m.category,
        thema: m.topic,
        vorschlag: mailVorschlag({ category: m.category, topic: m.topic, archived: m.archived, taskId: m.taskId, regelAktion }),
        aufgabe_angelegt: Boolean(m.taskId),
        link: abs(ctx, `/posteingang/${m.id}`),
        vorschau: m.snippet?.slice(0, 300),
      })),
      ...(termine ? { termin_mails: { letzte_7_tage: termine.anzahl, hinweis: "In den Privatkalender übernommen (Bestätigung, Verschiebung, Absage) – Details mit privat_kalender." } } : {}),
      link: abs(ctx, "/posteingang"),
    });
  },
});

export const wissen = defineTool({
  name: "wissen",
  title: "Wissen durchsuchen",
  description:
    "Durchsucht die Wissenssammlung (Anleitungen, Notizen, Textbausteine, Recherche und das von der KI aus den Calls gezogene Insider-Wissen der Deal-Gruppe und des Consultants) nach Titel, Inhalt und Stichworten. Für „Wie mache ich …?“, „Was hatten wir zu … notiert?“, „Was wurde in den Calls zu … gesagt?“. Mit herkunft „call“ nur Wissen aus Calls, „chat“ nur aus den Gruppen-Chats (Discord-Kanäle der Deal-Gruppe); Details mit „calls_durchsuchen“.",
  area: "wissen",
  write: false,
  quelle: { text: "Wissensdatenbank im Seller-System (Einträge aus Calls: KI-Auszug, ungeprüft, mit Quelle)" },
  input: z.object({
    suche: z.string().trim().min(2).max(100),
    herkunft: z.enum(["call", "chat", "anleitung", "notiz", "recherche"]).optional().describe("nur Einträge dieser Herkunft (call = aus Calls, chat = aus Gruppen-Chats gezogen)"),
    limit: z.number().int().min(1).max(20).default(8),
  }),
  run: async (ctx, i) => {
    const K = schema.knowledgeEntries;
    const like = likeOf(i.suche);
    const doc = sql`to_tsvector('german', ${K.title} || ' ' || ${K.body})`;
    const rows = await db
      .select()
      .from(K)
      .where(
        and(
          eq(K.tenantId, ctx.session.tenantId),
          wissenSichtbar(ctx.session),
          i.herkunft ? eq(K.origin, i.herkunft) : undefined,
          or(sql`${doc} @@ websearch_to_tsquery('german', ${i.suche})`, ilike(K.title, like), ilike(K.body, like), sql`exists (select 1 from unnest(${K.tags}) tg where tg ilike ${like})`),
        ),
      )
      .orderBy(desc(sql`ts_rank(${doc}, websearch_to_tsquery('german', ${i.suche}))`), asc(K.title))
      .limit(i.limit);
    const heute = todayIso();
    return json({
      eintraege: rows.map((k) => ({
        id: k.id,
        titel: k.title,
        kategorie: k.category,
        art: k.kind,
        herkunft: k.origin === "call" ? "call – aus einem Call (KI-Auszug, ungeprüft)" : k.origin === "chat" ? "chat – aus dem Gruppen-Chat (KI-Auszug, ungeprüft)" : k.origin,
        geprueft: k.verifiedAt ? true : undefined,
        insider: k.insider ? "Insider – nicht weitergeben: nur für Ludwig, nie in Texten nach außen (Deal-Blätter, Kundenmails, B2B-Kanal)" : undefined,
        erkenntnis: k.erkenntnis ? ERKENNTNIS_TEXT[k.erkenntnis] : undefined,
        gesagt_von: k.quelleWer ?? undefined,
        call_datum: k.quelleDatum ?? undefined,
        pruefen: wissenPruefen(k.quelleDatum, k.verifiedAt, heute) ? "älter als 6 Monate – kann veraltet sein, prüfen" : undefined,
        stichworte: k.tags,
        text: k.body.slice(0, 2500),
        stelle_im_call: k.callId ? abs(ctx, k.callStelle !== null ? `/calls/${k.callId}?stelle=${k.callStelle}#stelle` : `/calls/${k.callId}`) : undefined,
        link: abs(ctx, `/wissen/${k.id}`),
      })),
      hinweis: rows.some((k) => k.origin === "call") ? "Einträge aus Calls sind KI-Auszüge: mit Datum zitieren („laut Wochen-Call vom …“); wörtlich nachlesen mit „calls_durchsuchen“ oder über stelle_im_call." : undefined,
      link: abs(ctx, "/wissen"),
    });
  },
});

export const wissenAnlegen = defineTool({
  name: "wissen_anlegen",
  title: "Notiz oder Anleitung ins Wissen",
  description:
    "Legt eine Notiz in der Wissenssammlung an (z. B. Ablauf, Kontakt, Absprache), damit alle mit Zugriff sie finden. Mit kategorie „Anleitung“ entsteht eine Schritt-für-Schritt-Anleitung (SOP) mit Zweck, wann, wer, Schritten, Zugängen, häufigen Fehlern und Aufgabentypen – sie gilt als ungeprüft, bis Ludwig sie prüft.",
  area: "wissen",
  write: true,
  input: z.object({
    titel: z.string().trim().min(1).max(200),
    text: z.string().trim().max(20000).default(""),
    kategorie: z.string().trim().min(1).max(60).default("Notizen"),
    stichworte: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
    zweck: z.string().trim().max(1000).optional().describe("Nur Anleitung: wozu"),
    wann: z.string().trim().max(500).optional().describe("Nur Anleitung: wann/auslöser"),
    wer: z.string().trim().max(200).optional().describe("Nur Anleitung: zuständig (Name oder Rolle)"),
    schritte: z.array(z.string().trim().min(1).max(500)).max(60).optional().describe("Nur Anleitung: Schritte in Reihenfolge"),
    zugaenge: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
    haeufige_fehler: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
    aufgabentypen: z.array(z.string().trim().min(1).max(80)).max(20).optional().describe("„kategorie:amazon“, „schluessel:remission“ oder Stichwort im Aufgabentitel"),
  }),
  summary: (i) => `Wissen: „${i.titel}“`,
  run: async (ctx, i) => {
    const K = schema.knowledgeEntries;
    const istAnleitung = /^anleitung/i.test(i.kategorie) || (i.schritte?.length ?? 0) > 0;
    if (!istAnleitung) {
      if (!i.text) return json({ ok: false, meldung: "Text fehlt." });
      const [row] = await db.insert(K).values({ tenantId: ctx.session.tenantId, kind: "article", category: i.kategorie, title: i.titel, body: i.text, tags: i.stichworte, origin: "notiz", updatedBy: ctx.session.userId }).returning({ id: K.id });
      return json({ ok: true, meldung: "Notiz gespeichert.", id: row.id, link: abs(ctx, `/wissen/${row.id}`) });
    }
    if (!i.schritte?.length) return json({ ok: false, meldung: "Eine Anleitung braucht mindestens einen Schritt (schritte)." });
    const anleitung = { zweck: i.zweck ?? "", wann: i.wann ?? "", wer: i.wer ?? "", schritte: i.schritte, zugaenge: i.zugaenge ?? [], fehler: i.haeufige_fehler ?? [], aufgabenTypen: normTypen(i.aufgabentypen ?? []) };
    const body = [anleitungText(anleitung), i.text ? `Ergänzungen:\n${i.text}` : ""].filter(Boolean).join("\n\n");
    const [row] = await db.insert(K).values({ tenantId: ctx.session.tenantId, kind: "anleitung", category: "Anleitungen", title: i.titel, body, tags: i.stichworte, origin: "anleitung", anleitung, updatedBy: ctx.session.userId }).returning({ id: K.id });
    return json({ ok: true, meldung: "Anleitung gespeichert – ungeprüft, bis Ludwig sie prüft (Aufgabe „Anleitungen prüfen“).", id: row.id, link: abs(ctx, `/wissen/${row.id}`) });
  },
});

export const BUERO = [rechnungenOffen, ansprueche, amazonTodos, posteingang, wissen, wissenAnlegen];
