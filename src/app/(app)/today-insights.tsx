import Link from "next/link";
import type { Session } from "@/lib/auth/session";
import { canAccess } from "@/lib/auth/areas";
import { loadSalesOverview } from "@/lib/sellerboard/sales";
import { loadHebel } from "@/lib/hebel/service";
import { sellerboardReorder } from "@/lib/purchasing/reorder";
import { reorderTotals } from "@/lib/purchasing/reorder-logic";
import { SalesOverviewSection } from "./sales-overview";
import { HebelTeaser } from "./hebel-teaser";

const eur0 = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

/**
 * Startseite unten: Umsatz & Ergebnis, Hebel, Nachbestellen. Läuft parallel und wird nachgeladen,
 * damit „Jetzt dringend“ und „Als Nächstes“ sofort stehen.
 */
export async function TodayInsights({ session }: { session: Session }) {
  const geld = canAccess(session, "geld");
  const [sales, hebel, reorder] = await Promise.all([
    // Verkäufe (sellerboard, Amazon + eBay) nur für wer „Geld“ sehen darf.
    geld ? loadSalesOverview(session.tenantId).catch(() => null) : null,
    geld ? loadHebel(session.tenantId).catch(() => null) : null,
    // Nachbestellen (sellerboard) kompakt – Details unter Einkauf → Bestellvorschläge.
    canAccess(session, "wawi") ? sellerboardReorder(session.tenantId).then((r) => (r.rows.length ? reorderTotals(r.rows) : null)).catch(() => null) : null,
  ]);
  if (!sales && !hebel && !reorder) return null;
  return (
    <div className="today-insights" data-testid="today-insights">
      {sales && <SalesOverviewSection data={sales} />}
      {sales && hebel && <HebelTeaser data={hebel} />}
      {reorder && (
        <section className="card card-pad" data-testid="reorder-teaser">
          <div className="between" style={{ gap: 8, flexWrap: "wrap" }}>
            <h2>Nachbestellen</h2>
            <Link href="/einkauf/vorschlaege?weg=sellerboard" className="small">Bestellvorschläge →</Link>
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            {reorder.byUrgency.ueberfaellig + reorder.byUrgency.jetzt} jetzt bzw. überfällig · {reorder.byUrgency.bald} bald · Kapitalbedarf netto <strong>{eur0(reorder.capital)}</strong> ({reorder.withCapital} Artikel mit gültigem EK)
          </div>
          {(reorder.noEk > 0 || reorder.returns > 0 || reorder.noSource > 0) && (
            <div className="small" style={{ marginTop: 4 }}>
              <span className="muted">Prüfen: </span>
              {[reorder.noEk ? <Link key="ek" href="/einkauf/vorschlaege?weg=sellerboard&pruefen=ek_fehlt">{reorder.noEk} ohne EK</Link> : null, reorder.returns ? <Link key="r" href="/einkauf/vorschlaege?weg=sellerboard&pruefen=retoure">{reorder.returns} Retouren</Link> : null, reorder.noSource ? <Link key="q" href="/einkauf/vorschlaege?weg=sellerboard&pruefen=quelle">{reorder.noSource} Bezugsquelle unklar</Link> : null]
                .filter(Boolean)
                .reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, " · ", el] : [el]), [])}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
