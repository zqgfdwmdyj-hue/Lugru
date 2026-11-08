import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { leistungStand } from "@/lib/bqool/berichte";
import type { LeistungFall } from "@/lib/bqool/berichte-logic";
import { LEISTUNG_GRENZEN } from "@/lib/bqool/berichte-logic";
import { formatEuro } from "@/lib/numbers";
import { LandRueckfrage } from "../../uploads/land-rueckfrage";

// B31.5 Repricer → Reiter „Leistung“: BQool-Berichte „Listing Performance“ (je SKU) und „Daily Sales“ ausgewertet –
// drei Listen mit Vorschlag, Buy-Box-Anteil je Land und Woche.

type SP = { land?: string; tage?: string };
const LAENDER = ["DE", "FR", "IT", "ES"];
const MAX = 100;
const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.` : "–");
const zeit = (d: Date) => d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const pct = (n: number | null) => (n === null ? "–" : `${Math.round(n)} %`);
const link = (sp: SP, neu: Partial<SP>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...neu })) if (v) u.set(k, String(v));
  const q = u.toString();
  return `/repricer/leistung${q ? `?${q}` : ""}`;
};

function Liste({ id, titel, erklaerung, faelle, spalten, aktion }: { id: string; titel: string; erklaerung: string; faelle: LeistungFall[]; spalten: { kopf: string; wert: (f: LeistungFall) => React.ReactNode; rechts?: boolean }[]; aktion: (f: LeistungFall) => React.ReactNode }) {
  return (
    <section className="card card-pad stack" id={id} data-testid={`leistung-${id}`} style={{ scrollMarginTop: 70 }}>
      <div className="between" style={{ flexWrap: "wrap", gap: 6 }}>
        <h2 style={{ margin: 0 }}>{titel} <span className="muted small">({faelle.length})</span></h2>
      </div>
      <div className="small muted">{erklaerung}</div>
      {faelle.length === 0 ? (
        <div className="notice notice-ok small">Keine SKUs.</div>
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table small">
            <thead>
              <tr>
                <th>Land</th>
                <th>SKU</th>
                <th>Regel</th>
                {spalten.map((s) => <th key={s.kopf} className={s.rechts ? "right" : undefined}>{s.kopf}</th>)}
                <th>Vorschlag</th>
              </tr>
            </thead>
            <tbody>
              {faelle.slice(0, MAX).map((f) => (
                <tr key={`${f.land}|${f.sku}`} data-sku={f.sku}>
                  <td>{f.land}</td>
                  <td className="num" title={f.titel ?? undefined}>{f.sku}{f.titel && <div className="muted" style={{ fontFamily: "inherit", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.titel}</div>}</td>
                  <td>{f.regel ?? "–"}</td>
                  {spalten.map((s) => <td key={s.kopf} className={s.rechts ? "num right" : undefined}>{s.wert(f)}</td>)}
                  <td>{f.vorschlag} {aktion(f)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {faelle.length > MAX && <div className="small muted">… und {faelle.length - MAX} weitere</div>}
        </div>
      )}
    </section>
  );
}

export default async function LeistungPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const tage = sp.tage === "30" ? 30 : 7;
  const land = sp.land && LAENDER.includes(sp.land) ? sp.land : null;
  const st = await leistungStand(session.tenantId, { tage, land });
  const g = LEISTUNG_GRENZEN;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Amazon › Repricer</div>
          <h1>Leistung (BQool-Berichte)</h1>
          <div className="small muted">Aus „Listing Performance“ je Land und „Daily Sales“ – täglich mit dem BQool-Lauf oder per <Link href="/uploads">Upload</Link>.</div>
        </div>
      </div>

      <section className="card card-pad stack" data-testid="leistung-stand">
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <Link href={link(sp, { land: undefined })} className={`chip${!land ? " active" : ""}`} aria-current={!land ? "page" : undefined}>Alle Länder</Link>
          {LAENDER.map((l) => <Link key={l} href={link(sp, { land: l })} className={`chip${land === l ? " active" : ""}`} aria-current={land === l ? "page" : undefined}>{l}</Link>)}
          <span style={{ width: 12 }} />
          <Link href={link(sp, { tage: undefined })} className={`chip${tage === 7 ? " active" : ""}`} aria-current={tage === 7 ? "page" : undefined}>7 Tage</Link>
          <Link href={link(sp, { tage: "30" })} className={`chip${tage === 30 ? " active" : ""}`} aria-current={tage === 30 ? "page" : undefined}>30 Tage</Link>
        </div>
        {st.laender.length === 0 ? (
          <div className="notice notice-warn small" data-testid="leistung-leer">Noch kein Bericht „Listing Performance“. In BQool unter Reports je Marktplatz herunterladen und unter <Link href="/uploads">Uploads</Link> hochladen – oder der tägliche BQool-Lauf holt ihn.</div>
        ) : (
          <div style={{ overflow: "auto" }}>
            <table className="table small">
              <thead><tr><th>Land</th><th>Zeitraum</th><th className="right">SKUs</th><th className="right">Buy Box</th><th className="right">Umsatz</th><th className="right">Est. Profit</th><th className="right">unter Min</th><th className="right">Verlust</th><th>Eingelesen</th></tr></thead>
              <tbody>
                {st.laender.map((x) => (
                  <tr key={x.land} data-land={x.land}>
                    <td><strong>{x.land}</strong></td>
                    <td>{x.tage} Tage bis {dmy(x.stichtag)}</td>
                    <td className="num right">{x.skus}</td>
                    <td className="num right" data-testid={`leistung-bb-${x.land}`}>{pct(x.buyboxAnteil)}</td>
                    <td className="num right">{formatEuro(x.sales)}</td>
                    <td className="num right" style={{ color: (x.profit ?? 0) < 0 ? "var(--danger)" : undefined }}>{formatEuro(x.profit)}</td>
                    <td className="num right">{x.unterMin}</td>
                    <td className="num right">{x.verlust}</td>
                    <td className="muted" title={x.landQuelle ? `Land: ${x.landQuelle}` : undefined}>{zeit(x.eingelesenAm)} · {x.via === "automatik" ? "täglicher Lauf" : x.via === "claude" ? "Claude" : "Upload"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {st.offen.length > 0 && (
          <div className="notice notice-warn small stack" style={{ gap: 4 }} data-testid="leistung-offen">
            <strong>Land offen:</strong>
            {st.offen.map((o) => (
              <div key={o.id}>
                {o.datei} – {o.begruendung}
                <LandRueckfrage id={o.id} vorschlag={o.vorschlag} />
              </div>
            ))}
          </div>
        )}
      </section>

      {st.wochen.length > 0 && (
        <section className="card card-pad stack" data-testid="leistung-buybox">
          <h2 style={{ margin: 0 }}>Buy-Box-Anteil je Land und Woche</h2>
          <div style={{ overflow: "auto" }}>
            <table className="table small">
              <thead><tr><th>Woche</th>{LAENDER.map((l) => <th key={l} className="right">{l}</th>)}</tr></thead>
              <tbody>
                {st.wochen.map((w) => (
                  <tr key={w.woche}><td>{w.woche.replace("-W", " · KW ")}</td>{LAENDER.map((l) => <td key={l} className="num right">{pct(w.je[l] ?? null)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="small muted">Je Woche der letzte Bericht „Listing Performance ({tage} Tage)“; Anteil = Summenzeile der Datei, sonst Mittel der SKUs.</div>
        </section>
      )}

      <Liste
        id="unter-min"
        titel="Steht unter Min, keine Buy Box"
        erklaerung={`Below Min ≥ ${g.unterMinAb} % (Konkurrenz unter unserem Min) und Buy Box unter ${g.buyboxUnter} %. Vorschlag: Min auf den effektiven Min senken – im nächsten Soll-Export unter BQool-Dateien.`}
        faelle={st.unterMin}
        spalten={[
          { kopf: "Below Min", wert: (f) => pct(f.werte.belowMin), rechts: true },
          { kopf: "Buy Box", wert: (f) => pct(f.werte.bbWins), rechts: true },
          { kopf: "Stück", wert: (f) => f.werte.units ?? "–", rechts: true },
        ]}
        aktion={(f) => <Link href={`/repricer/bqool?land=${f.land}#vorschau-${f.land}`}>Soll ansehen →</Link>}
      />
      <Liste
        id="verlust"
        titel="Verkauft mit Verlust"
        erklaerung="Est. Profit laut BQool unter 0. Vorschlag: Min anheben (effektiver Min) oder – wenn gewollt – als Liquidation bestätigen (Verlust-Stopp → Ausnahme)."
        faelle={st.verlust}
        spalten={[
          { kopf: "Stück", wert: (f) => f.werte.units ?? "–", rechts: true },
          { kopf: "Umsatz", wert: (f) => formatEuro(f.werte.sales), rechts: true },
          { kopf: "Est. Profit", wert: (f) => <span style={{ color: "var(--danger)" }}>{formatEuro(f.werte.profit)}</span>, rechts: true },
        ]}
        aktion={(f) => (f.art === "liquidation" ? <Link href={`/verlust?q=${encodeURIComponent(f.sku)}`}>Als Ausnahme →</Link> : <Link href={`/repricer/bqool?land=${f.land}#vorschau-${f.land}`}>Soll ansehen →</Link>)}
      />
      <Liste
        id="preisbewegung"
        titel="Auffällige Preisbewegung"
        erklaerung={`Preisänderungen über ${g.preisAenderungEuro} € oder mehr als ${g.preisHochAb} Erhöhungen bei Below Min 100 % – BQool dreht im Kreis. Dafür gibt es je Land die Aufgabe „BQool-Regel prüfen“.`}
        faelle={st.preisbewegung}
        spalten={[
          { kopf: "Price Changes", wert: (f) => formatEuro(f.werte.priceChanges), rechts: true },
          { kopf: "hoch", wert: (f) => f.werte.priceUp ?? "–", rechts: true },
          { kopf: "runter", wert: (f) => f.werte.priceDown ?? "–", rechts: true },
          { kopf: "Below Min", wert: (f) => pct(f.werte.belowMin), rechts: true },
        ]}
        aktion={() => null}
      />

      <section className="card card-pad stack" data-testid="leistung-daily">
        <h2 style={{ margin: 0 }}>Daily Sales</h2>
        {st.tagesBerichte.length === 0 ? (
          <div className="small muted">Noch kein Bericht „Daily Sales“.</div>
        ) : (
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {st.tagesBerichte.map((b) => (
              <li key={`${b.land}-${b.bis}`}>{b.land}: {b.tage} Tage ({dmy(b.von)} – {dmy(b.bis)}) · Umsatz {formatEuro(b.sales)} · Est. Profit {formatEuro(b.profit)} · Buy Box Ø {pct(b.buyboxAnteil)}</li>
            ))}
          </ul>
        )}
        <div className="small"><Link href="/gewinn#bqool-vergleich">Je Tag auf der Gewinn-Seite (Spalte „BQool“) →</Link></div>
      </section>
    </>
  );
}
