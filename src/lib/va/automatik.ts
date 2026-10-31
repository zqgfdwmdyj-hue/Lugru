import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, ne, notExists, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { markiereEingereicht } from "@/lib/claims/eingereicht";
import { claimCaseText } from "@/lib/claims/texts";
import { getSettings, type ResolvedSettings } from "@/lib/settings";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { todayIso } from "@/lib/dates";
import * as A from "./automatik-logic";
import { discord, type DcDatei, type DcNachricht } from "./discord";
import { echterFall } from "@/lib/amazon-faelle/logic";
import * as L from "./logic";
import { datum } from "./sprache";
import { uebersetzen } from "./uebersetzen";
import { alsDeutsch, anhaengeSpeichern, anleitungEnglisch, dateiZeilen, rechnungenFuer, rueckfrage, schonDa, vaKonfig, vaZustaendigSetzen, type Ctx, type ThreadRow } from "./service";

// VA-Automatik (B18): Ansprüche automatisch an die VA (eigener Thread mit Paket, Erinnerungen 7/3/1 Tage vor der
// Frist um 09:00 VA-Zeit, am Fristtag Info an Ludwig, abgelaufen → Liste an Ludwig), Fälle der Fall-Zentrale je
// Kategorie (an die VA / erst Ludwig / nie; Betrag über der Schwelle erst Ludwig), höchstens N neue Threads am Tag
// (darüber Sammel-Thread), Fallnummer in der Antwort → „eingereicht“, „Daily overview“ an Arbeitstagen.
// Modus „Vorschlag“: nichts geht von selbst an die VA – Ludwig sieht, was gegangen wäre.

const VT = schema.vaThreads;
const VN = schema.vaNachrichten;
const VA = schema.vaAutomatik;
const C = schema.claims;
const CE = schema.claimEvents;
const T = schema.tasks;

type Auto = ResolvedSettings["va"]["automatik"];
type SammelCtx = Pick<Ctx, "t" | "cfg" | "dc" | "heute" | "ruhe" | "jetzt"> & { zeitzone: string };
const OFFEN = ["detected", "queued"] as const;
const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
const euro = (n: number | null) => (n === null ? "–" : `${n.toFixed(2).replace(".", ",")} €`);

async function inhaber(tenantId: string): Promise<string[]> {
  const M = schema.memberships;
  return (await db.select({ userId: M.userId }).from(M).where(and(eq(M.tenantId, tenantId), eq(M.role, "owner")))).map((x) => x.userId);
}

async function ludwigMelden(tenantId: string, m: { titel: string; text: string; link: string }) {
  const { melden } = await import("@/lib/push/service");
  await melden(tenantId, await inhaber(tenantId), m).catch(() => null);
}

/** Neue Threads der Automatik seit Tagesbeginn (VA-Zeit) – für die Tagesgrenze. */
async function autoThreadsHeute(tenantId: string, beginn: Date): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(VT)
    .where(and(eq(VT.tenantId, tenantId), eq(VT.auto, true), inArray(VT.art, ["aufgabe", "anspruch"]), gte(VT.createdAt, beginn)));
  return r?.n ?? 0;
}

const en = async (t: string, text: string) => (await uebersetzen(t, text, "en", { quelle: "de" })).text;

// ---- Anspruch → Thread ------------------------------------------------------------------------------------

/** Anleitung „File reimbursement claim“ aus dem Wissen (englische Fassung), sonst die Standard-Anleitung. */
async function anspruchAnleitung(tenantId: string) {
  const K = schema.knowledgeEntries;
  const [a] = await db
    .select({ id: K.id, title: K.title, anleitung: K.anleitung, titleEn: K.titleEn, anleitungEn: K.anleitungEn, freigegeben: K.anleitungEnFreigegeben })
    .from(K)
    .where(and(eq(K.tenantId, tenantId), eq(K.kind, "anleitung"), isNotNull(K.anleitung), or(ilike(K.titleEn, "%reimbursement claim%"), ilike(K.title, "%reimbursement claim%"), ilike(K.title, "%erstattungsanspruch%"), ilike(K.title, "%anspruch einreichen%"))))
    .orderBy(desc(K.anleitungEnFreigegeben))
    .limit(1);
  return a ? await anleitungEnglisch(tenantId, a) : A.ANLEITUNG_ANSPRUCH_STANDARD;
}

type ClaimRow = typeof C.$inferSelect;

/** Inhalt für die VA (Englisch): Titel, Belege, Falltext, Rechnungen als Anhang (nur wenn erlaubt). */
async function anspruchPaket(tenantId: string, cl: ClaimRow, darfRechnungen: boolean) {
  const titel = await en(tenantId, cl.title);
  const evidenz = cl.evidence.map((e) => `${e.label}: ${e.value}`);
  let belege = evidenz;
  if (evidenz.length) {
    const tr = (await en(tenantId, evidenz.join("\n"))).split("\n");
    if (tr.length === evidenz.length) belege = tr;
  }
  const dateien: DcDatei[] = [];
  if (darfRechnungen && (cl.asin || cl.sku)) {
    const r = await rechnungenFuer(tenantId, { asin: cl.asin, sku: cl.sku, marke: null, lieferant: null }).catch(() => null);
    const mitDatei = (r?.liste ?? []).filter((x) => x.fileId).slice(0, 3);
    for (const x of (r?.liste ?? []).slice(0, 5)) belege.push(`Invoice ${x.invoiceNumber ?? "–"} from ${x.vendor ?? "supplier unknown"}${x.invoiceDate ? ` (${datum(x.invoiceDate, "en")})` : ""}`);
    if (mitDatei.length) {
      const f = await db.select({ name: schema.files.name, typ: schema.files.mimeType, size: schema.files.size, data: schema.files.data }).from(schema.files).where(and(eq(schema.files.tenantId, tenantId), inArray(schema.files.id, mitDatei.map((x) => x.fileId!))));
      dateien.push(...f.filter((x) => x.size <= 8 * 1024 * 1024).map((x) => ({ name: x.name, typ: x.typ, daten: Buffer.from(x.data) })));
    }
  }
  // Falltext (Deutsch aus den Regeln) auf Englisch; EK nur, wenn die VA Einkaufsrechnungen sehen darf.
  const falltextDe = claimCaseText({ type: cl.type, sku: cl.sku, fnsku: cl.fnsku, asin: cl.asin, quantity: cl.quantity, unitCost: darfRechnungen ? num(cl.unitCost) : null, reference: cl.reference, eventDate: cl.eventDate, evidence: cl.evidence });
  const falltext = await en(tenantId, falltextDe);
  return { titel, belege, dateien, falltext };
}

export type AnspruchAnVa = { ok: true; threadId: string; neu: boolean } | { ok: false; fehler: string };

/** Anspruch als eigener Thread an die VA (Automatik oder Knopf „An die VA“). Status „detected“ → „vorgemerkt“. */
export async function anspruchAnVa(tenantId: string, claimId: string, o: { auto?: boolean; userId?: string | null; jetzt?: Date } = {}): Promise<AnspruchAnVa> {
  const cfg = await vaKonfig(tenantId);
  if (!cfg) return { ok: false, fehler: "Discord – VA-Kanal ist nicht eingerichtet (Einstellungen → Anbindungen)." };
  const [cl] = await db.select().from(C).where(and(eq(C.tenantId, tenantId), eq(C.id, claimId)));
  if (!cl) return { ok: false, fehler: "Anspruch nicht gefunden." };
  if (!(OFFEN as readonly string[]).includes(cl.status)) return { ok: false, fehler: "Der Anspruch ist schon eingereicht oder abgeschlossen." };
  const [alt] = await db.select().from(VT).where(and(eq(VT.tenantId, tenantId), eq(VT.claimId, claimId), ne(VT.status, "erledigt"))).limit(1);
  if (alt) return { ok: true, threadId: alt.threadId, neu: false };
  const s = (await getSettings(tenantId)).va;
  const jetzt = o.jetzt ?? new Date();
  const lok = L.lokal(jetzt, s.zeitzone);
  const ruhe = L.inRuhezeit(lok.zeit, s.ruheVon, s.ruheBis);
  const p = await anspruchPaket(tenantId, cl, s.darfEinkaufsrechnungen);
  const text = A.anspruchText({
    titel: p.titel,
    typ: cl.type,
    sku: cl.sku,
    asin: cl.asin,
    fnsku: cl.fnsku,
    ...A.bezugAus(cl.reference),
    menge: cl.quantity,
    betrag: num(cl.expectedAmount),
    frist: cl.deadline,
    heute: lok.datum,
    belege: p.belege,
    anhaenge: p.dateien.map((d) => d.name),
    falltext: p.falltext,
    anleitung: await anspruchAnleitung(tenantId),
    vaId: cfg.vaDiscordId,
  });
  const dc = discord(cfg.botToken);
  const thread = await dc.threadAnlegen(cfg.kanalId, L.threadName(`Claim: ${p.titel}`));
  const start = await dc.senden(thread.id, text, { erwaehnen: cfg.vaDiscordId, still: ruhe, dateien: p.dateien });
  await db.insert(VT).values({ tenantId, art: "anspruch", claimId, threadId: thread.id, startNachrichtId: start, cursor: start, status: "offen", auto: Boolean(o.auto) });
  await db.insert(VN).values({ tenantId, discordId: start, kanalId: thread.id, threadId: thread.id, von: "bot", text: text.slice(0, 4000), art: "aufgabe", gesendetAm: new Date() }).onConflictDoNothing();
  if (cl.status === "detected") await db.update(C).set({ status: "queued", updatedAt: new Date() }).where(and(eq(C.tenantId, tenantId), eq(C.id, claimId)));
  await db.insert(CE).values({ tenantId, claimId, userId: o.userId ?? null, action: `an die VA (Discord-Thread${o.auto ? ", automatisch" : ""})` });
  if (o.userId) await db.update(VA).set({ status: "uebernommen", threadId: thread.id }).where(and(eq(VA.tenantId, tenantId), eq(VA.schluessel, `anspruch:${claimId}`), inArray(VA.status, ["ludwig", "vorschlag"])));
  return { ok: true, threadId: thread.id, neu: true };
}

// ---- Sammel-Thread ------------------------------------------------------------------------------------------

/** Eintrag in den Sammel-Thread des Tages (über der Tagesgrenze). Liefert Thread und Nummer. */
async function inSammel(c: SammelCtx, max: number, e: { typ: "anspruch" | "fall"; id: string; taskId: string | null; titel: string; frist: string | null; zeilen: string[]; kennungen: string[]; dateien?: DcDatei[] }): Promise<{ threadId: string; nr: number }> {
  const beginn = A.tagesbeginn(c.jetzt, c.zeitzone);
  let [th] = await db.select().from(VT).where(and(eq(VT.tenantId, c.t), eq(VT.art, "sammel"), gte(VT.createdAt, beginn))).orderBy(desc(VT.createdAt)).limit(1);
  if (!th) {
    const thread = await c.dc.threadAnlegen(c.cfg.kanalId, L.threadName(`More tasks – ${datum(c.heute, "en")}`));
    const start = await c.dc.senden(thread.id, A.sammelKopf(c.heute, max), { erwaehnen: c.cfg.vaDiscordId, still: c.ruhe });
    [th] = await db.insert(VT).values({ tenantId: c.t, art: "sammel", threadId: thread.id, startNachrichtId: start, cursor: start, status: "offen" }).returning();
  }
  // Atomar anhängen (Fall-Zentrale und VA-Abgleich können gleichzeitig schreiben).
  const eintrag = { typ: e.typ, id: e.id, taskId: e.taskId, titel: e.titel.slice(0, 200), kennungen: e.kennungen.filter(Boolean).slice(0, 8), erledigt: false };
  const [r] = await db
    .update(VT)
    .set({ eintraege: sql`${VT.eintraege} || jsonb_build_array(${JSON.stringify(eintrag)}::jsonb || jsonb_build_object('nr', jsonb_array_length(${VT.eintraege}) + 1))`, status: "offen", erledigtAm: null })
    .where(eq(VT.id, th.id))
    .returning({ n: sql<number>`jsonb_array_length(${VT.eintraege})` });
  const nr = r?.n ?? th.eintraege.length + 1;
  await c.dc.senden(th.threadId, A.sammelEintragText(nr, { art: e.typ, titel: e.titel, frist: e.frist, zeilen: e.zeilen }), { still: true, dateien: e.dateien });
  return { threadId: th.threadId, nr };
}

// ---- Entscheidungen ---------------------------------------------------------------------------------------

/** Neue Ansprüche verteilen: Regel → Thread, Sammel-Thread, Vorschlag, „erst Ludwig“ oder nie. */
async function anspruecheVerteilen(c: Ctx, a: Auto) {
  if (a.modus === "aus") return;
  const seit = a.modus === "automatisch" && a.seit ? new Date(a.seit) : new Date(c.jetzt.getTime() - 2 * 86_400_000);
  const kandidaten = await db
    .select()
    .from(C)
    .where(
      and(
        eq(C.tenantId, c.t),
        inArray(C.status, [...OFFEN]),
        gte(C.createdAt, seit),
        // Abgelaufene Ansprüche gehen nie an die VA (Liste „über der Frist“ bei Ludwig).
        or(isNull(C.deadline), gte(C.deadline, c.heute)),
        notExists(db.select({ x: VA.id }).from(VA).where(and(eq(VA.tenantId, c.t), eq(VA.schluessel, sql`'anspruch:' || ${C.id}::text`)))),
        notExists(db.select({ x: VT.id }).from(VT).where(and(eq(VT.tenantId, c.t), eq(VT.claimId, C.id)))),
      ),
    )
    .orderBy(sql`${C.deadline} asc nulls last`, desc(C.priority))
    .limit(60);
  if (!kandidaten.length) return;
  const beginn = A.tagesbeginn(c.jetzt, c.s.zeitzone);
  let heute = await autoThreadsHeute(c.t, beginn);
  for (const cl of kandidaten) {
    const betrag = num(cl.expectedAmount);
    const e = A.vaEntscheidung({ kategorie: "anspruch", betrag, regeln: a.regeln, schwelle: a.schwelle });
    const basis = { tenantId: c.t, schluessel: `anspruch:${cl.id}`, typ: "anspruch" as const, bezugId: cl.id, kategorie: "anspruch", ziel: e.ziel, grund: e.grund, modus: a.modus === "automatisch" ? ("automatisch" as const) : ("vorschlag" as const), titel: cl.title.slice(0, 300), betrag, frist: cl.deadline };
    try {
      if (e.ziel !== "va") {
        await db.insert(VA).values({ ...basis, status: e.ziel }).onConflictDoNothing();
        if (e.ziel === "ludwig") await ludwigMelden(c.t, { titel: "Anspruch erst bei dir (nicht an die VA)", text: `${cl.title} – ${euro(betrag)} · ${e.grund}`, link: `/ansprueche/${cl.id}` });
        continue;
      }
      if (a.modus !== "automatisch") {
        await db.insert(VA).values({ ...basis, status: "vorschlag" }).onConflictDoNothing();
        continue;
      }
      if (heute < a.maxThreadsTag) {
        const r = await anspruchAnVa(c.t, cl.id, { auto: true, jetzt: c.jetzt });
        await db.insert(VA).values({ ...basis, status: r.ok ? "gesendet" : "fehler", threadId: r.ok ? r.threadId : null, fehler: r.ok ? null : r.fehler }).onConflictDoNothing();
        if (r.ok && r.neu) {
          heute++;
          c.z.anVa++;
        }
        continue;
      }
      // Über der Tagesgrenze: Sammel-Thread.
      const p = await anspruchPaket(c.t, cl, c.s.darfEinkaufsrechnungen);
      const bezug = A.bezugAus(cl.reference);
      const zeilen = [
        `Type: ${A.CLAIM_TYPE_EN[cl.type] ?? cl.type}`,
        [cl.sku && `SKU: ${cl.sku}`, cl.asin && `ASIN: ${cl.asin}`, cl.fnsku && `FNSKU: ${cl.fnsku}`].filter(Boolean).join(" · "),
        [bezug.sendung && `Shipment: ${bezug.sendung}`, bezug.bestellung && `Order: ${bezug.bestellung}`, bezug.referenz && `Reference: ${bezug.referenz}`].filter(Boolean).join(" · "),
        `Quantity: ${cl.quantity}${betrag !== null ? ` · Expected amount: €${betrag.toFixed(2)}` : ""}`,
        ...p.belege.slice(0, 6).map((b) => `• ${b}`),
      ].filter(Boolean);
      const s = await inSammel({ ...c, zeitzone: c.s.zeitzone }, a.maxThreadsTag, { typ: "anspruch", id: cl.id, taskId: null, titel: p.titel, frist: cl.deadline, zeilen, kennungen: [cl.sku, cl.fnsku, cl.asin, cl.reference].filter((x): x is string => Boolean(x)), dateien: p.dateien });
      if (cl.status === "detected") await db.update(C).set({ status: "queued", updatedAt: new Date() }).where(eq(C.id, cl.id));
      await db.insert(CE).values({ tenantId: c.t, claimId: cl.id, action: `an die VA (Sammel-Thread #${s.nr}, automatisch)` });
      await db.insert(VA).values({ ...basis, status: "sammel", threadId: s.threadId }).onConflictDoNothing();
      c.z.anVa++;
    } catch (x) {
      const msg = x instanceof Error ? x.message : String(x);
      c.z.fehler.push(msg);
      await db.insert(VA).values({ ...basis, status: "fehler", fehler: msg.slice(0, 300) }).onConflictDoNothing();
    }
  }
}

type Vorgang = typeof schema.amazonVorgaenge.$inferSelect;

/**
 * Fall der Fall-Zentrale nach einer neuen Mail: Kategorie → Regel. „automatisch“ + an die VA: Paket als Thread (bzw.
 * Sammel-Thread über der Tagesgrenze); „erst Ludwig“: Meldung mit Link (dort Knopf „An die VA“); „nie“: nichts.
 * Eine Entscheidung je Vorgang, Phase und Mail-Tag.
 */
export async function fallAutomatik(tenantId: string, v: Vorgang, jetzt = new Date()): Promise<void> {
  // B19.4: nur echte Fälle – nicht Info, „Sonstiges“ oder „bitte prüfen“ (erst Ludwig sieht sie sich an).
  if (!echterFall(v)) return;
  const s = (await getSettings(tenantId)).va;
  const a = s.automatik;
  if (a.modus === "aus") return;
  const kategorie = A.fallKategorie({ bereich: v.bereich, phase: v.phase, titel: v.titel });
  const betrag = num(v.betrag);
  const e = A.vaEntscheidung({ kategorie, betrag, regeln: a.regeln, schwelle: a.schwelle });
  const automatisch = a.modus === "automatisch" && (!a.seit || v.ersteMailAm >= new Date(a.seit) || v.letzteMailAm >= new Date(a.seit));
  const status = e.ziel !== "va" ? e.ziel : automatisch ? ("gesendet" as const) : ("vorschlag" as const);
  const [neu] = await db
    .insert(VA)
    .values({ tenantId, schluessel: `fall:${v.id}:${v.phase}:${v.letzteMailAm.toISOString().slice(0, 10)}`, typ: "fall", bezugId: v.id, kategorie, ziel: e.ziel, grund: e.grund, modus: automatisch ? "automatisch" : "vorschlag", status, titel: v.titel.slice(0, 300), betrag, frist: v.frist })
    .onConflictDoNothing()
    .returning({ id: VA.id });
  if (!neu) return;
  const AV = schema.amazonVorgaenge;
  await db.update(AV).set({ zustaendig: e.ziel === "va" ? "va" : "ludwig" }).where(and(eq(AV.tenantId, tenantId), eq(AV.id, v.id)));
  // Erst Ludwig: Betrag über der Schwelle und A-bis-z melden (Marke/Konto/Entzug meldet die Fall-Zentrale selbst).
  if (e.ziel === "ludwig" && (kategorie === "a_bis_z" || (betrag !== null && betrag > a.schwelle))) {
    await ludwigMelden(tenantId, { titel: "Amazon-Fall erst bei dir (nicht an die VA)", text: `${v.titel}${betrag !== null ? ` – ${euro(betrag)}` : ""} · ${e.grund}`, link: `/amazon-faelle/${v.id}` });
  }
  if (status !== "gesendet") return;
  const fehler = async (msg: string) => db.update(VA).set({ status: "fehler", fehler: msg.slice(0, 300) }).where(eq(VA.id, neu.id));
  const cfg = await vaKonfig(tenantId);
  if (!cfg) return void (await fehler("Discord – VA-Kanal ist nicht eingerichtet."));
  const beginn = A.tagesbeginn(jetzt, s.zeitzone);
  const hatThread = v.taskId ? (await db.select({ id: VT.id }).from(VT).where(and(eq(VT.tenantId, tenantId), eq(VT.taskId, v.taskId), ne(VT.status, "erledigt"))).limit(1)).length > 0 : false;
  const { fallAnVa, fallAufgabe } = await import("@/lib/amazon-faelle/service");
  if (hatThread || (await autoThreadsHeute(tenantId, beginn)) < a.maxThreadsTag) {
    const r = await fallAnVa(tenantId, v.id, null, { von: "Automatik" });
    if (!r.ok) return void (await fehler(r.fehler));
    if (r.neu) await db.update(VT).set({ auto: true }).where(and(eq(VT.tenantId, tenantId), eq(VT.threadId, r.threadId)));
    await db.update(VA).set({ threadId: r.threadId }).where(eq(VA.id, neu.id));
    return;
  }
  // Über der Tagesgrenze: Aufgabe der VA zuordnen und ins Sammel-Thread schreiben.
  const auf = await fallAufgabe(tenantId, v.id, null);
  if (!auf) return;
  await vaZustaendigSetzen(tenantId, cfg, auf.taskId);
  const lok = L.lokal(jetzt, s.zeitzone);
  const notizEn = await en(tenantId, auf.notiz.replace(/(^|\n)Text DE:\n[\s\S]*?(?=\n\nText EN:|$)/, "$1"));
  const sc: SammelCtx = { t: tenantId, cfg, dc: discord(cfg.botToken), heute: lok.datum, ruhe: L.inRuhezeit(lok.zeit, s.ruheVon, s.ruheBis), jetzt, zeitzone: s.zeitzone };
  const r = await inSammel(sc, a.maxThreadsTag, { typ: "fall", id: v.id, taskId: auf.taskId, titel: await en(tenantId, v.titel), frist: v.frist, zeilen: notizEn.split("\n").filter((z) => z.trim()).slice(0, 15), kennungen: [v.fallnummer, v.shipmentId, v.bestellnummer, ...v.asins.slice(0, 3)].filter((x): x is string => Boolean(x)) });
  await db.update(VA).set({ status: "sammel", threadId: r.threadId }).where(eq(VA.id, neu.id));
  await db.insert(schema.amazonVorgangEintraege).values({ tenantId, vorgangId: v.id, art: "va", text: `An die VA übergeben (Sammel-Thread #${r.nr}, über der Tagesgrenze)`, von: "Automatik", am: new Date() });
}

// ---- Antworten der VA in Anspruchs- und Sammel-Threads -----------------------------------------------------

/** Nachricht der VA in einem Anspruchs- oder Sammel-Thread. Liefert den neuen Thread-Status. */
export async function automatikAntwort(c: Ctx, th: ThreadRow, m: DcNachricht): Promise<ThreadRow["status"]> {
  if (await schonDa(c.t, m.id)) return th.status;
  c.z.nachrichten++;
  const roh = (m.content ?? "").trim();
  const dateien = await anhaengeSpeichern(c.t, m);
  const art = roh ? L.threadAntwortArt(roh) : "notiz";
  const de = await alsDeutsch(c.t, roh);
  const text = de.text;
  const [row] = await db
    .insert(VN)
    .values({ tenantId: c.t, discordId: m.id, kanalId: th.threadId, threadId: th.threadId, von: "va", text: text || "(Datei)", original: de.original, sprache: de.sprache, art, dateiIds: dateien.map((d) => d.id), gesendetAm: m.timestamp ? new Date(m.timestamp) : new Date() })
    .onConflictDoNothing()
    .returning({ id: VN.id });
  const sag = (t: string) => c.dc.senden(th.threadId, t, { still: true }).catch(() => "");

  if (th.art === "anspruch") {
    const [cl] = th.claimId ? await db.select().from(C).where(and(eq(C.tenantId, c.t), eq(C.id, th.claimId))) : [];
    const fall = A.fallnummerInAntwort(roh);
    if (cl && fall) {
      const r = await markiereEingereicht(c.t, cl.id, { fallnummer: fall, notiz: text ? text.slice(0, 500) : null, userId: null, via: "VA (Discord)" });
      await db.update(VT).set({ status: "erledigt", erledigtAm: new Date() }).where(eq(VT.id, th.id));
      await sag(r.ok ? A.TEXT_EN.eingereicht(fall) : A.TEXT_EN.imSystem);
      if (r.ok) c.z.erledigt++;
      return "erledigt";
    }
    if (art === "erledigt") {
      await sag(A.TEXT_EN.fallnummerFehlt);
      return th.status;
    }
    if (art === "rueckfrage") {
      await rueckfrage(c, th, text || "(Datei)", row?.id ?? null, `Anspruch „${cl?.title ?? "?"}“`);
      return "rueckfrage";
    }
    if (cl && (text || dateien.length)) await db.insert(CE).values({ tenantId: c.t, claimId: cl.id, action: "Notiz der VA (Discord)", note: [text, de.original ? `Original (EN): ${de.original}` : null, dateien.length ? dateiZeilen(dateien) : null].filter(Boolean).join("\n").slice(0, 4000) });
    return th.status;
  }

  // Sammel-Thread: „#3 case 12345678901“ / „#4 done“ / Kennung
  const zuordnung = A.sammelZuordnung(roh, th.eintraege.map((e) => ({ nr: e.nr, kennungen: e.kennungen, offen: !e.erledigt })));
  const fertig: number[] = [];
  const antworten: string[] = [];
  for (const x of zuordnung) {
    const e = th.eintraege.find((y) => y.nr === x.nr);
    if (!e || e.erledigt) continue;
    if (e.typ === "anspruch") {
      if (!x.fallnummer) {
        antworten.push(`#${e.nr}: please add the Amazon case ID.`);
        continue;
      }
      const r = await markiereEingereicht(c.t, e.id, { fallnummer: x.fallnummer, userId: null, via: "VA (Discord)" });
      fertig.push(e.nr);
      antworten.push(r.ok ? A.TEXT_EN.sammelEingereicht(e.nr, x.fallnummer) : `#${e.nr}: already submitted or closed in the system.`);
      if (r.ok) c.z.erledigt++;
    } else {
      if (x.fallnummer) {
        const { fallStatusSetzen } = await import("@/lib/amazon-faelle/service");
        await fallStatusSetzen(c.t, e.id, { phase: "eingereicht", fallnummer: x.fallnummer }, "VA (Discord)").catch(() => null);
      }
      if (e.taskId) await db.update(T).set({ status: "done", completedAt: new Date() }).where(and(eq(T.tenantId, c.t), eq(T.id, e.taskId), eq(T.status, "open")));
      fertig.push(e.nr);
      antworten.push(x.fallnummer ? A.TEXT_EN.sammelEingereicht(e.nr, x.fallnummer) : A.TEXT_EN.sammelErledigt(e.nr));
      c.z.erledigt++;
    }
  }
  if (fertig.length) await eintraegeErledigt(th.id, fertig);
  if (!zuordnung.length && art === "rueckfrage") {
    await rueckfrage(c, th, text || "(Datei)", row?.id ?? null, "Sammel-Thread");
    return "rueckfrage";
  }
  if (!zuordnung.length && (A.fallnummerInAntwort(roh) || art === "erledigt")) antworten.push("👍 Thanks! Which item is it? Please write “#<no.> case <ID>”.");
  if (antworten.length) await sag(antworten.join("\n"));
  const [nachher] = await db.select({ eintraege: VT.eintraege }).from(VT).where(eq(VT.id, th.id));
  if (nachher && nachher.eintraege.length && nachher.eintraege.every((e) => e.erledigt)) {
    await db.update(VT).set({ status: "erledigt", erledigtAm: new Date() }).where(eq(VT.id, th.id));
    return "erledigt";
  }
  return th.status === "rueckfrage" ? "rueckfrage" : "offen";
}

/** Einträge im Sammel-Thread als erledigt markieren (atomar, nach Nummer). */
async function eintraegeErledigt(threadRowId: string, nrs: number[]) {
  await db
    .update(VT)
    .set({
      eintraege: sql`(select coalesce(jsonb_agg(case when (e->>'nr')::int = any(${`{${nrs.join(",")}}`}::int[]) then jsonb_set(e, '{erledigt}', 'true'::jsonb) else e end order by o), '[]'::jsonb) from jsonb_array_elements(${VT.eintraege}) with ordinality as x(e, o))`,
    })
    .where(eq(VT.id, threadRowId));
}

// ---- Fristen: Erinnerungen, Fristtag, verpasst ------------------------------------------------------------

/** Anspruchs-Threads pflegen: erledigt im System → schließen; Erinnerung −7/−3/−1; Fristtag → Ludwig; abgelaufen → verpasst. */
async function anspruchFristen(c: Ctx, a: Auto): Promise<number> {
  const rows = await db.select({ th: VT, cl: C }).from(VT).leftJoin(C, eq(C.id, VT.claimId)).where(and(eq(VT.tenantId, c.t), eq(VT.art, "anspruch"), ne(VT.status, "erledigt")));
  let verpasst = 0;
  for (const { th, cl } of rows) {
    try {
      if (!cl || !(OFFEN as readonly string[]).includes(cl.status)) {
        await db.update(VT).set({ status: "erledigt", erledigtAm: new Date() }).where(eq(VT.id, th.id));
        await c.dc.senden(th.threadId, cl?.status === "submitted" ? A.TEXT_EN.imSystem : A.TEXT_EN.nichtMehrNoetig, { still: true }).catch(() => "");
        continue;
      }
      if (!cl.deadline) continue;
      if (cl.deadline < c.heute) {
        // Frist abgelaufen ohne Fallnummer: nicht mehr bei der VA, Liste an Ludwig.
        await db.update(VT).set({ status: "erledigt", erledigtAm: new Date(), verpasstAm: new Date() }).where(eq(VT.id, th.id));
        await db.insert(CE).values({ tenantId: c.t, claimId: cl.id, action: "Frist bei der VA verpasst", note: `Frist ${cl.deadline} ohne Einreichung – Premium-Support/PSTAM versuchen.` });
        await c.dc.senden(th.threadId, A.TEXT_EN.verpasst(cl.deadline), { still: true }).catch(() => "");
        verpasst++;
        continue;
      }
      if (cl.deadline === c.heute && th.ludwigInfoAm !== c.heute && c.zeit >= a.uhrzeit) {
        await ludwigMelden(c.t, { titel: "Anspruch: Frist heute – noch nicht eingereicht", text: `${cl.title} (bei der VA) – ${euro(num(cl.expectedAmount))}`, link: `/ansprueche/${cl.id}` });
        await db.update(VT).set({ ludwigInfoAm: c.heute }).where(eq(VT.id, th.id));
      }
      if (c.ruhe) continue;
      const rest = A.fristErinnerung({ frist: cl.deadline, heute: c.heute, zeit: c.zeit, uhrzeit: a.uhrzeit, letzte: th.letzteErinnerung, tage: a.erinnerungTage });
      if (rest === null) continue;
      await c.dc.senden(th.threadId, A.fristErinnerungText(rest, await en(c.t, cl.title), cl.deadline, c.cfg.vaDiscordId), { erwaehnen: c.cfg.vaDiscordId });
      await db.update(VT).set({ letzteErinnerung: c.heute }).where(eq(VT.id, th.id));
      c.z.erinnerungen++;
    } catch (e) {
      c.z.fehler.push(e instanceof Error ? e.message : String(e));
    }
  }
  // Sammel-Threads: Ansprüche ohne eigenen Thread – Erinnerung als eine Nachricht, abgelaufene als verpasst.
  const sammel = await db.select().from(VT).where(and(eq(VT.tenantId, c.t), eq(VT.art, "sammel"), ne(VT.status, "erledigt")));
  for (const th of sammel) {
    const offen = th.eintraege.filter((e) => e.typ === "anspruch" && !e.erledigt);
    if (!offen.length) continue;
    const claims = await db.select().from(C).where(and(eq(C.tenantId, c.t), inArray(C.id, offen.map((e) => e.id))));
    const zeilen: string[] = [];
    const fertig: number[] = [];
    for (const e of offen) {
      const cl = claims.find((x) => x.id === e.id);
      if (!cl || !(OFFEN as readonly string[]).includes(cl.status)) {
        fertig.push(e.nr);
        continue;
      }
      if (cl.deadline && cl.deadline < c.heute) {
        fertig.push(e.nr);
        await db.insert(CE).values({ tenantId: c.t, claimId: cl.id, action: "Frist bei der VA verpasst", note: `Frist ${cl.deadline} ohne Einreichung (Sammel-Thread #${e.nr}) – Premium-Support/PSTAM versuchen.` });
        zeilen.push(`⌛ #${e.nr}: deadline passed – no further action needed, Ludwig takes over.`);
        verpasst++;
        continue;
      }
      const rest = c.ruhe ? null : A.fristErinnerung({ frist: cl.deadline, heute: c.heute, zeit: c.zeit, uhrzeit: a.uhrzeit, letzte: th.letzteErinnerung, tage: a.erinnerungTage });
      if (rest !== null) zeilen.push(`⏰ #${e.nr}: claim deadline in ${rest} ${rest === 1 ? "day" : "days"} (${datum(cl.deadline!, "en")}) – please file it and reply “#${e.nr} case <ID>”.`);
    }
    if (fertig.length) await eintraegeErledigt(th.id, fertig);
    if (zeilen.length) {
      await c.dc.senden(th.threadId, `${zeilen.some((z) => z.startsWith("⏰")) ? `<@${c.cfg.vaDiscordId}> ` : ""}${zeilen.join("\n")}`, { erwaehnen: c.cfg.vaDiscordId }).catch(() => "");
      if (zeilen.some((z) => z.startsWith("⏰"))) {
        await db.update(VT).set({ letzteErinnerung: c.heute }).where(eq(VT.id, th.id));
        c.z.erinnerungen++;
      }
    }
    const [nachher] = await db.select({ eintraege: VT.eintraege }).from(VT).where(eq(VT.id, th.id));
    if (nachher?.eintraege.length && nachher.eintraege.every((e) => e.erledigt)) await db.update(VT).set({ status: "erledigt", erledigtAm: new Date() }).where(eq(VT.id, th.id));
  }
  return verpasst;
}

/** Aufgaben der VA, die heute überfällig geworden sind, einmal als „Frist verpasst“ zählen. */
async function aufgabenVerpasst(c: Ctx): Promise<number> {
  const r = await db
    .update(VT)
    .set({ verpasstAm: c.jetzt })
    .where(and(eq(VT.tenantId, c.t), eq(VT.art, "aufgabe"), ne(VT.status, "erledigt"), isNull(VT.verpasstAm), sql`exists (select 1 from tasks t where t.id = ${VT.taskId} and t.status = 'open' and t.due_date < ${c.heute}::date)`))
    .returning({ id: VT.id });
  return r.length;
}

/** Liste für Ludwig: bei der VA abgelaufene Ansprüche (letzte 30 Tage, noch offen) – Premium-Support/PSTAM. */
async function verpasstListe(tenantId: string) {
  const rows = await db
    .selectDistinctOn([C.id], { id: C.id, title: C.title, deadline: C.deadline, betrag: C.expectedAmount })
    .from(CE)
    .innerJoin(C, eq(C.id, CE.claimId))
    .where(and(eq(CE.tenantId, tenantId), eq(CE.action, "Frist bei der VA verpasst"), gte(CE.createdAt, new Date(Date.now() - 30 * 86_400_000)), inArray(C.status, [...OFFEN])))
    .orderBy(C.id)
    .limit(100);
  if (!rows.length) return resolveSystemTask(db, tenantId, "va-ansprueche-verpasst");
  const summe = rows.reduce((n, r) => n + (num(r.betrag) ?? 0), 0);
  await upsertSystemTask(db, tenantId, "va-ansprueche-verpasst", {
    title: `${rows.length} ${rows.length === 1 ? "Anspruch" : "Ansprüche"}: Frist bei der VA verpasst – Premium-Support/PSTAM versuchen`,
    notes: [`Zusammen ${euro(summe)}. Diese Ansprüche gehen nicht mehr an die VA.`, "", ...rows.slice(0, 40).map((r) => `- ${r.title} · Frist ${r.deadline ? r.deadline.split("-").reverse().join(".") : "–"} · ${euro(num(r.betrag))}`)].join("\n"),
    category: "geld",
    priority: "critical",
    link: "/ansprueche?ansicht=fristen",
    dueDate: todayIso(),
  });
}

/** Tägliche Aufgabe im Modus „Vorschlag“: was heute an die VA gegangen wäre. */
async function vorschlagAufgabe(tenantId: string, a: Auto, beginn: Date) {
  if (a.modus !== "vorschlag") return resolveSystemTask(db, tenantId, "va-automatik-vorschlag");
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(VA).where(and(eq(VA.tenantId, tenantId), eq(VA.status, "vorschlag"), gte(VA.am, beginn)));
  if (!r?.n) return resolveSystemTask(db, tenantId, "va-automatik-vorschlag");
  await upsertSystemTask(db, tenantId, "va-automatik-vorschlag", {
    title: `VA-Automatik (Vorschlag): ${r.n} ${r.n === 1 ? "Vorgang wäre" : "Vorgänge wären"} heute an die VA gegangen`,
    notes: "Prüfen unter Delegation → VA → Automatik (einzeln „An die VA“ möglich). Passt die Einstufung, dort auf „automatisch“ umstellen.",
    category: "eigene",
    link: "/delegation/va#automatik",
    dueDate: todayIso(),
  });
}

// ---- Daily overview ---------------------------------------------------------------------------------------

async function tagesuebersicht(c: Ctx, a: Auto): Promise<boolean> {
  if (!a.tagesuebersicht) return false;
  const [st] = await db.select({ am: schema.vaStand.uebersichtAm }).from(schema.vaStand).where(eq(schema.vaStand.tenantId, c.t));
  const letzte = st?.am ? L.lokal(st.am, c.s.zeitzone).datum : null;
  if (!A.uebersichtFaellig({ heute: c.heute, zeit: c.zeit, uhrzeit: a.uhrzeit, letzte, arbeitstage: a.arbeitstage, feiertage: a.feiertage, ruhe: c.ruhe })) return false;
  const seit = st?.am ?? new Date(c.jetzt.getTime() - 24 * 3600_000);
  const morgen = A.plusTage(c.heute, 1);
  const [aufg, anspr, sammel, wartet, beantwortet] = await Promise.all([
    db.select({ threadId: VT.threadId, seit: VT.createdAt, titel: T.title, frist: T.dueDate }).from(VT).innerJoin(T, eq(T.id, VT.taskId)).where(and(eq(VT.tenantId, c.t), eq(VT.art, "aufgabe"), ne(VT.status, "erledigt"), eq(T.status, "open"))).orderBy(asc(T.dueDate)).limit(100),
    db.select({ threadId: VT.threadId, seit: VT.createdAt, titel: C.title, frist: C.deadline }).from(VT).innerJoin(C, eq(C.id, VT.claimId)).where(and(eq(VT.tenantId, c.t), eq(VT.art, "anspruch"), ne(VT.status, "erledigt"))).orderBy(asc(C.deadline)).limit(100),
    db.select({ threadId: VT.threadId, seit: VT.createdAt, eintraege: VT.eintraege }).from(VT).where(and(eq(VT.tenantId, c.t), eq(VT.art, "sammel"), ne(VT.status, "erledigt"))),
    db.select({ threadId: VN.threadId, text: VN.text, original: VN.original }).from(VN).where(and(eq(VN.tenantId, c.t), eq(VN.von, "va"), isNotNull(VN.ludwigTaskId), isNull(VN.beantwortetAm))).orderBy(desc(VN.gesendetAm)).limit(15),
    db.select({ threadId: VN.threadId, text: VN.text, original: VN.original }).from(VN).where(and(eq(VN.tenantId, c.t), eq(VN.von, "va"), isNotNull(VN.ludwigTaskId), gte(VN.beantwortetAm, seit), eq(VN.autoBeantwortet, false))).orderBy(desc(VN.beantwortetAm)).limit(15),
  ]);
  // Titel (Deutsch) für die VA auf Englisch – höchstens 40 verschiedene (Zwischenspeicher der Übersetzungen).
  const titel = [...new Set([...aufg, ...anspr].map((x) => x.titel))].slice(0, 40);
  const tr = new Map<string, string>();
  for (const t of titel) tr.set(t, await en(c.t, t));
  const p = (x: { threadId: string; titel: string; frist: string | null }) => ({ titel: tr.get(x.titel) ?? x.titel, threadId: x.threadId, frist: x.frist });
  const alle = [...aufg, ...anspr];
  const frage = (x: { threadId: string | null; text: string; original: string | null }) => ({ titel: L.titelAus(x.original ?? x.text), threadId: x.threadId });
  const text = A.uebersichtText({
    datum: c.heute,
    neu: [...alle.filter((x) => x.seit >= seit).map(p), ...sammel.filter((x) => x.seit >= seit).map((x) => ({ titel: `More tasks (${x.eintraege.filter((e) => !e.erledigt).length} open)`, threadId: x.threadId }))],
    heute: alle.filter((x) => x.frist === c.heute).map(p),
    morgen: alle.filter((x) => x.frist === morgen).map(p),
    ueberfaellig: aufg.filter((x) => x.frist && x.frist < c.heute).map(p),
    wartetAufLudwig: wartet.map(frage),
    beantwortet: beantwortet.map(frage),
    vaId: c.cfg.vaDiscordId,
  });
  await c.dc.senden(c.cfg.kanalId, text, { erwaehnen: c.cfg.vaDiscordId });
  await db.insert(schema.vaStand).values({ tenantId: c.t, uebersichtAm: c.jetzt }).onConflictDoUpdate({ target: schema.vaStand.tenantId, set: { uebersichtAm: c.jetzt } });
  return true;
}

// ---- Takt -----------------------------------------------------------------------------------------------------

const selten = new Map<string, number>();

/** Ein Durchlauf (im 30-Sekunden-Abgleich der VA): verteilen, Fristen, verpasst, Übersicht; Listen alle 10 Minuten. */
export async function automatikTakt(c: Ctx): Promise<void> {
  const a = c.s.automatik;
  const schritt = async (name: string, f: () => Promise<unknown>) => {
    try {
      await f();
    } catch (e) {
      c.z.fehler.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  await schritt("Ansprüche verteilen", () => anspruecheVerteilen(c, a));
  let verpasst = 0;
  await schritt("Anspruchs-Fristen", async () => (verpasst += await anspruchFristen(c, a)));
  await schritt("Aufgaben verpasst", async () => (verpasst += await aufgabenVerpasst(c)));
  c.z.verpasst += verpasst;
  await schritt("Daily overview", () => tagesuebersicht(c, a));
  const zuletzt = selten.get(c.t) ?? 0;
  if (c.manuell || verpasst > 0 || Date.now() - zuletzt > 10 * 60_000) {
    selten.set(c.t, Date.now());
    await schritt("Liste verpasst", () => verpasstListe(c.t));
    await schritt("Vorschläge", () => vorschlagAufgabe(c.t, a, A.tagesbeginn(c.jetzt, c.s.zeitzone)));
  }
}

// ---- Lesen: Seite, Claude --------------------------------------------------------------------------------

export const VA_STATUS_LABEL: Record<string, string> = { vorschlag: "wäre an die VA gegangen", gesendet: "an die VA (Thread)", sammel: "an die VA (Sammel-Thread)", ludwig: "erst Ludwig", nie: "nie an die VA", fehler: "Fehler", uebernommen: "von Hand an die VA" };

/** Entscheidungen der Automatik (neueste zuerst). */
export async function automatikListe(tenantId: string, o: { tage?: number; limit?: number } = {}) {
  return db
    .select()
    .from(VA)
    .where(and(eq(VA.tenantId, tenantId), gte(VA.am, new Date(Date.now() - (o.tage ?? 7) * 86_400_000))))
    .orderBy(desc(VA.am))
    .limit(o.limit ?? 100);
}

/** Zahlen seit Tagesbeginn (VA-Zeit): je Status. */
export async function automatikHeute(tenantId: string, zeitzone: string, jetzt = new Date()) {
  const beginn = A.tagesbeginn(jetzt, zeitzone);
  const rows = await db.select({ status: VA.status, n: sql<number>`count(*)::int` }).from(VA).where(and(eq(VA.tenantId, tenantId), gte(VA.am, beginn))).groupBy(VA.status);
  const z = (k: string) => rows.find((r) => r.status === k)?.n ?? 0;
  return { beginn, threads: await autoThreadsHeute(tenantId, beginn), vorschlag: z("vorschlag"), gesendet: z("gesendet"), sammel: z("sammel"), ludwig: z("ludwig"), nie: z("nie"), fehler: z("fehler") };
}

/** Ansprüche bei der VA (eigene Threads, offen zuerst). */
export async function anspruecheBeiVa(tenantId: string) {
  return db
    .select({ threadId: VT.threadId, status: VT.status, seit: VT.createdAt, verpasstAm: VT.verpasstAm, letzteErinnerung: VT.letzteErinnerung, claimId: C.id, titel: C.title, frist: C.deadline, betrag: C.expectedAmount, claimStatus: C.status, fallnummer: C.amazonCaseId })
    .from(VT)
    .innerJoin(C, eq(C.id, VT.claimId))
    .where(and(eq(VT.tenantId, tenantId), eq(VT.art, "anspruch")))
    .orderBy(sql`${VT.status} = 'erledigt'`, asc(C.deadline))
    .limit(100);
}
