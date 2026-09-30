import type { schema } from "@/db";
import { applyPriceCheck } from "@/app/(app)/actions";
import { formatEuro } from "@/lib/numbers";
import { donationShare } from "@/lib/pricing";
import { AI_MODE_INFO, AI_MODES, aiCostUsd, defaultAiMode, isAiMode } from "@/lib/ai-modes";

type Check = typeof schema.priceChecks.$inferSelect;

const shortPrice = (v: number | null) => (v === null ? "" : v.toFixed(2).replace(".", ","));

/** Kleines Kästchen in der Tabellenzeile: Status oder „Handel ab … €“. */
export function PriceCheckChip({ check }: { check: Check | undefined }) {
  if (!check) return null;
  if (check.status === "pending" || check.status === "running") return <span className="ai-chip">KI sucht …</span>;
  if (check.status === "error") return <span className="ai-chip" style={{ background: "var(--danger-soft)", color: "#7a1a12" }} title={check.error ?? ""}>KI: Fehler</span>;
  if (check.mode === "erkennen") return <span className="ai-chip" title={check.summary ?? ""}>KI: erkannt</span>;
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
      ) : <div className="small muted">{check.mode === "erkennen" ? "Nur erkannt – für Preise „Preis suchen“ wählen." : "Keine Angebote gefunden."}</div>}
      <form action={applyPriceCheck} className="stack" style={{ gap: 6 }}>
        <input type="hidden" name="checkId" value={check.id} />
        {eventId && <input type="hidden" name="eventId" value={eventId} />}
        {check.mode === "erkennen" ? (
          <div>
            <input type="hidden" name="withName" value="on" />
            <button className="btn btn-small btn-primary" type="submit">Namen übernehmen</button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <label className="small" htmlFor={`sp-${check.id}`}>Spendenpreis €</label>
              <input className="input input-compact num" id={`sp-${check.id}`} name="price" defaultValue={shortPrice(check.suggestedPrice)} inputMode="decimal" style={{ width: 80 }} />
              <button className="btn btn-small btn-primary" type="submit">Übernehmen</button>
            </div>
            {check.suggestedPrice !== null && <div className="small muted">Vorschlag: {Math.round(donationShare() * 100)} % vom günstigsten Preis, auf 10 Cent gerundet.</div>}
            <label className="small"><input type="checkbox" name="withName" /> Auch erkannten Namen übernehmen</label>
          </>
        )}
      </form>
      <div className="small muted">
        {isAiMode(check.mode) ? AI_MODE_INFO[check.mode].label : check.mode} · {check.searches ?? 0} Suchen · ca. {usd(aiCostUsd(check.mode, check.inputTokens, check.outputTokens, check.searches))}{check.mode !== "erkennen" ? " · Preise ohne Gewähr, bitte kurz prüfen." : ""}
      </div>
    </div>
  );
}

export const usd = (v: number) => `${v < 0.01 && v > 0 ? "<0,01" : v.toFixed(2).replace(".", ",")} $`;

/** Auswahl der KI-Stufe (für Formulare mit name="stufe"). */
export function AiModeSelect({ compact = false }: { compact?: boolean }) {
  const def = defaultAiMode();
  return (
    <div className="stack" style={{ gap: 4 }}>
      {AI_MODES.map((m) => (
        <label key={m} className="small" style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
          <input type="radio" name="stufe" value={m} defaultChecked={m === def} style={{ marginTop: 3 }} />
          <span><strong>{AI_MODE_INFO[m].label}</strong>{!compact && <span className="muted"> – {AI_MODE_INFO[m].hint}</span>}</span>
        </label>
      ))}
    </div>
  );
}
