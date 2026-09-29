import type { schema } from "@/db";
import { applyPriceCheck } from "@/app/(app)/actions";
import { formatEuro } from "@/lib/numbers";
import { donationShare } from "@/lib/pricing";

type Check = typeof schema.priceChecks.$inferSelect;

const shortPrice = (v: number | null) => (v === null ? "" : v.toFixed(2).replace(".", ","));

/** Kleines Kästchen in der Tabellenzeile: Status oder „Handel ab … €“. */
export function PriceCheckChip({ check }: { check: Check | undefined }) {
  if (!check) return null;
  if (check.status === "pending" || check.status === "running") return <span className="ai-chip">KI sucht …</span>;
  if (check.status === "error") return <span className="ai-chip" style={{ background: "var(--danger-soft)", color: "#7a1a12" }} title={check.error ?? ""}>KI: Fehler</span>;
  if (check.lowestPrice === null) return <span className="ai-chip" title={check.summary ?? ""}>KI: kein Preis</span>;
  const best = check.offers[0];
  return (
    <a className="ai-chip" href={best?.url} target="_blank" rel="noreferrer" title={`${best?.shop}: ${best?.title}`}>
      Handel ab {formatEuro(check.lowestPrice)}
    </a>
  );
}

/** Ausführliches Ergebnis mit Angeboten und Übernehmen-Knopf. */
export function PriceCheckBox({ check, eventId }: { check: Check; eventId?: string }) {
  if (check.status === "pending" || check.status === "running") {
    return <div className="ai-box small">KI erkennt das Produkt und sucht Preise im Internet … (dauert meist 30–90 Sekunden)</div>;
  }
  if (check.status === "error") return <div className="notice notice-error">Preisrecherche fehlgeschlagen: {check.error}</div>;
  return (
    <div className="ai-box stack" style={{ gap: 8 }}>
      <div>
        <div className="small muted">KI erkannt</div>
        <strong>{check.recognizedName}{check.recognizedVariant ? ` · ${check.recognizedVariant}` : ""}</strong>
        {check.summary && <div className="small" style={{ marginTop: 2 }}>{check.summary}</div>}
      </div>
      {check.offers.length > 0 ? (
        <div>
          {check.offers.map((o, i) => (
            <div key={i} className="ai-offer">
              <a href={o.url} target="_blank" rel="noreferrer" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={o.title}>{o.shop}</a>
              <span className="num" style={{ whiteSpace: "nowrap" }}>{formatEuro(o.price)}{o.unit ? <span className="muted"> ({o.unit})</span> : null}</span>
            </div>
          ))}
        </div>
      ) : <div className="small muted">Keine Angebote gefunden.</div>}
      <form action={applyPriceCheck} className="stack" style={{ gap: 6 }}>
        <input type="hidden" name="checkId" value={check.id} />
        {eventId && <input type="hidden" name="eventId" value={eventId} />}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <label className="small" htmlFor={`sp-${check.id}`}>Spendenpreis €</label>
          <input className="input input-compact num" id={`sp-${check.id}`} name="price" defaultValue={shortPrice(check.suggestedPrice)} inputMode="decimal" style={{ width: 80 }} />
          <button className="btn btn-small btn-primary" type="submit">Übernehmen</button>
        </div>
        {check.suggestedPrice !== null && <div className="small muted">Vorschlag: {Math.round(donationShare() * 100)} % vom günstigsten Preis, auf 10 Cent gerundet.</div>}
        <label className="small"><input type="checkbox" name="withName" /> Auch erkannten Namen übernehmen</label>
      </form>
      <div className="small muted">
        {check.searches ?? 0} Suchen · ca. {estimateCost(check)} · Preise ohne Gewähr, bitte kurz prüfen.
      </div>
    </div>
  );
}

/** Grobe Kosten der Recherche (Opus: 4 $/20 $ je Mio. Token, Websuche 10 $ je 1000). */
function estimateCost(c: Check) {
  const usd = ((c.inputTokens ?? 0) * 4 + (c.outputTokens ?? 0) * 20) / 1e6 + (c.searches ?? 0) * 0.01;
  return `${usd.toFixed(2).replace(".", ",")} $`;
}
