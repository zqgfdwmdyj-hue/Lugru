import Link from "next/link";
import { KpiMeta } from "@/components/kpi";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { kapitalAmpel } from "@/lib/money/kapital-service";
import type { Ampel } from "@/lib/money/kapital";
import { getSettings } from "@/lib/settings";
import { kapitalZieleAction } from "./actions";

// Kapital-Ampel je Produkt: Wo liegt Geld, das zu wenig verdient? Gebundenes Kapital, Gewinn 90 Tage,
// Jahresrendite auf das gebundene Kapital, Reichweite, Lageralter, Preis gegen Break-even.

const eur0 = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur2 = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const AMPEL_TEXT: Record<Ampel, string> = { gruen: "grün", gelb: "gelb", rot: "rot" };
const AMPEL_TAG: Record<Ampel, string> = { gruen: "tag-ok", gelb: "tag-warn", rot: "tag-danger" };
const PAGE = 100;

type SP = { filter?: string; q?: string; seite?: string; meldung?: string };

function href(sp: SP, patch: Partial<SP>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, meldung: undefined, ...patch })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `/kapital?${s}` : "/kapital";
}

export default async function KapitalPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requireArea("geld");
  const sp = await searchParams;
  const [data, settings] = await Promise.all([kapitalAmpel(session.tenantId, todayIso()), getSettings(session.tenantId)]);
  const filter: Ampel | "alle" = sp.filter === "rot" || sp.filter === "gelb" || sp.filter === "gruen" ? sp.filter : "alle";
  const q = (sp.q ?? "").trim().toLowerCase();
  const list = data.zeilen.filter((z) => (filter === "alle" || z.ampel === filter) && (!q || z.sku.toLowerCase().includes(q) || (z.asin ?? "").toLowerCase().includes(q) || (z.name ?? "").toLowerCase().includes(q)));
  const page = Math.max(1, Number(sp.seite) || 1);
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const rows = list.slice((page - 1) * PAGE, page * PAGE);
  const anzahl = (a: Ampel) => data.zeilen.filter((z) => z.ampel === a).length;
  const k = settings.kapital;
  const stand = data.stand ? data.stand.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "noch kein Abgleich";
  const ohneEk = data.zeilen.filter((z) => z.ek === null).length;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Finanzen</div>
          <h1>Kapital-Ampel</h1>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-ok small" style={{ marginBottom: 12 }} role="status">{sp.meldung}</div>}
      <p className="small muted" style={{ margin: "0 0 14px", maxWidth: 860 }}>
        Je Produkt: gebundenes Kapital (Bestand bei Amazon inkl. unterwegs + eigenes Lager × gültiger EK), Gewinn der letzten 90 Tage (sellerboard je Monat), Jahresrendite = Gewinn 90 T × 365/90 ÷ gebundenes Kapital,
        Reichweite, ältestes Lageralter (Amazon-Bericht) und Preis gegen Break-even. <strong>Rot</strong> wird bei den <Link href="/einkauf/vorschlaege">Bestellvorschlägen</Link> nicht mehr vorgeschlagen und in der <Link href="/cashflow">Liquidität</Link> nicht eingerechnet.
      </p>

      {data.zeilen.length === 0 ? (
        <div className="card card-pad" data-testid="kapital-leer">
          Noch kein Bestand. Die Werte kommen mit dem sellerboard-Abgleich – sofort über <Link href="/anbindungen#sellerboard">Anbindungen → sellerboard → „Jetzt abgleichen“</Link>.
        </div>
      ) : (
        <>
          <div className="stack" style={{ gap: 6 }} data-kpi-group>
            <div className="grid-kpi" data-testid="kapital-summen">
              <div className="card card-pad">
                <div className="kpi-label">Gebundenes Kapital gesamt</div>
                <div className="kpi-value" data-testid="kapital-gesamt">{eur0(data.summe.gesamt)}</div>
                <div className="small muted">{data.zeilen.length} Produkte{ohneEk ? ` · ${ohneEk} ohne EK (nicht enthalten)` : ""}</div>
              </div>
              <div className="card card-pad">
                <div className="kpi-label">davon rot</div>
                <div className="kpi-value" style={{ color: "var(--danger)" }} data-testid="kapital-rot">{eur0(data.summe.rot)}</div>
                <div className="small muted">{anzahl("rot")} Produkte</div>
              </div>
              <div className="card card-pad">
                <div className="kpi-label">davon gelb</div>
                <div className="kpi-value">{eur0(data.summe.gelb)}</div>
                <div className="small muted">{anzahl("gelb")} Produkte</div>
              </div>
              <div className="card card-pad">
                <div className="kpi-label">davon grün</div>
                <div className="kpi-value">{eur0(data.summe.gruen)}</div>
                <div className="small muted">{anzahl("gruen")} Produkte</div>
              </div>
            </div>
            <KpiMeta period="Gewinn: letzte 90 Tage · Bestand: aktuell" source="sellerboard (Bestand, Gewinn je Monat), eigenes Lager, EK im Seller-System, Amazon-Lageralter, Keepa (Buy Box)" stand={stand} />
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "12px 0" }} data-testid="kapital-filter">
            {(["alle", "rot", "gelb", "gruen"] as const).map((a) => (
              <Link key={a} href={href(sp, { filter: a === "alle" ? undefined : a, seite: undefined })} className={`chip${filter === a ? " active" : ""}`} aria-current={filter === a ? "true" : undefined} data-testid={`kapital-chip-${a}`}>
                {a === "alle" ? `Alle · ${data.zeilen.length}` : `${AMPEL_TEXT[a]} · ${anzahl(a)}`}
              </Link>
            ))}
            <form method="get" style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
              {filter !== "alle" && <input type="hidden" name="filter" value={filter} />}
              <input name="q" defaultValue={sp.q ?? ""} placeholder="SKU, ASIN, Name" aria-label="Suchen" data-testid="kapital-suche" />
              <button className="btn btn-small" type="submit">Suchen</button>
            </form>
          </div>

          {rows.length === 0 ? (
            <div className="card card-pad small muted" data-testid="kapital-keine">Keine Produkte für diese Auswahl.</div>
          ) : (
            <div className="table-wrap card">
              <table className="table" data-testid="kapital-tabelle">
                <thead>
                  <tr>
                    <th>Ampel</th>
                    <th>Produkt</th>
                    <th className="right num">Bestand</th>
                    <th className="right num">Kapital</th>
                    <th className="right num">Gewinn 90 T</th>
                    <th className="right num">Rendite/Jahr</th>
                    <th className="right num">Umschlag</th>
                    <th className="right num">Reichweite</th>
                    <th className="right num">Lageralter</th>
                    <th className="right num">Preis / Break-even</th>
                    <th className="right num">Trend 30/90</th>
                    <th>Gründe und Vorschläge</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((z) => (
                    <tr key={z.sku} data-testid="kapital-zeile" data-sku={z.sku} data-ampel={z.ampel}>
                      <td><span className={`tag ${AMPEL_TAG[z.ampel]}`} data-testid="kapital-ampel">{AMPEL_TEXT[z.ampel]}</span></td>
                      <td>
                        <Link href={`/produkte/sku/${encodeURIComponent(z.sku)}`}>{z.name ?? z.sku}</Link>
                        <div className="small muted">{z.sku}{z.asin ? ` · ${z.asin}` : ""}</div>
                      </td>
                      <td className="right num">{z.stueck}</td>
                      <td className="right num">{z.kapital === null ? <span className="muted">EK fehlt</span> : eur0(z.kapital)}</td>
                      <td className="right num">{z.tageDaten > 0 ? eur0(z.gewinn90) : <span className="muted">keine Daten</span>}{z.tageDaten > 0 && z.tageDaten < 90 && <div className="small muted">{z.tageDaten} Tage</div>}</td>
                      <td className="right num" data-testid="kapital-rendite">{z.rendite === null ? <span className="muted">–</span> : `${Math.round(z.rendite * 100)} %`}</td>
                      <td className="right num">{z.umschlag === null ? <span className="muted">–</span> : `${z.umschlag.toLocaleString("de-DE")}×`}</td>
                      <td className="right num">{z.reichweite === null ? "–" : z.reichweite >= 9999 ? <span className="muted">keine Verkäufe</span> : `${z.reichweite} T`}</td>
                      <td className="right num">{z.aeltesteTage === null ? <span className="muted">–</span> : `ab ${z.aeltesteTage} T`}</td>
                      <td className="right num">
                        {z.keinAngebot ? <span className="tag tag-warn" data-testid="kapital-kein-angebot">kein aktives Angebot</span> : z.preis !== null ? eur2(z.preis) : <span className="muted">–</span>}
                        <div className={`small ${z.unterBreakEven ? "" : "muted"}`} style={z.unterBreakEven ? { color: "var(--danger)" } : undefined} title={z.breakEvenLaender ? Object.entries(z.breakEvenLaender).map(([l, b]) => `${l} ${b !== null && b !== undefined ? eur2(b) : "–"}`).join(" · ") : undefined}>BE {z.breakEven !== null ? eur2(z.breakEven) : "–"}</div>
                        {z.breakEvenLaender && <div className="small muted" data-testid="kapital-be-laender">{Object.entries(z.breakEvenLaender).filter(([l]) => l !== "DE").map(([l, b]) => `${l} ${b !== null && b !== undefined ? eur2(b) : "–"}`).join(" · ")}</div>}
                      </td>
                      <td className="right num">{z.trendProzent === null ? <span className="muted">–</span> : `${z.trendProzent > 0 ? "+" : ""}${z.trendProzent.toLocaleString("de-DE")} %`}</td>
                      <td className="small">
                        {z.gruende.length > 0 && <div>{z.gruende.join(" · ")}</div>}
                        {z.vorschlaege.length > 0 && <ul style={{ margin: "4px 0 0", paddingLeft: 16 }} data-testid="kapital-vorschlaege">{z.vorschlaege.map((v) => <li key={v}>{v}</li>)}</ul>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <div className="small" style={{ display: "flex", gap: 10, marginTop: 10 }}>
              {page > 1 && <Link href={href(sp, { seite: String(page - 1) })}>← zurück</Link>}
              <span className="muted">Seite {page} von {pages}</span>
              {page < pages && <Link href={href(sp, { seite: String(page + 1) })}>weiter →</Link>}
            </div>
          )}
        </>
      )}

      <details className="card card-pad" style={{ marginTop: 16 }} id="ziele">
        <summary><strong>Ziele einstellen</strong></summary>
        <form action={kapitalZieleAction} className="stack" style={{ gap: 8, marginTop: 10, maxWidth: 520 }}>
          <label className="small">Ziel-Rendite je Jahr (%) – grün ab diesem Wert<input name="ziel" inputMode="decimal" defaultValue={String(Math.round(k.zielRendite * 1000) / 10).replace(".", ",")} data-testid="kapital-ziel" /></label>
          <label className="small">Geringe Rendite (%) – darunter rot<input name="gering" inputMode="decimal" defaultValue={String(Math.round(k.geringRendite * 1000) / 10).replace(".", ",")} /></label>
          <label className="small">Reichweite für grün höchstens (Tage)<input name="gruen" inputMode="numeric" defaultValue={k.gruenReichweite} /></label>
          <label className="small">Reichweite rot ab (Tage, darüber)<input name="rot" inputMode="numeric" defaultValue={k.rotReichweite} /></label>
          <p className="small muted" style={{ margin: 0 }}>
            Grün = Rendite ≥ Ziel und Reichweite ≤ {k.gruenReichweite} Tage. Rot = negative oder geringe Rendite, Reichweite über {k.rotReichweite} Tage oder Preis unter Break-even. Sonst gelb.
          </p>
          <div><button className="btn btn-primary" type="submit" data-testid="kapital-ziele-speichern">Speichern</button></div>
        </form>
      </details>
    </>
  );
}
