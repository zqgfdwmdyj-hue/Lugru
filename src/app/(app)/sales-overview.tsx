import Link from "next/link";
import type { SalesOverview, SalesTile } from "@/lib/sellerboard/sales";
import type { SbChannel } from "@/lib/sellerboard/parse";
import { SalesTrend } from "./sales-trend";
import { TopProducts } from "./top-products";

// Verkäufe auf der Startseite – wie die Kacheln im sellerboard-Dashboard, Amazon + eBay zusammen.

export const CHANNEL_LABEL: Record<SbChannel, string> = { amazon: "Amazon", ebay: "eBay" };

const eur = (n: number, digits = 0) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits });
const int = (n: number) => n.toLocaleString("de-DE");
const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function range(t: SalesTile) {
  if (t.fromDay === t.toDay) return ddmm(t.fromDay);
  if (t.key === "vormonat") return `${MONTHS[Number(t.fromDay.slice(5, 7)) - 1]} ${t.fromDay.slice(0, 4)}`;
  return `${ddmm(t.fromDay)} – ${ddmm(t.toDay)}`;
}

function Figure({ label, value, negative = false, testid }: { label: string; value: string; negative?: boolean; testid?: string }) {
  return (
    <div className="sales-fig" data-testid={testid}>
      <div className="sales-fig-label">{label}</div>
      <div className="sales-fig-value" style={negative ? { color: "var(--danger)" } : undefined}>{value}</div>
    </div>
  );
}

function Tile({ t, channels, ownCost }: { t: SalesTile; channels: SbChannel[]; ownCost: boolean }) {
  const s = t.total;
  const has = Object.keys(t.byChannel).length > 0;
  const missing = channels.filter((c) => t.byChannel[c]?.missingCost);
  return (
    <div className={`sales-tile sales-tile-${t.key}`} data-testid="sales-tile" data-key={t.key}>
      <div className="sales-tile-head">
        <strong>{t.label}</strong>
        <span className="small muted">{range(t)}</span>
      </div>
      {!has ? (
        <div className="small muted" style={{ padding: "8px 0" }}>Noch keine Werte – kommen mit dem nächsten Abgleich.</div>
      ) : (
        <>
          <div className="sales-fig-label">Umsatz brutto</div>
          <div className="sales-hero" data-testid="sales-umsatz">{eur(s.sales, 2)}</div>
          <div className="sales-grid">
            <Figure label="Bestell. / Einh." value={`${int(s.orders)} / ${int(s.units)}`} testid="sales-orders" />
            <Figure label="Erstatt." value={int(s.refunds)} />
            <Figure label="Werbekosten" value={eur(s.advertising)} />
            <Figure label="Erw. Auszahlung" value={eur(s.payout)} />
            <Figure label="Deckungsbeitrag" value={eur(s.grossProfit)} negative={s.grossProfit < 0} />
            <Figure label="Gewinn" value={eur(s.netProfit)} negative={s.netProfit < 0} testid="sales-gewinn" />
          </div>
          {channels.length > 1 && (
            <div className="sales-split" data-testid="sales-split">
              {channels.map((c) => (
                <span key={c} className="sales-split-item">
                  <span className={`sales-key sales-key-${c}`} aria-hidden="true" />
                  {CHANNEL_LABEL[c]} {t.byChannel[c] ? eur(t.byChannel[c]!.sales ?? 0, 2) : "–"}
                </span>
              ))}
            </div>
          )}
          {missing.length > 0 && (
            <div className="sales-note small" data-testid="sales-missing-cost">
              {ownCost && missing.every((c) => c === "ebay") ? "Für einige eBay-Artikel fehlt der EK auch im Seller-System – Gewinn dort zu hoch. " : `Einkaufspreise fehlen (${missing.map((c) => CHANNEL_LABEL[c]).join(", ")}) – Gewinn dort zu hoch. `}
              <Link href="/hebel?typ=ek_fehlt">EK nachtragen →</Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Kompakte Kachel für den schnellen Blick: Umsatz brutto, Gewinn, Bestellungen. */
function CompactTile({ t }: { t: SalesTile }) {
  const s = t.total;
  const has = Object.keys(t.byChannel).length > 0;
  return (
    <div className={`sales-kpi sales-tile-${t.key}`} data-testid="sales-kpi" data-key={t.key}>
      <div className="sales-tile-head">
        <strong>{t.label}</strong>
        <span className="small muted">{range(t)}</span>
      </div>
      {!has ? (
        <div className="small muted">noch keine Werte</div>
      ) : (
        <>
          <div className="sales-kpi-main" data-testid="sales-kpi-umsatz">{eur(s.sales)}</div>
          <div className="small">
            Gewinn <strong style={s.netProfit < 0 ? { color: "var(--danger)" } : undefined} data-testid="sales-kpi-gewinn">{eur(s.netProfit)}</strong>
            <span className="muted"> · {int(s.orders)} Best.</span>
          </div>
        </>
      )}
    </div>
  );
}

export function SalesOverviewSection({ data }: { data: SalesOverview }) {
  const stand = data.syncedAt ? new Date(data.syncedAt).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }) : null;
  const missing = data.tiles.some((t) => data.channels.some((c) => t.byChannel[c]?.missingCost));
  return (
    <section className="card sales" data-testid="sales-overview">
      <div className="card-head" style={{ flexWrap: "wrap", gap: 8 }}>
        <h2>
          Umsatz &amp; Ergebnis{" "}
          <span className="small muted" style={{ fontWeight: 400 }} data-testid="sales-source">
            {data.channels.map((c) => CHANNEL_LABEL[c]).join(" + ")} · Quelle sellerboard · Umsatz brutto (inkl. USt.)
          </span>
        </h2>
        <span className="small muted" data-testid="sales-stand">{stand ? `Stand ${stand} Uhr · alle 30 Min.` : "noch kein Abgleich"}</span>
      </div>
      {data.error && (
        <div className="card-pad" style={{ paddingTop: 0 }}>
          <div className="notice notice-warn small" data-testid="sales-error">Letzter Abruf der Verkaufszahlen fehlgeschlagen: {data.error}</div>
        </div>
      )}
      <div className="sales-kpis" data-testid="sales-kpis">
        {data.tiles.map((t) => <CompactTile key={t.key} t={t} />)}
      </div>
      {missing && (
        <div className="card-pad small" style={{ paddingTop: 0 }} data-testid="sales-missing-hint">
          <span style={{ color: "var(--warn)" }}>Für einige Produkte fehlt der EK – Gewinn dort zu hoch.</span> <Link href="/hebel?typ=ek_fehlt">EK nachtragen →</Link>
        </div>
      )}
      <div className="card-pad small" style={{ paddingTop: 0, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <span className="muted">
          Gewinn laut sellerboard (nach Gebühren, Werbung und EK{data.ebayOwnCost ? "; eBay mit deinem EK aus dem Seller-System" : ""}).
        </span>
        <Link href="/gewinn?zeitraum=30#ueberleitung" data-testid="sales-bridge-link">Zum Gewinn aus Abrechnungen &amp; Aufträgen (andere Quelle, Überleitung) →</Link>
      </div>
      <details className="sales-more" data-testid="sales-more">
        <summary>Alle Kennzahlen, Verlauf 30 Tage und Top-Produkte</summary>
        <div className="sales-tiles" data-testid="sales-tiles">
          {data.tiles.map((t) => <Tile key={t.key} t={t} channels={data.channels} ownCost={data.ebayOwnCost} />)}
        </div>
        {data.ebayOwnCost && <div className="card-pad small muted" style={{ paddingTop: 0 }} data-testid="sales-ebay-owncost">eBay-Gewinn mit deinem EK aus dem Seller-System gerechnet (sellerboard kennt dort keinen EK).</div>}
        <SalesTrend days={data.days} channels={data.channels} />
        <TopProducts top={data.top} />
        <div className="card-pad small"><Link href="/anbindungen#sellerboard" className="muted">sellerboard-Anbindung</Link></div>
      </details>
    </section>
  );
}
