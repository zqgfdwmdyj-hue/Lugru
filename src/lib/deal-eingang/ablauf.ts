import "server-only";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { DealEingangZeile } from "@/db/tables/deal-eingang";
import { AMPEL_EMOJI } from "./logic";
import { DealEingangFehler } from "./service";

// Deal-Eingang nach der Prüfung: Meldung (Push/Discord), Knöpfe „In Bestellvorschläge“ (Einkaufsentwurf) und
// „Als B2B-Deal anlegen“, Trefferquote je Quelle mit realem ROI aus sellerboard.

const E = schema.dealEingaenge;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Meldung nach der Prüfung. ProfitPath: nur Grün/Gelb (Rot steht nur in der Liste). Von Hand auf der Seite
 * eingefügt: keine Meldung (man sieht das Ergebnis ja). Einmal je Eingang (bzw. je Update).
 */
export async function benachrichtigen(tenantId: string, id: string, o: { update?: boolean } = {}): Promise<{ push: number; discord: boolean } | null> {
  const [e] = await db.select().from(E).where(and(eq(E.tenantId, tenantId), eq(E.id, id)));
  if (!e || e.pruefung !== "fertig" || e.weg === "manuell") return null;
  if (e.pushAm && !o.update) return null;
  if (e.weg === "profitpath" && e.ampel !== "gruen" && e.ampel !== "gelb") return null;
  const { empfaenger, melden } = await import("@/lib/push/service");
  const an = await empfaenger(tenantId, "dealeingang");
  const titel = `${o.update ? "Update: " : ""}Deal ${e.ampel ? AMPEL_EMOJI[e.ampel] : "📄"}${e.quelle ? ` · ${e.quelle}` : ""}`;
  const r = await melden(tenantId, an, { titel, text: e.zusammenfassung ?? "Geprüft – bitte im Deal-Eingang ansehen.", link: `/deal-eingang/${e.id}` });
  await db.update(E).set({ pushAm: new Date() }).where(eq(E.id, e.id));
  // SMS (B13, falls eingerichtet): nur grüne Deals, deren Gewinn (empfohlene Menge × Gewinn/Stück) über der Schwelle liegt.
  if (e.ampel === "gruen" && !o.update) {
    const { getSettings } = await import("@/lib/settings");
    const schwelle = (await getSettings(tenantId)).mobil.sms.dealSchwelle;
    const best = e.zeilen.filter((z) => z.ampel === "gruen" && z.gewinn !== null).sort((a, b) => (b.gewinn ?? 0) * (b.empfohlen ?? 1) - (a.gewinn ?? 0) * (a.empfohlen ?? 1))[0];
    const summe = best ? (best.gewinn ?? 0) * (best.empfohlen ?? 1) : 0;
    if (best && summe >= schwelle) {
      const { smsMelden } = await import("@/lib/mobil/sms");
      await smsMelden(tenantId, { art: "deal", kern: `Grüner Deal${e.quelle ? ` (${e.quelle})` : ""}: ${best.bestesLand ?? ""} ${(best.gewinn ?? 0).toFixed(2).replace(".", ",")} € je Stück, ROI ${Math.round(best.roi ?? 0)} %${best.empfohlen ? `, empfohlen ${best.empfohlen} Stück` : ""}`.replace(/\s+/g, " "), schluessel: `deal:${e.id}`, bezug: `deal:${e.id}`, codes: ["KAUFEN n", "SPÄTER", "OK"] }).catch(() => null);
    }
  }
  return r;
}

/** Zeilen für die Knöpfe: gewählte Zeile, sonst alle nicht roten mit ASIN – sind alle rot, alle (bewusster Klick). */
function zeilenFuer(zeilen: DealEingangZeile[], nr: number | null): DealEingangZeile[] {
  const mitAsin = zeilen.filter((x) => x.asin);
  if (nr) return mitAsin.filter((x) => x.nr === nr);
  const nichtRot = mitAsin.filter((x) => x.ampel !== "rot");
  return nichtRot.length ? nichtRot : mitAsin;
}

/** „In Bestellvorschläge übernehmen“: Einkaufsentwurf beim Lieferanten (= Quelle) mit empfohlener Menge. */
export async function inBestellvorschlaege(tenantId: string, userId: string, id: string, nr: number | null): Promise<{ bestellungen: string[]; zeilen: number }> {
  const [e] = await db.select().from(E).where(and(eq(E.tenantId, tenantId), eq(E.id, id)));
  if (!e) throw new DealEingangFehler("Eingang nicht gefunden.");
  const z = zeilenFuer(e.zeilen, nr);
  if (!z.length) throw new DealEingangFehler("Keine Zeile mit ASIN – erst die ASIN eintragen und neu rechnen.");
  const { createDraftsFromSuggestions } = await import("@/lib/purchasing/service");
  const picks = z.map((x) => ({
    asin: x.asin!,
    quantity: Math.max(1, x.empfohlen ?? x.angebot.menge ?? x.angebot.moq ?? 1),
    supplier: e.quelle ?? "Deal-Eingang",
    unitCostGross: r2((x.ekNetto ?? x.angebot.ek ?? 0) * 1.19),
    title: x.titel ?? x.angebot.name,
  }));
  if (picks.some((p) => !(p.unitCostGross > 0))) throw new DealEingangFehler("Bei mindestens einer Zeile fehlt der EK – erst eintragen und neu rechnen.");
  const ids = await createDraftsFromSuggestions(tenantId, userId, picks);
  await db.update(E).set({ status: "bestellvorschlag", bestellungId: ids[0] ?? null, entschiedenAm: new Date() }).where(eq(E.id, e.id));
  return { bestellungen: ids, zeilen: picks.length };
}

/** „Als B2B-Deal anlegen“ (deal_anlegen): Entwurf ohne Freigabe – Insider-Infos gehen nie automatisch raus. */
export async function alsB2bDeal(tenantId: string, userId: string, id: string, nr: number | null): Promise<{ dealId: string; nr: number }> {
  const [e] = await db.select().from(E).where(and(eq(E.tenantId, tenantId), eq(E.id, id)));
  if (!e) throw new DealEingangFehler("Eingang nicht gefunden.");
  const [x] = zeilenFuer(e.zeilen, nr);
  if (!x) throw new DealEingangFehler("Keine passende Zeile mit ASIN.");
  if (!x.ekNetto) throw new DealEingangFehler("Für einen B2B-Deal braucht die Zeile einen EK.");
  const { DealEingabe } = await import("@/lib/b2b/eingabe");
  const { dealAnlegen } = await import("@/lib/b2b/service");
  const eingabe = DealEingabe.parse({
    asin: x.asin,
    ean: x.angebot.ean && /^\d{8,14}$/.test(x.angebot.ean) ? x.angebot.ean : null,
    titel: x.titel ?? x.angebot.name,
    marke: x.angebot.marke,
    ekNetto: x.ekNetto,
    moqLieferant: Math.max(1, x.angebot.moq ?? 1),
    hinweis: `Aus dem Deal-Eingang (${e.createdAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}) – Preis je Kunde festlegen, erst dann freischalten.`,
  });
  const d = await dealAnlegen(tenantId, userId, eingabe);
  await db.update(E).set({ status: "b2b", b2bDealId: d.id, entschiedenAm: new Date() }).where(eq(E.id, e.id));
  return { dealId: d.id, nr: d.nr };
}

/**
 * Realer ROI gekaufter Deals: Gewinn laut sellerboard (Monate ab Entscheidung) je eingesetztem EK – frühestens
 * nach 30 Tagen. Ergebnis je Eingang-ID.
 */
export async function realerRoi(tenantId: string, eingaenge: { id: string; entschiedenAm: Date | null; zeilen: DealEingangZeile[] }[], now = new Date()): Promise<Map<string, number>> {
  const reif = eingaenge.filter((e) => e.entschiedenAm && now.getTime() - e.entschiedenAm.getTime() >= 30 * 86_400_000);
  const asins = [...new Set(reif.flatMap((e) => e.zeilen.map((z) => z.asin).filter((a): a is string => !!a)))];
  const out = new Map<string, number>();
  if (!asins.length) return out;
  const S = schema.sellerboardSkuMonths;
  const ab = reif.reduce((m, e) => (e.entschiedenAm! < m ? e.entschiedenAm! : m), now).toISOString().slice(0, 7);
  const rows = await db.select({ asin: S.asin, month: S.month, units: S.units, netProfit: S.netProfit }).from(S).where(and(eq(S.tenantId, tenantId), inArray(S.asin, asins.slice(0, 1000)), gte(S.month, ab)));
  for (const e of reif) {
    const seit = e.entschiedenAm!.toISOString().slice(0, 7);
    let gewinn = 0;
    let einsatz = 0;
    for (const z of e.zeilen) {
      if (!z.asin || !z.ekNetto) continue;
      for (const r of rows.filter((x) => x.asin === z.asin && x.month >= seit)) {
        gewinn += Number(r.netProfit ?? 0);
        einsatz += (r.units ?? 0) * z.ekNetto;
      }
    }
    if (einsatz > 0) out.set(e.id, Math.round((gewinn / einsatz) * 100));
  }
  return out;
}
