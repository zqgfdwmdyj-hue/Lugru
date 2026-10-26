import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { loadHebel } from "@/lib/hebel/service";
import { DEFAULT_THRESHOLDS, HEBEL_INFO, type Hebel, type HebelType } from "@/lib/hebel/rules";
import { dismissHebelAction, undismissAllAction } from "./actions";

// Hebel für Umsatz und Marge: konkrete Tipps je Produkt, sortiert nach Wirkung in € je Monat.

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2, minimumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 });
/** Wirkung ist grob geschätzt – in ganzen Euro. */
const eur0 = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const ddmm = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.` : "–");
const CH = { amazon: "Amazon", ebay: "eBay" } as const;

function Card({ h }: { h: Hebel }) {
  const internal = h.link?.startsWith("/");
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
        </div>
        <div className="hebel-impact" title="Wirkung in € je Monat (grob)">
          {h.impact > 0 ? <><strong data-testid="hebel-impact">{eur0(h.impact)}</strong><span className="small muted">im Monat</span></> : <span className="small muted">Daten</span>}
        </div>
      </div>
      <div className="hebel-card-actions">
        <Link className="btn btn-small" href={`/produkte/sku/${encodeURIComponent(h.sku)}`}>Produkt öffnen</Link>
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
  const total = data.summary.filter((s) => s.type !== "ek_fehlt").reduce((n, s) => n + s.impact, 0);
  const T = DEFAULT_THRESHOLDS;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Finanzen</div>
          <h1>Hebel für Umsatz und Marge</h1>
        </div>
      </div>
      <p className="muted" style={{ margin: "0 0 14px", maxWidth: 820 }}>
        Konkrete Tipps je Produkt aus den sellerboard-Werten der letzten 30 Tage ({ddmm(data.statsFrom)} – {ddmm(data.statsTo)}), deinem Bestand, deinem EK im Seller-System und der Buy Box laut Keepa. Sortiert nach Wirkung in € je Monat (grob geschätzt). Schwellen: Marge unter {T.marginMin} %, Reichweite über {T.reachMax} Tage, Erstattungen über {T.refundMax} %. Zu jeder Art gibt es eine Sammelaufgabe auf der Startseite.
      </p>

      {data.syncedAt === null && data.list.length === 0 ? (
        <div className="card card-pad" data-testid="hebel-empty-nodata">
          Noch keine Werte. Die Hebel kommen mit dem täglichen sellerboard-Abgleich – sofort über <Link href="/anbindungen#sellerboard">Anbindungen → sellerboard → „Jetzt abgleichen“</Link>.
        </div>
      ) : (
        <>
          <div className="hebel-summary" data-testid="hebel-summary">
            <Link href="/hebel" className={`chip${typ ? "" : " active"}`}>Alle · {data.list.length}{total > 0 ? ` · ${eur0(total)}/Monat` : ""}</Link>
            {data.summary.map((s) => (
              <Link key={s.type} href={`/hebel?typ=${s.type}`} className={`chip${typ === s.type ? " active" : ""}`} data-testid={`hebel-chip-${s.type}`}>
                {HEBEL_INFO[s.type].label} · {s.count}{s.impact > 0 ? ` · ${eur0(s.impact)}` : ""}
              </Link>
            ))}
          </div>
          {typ && <p className="small muted" style={{ margin: "0 0 10px" }}>{HEBEL_INFO[typ].hint}</p>}
          {list.length === 0 ? (
            <div className="card card-pad small muted" data-testid="hebel-empty">Hier gibt es gerade nichts zu tun.</div>
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
