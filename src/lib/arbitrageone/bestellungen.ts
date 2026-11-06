import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIso } from "@/lib/dates";
import { ekVorschau } from "@/lib/ek-import/logic";
import { sellerboardCostMap, skuCostMap } from "@/lib/money/costs";
import { ensureSupplier } from "@/lib/purchasing/service";
import { aoBestellungenGruppieren, aoBestellungenLesen, bestellText, ekAusLieferungen, poStatusAus, positionGeliefert, sbCogWarnung, spaltenFehlerText, type AoBestellPosition, type AoStatus } from "./bestellungen-logic";
import { aoEinkaeufeSpeichern } from "./service";

// B30: ArbitrageOne-Export „Einkäufe“ → Einkauf → Bestellungen (Lieferant, Datum, Positionen, Menge, EK, Status).
// Schon bezahlt (Online-Einkauf): zählt nicht als offene Zahlung in der Liquidität. Wareneingang ins eigene Lager
// bucht der Import nicht (die Ware geht meist übers Prep Center zu FBA) – „geliefert“ setzt nur den Status.
// Dazu wie bisher die Einkaufszeilen (Lugru „gekauft“, Monatsrahmen, Wareneinkauf) und ein EK-Vorschlag je SKU.

export class AoBestellFehler extends Error {}

export const AO_QUELLE = "arbitrageone";

const PO = schema.purchaseOrders;
const POI = schema.purchaseOrderItems;
const r2 = (n: number) => Math.round(n * 100) / 100;

const STATUSWERTE: AoStatus[] = ["bestellt", "versendet", "teilweise", "geliefert", "storniert"];
const statusText = (p: AoBestellPosition) => p.status ?? (p.statusRoh ? `unbekannt: ${p.statusRoh}`.slice(0, 120) : null);

/** Produkt-IDs je ASIN (in Blöcken – Postgres mag keine riesigen Listen). */
async function produkteJeAsin(tenantId: string, asins: string[]) {
  const m = new Map<string, string>();
  const P = schema.products;
  for (let i = 0; i < asins.length; i += 1000) {
    const rows = await db.select({ id: P.id, asin: P.asin }).from(P).where(and(eq(P.tenantId, tenantId), inArray(P.asin, asins.slice(i, i + 1000))));
    for (const r of rows) m.set(r.asin, r.id);
  }
  return m;
}

export type AoBestellErgebnis = {
  text: string;
  bestellungen: number;
  positionen: number;
  ohne_zuordnung: number;
  neu: { bestellungen: number; positionen: number };
  aktualisiert: { bestellungen: number; positionen: number };
  schon_bekannt: number;
  uebersprungen_zeilen: number;
  spalten: Record<string, string>;
  preis: string;
  status_werte: Record<string, number>;
  einkaufszeilen: { neu: number; bekannt: number };
  ek_vorschlag: { id: string; skus: number; neu: number; geaendert: number; warnungen: number } | null;
  link: string;
};

/**
 * Bestellliste übernehmen. Dieselbe Bestellung bzw. Position aus der nächsten Tagesdatei wird nicht neu angelegt
 * (Schlüssel aus Bestellnummer/Positions-ID); ändern sich Status, Menge oder Preis, wird sie nachgeführt.
 */
export async function aoBestellungenImportieren(tenantId: string, userId: string | null, dateiname: string, roh: unknown[][], dateiImportId: string | null, o: { stand?: Date; heute?: string } = {}): Promise<AoBestellErgebnis> {
  const heute = o.heute ?? todayIso();
  // Stand der Datei (beim Nachverarbeiten: wann sie ursprünglich geholt wurde) – ältere Dateien drehen nichts zurück.
  const stand = o.stand ?? new Date();
  const l = aoBestellungenLesen(roh);
  if (!l.ok) throw new AoBestellFehler(spaltenFehlerText(l));
  if (!l.positionen.length) throw new AoBestellFehler(`ArbitrageOne – Bestellungen: keine Position mit gültiger ASIN, Datum und Menge (${l.uebersprungen} Zeilen übersprungen). Gelesen als: ${Object.entries(l.spalten).map(([f, s]) => `${f} = „${s}“`).join(", ")}.`);
  const bestellungen = aoBestellungenGruppieren(l.positionen);
  const produkte = await produkteJeAsin(tenantId, [...new Set(l.positionen.map((p) => p.asin))]);
  const z = { neuB: 0, aktB: 0, neuP: 0, aktP: 0, gleichP: 0, aelter: 0, ohne: 0 };
  const jetzt = new Date();
  for (const b of bestellungen) {
    await db.transaction(async (tx) => {
      const status = poStatusAus(b.positionen, heute);
      let [po] = await tx.select({ id: PO.id, status: PO.status, versand: PO.shippingCostGross, receivedAt: PO.receivedAt, datum: PO.orderDate }).from(PO).where(and(eq(PO.tenantId, tenantId), eq(PO.quelle, AO_QUELLE), eq(PO.externeId, b.schluessel)));
      const warNeu = !po;
      if (!po) {
        const supplierId = await ensureSupplier(tx, tenantId, b.lieferant);
        // Nummer „AO-<Bestellnummer>“; gibt es sie schon (andere Herkunft), mit Zähler.
        let nummer = b.nummer;
        for (let i = 2; (await tx.select({ id: PO.id }).from(PO).where(and(eq(PO.tenantId, tenantId), eq(PO.number, nummer)))).length; i++) nummer = `${b.nummer}-${i}`;
        [po] = await tx
          .insert(PO)
          .values({ tenantId, number: nummer, supplierId, status, orderDate: b.datum, supplierOrderNo: b.bestellnummer, shippingCostGross: b.versand, notes: "Aus ArbitrageOne (Export „Einkäufe“) – schon bezahlt, zählt nicht als offene Zahlung. Wareneingang ins eigene Lager nur von Hand.", receivedAt: status === "received" ? jetzt : null, createdBy: userId, quelle: AO_QUELLE, externeId: b.schluessel })
          .returning({ id: PO.id, status: PO.status, versand: PO.shippingCostGross, receivedAt: PO.receivedAt, datum: PO.orderDate });
        z.neuB++;
      }
      const schluessel = b.positionen.map((p) => `ao:${p.schluessel}`);
      const alt = new Map((await tx.select({ id: POI.id, key: POI.externerSchluessel, menge: POI.quantity, received: POI.received, preis: POI.unitCostGross, status: POI.externerStatus, productId: POI.productId, standAm: POI.externerStandAm }).from(POI).where(and(eq(POI.tenantId, tenantId), inArray(POI.externerSchluessel, schluessel)))).map((x) => [x.key!, x]));
      for (const p of b.positionen) {
        const key = `ao:${p.schluessel}`;
        const productId = produkte.get(p.asin) ?? null;
        if (!productId) z.ohne++;
        const received = p.status !== "storniert" && positionGeliefert(p, heute) ? p.menge : 0;
        const preis = String(p.ekBrutto ?? 0);
        const werte = { productId, quantity: p.menge, received, unitCostGross: preis, vatRate: String(p.ustSatz), externerStatus: statusText(p), externerStandAm: stand };
        const a = alt.get(key);
        if (!a) {
          await tx.insert(POI).values({ tenantId, poId: po.id, asin: p.asin, title: p.titel, sku: p.sku, externerSchluessel: key, ...werte });
          z.neuP++;
        } else if (a.standAm && a.standAm > stand) {
          // Neuere Datei schon verarbeitet (z. B. beim Nachverarbeiten alter Läufe) – nur die Zuordnung nachziehen.
          if (a.productId !== productId) await tx.update(POI).set({ productId }).where(eq(POI.id, a.id));
          z.aelter++;
        } else if (a.menge !== p.menge || a.received !== received || Math.abs(Number(a.preis) - Number(preis)) >= 0.0001 || a.status !== werte.externerStatus || a.productId !== productId) {
          await tx.update(POI).set(werte).where(eq(POI.id, a.id));
          z.aktP++;
        } else {
          if (!a.standAm || a.standAm < stand) await tx.update(POI).set({ externerStandAm: stand }).where(eq(POI.id, a.id));
          z.gleichP++;
        }
      }
      // Status der Bestellung aus allen gespeicherten Positionen (auch solchen, die diese Datei nicht mehr enthält).
      const alle = await tx.select({ status: POI.externerStatus }).from(POI).where(and(eq(POI.tenantId, tenantId), eq(POI.poId, po.id)));
      const neuStatus = poStatusAus(alle.map((x) => ({ status: (STATUSWERTE.includes(x.status as AoStatus) ? x.status : null) as AoStatus | null, datum: po.datum ?? b.datum })), heute);
      if (neuStatus !== po.status || (b.versand !== null && po.versand !== b.versand)) {
        await tx.update(PO).set({ status: neuStatus, ...(b.versand !== null ? { shippingCostGross: b.versand } : {}), ...(neuStatus === "received" && !po.receivedAt ? { receivedAt: jetzt } : {}), updatedAt: jetzt }).where(eq(PO.id, po.id));
        if (!warNeu) z.aktB++;
      }
    });
  }
  // Einkaufszeilen wie bisher (Lugru „gekauft“, Monatsrahmen, Wareneinkauf in der Liquidität) – ohne stornierte.
  const ein = await aoEinkaeufeSpeichern(
    tenantId,
    l.positionen.filter((p) => p.status !== "storniert").map((p) => ({ asin: p.asin, sku: p.sku, titel: p.titel, kaufdatum: p.datum, menge: p.menge, ekNetto: p.ekNetto === null ? null : r2(p.ekNetto), waehrung: p.waehrung, lieferant: p.lieferant, rechnung: p.bestellnummer })),
    dateiImportId,
  );
  const ek = await ekVorschlagAusBestellungen(tenantId, userId, [...new Set(l.positionen.map((p) => p.sku).filter((s): s is string => Boolean(s)))], heute);
  const zaehl = { bestellungen: bestellungen.length, positionen: l.positionen.length, ohneZuordnung: z.ohne };
  const pl = (n: number, e: string, m: string) => `${n} ${n === 1 ? e : m}`;
  const text = `${bestellText(zaehl)} · neu: ${pl(z.neuB, "Bestellung", "Bestellungen")} mit ${pl(z.neuP, "Position", "Positionen")}${z.aktB || z.aktP ? ` · aktualisiert: ${pl(z.aktB, "Bestellung", "Bestellungen")}, ${pl(z.aktP, "Position", "Positionen")}` : ""}${z.gleichP ? ` · schon bekannt: ${pl(z.gleichP, "Position", "Positionen")}` : ""}${z.aelter ? ` · ${pl(z.aelter, "Position", "Positionen")} schon mit neuerem Stand` : ""}${l.uebersprungen ? ` · ${l.uebersprungen} Zeilen ohne gültige ASIN/Datum/Menge übersprungen` : ""}${l.preisArt === "netto angenommen" ? " · EK-Spalte ohne netto/brutto im Namen – als netto gelesen" : ""}${ek ? ` · EK-Vorschlag für ${ek.skus} SKUs (${ek.neu} neu, ${ek.geaendert} geändert${ek.warnungen ? `, ${ek.warnungen} mit Warnung` : ""}) – noch nichts übernommen` : ""}.`;
  return {
    text,
    bestellungen: zaehl.bestellungen,
    positionen: zaehl.positionen,
    ohne_zuordnung: z.ohne,
    neu: { bestellungen: z.neuB, positionen: z.neuP },
    aktualisiert: { bestellungen: z.aktB, positionen: z.aktP },
    schon_bekannt: z.gleichP,
    uebersprungen_zeilen: l.uebersprungen,
    spalten: l.spalten,
    preis: l.preisArt,
    status_werte: l.statusWerte,
    einkaufszeilen: { neu: ein.neu, bekannt: ein.bekannt },
    ek_vorschlag: ek,
    link: "/einkauf?ansicht=arbitrageone",
  };
}

/**
 * B30.1.3: EK je SKU aus den gelieferten ArbitrageOne-Positionen (gewichteter Durchschnitt der letzten Lieferungen,
 * über alle bisher übernommenen Dateien) als Vorschlag in die EK-Liste – markiert „aus ArbitrageOne-Bestellungen“,
 * mit Warnung bei mehr als 10 % Abweichung zum sellerboard-COG. Nur wenn sich etwas ändern würde und nicht derselbe
 * Vorschlag schon offen ist. Übernommen wird erst von Hand (Einkauf → EK-Import).
 */
export async function ekVorschlagAusBestellungen(tenantId: string, userId: string | null, skus: string[], heute = todayIso()) {
  if (!skus.length) return null;
  const rows: AoBestellPosition[] = [];
  for (let i = 0; i < skus.length; i += 1000) {
    const teil = await db
      .select({ sku: POI.sku, asin: POI.asin, menge: POI.quantity, brutto: POI.unitCostGross, ust: POI.vatRate, status: POI.externerStatus, datum: PO.orderDate })
      .from(POI)
      .innerJoin(PO, eq(PO.id, POI.poId))
      .where(and(eq(POI.tenantId, tenantId), eq(PO.quelle, AO_QUELLE), inArray(POI.sku, skus.slice(i, i + 1000))));
    for (const r of teil) {
      if (!r.sku || !r.asin || !r.datum) continue;
      const brutto = Number(r.brutto);
      const status = (STATUSWERTE.includes(r.status as AoStatus) ? r.status : null) as AoStatus | null;
      rows.push({ zeile: 0, bestellnummer: null, positionsId: null, datum: r.datum, lieferant: null, asin: r.asin, sku: r.sku, fnsku: null, titel: null, menge: r.menge, ekNetto: brutto > 0 ? brutto / (1 + Number(r.ust) / 100) : null, ekBrutto: brutto, ustSatz: Number(r.ust), versand: null, status, statusRoh: null, lager: null, charge: null, waehrung: null });
    }
  }
  const ek = ekAusLieferungen(rows, heute);
  if (!ek.length) return null;
  const [aktuell, sb] = await Promise.all([skuCostMap(tenantId), sellerboardCostMap(tenantId)]);
  const v = ekVorschau(
    ek.map((e) => ({ sku: e.sku, asin: e.asin, costNet: e.ekNetto })),
    new Map([...aktuell.entries()].map(([k, c]) => [k, { cost: c.cost, source: c.source }])),
    new Set([...aktuell.keys(), ...sb.keys()]),
  );
  for (const zeile of v.zeilen) {
    const w = zeile.ekNeu === null ? null : sbCogWarnung(zeile.ekNeu, sb.get(zeile.sku));
    if (w) zeile.warnungen.push(w);
  }
  const relevant = v.zeilen.filter((x) => x.art === "neu" || x.art === "geaendert");
  if (!relevant.length) return null;
  // Derselbe Vorschlag ist schon offen → nicht noch einmal.
  const E = schema.ekImporte;
  const [offen] = await db.select({ zeilen: E.zeilen }).from(E).where(and(eq(E.tenantId, tenantId), eq(E.quelle, "ao_bestellungen"), eq(E.status, "vorschau"))).orderBy(desc(E.createdAt)).limit(1);
  const kennung = (z: { sku: string; ekNeu: number | null }[]) => z.map((x) => `${x.sku}=${x.ekNeu}`).sort().join("|");
  if (offen && kennung(offen.zeilen.filter((x) => x.art === "neu" || x.art === "geaendert")) === kennung(relevant)) return null;
  const anzahl: Record<string, number> = { neu: 0, geaendert: 0, gleich: 0, unbekannt: 0, warnungen: 0 };
  for (const x of v.zeilen) {
    anzahl[x.art]++;
    if (x.warnungen.length) anzahl.warnungen++;
  }
  const [neu] = await db
    .insert(E)
    .values({ tenantId, userId, dateiname: `EK-Vorschlag aus ArbitrageOne-Bestellungen (Ø letzte Lieferungen, ${heute})`, quelle: "ao_bestellungen", roh: ek.map((e, i) => ({ line: i + 1, asin: e.asin, sku: e.sku, costNet: e.ekNetto })), zeilen: v.zeilen, anzahl })
    .returning({ id: E.id });
  return { id: neu.id, skus: ek.length, neu: anzahl.neu, geaendert: anzahl.geaendert, warnungen: anzahl.warnungen };
}

/** Zählt die ArbitrageOne-Bestellungen (für Anzeigen). */
export async function aoBestellungenZahl(tenantId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(PO).where(and(eq(PO.tenantId, tenantId), eq(PO.quelle, AO_QUELLE)));
  return r?.n ?? 0;
}
