import Link from "next/link";
import { KpiMeta } from "@/components/kpi";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { VERLUST_REGEL, verlustStopp } from "@/lib/money/verlust-service";
import { ausnahmeAction, ausnahmeBeendenAction, schwelleAction } from "./actions";

// Verlust-Stopp: Artikel, die gerade mit Verlust verkaufen (2 von 3 Tagen im Minus oder ≥ 5 Stück mit Verlust).
// Je Fall eine wichtige Aufgabe; bewusste Verlustverkäufe als Ausnahme mit Wochensumme.

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

export default async function VerlustPage({ searchParams }: { searchParams: Promise<{ q?: string; meldung?: string }> }) {
  const session = await requireArea("geld");
  const sp = await searchParams;
  const heute = todayIso();
  const v = await verlustStopp(session.tenantId, heute);
  const q = (sp.q ?? "").trim().toLowerCase();
  const faelle = q ? v.faelle.filter((f) => f.sku.toLowerCase().includes(q) || (f.asin ?? "").toLowerCase().includes(q) || (f.name ?? "").toLowerCase().includes(q)) : v.faelle;
  const summe = v.faelle.reduce((n, f) => n + f.summe, 0);
  const ausnahmenWoche = v.ausnahmen.filter((a) => a.aktiv).reduce((n, a) => n + a.woche.summe, 0);
  const stand = v.stand ? v.stand.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "noch kein Abgleich";
  const fensterText = `${dmy(v.fenster[0])} – ${dmy(v.fenster[v.fenster.length - 1])}`;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Finanzen</div>
          <h1>Verlust-Stopp</h1>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-ok small" style={{ marginBottom: 12 }} role="status">{sp.meldung}</div>}
      <p className="small muted" style={{ margin: "0 0 14px", maxWidth: 860 }}>
        Täglich nach dem sellerboard-Abgleich: Ist-Gewinn je Produkt der letzten {VERLUST_REGEL.fenster} abgeschlossenen Tage. Auslöser: an {VERLUST_REGEL.tage} von {VERLUST_REGEL.fenster} Tagen im Minus (nur Tage mit Verkauf) oder mindestens {VERLUST_REGEL.stueck} Stück mit Verlust verkauft. Ein Minus ohne Verkauf (Lagergebühr, Erstattungskosten) steht unten getrennt als „Kosten ohne Verkauf“.
        Je Fall entsteht eine <strong>wichtige Aufgabe</strong> mit Break-even, Buy Box (Keepa) und BQool-Regel. Bewusste Verlustverkäufe (Abverkauf, Liquidation) als Ausnahme markieren.
      </p>

      {!v.bqoolExport && (
        <div className="notice notice-warn small" style={{ marginBottom: 12 }} data-testid="verlust-bqool-fehlt">
          Noch kein BQool-Export hochgeladen – deshalb fehlen Regel und Mindestpreis je Fall. <Link href="/repricer#bqool-upload">Export „Manage Listings“ hochladen</Link>.
        </div>
      )}
      {v.tageMitDaten.length < v.fenster.length && (
        <div className="notice notice-warn small" style={{ marginBottom: 12 }} data-testid="verlust-luecke">
          Tageswerte fehlen für {v.fenster.filter((d) => !v.tageMitDaten.includes(d)).map(dm).join(", ")} – sie kommen mit dem täglichen Komplett-Abgleich (<Link href="/anbindungen#sellerboard">Anbindungen → sellerboard</Link>).
        </div>
      )}

      <div className="stack" style={{ gap: 6 }} data-kpi-group>
        <div className="grid-kpi">
          <div className="card card-pad">
            <div className="kpi-label">Fälle</div>
            <div className="kpi-value" data-testid="verlust-anzahl">{v.tageMitDaten.length ? v.faelle.length : "keine Daten"}</div>
            <div className="small muted">ohne Ausnahmen</div>
          </div>
          <div className="card card-pad">
            <div className="kpi-label">Gewinn der Fälle (3 Tage)</div>
            <div className="kpi-value" style={summe < 0 ? { color: "var(--danger)" } : undefined}>{v.tageMitDaten.length ? eur(summe) : "keine Daten"}</div>
          </div>
          <div className="card card-pad">
            <div className="kpi-label">Ausnahmen (7 Tage)</div>
            <div className="kpi-value" data-testid="verlust-ausnahmen-summe">{eur(ausnahmenWoche)}</div>
            <div className="small muted">{v.ausnahmen.filter((a) => a.aktiv).length} aktiv</div>
          </div>
        </div>
        <KpiMeta period={fensterText} source="sellerboard (Gewinn je Produkt und Tag, Amazon + eBay)" stand={stand} />
      </div>

      <h2 style={{ marginTop: 18 }}>Fälle</h2>
      {faelle.length === 0 ? (
        <div className="card card-pad small muted" data-testid="verlust-keine">{v.tageMitDaten.length ? "Kein Artikel erfüllt gerade die Verlust-Regel." : "Noch keine Tageswerte."}</div>
      ) : (
        <div className="stack" style={{ gap: 10 }} data-testid="verlust-faelle">
          {faelle.map((f) => (
            <div key={f.sku} className="card card-pad" data-testid="verlust-fall" data-sku={f.sku}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <strong>{f.name ?? f.sku}</strong>
                  <div className="small muted">{f.sku}{f.asin ? ` · ${f.asin}` : ""}</div>
                </div>
                <span className="tag tag-danger">{f.grund}</span>
              </div>
              <div className="small" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
                {f.tage.map((t) => (
                  <span key={t.day} style={t.gewinn !== null && t.gewinn < 0 ? { color: "var(--danger)" } : undefined}>
                    {dm(t.day)}: {t.gewinn === null ? "–" : eur(t.gewinn)}{t.units ? ` (${t.units} St.)` : ""}
                  </span>
                ))}
                <strong>Summe {eur(f.summe)}</strong>
              </div>
              <div className="small" style={{ marginTop: 6 }} data-testid="verlust-daten">
                Ø Preis {f.preis !== null ? eur(f.preis) : "–"} · Break-even {f.breakEven !== null ? <strong>{eur(f.breakEven)}</strong> : "unbekannt"} · Buy Box {f.buybox ? `${f.buybox.preis !== null ? eur(f.buybox.preis) : "keine"}${f.buybox.amazon ? " (Amazon)" : ""} – ${f.buybox.quelle}` : "keine Keepa-Daten"} ·{" "}
                BQool {f.bqool ? `${f.bqool.marktplatz}: ${f.bqool.regel ?? "–"}, Min ${f.bqool.min !== null ? eur(f.bqool.min) : "–"}` : "nicht im Export"}
                {f.bqool && f.breakEven !== null && f.bqool.min !== null && f.bqool.min < f.breakEven && <span style={{ color: "var(--danger)" }}> – Min unter Break-even</span>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                <Link className="btn btn-small" href={`/repricer?q=${encodeURIComponent(f.sku)}`}>Repricer</Link>
                <Link className="btn btn-small" href={`/produkte/sku/${encodeURIComponent(f.sku)}`}>Produkt</Link>
                <details>
                  <summary className="small">Als Ausnahme markieren</summary>
                  <form action={ausnahmeAction} style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                    <input type="hidden" name="sku" value={f.sku} />
                    <input name="grund" placeholder="Grund, z. B. Abverkauf" aria-label="Grund" data-testid="verlust-grund" />
                    <input name="bis" placeholder="bis TT.MM.JJJJ (optional)" aria-label="bis" />
                    <button className="btn btn-small" type="submit" data-testid="verlust-ausnahme">Ausnahme</button>
                  </form>
                </details>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ marginTop: 18 }}>Kosten ohne Verkauf</h2>
      <p className="small muted" style={{ margin: "0 0 8px", maxWidth: 860 }}>
        Tage ohne verkaufte Einheit, an denen trotzdem Kosten anfielen (Lagergebühr, Erstattungskosten …), letzte 7 Tage – nur Hinweis, keine Aufgabe. Angezeigt ab {eur(v.schwelle)} je Artikel und Woche.
      </p>
      {v.kostenOhneVerkauf.length === 0 ? (
        <div className="card card-pad small muted" data-testid="verlust-kosten-keine">Keine Artikel über der Schwelle.</div>
      ) : (
        <div className="table-wrap card">
          <table className="table" data-testid="verlust-kosten">
            <thead>
              <tr>
                <th>Produkt</th>
                <th>Tage</th>
                <th className="right">Kosten 7 Tage</th>
              </tr>
            </thead>
            <tbody>
              {v.kostenOhneVerkauf.map((k) => (
                <tr key={k.sku} data-testid="verlust-kosten-zeile" data-sku={k.sku}>
                  <td>
                    {k.name ?? k.sku}
                    <div className="small muted">
                      {k.sku}
                      {k.asin ? ` · ${k.asin}` : ""}
                    </div>
                  </td>
                  <td className="small">{k.tage.map((t) => `${dm(t.day)} ${eur(t.kosten)}`).join(" · ")}</td>
                  <td className="right num" style={{ color: "var(--danger)" }}>{eur(k.summe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form action={schwelleAction} className="small" style={{ display: "flex", gap: 6, alignItems: "center", margin: "8px 0 0", flexWrap: "wrap" }}>
        <label htmlFor="verlust-schwelle">Schwelle je Woche (€)</label>
        <input id="verlust-schwelle" name="schwelle" defaultValue={String(v.schwelle).replace(".", ",")} size={6} inputMode="decimal" />
        <button className="btn btn-small" type="submit">Speichern</button>
      </form>

      <h2 style={{ marginTop: 18 }}>Ausnahmen</h2>
      {v.ausnahmen.length === 0 ? (
        <div className="card card-pad small muted">Keine Ausnahmen.</div>
      ) : (
        <div className="table-wrap card">
          <table className="table" data-testid="verlust-ausnahmen">
            <thead>
              <tr>
                <th>Produkt</th>
                <th>Grund</th>
                <th>bis</th>
                <th className="right">Gewinn 7 Tage</th>
                <th className="right">Stück</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {v.ausnahmen.map((a) => (
                <tr key={a.sku} data-testid="verlust-ausnahme-zeile" data-sku={a.sku} style={a.aktiv ? undefined : { opacity: 0.6 }}>
                  <td>{a.name ?? a.sku}<div className="small muted">{a.sku}</div></td>
                  <td>{a.grund}</td>
                  <td>{a.bis ? dmy(a.bis) : "unbefristet"}{!a.aktiv && <div className="small muted">abgelaufen</div>}</td>
                  <td className="right num" style={a.woche.summe < 0 ? { color: "var(--danger)" } : undefined}>{a.woche.tageMitDaten ? eur(a.woche.summe) : <span className="muted">keine Daten</span>}</td>
                  <td className="right num">{a.woche.stueck}</td>
                  <td>
                    <form action={ausnahmeBeendenAction}>
                      <input type="hidden" name="sku" value={a.sku} />
                      <button className="btn-link small" type="submit" data-testid="verlust-ausnahme-beenden">Beenden</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
