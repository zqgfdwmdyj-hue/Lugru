import "server-only";
import { and, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { WatchOption } from "@/db/tables/apple-watch";
import { areaForPath, canAccess, linkAllowed } from "@/lib/auth/areas";
import type { Session } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { auswahlNummer, bestandLesen, dealLesen, dealZeile, dringendZeilen, fristKurz, notizLesen, standZeilen, watchAntwort, type DringendPunkt, type WatchAntwort } from "./watch-logic";

// Apple Watch (Bauauftrag Handy-Tesla §10): Kurzantworten für Siri-Kurzbefehle. Immer mit den Rechten der Person
// hinter dem Handy-Schlüssel. Nur „erledigt“, „notiz“ und „bestand“ ändern etwas – und nur, was gesagt wurde.
// „stand“ und „dringend“ zeigen nie Privates (Termine nur als „Termin außer Haus“).

export type WatchErgebnis = WatchAntwort & { ok: boolean; geaendert?: boolean; rueckfrage?: boolean; daten?: Record<string, unknown> };

const fertig = (a: WatchAntwort, extra: Partial<WatchErgebnis> = {}): WatchErgebnis => ({ ok: true, ...a, ...extra });
const nein = (text: string): WatchErgebnis => ({ ok: false, ...watchAntwort([text]) });
const RUECKFRAGE_MIN = 10;

// ---- stand ------------------------------------------------------------------------------------------------

export async function watchStand(session: Session, heute = todayIso()): Promise<WatchErgebnis> {
  const t = session.tenantId;
  const geld = canAccess(session, "geld");
  const { sellerboardRange } = await import("@/lib/sellerboard/sales");
  const monatsAnfang = `${heute.slice(0, 8)}01`;
  const K = schema.sellerboardKpis;
  const V = schema.amazonVorgaenge;
  const { naechsterTermin } = await import("./service");
  const [h, m, sync, rot, termin] = await Promise.all([
    geld ? sellerboardRange(t, heute, heute).catch(() => null) : null,
    geld ? sellerboardRange(t, monatsAnfang, heute).catch(() => null) : null,
    geld ? db.select({ am: sql<Date | null>`max(${K.syncedAt})` }).from(K).where(eq(K.tenantId, t)).then((r) => r[0]?.am ?? null) : null,
    canAccess(session, areaForPath("/amazon-faelle"))
      ? db
          .select({ n: sql<number>`count(*)::int` })
          .from(V)
          .where(and(eq(V.tenantId, t), eq(V.status, "offen"), eq(V.dringlichkeit, "rot")))
          .then((r) => r[0]?.n ?? 0)
      : 0,
    naechsterTermin(session, heute).catch(() => null),
  ]);
  const zeilen = standZeilen({
    heute,
    umsatzHeute: h ? h.sales : null,
    umsatzMonat: m ? m.sales : null,
    gewinnMonat: m ? m.netProfit : null,
    roteFaelle: rot,
    termin: termin ? { tag: termin.tag === heute ? "heute" : "morgen", von: termin.von, titel: termin.titel } : null,
  });
  if (!geld) zeilen[0] = "";
  const stand = sync ? new Date(sync) : null;
  return fertig(watchAntwort(zeilen, { stand }), { daten: { umsatz_heute: h?.sales ?? null, umsatz_monat: m?.sales ?? null, gewinn_monat: m?.netProfit ?? null, rote_faelle: rot, termin: termin ? `${termin.von} ${termin.titel}` : null, datenstand: stand?.toISOString() ?? null } });
}

// ---- dringend ---------------------------------------------------------------------------------------------

/** Die drei wichtigsten Punkte aus „Jetzt dringend“ (Startseite): rote Hinweise, wichtige Aufgaben, dann gelbe. */
export async function watchDringend(session: Session, heute = todayIso()): Promise<WatchErgebnis> {
  const T = schema.tasks;
  const { planDay } = await import("@/lib/today/logic");
  const { todaySignals } = await import("@/lib/today/service");
  const open = await db.select().from(T).where(and(eq(T.tenantId, session.tenantId), eq(T.status, "open")));
  const restricted = session.role === "staff" && session.areas !== null;
  const brandLimited = session.role === "staff" && session.brandIds !== null;
  const sichtbar = open.filter((t) => (!restricted && !brandLimited) || (t.link ? linkAllowed(session, t.link) : !restricted || t.createdBy === session.userId));
  const plan = planDay(sichtbar, heute);
  const signale = (await todaySignals(session.tenantId, heute).catch(() => [])).filter((s) => canAccess(session, areaForPath(s.href.split("?")[0])));
  const FRIST = { danger: "sofort", warn: "bald", info: "Info" } as const;
  const sig = (level: "danger" | "warn" | "info"): DringendPunkt[] => signale.filter((s) => s.level === level).map((s) => ({ text: s.label, frist: FRIST[level] }));
  const punkte: DringendPunkt[] = [...sig("danger"), ...plan.critical.map((t) => ({ text: t.title, frist: fristKurz(t.dueDate, heute) })), ...sig("warn"), ...sig("info")];
  return fertig(watchAntwort(dringendZeilen(punkte)), { daten: { anzahl: punkte.length } });
}

// ---- erledigt ---------------------------------------------------------------------------------------------

type Kandidat = WatchOption & { art: "aufgabe" | "amazon_todo" };

/** Pushs der letzten 24 Std. an diese Person → Aufgaben/ToDos, die noch offen sind (neueste zuerst). */
async function pushKandidaten(session: Session): Promise<{ neueste: Kandidat | null; offen: Kandidat[] }> {
  const M = schema.meldungen;
  const T = schema.tasks;
  const AT = schema.amazonTodos;
  const meld = await db
    .select({ id: M.id, link: M.link, bezug: M.bezug })
    .from(M)
    .where(and(eq(M.tenantId, session.tenantId), eq(M.userId, session.userId), gte(M.createdAt, new Date(Date.now() - 24 * 3_600_000))))
    .orderBy(desc(M.createdAt))
    .limit(60);
  if (!meld.length) return { neueste: null, offen: [] };
  const aufgabenIds = meld.filter((m) => m.bezug?.art === "aufgabe").map((m) => m.bezug!.id);
  const todoIds = meld.filter((m) => m.bezug?.art === "amazon_todo").map((m) => m.bezug!.id);
  const links = [...new Set(meld.filter((m) => !m.bezug && m.link && m.link !== "/").map((m) => m.link!))];
  const [aufgaben, nachLink, todos] = await Promise.all([
    aufgabenIds.length ? db.select({ id: T.id, title: T.title }).from(T).where(and(eq(T.tenantId, session.tenantId), inArray(T.id, aufgabenIds), eq(T.status, "open"))) : [],
    // Ältere Meldungen ohne Bezug: offene Aufgabe mit genau diesem Link (z. B. Amazon-Fall → Aufgabe zum Fall).
    links.length ? db.select({ id: T.id, title: T.title, link: T.link }).from(T).where(and(eq(T.tenantId, session.tenantId), inArray(T.link, links), eq(T.status, "open"))).orderBy(desc(T.createdAt)) : [],
    todoIds.length ? db.select({ id: AT.id, subject: AT.subject, summary: AT.summary }).from(AT).where(and(eq(AT.tenantId, session.tenantId), inArray(AT.id, todoIds), eq(AT.status, "open"))) : [],
  ]);
  const zu = (m: (typeof meld)[number]): Kandidat | null => {
    if (m.bezug?.art === "aufgabe") {
      const a = aufgaben.find((x) => x.id === m.bezug!.id);
      return a ? { art: "aufgabe", id: a.id, titel: a.title } : null;
    }
    if (m.bezug?.art === "amazon_todo") {
      const a = todos.find((x) => x.id === m.bezug!.id);
      return a ? { art: "amazon_todo", id: a.id, titel: a.summary ?? a.subject ?? m.bezug.titel } : null;
    }
    const l = m.link ? nachLink.find((x) => x.link === m.link) : undefined;
    return l ? { art: "aufgabe", id: l.id, titel: l.title } : null;
  };
  const offen: Kandidat[] = [];
  for (const m of meld) {
    const k = zu(m);
    if (k && !offen.some((o) => o.id === k.id)) offen.push(k);
  }
  return { neueste: zu(meld[0]), offen };
}

async function schliessen(session: Session, k: Kandidat): Promise<boolean> {
  if (k.art === "amazon_todo") {
    const { setTodoStatus } = await import("@/lib/amazon-todos/service");
    await setTodoStatus(session.tenantId, k.id, "done", `Apple Watch – ${session.name ?? session.email}`);
    return true;
  }
  const T = schema.tasks;
  const r = await db
    .update(T)
    .set({ status: "done", completedAt: new Date() })
    .where(and(eq(T.tenantId, session.tenantId), eq(T.id, k.id), eq(T.status, "open")))
    .returning({ id: T.id });
  if (r.length) void import("@/lib/calendar/sync").then((m) => m.syncCalendar(session.tenantId)).catch(() => null);
  return r.length > 0;
}

async function rueckfrageSpeichern(session: Session, art: "erledigt" | "bestand", optionen: WatchOption[], menge: number | null = null) {
  const R = schema.watchRueckfragen;
  await db.delete(R).where(and(eq(R.tenantId, session.tenantId), eq(R.userId, session.userId), eq(R.art, art)));
  await db.insert(R).values({ tenantId: session.tenantId, userId: session.userId, art, optionen, menge });
}

async function rueckfrageLesen(session: Session, art: "erledigt" | "bestand") {
  const R = schema.watchRueckfragen;
  const [r] = await db
    .select()
    .from(R)
    .where(and(eq(R.tenantId, session.tenantId), eq(R.userId, session.userId), eq(R.art, art), gte(R.createdAt, new Date(Date.now() - RUECKFRAGE_MIN * 60_000))))
    .orderBy(desc(R.createdAt))
    .limit(1);
  return r ?? null;
}

async function rueckfrageWeg(session: Session, art: "erledigt" | "bestand") {
  const R = schema.watchRueckfragen;
  await db.delete(R).where(and(eq(R.tenantId, session.tenantId), eq(R.userId, session.userId), eq(R.art, art)));
}

const liste = (o: WatchOption[]) => o.map((x, i) => `${i + 1} ${x.titel}`);

/** „Erledigt“: schließt die zuletzt per Push gemeldete Aufgabe; bei Unklarheit die letzten 3 zur Auswahl („Nummer 2“). */
export async function watchErledigt(session: Session, text = ""): Promise<WatchErgebnis> {
  if (session.readOnly) return nein("Nur ansehen – nichts geändert.");
  const nr = auswahlNummer(text.replace(/^\s*erledigt\s*/i, "") || "");
  if (nr) {
    const r = await rueckfrageLesen(session, "erledigt");
    const k = r?.optionen[nr - 1] as Kandidat | undefined;
    if (!r) return nein("Keine offene Auswahl – bitte zuerst „Erledigt“ sagen.");
    if (!k) return nein(`Nummer ${nr} gibt es nicht. ${liste(r.optionen).join(", ")}.`);
    const ok = await schliessen(session, k);
    await rueckfrageWeg(session, "erledigt");
    return ok ? fertig(watchAntwort([`Erledigt: ${k.titel}.`]), { geaendert: true, daten: { id: k.id, art: k.art } }) : nein(`War schon erledigt: ${k.titel}.`);
  }
  const { neueste, offen } = await pushKandidaten(session);
  const fragt = /welche|liste|zeig/i.test(text);
  if (neueste && !fragt) {
    const ok = await schliessen(session, neueste);
    if (ok) {
      await rueckfrageWeg(session, "erledigt");
      return fertig(watchAntwort([`Erledigt: ${neueste.titel}.`]), { geaendert: true, daten: { id: neueste.id, art: neueste.art } });
    }
  }
  if (!offen.length) return nein("Keine offene Aufgabe aus den Pushs der letzten 24 Stunden.");
  const top = offen.slice(0, 3);
  await rueckfrageSpeichern(session, "erledigt", top);
  return fertig(watchAntwort(["Welche? Sag „Nummer …“.", ...liste(top)]), { rueckfrage: true, daten: { optionen: top.map((o) => ({ id: o.id, titel: o.titel })) } });
}

// ---- notiz ------------------------------------------------------------------------------------------------

/** „Notiz …“: Aufgabe für mich; „VA …“: Nachricht an die VA (Englisch; im Modus Vorschlag erst nach Freigabe); „privat …“: Privat-Eintrag. */
export async function watchNotiz(session: Session, textIn: string, o: { tokenId?: string | null } = {}): Promise<WatchErgebnis> {
  if (session.readOnly) return nein("Nur ansehen – nichts angelegt.");
  const { art, text } = notizLesen(textIn);
  if (text.length < 2) return nein("Was soll ich notieren?");
  if (art === "privat") {
    // Nur auf Ludwigs Gerät: Inhaber mit vollem Privat-Zugang.
    if (!(session.role === "owner" && session.privateAccess && session.privateScope === "voll")) return nein("Privat-Einträge nur auf deinem eigenen Gerät.");
    const { privatEintragAnlegen } = await import("@/lib/private/anlegen");
    const r = await privatEintragAnlegen(session, { art: "aufgabe", text: text.slice(0, 500) });
    return r.ok ? fertig(watchAntwort(["Privat notiert."]), { geaendert: true }) : nein(r.message ?? "Privat-Eintrag ging nicht.");
  }
  if (art === "va") {
    if (session.role !== "owner") return nein("Nachrichten an die VA nur vom Inhaber.");
    const r = await vaNachrichtVonWatch(session, text);
    return r.ok ? fertig(watchAntwort(r.zeilen), { geaendert: true, daten: r.daten }) : nein(r.fehler);
  }
  const T = schema.tasks;
  const { tagAusText, titelAus } = await import("@/lib/schnell/logic");
  const titel = (titelAus(text) || text).slice(0, 280);
  const [row] = await db
    .insert(T)
    .values({ tenantId: session.tenantId, title: titel, notes: `Per Apple Watch diktiert: „${text.slice(0, 400)}“`, dueDate: tagAusText(text, todayIso()), priority: "normal", category: "eigene", createdBy: session.userId, assigneeId: session.role === "owner" ? null : session.userId })
    .returning({ id: T.id });
  return fertig(watchAntwort([`Notiert: ${titel}.`]), { geaendert: true, daten: { aufgabe: row.id, schluessel: o.tokenId ?? null } });
}

/** Nachricht an die VA: im Modus „automatisch“ direkt in den VA-Kanal, sonst als Vorschlag zum Freigeben (B17.2). */
async function vaNachrichtVonWatch(session: Session, text: string): Promise<{ ok: true; zeilen: string[]; daten: Record<string, unknown> } | { ok: false; fehler: string }> {
  const { vaKonfig, antwortVorschau, antwortAnVa } = await import("@/lib/va/service");
  if (!(await vaKonfig(session.tenantId))) return { ok: false, fehler: "VA-Kanal ist nicht eingerichtet." };
  const { getSettings } = await import("@/lib/settings");
  const modus = (await getSettings(session.tenantId)).va.automatik.modus;
  const v = await antwortVorschau(session.tenantId, text);
  if (modus === "automatisch") {
    const r = await antwortAnVa(session.tenantId, {}, text, session.name, { englisch: v.text });
    if (!r.ok) return { ok: false, fehler: r.fehler };
    return { ok: true, zeilen: ["An die VA gesendet:", `„${v.text}“`], daten: { modus, gesendet: r.gesendet } };
  }
  const E = schema.vaEntwuerfe;
  const T = schema.tasks;
  const [task] = await db
    .insert(T)
    .values({ tenantId: session.tenantId, title: `VA-Nachricht freigeben: ${text.slice(0, 200)}`, notes: `Per Apple Watch diktiert.\nAn die VA ginge: „${v.text.slice(0, 1500)}“\nFreigeben oder verwerfen unter Delegieren → VA.`, priority: "normal", category: "eigene", createdBy: session.userId, link: "/delegation/va#entwuerfe", dueDate: todayIso() })
    .returning({ id: T.id });
  const [e] = await db.insert(E).values({ tenantId: session.tenantId, userId: session.userId, textDe: text.slice(0, 2000), textVa: v.text.slice(0, 3800), sprache: v.sprache, herkunft: "watch", taskId: task.id }).returning({ id: E.id });
  return { ok: true, zeilen: ["VA-Vorschlag gespeichert:", `„${v.text}“`, "Freigabe im Seller-System."], daten: { modus: "vorschlag", entwurf: e.id, englisch: v.text } };
}

/** Entwurf an die VA senden (Knopf auf der VA-Seite) – erst dann geht etwas in den VA-Kanal. */
export async function vaEntwurfSenden(session: Session, id: string, textVa?: string | null): Promise<{ ok: boolean; message: string }> {
  const E = schema.vaEntwuerfe;
  const [e] = await db.select().from(E).where(and(eq(E.tenantId, session.tenantId), eq(E.id, id), eq(E.status, "offen")));
  if (!e) return { ok: false, message: "Entwurf nicht gefunden oder schon erledigt." };
  const { antwortAnVa } = await import("@/lib/va/service");
  const r = await antwortAnVa(session.tenantId, {}, e.textDe, session.name, { englisch: textVa?.trim() || e.textVa });
  if (!r.ok) {
    await db.update(E).set({ fehler: r.fehler }).where(eq(E.id, e.id));
    return { ok: false, message: r.fehler };
  }
  await db.update(E).set({ status: "gesendet", erledigtAm: new Date(), fehler: null, textVa: r.gesendet }).where(eq(E.id, e.id));
  if (e.taskId) await db.update(schema.tasks).set({ status: "done", completedAt: new Date() }).where(and(eq(schema.tasks.tenantId, session.tenantId), eq(schema.tasks.id, e.taskId)));
  return { ok: true, message: "An die VA gesendet." };
}

export async function vaEntwurfVerwerfen(session: Session, id: string): Promise<void> {
  const E = schema.vaEntwuerfe;
  const [e] = await db.update(E).set({ status: "verworfen", erledigtAm: new Date() }).where(and(eq(E.tenantId, session.tenantId), eq(E.id, id), eq(E.status, "offen"))).returning({ taskId: E.taskId });
  if (e?.taskId) await db.update(schema.tasks).set({ status: "done", completedAt: new Date() }).where(and(eq(schema.tasks.tenantId, session.tenantId), eq(schema.tasks.id, e.taskId)));
}

export async function vaEntwuerfeOffen(tenantId: string) {
  const E = schema.vaEntwuerfe;
  return db.select().from(E).where(and(eq(E.tenantId, tenantId), eq(E.status, "offen"))).orderBy(desc(E.createdAt)).limit(20);
}

// ---- deal -------------------------------------------------------------------------------------------------

/** „Deal prüfen B0… 19,99“ / EAN / Produktname + Preis → Deal-Ampel in einer Zeile. Nur lesen. */
export async function watchDeal(session: Session, text: string): Promise<WatchErgebnis> {
  if (!(canAccess(session, "wawi") || canAccess(session, "dealeingang"))) return nein("Kein Zugang zur Deal-Prüfung.");
  const d = dealLesen(text);
  if (!d.preis) return nein("Bitte Preis mitsagen, z. B. „B0… für 19,99“.");
  let code = d.code;
  let weitere = 0;
  if (!code && d.name) {
    // Produktname: eigene Produkte durchsuchen (alle Wörter müssen vorkommen).
    const P = schema.products;
    const woerter = d.name.split(/\s+/).filter((w) => w.length >= 2).slice(0, 5);
    if (!woerter.length) return nein("Welches Produkt? Bitte ASIN, EAN oder Namen sagen.");
    const treffer = await db
      .select({ asin: P.asin, title: P.title })
      .from(P)
      .where(and(eq(P.tenantId, session.tenantId), ...woerter.map((w) => ilike(P.title, `%${w.replace(/[%_]/g, "")}%`))))
      .limit(10);
    if (!treffer.length) return nein(`„${d.name}“ nicht gefunden – bitte ASIN oder EAN sagen.`);
    code = treffer[0].asin;
    weitere = treffer.length - 1;
    if (treffer.length > 1) {
      // Mehrere ASINs: alle prüfen und die beste nennen, Rest aufs Handy.
      const { dealPruefen } = await import("@/lib/deal-ampel/service");
      const RANG: Record<string, number> = { gruen: 0, gelb: 1, rot: 2 };
      const alle = await Promise.all(treffer.slice(0, 5).map((x) => dealPruefen(session.tenantId, { code: x.asin, ek: d.preis!, ekIstNetto: false, menge: null }).catch(() => null)));
      const beste = alle.filter((x): x is NonNullable<typeof x> => x !== null).sort((a, b) => (RANG[a.ampel] ?? 3) - (RANG[b.ampel] ?? 3) || (b.bestes?.aktuell?.gewinn ?? -1e9) - (a.bestes?.aktuell?.gewinn ?? -1e9))[0];
      if (beste) code = beste.asin;
    }
  }
  if (!code) return nein("Bitte ASIN, EAN oder Produktnamen sagen.");
  const { scanPruefen } = await import("./service");
  try {
    const r = await scanPruefen(session.tenantId, { ean: code, preis: d.preis });
    const zeile = dealZeile({ ampel: r.ampel, roi: r.roi, gewinn: r.gewinn_stueck, menge: r.empfohlene_menge, grund: r.ampel === "rot" ? r.begruendung : null, land: r.land });
    const name = r.titel ? r.titel.slice(0, 40) : r.asin;
    return fertig(watchAntwort([zeile, name, weitere ? `${weitere} weitere Treffer – Details aufs Handy.` : null]), { daten: { asin: r.asin, ampel: r.ampel, roi: r.roi, gewinn_stueck: r.gewinn_stueck, empfohlene_menge: r.empfohlene_menge, weitere } });
  } catch (e) {
    return nein(e instanceof Error ? e.message.slice(0, 120) : "Das konnte ich nicht prüfen.");
  }
}

// ---- bestand ----------------------------------------------------------------------------------------------

type Artikel = { sku: string; titel: string; menge: number };

async function lagerSuche(tenantId: string, suche: string): Promise<Artikel[]> {
  const S = schema.ownStock;
  const P = schema.products;
  const woerter = suche.split(/\s+/).filter((w) => w.length >= 2).slice(0, 5).map((w) => w.replace(/[%_]/g, ""));
  if (!woerter.length) return [];
  // Name aus dem Produkt (direkt oder über die Charge der SKU).
  const titel = sql<string | null>`coalesce(${P.title}, (select p2.title from lots l join products p2 on p2.id = l.product_id where l.tenant_id = ${tenantId} and l.sku = ${S.sku} order by l.purchase_date desc nulls last limit 1))`;
  const rows = await db
    .select({ sku: S.sku, titel, menge: S.quantity })
    .from(S)
    .leftJoin(P, eq(P.id, S.productId))
    .where(and(eq(S.tenantId, tenantId), ...woerter.map((w) => or(ilike(S.sku, `%${w}%`), sql`${titel} ilike ${`%${w}%`}`))))
    .limit(10);
  return rows.map((r) => ({ sku: r.sku, titel: (r.titel ?? r.sku).slice(0, 60), menge: r.menge }));
}

async function bestandSetzen(session: Session, sku: string, menge: number): Promise<{ alt: number; neu: number }> {
  const S = schema.ownStock;
  const [cur] = await db.select({ quantity: S.quantity }).from(S).where(and(eq(S.tenantId, session.tenantId), eq(S.sku, sku)));
  const alt = cur?.quantity ?? 0;
  await db
    .insert(S)
    .values({ tenantId: session.tenantId, sku, quantity: menge })
    .onConflictDoUpdate({ target: [S.tenantId, S.sku], set: { quantity: menge, updatedAt: new Date() } });
  if (menge !== alt) await db.insert(schema.stockMovements).values({ tenantId: session.tenantId, sku, delta: menge - alt, reason: "Zählung (Apple Watch)", userId: session.userId });
  const { syncSoon } = await import("@/lib/stock/channel-sync");
  syncSoon(session.tenantId, [sku]);
  return { alt, neu: menge };
}

/** „Bestand Tefal 12 Stück“: eigenes Lager auf die gezählte Menge setzen (alt → neu); ohne Menge nur nachsehen. */
export async function watchBestand(session: Session, text: string): Promise<WatchErgebnis> {
  if (!canAccess(session, "wawi")) return nein("Kein Zugang zum Lager.");
  const nr = auswahlNummer(text.replace(/^\s*bestand\s*/i, ""));
  if (nr) {
    const r = await rueckfrageLesen(session, "bestand");
    if (!r) return nein("Keine offene Auswahl – bitte Artikel und Menge sagen.");
    const o = r.optionen[nr - 1];
    if (!o?.sku) return nein(`Nummer ${nr} gibt es nicht.`);
    await rueckfrageWeg(session, "bestand");
    if (r.menge === null) return fertig(watchAntwort([`${o.titel}: ${o.alt ?? 0} Stück im Lager.`]));
    if (session.readOnly) return nein("Nur ansehen – nichts geändert.");
    const s = await bestandSetzen(session, o.sku, r.menge);
    return fertig(watchAntwort([`${o.titel}: ${s.alt} → ${s.neu} Stück.`]), { geaendert: true, daten: { sku: o.sku, alt: s.alt, neu: s.neu } });
  }
  const { suche, menge } = bestandLesen(text);
  if (suche.length < 2) return nein("Welcher Artikel? Z. B. „Tefal 12 Stück“.");
  const treffer = await lagerSuche(session.tenantId, suche);
  if (!treffer.length) return nein(`„${suche}“ nicht im eigenen Lager gefunden.`);
  if (treffer.length > 1) {
    const top = treffer.slice(0, 3);
    await rueckfrageSpeichern(session, "bestand", top.map((t) => ({ id: t.sku, sku: t.sku, titel: t.titel, alt: t.menge })), menge);
    return fertig(watchAntwort(["Welcher? Sag „Nummer …“.", ...top.map((t, i) => `${i + 1} ${t.titel} (${t.menge})`)]), { rueckfrage: true });
  }
  const a = treffer[0];
  if (menge === null) return fertig(watchAntwort([`${a.titel}: ${a.menge} Stück im Lager.`]), { daten: { sku: a.sku, menge: a.menge } });
  if (session.readOnly) return nein("Nur ansehen – nichts geändert.");
  const s = await bestandSetzen(session, a.sku, menge);
  return fertig(watchAntwort([`${a.titel}: ${s.alt} → ${s.neu} Stück.`]), { geaendert: true, daten: { sku: a.sku, alt: s.alt, neu: s.neu } });
}

// ---- tesla ------------------------------------------------------------------------------------------------

/** „Auto“: Ladestand, Reichweite, Klima an/aus – nur lesen, nur Inhaber, erst wenn Tesla verbunden ist. */
export async function watchTesla(session: Session): Promise<WatchErgebnis> {
  if (session.role !== "owner") return nein("Nur für den Inhaber.");
  const { autoStatus } = await import("./auto");
  const s = await autoStatus(session);
  if (!s.verbunden) return nein("Tesla ist noch nicht verbunden.");
  if (s.fehler) return nein(s.fehler.slice(0, 120));
  return fertig(
    watchAntwort([
      `Akku ${s.akku ?? "–"} %, Reichweite ${s.reichweite_km ?? "–"} km.`,
      `Klima ${s.klima_an ? "an" : "aus"}${s.innen_temp !== null && s.innen_temp !== undefined ? `, innen ${Math.round(s.innen_temp)} Grad` : ""}.`,
      s.verriegelt === false ? "Nicht verriegelt!" : null,
    ]),
    { daten: { akku: s.akku ?? null, reichweite_km: s.reichweite_km ?? null, klima_an: s.klima_an ?? null } },
  );
}

/** Täglich: alte Rückfragen löschen (gelten ohnehin nur 10 Minuten). */
export async function watchAufraeumen() {
  await db.delete(schema.watchRueckfragen).where(sql`${schema.watchRueckfragen.createdAt} < now() - interval '1 day'`);
}
