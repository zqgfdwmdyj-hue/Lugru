import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { DealStatus, OfferMarket } from "@/db/schema";
import { appUrl } from "@/lib/oauth/state";
import { publicUrl } from "@/lib/public-url";
import { getIntegration } from "@/lib/integrations/store";
import { getSettings } from "@/lib/settings";
import { todayIso } from "@/lib/dates";
import type { DealEingabe } from "./eingabe";
import { besterMarkt, dealBlattText, preisWarnungen, reservierbar, unserVerdienst, vergebenAnteil, type Warnung } from "./logic";
import { dealPrognose, prognoseMitPreis } from "./prognose";

// Deals im Seller-System: Laden, Vertriebsfreigabe prüfen, Freischalten/Schließen, Discord-Meldungen, Deal-Blatt.
// Alle Abfragen filtern nach tenant_id.

const D = schema.deals;
const R = schema.dealReservierungen;
const K = schema.b2bKunden;
const LP = schema.lieferantenProfile;

/** Öffentliche Adresse für Kunden (Portal-Links in Discord/Mails): PUBLIC_URL, sonst APP_URL. */
export const portalBasis = () => publicUrl() ?? appUrl();
export const portalLink = (dealId?: string) => `${portalBasis()}/portal${dealId ? `/deals/${dealId}` : ""}`;

/** Eigener Bestand der ASIN bei Amazon (verfügbar, reserviert, unterwegs) und im eigenen Versand (FBM). */
export async function eigenerBestand(tenantId: string, asin: string): Promise<number> {
  const I = schema.amazonInventory;
  const [r] = await db
    .select({ n: sql<number>`coalesce(sum(${I.fulfillable} + ${I.reserved} + ${I.inboundWorking} + ${I.inboundShipped} + ${I.inboundReceiving} + ${I.mfnFulfillable}), 0)::int` })
    .from(I)
    .where(and(eq(I.tenantId, tenantId), eq(I.asin, asin)));
  return r?.n ?? 0;
}

export async function naechsteDealNr(tenantId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`coalesce(max(${D.nr}), 0)::int` }).from(D).where(eq(D.tenantId, tenantId));
  return (r?.n ?? 0) + 1;
}

export async function ladeDeal(tenantId: string, id: string) {
  const [d] = await db.select().from(D).where(and(eq(D.tenantId, tenantId), eq(D.id, id)));
  return d ?? null;
}
export type Deal = NonNullable<Awaited<ReturnType<typeof ladeDeal>>>;

export async function dealReservierungen(tenantId: string, dealId: string) {
  return db
    .select({ r: R, firma: K.firma, land: K.land, ustId: K.ustId, ustGueltig: K.ustGueltig })
    .from(R)
    .innerJoin(K, eq(K.id, R.kundeId))
    .where(and(eq(R.tenantId, tenantId), eq(R.dealId, dealId)))
    .orderBy(asc(R.createdAt));
}

/** Vertriebsfreigabe des Lieferanten: Wiederverkauf und Marktplatz müssen ausdrücklich „ja“ sein. */
export async function vertriebsfreigabe(tenantId: string, supplierId: string | null): Promise<{ ok: boolean; fehlt: string[]; profil: typeof LP.$inferSelect | null }> {
  if (!supplierId) return { ok: false, fehlt: ["Lieferant fehlt"], profil: null };
  const [p] = await db.select().from(LP).where(and(eq(LP.tenantId, tenantId), eq(LP.supplierId, supplierId)));
  const fehlt: string[] = [];
  if (p?.wiederverkaufErlaubt !== true) fehlt.push(p?.wiederverkaufErlaubt === false ? "Wiederverkauf nicht erlaubt" : "Wiederverkauf an Händler ungeklärt");
  if (p?.marktplatzErlaubt !== true) fehlt.push(p?.marktplatzErlaubt === false ? "Verkauf auf Amazon nicht erlaubt" : "Verkauf auf Marktplätzen ungeklärt");
  return { ok: fehlt.length === 0, fehlt, profil: p ?? null };
}

/** Was vor dem Freischalten fehlt (leer = bereit). */
export async function freischaltHindernisse(tenantId: string, d: Deal): Promise<string[]> {
  const out: string[] = [];
  if (d.status !== "entwurf") out.push("Nur Entwürfe können freigeschaltet werden.");
  if (d.kundenpreisNetto === null) out.push("Kundenpreis fehlt.");
  if (!d.frist) out.push("Reservierungsfrist fehlt.");
  else if (d.frist < todayIso()) out.push("Reservierungsfrist liegt in der Vergangenheit.");
  const f = await vertriebsfreigabe(tenantId, d.supplierId);
  if (!f.ok) out.push(`Vertriebsfreigabe des Lieferanten: ${f.fehlt.join(", ")}.`);
  return out;
}

export async function setzeStatus(tenantId: string, id: string, status: DealStatus, extra: Partial<typeof D.$inferInsert> = {}) {
  await db.update(D).set({ status, ...extra, updatedAt: new Date() }).where(and(eq(D.tenantId, tenantId), eq(D.id, id)));
}

/**
 * Freischalten: ab jetzt im Portal sichtbar. Discord-Meldung, wenn ein Webhook eingetragen ist; Abo-Mails nur,
 * wenn beim Freischalten ausdrücklich angehakt.
 */
export async function freischalten(tenantId: string, id: string, userId: string | null, o: { mails: boolean }): Promise<{ ok: true; mails: number; discord: boolean } | { ok: false; fehler: string }> {
  const d = await ladeDeal(tenantId, id);
  if (!d) return { ok: false, fehler: "Deal nicht gefunden." };
  const h = await freischaltHindernisse(tenantId, d);
  if (h.length) return { ok: false, fehler: h.join(" ") };
  await setzeStatus(tenantId, id, "aktiv", { freigeschaltetAm: new Date(), freigeschaltetVon: userId });
  const discord = await discordMelden(tenantId, id, "neu").catch((e) => {
    console.error("Discord B2B", e instanceof Error ? e.message : e);
    return { gesendet: false };
  });
  let mails = 0;
  if (o.mails) {
    const { aboMails } = await import("./abo");
    mails = (await aboMails(tenantId, id).catch(() => ({ gesendet: 0 }))).gesendet;
  }
  return { ok: true, mails, discord: discord.gesendet };
}

export async function schliessen(tenantId: string, id: string) {
  const d = await ladeDeal(tenantId, id);
  if (!d || d.status !== "aktiv") return;
  await setzeStatus(tenantId, id, "geschlossen", { geschlossenAm: new Date() });
  await discordMelden(tenantId, id, "geschlossen").catch((e) => console.error("Discord B2B", e instanceof Error ? e.message : e));
}

/** Nach jeder Reservierung: „fast weg“ melden, bei ausverkauft schließen. */
export async function nachReservierung(tenantId: string, id: string) {
  const d = await ladeDeal(tenantId, id);
  if (!d || d.status !== "aktiv") return;
  const alle = (await db.select({ kundeId: R.kundeId, menge: R.menge, status: R.status }).from(R).where(and(eq(R.tenantId, tenantId), eq(R.dealId, id))));
  const anteil = vergebenAnteil(d.maxGesamt, alle);
  if (anteil === null) return;
  const s = await getSettings(tenantId);
  if (anteil >= 1) await schliessen(tenantId, id);
  else if (anteil >= s.b2b.fastWegProzent) await discordMelden(tenantId, id, "fastWeg").catch(() => undefined);
}

// ---- Anlegen, Prognose, Preis ---------------------------------------------------------------------

/** Neuer Deal als Entwurf. Prognose separat (dauert je Land einige Sekunden) – siehe prognoseAktualisieren. */
export async function dealAnlegen(tenantId: string, userId: string | null, e: DealEingabe): Promise<{ id: string; nr: number }> {
  const s = await getSettings(tenantId);
  const bestand = await eigenerBestand(tenantId, e.asin);
  for (let versuch = 0; ; versuch++) {
    const nr = await naechsteDealNr(tenantId);
    try {
      const [row] = await db
        .insert(D)
        .values({
          tenantId,
          nr,
          asin: e.asin,
          ean: e.ean ?? null,
          titel: e.titel || e.asin,
          bildUrl: e.bildUrl ?? null,
          marke: e.marke ?? null,
          kategorie: e.kategorie ?? null,
          supplierId: e.supplierId ?? null,
          angebotId: e.angebotId ?? null,
          ekNetto: e.ekNetto,
          staffel: e.staffel,
          moqLieferant: e.moqLieferant,
          lieferzeitTage: e.lieferzeitTage ?? null,
          angebotGueltigBis: e.angebotGueltigBis ?? null,
          frist: e.frist ?? null,
          kundenpreisNetto: e.kundenpreisNetto ?? null,
          mindestmengeKunde: e.mindestmengeKunde,
          maxGesamt: e.maxGesamt ?? null,
          maxProKunde: e.maxProKunde ?? null,
          maxKunden: e.maxKunden ?? s.b2b.maxKundenProAsin,
          nurRestmenge: e.nurRestmenge || bestand > 0,
          eigenerBestand: bestand,
          versandAnteil: e.versandAnteil ?? s.b2b.versandAnteil,
          prepGebuehr: e.prepGebuehr ?? s.b2b.prepGebuehr,
          hinweis: e.hinweis ?? null,
          angelegtVon: userId,
        })
        .returning({ id: D.id });
      return { id: row.id, nr };
    } catch (err) {
      // Gleichzeitig angelegt → nächste Nummer.
      if (versuch < 3 && String((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) === "23505") continue;
      throw err;
    }
  }
}

/** Prognose je Land neu abfragen (Keepa/Amazon) und speichern; Titel aus Keepa, wenn noch keiner da ist. */
export async function prognoseAktualisieren(tenantId: string, id: string): Promise<{ hinweise: string[] }> {
  const d = await ladeDeal(tenantId, id);
  if (!d) return { hinweise: ["Deal nicht gefunden."] };
  const s = await getSettings(tenantId);
  let market: OfferMarket | null = null;
  if (d.angebotId) {
    const O = schema.supplierOffers;
    const [o] = await db.select({ m: O.market }).from(O).where(and(eq(O.tenantId, tenantId), eq(O.id, d.angebotId)));
    market = o?.m ?? null;
  }
  const r = await dealPrognose(tenantId, d.asin, { laender: s.b2b.marktplaetze, kundenpreis: d.kundenpreisNetto, prepGebuehr: d.prepGebuehr, market });
  const bestand = await eigenerBestand(tenantId, d.asin);
  await db
    .update(D)
    .set({ prognose: r.prognose, eigenerBestand: bestand, ...(d.titel === d.asin && r.titel ? { titel: r.titel.slice(0, 300) } : {}), updatedAt: new Date() })
    .where(and(eq(D.tenantId, tenantId), eq(D.id, id)));
  return { hinweise: r.hinweise };
}

/** Kundenpreis setzen und Kundenrechnung je Land neu rechnen. Nach Reservierungen nur noch mit `trotzReservierungen`. */
export async function preisSetzen(tenantId: string, id: string, preis: number, o: { trotzReservierungen?: boolean } = {}): Promise<{ ok: true; warnungen: Warnung[] } | { ok: false; fehler: string }> {
  const d = await ladeDeal(tenantId, id);
  if (!d) return { ok: false, fehler: "Deal nicht gefunden." };
  if (!["entwurf", "aktiv"].includes(d.status)) return { ok: false, fehler: "Der Deal ist geschlossen – Preis nicht mehr änderbar." };
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(R).where(and(eq(R.tenantId, tenantId), eq(R.dealId, id), sql`${R.status} not in ('storniert','erstattet')`));
  if (n.n > 0 && !o.trotzReservierungen) return { ok: false, fehler: `Es gibt schon ${n.n} Reservierung(en) – deren Preis bleibt; neuer Preis gilt nur für neue Reservierungen. Bitte bestätigen.` };
  const prognose = prognoseMitPreis(d.prognose, preis, d.prepGebuehr);
  await db.update(D).set({ kundenpreisNetto: preis, prognose, updatedAt: new Date() }).where(and(eq(D.tenantId, tenantId), eq(D.id, id)));
  const s = await getSettings(tenantId);
  const bester = besterMarkt(prognose);
  return { ok: true, warnungen: preisWarnungen({ verdienst: unserVerdienst({ ek: d.ekNetto, kundenpreis: preis, versandAnteil: d.versandAnteil }), besterRoi: bester?.roi ?? null, minRoiProzent: s.b2b.minKundenRoi * 100, kundenpreis: preis }) };
}

// ---- Deal-Blatt -----------------------------------------------------------------------------------

export async function dealBlatt(tenantId: string, d: Deal, preis: number | null = d.kundenpreisNetto) {
  const s = await getSettings(tenantId);
  const alle = await db.select({ kundeId: R.kundeId, menge: R.menge, status: R.status }).from(R).where(and(eq(R.tenantId, tenantId), eq(R.dealId, d.id)));
  const rb = reservierbar(d, alle, "-", todayIso());
  const laender = s.b2b.marktplaetze
    .filter((l) => d.prognose[l])
    .map((l) => {
      const p = d.prognose[l];
      return { land: l, vk: p.vkEur, gewinn: p.gewinnKunde, roi: p.roiKunde, verkaeufe: p.verkaeufeMonat, angebote: p.angeboteFba === null && p.angeboteFbm === null ? null : (p.angeboteFba ?? 0) + (p.angeboteFbm ?? 0) };
    });
  return {
    text: dealBlattText({ nr: d.nr, titel: d.titel, asin: d.asin, marke: d.marke, kundenpreisNetto: preis, mindestmengeKunde: d.mindestmengeKunde, maxProKunde: d.maxProKunde, rest: rb.rest, frist: d.frist, laender, link: portalLink(d.id) }),
    laender,
    rest: rb.rest,
    bester: besterMarkt(d.prognose),
    firma: s.b2b.firma,
  };
}

// ---- Discord --------------------------------------------------------------------------------------

const KOPF = { neu: "🆕 Neuer Deal", fastWeg: "⏳ Fast weg", geschlossen: "✅ Deal geschlossen" } as const;

/** Meldung in den B2B-Kanal – je Deal und Art nur einmal. Ohne Webhook passiert nichts. */
export async function discordMelden(tenantId: string, id: string, art: keyof typeof KOPF): Promise<{ gesendet: boolean; grund?: string }> {
  const url = (await getIntegration(tenantId, "discord_b2b"))?.webhookUrl;
  if (!url) return { gesendet: false, grund: "kein Webhook" };
  const d = await ladeDeal(tenantId, id);
  if (!d) return { gesendet: false, grund: "Deal fehlt" };
  if (d.discord[art]) return { gesendet: false, grund: "schon gemeldet" };
  const blatt = await dealBlatt(tenantId, d);
  const text = art === "neu" ? blatt.text : `Deal #${d.nr}: ${d.titel}${art === "fastWeg" && blatt.rest !== null ? ` – nur noch ${blatt.rest} Stück frei` : ""}\n${portalLink(d.id)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: `**${KOPF[art]}**\n${text}`.slice(0, 1990), allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Discord antwortet ${res.status}`);
  await db
    .update(D)
    .set({ discord: sql`${D.discord} || ${JSON.stringify({ [art]: new Date().toISOString() })}::jsonb` })
    .where(and(eq(D.tenantId, tenantId), eq(D.id, id)));
  return { gesendet: true };
}
