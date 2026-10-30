import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, notExists, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { FallPaket } from "@/db/tables/amazon-faelle";
import { todayIso } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import {
  BEREICH_LABEL,
  einordnen,
  fallAntwort,
  freischaltungsPaket,
  freischaltungsQuote,
  musterVon,
  PHASE_LABEL,
  statusVonPhase,
  UNSICHER_AB,
  VERLANGT_LABEL,
  wiederOeffnenPaket,
  zuordnen,
  type Ablehnungsgrund,
  type Bereich,
  type Phase,
  type Verlangt,
} from "./logic";

// Amazon-Fall-Zentrale: Amazon-Mails aus allen Postfächern → Vorgänge mit Verlauf, Frist, Dringlichkeit und
// vorbereitetem Paket; Übergabe an die VA (Discord) als Aufgabe. Eingereicht wird immer in Seller Central.

const V = schema.amazonVorgaenge;
const EI = schema.amazonVorgangEintraege;
const R = schema.amazonEinordnungRegeln;
const E = schema.emails;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const uniq = <T,>(a: T[]) => [...new Set(a)];

export class FallFehler extends Error {}

/** Inhaber (Ludwig) – Empfänger der Meldungen bei Entzug und Markenbeschwerde. */
async function inhaber(tenantId: string): Promise<string[]> {
  const M = schema.memberships;
  const r = await db.select({ userId: M.userId }).from(M).where(and(eq(M.tenantId, tenantId), eq(M.role, "owner")));
  return r.map((x) => x.userId);
}

/** Bekannte Marke im Text (Echtheits-Ordner bzw. SAS-Liste). */
async function markeIm(tenantId: string, text: string): Promise<string | null> {
  const marken = await db.select({ marke: schema.echtheitMarken.marke, aliase: schema.echtheitMarken.aliase }).from(schema.echtheitMarken).where(eq(schema.echtheitMarken.tenantId, tenantId));
  const t = text.toLowerCase();
  const m = marken.find((x) => [x.marke, ...x.aliase].some((n) => n.length >= 3 && new RegExp(`(^|[^\\p{L}])${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "u").test(t)));
  return m?.marke ?? null;
}

// ---- Abgleich: Mails → Vorgänge -----------------------------------------------------------------------------

export type AbgleichErgebnis = { geprueft: number; neu: number; zugeordnet: number; unsicher: number; gemeldet: number; nachgefasst: number };

const laufend = new Map<string, Promise<AbgleichErgebnis>>();

/** Ein Lauf je Firma zur Zeit. */
export function faelleAbgleich(tenantId: string, o: { sinceDays?: number; heute?: string } = {}): Promise<AbgleichErgebnis> {
  const cur = laufend.get(tenantId);
  if (cur) return cur;
  const p = abgleichEinmal(tenantId, o.sinceDays ?? 30, o.heute ?? todayIso()).finally(() => laufend.delete(tenantId));
  laufend.set(tenantId, p);
  return p;
}

async function abgleichEinmal(tenantId: string, sinceDays: number, heute: string): Promise<AbgleichErgebnis> {
  const erg: AbgleichErgebnis = { geprueft: 0, neu: 0, zugeordnet: 0, unsicher: 0, gemeldet: 0, nachgefasst: 0 };
  const settings = await getSettings(tenantId);
  const seit = new Date(Date.now() - sinceDays * 86_400_000);
  const mails = await db
    .select({ id: E.id, from: E.fromAddress, fromName: E.fromName, subject: E.subject, body: E.bodyText, receivedAt: E.receivedAt, category: E.category })
    .from(E)
    .where(
      and(
        eq(E.tenantId, tenantId),
        gte(E.receivedAt, seit),
        ilike(E.fromAddress, "%amazon.%"),
        sql`${E.fromAddress} !~* 'marketplace\\.amazon'`,
        notExists(db.select({ x: sql`1` }).from(EI).where(and(eq(EI.tenantId, tenantId), eq(EI.emailId, E.id)))),
      ),
    )
    .orderBy(asc(E.receivedAt))
    .limit(500);
  erg.geprueft = mails.length;
  if (!mails.length) {
    erg.nachgefasst = await nachfassen(tenantId, heute, settings.faelle.nachfassenTage);
    return erg;
  }
  const gelernt = (await db.select().from(R).where(eq(R.tenantId, tenantId))).map((g) => ({ muster: g.muster, bereich: g.bereich as Bereich, phase: g.phase as Phase }));
  const alle = await db.select().from(V).where(and(eq(V.tenantId, tenantId), gte(V.letzteMailAm, new Date(Date.now() - (sinceDays + 120) * 86_400_000))));
  const kurz = alle.map((v) => ({ id: v.id, bereich: v.bereich as Bereich, status: v.status, fallnummer: v.fallnummer, asins: v.asins, shipmentId: v.shipmentId, bestellnummer: v.bestellnummer, letzteMailAm: v.letzteMailAm.toISOString() }));

  for (const m of mails) {
    const datum = m.receivedAt.toISOString();
    const e = einordnen({ from: `${m.fromName ?? ""} <${m.from ?? ""}>`, subject: m.subject ?? "", text: m.body ?? "", date: datum }, { heute, fristen: settings.faelle.fristen, gelernt });
    // Routinemails ohne Vorgangsbezug (Versandbestätigungen, Newsletter) nicht als Vorgang führen.
    if (m.category === "noise" && (e.bereich === "info" || e.bereich === "sonstiges") && !e.fallnummer) {
      continue;
    }
    const zuId = zuordnen(e, kurz, datum.slice(0, 10));
    const mailText = `${m.subject ?? "(ohne Betreff)"} – ${PHASE_LABEL[e.phase]}`;
    if (zuId) {
      const v = alle.find((x) => x.id === zuId)!;
      const runden = v.runden + (e.phase === "geschlossen_ohne" ? 1 : 0);
      const status = statusVonPhase(e.phase);
      const frist = status === "offen" ? (e.frist ?? v.frist) : null;
      const [neu] = await db
        .update(V)
        .set({
          phase: e.phase,
          status,
          dringlichkeit: status === "offen" ? e.dringlichkeit : "grau",
          frist,
          runden,
          fallnummer: v.fallnummer ?? e.fallnummer,
          asins: uniq([...v.asins, ...e.asins]).slice(0, 50),
          skus: uniq([...v.skus, ...e.skus]).slice(0, 50),
          shipmentId: v.shipmentId ?? e.shipmentId,
          bestellnummer: v.bestellnummer ?? e.bestellnummer,
          betrag: e.betrag ?? v.betrag,
          ablehnungsgruende: e.ablehnungsgruende.length ? e.ablehnungsgruende : v.ablehnungsgruende,
          // Was Amazon verlangt, sammelt sich über die Mails eines Falls (Folgemail ersetzt nichts).
          verlangt: uniq([...v.verlangt, ...e.verlangt]),
          letzteMailAm: m.receivedAt > v.letzteMailAm ? m.receivedAt : v.letzteMailAm,
          updatedAt: new Date(),
        })
        .where(eq(V.id, v.id))
        .returning();
      await db.insert(EI).values({ tenantId, vorgangId: v.id, emailId: m.id, art: "mail", phase: e.phase, text: clip(mailText, 500), am: m.receivedAt }).onConflictDoNothing();
      Object.assign(v, neu);
      const k = kurz.find((x) => x.id === v.id)!;
      Object.assign(k, { asins: neu.asins, fallnummer: neu.fallnummer, shipmentId: neu.shipmentId, bestellnummer: neu.bestellnummer, letzteMailAm: neu.letzteMailAm.toISOString(), status: neu.status });
      erg.zugeordnet++;
      await nachMail(tenantId, neu, heute, erg);
      continue;
    }
    const marke = await markeIm(tenantId, `${m.subject ?? ""}\n${(m.body ?? "").slice(0, 3000)}`);
    const status = statusVonPhase(e.phase);
    const [v] = await db
      .insert(V)
      .values({
        tenantId,
        bereich: e.bereich,
        phase: e.phase,
        status,
        dringlichkeit: status === "offen" ? e.dringlichkeit : "grau",
        unsicher: e.sicherheit < UNSICHER_AB,
        titel: clip(m.subject ?? BEREICH_LABEL[e.bereich], 200),
        fallnummer: e.fallnummer,
        marktplatz: e.marktplatz,
        marke,
        asins: e.asins.slice(0, 50),
        skus: e.skus.slice(0, 50),
        bestellnummer: e.bestellnummer,
        shipmentId: e.shipmentId,
        betrag: e.betrag,
        frist: status === "offen" ? e.frist : null,
        ablehnungsgruende: e.ablehnungsgruende,
        verlangt: e.verlangt,
        zustaendig: settings.faelle.zustaendig,
        runden: e.phase === "geschlossen_ohne" ? 1 : 0,
        ersteMailAm: m.receivedAt,
        letzteMailAm: m.receivedAt,
      })
      .returning();
    await db.insert(EI).values({ tenantId, vorgangId: v.id, emailId: m.id, art: "mail", phase: e.phase, text: clip(mailText, 500), am: m.receivedAt }).onConflictDoNothing();
    alle.push(v);
    kurz.push({ id: v.id, bereich: e.bereich, status: v.status, fallnummer: v.fallnummer, asins: v.asins, shipmentId: v.shipmentId, bestellnummer: v.bestellnummer, letzteMailAm: v.letzteMailAm.toISOString() });
    erg.neu++;
    if (v.unsicher) erg.unsicher++;
    await nachMail(tenantId, v, heute, erg);
  }
  erg.nachgefasst = await nachfassen(tenantId, heute, settings.faelle.nachfassenTage);
  if (erg.neu || erg.zugeordnet) console.log(`[Fall-Zentrale] ${JSON.stringify(erg)}`);
  return erg;
}

type Vorgang = typeof V.$inferSelect;

/** Nach jeder neuen Mail: Paket vorbereiten (wo nötig), Entzug/Markenbeschwerde sofort an Ludwig melden. */
async function nachMail(tenantId: string, v: Vorgang, heute: string, erg: AbgleichErgebnis) {
  if (v.status === "offen") {
    const p = await paketFuer(tenantId, v, heute).catch((e) => {
      console.error("[Fall-Zentrale] Paket:", e instanceof Error ? e.message : e);
      return null;
    });
    if (p) {
      await db.update(V).set({ paket: p, updatedAt: new Date() }).where(eq(V.id, v.id));
      v.paket = p;
    }
  }
  const melden = v.status === "offen" && (v.phase === "entzogen" || v.bereich === "marke" || v.bereich === "kontozustand") && !v.gemeldetAm;
  if (melden) {
    const { melden: push } = await import("@/lib/push/service");
    const b = await betroffenerBestand(tenantId, v.asins);
    const text = `${v.titel}${b.stueck ? ` – betroffen: ${b.stueck} Stück, EK ${b.ekWert.toFixed(0)} €, Umsatz ~${b.umsatzMonat.toFixed(0)} €/Monat` : ""}`;
    await push(tenantId, await inhaber(tenantId), { titel: `🔴 Amazon: ${BEREICH_LABEL[v.bereich as Bereich]}${v.phase === "entzogen" ? " – Freischaltung entzogen" : ""}`, text, link: `/amazon-faelle/${v.id}` });
    await db.update(V).set({ gemeldetAm: new Date() }).where(eq(V.id, v.id));
    erg.gemeldet++;
  }
}

/** Nach dem Einreichen ohne Antwort von Amazon nach X Tagen: Nachfass-Text an die VA (einmal je X Tage). */
async function nachfassen(tenantId: string, heute: string, tage: number): Promise<number> {
  const grenze = new Date(Date.now() - tage * 86_400_000);
  const offen = await db.select().from(V).where(and(eq(V.tenantId, tenantId), eq(V.status, "offen"), eq(V.phase, "eingereicht"), isNotNull(V.taskId)));
  let n = 0;
  for (const v of offen) {
    const [letzter] = await db.select({ am: EI.am }).from(EI).where(and(eq(EI.tenantId, tenantId), eq(EI.vorgangId, v.id))).orderBy(desc(EI.am)).limit(1);
    if (!letzter || letzter.am > grenze) continue;
    const text = `Nachfassen: zu ${v.fallnummer ? `Fall ${v.fallnummer}` : v.titel} seit ${tage} Tagen keine Antwort von Amazon. Bitte im Fallprotokoll nachfragen:\n\nDE: „Wir warten seit ${tage} Tagen auf eine Rückmeldung zu diesem Fall. Bitte prüfen Sie ihn und teilen Sie uns den Stand mit.“\nEN: “We have been waiting ${tage} days for an update on this case. Please review it and let us know the status.”`;
    const { antwortAnVa } = await import("@/lib/va/service");
    const r = await antwortAnVa(tenantId, { taskId: v.taskId }, text, "Fall-Zentrale").catch(() => ({ ok: false as const, fehler: "VA nicht erreichbar" }));
    await db.insert(EI).values({ tenantId, vorgangId: v.id, art: "va", text: r.ok ? "Nachfassen an VA geschickt" : `Nachfassen fällig (${"fehler" in r ? r.fehler : "VA nicht erreichbar"})`, von: "System", am: new Date() });
    n++;
  }
  void heute;
  return n;
}

// ---- Pakete --------------------------------------------------------------------------------------------------

/** Rechnungen zur Marke/ASIN mit Datum, Menge (verknüpfte Chargen) und Lieferanten-Kontakt. */
async function belegKandidaten(tenantId: string, v: Pick<Vorgang, "asins" | "skus" | "marke">) {
  const { rechnungenFuer } = await import("@/lib/va/service");
  const { liste } = await rechnungenFuer(tenantId, { asin: v.asins[0] ?? null, sku: v.skus[0] ?? null, marke: v.marke, lieferant: null });
  if (!liste.length) return { belege: [], letzterLieferant: null as { name: string; ek: number | null } | null };
  const ids = liste.map((r) => r.id);
  const [mengen, kontakte] = await Promise.all([
    db
      .select({ invoiceId: schema.invoiceLots.invoiceId, menge: sql<number>`coalesce(sum(${schema.lots.quantity}), 0)::int`, ek: sql<number | null>`max(${schema.lots.unitCostNet})::float` })
      .from(schema.invoiceLots)
      .innerJoin(schema.lots, eq(schema.lots.id, schema.invoiceLots.lotId))
      .where(and(eq(schema.invoiceLots.tenantId, tenantId), inArray(schema.invoiceLots.invoiceId, ids)))
      .groupBy(schema.invoiceLots.invoiceId),
    db
      .select({ id: schema.invoices.id, email: schema.lieferantenProfile.email })
      .from(schema.invoices)
      .leftJoin(schema.lieferantenProfile, and(eq(schema.lieferantenProfile.tenantId, tenantId), eq(schema.lieferantenProfile.supplierId, schema.invoices.supplierId)))
      .where(and(eq(schema.invoices.tenantId, tenantId), inArray(schema.invoices.id, ids))),
  ]);
  const belege = liste.map((r) => ({
    id: r.id,
    datum: r.invoiceDate,
    lieferant: r.vendor,
    nummer: r.invoiceNumber,
    menge: mengen.find((x) => x.invoiceId === r.id)?.menge ?? null,
    kontakt: Boolean(kontakte.find((k) => k.id === r.id)?.email) || Boolean(r.vendor),
    fileId: r.fileId,
  }));
  const neueste = liste.find((r) => r.vendor);
  const ek = neueste ? (mengen.find((x) => x.invoiceId === neueste.id)?.ek ?? null) : null;
  return { belege, letzterLieferant: neueste ? { name: neueste.vendor!, ek } : null };
}

/** FBA-Sendung zur Shipment-ID: eigener Inbound oder sellerboard. */
async function sendungZu(tenantId: string, shipmentId: string | null) {
  if (!shipmentId) return null;
  const I = schema.inboundShipments;
  const [i] = await db.select().from(I).where(and(eq(I.tenantId, tenantId), eq(I.amazonShipmentId, shipmentId)));
  if (i) {
    const [s] = await db.select({ n: sql<number>`coalesce(sum(${schema.inboundItems.plannedQuantity}), 0)::int` }).from(schema.inboundItems).where(eq(schema.inboundItems.shipmentId, i.id));
    return { id: shipmentId, name: i.name, datum: i.shippedAt ? i.shippedAt.toISOString().slice(0, 10) : null, stueck: s?.n ?? null, tracking: [] as string[], spediteur: null };
  }
  const S = schema.sellerboardShipments;
  const [sb] = await db.select().from(S).where(and(eq(S.tenantId, tenantId), eq(S.amazonId, shipmentId)));
  if (sb) return { id: shipmentId, name: sb.name, datum: sb.createdOn, stueck: sb.lines.reduce((n, l) => n + (Number((l as { units?: number }).units) || 0), 0) || null, tracking: [] as string[], spediteur: null };
  return { id: shipmentId, name: null, datum: null, stueck: null, tracking: [] as string[], spediteur: null };
}

/** Paket je nach Bereich/Phase: Freischaltung, Fall-Antwort, Wiederöffnen, Marke, Angebot – sonst keins. */
export async function paketFuer(tenantId: string, v: Vorgang, heute = todayIso()): Promise<FallPaket | null> {
  const phase = v.phase as Phase;
  if (v.bereich === "freischaltung" && (phase === "abgelehnt" || phase === "nachreichen" || phase === "entzogen")) {
    const { belege, letzterLieferant } = await belegKandidaten(tenantId, v);
    const firma = (await getSettings(tenantId)).b2b?.firma?.name ?? null;
    return freischaltungsPaket({ marke: v.marke, asins: v.asins, marktplatz: v.marktplatz, gruende: v.ablehnungsgruende as Ablehnungsgrund[], belege, heute, firma, letzterLieferant, entzogen: phase === "entzogen" });
  }
  if (phase === "antwort_noetig" && (v.bereich === "fall" || v.bereich === "fba_sendung" || v.fallnummer)) {
    const verlangt = (v.verlangt.length ? v.verlangt : ["shipment_id"]) as Verlangt[];
    const rechnungen = verlangt.includes("rechnung") ? (await belegKandidaten(tenantId, v)).belege.slice(0, 3).map((b) => ({ id: b.id, name: `${b.datum ?? "ohne-datum"}_${(b.lieferant ?? "Lieferant").replace(/[^\p{L}\p{N}]+/gu, "-")}_${(b.nummer ?? "ohne-nr").replace(/[^\p{L}\p{N}]+/gu, "-")}.pdf`, fileId: b.fileId })) : [];
    return fallAntwort({ fallnummer: v.fallnummer, verlangt, sendung: await sendungZu(tenantId, v.shipmentId), bestellnummer: v.bestellnummer, rechnungen, heute });
  }
  if (phase === "geschlossen_ohne") return wiederOeffnenPaket({ fallnummer: v.fallnummer, runden: v.runden, betrag: v.betrag, heute });
  if (v.bereich === "marke") {
    return {
      art: "marke",
      texte: {
        de: `Zur Beschwerde${v.asins.length ? ` (ASIN ${v.asins.join(", ")})` : ""}: Wir beziehen die Ware ausschließlich über autorisierte Lieferanten; Rechnungen liegen bei. Bitte prüfen Sie die Beschwerde und stellen Sie das Angebot wieder her.`,
        en: `Regarding the complaint${v.asins.length ? ` (ASIN ${v.asins.join(", ")})` : ""}: we source exclusively from authorised suppliers; invoices are attached. Please review the complaint and reinstate the listing.`,
      },
      checkliste: ["Echtheits-Ordner der Marke öffnen → Audit-Paket (ZIP) herunterladen.", "Abdeckung prüfen: verkauft vs. mit Rechnung belegt – Lücken zuerst schließen.", "Ludwig entscheidet über Widerspruch bzw. Kontakt zum Rechteinhaber."],
      belege: [],
      fehlt: v.marke ? [] : ["Marke im Echtheits-Ordner anlegen und Rechnungen zuordnen"],
      erstellt: heute,
    };
  }
  if (v.bereich === "angebot") {
    return {
      art: "angebot",
      texte: { de: `Angebot ${v.skus[0] ?? v.asins[0] ?? ""} wieder aktivieren: fehlende Angaben ergänzen bzw. Preis prüfen.`, en: `Reactivate listing ${v.skus[0] ?? v.asins[0] ?? ""}: complete the missing information or check the price.` },
      checkliste: ["Seller Central → Kontozustand bzw. Lagerbestand verwalten → „Angebote mit Problemen“.", "Fehlende Angaben (Sicherheitsinformationen/GPSR, Datenblatt, Preis) ergänzen.", "Speichern; nach Reaktivierung im Seller-System als „gelöst“ markieren."],
      belege: [],
      fehlt: [],
      erstellt: heute,
    };
  }
  return null;
}

/** Betroffener Bestand je ASIN: Stück bei Amazon, EK-Wert, Umsatz je Monat (sellerboard). */
export async function betroffenerBestand(tenantId: string, asins: string[]) {
  if (!asins.length) return { stueck: 0, ekWert: 0, umsatzMonat: 0 };
  const I = schema.sellerboardInventory;
  const P = schema.sellerboardProducts;
  const [inv, prod] = await Promise.all([
    db.select({ asin: I.asin, sku: I.sku, stock: I.fbaStock, v: I.salesVelocity }).from(I).where(and(eq(I.tenantId, tenantId), inArray(I.asin, asins))),
    db.select({ sku: P.sku, cost: P.cost, price: P.price }).from(P).where(and(eq(P.tenantId, tenantId), inArray(P.asin, asins))),
  ]);
  let stueck = 0;
  let ekWert = 0;
  let umsatzMonat = 0;
  for (const r of inv) {
    const p = prod.find((x) => x.sku === r.sku);
    const s = Number(r.stock ?? 0);
    stueck += s;
    ekWert += s * Number(p?.cost ?? 0);
    umsatzMonat += Number(r.v ?? 0) * 30 * Number(p?.price ?? 0);
  }
  return { stueck, ekWert: Math.round(ekWert * 100) / 100, umsatzMonat: Math.round(umsatzMonat * 100) / 100 };
}

// ---- Ändern ----------------------------------------------------------------------------------------------------

export const SETZBARE_PHASEN = ["eingereicht", "antwort_noetig", "beantwortet", "geloest", "genehmigt", "abgelehnt", "geschlossen_ohne", "offen"] as const;

/** Status/Phase setzen (Knopf, Discord-Reaktion, Claude), Fallnummer erfassen, Notiz. */
export async function fallStatusSetzen(tenantId: string, id: string, x: { phase?: (typeof SETZBARE_PHASEN)[number] | null; erledigt?: boolean; fallnummer?: string | null; notiz?: string | null }, von: string): Promise<Vorgang> {
  const [v] = await db.select().from(V).where(and(eq(V.tenantId, tenantId), eq(V.id, id)));
  if (!v) throw new FallFehler("Vorgang nicht gefunden.");
  const fallnummer = x.fallnummer?.replace(/\D/g, "").slice(0, 14) || null;
  const phase = x.phase ?? (x.erledigt ? (v.bereich === "freischaltung" ? "genehmigt" : "geloest") : null);
  const status = x.erledigt ? "erledigt" : phase ? (phase === "eingereicht" ? "offen" : statusVonPhase(phase as Phase)) : v.status;
  const [neu] = await db
    .update(V)
    .set({ ...(phase ? { phase } : {}), status, ...(fallnummer ? { fallnummer } : {}), ...(status !== "offen" ? { dringlichkeit: "grau" as const } : {}), updatedAt: new Date() })
    .where(eq(V.id, v.id))
    .returning();
  const teile = [phase ? `Status: ${PHASE_LABEL[phase as Phase] ?? phase}` : null, fallnummer ? `Fallnummer ${fallnummer}` : null, x.notiz?.trim() ? x.notiz.trim().slice(0, 1000) : null].filter(Boolean);
  if (teile.length) await db.insert(EI).values({ tenantId, vorgangId: v.id, art: x.notiz && !phase && !fallnummer ? "notiz" : "status", phase: phase ?? null, text: teile.join(" · "), von, am: new Date() });
  if (neu.status === "erledigt" && neu.taskId) await db.update(schema.tasks).set({ status: "done", completedAt: new Date() }).where(and(eq(schema.tasks.tenantId, tenantId), eq(schema.tasks.id, neu.taskId)));
  return neu;
}

/** Einordnung von Hand korrigieren – das Muster des Betreffs gilt künftig (Lernen). */
export async function einordnungKorrigieren(tenantId: string, id: string, bereich: Bereich, phase: Phase): Promise<void> {
  const [v] = await db.select().from(V).where(and(eq(V.tenantId, tenantId), eq(V.id, id)));
  if (!v) throw new FallFehler("Vorgang nicht gefunden.");
  const [erste] = await db.select({ subject: E.subject }).from(EI).innerJoin(E, eq(E.id, EI.emailId)).where(and(eq(EI.tenantId, tenantId), eq(EI.vorgangId, id))).orderBy(asc(EI.am)).limit(1);
  const muster = musterVon(erste?.subject ?? v.titel);
  if (muster.length >= 6) await db.insert(R).values({ tenantId, muster, bereich, phase }).onConflictDoUpdate({ target: [R.tenantId, R.muster], set: { bereich, phase } });
  const status = statusVonPhase(phase);
  await db.update(V).set({ bereich, phase, status, unsicher: false, updatedAt: new Date() }).where(eq(V.id, id));
  await db.insert(EI).values({ tenantId, vorgangId: id, art: "status", phase, text: `Einordnung von Hand: ${BEREICH_LABEL[bereich]} · ${PHASE_LABEL[phase]}${muster.length >= 6 ? " (gilt künftig für gleiche Betreffs)" : ""}`, von: "Ludwig", am: new Date() });
  const [neu] = await db.select().from(V).where(eq(V.id, id));
  if (neu.status === "offen") {
    const p = await paketFuer(tenantId, neu).catch(() => null);
    if (p) await db.update(V).set({ paket: p }).where(eq(V.id, id));
  }
}

/** Paket als Aufgabe an die VA (Discord-Thread mit Text DE/EN, Checkliste, Rechnungen als Anhang). */
export async function fallAnVa(tenantId: string, id: string, userId: string | null): Promise<{ ok: true; taskId: string } | { ok: false; fehler: string }> {
  const [v] = await db.select().from(V).where(and(eq(V.tenantId, tenantId), eq(V.id, id)));
  if (!v) return { ok: false, fehler: "Vorgang nicht gefunden." };
  let paket = v.paket;
  if (!paket) {
    paket = await paketFuer(tenantId, v);
    if (paket) await db.update(V).set({ paket }).where(eq(V.id, id));
  }
  const notiz = vaNotiz(v, paket);
  let taskId = v.taskId;
  if (taskId) await db.update(schema.tasks).set({ notes: notiz, dueDate: v.frist, status: "open" }).where(and(eq(schema.tasks.tenantId, tenantId), eq(schema.tasks.id, taskId)));
  else {
    const [t] = await db
      .insert(schema.tasks)
      .values({ tenantId, title: clip(`Amazon ${BEREICH_LABEL[v.bereich as Bereich]}: ${v.titel}`, 280), notes: notiz, priority: v.dringlichkeit === "rot" ? "critical" : "normal", category: "amazon", dueDate: v.frist, link: `/amazon-faelle/${v.id}`, createdBy: userId, systemKey: `amazon-fall:${v.id}` })
      .returning({ id: schema.tasks.id });
    taskId = t.id;
  }
  const { anVaGeben } = await import("@/lib/va/service");
  const r = await anVaGeben(tenantId, taskId);
  await db.update(V).set({ taskId, zustaendig: "va", updatedAt: new Date() }).where(eq(V.id, id));
  await db.insert(EI).values({ tenantId, vorgangId: id, art: "va", text: r.ok ? `An die VA übergeben (Discord-Thread${r.neu ? " neu" : ", erneut"})` : `An die VA: ${r.fehler}`, von: "Ludwig", am: new Date() });
  // Größerer Betrag: zusätzlich Info an Ludwig.
  const schwelle = (await getSettings(tenantId)).faelle.betragSchwelle;
  if (r.ok && v.betrag !== null && v.betrag > schwelle) {
    const { melden } = await import("@/lib/push/service");
    await melden(tenantId, await inhaber(tenantId), { titel: `Amazon-Fall über ${schwelle} € an VA`, text: `${v.titel} – ${v.betrag.toFixed(2).replace(".", ",")} €`, link: `/amazon-faelle/${v.id}` });
  }
  return r.ok ? { ok: true, taskId } : { ok: false, fehler: r.fehler };
}

/** Text für die VA: nur was sie braucht (keine Privat-/Finanzdaten; Rechnungen als Anhang über /datei/…). */
export function vaNotiz(v: Pick<Vorgang, "bereich" | "phase" | "fallnummer" | "marktplatz" | "asins" | "skus" | "frist">, p: FallPaket | null): string {
  const z = [
    `${BEREICH_LABEL[v.bereich as Bereich]} · ${PHASE_LABEL[v.phase as Phase] ?? v.phase}${v.fallnummer ? ` · Fall ${v.fallnummer}` : ""}${v.marktplatz ? ` · ${v.marktplatz}` : ""}`,
    v.asins.length ? `ASIN: ${v.asins.slice(0, 10).join(", ")}` : null,
    v.skus.length ? `SKU: ${v.skus.slice(0, 10).join(", ")}` : null,
  ];
  if (p) {
    z.push("", "Zu tun:", ...p.checkliste.map((c, i) => `${i + 1}. ${c}`));
    if (p.fehlt.length) z.push("", "Fehlt noch (bitte melden, nicht einreichen):", ...p.fehlt.map((f) => `- ${f}`));
    z.push("", "Text DE:", p.texte.de, "", "Text EN:", p.texte.en);
    if (p.belege.length) z.push("", "Belege:", ...p.belege.map((b) => (b.fileId ? `- ${b.name}: /datei/${b.fileId}` : `- ${b.name}`)));
  }
  z.push("", "Nach dem Einreichen: Fallnummer hier antworten und ✅ setzen.");
  return z.filter((x) => x !== null).join("\n").slice(0, 19000);
}

// ---- Lesen -----------------------------------------------------------------------------------------------------

export type FaelleFilter = { bereich?: string | null; status?: string | null; phase?: string | null; marktplatz?: string | null; seit?: Date | null; fristInTagen?: number | null; q?: string | null; nurUnsicher?: boolean; limit?: number };

export async function faelleListe(tenantId: string, f: FaelleFilter = {}) {
  const w = [eq(V.tenantId, tenantId)];
  if (f.bereich) w.push(eq(V.bereich, f.bereich));
  if (f.status) w.push(eq(V.status, f.status as "offen"));
  if (f.phase) w.push(eq(V.phase, f.phase));
  if (f.marktplatz) w.push(eq(V.marktplatz, f.marktplatz));
  if (f.seit) w.push(gte(V.createdAt, f.seit));
  if (f.nurUnsicher) w.push(eq(V.unsicher, true));
  if (f.fristInTagen !== null && f.fristInTagen !== undefined) w.push(sql`${V.frist} <= ${todayIso()}::date + ${f.fristInTagen}::int`, eq(V.status, "offen"));
  if (f.q) {
    const q = `%${f.q.replace(/[%_]/g, "")}%`;
    w.push(or(ilike(V.titel, q), ilike(V.fallnummer, q), ilike(V.marke, q), sql`${V.asins}::text ilike ${q}`, sql`${V.skus}::text ilike ${q}`)!);
  }
  return db
    .select()
    .from(V)
    .where(and(...w))
    .orderBy(sql`case ${V.status} when 'offen' then 0 when 'info' then 2 else 1 end`, sql`case ${V.dringlichkeit} when 'rot' then 0 when 'gelb' then 1 else 2 end`, sql`${V.frist} asc nulls last`, desc(V.letzteMailAm))
    .limit(f.limit ?? 200);
}

/** Kacheln: Antwort nötig, Freischaltungen, offene Fälle (€), Erstattungen ohne Rücksendung (€), diese Woche erhalten. */
export async function faelleKacheln(tenantId: string) {
  const heute = todayIso();
  const [k] = await db
    .select({
      antwortNoetig: sql<number>`count(*) filter (where ${V.status} = 'offen' and ${V.phase} = 'antwort_noetig')::int`,
      naechsteFrist: sql<string | null>`min(${V.frist}) filter (where ${V.status} = 'offen' and ${V.phase} = 'antwort_noetig')::text`,
      freiOffen: sql<number>`count(*) filter (where ${V.bereich} = 'freischaltung' and ${V.status} = 'offen' and ${V.phase} in ('beantragt','nachreichen','eingereicht'))::int`,
      freiAbgelehnt: sql<number>`count(*) filter (where ${V.bereich} = 'freischaltung' and ${V.status} = 'offen' and ${V.phase} = 'abgelehnt')::int`,
      freiEntzogen: sql<number>`count(*) filter (where ${V.bereich} = 'freischaltung' and ${V.status} = 'offen' and ${V.phase} = 'entzogen')::int`,
      offeneFaelle: sql<number>`count(*) filter (where ${V.bereich} = 'fall' and ${V.status} = 'offen')::int`,
      offeneFaelleBetrag: sql<number>`coalesce(sum(${V.betrag}) filter (where ${V.bereich} = 'fall' and ${V.status} = 'offen'), 0)::float`,
      rot: sql<number>`count(*) filter (where ${V.status} = 'offen' and ${V.dringlichkeit} = 'rot')::int`,
      unsicher: sql<number>`count(*) filter (where ${V.status} <> 'erledigt' and ${V.unsicher})::int`,
      fristBald: sql<number>`count(*) filter (where ${V.status} = 'offen' and ${V.frist} <= ${heute}::date + 3)::int`,
    })
    .from(V)
    .where(eq(V.tenantId, tenantId));
  const X = schema.amazonReimbursements;
  const [erhalten] = await db
    .select({ summe: sql<number>`coalesce(sum(${X.amountTotal}), 0)::float`, n: sql<number>`count(*)::int` })
    .from(X)
    .where(and(eq(X.tenantId, tenantId), gte(X.approvalDate, new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10))));
  const ohne = await erstattungenAbgleich(tenantId, { status: "ohne_ruecksendung" }).catch(() => null);
  return { ...k, erhaltenWoche: erhalten?.summe ?? 0, erhaltenWocheN: erhalten?.n ?? 0, ohneRuecksendung: ohne?.summen.offen ?? 0, ohneRuecksendungN: ohne?.zeilen.length ?? 0 };
}

export async function fallDetail(tenantId: string, idOderNummer: string) {
  const isId = /^[0-9a-f-]{36}$/i.test(idOderNummer);
  const nummer = idOderNummer.replace(/\D/g, "");
  const [v] = await db
    .select()
    .from(V)
    .where(and(eq(V.tenantId, tenantId), isId ? eq(V.id, idOderNummer) : eq(V.fallnummer, nummer)))
    .limit(1);
  if (!v) return null;
  const verlauf = await db
    .select({ id: EI.id, art: EI.art, phase: EI.phase, text: EI.text, von: EI.von, am: EI.am, emailId: EI.emailId, betreff: E.subject, absender: E.fromAddress, mailText: E.bodyText })
    .from(EI)
    .leftJoin(E, eq(E.id, EI.emailId))
    .where(and(eq(EI.tenantId, tenantId), eq(EI.vorgangId, v.id)))
    .orderBy(asc(EI.am));
  const mailIds = verlauf.map((x) => x.emailId).filter((x): x is string => !!x);
  const T = schema.amazonTodos;
  const [todos, bestand, task] = await Promise.all([
    mailIds.length ? db.select({ id: T.id, status: T.status, category: T.category, summary: T.summary }).from(T).where(and(eq(T.tenantId, tenantId), inArray(T.emailId, mailIds))) : [],
    v.phase === "entzogen" || v.bereich === "marke" ? betroffenerBestand(tenantId, v.asins) : null,
    v.taskId ? db.select({ id: schema.tasks.id, status: schema.tasks.status, assigneeId: schema.tasks.assigneeId, zustaendigExtern: schema.tasks.zustaendigExtern }).from(schema.tasks).where(eq(schema.tasks.id, v.taskId)).then((r) => r[0] ?? null) : null,
  ]);
  const ansprueche = v.fallnummer
    ? await db.select({ id: schema.claims.id, title: schema.claims.title, status: schema.claims.status, expectedAmount: schema.claims.expectedAmount }).from(schema.claims).where(and(eq(schema.claims.tenantId, tenantId), eq(schema.claims.amazonCaseId, v.fallnummer)))
    : [];
  return { vorgang: v, verlauf, todos, bestand, task, ansprueche };
}

/** Freischaltungen je Marke/ASIN und Marktplatz mit Verlauf, Gründen und Erfolgsquote je Marke. */
export async function freischaltungen(tenantId: string, f: { marke?: string | null; status?: string | null } = {}) {
  const w = [eq(V.tenantId, tenantId), eq(V.bereich, "freischaltung")];
  if (f.marke) w.push(ilike(V.marke, `%${f.marke.replace(/[%_]/g, "")}%`));
  const rows = await db.select().from(V).where(and(...w)).orderBy(desc(V.letzteMailAm));
  const liste = rows.filter((r) => !f.status || r.phase === f.status || (f.status === "offen" && r.status === "offen"));
  const quote = freischaltungsQuote(rows.map((r) => ({ marke: r.marke, phase: r.phase as Phase, gruende: r.ablehnungsgruende as Ablehnungsgrund[] })));
  // Genehmigt → offene Deals, Preislisten-Treffer oder Deal-Eingänge mit derselben ASIN („jetzt einkaufbar“).
  const genehmigtAsins = uniq(rows.filter((r) => r.phase === "genehmigt").flatMap((r) => r.asins));
  const deals = genehmigtAsins.length ? await db.select({ asin: schema.deals.asin }).from(schema.deals).where(and(eq(schema.deals.tenantId, tenantId), inArray(schema.deals.asin, genehmigtAsins))) : [];
  const eingaenge = genehmigtAsins.length
    ? await db.select({ zeilen: schema.dealEingaenge.zeilen }).from(schema.dealEingaenge).where(and(eq(schema.dealEingaenge.tenantId, tenantId), eq(schema.dealEingaenge.status, "neu")))
    : [];
  const einkaufbar = new Set([...deals.map((d) => d.asin), ...eingaenge.flatMap((e) => e.zeilen.map((z) => z.asin))].filter((a): a is string => !!a && genehmigtAsins.includes(a)));
  return { liste, quote, einkaufbar: [...einkaufbar] };
}

/**
 * Erstattungen an Kunden prüfen – der vorhandene Retouren-Abgleich (Erstattung ↔ Rücksendung ↔ Zahlung von Amazon,
 * FBA). Status: ohne_ruecksendung, beschaedigt, offen (alles mit offenem Betrag), erhalten.
 */
export async function erstattungenAbgleich(tenantId: string, f: { status?: string | null; vonTag?: string | null; bisTag?: string | null } = {}) {
  const { loadReturnRows } = await import("@/lib/returns/service");
  const view = await loadReturnRows(tenantId, "fba", { withClaims: true });
  const zeit = view.rows.filter((r) => (!f.vonTag || (r.date ?? "") >= f.vonTag) && (!f.bisTag || (r.date ?? "") <= f.bisTag));
  const gruppe = (r: (typeof zeit)[number]) =>
    r.status === "notReimb" || r.status === "partReimb" || r.status === "missing" || r.status === "nodoc" ? "ohne_ruecksendung" : r.status === "amazonDamaged" ? "beschaedigt" : r.status === "reimbursed" ? "erhalten" : r.open > 0 ? "offen" : "sonst";
  const zeilen = zeit.filter((r) => !f.status || gruppe(r) === f.status || (f.status === "offen" && r.open > 0));
  const monate = new Map<string, { monat: string; anzahl: number; erstattet: number; offen: number; erhalten: number }>();
  for (const r of zeit) {
    const m = (r.date ?? "").slice(0, 7) || "ohne Datum";
    const x = monate.get(m) ?? { monat: m, anzahl: 0, erstattet: 0, offen: 0, erhalten: 0 };
    x.anzahl++;
    x.erstattet += r.amount;
    x.offen += r.open;
    x.erhalten += r.amazon?.amount ?? 0;
    monate.set(m, x);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    quellen: view.sources,
    zeilen: zeilen.map((r) => ({ bestellung: r.orderId, sku: r.sku, titel: r.title, datum: r.date, status: r.label, gruppe: gruppe(r), erstattet: r.amount, offen: r.open, amazon: r.amazon?.amount ?? null, rueckgabe: r.returnDate, zustand: r.disposition, ansprueche: r.claims.map((c) => ({ id: c.id, status: c.status, fall: c.amazonCaseId })) })),
    monate: [...monate.values()].sort((a, b) => b.monat.localeCompare(a.monat)).map((m) => ({ ...m, erstattet: r2(m.erstattet), offen: r2(m.offen), erhalten: r2(m.erhalten) })),
    summen: { offen: r2(zeilen.reduce((n, r) => n + r.open, 0)) },
  };
}

/** Nur-Info-Mails der letzten 7 Tage (Wochen-Digest statt Aufgaben). */
export async function infoDigest(tenantId: string) {
  return db
    .select({ id: V.id, titel: V.titel, am: V.letzteMailAm, bereich: V.bereich })
    .from(V)
    .where(and(eq(V.tenantId, tenantId), eq(V.status, "info"), gte(V.letzteMailAm, new Date(Date.now() - 7 * 86_400_000))))
    .orderBy(desc(V.letzteMailAm))
    .limit(50);
}

export { BEREICH_LABEL, PHASE_LABEL, VERLANGT_LABEL };
