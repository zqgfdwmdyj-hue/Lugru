import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { dealPrognose, gebuehrenFuer } from "@/lib/b2b/prognose";
import { keepaByCode, keepaKey } from "@/lib/integrations/clients/keepa";
import { sellerboardReorder } from "@/lib/purchasing/reorder";
import { getSettings } from "@/lib/settings";
import { dealAmpel, ekNettoAus, leseCode, rechneLand, type Ampel, type LandErgebnis } from "./logic";

// Deal-Ampel: ASIN/EAN/Link + EK + Menge → Gewinn je Land (aktuell und 90-Tage-Mittel, USt je Land), Abverkauf,
// empfohlene Menge, Ampel mit Begründung. Marktdaten wie im B2B-Scanner (Keepa DE/FR/IT/ES/UK, sonst Amazon-Angebote).

const r2 = (n: number) => Math.round(n * 100) / 100;
const STD48 = 48 * 3600_000;

export type DealPruefung = {
  asin: string;
  titel: string | null;
  andereAsins: string[];
  ekNetto: number;
  menge: number | null;
  laender: LandErgebnis[];
  ampel: Ampel;
  bestes: LandErgebnis | null;
  rot: string[];
  gelb: string[];
  begruendung: string;
  abverkauf: { unsProMonat: number | null; empfohlen: { von: number; bis: number } | null; tage: number | null };
  eigen: { bestand: number; unterwegs: number; proTag: number | null } | null;
  gebuehren: { provision: number; fba: number; geschaetzt: boolean };
  hinweise: string[];
};

/** EAN → ASIN über Keepa (Deutschland). Mehrere Treffer: der erste, die anderen als Hinweis. */
async function asinZuEan(tenantId: string, ean: string): Promise<{ asin: string; andere: string[] }> {
  const key = await keepaKey(tenantId);
  if (!key) throw new Error("Für eine EAN braucht die Deal-Ampel Keepa (Anbindungen → Keepa) – oder gleich die ASIN eingeben.");
  const { products } = await keepaByCode(key, [ean]);
  const asins = products.map((p) => String(p.asin ?? "")).filter((a) => /^[A-Z0-9]{10}$/.test(a));
  if (!asins.length) throw new Error(`Zur EAN ${ean} kennt Keepa keine ASIN.`);
  return { asin: asins[0], andere: asins.slice(1, 6) };
}

export async function dealPruefen(tenantId: string, e: { code: string; ek: number; ekIstNetto: boolean; menge: number | null; laender?: string[] }, now = Date.now()): Promise<DealPruefung> {
  const code = leseCode(e.code);
  if (!code) throw new Error("Bitte ASIN, EAN oder Amazon-Link eingeben.");
  if (!(e.ek > 0)) throw new Error("Bitte einen Einkaufspreis eingeben.");
  const s = await getSettings(tenantId);
  const cfg = s.dealAmpel;
  const { asin, andere } = "asin" in code ? { asin: code.asin, andere: [] } : await asinZuEan(tenantId, code.ean);
  const ekNetto = ekNettoAus(e.ek, e.ekIstNetto, s.vatRate);
  const laender = (e.laender?.length ? e.laender : cfg.laender).map((l) => l.toUpperCase()).slice(0, 8);
  const [p, geb] = await Promise.all([dealPrognose(tenantId, asin, { laender, kundenpreis: ekNetto, prepGebuehr: cfg.nebenkosten }, now), gebuehrenFuer(tenantId, asin)]);
  const hinweise = [...p.hinweise];
  const ergebnisse: LandErgebnis[] = Object.entries(p.prognose).map(([land, x]) => {
    // Ø 90 Tage und Tief in Landeswährung → EUR mit demselben Kurs wie der aktuelle Preis.
    const kurs = x.vk !== null && x.vkEur !== null && x.vk > 0 ? x.vkEur / x.vk : x.waehrung === "EUR" ? 1 : null;
    const zuEur = (v: number | null) => (v === null || kurs === null ? null : r2(v * kurs));
    if (x.abgerufen && now - Date.parse(x.abgerufen) > STD48) hinweise.push(`${land}: Keepa-Werte vom ${new Date(x.abgerufen).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })} – älter als 48 Stunden.`);
    return rechneLand(
      { land, vkEur: x.vkEur, vk90Eur: zuEur(x.vk90), tief12Eur: zuEur(x.tief12), mwstSatz: x.mwstSatz, verkaeufeMonat: x.verkaeufeMonat, angebote: x.angeboteFba === null && x.angeboteFbm === null ? null : (x.angeboteFba ?? 0) + (x.angeboteFbm ?? 0), amazonProzent: x.amazonProzent, aktionsmuster: x.aktionsmuster ?? null, fehler: x.fehler ?? null },
      geb,
      ekNetto,
      cfg.nebenkosten,
    );
  });
  const a = dealAmpel(ergebnisse, e.menge, cfg);

  // Eigener Bestand und Verkaufsgeschwindigkeit, falls wir die ASIN schon führen (sellerboard-Nachbestellung).
  const eigeneZeilen = await sellerboardReorder(tenantId)
    .then((r) => r.rows.filter((z) => z.asin === asin))
    .catch(() => []);
  const eigen = eigeneZeilen.length
    ? { bestand: eigeneZeilen.reduce((n, z) => n + z.fbaStock + z.reserved, 0), unterwegs: eigeneZeilen.reduce((n, z) => n + z.inbound, 0), proTag: eigeneZeilen.some((z) => z.salesVelocity !== null) ? r2(eigeneZeilen.reduce((n, z) => n + (z.salesVelocity ?? 0), 0)) : null }
    : null;
  if (eigen) hinweise.push(`Wir führen die ASIN schon: ${eigen.bestand} auf Lager${eigen.unterwegs ? `, ${eigen.unterwegs} unterwegs` : ""}${eigen.proTag !== null ? `, ${eigen.proTag} verkauft je Tag` : ""}.`);
  if (andere.length) hinweise.push(`Zur EAN gibt es weitere ASINs (Packungsgröße prüfen): ${andere.join(", ")}.`);
  const [prod] = await db.select({ title: schema.products.title }).from(schema.products).where(and(eq(schema.products.tenantId, tenantId), eq(schema.products.asin, asin))).limit(1);
  return { asin, titel: p.titel ?? prod?.title ?? null, andereAsins: andere, ekNetto, menge: e.menge, laender: ergebnisse, ampel: a.ampel, bestes: a.bestes, rot: a.rot, gelb: a.gelb, begruendung: a.begruendung, abverkauf: a.abverkauf, eigen, gebuehren: geb, hinweise };
}
