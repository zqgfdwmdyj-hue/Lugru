import Link from "next/link";
import { kontoBerichte } from "@/lib/amazon-berichte/service";

// Amazon-Berichte 1, 2 und 4 in der Fall-Zentrale: Kontozustand je Marktplatz (Frühwarnung), gestrandeter Bestand
// und gesperrte Angebote mit gebundenem Kapital, weitere Gebühren der letzten 3 Monate. Nur lesen.

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "–");
const zeit = (iso: string | Date | null) => (iso ? new Date(iso).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–");
const STUFE = { gut: ["gut", "tag-ok"], warnung: ["prüfen", "tag-warn"], kritisch: ["gefährdet", "tag-danger"] } as const;

export async function KontoBerichte({ tenantId }: { tenantId: string }) {
  const b = await kontoBerichte(tenantId);
  const k = b.kontozustand;
  const g = b.gestrandet;
  const s = b.gesperrt;
  const w = b.weitere_gebuehren;
  return (
    <div className="stack" style={{ gap: 12, margin: "14px 0" }}>
      <section className="card card-pad" id="kontozustand" data-testid="kontozustand">
        <div className="between" style={{ gap: 8, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Kontozustand</h2>
          {k.stufe ? <span className={`tag ${STUFE[k.stufe][1]}`} data-testid="kontozustand-stufe">{STUFE[k.stufe][0]}</span> : <span className="tag tag-neutral">noch kein Bericht</span>}
        </div>
        {!k.maerkte.length ? (
          <p className="small muted" style={{ marginBottom: 0 }}>Kommt täglich per Amazon-Schnittstelle (Bericht „Leistung des Verkäufers“). Ohne Berechtigung in der App steht der Grund unter Anbindungen → Amazon-Berichte.</p>
        ) : (
          <>
            <div className="small muted">Stand {zeit(k.abgerufen)} · Quelle: Amazon-Leistungsbericht</div>
            <div className="stack" style={{ gap: 6, marginTop: 8 }}>
              {k.maerkte.map((m) => (
                <div key={m.land} className="small" data-testid="kontozustand-markt">
                  <strong>{m.land}</strong>: <span className={`tag ${STUFE[m.stufe][1]}`}>{STUFE[m.stufe][0]}</span>
                  {m.wert !== null && <> Kontozustand {m.wert}</>}
                  {m.status && <span className="muted"> ({m.status})</span>}
                  {m.gruende.length > 0 && <div className="muted">{m.gruende.join(" · ")}</div>}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card card-pad" id="gestrandet" data-testid="gestrandet">
        <h2 style={{ marginTop: 0 }}>Gestrandeter Bestand und gesperrte Angebote</h2>
        <div className="small" data-testid="gestrandet-summe">
          {g.anzahl ? (
            <>
              <strong>{g.anzahl}</strong> SKU{g.anzahl === 1 ? "" : "s"} gestrandet, {g.stueck} Stück, <strong>{eur(g.gebunden)}</strong> gebunden
              {g.ohne_ek ? <span className="muted"> ({g.ohne_ek} ohne EK nicht gerechnet)</span> : null}
              {g.entfernung_bald ? <span className="tag tag-danger" style={{ marginLeft: 6 }}>{g.entfernung_bald} bald automatisch entfernt</span> : null}
            </>
          ) : (
            <span className="muted">Kein gestrandeter Bestand{g.abgerufen ? ` (Stand ${zeit(g.abgerufen)})` : " – noch kein Bericht"}.</span>
          )}
          {" · "}
          {s.anzahl ? <><strong>{s.anzahl}</strong> gesperrte Angebote</> : <span className="muted">keine gesperrten Angebote</span>}
        </div>
        {(g.zeilen.length > 0 || s.zeilen.length > 0) && (
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="table small">
              <thead>
                <tr><th>Art</th><th>SKU</th><th>Grund</th><th className="num">Stück</th><th className="num">gebunden</th><th>seit / Entfernung</th></tr>
              </thead>
              <tbody>
                {g.zeilen.slice(0, 20).map((z) => (
                  <tr key={`g-${z.sku}`} data-testid="gestrandet-zeile">
                    <td>gestrandet</td><td>{z.sku}{z.titel ? <div className="muted">{z.titel.slice(0, 50)}</div> : null}</td><td>{z.grund ?? "–"}{z.aktion ? <div className="muted">{z.aktion}</div> : null}</td>
                    <td className="num">{z.menge}</td><td className="num">{z.gebunden !== null ? eur(z.gebunden) : "–"}</td><td>{dmy(z.seit)}{z.auto_entfernung ? ` / ${dmy(z.auto_entfernung)}` : ""}</td>
                  </tr>
                ))}
                {s.zeilen.slice(0, 20).map((z) => (
                  <tr key={`s-${z.sku}`} data-testid="gesperrt-zeile">
                    <td>gesperrt</td><td>{z.sku}{z.titel ? <div className="muted">{z.titel.slice(0, 50)}</div> : null}</td><td>{z.grund ?? z.status ?? "–"}</td><td className="num">–</td><td className="num">–</td><td>{dmy(z.seit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card card-pad" id="weitere-gebuehren" data-testid="weitere-gebuehren">
        <h2 style={{ marginTop: 0 }}>Weitere Amazon-Gebühren (seit {w.ab})</h2>
        <div className="small">
          {w.je_art.map((x) => (
            <div key={x.art} data-testid={`gebuehr-${x.art}`}>{x.text}: <strong>{eur(x.summe)}</strong></div>
          ))}
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>Langzeitlager und Inbound-Mängel aus den Amazon-Berichten (sonst aus dem Transaktionsbericht), Lagerlimit und Platzierung aus dem Transaktionsbericht. Fließen in die Lagerkosten der <Link href="/kapital">Kapital-Ampel</Link> und in „Lager & Sonstiges“ beim <Link href="/verlust">Verlust-Stopp</Link>.</div>
      </section>
    </div>
  );
}
