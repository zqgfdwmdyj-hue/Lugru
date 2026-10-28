import Link from "next/link";
import { KpiMeta } from "@/components/kpi";
import { requireArea } from "@/lib/auth/session";
import { loadHebel } from "@/lib/hebel/service";
import { DEFAULT_THRESHOLDS, HEBEL_INFO, type Hebel, type HebelType } from "@/lib/hebel/rules";
import { dismissHebelAction, undismissAllAction } from "./actions";

// Hebel für Umsatz und Marge: konkrete Tipps je Produkt. Wirkung getrennt nach zusätzlichem Deckungsbeitrag,
// Kostenersparnis (beide je Monat) und einmalig freisetzbarem Kapital – jeweils mit Herleitung.

/** Wirkung ist geschätzt – in ganzen Euro. */
const eur0 = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : null);
const CH = { amazon: "Amazon", ebay: "eBay" } as const;

function Impact({ h }: { h: Hebel }) {
  if (h.impact <= 0 && h.capital <= 0) return <span className="small muted">kein €-Wert</span>;
  return (
    <>
      {h.impact > 0 && (
        <>
          <strong data-testid="hebel-impact">{eur0(h.impact)}</strong>
          <span className="small muted">je Monat</span>
        </>
      )}
      {h.capital > 0 && (
        <span className="small" data-testid="hebel-capital" style={{ marginTop: h.impact > 0 ? 4 : 0 }}>
          {eur0(h.capital)} Kapital
          <br />
          <span className="muted">einmalig frei</span>
        </span>
      )}
    </>
  );
}

function Card({ h }: { h: Hebel }) {
  const internal = h.link?.startsWith("/");
  const fixHref = `/produkte/sku/${encodeURIComponent(h.sku)}${h.type === "ek_fehlt" ? "?tab=einkauf" : ""}`;
  const parts = [h.contribution > 0 ? `Deckungsbeitrag +${eur0(h.contribution)}/Monat` : null, h.saving > 0 ? `Kostenersparnis ${eur0(h.saving)}/Monat` : null, h.capital > 0 ? `freisetzbares Kapital ${eur0(h.capital)} (einmalig)` : null].filter(Boolean);
  return (
    <div className="hebel-card" data-testid="hebel-card" data-type={h.type} data-sku={h.sku}>
      <div className="hebel-card-main">
        {h.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={h.image} alt="" width={44} height={44} loading="lazy" referrerPolicy="no-referrer" className="hebel-img" />
        ) : (
          <span className="hebel-img" aria-hidden="true" />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="hebel-name">{h.name ?? h.sku}</div>
          <div className="small muted">
            <span className={`sales-key sales-key-${h.channel}`} aria-hidden="true" /> {CH[h.channel]} · {h.sku}
          </div>
          <div className="hebel-headline" data-testid="hebel-headline">{h.headline}</div>
          <div className="hebel-action" data-testid="hebel-action">→ {h.action}</div>
          {h.facts.length > 0 && <div className="small muted hebel-facts">{h.facts.join(" · ")}</div>}
          {parts.length > 0 && <div className="small hebel-parts" data-testid="hebel-parts">{parts.join(" · ")}</div>}
          {h.basis.length > 0 && (
            <details className="hebel-basis" data-testid="hebel-basis">
              <summary className="small">So gerechnet</summary>
              <ul className="small">{h.basis.map((b, i) => <li key={i}>{b}</li>)}</ul>
            </details>
          )}
        </div>
        <div className="hebel-impact" title="Je Monat: zusätzlicher Deckungsbeitrag + Kostenersparnis. Kapital: einmalig, nicht monatlich.">
          <Impact h={h} />
        </div>
      </div>
      <div className="hebel-card-actions">
        <Link className="btn btn-small" href={fixHref}>{h.type === "ek_fehlt" ? "EK eintragen" : "Produkt öffnen"}</Link>
        {h.link && (internal ? <Link className="btn btn-small" href={h.link}>Zur Liste</Link> : <a className="btn btn-small" href={h.link} target="_blank" rel="noreferrer noopener">Bei {CH[h.channel]} ansehen</a>)}
        <form action={dismissHebelAction}>
          <input type="hidden" name="key" value={h.key} />
          <input type="hidden" name="days" value="30" />
          <button className="btn-link small" type="submit" data-testid="hebel-dismiss">Erledigt – 30 Tage ausblenden</button>
        </form>
      </div>
    </div>
  );
}

export default async function HebelPage({ searchParams }: { searchParams: Promise<{ typ?: string }> }) {
  const session = await requireArea("geld");
  const sp = await searchParams;
  const data = await loadHebel(session.tenantId);
  const typ = sp.typ && sp.typ in HEBEL_INFO ? (sp.typ as HebelType) : null;
  const list = typ ? data.list.filter((h) => h.type === typ) : data.list;
  const T = DEFAULT_THRESHOLDS;
  const A = data.assumptions;
  // Ein Verweis (z. B. von der Startseite) auf eine Art ohne Einträge: Reiter trotzdem zeigen, mit Erklärung.
  const chips = [...data.summary];
  if (typ && !chips.some((c) => c.type === typ)) chips.push({ type: typ, count: 0, impact: 0, contribution: 0, saving: 0, capital: 0 });
  const period = data.statsFrom && data.statsTo ? `${dmy(data.statsFrom)} – ${dmy(data.statsTo)}` : null;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Finanzen</div>
          <h1>Hebel für Umsatz und Marge</h1>
        </div>
      </div>
      <div className="small" style={{ margin: "0 0 14px", maxWidth: 860 }} data-testid="hebel-source">
        <p className="muted" style={{ margin: "0 0 6px" }}>
          Konkrete Tipps je Produkt – aus den sellerboard-Werten je Produkt{" "}
          {period ? <strong data-testid="hebel-period">{period}</strong> : <strong data-testid="hebel-period">(noch keine Produktwerte)</strong>}, dem Bestand bei Amazon
          {data.stockAt ? ` (Stand ${data.stockAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })})` : ""}, dem gültigen EK im Seller-System und der Buy Box laut Keepa.
        </p>
        <p className="muted" style={{ margin: 0 }}>
          Je Monat = zusätzlicher Deckungsbeitrag + Kostenersparnis. Gebundenes Kapital wird getrennt ausgewiesen – es wird beim Abverkauf einmal frei und ist keine monatliche Verbesserung. Schwellen: Marge unter {T.marginMin} %,
          Reichweite über {T.reachMax} Tage, Erstattungen über {T.refundMax} %. Annahmen: Lagergebühr {A.storagePerUnitMonth.toLocaleString("de-DE", { style: "currency", currency: "EUR" })} je Stück und Monat (<Link href="/einstellungen">Einstellungen</Link>), Kapitalkosten {Math.round(A.capitalRatePa * 100)} % im Jahr.
        </p>
      </div>
      {data.statsCount === 0 && (
        <div className="notice notice-warn small" style={{ marginBottom: 12 }} data-testid="hebel-no-stats">
          Die sellerboard-Werte je Produkt (letzte 30 Tage) fehlen noch – deshalb gibt es nur Hinweise aus dem Bestand (Ladenhüter).
          {data.statsError ? ` Letzter Abruf fehlgeschlagen: ${data.statsError}.` : " Sie kommen mit dem täglichen Komplett-Abgleich."}{" "}
          <Link href="/anbindungen#sellerboard">Anbindungen → sellerboard → „Jetzt abgleichen“</Link>
        </div>
      )}

      {data.syncedAt === null && data.list.length === 0 && !typ ? (
        <div className="card card-pad" data-testid="hebel-empty-nodata">
          Noch keine Werte. Die Hebel kommen mit dem täglichen sellerboard-Abgleich – sofort über <Link href="/anbindungen#sellerboard">Anbindungen → sellerboard → „Jetzt abgleichen“</Link>.
        </div>
      ) : (
        <>
          <div className="stack" style={{ gap: 6 }} data-kpi-group>
          <div className="hebel-totals" data-testid="hebel-totals">
            <div><span className="small muted">Je Monat, geschätzt (Deckungsbeitrag + Ersparnis)</span><strong>≈ {eur0(data.totals.impact)}</strong></div>
            <div><span className="small muted">davon zusätzlicher Deckungsbeitrag</span><strong>{eur0(data.totals.contribution)}</strong></div>
            <div><span className="small muted">davon Kostenersparnis</span><strong>{eur0(data.totals.saving)}</strong></div>
            <div><span className="small muted">Gebundenes Kapital (einmalig)</span><strong data-testid="hebel-total-capital">{eur0(data.totals.capital)}</strong></div>
          </div>
          <KpiMeta period={period ?? "noch keine Produktwerte"} source="sellerboard je Produkt, Amazon-Bestand, EK im Seller-System, Keepa (Buy Box)" stand={data.syncedAt ? data.syncedAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "noch kein Abgleich"} fehler={data.statsError} />
          </div>
          <div className="hebel-summary" data-testid="hebel-summary">
            <Link href="/hebel" className={`chip${typ ? "" : " active"}`} aria-current={!(typ) ? "true" : undefined}>Alle · {data.list.length}</Link>
            {chips.map((s) => (
              <Link key={s.type} href={`/hebel?typ=${s.type}`} className={`chip${typ === s.type ? " active" : ""}`} aria-current={typ === s.type ? "true" : undefined} data-testid={`hebel-chip-${s.type}`}>
                {HEBEL_INFO[s.type].label} · {s.count}
                {s.impact > 0 ? ` · ${eur0(s.impact)}/Monat` : ""}
                {s.capital > 0 ? ` · ${eur0(s.capital)} Kapital` : ""}
              </Link>
            ))}
          </div>
          {typ && <p className="small muted" style={{ margin: "0 0 10px" }}>{HEBEL_INFO[typ].hint}</p>}
          {list.length === 0 ? (
            <div className="card card-pad small" data-testid="hebel-empty">
              {typ === "ek_fehlt" ? (
                <>Kein verkauftes Produkt ohne EK in den sellerboard-Werten. Alle SKUs ohne EK (auch Bestand ohne Verkäufe): <Link href="/produkte?ansicht=zuordnung&art=ek-fehlt">Produkte → Zuordnung prüfen → EK fehlt</Link>.</>
              ) : typ && data.statsCount === 0 && typ !== "ladenhueter" ? (
                <>Für „{HEBEL_INFO[typ].label}“ fehlen die sellerboard-Werte je Produkt (siehe Hinweis oben).</>
              ) : (
                <span className="muted">Hier gibt es gerade nichts zu tun.</span>
              )}
            </div>
          ) : (
            <div className="hebel-list">
              {list.slice(0, 150).map((h) => <Card key={h.key} h={h} />)}
              {list.length > 150 && <div className="small muted">… und {list.length - 150} weitere mit kleinerer Wirkung.</div>}
            </div>
          )}
          {data.dismissed > 0 && (
            <form action={undismissAllAction} className="small" style={{ marginTop: 14 }}>
              <span className="muted">{data.dismissed} ausgeblendet. </span>
              <button className="btn-link small" type="submit" data-testid="hebel-undismiss">Alle wieder einblenden</button>
            </form>
          )}
        </>
      )}
    </>
  );
}
