import "server-only";
import { after } from "next/server";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { RetourenBefund, RetourenMedienArt, RetourenVerbleib, RetourenZeile } from "@/db/schema";
import type { Session } from "@/lib/auth/session";
import { askClaude, modelFor, SMART_MODEL, type AiContent } from "@/lib/ai/claude";
import { getIntegration } from "@/lib/integrations/store";
import { addDaysIso, todayIso } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { kleinSchluessel, lesen, loeschen, neuerSchluessel, speichern, teilSchluessel } from "@/lib/medien/ablage";
import {
  ansageBefund,
  ansageEtikett,
  ansageProdukt,
  anspruchsArt,
  BEFUND_TEXT,
  type Befehl,
  entscheide,
  erkenneCode,
  grundText,
  HILFE_TEXT,
  kiWarnung,
  vergleicheLieferschein,
  verbleibVorschlag,
  VERBLEIB_TEXT,
  zusammenfassung,
} from "./logic";
import { EtikettSchema, jsonAus, LieferscheinSchema, ProduktSchema, PROMPT_ETIKETT, PROMPT_LIEFERSCHEIN, promptProdukt, type ProduktKi } from "./ki";

// Retouren-Station: alles, was die Station-Seite am Server braucht. Jeder Zugriff filtert nach Mandant.

const P = schema.retourenPruefungen;
const Pos = schema.retourenPositionen;
const M = schema.retourenMedien;

type Ton = "ok" | "fehler" | "warnung";
export type Antwort = { ansage: string; ton: Ton; stand: StationStand };

export type PositionAnsicht = {
  id: string;
  nr: number;
  zuordnung: string;
  lpn: string | null;
  fnsku: string | null;
  sku: string | null;
  asin: string | null;
  titel: string | null;
  bestellnummer: string | null;
  rueckgabeDatum: string | null;
  grund: string | null;
  kundenkommentar: string | null;
  amazonZustand: string | null;
  erstattet: number | null;
  amazonGezahlt: number | null;
  befund: RetourenBefund | null;
  entscheidung: string | null;
  verbleib: RetourenVerbleib | null;
  verbleibVorschlag: RetourenVerbleib | null;
  ki: (ProduktKi & { status?: string }) | { status: string } | null;
  kiWarnung: string | null;
  notiz: string | null;
  fotos: number;
  anspruchId: string | null;
  retSku: string | null;
};

export type StationStand = {
  pruefung: null | {
    id: string;
    status: string;
    remissionId: string | null;
    zuordnung: string | null;
    sendungsnummer: string | null;
    versender: string | null;
    erwartet: RetourenZeile[] | null;
    lieferschein: RetourenZeile[] | null;
    abweichungen: string[];
    notiz: string | null;
    zusammenfassung: string | null;
    angelegtAm: string;
    videoTeile: number;
    medien: { id: string; art: RetourenMedienArt; nr: number; positionId: string | null }[];
    positionen: PositionAnsicht[];
  };
  remissionenAuswahl: { nr: number; id: string; datum: string | null; positionen: number; versender: string | null }[] | null;
  einstellungen: { aktivierungswort: string | null; schwelle: number };
  datenstand: { kundenretouren: string | null; erstattungen: string | null };
  kiAktiv: boolean;
};

const n2 = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);

// ---- KI ---------------------------------------------------------------------------------------------

async function ki(tenantId: string) {
  const ai = await getIntegration(tenantId, "anthropic");
  if (!ai?.apiKey) return null;
  // Modell per Umgebungsvariable einstellbar; sonst das bessere Modell (Bilder vergleichen braucht Sorgfalt).
  const model = process.env.RETOUREN_KI_MODELL?.trim() || (ai.model?.trim() ? modelFor(ai, "creative") : SMART_MODEL);
  return { apiKey: ai.apiKey, model };
}

const bild = (bytes: Uint8Array, mime = "image/jpeg") => ({ type: "image" as const, source: { type: "base64" as const, media_type: mime, data: Buffer.from(bytes).toString("base64") } });

async function frageKi(tenantId: string, inhalt: AiContent, maxTokens = 800): Promise<string | null> {
  const k = await ki(tenantId);
  if (!k) return null;
  try {
    return (await askClaude(k.apiKey, inhalt, { model: k.model, task: "simple", maxTokens, timeoutMs: 60_000 })).text;
  } catch (e) {
    // Keine Bild- oder Adressdaten ins Protokoll – nur die Fehlermeldung.
    console.error("[Retouren-Station] KI:", e instanceof Error ? e.message.slice(0, 200) : "Fehler");
    return null;
  }
}

// ---- Lesen ------------------------------------------------------------------------------------------

async function aktuellePruefung(tenantId: string, userId: string, id?: string | null) {
  if (id) {
    const [p] = await db.select().from(P).where(and(eq(P.tenantId, tenantId), eq(P.id, id)));
    return p ?? null;
  }
  const [p] = await db.select().from(P).where(and(eq(P.tenantId, tenantId), eq(P.status, "offen"), eq(P.angelegtVon, userId))).orderBy(desc(P.angelegtAm)).limit(1);
  return p ?? null;
}

async function positionen(tenantId: string, pruefungId: string) {
  return db.select().from(Pos).where(and(eq(Pos.tenantId, tenantId), eq(Pos.pruefungId, pruefungId))).orderBy(asc(Pos.nr));
}

function ansicht(p: typeof Pos.$inferSelect, fotos: number): PositionAnsicht {
  const k = (p.kiEinschaetzung ?? null) as PositionAnsicht["ki"];
  const kiFertig = k && !("status" in k && k.status === "laeuft") ? (k as ProduktKi) : null;
  return {
    id: p.id,
    nr: p.nr,
    zuordnung: p.zuordnung,
    lpn: p.lpn,
    fnsku: p.fnsku,
    sku: p.sku,
    asin: p.asin,
    titel: p.titel,
    bestellnummer: p.bestellnummer,
    rueckgabeDatum: p.rueckgabeDatum,
    grund: grundText(p.rueckgabegrund),
    kundenkommentar: p.kundenkommentar,
    amazonZustand: p.amazonZustand,
    erstattet: p.erstattetBetrag,
    amazonGezahlt: p.amazonGezahlt,
    befund: p.befund,
    entscheidung: p.entscheidung,
    verbleib: p.verbleib,
    verbleibVorschlag: verbleibVorschlag(p.befund, { gebrauchsspuren: kiFertig?.gebrauchsspuren, grund: p.rueckgabegrund }),
    ki: k,
    kiWarnung: p.befund && kiFertig ? kiWarnung(p.befund, kiFertig) : null,
    notiz: p.notiz,
    fotos,
    anspruchId: p.anspruchId,
    retSku: p.retSku,
  };
}

async function datenstand(tenantId: string) {
  const R = schema.reportImports;
  const rows = await db
    .select({ typ: R.reportType, am: sql<Date>`max(${R.createdAt})` })
    .from(R)
    .where(and(eq(R.tenantId, tenantId), inArray(R.reportType, ["customerReturns", "reimbursements", "FBA-Kundenrücksendungen", "Erstattungen"])))
    .groupBy(R.reportType);
  const am = (re: RegExp) => rows.filter((r) => re.test(r.typ)).map((r) => new Date(r.am)).sort((a, b) => b.getTime() - a.getTime())[0];
  const f = (d?: Date) => (d ? d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" }) : null);
  // Ohne Import-Protokoll: jüngste Kundenretoure als Anhaltspunkt.
  const [jung] = await db.select({ d: sql<string | null>`max(${schema.amazonCustomerReturns.returnDate})::text` }).from(schema.amazonCustomerReturns).where(eq(schema.amazonCustomerReturns.tenantId, tenantId));
  return { kundenretouren: f(am(/customerReturns|Kundenrück/i)) ?? (jung?.d ? `jüngste Retoure ${jung.d.split("-").reverse().join(".")}` : null), erstattungen: f(am(/reimbursements|Erstattung/i)) };
}

export async function stationStand(session: Session, pruefungId?: string | null, opts: { remissionenAuswahl?: boolean } = {}): Promise<StationStand> {
  const t = session.tenantId;
  const [settings, k, stand] = await Promise.all([getSettings(t), ki(t), datenstand(t)]);
  const rs = settings.retourenStation;
  const p = await aktuellePruefung(t, session.userId, pruefungId);
  let pruefung: StationStand["pruefung"] = null;
  if (p) {
    const [pos, med] = await Promise.all([
      positionen(t, p.id),
      db.select({ id: M.id, art: M.art, nr: M.nr, positionId: M.positionId }).from(M).where(and(eq(M.tenantId, t), eq(M.pruefungId, p.id), isNull(M.geloeschtAm))).orderBy(asc(M.aufgenommenAm)),
    ]);
    pruefung = {
      id: p.id,
      status: p.status,
      remissionId: p.remissionId,
      zuordnung: p.zuordnung,
      sendungsnummer: p.sendungsnummer,
      versender: p.versender,
      erwartet: p.erwartet,
      lieferschein: p.lieferschein,
      abweichungen: p.abweichungen,
      notiz: p.notiz,
      zusammenfassung: p.zusammenfassung,
      angelegtAm: p.angelegtAm.toISOString(),
      videoTeile: p.videoTeile,
      medien: med,
      positionen: pos.map((x) => ansicht(x, med.filter((m) => m.positionId === x.id).length)),
    };
  }
  return {
    pruefung,
    remissionenAuswahl: opts.remissionenAuswahl ? await offeneRemissionen(t) : null,
    einstellungen: { aktivierungswort: rs.aktivierungAn && rs.aktivierungswort ? rs.aktivierungswort : null, schwelle: rs.minBetrag },
    datenstand: stand,
    kiAktiv: Boolean(k),
  };
}

// ---- Remission zuordnen -----------------------------------------------------------------------------

async function offeneRemissionen(tenantId: string) {
  const R = schema.amazonRemovalOrders;
  const rows = await db
    .select({ id: R.orderId, datum: sql<string | null>`max(${R.requestDate})::text`, positionen: sql<number>`count(*)::int` })
    .from(R)
    .where(and(eq(R.tenantId, tenantId), sql`${R.shippedQuantity} > 0 and ${R.receivedQuantity} is null and lower(coalesce(${R.orderType}, '')) not like '%dispos%'`))
    .groupBy(R.orderId)
    .orderBy(sql`max(${R.requestDate}) desc`)
    .limit(9);
  const S = schema.amazonRemovalShipments;
  const carriers = rows.length ? await db.select({ id: S.orderId, carrier: S.carrier }).from(S).where(and(eq(S.tenantId, tenantId), inArray(S.orderId, rows.map((r) => r.id)))) : [];
  return rows.map((r, i) => ({ nr: i + 1, id: r.id, datum: r.datum, positionen: r.positionen, versender: carriers.find((c) => c.id === r.id && c.carrier)?.carrier ?? null }));
}

const normTracking = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Remission über Sendungsnummer (Remissionssendungen) oder Remissions-ID finden – und was darin erwartet wird. */
async function findeRemission(tenantId: string, o: { tracking?: string | null; remissionsId?: string | null }) {
  const S = schema.amazonRemovalShipments;
  const R = schema.amazonRemovalOrders;
  const tr = o.tracking ? normTracking(o.tracking) : "";
  if (tr.length >= 8) {
    const rows = await db
      .select({ orderId: S.orderId, sku: S.sku, fnsku: S.fnsku, menge: S.shippedQuantity, carrier: S.carrier, tracking: S.trackingNumber })
      .from(S)
      .where(and(eq(S.tenantId, tenantId), sql`upper(regexp_replace(coalesce(${S.trackingNumber}, ''), '[^A-Za-z0-9]', '', 'g')) in (${tr}, ${tr.slice(-20)}) or (length(${tr}) >= 12 and upper(regexp_replace(coalesce(${S.trackingNumber}, ''), '[^A-Za-z0-9]', '', 'g')) like ${`%${tr.slice(-12)}`})`));
    const eigene = rows.filter((r) => r.orderId);
    if (eigene.length) {
      const id = eigene[0].orderId;
      return { id, versender: eigene[0].carrier, erwartet: await mitTitel(tenantId, eigene.filter((r) => r.orderId === id).map((r) => ({ sku: r.sku, fnsku: r.fnsku, menge: r.menge }))) };
    }
  }
  const rid = o.remissionsId?.trim();
  if (rid && rid.length >= 5) {
    const rows = await db.select({ orderId: R.orderId, sku: R.sku, fnsku: R.fnsku, menge: R.shippedQuantity }).from(R).where(and(eq(R.tenantId, tenantId), sql`lower(${R.orderId}) = lower(${rid})`));
    if (rows.length) return { id: rows[0].orderId, versender: null, erwartet: await mitTitel(tenantId, rows.filter((r) => r.menge > 0).map((r) => ({ sku: r.sku, fnsku: r.fnsku, menge: r.menge }))) };
  }
  return null;
}

async function remissionPerId(tenantId: string, id: string) {
  return findeRemission(tenantId, { remissionsId: id });
}

/** Titel aus Chargen/Produkten ergänzen (für Ansagen wie „Position Tefal fehlt“). */
async function mitTitel(tenantId: string, zeilen: { sku: string | null; fnsku: string | null; menge: number }[]): Promise<RetourenZeile[]> {
  const skus = [...new Set(zeilen.map((z) => z.sku).filter((s): s is string => !!s))];
  const titel = new Map<string, string>();
  if (skus.length) {
    const rows = await db.select({ sku: schema.lots.sku, title: schema.products.title }).from(schema.lots).innerJoin(schema.products, eq(schema.products.id, schema.lots.productId)).where(and(eq(schema.lots.tenantId, tenantId), inArray(schema.lots.sku, skus)));
    for (const r of rows) if (r.title) titel.set(r.sku, r.title);
  }
  // Gleiche SKU in mehreren Zeilen zusammenfassen
  const map = new Map<string, RetourenZeile>();
  for (const z of zeilen) {
    const key = (z.fnsku || z.sku || "").toUpperCase();
    const e = map.get(key) ?? { sku: z.sku, fnsku: z.fnsku, titel: z.sku ? (titel.get(z.sku) ?? null) : null, menge: 0 };
    e.menge += z.menge;
    map.set(key, e);
  }
  return [...map.values()];
}

// ---- Artikel zuordnen -------------------------------------------------------------------------------

const REVERSAL = /reversal|rückbuch|ruckbuch|storn/i;

/** An den Kunden erstattet (Transaktionen, sonst Abrechnungen). null = keine Daten. */
async function erstattetFuer(tenantId: string, orderId: string, sku: string | null): Promise<number | null> {
  const T = schema.amazonTransactions;
  const [tx] = await db
    .select({ n: sql<number>`count(*)::int`, summe: sql<number>`coalesce(sum(abs(${T.productSales})), 0)::float` })
    .from(T)
    .where(and(eq(T.tenantId, tenantId), eq(T.orderId, orderId), eq(T.kind, "refund"), sku ? sql`(${T.sku} = ${sku} or ${T.sku} is null)` : undefined));
  if (tx.n > 0) return n2(tx.summe);
  const st = await db.execute<{ n: number; summe: number }>(sql`
    select count(*)::int as n, coalesce(sum(abs(amount)), 0)::float as summe from amazon_settlement_lines
     where tenant_id = ${tenantId} and order_id = ${orderId} and lower(transaction_type) like 'refund%'
       and amount_type = 'ItemPrice' and amount_description = 'Principal'`);
  return st.rows[0]?.n ? n2(st.rows[0].summe) : null;
}

/** Was Amazon für diese Bestellung schon an dich gezahlt hat (Erstattungsbericht, ohne Rückbuchungen). */
async function gezahltFuer(tenantId: string, orderId: string, sku: string | null): Promise<number> {
  const B = schema.amazonReimbursements;
  const rows = await db.select({ amount: B.amountTotal, reason: B.reason, sku: B.sku }).from(B).where(and(eq(B.tenantId, tenantId), eq(B.orderId, orderId)));
  return n2(rows.filter((r) => !sku || !r.sku || r.sku === sku).reduce((n, r) => n + (REVERSAL.test(r.reason ?? "") ? -Math.abs(r.amount ?? 0) : (r.amount ?? 0)), 0)) ?? 0;
}

/** Läuft zu dieser Bestellung schon ein eingereichter/abgeschlossener Retouren-Anspruch (nicht der eigene)? */
async function laufenderFall(tenantId: string, orderId: string, eigenerSchluessel: string | null) {
  const C = schema.claims;
  const rows = await db
    .select({ key: C.detectionKey })
    .from(C)
    .where(and(eq(C.tenantId, tenantId), eq(C.reference, orderId), inArray(C.type, ["return_wrong_item", "return_damaged", "return_condition", "return_not_received"]), inArray(C.status, ["submitted", "partial", "reimbursed", "rejected", "escalated"])));
  return rows.some((r) => r.key !== eigenerSchluessel);
}

type Zuordnung = Partial<typeof Pos.$inferInsert> & { zuordnung: "lpn" | "fnsku" | "ean" | "sku" | "unbekannt" };

export async function ordneZu(tenantId: string, roh: string): Promise<Zuordnung> {
  const code = erkenneCode(roh);
  const wert = code?.wert ?? roh.trim().toUpperCase();
  if (code?.art === "lpn") {
    const R = schema.amazonCustomerReturns;
    const [r] = await db.select().from(R).where(and(eq(R.tenantId, tenantId), sql`lower(${R.lpn}) = lower(${code.wert})`)).orderBy(desc(R.returnDate)).limit(1);
    if (!r) return { zuordnung: "lpn", lpn: code.wert };
    const erstattet = r.orderId ? await erstattetFuer(tenantId, r.orderId, r.sku) : null;
    const gezahlt = r.orderId ? await gezahltFuer(tenantId, r.orderId, r.sku) : 0;
    return { zuordnung: "lpn", lpn: r.lpn ?? code.wert, fnsku: r.fnsku, sku: r.sku, asin: r.asin, titel: r.title, bestellnummer: r.orderId, rueckgabeDatum: r.returnDate, rueckgabegrund: r.reason, kundenkommentar: r.customerComments?.slice(0, 1000) ?? null, amazonZustand: r.disposition, erstattetBetrag: erstattet, amazonGezahlt: gezahlt };
  }
  // FNSKU / ASIN / EAN / SKU: Artikel aus Chargen bzw. Produkten (ohne Kundenretoure – kein Fall möglich)
  const L = schema.lots;
  const Pr = schema.products;
  const [lot] = await db
    .select({ sku: L.sku, fnsku: L.fnsku, asin: Pr.asin, title: Pr.title })
    .from(L)
    .innerJoin(Pr, eq(Pr.id, L.productId))
    .where(and(eq(L.tenantId, tenantId), code?.art === "fnsku" ? eq(L.fnsku, wert) : code?.art === "asin" ? eq(Pr.asin, wert) : code?.art === "ean" ? eq(Pr.ean, wert) : sql`upper(${L.sku}) = ${wert}`))
    .limit(1);
  if (lot) return { zuordnung: code?.art === "ean" ? "ean" : code?.art === "fnsku" || code?.art === "asin" ? "fnsku" : "sku", fnsku: lot.fnsku, sku: lot.sku, asin: lot.asin, titel: lot.title };
  const I = schema.amazonInventory;
  const [inv] = await db.select({ sku: I.sku, fnsku: I.fnsku, asin: I.asin, title: I.title }).from(I).where(and(eq(I.tenantId, tenantId), code?.art === "fnsku" ? eq(I.fnsku, wert) : code?.art === "asin" ? eq(I.asin, wert) : sql`upper(${I.sku}) = ${wert}`)).limit(1);
  if (inv) return { zuordnung: code?.art === "fnsku" || code?.art === "asin" ? "fnsku" : "sku", fnsku: inv.fnsku, sku: inv.sku, asin: inv.asin, titel: inv.title };
  return { zuordnung: "unbekannt", ...(code?.art === "fnsku" ? { fnsku: wert } : code?.art === "ean" ? {} : {}) };
}

// ---- Befehle ----------------------------------------------------------------------------------------

async function neuePruefung(session: Session) {
  const [p] = await db.insert(P).values({ tenantId: session.tenantId, angelegtVon: session.userId }).returning();
  return p;
}

async function abschliessen(session: Session, p: typeof P.$inferSelect): Promise<string> {
  const t = session.tenantId;
  const pos = await positionen(t, p.id);
  const text = zusammenfassung(pos.map((x) => ({ befund: x.befund, entscheidung: x.entscheidung, erstattet: x.erstattetBetrag })));
  await db.update(P).set({ status: "abgeschlossen", abgeschlossenAm: new Date(), zusammenfassung: text, updatedAt: new Date() }).where(and(eq(P.tenantId, t), eq(P.id, p.id)));
  // Fall-Pakete, RET-SKUs und Ansprüche im Hintergrund – die Ansage kommt sofort.
  after(async () => {
    const { nachAbschluss } = await import("./fall");
    await nachAbschluss(t, p.id).catch((e) => console.error("[Retouren-Station] Abschluss:", e instanceof Error ? e.message : e));
  });
  return text;
}

async function letztePosition(tenantId: string, pruefungId: string) {
  const [x] = await db.select().from(Pos).where(and(eq(Pos.tenantId, tenantId), eq(Pos.pruefungId, pruefungId))).orderBy(desc(Pos.nr)).limit(1);
  return x ?? null;
}

export async function entscheidungFuer(tenantId: string, x: typeof Pos.$inferSelect, befund: RetourenBefund | null) {
  const schwelle = (await getSettings(tenantId)).retourenStation.minBetrag;
  // Erstattung/Zahlung frisch lesen – die Berichte können seit dem Scan neu gekommen sein.
  const erstattet = x.bestellnummer ? await erstattetFuer(tenantId, x.bestellnummer, x.sku) : null;
  const gezahlt = x.bestellnummer ? await gezahltFuer(tenantId, x.bestellnummer, x.sku) : 0;
  const lauf = x.bestellnummer ? await laufenderFall(tenantId, x.bestellnummer, x.anspruchSchluessel ?? `station:${x.id}`) : false;
  return { entscheidung: entscheide({ befund, bestellnummer: x.bestellnummer, erstattet, amazonGezahlt: gezahlt, laufenderFall: lauf, schwelle }), erstattet, gezahlt };
}

export async function befehl(session: Session, pruefungId: string | null, b: Befehl): Promise<Antwort> {
  const t = session.tenantId;
  let p = await aktuellePruefung(t, session.userId, pruefungId);
  const antwort = async (ansage: string, ton: Ton = "ok", opts: { remissionenAuswahl?: boolean; id?: string } = {}) => ({ ansage, ton, stand: await stationStand(session, opts.id ?? p?.id ?? null, opts) });

  switch (b.befehl) {
    case "hilfe":
      return antwort(HILFE_TEXT);
    case "wiederholen":
      return antwort("", "ok"); // die Seite wiederholt ihre letzte Ansage selbst
    case "neues_paket": {
      let vorher = "";
      if (p && p.status === "offen") {
        const pos = await positionen(t, p.id);
        if (pos.length || (await db.select({ n: sql<number>`count(*)::int` }).from(M).where(and(eq(M.tenantId, t), eq(M.pruefungId, p.id))))[0].n > 0) vorher = `Vorheriges Paket abgeschlossen: ${await abschliessen(session, p)} `;
        else await db.update(P).set({ status: "abgebrochen", updatedAt: new Date() }).where(and(eq(P.tenantId, t), eq(P.id, p.id)));
      }
      p = await neuePruefung(session);
      return antwort(`${vorher}Neues Paket. Etikett zeigen und Etikett sagen.`, "ok", { id: p.id });
    }
  }

  if (!p || p.status !== "offen") return antwort("Kein offenes Paket. Sage Neues Paket.", "fehler");

  switch (b.befehl) {
    case "fertig": {
      const text = await abschliessen(session, p);
      return antwort(`Paket fertig. ${text}`);
    }
    case "abbrechen": {
      const pos = await positionen(t, p.id);
      if (pos.length) return antwort("Paket hat schon Artikel. Zum Beenden Fertig sagen, Fehler mit Löschen zurücknehmen.", "warnung");
      await db.update(P).set({ status: "abgebrochen", updatedAt: new Date() }).where(and(eq(P.tenantId, t), eq(P.id, p.id)));
      return antwort("Paket abgebrochen.");
    }
    case "loeschen": {
      // Schritt zurück: letztes Foto löschen; ohne Foto den letzten Befund.
      const [m] = await db.select().from(M).where(and(eq(M.tenantId, t), eq(M.pruefungId, p.id), isNull(M.geloeschtAm), sql`${M.art} <> 'video'`)).orderBy(desc(M.aufgenommenAm)).limit(1);
      const x = await letztePosition(t, p.id);
      if (x?.befund && (!m || x.updatedAt > m.aufgenommenAm)) {
        await db.update(Pos).set({ befund: null, entscheidung: null, updatedAt: new Date() }).where(eq(Pos.id, x.id));
        return antwort(`Befund von Artikel ${x.nr} zurückgenommen.`);
      }
      if (!m) return antwort("Nichts zum Löschen.", "warnung");
      await medienLoeschen(m);
      // Produktfoto weg und sonst nichts an der Position → Position auch weg
      if (m.art === "produkt_lpn" && m.positionId) {
        const rest = await db.select({ n: sql<number>`count(*)::int` }).from(M).where(and(eq(M.positionId, m.positionId), isNull(M.geloeschtAm)));
        const [pos] = await db.select().from(Pos).where(eq(Pos.id, m.positionId));
        if (pos && !pos.befund && rest[0].n === 0) await db.delete(Pos).where(eq(Pos.id, pos.id));
      }
      return antwort(`${ART_TEXT[m.art]} gelöscht.`);
    }
    case "notiz": {
      const x = await letztePosition(t, p.id);
      if (x) {
        await db.update(Pos).set({ notiz: [x.notiz, b.text].filter(Boolean).join(" · ").slice(0, 2000), updatedAt: new Date() }).where(eq(Pos.id, x.id));
        return antwort(`Notiz zu Artikel ${x.nr} gespeichert.`);
      }
      await db.update(P).set({ notiz: [p.notiz, b.text].filter(Boolean).join(" · ").slice(0, 2000), updatedAt: new Date() }).where(eq(P.id, p.id));
      return antwort("Notiz zum Paket gespeichert.");
    }
    case "zustand": {
      const x = await letztePosition(t, p.id);
      if (!x) return antwort("Erst Produkt zeigen und Produkt sagen.", "fehler");
      const { entscheidung, erstattet, gezahlt } = await entscheidungFuer(t, x, b.befund);
      const kiFertig = x.kiEinschaetzung && !("status" in x.kiEinschaetzung) ? (x.kiEinschaetzung as ProduktKi) : null;
      const warn = kiFertig ? kiWarnung(b.befund, kiFertig) : null;
      const vorschlag = verbleibVorschlag(b.befund, { gebrauchsspuren: kiFertig?.gebrauchsspuren, grund: x.rueckgabegrund });
      await db
        .update(Pos)
        .set({ befund: b.befund, entscheidung, erstattetBetrag: erstattet ?? x.erstattetBetrag, amazonGezahlt: gezahlt, kiAbweichung: Boolean(warn), updatedAt: new Date() })
        .where(eq(Pos.id, x.id));
      const v = vorschlag ? ` Vorschlag: ${VERBLEIB_TEXT[vorschlag]}.` : "";
      return antwort(`${ansageBefund(b.befund, entscheidung, erstattet ?? x.erstattetBetrag, warn)}${v}`, warn ? "warnung" : "ok");
    }
    case "verbleib": {
      const x = await letztePosition(t, p.id);
      if (!x) return antwort("Erst Produkt zeigen.", "fehler");
      await db.update(Pos).set({ verbleib: b.verbleib, updatedAt: new Date() }).where(eq(Pos.id, x.id));
      return antwort(`Verbleib: ${VERBLEIB_TEXT[b.verbleib]}.`);
    }
    case "code": {
      // SKU/FNSKU/LPN per Sprache oder Handscanner – letzten Artikel (noch ohne Zuordnung) füllen, sonst neuen anlegen.
      const z = await ordneZu(t, b.wert);
      const x = await letztePosition(t, p.id);
      const ziel = x && !x.befund && x.zuordnung === "unbekannt" ? x : null;
      const pos = await positionSpeichern(t, p, z, ziel);
      return antwort(ansageProdukt({ titel: pos.titel, grund: pos.rueckgabegrund, erstattet: pos.erstattetBetrag, zuordnung: pos.zuordnung, amazonGezahlt: pos.amazonGezahlt }) + (await schonGeprueft(t, pos)), pos.zuordnung === "unbekannt" ? "fehler" : "ok");
    }
    case "remission": {
      if (!b.wert) return antwort("Offene Remissionen auf dem Bildschirm. Sage Remission und die Nummer.", "ok", { remissionenAuswahl: true });
      const liste = await offeneRemissionen(t);
      const n = Number(b.wert);
      const id = Number.isInteger(n) && n >= 1 && n <= liste.length ? liste[n - 1].id : b.wert;
      const r = await remissionPerId(t, id);
      if (!r) return antwort(`Remission ${b.wert} nicht gefunden.`, "fehler", { remissionenAuswahl: true });
      await db.update(P).set({ remissionId: r.id, zuordnung: "manuell", erwartet: r.erwartet, versender: p.versender ?? r.versender, abweichungen: p.lieferschein ? vergleicheLieferschein(r.erwartet, p.lieferschein) : p.abweichungen, updatedAt: new Date() }).where(eq(P.id, p.id));
      return antwort(ansageEtikett(r.id, r.erwartet.length));
    }
    case "nochmal":
    case "etikett":
    case "lieferschein":
    case "produkt":
    case "naechstes":
    case "foto":
      // Diese Befehle machen ein Foto – das schickt die Seite über „foto“.
      return antwort("Foto fehlt.", "fehler");
  }
  return antwort("Nicht verstanden.", "fehler");
}

const ART_TEXT: Record<RetourenMedienArt, string> = { etikett: "Etikett-Foto", lieferschein: "Lieferschein-Foto", produkt_lpn: "Produktfoto", inhalt: "Inhaltsfoto", video: "Video" };

async function medienLoeschen(m: typeof M.$inferSelect) {
  if (m.art === "video") for (let i = 1; i <= m.teile; i++) await loeschen(teilSchluessel(m.pfad, i));
  else {
    await loeschen(m.pfad);
    await loeschen(kleinSchluessel(m.pfad));
  }
  await db.update(M).set({ geloeschtAm: new Date() }).where(eq(M.id, m.id));
}

async function positionSpeichern(tenantId: string, p: typeof P.$inferSelect, z: Zuordnung, ziel: typeof Pos.$inferSelect | null) {
  const felder = { zuordnung: z.zuordnung, lpn: z.lpn ?? null, fnsku: z.fnsku ?? null, sku: z.sku ?? null, asin: z.asin ?? null, titel: z.titel ?? null, bestellnummer: z.bestellnummer ?? null, rueckgabeDatum: z.rueckgabeDatum ?? null, rueckgabegrund: z.rueckgabegrund ?? null, kundenkommentar: z.kundenkommentar ?? null, amazonZustand: z.amazonZustand ?? null, erstattetBetrag: z.erstattetBetrag ?? null, amazonGezahlt: z.amazonGezahlt ?? null, updatedAt: new Date() };
  if (ziel) {
    const [x] = await db.update(Pos).set(felder).where(eq(Pos.id, ziel.id)).returning();
    return x;
  }
  const [{ nr }] = await db.select({ nr: sql<number>`coalesce(max(${Pos.nr}), 0)::int + 1` }).from(Pos).where(and(eq(Pos.tenantId, tenantId), eq(Pos.pruefungId, p.id)));
  const [x] = await db.insert(Pos).values({ tenantId, pruefungId: p.id, nr, ...felder }).returning();
  // Ohne Remission: über den Artikel (LPN) gibt es oft keinen Bezug – trotzdem dokumentieren.
  if (!p.remissionId && !p.zuordnung) await db.update(P).set({ zuordnung: "artikel", updatedAt: new Date() }).where(eq(P.id, p.id));
  return x;
}

/** Wurde diese LPN schon einmal geprüft? Dann kurz warnen (doppelter Fall vermeiden). */
async function schonGeprueft(tenantId: string, x: typeof Pos.$inferSelect): Promise<string> {
  if (!x.lpn) return "";
  const [d] = await db
    .select({ am: Pos.createdAt })
    .from(Pos)
    .where(and(eq(Pos.tenantId, tenantId), sql`lower(${Pos.lpn}) = lower(${x.lpn})`, sql`${Pos.id} <> ${x.id}`))
    .orderBy(desc(Pos.createdAt))
    .limit(1);
  return d ? ` Achtung: diese LPN wurde am ${d.am.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })} schon geprüft.` : "";
}

// ---- Fotos ------------------------------------------------------------------------------------------

export type FotoEingabe = { art: Exclude<RetourenMedienArt, "video">; voll: Uint8Array; klein: Uint8Array | null; code: string | null; ersetzen: boolean; neuerArtikel: boolean };

export async function foto(session: Session, pruefungId: string | null, f: FotoEingabe): Promise<Antwort> {
  const t = session.tenantId;
  let p = await aktuellePruefung(t, session.userId, pruefungId);
  // Etikett ohne „Neues Paket“: Paket automatisch anlegen (eine Ansage weniger).
  if ((!p || p.status !== "offen") && f.art === "etikett") p = await neuePruefung(session);
  if (!p || p.status !== "offen") return { ansage: "Kein offenes Paket. Sage Neues Paket.", ton: "fehler", stand: await stationStand(session, null) };
  const settings = await getSettings(t);

  // „Nochmal“: letztes Foto dieser Art ersetzen
  if (f.ersetzen) {
    const [alt] = await db.select().from(M).where(and(eq(M.tenantId, t), eq(M.pruefungId, p.id), eq(M.art, f.art), isNull(M.geloeschtAm))).orderBy(desc(M.aufgenommenAm)).limit(1);
    if (alt) await medienLoeschen(alt);
  }

  // Zu welchem Artikel gehört das Foto?
  let position: typeof Pos.$inferSelect | null = null;
  let ansage = "";
  let ton: Ton = "ok";
  if (f.art === "produkt_lpn") {
    let code = f.code ? erkenneCode(f.code)?.wert ?? f.code : null;
    // Kein Barcode erkannt: KI liest den Klartext unter dem Barcode
    if (!code && f.klein) {
      const txt = await frageKi(t, [bild(f.klein), { type: "text", text: 'Lies auf diesem Foto die LPN (beginnt mit „LPN“, dann 2 Buchstaben und 9 Ziffern), sonst die FNSKU (X00…) oder EAN. Antworte nur mit JSON: {"code": string|null}' }], 200);
      const m = txt ? /"code"\s*:\s*"([^"]+)"/.exec(txt) : null;
      code = m ? (erkenneCode(m[1])?.wert ?? null) : null;
    }
    const letzte = await letztePosition(t, p.id);
    const wiederverwenden = letzte && !letzte.befund && (letzte.zuordnung === "unbekannt" || f.ersetzen) && !f.neuerArtikel;
    const z: Zuordnung = code ? await ordneZu(t, code) : { zuordnung: "unbekannt" };
    position = await positionSpeichern(t, p, z, wiederverwenden ? letzte : null);
    ansage = ansageProdukt({ titel: position.titel, grund: position.rueckgabegrund, erstattet: position.erstattetBetrag, zuordnung: position.zuordnung, amazonGezahlt: position.amazonGezahlt }) + (await schonGeprueft(t, position));
    if (position.zuordnung === "unbekannt") ton = "fehler";
    else if (position.zuordnung === "lpn" && !position.bestellnummer) {
      ansage = `LPN ${position.lpn} nicht im Kundenretouren-Bericht. Artikel wird trotzdem dokumentiert.`;
      ton = "warnung";
    }
  } else if (f.art === "inhalt") {
    position = await letztePosition(t, p.id);
    if (!position) return { ansage: "Erst Produkt zeigen und Produkt sagen.", ton: "fehler", stand: await stationStand(session, p.id) };
  }

  const pfad = neuerSchluessel(t);
  await speichern(pfad, f.voll);
  if (f.klein) await speichern(kleinSchluessel(pfad), f.klein);
  const [{ nr }] = await db.select({ nr: sql<number>`coalesce(max(${M.nr}), 0)::int + 1` }).from(M).where(and(eq(M.tenantId, t), eq(M.pruefungId, p.id), eq(M.art, f.art), position ? eq(M.positionId, position.id) : sql`true`, isNull(M.geloeschtAm)));
  const [medium] = await db
    .insert(M)
    .values({ tenantId: t, pruefungId: p.id, positionId: position?.id ?? null, art: f.art, nr, pfad, mime: "image/jpeg", groesse: f.voll.length, loeschenAb: addDaysIso(todayIso(), settings.retourenStation.aufbewahrungTage) })
    .returning();

  if (f.art === "etikett") {
    const txt = f.klein ? await frageKi(t, [bild(f.klein), { type: "text", text: PROMPT_ETIKETT }], 400) : null;
    const e = txt ? jsonAus(txt, EtikettSchema) : null;
    if (e) await db.update(M).set({ kiDaten: { sendungsnummer: e.sendungsnummer, versender: e.versender, remissions_id: e.remissions_id, unsicher: e.unsicher } }).where(eq(M.id, medium.id));
    const r = e ? await findeRemission(t, { tracking: e.sendungsnummer, remissionsId: e.remissions_id }) : null;
    await db
      .update(P)
      .set({ sendungsnummer: e?.sendungsnummer ?? p.sendungsnummer, versender: e?.versender ?? r?.versender ?? p.versender, ...(r ? { remissionId: r.id, zuordnung: "etikett" as const, erwartet: r.erwartet } : {}), updatedAt: new Date() })
      .where(eq(P.id, p.id));
    if (!txt) ansage = "Etikett gespeichert. Ohne KI keine Texterkennung – sage Remission manuell.";
    else ansage = ansageEtikett(r?.id ?? null, r?.erwartet.length ?? null);
    if (!r) ton = "warnung";
    return { ansage, ton, stand: await stationStand(session, p.id, { remissionenAuswahl: !r }) };
  }

  if (f.art === "lieferschein") {
    const txt = f.klein ? await frageKi(t, [bild(f.klein), { type: "text", text: PROMPT_LIEFERSCHEIN }], 1500) : null;
    const l = txt ? jsonAus(txt, LieferscheinSchema) : null;
    if (!l) return { ansage: txt === null ? "Lieferschein gespeichert." : "Lieferschein gespeichert, aber nicht lesbar.", ton: txt === null ? "ok" : "warnung", stand: await stationStand(session, p.id) };
    await db.update(M).set({ kiDaten: { remissions_id: l.remissions_id, positionen: l.positionen.length, unsicher: l.unsicher } }).where(eq(M.id, medium.id));
    const zeilen: RetourenZeile[] = l.positionen.map((x) => ({ sku: x.sku ?? null, fnsku: x.fnsku ?? null, titel: x.titel ?? null, menge: x.menge }));
    let erwartet = p.erwartet;
    let remissionId = p.remissionId;
    if (!remissionId && l.remissions_id) {
      const r = await remissionPerId(t, l.remissions_id);
      if (r) {
        remissionId = r.id;
        erwartet = r.erwartet;
      }
    }
    const abw = erwartet ? vergleicheLieferschein(erwartet, zeilen) : [];
    await db.update(P).set({ lieferschein: zeilen, abweichungen: abw, remissionId, erwartet, ...(remissionId && !p.remissionId ? { zuordnung: "lieferschein" as const } : {}), updatedAt: new Date() }).where(eq(P.id, p.id));
    ansage = abw.length ? `${abw.slice(0, 2).join(". ")}${abw.length > 2 ? `. Und ${abw.length - 2} weitere Abweichungen` : ""}.` : erwartet ? `Lieferschein passt, ${zeilen.length} Position${zeilen.length === 1 ? "" : "en"}.` : `Lieferschein gelesen, ${zeilen.length} Position${zeilen.length === 1 ? "" : "en"}.`;
    return { ansage, ton: abw.length ? "warnung" : "ok", stand: await stationStand(session, p.id) };
  }

  if (f.art === "inhalt" && position) {
    const anzahl = (await db.select({ n: sql<number>`count(*)::int` }).from(M).where(and(eq(M.positionId, position.id), eq(M.art, "inhalt"), isNull(M.geloeschtAm))))[0].n;
    ansage = `Foto ${anzahl} gespeichert.`;
    const pid = position.id;
    // Produktabgleich im Hintergrund; die Station holt das Ergebnis ab und warnt bei Abweichung.
    if (await ki(t)) {
      await db.update(Pos).set({ kiEinschaetzung: { status: "laeuft" } }).where(eq(Pos.id, pid));
      after(() => produktAbgleich(t, pid).catch((e) => console.error("[Retouren-Station] Produktabgleich:", e instanceof Error ? e.message : e)));
    }
  }
  return { ansage, ton, stand: await stationStand(session, p.id) };
}

/** KI vergleicht die Inhaltsfotos mit Titel und Amazon-Bild – nur Hinweis, der Befund des Menschen zählt. */
export async function produktAbgleich(tenantId: string, positionId: string) {
  const [x] = await db.select().from(Pos).where(and(eq(Pos.tenantId, tenantId), eq(Pos.id, positionId)));
  if (!x) return;
  const fotos = await db.select().from(M).where(and(eq(M.tenantId, tenantId), eq(M.positionId, positionId), inArray(M.art, ["inhalt", "produkt_lpn"]), isNull(M.geloeschtAm))).orderBy(asc(M.aufgenommenAm));
  const bilder: AiContent = [];
  for (const f of fotos.slice(-5)) {
    const b = await lesen(kleinSchluessel(f.pfad)).catch(() => null);
    if (b) bilder.push(bild(b));
  }
  let ref = false;
  if (x.asin) {
    const { katalogBild } = await import("@/lib/integrations/clients/amazon");
    const url = await katalogBild(tenantId, x.asin).catch(() => null);
    if (url) {
      const r = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
      if (r?.ok) {
        const typ = r.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
        bilder.push(bild(new Uint8Array(await r.arrayBuffer()), /^image\/(jpeg|png|webp|gif)$/.test(typ) ? typ : "image/jpeg"));
        ref = true;
      }
    }
  }
  if (!bilder.length) return;
  const txt = await frageKi(tenantId, [...bilder, { type: "text", text: promptProdukt({ titel: x.titel, asin: x.asin, mitReferenzbild: ref, amazonGrund: grundText(x.rueckgabegrund), kundenkommentar: x.kundenkommentar }) }], 900);
  const e = txt ? jsonAus(txt, ProduktSchema) : null;
  const [akt] = await db.select({ befund: Pos.befund }).from(Pos).where(eq(Pos.id, positionId));
  await db
    .update(Pos)
    .set({ kiEinschaetzung: e ? { ...e, referenzbild: ref } : { status: "fehler" }, kiAbweichung: Boolean(e && akt?.befund && kiWarnung(akt.befund, e)), updatedAt: new Date() })
    .where(eq(Pos.id, positionId));
}

// ---- Video ------------------------------------------------------------------------------------------

/** Ein Teil der Paket-Aufnahme (MediaRecorder liefert alle paar Sekunden ein Stück WebM). */
export async function videoTeil(session: Session, pruefungId: string, teil: number, daten: Uint8Array, mime: string) {
  const t = session.tenantId;
  const [p] = await db.select().from(P).where(and(eq(P.tenantId, t), eq(P.id, pruefungId)));
  if (!p) return { ok: false as const, fehler: "Paket nicht gefunden." };
  const settings = await getSettings(t);
  let [v] = await db.select().from(M).where(and(eq(M.tenantId, t), eq(M.pruefungId, p.id), eq(M.art, "video"), isNull(M.geloeschtAm)));
  if (!v) [v] = await db.insert(M).values({ tenantId: t, pruefungId: p.id, art: "video", pfad: neuerSchluessel(t), teile: 0, mime: mime.startsWith("video/") ? mime.slice(0, 60) : "video/webm", groesse: 0, loeschenAb: addDaysIso(todayIso(), settings.retourenStation.aufbewahrungTage) }).returning();
  await speichern(teilSchluessel(v.pfad, teil), daten);
  await db.update(M).set({ teile: sql`greatest(${M.teile}, ${teil})`, groesse: sql`${M.groesse} + ${daten.length}` }).where(eq(M.id, v.id));
  await db.update(P).set({ videoTeile: sql`greatest(${P.videoTeile}, ${teil})` }).where(eq(P.id, p.id));
  return { ok: true as const };
}

export const BEFUND_LANG = BEFUND_TEXT;
