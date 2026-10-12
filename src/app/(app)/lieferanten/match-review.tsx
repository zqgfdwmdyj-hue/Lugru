import { matchReviewAction } from "./actions";

/** Gründe, warum ein Titel-Treffer wohl nicht passt, und Knöpfe „passt“ / „falsches Produkt“. */
export function MatchReview({ feedId, offerId, issues, rejected }: { feedId: string; offerId: string; issues: string[]; rejected?: boolean }) {
  // „✓ passt“ nur, wenn es etwas zu bestätigen gibt (bei reinem ROI-Verdacht hilft die Stückzahl).
  const btn = (ok: "1" | "0" | "reset", label: string, title: string) => (
    <form action={matchReviewAction}>
      <input type="hidden" name="feedId" value={feedId} />
      <input type="hidden" name="offerId" value={offerId} />
      <input type="hidden" name="ok" value={ok} />
      <button className="btn btn-small" type="submit" title={title}>{label}</button>
    </form>
  );
  return (
    <div className="small stack" style={{ gap: 4, marginTop: 4 }} data-testid="match-review">
      {issues.map((t) => <div key={t}><span className="tag tag-warn">{t}</span></div>)}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {rejected ? (
          btn("reset", "Wieder aufnehmen", "Markierung „falsches Produkt“ zurücknehmen")
        ) : (
          <>
            {issues.length > 0 && btn("1", "✓ passt", "Amazon-Angebot ist der Artikel des Lieferanten – zählt dann normal")}
            {btn("0", "✗ falsch", "Anderes Produkt – wird ausgeblendet")}
          </>
        )}
      </div>
    </div>
  );
}
