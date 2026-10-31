import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, notExists, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { addDaysIso, todayIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { getSettings } from "@/lib/settings";
import { anrufErledigtLesen, anrufFinden, anrufeFuerFahrt, anrufName, briefingText, fahrtAnsage, istAnruf, scanAnsage, telefonAus, zielArt, type AnrufAufgabe, type BriefingDaten, type Orte, type ZielArt } from "./logic";

// Handy & Tesla (B13): Daten für Widget, Fahrt-Briefing, Anrufe, Scan und „Ins Auto“. Immer mit den Rechten der
// Person; Privates nur als „Termin außer Haus“. Nichts wird automatisch gesendet oder gekauft.

const T = schema.tasks;

/** Orte für die Ziel-Erkennung: Einstellungen + Lieferanten mit Adresse. */
export async function orteLaden(tenantId: string): Promise<Orte> {
  const s = (await getSettings(tenantId)).mobil;
  const L = schema.lieferantenProfile;
  const l = await db.select({ id: schema.suppliers.id, name: schema.suppliers.name, code: schema.suppliers.code, adresse: L.adresse }).from(L).innerJoin(schema.suppliers, eq(schema.suppliers.id, L.supplierId)).where(eq(L.tenantId, tenantId));
  return { lager: s.orte.lager, prep: s.orte.prep, palettenlager: s.orte.palettenlager, zuhause: s.orte.zuhause || null, lieferanten: l.map((x) => ({ id: x.id, name: x.name ?? x.code, adresse: x.adresse })) };
}

/** Eigene offene Aufgaben (zugewiesen bzw. beim Inhaber ohne Zuständigen). */
const meine = (s: Session) => (s.role === "owner" ? or(eq(T.assigneeId, s.userId), isNull(T.assigneeId)) : eq(T.assigneeId, s.userId));

// ---- Widget ------------------------------------------------------------------------------------------------

export async function kurzWerte(session: Session, heute = todayIso()) {
  const t = session.tenantId;
  const gestern = addDaysIso(heute, -1);
  const { sellerboardRange } = await import("@/lib/sellerboard/sales");
  const [h, g] = await Promise.all([sellerboardRange(t, heute, heute).catch(() => null), sellerboardRange(t, gestern, gestern).catch(() => null)]);
  const O = schema.orders;
  const [{ fbm }] = await db.select({ fbm: count() }).from(O).where(and(eq(O.tenantId, t), eq(O.fulfillment, "FBM"), eq(O.status, "open"), lte(O.shipBy, new Date(`${heute}T23:59:59Z`))));
  const [{ wichtig }] = await db.select({ wichtig: count() }).from(T).where(and(eq(T.tenantId, t), eq(T.status, "open"), eq(T.priority, "critical"), meine(session)));
  // Nächster Termin heute/morgen: geschäftliche Kalender mit Titel, Privates nur als „Termin außer Haus“.
  const { tagesplan } = await import("@/lib/tagesplan/service");
  const plan = await tagesplan(session, { start: heute, tage: 2, heute }).catch(() => null);
  const jetzt = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const naechster = plan?.tage
    .flatMap((d) => d.sperren.filter((x) => (x.art === "termin" || x.art === "privat") && !x.ganztags && (d.tag > heute || x.von >= jetzt)).map((x) => ({ tag: d.tag, von: x.von, titel: x.art === "privat" ? "Termin außer Haus" : x.titel })))
    .sort((a, b) => (a.tag + a.von).localeCompare(b.tag + b.von))[0] ?? null;
  const DE = schema.dealEingaenge;
  const gruen = await db
    .select({ n: count() })
    .from(DE)
    .where(and(eq(DE.tenantId, t), eq(DE.ampel, "gruen"), gte(DE.createdAt, new Date(Date.now() - 24 * 3_600_000))))
    .then((r) => r[0]?.n ?? 0)
    .catch(() => 0);
  return {
    stand: new Date().toISOString(),
    umsatz_heute: h ? Math.round(h.sales) : null,
    umsatz_gestern: g ? Math.round(g.sales) : null,
    nettogewinn_gestern: g ? Math.round(g.netProfit) : null,
    fbm_frist_heute: fbm,
    wichtige_todos: wichtig,
    naechster_termin: naechster ? `${naechster.tag === heute ? "heute" : "morgen"} ${naechster.von} ${naechster.titel}` : null,
    gruene_deals_24h: gruen,
  };
}

// ---- Anrufe ------------------------------------------------------------------------------------------------

export async function anrufAufgaben(session: Session, o: { vorschlaege?: boolean } = {}): Promise<(AnrufAufgabe & { name: string; telefonVorschlag?: { nummer: string; quelle: string } | null })[]> {
  const rows = await db
    .select({ id: T.id, titel: T.title, notes: T.notes, prioritaet: T.priority, faellig: T.dueDate, telefon: T.telefon })
    .from(T)
    .where(and(eq(T.tenantId, session.tenantId), eq(T.status, "open"), meine(session)))
    .orderBy(asc(T.dueDate))
    .limit(500);
  const L = schema.lieferantenProfile;
  const tel = await db.select({ name: schema.suppliers.name, code: schema.suppliers.code, telefon: L.telefon }).from(L).innerJoin(schema.suppliers, eq(schema.suppliers.id, L.supplierId)).where(and(eq(L.tenantId, session.tenantId), sql`${L.telefon} is not null`));
  const liste = rows
    .filter((r) => istAnruf(r.titel))
    .map((r) => {
      const name = anrufName(r.titel);
      const ausLieferant = tel.find((x) => [x.name, x.code].some((n) => n && name.toLowerCase().includes(n.toLowerCase())))?.telefon ?? null;
      return { id: r.id, titel: r.titel, name, prioritaet: r.prioritaet as AnrufAufgabe["prioritaet"], faellig: r.faellig, telefon: r.telefon ?? telefonAus(r.notes ?? "") ?? ausLieferant };
    });
  if (!o.vorschlaege) return liste;
  // Ohne Nummer: Vorschlag aus Kontakten/Mail-Signaturen (keine Websuche – die nur auf Knopfdruck).
  const { telefonVorschlag } = await import("./telefon");
  const { canAccess } = await import("@/lib/auth/areas");
  const mitMails = canAccess(session, "posteingang");
  return Promise.all(liste.map(async (a) => (a.telefon ? a : { ...a, telefonVorschlag: await telefonVorschlag(session.tenantId, a.name, { mails: mitMails }).catch(() => null) })));
}

/** Anruf erledigen: per ID oder per Satz „Anruf erledigt: Konrad, Notiz: …“. Notiz an die Aufgabe; Folgeaufgabe nur als Vorschlag. */
export async function anrufErledigen(session: Session, e: { id?: string; text?: string; notiz?: string | null }): Promise<{ ok: boolean; vorlesen: string }> {
  if (session.readOnly) return { ok: false, vorlesen: "Nur ansehen – nichts geändert." };
  const anrufe = await anrufAufgaben(session);
  const gelesen = e.text ? anrufErledigtLesen(e.text) : null;
  const a = e.id ? anrufe.find((x) => x.id === e.id) : gelesen ? anrufFinden(anrufe, gelesen.name) : null;
  if (!a) return { ok: false, vorlesen: "Diesen Anruf habe ich nicht gefunden." };
  const notiz = (e.notiz ?? gelesen?.notiz ?? "").trim();
  const [cur] = await db.select({ notes: T.notes }).from(T).where(and(eq(T.tenantId, session.tenantId), eq(T.id, a.id)));
  await db
    .update(T)
    .set({ status: "done", completedAt: new Date(), ...(notiz ? { notes: `${cur?.notes ? `${cur.notes}\n` : ""}Anruf: ${notiz}`.slice(0, 4000) } : {}) })
    .where(and(eq(T.tenantId, session.tenantId), eq(T.id, a.id)));
  return { ok: true, vorlesen: `Erledigt: ${a.name}.${notiz ? " Notiz gespeichert." : ""}${notiz && /\b(\d+)\s*(stück|stk)\b/i.test(notiz) ? " Folgeaufgabe Bestellung? Bitte im Seller-System bestätigen." : ""}` };
}

// ---- Fahrt-Briefing ----------------------------------------------------------------------------------------

/** Nächster Termin mit Ort (geschäftlicher Kalender, heute) – als Ziel, wenn das Auto keins meldet. */
async function naechstesZiel(tenantId: string): Promise<{ ziel: string; titel: string; start: Date } | null> {
  const E = schema.calendarEvents;
  const [e] = await db
    .select({ location: E.location, title: E.title, startsAt: E.startsAt })
    .from(E)
    .where(and(eq(E.tenantId, tenantId), eq(E.allDay, false), gte(E.startsAt, new Date(Date.now() - 30 * 60_000)), lte(E.startsAt, new Date(Date.now() + 12 * 3_600_000)), sql`${E.location} is not null and ${E.location} <> ''`))
    .orderBy(asc(E.startsAt))
    .limit(1);
  return e ? { ziel: e.location!, titel: e.title, start: e.startsAt } : null;
}

async function briefingDaten(session: Session, art: ZielArt, lieferantId: string | null, heute: string): Promise<BriefingDaten> {
  const t = session.tenantId;
  if (art === "lager" || art === "prep" || art === "palettenlager") {
    const O = schema.orders;
    const RP = schema.retourenPruefungen;
    const RS = schema.amazonRemovalShipments;
    const RM = schema.amazonRemovalShipmentMarks;
    const PS = schema.palletShipments;
    const [[{ fbm }], [{ ret }], [{ rem }], [{ pal }]] = await Promise.all([
      db.select({ fbm: count() }).from(O).where(and(eq(O.tenantId, t), eq(O.fulfillment, "FBM"), eq(O.status, "open"))),
      db.select({ ret: count() }).from(RP).where(and(eq(RP.tenantId, t), eq(RP.status, "offen"))),
      db.select({ rem: count() }).from(RS).where(and(eq(RS.tenantId, t), gte(RS.shipmentDate, addDaysIso(heute, -30)), notExists(db.select({ x: sql`1` }).from(RM).where(and(eq(RM.tenantId, t), eq(RM.trackingNumber, RS.trackingNumber)))))),
      db.select({ pal: count() }).from(PS).where(and(eq(PS.tenantId, t), eq(PS.direction, "ein"), eq(PS.plannedDate, heute))),
    ]);
    return { art, fbmOffen: fbm, retouren: ret, remissionen: rem, palettenHeute: pal };
  }
  if (art === "lieferant" && lieferantId) {
    const PO = schema.purchaseOrders;
    const PI = schema.purchaseOrderItems;
    const [sup] = await db.select({ name: schema.suppliers.name, code: schema.suppliers.code }).from(schema.suppliers).where(and(eq(schema.suppliers.tenantId, t), eq(schema.suppliers.id, lieferantId)));
    const [bv] = await db
      .select({ stueck: sql<number>`coalesce(sum(${PI.quantity}),0)::int`, summe: sql<number>`coalesce(sum(${PI.quantity} * ${PI.unitCostGross}),0)::float` })
      .from(PI)
      .innerJoin(PO, eq(PO.id, PI.poId))
      .where(and(eq(PO.tenantId, t), eq(PO.supplierId, lieferantId), eq(PO.status, "draft")));
    const F = schema.supplierFeeds;
    const [feed] = await db.select({ am: F.lastImportAt }).from(F).where(and(eq(F.tenantId, t), eq(F.supplierId, lieferantId))).orderBy(desc(F.lastImportAt)).limit(1);
    const I = schema.invoices;
    const [{ offen }] = await db.select({ offen: count() }).from(I).where(and(eq(I.tenantId, t), eq(I.supplierId, lieferantId), inArray(I.status, ["new", "review"])));
    return { art, name: sup?.name ?? sup?.code ?? "Lieferant", bestellvorschlaege: { stueck: bv?.stueck ?? 0, summe: bv?.summe ?? 0 }, preislisteVom: feed?.am ? feed.am.toISOString().slice(0, 10) : null, offeneRechnungen: offen };
  }
  if (art === "post") {
    const O = schema.orders;
    const [{ n }] = await db.select({ n: count() }).from(O).where(and(eq(O.tenantId, t), eq(O.fulfillment, "FBM"), inArray(O.status, ["open", "label_created"])));
    return { art, labelsHeute: n };
  }
  if (art === "zuhause") {
    const { feierabend } = await import("@/lib/feierabend/service");
    const f = await feierabend(session, { heute }).catch(() => null);
    return { art, feierabend: f ? { erledigt: f.erledigt.length, offen: f.offen.length, morgen: f.morgenTermine.slice(0, 2).map((x) => `${x.von} ${x.art === "privat" ? "Termin außer Haus" : x.titel}`).concat(f.morgenTop3.slice(0, 1).map((x) => x.titel)) } : null };
  }
  const k = await kurzWerte(session, heute).catch(() => null);
  const wichtig = await db.select({ title: T.title }).from(T).where(and(eq(T.tenantId, t), eq(T.status, "open"), eq(T.priority, "critical"), meine(session))).orderBy(asc(T.dueDate)).limit(3);
  return { art: "sonst", morgen: { wichtig: wichtig.map((w) => w.title.slice(0, 60)), umsatzGestern: k?.umsatz_gestern ?? null, gewinnGestern: k?.nettogewinn_gestern ?? null } };
}

/**
 * Fahrt-Briefing (≤ 60 Sekunden): Ziel aus dem Aufruf, dem Navi des Autos oder dem nächsten Termin mit Ort; dazu die
 * Anrufe, die in die Fahrzeit passen.
 */
export async function fahrtBriefing(session: Session, o: { ziel?: string | null; minuten?: number | null; heute?: string } = {}) {
  const heute = o.heute ?? todayIso();
  const cfg = (await getSettings(session.tenantId)).mobil;
  let ziel = o.ziel?.trim() || null;
  let minuten = o.minuten ?? null;
  if (!ziel && session.role === "owner") {
    const tesla = await getIntegration(session.tenantId, "tesla");
    if (tesla?.accessToken) {
      const { teslaStatus } = await import("@/lib/integrations/clients/tesla");
      const st = await teslaStatus({ ...tesla, vin: tesla.vin || cfg.tesla.vin }).catch(() => null);
      if (st?.ziel) {
        ziel = st.ziel;
        minuten ??= st.minutenBisAnkunft;
      }
    }
  }
  if (!ziel) ziel = (await naechstesZiel(session.tenantId))?.ziel ?? null;
  const orte = await orteLaden(session.tenantId);
  const z = zielArt(ziel, orte);
  const anrufe = anrufeFuerFahrt(await anrufAufgaben(session), minuten ?? cfg.fahrzeitMin, heute, cfg.jeAnrufMin);
  const briefing = briefingText(await briefingDaten(session, z.art, z.lieferantId, heute));
  const ansage = fahrtAnsage(minuten, anrufe);
  return { ziel_art: z.art, minuten, anrufe: anrufe.map((a) => ({ id: a.id, name: anrufName(a.titel), telefon: a.telefon, tel_link: a.telefon ? `tel:${a.telefon}` : null })), briefing, vorlesen: `${ansage} ${briefing}`.trim() };
}

// ---- Scan --------------------------------------------------------------------------------------------------

export async function scanPruefen(tenantId: string, e: { ean: string; preis: number; menge?: number | null; netto?: boolean }) {
  const { dealPruefen } = await import("@/lib/deal-ampel/service");
  const r = await dealPruefen(tenantId, { code: e.ean, ek: e.preis, ekIstNetto: Boolean(e.netto), menge: e.menge ?? null });
  const b = r.bestes;
  const g = b?.aktuell ?? b?.schnitt90 ?? null;
  const menge = r.abverkauf.empfohlen ? r.abverkauf.empfohlen.bis : null;
  const grund = r.ampel === "rot" ? (r.rot[0] ?? r.begruendung) : null;
  return {
    asin: r.asin,
    titel: r.titel,
    ampel: r.ampel,
    land: b?.land ?? null,
    gewinn_stueck: g?.gewinn ?? null,
    roi: g?.roi ?? null,
    angebote: b?.angebote ?? null,
    amazon_anteil: b?.amazonProzent ?? null,
    empfohlene_menge: menge,
    eigener_bestand: r.eigen,
    begruendung: r.begruendung,
    hinweise: r.hinweise.slice(0, 5),
    vorlesen: scanAnsage({ ampel: r.ampel, land: b?.land ?? null, gewinnStueck: g?.gewinn ?? null, roi: g?.roi ?? null, angebote: b?.angebote ?? null, menge, grund }),
  };
}

// ---- Ins Auto ----------------------------------------------------------------------------------------------

/** Navigationsziel ans Auto – nur Inhaber, nur auf Knopfdruck bzw. ausdrücklichen Wunsch. Optional Klima, wenn gewünscht. */
export async function insAuto(session: Session, ziel: string, o: { klima?: boolean } = {}): Promise<{ ok: boolean; text: string }> {
  if (session.role !== "owner" || session.readOnly) return { ok: false, text: "Nur der Inhaber kann Ziele ans Auto schicken." };
  const z = ziel.trim();
  if (z.length < 3) return { ok: false, text: "Bitte ein Ziel angeben." };
  const cfg = (await getSettings(session.tenantId)).mobil;
  const tesla = await getIntegration(session.tenantId, "tesla");
  if (!tesla?.accessToken) return { ok: false, text: "Tesla ist noch nicht verbunden (Anbindungen → Tesla)." };
  const c = { ...tesla, vin: tesla.vin || cfg.tesla.vin };
  const { teslaKlima, teslaNavi } = await import("@/lib/integrations/clients/tesla");
  try {
    await teslaNavi(c, z);
    if (o.klima) await teslaKlima(c);
    return { ok: true, text: `Ziel ans Auto geschickt: ${z.slice(0, 80)}${o.klima ? " – Klima läuft." : ""}` };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : "Tesla nicht erreichbar." };
  }
}
