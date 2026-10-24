import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { ISSUE_LABEL, issueKind } from "@/lib/ebay-review/logic";
import { reviewOverview, type CheckRow } from "@/lib/ebay-review/service";
import { AutoRefresh } from "../../lieferanten/finden/refresh";
import { aiWeakestAction, recheckAllAction, refreshAction, refreshTrafficAction } from "./actions";
import { ActionButton } from "./forms";
import { euro, issueTag, scoreClass } from "./ui";

type Params = { q?: string; punkt?: string; nur?: string; sort?: string };


export default async function EbayReviewPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await requireArea("ebay");
  const sp = await searchParams;
  const data = await reviewOverview(session.tenantId);
  const q = (sp.q ?? "").trim().toLowerCase();
  let rows = data.rows.filter((r) => !q || r.title.toLowerCase().includes(q) || r.itemId.includes(q) || (r.sku ?? "").toLowerCase().includes(q));
  if (sp.punkt) rows = rows.filter((r) => r.issues.some((i) => i.key === sp.punkt));
  // „Fehler & Pflicht“ (früher „wichtig“): nur Angebote mit technischen Fehlern oder fehlenden Pflichtangaben.
  if (sp.nur === "wichtig" || sp.nur === "pflicht") rows = rows.filter((r) => r.issues.some((i) => issueKind(i.key) !== "empfehlung"));
  if (sp.nur === "ki") rows = rows.filter((r) => r.hasAi);
  const sort = sp.sort ?? "punkte";
  rows.sort((a, b) =>
    sort === "einblendungen" ? (a.impressions ?? Infinity) - (b.impressions ?? Infinity) : sort === "beobachter" ? (b.watchers ?? 0) - (a.watchers ?? 0) : (a.score ?? 101) - (b.score ?? 101) || a.title.localeCompare(b.title, "de"),
  );
  const checked = data.rows.filter((r) => r.score !== null).length;
  const important = data.rows.filter((r) => r.issues.some((i) => issueKind(i.key) !== "empfehlung")).length;
  const link = (p: Partial<Params>) => {
    const u = new URLSearchParams();
    const merged = { ...sp, ...p };
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, v);
    const s = u.toString();
    return `/ebay/pruefen${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <AutoRefresh active={data.running} everyMs={5000} />
      <div className="page-head">
        <div>
          <div className="crumb">eBay</div>
          <h1>Angebote prüfen</h1>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {data.connected && <ActionButton action={refreshTrafficAction} label="Verkehrsdaten neu laden" pending="Lade Verkehrsdaten …" testid="traffic-refresh" />}
          <ActionButton action={refreshAction} label="Angebote von eBay laden" pending="Lade …" primary testid="refresh" />
        </div>
      </div>
      <div className="small muted">
        Prüft jedes laufende eBay-Angebot auf das, was für Auffindbarkeit und Verkauf zählt: Titel, Merkmale, EAN, Bilder, Beschreibung, Versand,
        Rücknahme, Preis gegenüber gleicher EAN, Beobachter und Verkäufe – und, falls erlaubt, Einblendungen und Klicks. Je Angebot gibt es einen
        KI-Vorschlag für Titel und Merkmale: prüfen, mit einem Klick bei eBay übernehmen. Läuft wöchentlich auch von selbst.
      </div>

      {!data.connected && <div className="notice notice-warn">eBay ist nicht verbunden – unter eBay → eBay-Einstellungen → Verbindung anmelden.</div>}
      {data.trafficNote && <div className="notice notice-info small" data-testid="traffic-note">{data.trafficNote} Danach oben „Verkehrsdaten neu laden“.</div>}

      <section className="card card-pad stack">
        <div className="rev-grid" data-testid="review-kpis">
          <div><div className="kpi-label">Laufende Angebote</div><div className="kpi-value">{data.rows.length}</div></div>
          <div><div className="kpi-label">Geprüft</div><div className="kpi-value">{checked}</div>{data.waiting > 0 && <div className="small muted" data-testid="waiting">{data.waiting} {data.running ? "in Arbeit …" : "warten auf den nächsten Durchgang"}</div>}</div>
          <div><div className="kpi-label">Ø Punkte</div><div className="kpi-value" data-testid="avg-score">{data.avgScore ?? "–"}</div><div className="small muted">von 100</div></div>
          <div><div className="kpi-label">Mit Fehlern oder fehlenden Pflichtangaben</div><div className="kpi-value" data-testid="kpi-pflicht">{important}</div><div className="small muted">Empfehlungen zählen hier nicht</div></div>
        </div>
        {data.top.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="small muted">Häufigste Punkte – antippen zum Filtern:</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} data-testid="top-issues">
              {data.top.map(([k, n]) => (
                <Link key={k} href={link({ punkt: sp.punkt === k ? undefined : k })} className={`chip ${sp.punkt === k ? "active" : ""}`}>
                  {ISSUE_LABEL[k] ?? k} · {n}
                </Link>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ActionButton action={recheckAllAction} label="Alle neu prüfen" pending="Starte …" testid="recheck-all" />
          <ActionButton action={aiWeakestAction} label="KI-Vorschläge für die 10 schwächsten" pending="Starte …" testid="ai-weakest" />
        </div>
        {data.failed > 0 && <div className="small" style={{ color: "var(--danger)" }}>{data.failed} Angebot(e) konnten nicht geprüft werden – Grund in der Zeile.</div>}
      </section>

      <form className="rev-filter" action="/ebay/pruefen">
        <input className="input" name="q" defaultValue={sp.q ?? ""} placeholder="Titel, Artikelnummer oder SKU" aria-label="Suchen" />
        {sp.punkt && <input type="hidden" name="punkt" value={sp.punkt} />}
        <select className="select" name="nur" defaultValue={sp.nur ?? ""} aria-label="Filter">
          <option value="">alle</option>
          <option value="pflicht">nur mit Fehlern/Pflichtangaben</option>
          <option value="ki">mit KI-Vorschlag</option>
        </select>
        <select className="select" name="sort" defaultValue={sort} aria-label="Sortierung">
          <option value="punkte">schwächste zuerst</option>
          <option value="einblendungen">wenigste Einblendungen zuerst</option>
          <option value="beobachter">meiste Beobachter zuerst</option>
        </select>
        <button className="btn" type="submit">Anzeigen</button>
      </form>

      <div className="small muted" data-testid="review-count">{rows.length} von {data.rows.length} Angeboten{data.ended ? ` · ${data.ended} beendete ausgeblendet` : ""}</div>
      <div className="rev-list" data-testid="review-list">
        {rows.map((r) => (
          <Row key={r.itemId} r={r} />
        ))}
        {!rows.length && <div className="card card-pad small muted">{data.rows.length ? "Keine Angebote für diesen Filter." : "Noch keine Angebote geladen – oben „Angebote von eBay laden“."}</div>}
      </div>
    </>
  );
}

function Row({ r }: { r: CheckRow }) {
  const top = r.issues.slice(0, 3);
  return (
    <Link href={`/ebay/pruefen/${r.itemId}`} className="card rev-row" data-testid="review-row">
      {r.image ? <img src={r.image} alt="" className="rev-thumb" loading="lazy" /> : <div className="rev-thumb" />}
      <div style={{ minWidth: 0 }}>
        <div className="rev-title">{r.title}</div>
        <div className="small muted">
          {euro(r.price)} · Menge {r.quantity ?? "–"}
          {r.sold !== null ? ` · ${r.sold} verkauft` : ""}
          {r.watchers ? ` · ${r.watchers} Beobachter` : ""}
          {r.impressions !== null ? ` · ${r.impressions} Einblendungen/30 T.` : ""}
          {r.variations ? ` · ${r.variations} Varianten` : ""}
        </div>
        {r.status === "fehler" ? (
          <div className="small" style={{ color: "var(--danger)" }}>{r.message}</div>
        ) : top.length ? (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
            {top.map((i) => (
              <span key={i.key} className={`tag ${issueTag(i)}`}>{ISSUE_LABEL[i.key] ?? i.key}</span>
            ))}
            {r.issues.length > 3 && <span className="tag tag-neutral">+{r.issues.length - 3}</span>}
            {r.hasAi && <span className="tag tag-info">KI-Vorschlag</span>}
            {r.appliedAt && <span className="tag tag-ok">geändert</span>}
          </div>
        ) : r.score !== null ? (
          <div className="small" style={{ color: "var(--ok)" }}>Nichts zu verbessern.</div>
        ) : null}
      </div>
      <div className="rev-score">
        {r.status === "wartet" || r.status === "läuft" ? <span className="tag tag-neutral">{r.status === "läuft" ? "prüft …" : "wartet"}</span> : <span className={`tag ${scoreClass(r.score)}`} data-testid="score">{r.score ?? "–"}</span>}
      </div>
    </Link>
  );
}
