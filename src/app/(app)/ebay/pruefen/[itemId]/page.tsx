import Link from "next/link";
import { notFound } from "next/navigation";
import { requireArea } from "@/lib/auth/session";
import { GTIN_ASPECT } from "@/lib/ebay/pipeline/aspects";
import type { Level } from "@/lib/ebay-review/logic";
import { reviewDetail } from "@/lib/ebay-review/service";
import { aiSuggestAction, applyAction, recheckOneAction } from "../actions";
import { ContentEditor } from "../content-editor";
import { ActionButton, ReviseForm } from "../forms";
import { euro, LEVEL_TAG, scoreClass } from "../ui";

const LEVEL_HEAD: Record<Level, string> = { wichtig: "Wichtig", empfohlen: "Empfohlen", tipp: "Tipps" };
const dateDe = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "–");

export default async function ReviewDetailPage({ params }: { params: Promise<{ itemId: string }> }) {
  const session = await requireArea("ebay");
  const { itemId } = await params;
  if (!/^\d{6,20}$/.test(itemId)) notFound();
  const d = await reviewDetail(session.tenantId, itemId);
  if (!d) notFound();
  const { row, defs } = d;
  const f = row.facts;
  const m = row.market;
  const t = row.traffic && "impressions" in row.traffic ? row.traffic : null;
  const trafficNote = row.traffic && "unavailable" in row.traffic ? row.traffic.unavailable : null;
  const ai = row.ai;
  const missing = f && defs ? defs.filter((x) => (x.required || x.recommended) && !GTIN_ASPECT.test(x.name) && !Object.keys(f.aspects).some((k) => k.toLowerCase() === x.name.toLowerCase())).slice(0, 24) : [];
  const levels: Level[] = ["wichtig", "empfohlen", "tipp"];
  const applied = row.applied as { at?: string; changes?: string[] } | null;
  // Nach dem Senden lädt die Seite neu – die Rückmeldung bleibt eine Weile am Editor stehen.
  const recentApplied = applied?.at && Date.now() - Date.parse(applied.at) < 15 * 60_000 ? (applied.changes ?? []).join(" · ") : null;

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="crumb"><Link href="/ebay/pruefen">eBay · Angebote prüfen</Link></div>
          <h1 style={{ overflowWrap: "anywhere" }}>{row.title}</h1>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {row.url && <a className="btn" href={row.url} target="_blank" rel="noreferrer">Bei eBay ansehen</a>}
          <ActionButton action={recheckOneAction} itemId={itemId} label="Neu prüfen" pending="Prüfe …" testid="recheck" />
        </div>
      </div>

      <section className="card card-pad stack" data-testid="review-detail">
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          {row.image && <img src={row.image} alt="" className="rev-thumb rev-thumb-lg" />}
          <div>
            <div className="kpi-label">Punkte</div>
            <div className="kpi-value"><span className={`tag ${scoreClass(row.score)}`} style={{ fontSize: 22 }} data-testid="detail-score">{row.score ?? "–"}</span> <span className="small muted">von 100</span></div>
            <div className="small muted">
              Art.-Nr. {itemId}{row.sku ? ` · SKU ${row.sku}` : ""} · {row.source === "tool" ? "aus dem eBay-Tool" : "direkt bei eBay eingestellt"} · geprüft {row.checkedAt ? new Date(row.checkedAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "noch nicht"}
            </div>
          </div>
        </div>
        {row.status === "fehler" && <div className="notice notice-error small">{row.message}</div>}
        {applied?.at && <div className="notice notice-info small" data-testid="applied">Zuletzt bei eBay geändert am {dateDe(applied.at)}: {(applied.changes ?? []).join(" · ")}</div>}
        {row.issues.length === 0 && row.score !== null && <div className="small" style={{ color: "var(--ok)" }}>Nichts zu verbessern – gut gemacht.</div>}
        {levels.map((l) => {
          const list = row.issues.filter((i) => i.level === l);
          if (!list.length) return null;
          return (
            <div key={l} className="stack" style={{ gap: 6 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>{LEVEL_HEAD[l]} ({list.length})</h3>
              <ul className="rev-issues" data-testid={`issues-${l}`}>
                {list.map((i) => (
                  <li key={i.key}>
                    <span className={`tag ${LEVEL_TAG[i.level]}`}>{i.area}</span> {i.text}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      {f && (
        <section className="card card-pad stack">
          <h2>Auf einen Blick</h2>
          <div className="rev-grid small">
            <div><div className="kpi-label">Preis</div>{euro(f.price)}{f.shippingCost !== null ? ` + ${f.shippingCost ? euro(f.shippingCost) : "kostenloser"} Versand` : ""}</div>
            <div><div className="kpi-label">Menge / verkauft</div>{f.quantity} / {f.sold}</div>
            <div><div className="kpi-label">Beobachter</div>{f.watchers ?? "–"}</div>
            <div><div className="kpi-label">Online seit</div>{dateDe(f.startTime)}</div>
            <div><div className="kpi-label">Kategorie</div>{f.categoryName ?? f.categoryId ?? "–"}</div>
            <div><div className="kpi-label">EAN</div>{f.ean ?? "–"}</div>
            <div><div className="kpi-label">Bilder</div>{f.images.length}</div>
            <div><div className="kpi-label">Bearbeitungszeit</div>{f.dispatchDays !== null ? `${f.dispatchDays} Tag${f.dispatchDays === 1 ? "" : "e"}` : "–"}</div>
            <div><div className="kpi-label">Rücknahme</div>{f.returnsAccepted === false ? "keine" : f.returnDays !== null ? `${f.returnDays} Tage${f.freeReturns ? ", kostenlos" : ""}` : "–"}</div>
            <div><div className="kpi-label">Preisvorschlag</div>{f.bestOffer ? "an" : "aus"}</div>
          </div>
        </section>
      )}

      {(t || trafficNote) && (
        <section className="card card-pad stack">
          <h2>Einblendungen und Klicks (30 Tage)</h2>
          {t ? (
            <div className="rev-grid" data-testid="traffic">
              <div><div className="kpi-label">Einblendungen</div><div className="kpi-value">{t.impressions}</div><div className="small muted">davon {t.searchImpressions} in der Suche</div></div>
              <div><div className="kpi-label">Klickrate Suche</div><div className="kpi-value">{t.ctr === null ? "–" : `${String(t.ctr).replace(".", ",")} %`}</div></div>
              <div><div className="kpi-label">Aufrufe</div><div className="kpi-value">{t.views}</div></div>
              <div><div className="kpi-label">Käufe</div><div className="kpi-value">{t.sales}</div><div className="small muted">{t.conversion === null ? "" : `${String(t.conversion).replace(".", ",")} % der Aufrufe`}</div></div>
            </div>
          ) : (
            <div className="small muted">{trafficNote}</div>
          )}
        </section>
      )}

      {m && (
        <section className="card card-pad stack">
          <h2>{m.basis === "ean" ? "Gleiche EAN bei anderen Verkäufern" : "Ähnliche Angebote (nach Titel)"}</h2>
          <div className="small" data-testid="market">
            Dein Preis inkl. Versand: <strong>{euro(m.ownTotal)}</strong>
            {m.rank !== null ? ` · Platz ${m.rank} von ${m.count + 1}` : ""}
            {m.cheapest !== null ? ` · günstigstes ${euro(m.cheapest)}` : ""}
            {m.median !== null ? ` · Mittel ${euro(m.median)}` : ""}
            {m.basis === "titel" && <span className="muted"> – nach Titel gefunden, nicht unbedingt dasselbe Produkt.</span>}
          </div>
          <div className="rev-table">
            <table className="table">
              <thead><tr><th>Angebot</th><th className="right">Preis</th><th className="right">Versand</th><th className="right">Gesamt</th></tr></thead>
              <tbody>
                {m.items.slice(0, 8).map((c) => (
                  <tr key={c.itemId}>
                    <td style={{ maxWidth: 380, overflowWrap: "anywhere" }}>{c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.title}</a> : c.title}<div className="small muted">{c.seller ?? ""}</div></td>
                    <td className="num right">{euro(c.price)}</td>
                    <td className="num right">{c.shipping === null ? "?" : c.shipping ? euro(c.shipping) : "frei"}</td>
                    <td className="num right">{euro(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {f && (
        <section className="card card-pad stack">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <h2 style={{ margin: 0 }}>Verbessern</h2>
            <ActionButton action={aiSuggestAction} itemId={itemId} label={ai ? "Neuen KI-Vorschlag holen" : "KI-Vorschlag holen"} pending="KI denkt nach …" testid="ai-suggest" />
          </div>
          {ai ? (
            <div className="notice notice-info small stack" style={{ gap: 4 }} data-testid="ai-box">
              <div><strong>KI-Vorschlag</strong> vom {dateDe(ai.at)} – unten vorbelegt, bitte prüfen.</div>
              {ai.title && <div>Titel: „{ai.title}“</div>}
              {Object.keys(ai.aspects).length > 0 && <div>Merkmale: {Object.entries(ai.aspects).map(([k, v]) => `${k}: ${v.join(", ")}`).join(" · ")}</div>}
              {ai.hints.length > 0 && <div>Tipps: {ai.hints.join(" · ")}</div>}
            </div>
          ) : (
            <div className="small muted">Die KI schlägt einen Titel und fehlende Merkmale vor – nur aus den Angaben im Angebot, nichts erfunden. Kosten: ca. 1 Cent je Vorschlag.</div>
          )}
          <ReviseForm
            key={ai?.at ?? "ohne-ki"}
            action={applyAction}
            itemId={itemId}
            title={f.title}
            suggestedTitle={ai?.title ?? null}
            aspects={missing.map((x) => ({ name: x.name, required: x.required, values: x.values, selectionOnly: x.selectionOnly, multi: x.multi, suggested: (ai?.aspects[x.name] ?? []).join("; ") }))}
            price={f.price}
            suggestedPrice={m?.suggestedPrice ?? null}
            canPrice={f.variations === 0}
            bestOffer={f.bestOffer}
            canBestOffer={f.variations === 0 && f.listingType === "FixedPriceItem"}
          />
        </section>
      )}

      {f && (
        <section className="card card-pad stack" id="inhalte">
          <div>
            <h2 style={{ margin: 0 }}>Bilder, Beschreibung und Merkmale</h2>
            <div className="small muted">Bilder ordnen, entfernen, per Link oder Datei hinzufügen oder von Amazon übernehmen; Beschreibung und alle Merkmale bearbeiten. Versand und Rücknahme änderst du in den Versand-/Rückgabeprofilen bei eBay.</div>
          </div>
          <ContentEditor
            key={`${row.checkedAt ?? ""}|${applied?.at ?? ""}`}
            itemId={itemId}
            images={f.images}
            descriptionHtml={f.descriptionHtml ?? null}
            aspects={f.aspects}
            defs={(defs ?? []).filter((x) => !GTIN_ASPECT.test(x.name)).map((x) => ({ name: x.name, required: x.required, recommended: x.recommended, values: x.values, multi: x.multi }))}
            ean={f.ean}
            title={f.title}
            recentApplied={recentApplied}
            disabled={session.readOnly}
          />
        </section>
      )}
    </>
  );
}
