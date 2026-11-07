import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { lernBerichtFuer } from "@/lib/deal-eingang/wert";
import { KpiMeta } from "@/components/kpi";
import { ergebnisseAction, lernschleifeAntwortAction, lernschleifeErstellenAction } from "../actions";
import { lernschleifeBericht, type LernFrage } from "@/lib/deal-eingang/lernschleife";
import { LERN_ANTWORTEN, LERN_GRUENDE_EXTRA, MARGE_GRENZE, monatName, TREFFER_ZIEL } from "@/lib/deal-eingang/lernschleife-logic";
import { DAUMEN_GRUENDE, DAUMEN_GRUENDE_HOCH } from "@/db/tables/deal-eingang";
import { formatEuro } from "@/lib/numbers";

const LERN_GRUENDE = [...new Set<string>([...DAUMEN_GRUENDE.filter((g) => g !== "sonstiges"), ...DAUMEN_GRUENDE_HOCH, ...LERN_GRUENDE_EXTRA])];

/** B28.8: ein Verlustprodukt mit den drei Knöpfen (nur Inhaber) bzw. der gegebenen Antwort. */
function LernFrageZeile({ f, inhaber }: { f: LernFrage; inhaber: boolean }) {
  const kopf = (
    <div>
      <strong>{(f.titel ?? f.asin ?? f.skus[0] ?? "Produkt").slice(0, 80)}</strong>
      <span className="small muted"> · {f.asin ?? f.skus.join(", ")}</span>
      <div className="small">
        Gewinn <strong>{formatEuro(f.gewinn ?? 0)}</strong> · Marge {f.marge === null ? "–" : `${String(f.marge).replace(".", ",")} %`} · {f.units ?? 0} verkauft · Umsatz {formatEuro(f.umsatz ?? 0)}
        {f.letzterEinkauf ? ` · zuletzt eingekauft ${f.letzterEinkauf.split("-").reverse().join(".")}` : ""}
        {f.quelle ? ` · Quelle ${f.quelle}` : ""}
        {f.marke ? ` · Marke ${f.marke}` : ""}
      </div>
    </div>
  );
  if (f.antwort) {
    return (
      <li className="card card-pad" data-testid="dl-ls-frage" data-beantwortet="1" data-asin={f.asin ?? ""}>
        {kopf}
        <div className="small" data-testid="dl-ls-antwort">
          Antwort: <strong>{LERN_ANTWORTEN[f.antwort]}</strong>
          {f.gruende.length ? ` · ${f.gruende.join(", ")}` : ""}
          {f.freitext ? ` · „${f.freitext}“` : ""}
        </div>
      </li>
    );
  }
  return (
    <li className="card card-pad" data-testid="dl-ls-frage" data-beantwortet="0" data-asin={f.asin ?? ""}>
      {kopf}
      {inhaber ? (
        <form action={lernschleifeAntwortAction} className="stack small" style={{ gap: 6, marginTop: 6 }}>
          <input type="hidden" name="id" value={f.id} />
          <details>
            <summary>Grund (optional)</summary>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              {LERN_GRUENDE.map((g) => (
                <label key={g} className="row" style={{ gap: 4 }}><input type="checkbox" name="grund" value={g} /> {g}</label>
              ))}
            </div>
            <input className="input" name="freitext" placeholder="Freitext (optional)" maxLength={500} style={{ marginTop: 4, width: "100%" }} />
          </details>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <button className="btn btn-sm" name="antwort" value="nie_wieder" data-testid="dl-ls-nie">Nie wieder kaufen</button>
            <button className="btn btn-sm" name="antwort" value="pech" data-testid="dl-ls-pech">Würde ich wieder kaufen (Pech)</button>
            <button className="btn btn-sm" name="antwort" value="unklar" data-testid="dl-ls-unklar">Weiß nicht warum</button>
          </div>
        </form>
      ) : (
        <div className="small muted">Offen – beantwortet nur der Inhaber.</div>
      )}
    </li>
  );
}

// Abschnitt 11: Monatsbericht „Wie gut lag der Deal-Wert?“ – Trefferquote, verpasste gute Deals, Fehlkäufe,
// wichtigste Merkmale (ab Lernmodell) und Stand der Lugru-Deals-History (nur Anzahlen).

const MERKMAL: Record<string, string> = {
  roi: "ROI",
  marge: "Marge",
  schwankung90: "Preisschwankung 90 Tage",
  einbrueche180: "Preiseinbrüche 180 Tage",
  angeboteTrend30: "Angebote-Trend 30 Tage",
  amazonAnteil: "Amazon-Anteil",
  bbAbweichung90: "Buy Box vs. Ø 90 Tage",
  rangTrend: "Rang-Trend",
  monatlichVerkauft: "Verkäufe/Monat",
  fbaAnteil: "FBA-Anteil",
  angebote: "Angebote",
};

function monate(heute: string): string[] {
  const out: string[] = [];
  const d = new Date(`${heute.slice(0, 7)}-01T00:00:00Z`);
  for (let i = 0; i < 12; i++) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}
const monatText = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });

export default async function DealLernenPage({ searchParams }: { searchParams: Promise<{ monat?: string; meldung?: string }> }) {
  const session = await requireArea("dealeingang");
  const sp = await searchParams;
  const liste = monate(todayIso());
  const monat = sp.monat && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.monat) ? sp.monat : liste[1];
  const [b, ls] = await Promise.all([lernBerichtFuer(session.tenantId, monat), lernschleifeBericht(session.tenantId).catch(() => null)]);
  const inhaber = session.role === "owner" && !session.readOnly;
  const lsAktuell = ls?.fragen.filter((f) => f.monat === ls.monat) ?? [];
  const lsAelter = ls?.fragen.filter((f) => f.monat !== ls.monat) ?? [];
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/deal-eingang">Deal-Eingang</Link></div><h1>Deal-Wert: Wie gut lag er?</h1></div>
        <form className="row" style={{ gap: 8, alignItems: "center" }}>
          <select name="monat" defaultValue={monat} aria-label="Monat">
            {liste.map((m) => <option key={m} value={m}>{monatText(m)}</option>)}
          </select>
          <button className="btn" type="submit">Anzeigen</button>
        </form>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>{sp.meldung}</div>}
      {!session.readOnly && (
        <form action={ergebnisseAction} style={{ marginBottom: 12 }}>
          <input type="hidden" name="monat" value={monat} />
          <button className="btn" type="submit" data-testid="dl-ergebnisse" title="Sonst einmal täglich automatisch">Ergebnisse jetzt aktualisieren</button>
          <span className="small muted" style={{ marginLeft: 8 }}>reales Ergebnis gekaufter Deals 30/60/90 Tage nach Wareneingang (sellerboard)</span>
        </form>
      )}

      <div className="stack" style={{ gap: 6 }} data-kpi-group data-testid="dl-bericht" data-monat={monat}>
        <div className="grid-kpi">
          <div className="card card-pad"><div className="kpi-label">Deals</div><div className="kpi-value" data-testid="dl-deals">{b.deals}</div><div className="small muted">{b.mitWert} mit Deal-Wert</div></div>
          <div className="card card-pad"><div className="kpi-label">über der Schwelle</div><div className="kpi-value">{b.ueberSchwelle}</div><div className="small muted">Schwelle {b.schwelle}/100</div></div>
          <div className="card card-pad">
            <div className="kpi-label">Trefferquote</div>
            <div className={`kpi-value${b.trefferquote === null ? " muted" : ""}`} data-testid="dl-treffer">{b.trefferquote === null ? "noch keine" : `${b.trefferquote} %`}</div>
            <div className="small muted">{b.trefferBasis ? `aus ${b.trefferBasis} Deals mit Entscheidung` : "keine Entscheidung über der Schwelle"}</div>
          </div>
          <div className="card card-pad"><div className="kpi-label">Fehlkäufe</div><div className="kpi-value">{b.fehlkaeufe.length}</div><div className="small muted">realer ROI unter 0</div></div>
        </div>
        <KpiMeta period={monatText(monat)} source="Deal-Eingang (Deal-Wert beim Eingang, Entscheidung, 👍/👎), sellerboard (realer ROI)" stand="aktuell" />
      </div>
      <p className="small muted">
        Treffer = Deal-Wert über der Schwelle und danach gekauft (realer ROI ≥ Ziel bzw. Ergebnis noch offen) oder 👍. Verfahren: {b.verfahren}.
        Die roten Kriterien der Ampel gelten immer – ein roter Deal hat höchstens 30.
      </p>

      <div className="grid-kpi" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", marginTop: 12 }}>
        <section className="card card-pad" data-testid="dl-verpasst">
          <h3 style={{ marginTop: 0 }}>Verpasste gute Deals</h3>
          <p className="small muted">Deal-Wert unter 50, aber gekauft und gut gelaufen bzw. 👍.</p>
          {b.verpasst.length ? (
            <ul className="small">{b.verpasst.map((d) => <li key={d.id}><Link href={`/deal-eingang/${d.id}`}>{d.titel ?? "Deal"}</Link> · {d.datum} · Wert {d.wert}</li>)}</ul>
          ) : <p className="small muted">Keine.</p>}
        </section>
        <section className="card card-pad" data-testid="dl-fehlkaeufe">
          <h3 style={{ marginTop: 0 }}>Fehlkäufe</h3>
          <p className="small muted">Gekauft, realer ROI unter 0 (sellerboard, ab 30 Tagen nach Wareneingang).</p>
          {b.fehlkaeufe.length ? (
            <ul className="small">{b.fehlkaeufe.map((d) => <li key={d.id}><Link href={`/deal-eingang/${d.id}`}>{d.titel ?? "Deal"}</Link> · {d.datum} · Wert {d.wert ?? "–"} · ROI {d.realerRoi} %</li>)}</ul>
          ) : <p className="small muted">Keine.</p>}
        </section>
      </div>

      <section className="card card-pad" style={{ marginTop: 12 }} data-testid="dl-gruende">
        <h3 style={{ marginTop: 0 }}>Deine Gründe</h3>
        <p className="small muted">
          👍 im Monat: {b.gruende.hochBegruendet + b.gruende.hochOhneGrund}, davon {b.gruende.hochBegruendet} mit Grund. Ein 👍 mit Grund zählt im Deal-Wert stärker; trifft ein Grund auf einen neuen Deal zu
          (z. B. ein Land mit höchstens 1 Angebot), steigt dessen Wert (👎-Gründe senken ihn).
        </p>
        <div className="grid-kpi" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          <div data-testid="dl-gruende-hoch">
            <div className="kpi-label">👍 Gründe</div>
            {b.gruende.hoch.length ? <ul className="small">{b.gruende.hoch.map((g) => <li key={g.grund}>{g.grund}: {g.anzahl}×</li>)}</ul> : <p className="small muted">Keine.</p>}
          </div>
          <div data-testid="dl-gruende-runter">
            <div className="kpi-label">👎 Gründe</div>
            {b.gruende.runter.length ? <ul className="small">{b.gruende.runter.map((g) => <li key={g.grund}>{g.grund}: {g.anzahl}×</li>)}</ul> : <p className="small muted">Keine.</p>}
          </div>
        </div>
        {b.gruende.freitexte.length > 0 && (
          <ul className="small" data-testid="dl-freitexte">
            {b.gruende.freitexte.map((f) => <li key={f.id}>{f.daumen === "hoch" ? "👍" : "👎"} <Link href={`/deal-eingang/${f.id}`}>{f.titel ?? "Deal"}</Link> · {f.datum}: „{f.text}“</li>)}
          </ul>
        )}
      </section>

      {b.wichtigsteMerkmale && (
        <section className="card card-pad" style={{ marginTop: 12 }} data-testid="dl-merkmale">
          <h3 style={{ marginTop: 0 }}>Was am meisten zählt (Lernmodell)</h3>
          <ul className="small">{b.wichtigsteMerkmale.map((m) => <li key={m.merkmal}>{MERKMAL[m.merkmal] ?? m.merkmal}: {m.gewicht > 0 ? "spricht dafür" : "spricht dagegen"} ({m.gewicht.toLocaleString("de-DE")})</li>)}</ul>
        </section>
      )}

      <section className="card card-pad" style={{ marginTop: 12 }} id="lernschleife" data-testid="dl-lernschleife">
        <h3 style={{ marginTop: 0 }}>Lernschleife Verlustprodukte{ls?.monat ? ` · ${monatName(ls.monat)}` : ""}</h3>
        <p className="small muted">
          Am 3. jedes Monats: Produkte mit Verlust oder Marge unter {MARGE_GRENZE} % im Vormonat (sellerboard je SKU, größter Verlust zuerst), nur Einkäufe der letzten 6 Monate. „Nie wieder“ zieht bei ähnlichen neuen Deals
          (gleiche Marke; gleiche Kategorie und Quelle; gleiche Quelle mit ähnlich vielen Angeboten) Punkte ab, „Pech“ und „Weiß nicht warum“ geben einen Hinweis – jeweils „ähnlicher Fehlkauf am …“ im Deal-Wert.
        </p>
        {inhaber && (
          <form action={lernschleifeErstellenAction} style={{ marginBottom: 8 }}>
            <button className="btn btn-sm" type="submit" data-testid="dl-ls-erstellen" title="Sonst automatisch am 3. des Monats (mit Push)">Liste für den Vormonat jetzt erstellen</button>
          </form>
        )}
        {ls && ls.fragen.length > 0 ? (
          <>
            <p className="small" data-testid="dl-ls-stand">
              {ls.offen} offen, {ls.beantwortet} beantwortet. Bisher insgesamt: {ls.antworten.nie_wieder}× „Nie wieder“, {ls.antworten.pech}× „Pech“, {ls.antworten.unklar}× „Weiß nicht warum“
              {ls.gruende.length ? ` · Gründe: ${ls.gruende.slice(0, 6).map((g) => `${g.grund} ${g.anzahl}×`).join(", ")}` : ""}.
            </p>
            <ul className="stack" style={{ listStyle: "none", padding: 0, gap: 8 }} data-testid="dl-ls-liste">
              {lsAktuell.map((f) => <LernFrageZeile key={f.id} f={f} inhaber={inhaber} />)}
            </ul>
            {lsAelter.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary className="small">Frühere Monate ({lsAelter.length})</summary>
                <ul className="stack" style={{ listStyle: "none", padding: 0, gap: 8, marginTop: 8 }}>
                  {lsAelter.map((f) => <LernFrageZeile key={f.id} f={f} inhaber={inhaber} />)}
                </ul>
              </details>
            )}
          </>
        ) : (
          <p className="small muted" data-testid="dl-ls-leer">Noch keine Liste – kommt am 3. des Monats (Push an den Inhaber).</p>
        )}
        <h4 style={{ marginBottom: 4 }}>Trefferquote je Einkaufsmonat</h4>
        <p className="small muted" style={{ marginTop: 0 }}>Anteil der Einkäufe (Chargen mit Verkäufen) mit Marge über der Ziel-Marge ({ls ? String(ls.zielMarge).replace(".", ",") : "–"} %) – Ziel {TREFFER_ZIEL} %. Marge aus sellerboard ab dem Einkaufsmonat.</p>
        {ls && ls.trefferquote.length > 0 ? (
          <div className="table-wrap">
            <table className="table small" data-testid="dl-ls-treffer">
              <thead><tr><th>Einkaufsmonat</th><th>Einkäufe</th><th>Marge über Ziel</th><th>Trefferquote</th></tr></thead>
              <tbody>
                {ls.trefferquote.map((t) => (
                  <tr key={t.monat}><td>{monatName(t.monat)}</td><td>{t.einkaeufe}</td><td>{t.ueberZiel}</td><td>{t.quote < TREFFER_ZIEL ? <span className="tag tag-warn">{t.quote} %</span> : `${t.quote} %`}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="small muted">Noch keine Einkäufe mit Verkaufsdaten.</p>
        )}
        <KpiMeta period="Verlustprodukte: Vormonat · Trefferquote: Einkäufe der letzten 6 Monate" source="sellerboard (Gewinn und Umsatz je SKU und Monat), Chargen und Einkäufe im Seller-System" stand="aktuell" />
      </section>

      <section className="card card-pad" style={{ marginTop: 12 }} data-testid="dl-lugru">
        <h3 style={{ marginTop: 0 }}>Lugru-Deals-History</h3>
        {b.lugru.deals ? (
          <p className="small">
            {b.lugru.deals.toLocaleString("de-DE")} gepostete Deals, davon {b.lugru.mitKauf.toLocaleString("de-DE")} mit ✅ ({b.lugru.kaeufe.toLocaleString("de-DE")} Kauf-Reaktionen).
            {b.lugru.zuletzt && <> Stand {b.lugru.zuletzt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}.</>}
          </p>
        ) : (
          <p className="small muted">Noch nichts übernommen. In Lugru Deals unter Monitor → Einstellungen → eBay die Adresse des Seller-Systems und den Verbindungsschlüssel (Anbindungen → Lugru Deals) eintragen – dann kommt die History von selbst.</p>
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>Reaktionen zählen nur als Anzahl und als schwaches Signal: keine Reaktion heißt nicht „nicht gekauft“. Keine Namen, keine Mitgliederprofile.</p>
      </section>
    </>
  );
}
