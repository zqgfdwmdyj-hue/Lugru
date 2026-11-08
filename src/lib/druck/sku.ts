import "server-only";
import { and, eq, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { auftragAnlegen } from "./service";

// FNSKU-Etikett zu einer SKU (oder FNSKU/EAN/ASIN) drucken – vom Handy, aus der Etiketten-Seite und vom Scanner.

export type Artikel = { sku: string; fnsku: string | null; titel: string | null; asin: string | null; ean: string | null };

export async function artikelSuchen(tenantId: string, code: string): Promise<Artikel | null> {
  const c = code.trim();
  if (!c) return null;
  const L = schema.lots;
  const P = schema.products;
  const [r] = await db
    .select({ sku: L.sku, fnsku: L.fnsku, titel: P.title, asin: P.asin, ean: P.ean })
    .from(L)
    .innerJoin(P, eq(P.id, L.productId))
    .where(and(eq(L.tenantId, tenantId), or(eq(L.sku, c), sql`upper(${L.fnsku}) = upper(${c})`, eq(P.ean, c), sql`upper(${P.asin}) = upper(${c})`)))
    .orderBy(sql`${L.fnsku} is null`, sql`${L.purchaseDate} desc nulls last`)
    .limit(1);
  return r ?? null;
}

export async function fnskuDrucken(session: Session, code: string, anzahl: number, seite: string, o: { zustand?: string; zusatz?: string } = {}): Promise<{ ok: boolean; text: string; auftragId?: string; artikel?: Artikel }> {
  const a = await artikelSuchen(session.tenantId, code);
  if (!a) return { ok: false, text: `„${code}“ nicht gefunden (SKU, FNSKU, EAN oder ASIN).` };
  if (!a.fnsku) return { ok: false, text: `${a.sku}: keine FNSKU hinterlegt.`, artikel: a };
  const j = await auftragAnlegen(session, { vorlage: "fnsku", eingabe: { fnsku: a.fnsku, titel: a.titel ?? a.asin ?? a.sku, zustand: o.zustand ?? "Neu", zusatz: o.zusatz ?? "" }, anzahl, seite, titel: `FNSKU ${a.fnsku} (${a.sku})` });
  return { ok: true, text: `${anzahl}× FNSKU-Etikett ${a.fnsku} (${a.sku}) an QL-800 gesendet.`, auftragId: j.id, artikel: a };
}

