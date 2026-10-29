import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { addDaysIso, todayIso } from "@/lib/dates";
import { SubmitButton } from "@/components/submit-button";
import { dealAnlegenAction } from "../actions";
import { DealFelder, type DealFeldWerte } from "../deal-felder";

export default async function DealNeuPage({ searchParams }: { searchParams: Promise<{ angebot?: string; asin?: string; meldung?: string }> }) {
  const session = await requireArea("b2b");
  const sp = await searchParams;
  const t = session.tenantId;
  const S = schema.suppliers;
  const lieferanten = (await db.select({ id: S.id, code: S.code, name: S.name }).from(S).where(eq(S.tenantId, t)).orderBy(asc(S.code))).map((s) => ({ id: s.id, name: s.name ? `${s.name} (${s.code})` : s.code }));
  const w: DealFeldWerte = { asin: sp.asin?.toUpperCase(), frist: addDaysIso(todayIso(), 7) };
  let quelle: string | null = null;
  const angebotId = z.string().uuid().safeParse(sp.angebot);
  if (angebotId.success) {
    const O = schema.supplierOffers;
    const F = schema.supplierFeeds;
    const [o] = await db
      .select({ id: O.id, asin: O.asin, ean: O.ean, title: O.title, price: O.price, moq: O.moq, imageUrl: O.imageUrl, market: O.market, supplierId: F.supplierId, feed: F.name, gross: F.pricesGross })
      .from(O)
      .innerJoin(F, eq(F.id, O.feedId))
      .where(and(eq(O.tenantId, t), eq(O.id, angebotId.data)));
    if (o) {
      Object.assign(w, {
        angebotId: o.id,
        asin: o.asin ?? o.market?.asin ?? w.asin,
        ean: o.ean,
        titel: o.market?.title ?? o.title,
        bildUrl: o.imageUrl,
        supplierId: o.supplierId,
        // Bruttopreise der Liste → netto (19 %); bitte prüfen.
        ekNetto: o.price === null ? null : o.gross ? Math.round((Number(o.price) / 1.19) * 100) / 100 : Number(o.price),
        moqLieferant: o.moq ?? 1,
      });
      quelle = `Aus Preisliste „${o.feed}“${o.gross ? " (Bruttopreise – EK auf netto umgerechnet, bitte prüfen)" : ""}.`;
    }
  }
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/b2b">B2B-Deals</Link></div><h1>Deal anlegen</h1></div>
      </div>
      {sp.meldung && <div className="notice notice-warn" data-testid="deal-meldung">{sp.meldung}</div>}
      {quelle && <div className="notice notice-info">{quelle}</div>}
      <form action={dealAnlegenAction} className="card card-pad stack" style={{ gap: 12 }}>
        <DealFelder w={w} lieferanten={lieferanten} mitPreis />
        <div className="small muted">Der Deal startet als Entwurf. Danach rechnet das System die Prognose je Land (Keepa bzw. Amazon) – Freischalten erst mit Kundenpreis, Frist und Vertriebsfreigabe des Lieferanten.</div>
        <div><SubmitButton label="Als Entwurf anlegen" pendingLabel="Lege an …" testId="deal-anlegen" /></div>
      </form>
    </>
  );
}
