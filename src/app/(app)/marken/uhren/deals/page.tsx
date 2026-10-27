import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { dealResult } from "@/lib/watches/logic";
import { asDealLike, listDeals, requireFlip } from "@/lib/watches/service";
import { saveDealAction } from "../actions";
import { DealFields } from "../deal-fields";
import { FlipForm } from "../forms";
import { eur, FlipHead, pct, StatusTag } from "../ui";

const FILTERS = [
  { key: "offen", label: "Offen" },
  { key: "verkauft", label: "Verkauft" },
  { key: "verworfen", label: "Verworfen" },
  { key: "uebung", label: "Übung" },
  { key: "alle", label: "Alle" },
] as const;

/** Deal-Tagebuch: alle Uhren vom Beobachten bis zum Verkauf, echte und Übungs-Deals. */
export default async function DealsPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { session, brandName } = await requireFlip();
  const sp = await searchParams;
  const f = FILTERS.find((x) => x.key === sp.f)?.key ?? "offen";
  const today = todayIso();
  const all = await listDeals(session.tenantId);
  const shown = all.filter((d) => (f === "alle" ? true : f === "uebung" ? d.practice : f === "offen" ? !["verkauft", "verworfen"].includes(d.status) : d.status === f));
  return (
    <div className="flip stack" style={{ gap: 16 }}>
      <FlipHead title="Deals" brand={brandName} sub="Vom Beobachten über Ankauf bis zum Verkauf – mit Prüfliste, Rechnung und Lernnotiz." />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {FILTERS.map((x) => (
          <Link key={x.key} href={`/marken/uhren/deals?f=${x.key}`} className={`chip${f === x.key ? " active" : ""}`}>
            {x.label} · {all.filter((d) => (x.key === "alle" ? true : x.key === "uebung" ? d.practice : x.key === "offen" ? !["verkauft", "verworfen"].includes(d.status) : d.status === x.key)).length}
          </Link>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="small muted">Hier ist noch nichts. Unten einen Deal anlegen – zum Üben reicht eine Anzeige, die dich interessiert.</p>
      ) : (
        <ul className="flip-list" data-testid="deal-list">
          {shown.map((d) => {
            const r = dealResult(asDealLike(d), today);
            return (
              <li key={d.id} className={d.status === "verkauft" ? "done" : ""}>
                <div className="between" style={{ gap: 8, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <Link href={`/marken/uhren/deals/${d.id}`}><strong>{d.maker} {d.model ?? ""}</strong></Link>
                    <div className="small muted">{[d.reference, d.year, d.condition === "neu" ? "neu" : null, d.source].filter(Boolean).join(" · ") || "—"}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}><StatusTag status={d.status} practice={d.practice} /></div>
                </div>
                <div className="small" style={{ marginTop: 4 }}>
                  {d.buyPrice !== null ? `Ankauf ${eur(d.buyPrice)}` : d.askPrice !== null ? `Angebot ${eur(d.askPrice)}` : "noch kein Preis"}
                  {r ? ` · ${r.planned ? "geplant" : "Ergebnis"}: ${eur(r.profit)} (${pct(r.marginPct)})` : ""}
                  {r && !r.planned && r.days !== null ? ` · ${r.days} Tage` : ""}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section className="card card-pad stack" id="neu">
        <h2>Neuer Deal</h2>
        <FlipForm action={saveDealAction} submit="Deal anlegen" testid="deal-new">
          <DealFields short />
        </FlipForm>
        <p className="small muted">Danach öffnet sich der Deal mit Ankauf-Prüfliste, Rechnung und allen Feldern.</p>
      </section>
    </div>
  );
}
