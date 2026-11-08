import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { befundeOffen, checkTrefferquote } from "@/lib/bqool/listing-check";
import { BEFUND_TITEL, CHECK_STANDARD } from "@/lib/bqool/listing-check-logic";
import { formatDate, formatEuro } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { befundAction, checkJetztAction } from "./actions";

// B32 Listing-Check: täglich nach dem BQool-Ist (06:00) bzw. auf Knopfdruck – Befunde nach Dringlichkeit (Euro-Potenzial
// = fehlende Verkäufe × Marge). Freigaben laufen über den BQool-Upload (B31.2), nie direkt in BQool.

type SP = { meldung?: string; befund?: string };

export default async function ListingCheckPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requireArea("buchhaltung");
  const sp = await searchParams;
  const [s, befunde, treffer] = await Promise.all([getSettings(session.tenantId), befundeOffen(session.tenantId), checkTrefferquote(session.tenantId).catch(() => null)]);
  const st = s.bqool.listingCheckStand;
  const inhaber = session.role === "owner" && !session.readOnly;
  const filter = sp.befund ? Number(sp.befund) : null;
  const liste = filter ? befunde.filter((b) => (b.daten as { nr?: number }).nr === filter) : befunde;
  const jeNr = new Map<number, number>();
  for (const b of befunde) {
    const nr = (b.daten as { nr?: number }).nr ?? 0;
    jeNr.set(nr, (jeNr.get(nr) ?? 0) + 1);
  }
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/repricer">Repricer</Link></div><h1>Listing-Check</h1></div>
        {!session.readOnly && <form action={checkJetztAction}><button className="btn" type="submit" data-testid="lc-jetzt">Jetzt prüfen</button></form>}
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>{sp.meldung}</div>}
      <p className="small muted" style={{ marginTop: 0 }}>
        Täglich nach dem BQool-Ist (06:00): Stufe A = die {CHECK_STANDARD.stufeA} SKUs mit dem höchsten Wert (gebundenes Kapital × Nachfrage) plus alle Schnelldreher und SKUs mit offenem Befund, Stufe B wöchentlich alle übrigen mit Bestand, Stufe C monatlich ohne Bestand (nur Min aus der Datei). Keepa nur für Stufe A (höchstens {CHECK_STANDARD.keepaJeLauf} Abrufe je Lauf, Reserve {CHECK_STANDARD.keepaTokenReserve} Tokens). Keepa-Zahlen („monatlich verkauft“, Buy Box) sind Marktdaten, keine eigenen Verkäufe; sellerboard-Tageswerte kommen mit einem Tag Verzug.
      </p>
      <section className="card card-pad stack" data-testid="lc-stand">
        {st ? (
          <div className="small">
            Letzter Lauf {formatDate(st.am)} · {Math.round(st.dauerMs / 100) / 10} s · {st.geprueft} SKUs geprüft (A {st.stufeA} / B {st.stufeB} / C {st.stufeC}) · Keepa-Abrufe {st.keepaAbrufe} · {st.neu} neu, {st.offen} offen
            {st.unvollstaendig > 0 && <div className="notice notice-warn small" data-testid="lc-unvollstaendig" style={{ marginTop: 6 }}>Check unvollständig: {st.unvollstaendig} SKU{st.unvollstaendig === 1 ? "" : "s"} der Stufe A ohne frische Keepa-Daten (Token-Mangel bzw. Budget je Lauf).</div>}
            {st.bqoolAlt && <div className="notice notice-warn small" data-testid="lc-bqool-alt" style={{ marginTop: 6 }}>BQool-Stand alt ({st.bqoolStand ? formatDate(st.bqoolStand.slice(0, 10)) : "kein Ist"}) – Befunde mit Vorsicht lesen, erst nach dem nächsten BQool-Ist (B31.2) sicher.</div>}
          </div>
        ) : (
          <div className="small muted">Noch kein Lauf – „Jetzt prüfen“ oder morgen nach 06:00.</div>
        )}
        {treffer && treffer.freigaben > 0 && <div className="small" data-testid="lc-treffer">Trefferquote: {treffer.mitVerkauf} von {treffer.freigaben} Freigaben (älter als 14 Tage) führten zu mehr Verkäufen ({treffer.quote} %).</div>}
        <div className="row small" style={{ gap: 6, flexWrap: "wrap" }}>
          <Link className={`chip${!filter ? " active" : ""}`} href="/repricer/listing-check">alle ({befunde.length})</Link>
          {[...jeNr.entries()].sort((a, b) => a[0] - b[0]).map(([nr, n]) => (
            <Link key={nr} className={`chip${filter === nr ? " active" : ""}`} href={`/repricer/listing-check?befund=${nr}`} data-testid={`lc-filter-${nr}`}>{nr} {BEFUND_TITEL[nr]} ({n})</Link>
          ))}
        </div>
      </section>
      <section className="card" style={{ overflow: "auto", marginTop: 12 }}>
        {liste.length ? (
          <table className="table small" data-testid="lc-befunde">
            <thead><tr><th>Land</th><th>SKU / ASIN</th><th>Befund</th><th>Zahlen</th><th>Vorschlag</th><th className="right" title="fehlende Verkäufe × Marge je Monat (Schätzung)">Potenzial</th><th /></tr></thead>
            <tbody>
              {liste.map((b) => {
                const d = b.daten as { nr?: number; befund?: string; titel?: string; asin?: string | null; zahlen?: Record<string, number | string | null>; stufe?: string };
                return (
                  <tr key={b.id} data-testid="lc-zeile" data-sku={b.sku} data-land={b.land} data-nr={d.nr}>
                    <td>{b.land}</td>
                    <td>{b.sku}{d.asin ? <div className="muted">{d.asin}</div> : null}<div className="muted">{String(d.titel ?? "").slice(0, 40)}</div></td>
                    <td>{d.nr} {d.befund}<div className="muted">Stufe {d.stufe}</div></td>
                    <td>{Object.entries(d.zahlen ?? {}).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k.replace(/_/g, " ")} ${typeof v === "number" ? String(v).replace(".", ",") : v}`).join(" · ")}</td>
                    <td>{(b.gruende ?? []).join(" ")}</td>
                    <td className="right num">{formatEuro(b.potenzial ?? 0)}</td>
                    <td>{inhaber && (
                      <span className="row" style={{ gap: 4 }}>
                        {(["freigeben", "ablehnen", "spaeter"] as const).map((e) => (
                          <form key={e} action={befundAction}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="entscheidung" value={e} /><button className={`btn btn-sm${e === "freigeben" ? " btn-primary" : ""}`} type="submit" data-testid={`lc-${e}`}>{e === "freigeben" ? "Freigeben" : e === "ablehnen" ? "Ablehnen" : "Später"}</button></form>
                        ))}
                      </span>
                    )}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="card-pad small muted" data-testid="lc-keine">Keine offenen Befunde.</div>
        )}
      </section>
    </>
  );
}
