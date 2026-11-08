import Link from "next/link";
import { KpiMeta } from "@/components/kpi";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { kapitalAmpel } from "@/lib/money/kapital-service";
import { gestrandetUebersicht, weitereGebuehren } from "@/lib/amazon-berichte/service";
import type { Ampel } from "@/lib/money/kapital";
import { getSettings } from "@/lib/settings";
import { kapitalZieleAction } from "./actions";
import { KAPITALBEDARF_DEFINITION } from "@/lib/purchasing/reorder-logic";
import { cashToCashKennzahlen } from "@/lib/money/durchlauf";
import { liquidationsStand, liquidationsZeile } from "@/lib/bqool/liquidation";
import { AUSZAHLUNG_TAGE, BEREINIGEN_TAGE, MIN_BASIS, type Phase, type Phasen } from "@/lib/money/durchlauf-logic";
import { STANDARD_VORLAUF } from "@/lib/deal-eingang/umschlag-logic";

/** B28.7: Median einer Phase mit Basis, sonst Standardwert (gekennzeichnet). */
function phaseText(p: Phase, standard: number | null) {
  if (p.median !== null) return <>{String(p.median).replace(".", ",")} T <span className="muted">({p.n} Einkäufe{p.n < MIN_BASIS ? ", wenig Basis" : ""})</span></>;
  return standard !== null ? <span className="muted">{standard} T (Standard, keine Daten)</span> : <span className="muted">keine Daten</span>;
}
const tageText = (n: number | null) => (n === null ? "–" : `${String(n).replace(".", ",")} T`);

/** B28.7 Cash-to-Cash-Zyklus: Bestellung → Wareneingang → Versand an Amazon → Empfang abgeschlossen → Abverkauf → Auszahlung. */
function CashToCash({ c }: { c: Awaited<ReturnType<typeof cashToCashKennzahlen>> }) {
  const g: Phasen = c.gesamt;
  const s = STANDARD_VORLAUF;
  return (
    <section className="card card-pad" style={{ marginTop: 12 }} data-testid="kapital-c2c">
      <h3 style={{ marginTop: 0 }}>Cash-to-Cash-Zyklus</h3>
      <div className="grid-kpi">
        <div>
          <div className="kpi-label" title="Summe der Mediane: Bestellung → Wareneingang → Versand an Amazon → Empfang abgeschlossen → 90 % verkauft → Auszahlung">Vom Bezahlen der Ware bis das Geld zurück ist</div>
          <div className={`kpi-value${c.cashToCash.tage === null ? " muted" : ""}`} data-testid="kapital-c2c-tage">{c.cashToCash.tage === null ? "noch nicht berechenbar" : `${c.cashToCash.tage} Tage`}</div>
          <div className="small muted">{c.cashToCash.tage === null ? "Abverkauf fehlt (noch kein Einkauf zu 90 % verkauft bzw. keine sellerboard-Monatswerte)." : c.cashToCash.vollstaendig ? `Median aus ${c.einkaeufe} erhaltenen Einkäufen` : "fehlende Phasen mit Standardwerten"}</div>
        </div>
        <div>
          <div className="kpi-label" title="Gebundenes Kapital ÷ Umsatz der letzten 30 Tage (sellerboard)">Kapital ÷ Monatsumsatz</div>
          <div className={`kpi-value${c.kapitalMonate === null ? " muted" : ""}`} data-testid="kapital-monate">{c.kapitalMonate === null ? "–" : `${String(c.kapitalMonate).replace(".", ",")} Monatsumsätze`}</div>
          <div className="small muted">{c.lagerwert !== null ? eur0(c.lagerwert) : "–"} gebunden ÷ {c.monatsumsatz !== null ? eur0(c.monatsumsatz) : "–"} Umsatz ({c.umsatzVon.split("-").reverse().join(".")}–{c.umsatzBis.split("-").reverse().join(".")}{c.monatsumsatz !== null && !c.umsatzVollstaendig ? ", unvollständig" : ""})</div>
        </div>
      </div>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table className="table small" data-testid="kapital-c2c-phasen">
          <thead><tr><th>Phase</th><th>Median</th></tr></thead>
          <tbody>
            <tr><td>Bestellung → Wareneingang</td><td>{phaseText(g.wareneingang, s.wareneingang)}</td></tr>
            <tr><td>Wareneingang → Versand an Amazon{c.prepName ? ` (Prep Center ${c.prepName})` : " (Prep Center)"}</td><td>{phaseText(g.prep, s.prep)}</td></tr>
            <tr><td>Versand → Amazon „Empfang abgeschlossen“</td><td>{phaseText(g.amazonEingang, s.amazonEingang)}</td></tr>
            <tr><td>Eingang bei Amazon → 90 % verkauft</td><td>{phaseText(g.abverkauf, null)}</td></tr>
            <tr><td>Auszahlung</td><td>{AUSZAHLUNG_TAGE} T <span className="muted">(fest)</span></td></tr>
          </tbody>
        </table>
      </div>
      {c.jeGruppe.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="small">Je Lieferant / Quelle ({c.jeGruppe.length})</summary>
          <div className="table-wrap">
            <table className="table small" data-testid="kapital-c2c-gruppen">
              <thead><tr><th>Lieferant / Quelle</th><th>Einkäufe</th><th>Wareneingang</th><th>Prep</th><th>Amazon-Eingang</th><th>Abverkauf</th><th>Cash-to-Cash</th></tr></thead>
              <tbody>
                {c.jeGruppe.slice(0, 30).map((x) => (
                  <tr key={x.gruppe}>
                    <td>{x.gruppe}</td><td>{x.n}</td><td>{tageText(x.phasen.wareneingang.median)}</td><td>{tageText(x.phasen.prep.median)}</td><td>{tageText(x.phasen.amazonEingang.median)}</td><td>{tageText(x.phasen.abverkauf.median)}</td>
                    <td>{x.cashToCash.tage === null ? "–" : `${x.cashToCash.tage} T${x.cashToCash.vollstaendig ? "" : " (teils Standard)"}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {c.zuBereinigen > 0 && (
        <div className="notice notice-warn small" style={{ marginTop: 8 }} data-testid="kapital-bereinigen">
          {c.zuBereinigen} Einkauf{c.zuBereinigen === 1 ? "" : "e"} seit über {BEREINIGEN_TAGE} Tagen weder erhalten noch storniert – verfälscht Durchlaufzeiten und Kapitalbedarf. <Link href="/einkauf?ansicht=offen">Einkäufe bereinigen →</Link>
        </div>
      )}
      <KpiMeta period="Einkäufe der letzten 365 Tage (erhalten) · Umsatz: letzte 30 Tage" source="Einkauf (bestellt/erhalten), sellerboard (FBA-Sendungen erstellt/geschlossen, Verkäufe je SKU und Monat)" stand="aktuell (10 Min. zwischengespeichert)" />
      <p className="small muted" style={{ marginBottom: 0 }}>Grundlage für den Vorlauf der Umschlagszeit im Deal-Eingang (ab {MIN_BASIS} Einkäufen je Phase, sonst Standardwerte). Abverkauf aus Monatswerten – daher grob.</p>
    </section>
  );
}

/** B15.5: Begriff klar abgrenzen – gebundenes Kapital ist Ware, die schon da ist; Kapitalbedarf ist, was nachbestellt werden müsste. */
const GEBUNDEN_DEFINITION = "Gebundenes Kapital = Ware, die schon da ist: Bestand bei Amazon (verkaufbar, reserviert, unterwegs) + eigenes Lager × gültiger EK (netto). Artikel ohne EK sind nicht enthalten.";

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
  const [data, settings, gestrandet, weitere] = await Promise.all([
    kapitalAmpel(session.tenantId, todayIso()),
    getSettings(session.tenantId),
    gestrandetUebersicht(session.tenantId).catch(() => null),
    weitereGebuehren(session.tenantId).catch(() => null),
  ]);
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
  const c2c = await cashToCashKennzahlen(session.tenantId, data.zeilen.length ? data.summe.gesamt : null).catch(() => null);
  const liqZeile = await liquidationsStand(session.tenantId).then(liquidationsZeile).catch(() => null);

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
        Reichweite, ältestes Lageralter (Amazon-Bericht) und Preis gegen Break-even, dazu die FBA-Lagergebühr laut Bericht („Lagergebühr frisst Marge“, „Remission prüfen“). <strong>Rot</strong> wird bei den <Link href="/einkauf/vorschlaege">Bestellvorschlägen</Link> nicht mehr vorgeschlagen und in der <Link href="/cashflow">Liquidität</Link> nicht eingerechnet.
      </p>

      {liqZeile && (
        <div className="notice notice-info small" style={{ marginBottom: 12 }} data-testid="kapital-liquidation">
          {liqZeile} – <Link href="/repricer/bqool#liquidation">Liste und Rückkehr-Vorschläge</Link>
        </div>
      )}
      {((gestrandet && gestrandet.gestrandet.anzahl > 0) || (weitere && weitere.gesamt > 0)) && (
        <div className="notice notice-warn small" style={{ marginBottom: 12 }} data-testid="kapital-amazon-berichte">
          {gestrandet && gestrandet.gestrandet.anzahl > 0 && (
            <div>
              Gestrandeter Bestand bei Amazon: <strong>{gestrandet.gestrandet.stueck} Stück</strong> in {gestrandet.gestrandet.anzahl} SKUs, <strong>{eur2(gestrandet.gestrandet.gebunden)}</strong> gebunden und nicht verkäuflich – <Link href="/amazon-faelle#gestrandet">in der Fall-Zentrale ansehen</Link>.
            </div>
          )}
          {weitere && weitere.gesamt > 0 && (
            <div>
              Weitere Amazon-Gebühren seit {weitere.ab}: <strong>{eur2(weitere.gesamt)}</strong> ({weitere.je_art.filter((x) => x.summe > 0).map((x) => `${x.text} ${eur2(x.summe)}`).join(" · ")}). Langzeit-Lagergebühren stecken in der Lagergebühr je Produkt.
            </div>
          )}
        </div>
      )}

      {data.zeilen.length === 0 ? (
        <div className="card card-pad" data-testid="kapital-leer">
          Noch kein Bestand. Die Werte kommen mit dem sellerboard-Abgleich – sofort über <Link href="/anbindungen#sellerboard">Anbindungen → sellerboard → „Jetzt abgleichen“</Link>.
          {c2c && c2c.einkaeufe > 0 && <CashToCash c={c2c} />}
        </div>
      ) : (
        <>
          <div className="stack" style={{ gap: 6 }} data-kpi-group>
            <div className="grid-kpi" data-testid="kapital-summen">
              <div className="card card-pad">
                <div className="kpi-label" title={GEBUNDEN_DEFINITION} style={{ cursor: "help" }}>Gebundenes Kapital gesamt ⓘ</div>
                <div className="kpi-value" data-testid="kapital-gesamt" title={GEBUNDEN_DEFINITION}>{eur0(data.summe.gesamt)}</div>
                <div className="small muted">{data.zeilen.length} Produkte{ohneEk ? ` · ${ohneEk} ohne EK (nicht enthalten)` : ""} · <Link href="/einkauf/vorschlaege?weg=sellerboard" title={KAPITALBEDARF_DEFINITION}>nicht dasselbe wie der Kapitalbedarf der Bestellvorschläge</Link></div>
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
            <KpiMeta period="Gewinn: letzte 90 Tage · Bestand: aktuell" source="sellerboard (Bestand, Gewinn je Monat), eigenes Lager, EK im Seller-System, Amazon-Lageralter und Lagergebühren-Bericht, Keepa (Buy Box)" stand={stand} />
          </div>
          {c2c && <CashToCash c={c2c} />}

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
                        {z.lager && <div className="muted" data-testid="kapital-lager">Lagergebühr {z.lager.monat}: {eur2(z.lager.gebuehrMonat)}/Monat{z.lager.jeStueckMonat !== null ? ` · ${eur2(z.lager.jeStueckMonat)} je Stück` : ""}{z.lager.uebergross ? " · übergroß" : ""}</div>}
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
