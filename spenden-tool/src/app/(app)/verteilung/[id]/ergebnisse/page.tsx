import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLogin } from "@/lib/auth";
import { loadEventView } from "@/lib/event-view";
import { STOCK_LABELS } from "@/lib/price-logic";
import { OutcomeList } from "./outcome-list";

/**
 * Nach der Verteilung: je Produkt „alles weg / wenig übrig / viel übrig“ – ein Tipp, sofort gespeichert. „Noch offen“
 * (keine Rückmeldung) ist etwas anderes als „viel übrig“ und zählt in der Statistik nicht mit.
 */
export default async function ErgebnissePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; q?: string; kat?: string }> }) {
  await requireLogin();
  const { id } = await params;
  const sp = await searchParams;
  const view = await loadEventView(id);
  if (!view) notFound();
  const rows = view.rows.map((r) => ({
    id: r.item.id,
    name: r.unnamed ? "Ohne Namen" : r.product.name,
    variant: r.product.variant,
    image: r.product.imageFileId ? `/datei/${r.product.imageFileId}` : null,
    category: r.product.category,
    stock: r.item.stock,
    outcome: r.item.outcome,
  }));
  return (
    <div className="stack area-ergebnisse" style={{ gap: 14 }}>
      <details className="card card-pad outcome-help">
        <summary><strong>Wie lief es?</strong> <span className="small muted">– so funktioniert’s</span></summary>
        <div className="small muted" style={{ marginTop: 6 }}>
          Ein Tipp je Produkt, wird sofort gespeichert; „↺ zurücksetzen“ macht es rückgängig. Grundlage der <Link href="/statistik">Statistik</Link>. „Noch offen“ heißt: keine Rückmeldung – das ist nicht dasselbe wie „viel übrig“.
        </div>
      </details>
      <OutcomeList eventId={id} rows={rows} stockLabels={STOCK_LABELS} initial={{ status: sp.status, q: sp.q, kat: sp.kat }} />
    </div>
  );
}
