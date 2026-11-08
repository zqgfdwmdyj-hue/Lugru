import "server-only";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { scanEinordnen, steuerAnzahl, STEUER_CODES } from "./logic";
import { auftragAnlegen } from "./service";
import { artikelSuchen, fnskuDrucken, type Artikel } from "./sku";

// Scanner-Arbeitsplatz (Lager → Scannen): Handscanner als Tastatur. Artikel scannen → Produkt, Bestand, FBA-Bestand,
// offene Sendung. Steuer-Barcodes: Drucken 1×/5×, Wareneingang (Menge/Mehrfachscan, Stellplatz → gebucht),
// Stellplatz, Retoure (LPN → Retouren-Etikett), Abbrechen. Ablauf ohne Tastatur.

export type ScanZustand = { modus: "normal" | "wareneingang" | "retoure" | "stellplatz"; sku: string | null; menge: number };
export type ScanAnzeige = { artikel: (Artikel & { eigenesLager: number; fach: string | null; fba: number; sendung: string | null }) | null };
export type ScanErgebnis = { ok: boolean; text: string; zustand: ScanZustand; anzeige: ScanAnzeige };

export const SCAN_START: ScanZustand = { modus: "normal", sku: null, menge: 0 };

async function anzeige(tenantId: string, a: Artikel | null): Promise<ScanAnzeige> {
  if (!a) return { artikel: null };
  const [own] = await db.select({ q: schema.ownStock.quantity, fach: schema.ownStock.location }).from(schema.ownStock).where(and(eq(schema.ownStock.tenantId, tenantId), eq(schema.ownStock.sku, a.sku)));
  const [fba] = await db.select({ n: sql<number>`coalesce(sum(${schema.sellerboardInventory.fbaStock} + ${schema.sellerboardInventory.inbound}), 0)::int` }).from(schema.sellerboardInventory).where(and(eq(schema.sellerboardInventory.tenantId, tenantId), eq(schema.sellerboardInventory.sku, a.sku)));
  const [s] = await db
    .select({ name: schema.inboundShipments.name, status: schema.inboundShipments.status })
    .from(schema.inboundItems)
    .innerJoin(schema.inboundShipments, eq(schema.inboundShipments.id, schema.inboundItems.shipmentId))
    .where(and(eq(schema.inboundItems.tenantId, tenantId), eq(schema.inboundItems.sku, a.sku), notInArray(schema.inboundShipments.status, ["closed"])))
    .limit(1);
  return { artikel: { ...a, eigenesLager: own?.q ?? 0, fach: own?.fach ?? null, fba: fba?.n ?? 0, sendung: s ? `${s.name} (${s.status})` : null } };
}

async function buchen(session: Session, sku: string, menge: number, fach: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.ownStock)
      .values({ tenantId: session.tenantId, sku, productId: null, quantity: menge, location: fach })
      .onConflictDoUpdate({ target: [schema.ownStock.tenantId, schema.ownStock.sku], set: { quantity: sql`${schema.ownStock.quantity} + excluded.quantity`, location: sql`excluded.location`, updatedAt: new Date() } });
    await tx.insert(schema.stockMovements).values({ tenantId: session.tenantId, sku, delta: menge, reason: "Wareneingang (Scanner-Arbeitsplatz)", reference: `Fach ${fach}`, userId: session.userId });
  });
}

export async function scanVerarbeiten(session: Session, z: ScanZustand, roh: string): Promise<ScanErgebnis> {
  const t = scanEinordnen(roh);
  const aktuell = z.sku ? await artikelSuchen(session.tenantId, z.sku) : null;
  const fertig = async (ok: boolean, text: string, neu: ScanZustand, a: Artikel | null = aktuell): Promise<ScanErgebnis> => ({ ok, text, zustand: neu, anzeige: await anzeige(session.tenantId, a) });
  if (!t) return fertig(false, "Leere Eingabe.", z);
  if (t.art === "steuer") {
    switch (t.code) {
      case "LUGRU-ABBRECHEN":
        return fertig(true, "Abgebrochen.", SCAN_START, null);
      case "LUGRU-WARENEINGANG":
        return fertig(true, "Wareneingang: Artikel scannen, Menge tippen oder mehrfach scannen, dann Stellplatz scannen.", { modus: "wareneingang", sku: z.sku, menge: z.sku ? Math.max(1, z.menge) : 0 });
      case "LUGRU-STELLPLATZ":
        return fertig(true, z.sku ? "Stellplatz scannen (FACH-…)." : "Erst Artikel scannen, dann Stellplatz.", { ...z, modus: z.modus === "wareneingang" ? "wareneingang" : "stellplatz" });
      case "LUGRU-RETOURE":
        return fertig(true, "Retoure: LPN scannen – das Retouren-Etikett kommt aus dem QL-800.", { modus: "retoure", sku: null, menge: 0 }, null);
      default: {
        const n = steuerAnzahl(t.code);
        if (!aktuell) return fertig(false, `${STEUER_CODES[t.code]}: erst Artikel scannen.`, z);
        const r = await fnskuDrucken(session, aktuell.sku, n, "/lager/scannen");
        return fertig(r.ok, r.text, z);
      }
    }
  }
  if (z.modus === "retoure" && (t.art === "lpn" || t.art === "sku")) {
    const lpn = t.art === "lpn" ? t.wert : t.wert.toUpperCase();
    const P = schema.retourenPositionen;
    const [p] = await db.select({ retSku: P.retSku, lpn: P.lpn, titel: P.titel, sku: P.sku }).from(P).where(and(eq(P.tenantId, session.tenantId), sql`upper(${P.lpn}) = ${lpn}`)).limit(1);
    if (!p?.retSku) return fertig(false, `LPN ${lpn}: keine Retoure mit RET-SKU gefunden.`, z, null);
    await auftragAnlegen(session, { vorlage: "retoure", eingabe: { retSku: p.retSku, lpn: p.lpn ?? lpn, titel: p.titel ?? "" }, anzahl: 1, seite: "/lager/scannen" });
    return fertig(true, `Retouren-Etikett ${p.retSku} an QL-800 gesendet.`, z, null);
  }
  if (t.art === "menge") {
    if (z.modus !== "wareneingang" || !aktuell) return fertig(false, "Menge nur im Wareneingang nach dem Artikel.", z);
    return fertig(true, `Menge ${t.wert} – jetzt Stellplatz scannen.`, { ...z, menge: t.wert });
  }
  if (t.art === "fach") {
    if (!aktuell) return fertig(false, "Erst Artikel scannen.", z);
    if (z.modus === "wareneingang") {
      const menge = Math.max(1, z.menge);
      await buchen(session, aktuell.sku, menge, t.wert);
      return fertig(true, `Gebucht: ${menge} × ${aktuell.sku} auf Fach ${t.wert}.`, { modus: "wareneingang", sku: null, menge: 0 });
    }
    await db.update(schema.ownStock).set({ location: t.wert, updatedAt: new Date() }).where(and(eq(schema.ownStock.tenantId, session.tenantId), eq(schema.ownStock.sku, aktuell.sku)));
    return fertig(true, `${aktuell.sku}: Stellplatz ${t.wert}.`, { ...z, modus: "normal" });
  }
  // Artikel (FNSKU, EAN, SKU)
  const a = await artikelSuchen(session.tenantId, t.art === "ean" || t.art === "fnsku" || t.art === "sku" || t.art === "lpn" ? t.wert : roh);
  if (!a) return fertig(false, `„${roh.trim()}“ nicht gefunden.`, z);
  if (z.modus === "wareneingang") {
    const menge = z.sku === a.sku ? z.menge + 1 : 1;
    return fertig(true, `${a.sku}: Menge ${menge} (weiter scannen oder Stellplatz).`, { modus: "wareneingang", sku: a.sku, menge }, a);
  }
  return fertig(true, `${a.sku}${a.fnsku ? ` · ${a.fnsku}` : ""}`, { modus: "normal", sku: a.sku, menge: 0 }, a);
}

