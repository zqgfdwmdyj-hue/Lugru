import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { addDaysIso, todayIso } from "@/lib/dates";
import { formatDate, formatEuro, parseAmount, parseDate } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { Kpi, KpiMeta } from "@/components/kpi";
import { SubmitButton } from "@/components/submit-button";
import { letzterImport, wiederkehrend } from "@/lib/bank/service";
import { ersteRoteWoche, POSTEN_TEXT, type Ampel } from "@/lib/money/liquiditaet";
import { liquiditaet } from "@/lib/money/liquiditaet-service";
import { addCashItem, deleteCashItem, ignorierenAction, kontoauszugAction, liquiEinstellungenAction, saveStartBalance } from "./actions";

const IN = "#0f8a79";
const OUT = "#d9480f";
const AMPEL: Record<Ampel, [string, string]> = { gruen: ["tag-ok", "ok"], gelb: ["tag-warn", "knapp"], rot: ["tag-danger", "unter Reserve"] };
const monateText = (m: number[]) => (m.length === 12 ? "alle" : m.join(","));

type Sp = { meldung?: string; was?: string; betrag?: string; datum?: string };

export default async function LiquiditaetPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const session = await requireArea("geld");
  const sp = await searchParams;
  const t = session.tenantId;
  const today = todayIso();
  const s = await getSettings(t);
  const sBetrag = parseAmount(sp.betrag ?? "");
  const sDatum = parseDate(sp.datum ?? "");
  const szenario = sBetrag && sDatum ? { betrag: sBetrag, datum: sDatum, label: (sp.was ?? "").slice(0, 80) } : null;
  const l = await liquiditaet(t, { heute: today, szenario });
  const items = await db.select().from(schema.cashItems).where(eq(schema.cashItems.tenantId, t)).orderBy(asc(schema.cashItems.date));
  const imp = await letzterImport(t, "geschaeft", null);
  const wk = imp.n ? await wiederkehrend(t, "geschaeft", null, today) : [];
  const ignoriert = new Set(s.liquiditaet.ignoriert);
  const rot = ersteRoteWoche(l.wochen);
  const rotOhne = l.ohneSzenario ? ersteRoteWoche(l.ohneSzenario) : null;
  const letzte = l.wochen.at(-1)!;
  const fehlend = l.quellen.filter((q) => q.status === "keine_daten").map((q) => q.name);
  const max = Math.max(1, ...l.wochen.map((w) => Math.max(w.zu, w.ab)));
  const W = 760, H = 220, pad = 36, bw = (W - pad * 2) / l.wochen.length;
  const y = (v: number) => H - 28 - (v / max) * (H - 50);
  const steuerZeilen = [...s.liquiditaet.steuern, ...Array.from({ length: Math.max(0, 4 - s.liquiditaet.steuern.length) }, () => null)];

  return (
    <>
      <div className="page-head"><div><div className="crumb">Geld</div><h1>Liquidität (8 Wochen)</h1></div></div>
      {sp.meldung && <div className="notice notice-info" data-testid="liqui-meldung">{sp.meldung}</div>}
      <div className="stack" style={{ gap: 6 }} data-kpi-group>
        <div className="grid-kpi">
          <div className="card card-pad">
            <div className="kpi-label">Kontostand (Start)</div>
            <div className="kpi-value" data-testid="liqui-start">{l.start === null ? <span className="muted" style={{ fontSize: 16 }}>keine Daten</span> : formatEuro(l.start)}</div>
            <div className="small muted" data-testid="cash-start-state">{l.startQuelle === "bank" ? `aus Kontoauszug, Stand ${formatDate(l.startStand)}` : l.startQuelle === "hand" ? `von Hand, Stand ${formatDate(l.startStand)}` : "Kontoauszug hochladen oder unten eintragen"}</div>
          </div>
          <Kpi
            testid="kpi-forecast"
            label="Kontostand in 8 Wochen (Prognose)"
            value={letzte.endeSaldo === null ? "–" : formatEuro(letzte.endeSaldo)}
            danger={letzte.endeSaldo !== null && letzte.endeSaldo < l.reserve}
            state={l.start === null ? "fehlt" : fehlend.length ? "unvollstaendig" : "ok"}
            note={`Mindestreserve ${formatEuro(l.reserve)}`}
            missing={fehlend}
            fixHref="#quellen"
            fixLabel="Quellen"
          />
          <div className="card card-pad">
            <div className="kpi-label">Erste Woche unter Reserve</div>
            <div className="kpi-value" style={{ color: rot ? "var(--danger)" : undefined }} data-testid="liqui-rot">{rot ? `ab ${formatDate(rot.start)}` : l.start === null ? <span className="muted" style={{ fontSize: 16 }}>keine Daten</span> : "keine"}</div>
            <div className="small muted">{rot ? `tiefster Stand ${formatEuro(rot.tiefster)}` : "in den nächsten 8 Wochen"}</div>
          </div>
        </div>
        <KpiMeta period="laufende + 7 Wochen" source="Kontoauszug, Amazon-Abrechnungen, sellerboard (eBay/Temu), B2B-Deals, Rechnungen, Bestellvorschläge, Plan-Posten, Steuertermine" stand={`Kontostand ${l.startStand ? formatDate(l.startStand) : "fehlt"} · berechnet ${formatDate(today)}`} />
      </div>

      <section className="card card-pad stack" style={{ gap: 8 }} data-testid="was-waere-wenn">
        <h2>Was wäre wenn?</h2>
        <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <div className="field" style={{ flexGrow: 1, minWidth: 160 }}><label className="label" htmlFor="ww-was">Geplanter Einkauf</label><input className="input" id="ww-was" name="was" defaultValue={sp.was ?? ""} placeholder="z. B. Großeinkauf Q4" /></div>
          <div className="field"><label className="label" htmlFor="ww-betrag">Betrag €</label><input className="input num" id="ww-betrag" name="betrag" inputMode="decimal" defaultValue={sp.betrag ?? ""} style={{ width: 110 }} required /></div>
          <div className="field"><label className="label" htmlFor="ww-datum">Datum</label><input className="input" id="ww-datum" name="datum" type="date" defaultValue={sp.datum ?? addDaysIso(today, 7)} required /></div>
          <button className="btn btn-primary" type="submit" data-testid="ww-rechnen">Wirkung zeigen</button>
          {szenario && <Link className="btn" href="/cashflow">Zurücksetzen</Link>}
        </form>
        {l.szenario && (
          <div className={`notice ${rot ? "notice-warn" : "notice-ok"}`} data-testid="ww-ergebnis">
            Mit „{l.szenario.label}“ ({formatEuro(-l.szenario.betrag)} am {formatDate(l.szenario.datum)}): {rot ? <>Reserve wird ab der Woche {formatDate(rot.start)} unterschritten (tiefster Stand {formatEuro(rot.tiefster)}).</> : <>Reserve bleibt gewahrt – Ende in 8 Wochen {formatEuro(letzte.endeSaldo)}.</>}
            {rotOhne ? " (Auch ohne den Einkauf schon knapp.)" : ""}
          </div>
        )}
      </section>

      <section className="card card-pad">
        <div className="between" style={{ marginBottom: 8 }}>
          <h2>Nächste 8 Wochen</h2>
          <div style={{ display: "flex", gap: 14, fontSize: 12 }} className="muted">
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={{ width: 10, height: 10, borderRadius: 2, background: IN }} />Zuflüsse</span>
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={{ width: 10, height: 10, borderRadius: 2, background: OUT }} />Abflüsse</span>
          </div>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, height: "auto" }} role="img" aria-label="Zu- und Abflüsse je Woche">
          <line x1={pad} x2={W - pad} y1={H - 28} y2={H - 28} stroke="#d5d2ca" />
          {l.wochen.map((w, i) => {
            const x = pad + i * bw + bw * 0.18;
            const bar = (bw * 0.64 - 2) / 2;
            return (
              <g key={w.start}>
                <rect x={x} y={y(w.zu)} width={bar} height={H - 28 - y(w.zu)} rx={4} fill={IN}><title>{`Woche ab ${formatDate(w.start)}: Zuflüsse ${formatEuro(w.zu)}`}</title></rect>
                <rect x={x + bar + 2} y={y(w.ab)} width={bar} height={H - 28 - y(w.ab)} rx={4} fill={OUT}><title>{`Woche ab ${formatDate(w.start)}: Abflüsse ${formatEuro(w.ab)}`}</title></rect>
                <text x={x + bar} y={H - 10} textAnchor="middle" fontSize="11" fill="#5b6168">{formatDate(w.start).slice(0, 6)}</text>
              </g>
            );
          })}
        </svg>
        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ marginTop: 8 }} data-testid="liqui-wochen">
            <thead><tr><th>Woche ab</th><th className="right">Anfang</th><th className="right">Zuflüsse</th><th className="right">Abflüsse</th><th className="right">Ende</th><th>Ampel</th><th className="right" title="Bestellvorschläge, noch nicht im Einkauf angelegt – nicht im Kontostand">mögliche Einkäufe<br /><span className="small muted">nicht freigegeben</span></th><th>Posten</th></tr></thead>
            <tbody>
              {l.wochen.map((w) => (
                <tr key={w.start} data-woche={w.start}>
                  <td className="num">{formatDate(w.start)}</td>
                  <td className="num right">{w.anfang === null ? <span className="muted">unbekannt</span> : formatEuro(w.anfang)}</td>
                  <td className="num right" style={{ color: "var(--ok)" }}>{formatEuro(w.zu)}</td>
                  <td className="num right" style={{ color: "var(--danger)" }}>{formatEuro(-w.ab)}</td>
                  <td className="num right" style={{ fontWeight: 600 }} data-testid="cash-balance">{w.endeSaldo === null ? <span className="muted" style={{ fontWeight: 400 }}>unbekannt</span> : formatEuro(w.endeSaldo)}</td>
                  <td>{w.ampel ? <span className={`tag ${AMPEL[w.ampel][0]}`} data-testid="woche-ampel">{AMPEL[w.ampel][1]}</span> : "–"}{w.ampel && w.ampel !== "gruen" && w.tiefster !== null ? <div className="small muted">tiefster {formatEuro(w.tiefster)}</div> : null}</td>
                  <td className="num right muted" data-testid="woche-moeglich">{w.moeglich ? formatEuro(-w.moeglich) : "–"}</td>
                  <td className="small">{w.posten.filter((p) => !p.nichtEingerechnet).map((p, i) => <div key={i} style={{ color: p.art === "szenario" ? "var(--warn)" : undefined }}>{formatDate(p.datum).slice(0, 6)} {p.label} <span className="num">{p.geschaetzt ? "≈ " : ""}{formatEuro(p.betrag)}</span> <span className="muted">· {POSTEN_TEXT[p.art]}</span></div>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card card-pad stack" style={{ gap: 8, scrollMarginTop: 70 }} id="quellen" data-testid="liqui-quellen">
        <h2>Quellen</h2>
        {l.quellen.map((q) => (
          <div key={q.name} className="between small">
            <span>{q.name}</span>
            <span><span className={`tag ${q.status === "ok" ? "tag-ok" : q.status === "aus" ? "tag-neutral" : "tag-warn"}`}>{q.status === "ok" ? "da" : q.status === "aus" ? "aus" : "fehlt"}</span> <span className="muted">{q.hinweis}</span></span>
          </div>
        ))}
      </section>

      <div className="row">
        <section className="card card-pad stack" style={{ flexGrow: 1, minWidth: 0, gap: 10 }} id="kontoauszug">
          <h2>Kontoauszug (Sparkasse)</h2>
          <div className="small muted">Online-Banking → Umsätze → Export „CSV-CAMT“ oder „CAMT“ (XML, enthält den Kontostand). Bei CSV den Kontostand laut Bank zum letzten Buchungstag mit angeben. Doppelt hochgeladene Buchungen werden erkannt.</div>
          <form action={kontoauszugAction} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
            <div className="field"><label className="label" htmlFor="ka-datei">Datei</label><input className="input" id="ka-datei" name="datei" type="file" accept=".csv,.xml,.txt" required data-testid="ka-datei" /></div>
            <div className="field"><label className="label" htmlFor="ka-saldo">Kontostand laut Bank (bei CSV)</label><input className="input num" id="ka-saldo" name="saldo" inputMode="decimal" style={{ width: 140 }} data-testid="ka-saldo" /></div>
            <SubmitButton label="Einlesen" pendingLabel="Lese ein …" testId="ka-einlesen" />
          </form>
          <div className="small muted">{imp.n ? `${imp.n} Buchungen gespeichert, bis ${formatDate(imp.bis)}.` : "Noch kein Kontoauszug."} Ohne Kontoauszug: <form action={saveStartBalance} style={{ display: "inline-flex", gap: 6 }} id="kontostand"><label htmlFor="bal" className="sr-only">Kontostand</label><input className="input num" id="bal" name="balance" placeholder="Kontostand" style={{ width: 120 }} /><button className="btn btn-small" type="submit">von Hand speichern</button></form></div>
          {wk.length > 0 && (
            <>
              <h3 style={{ margin: "6px 0 0" }}>Erkannte wiederkehrende Abbuchungen</h3>
              <table className="table" data-testid="wiederkehrend">
                <tbody>
                  {wk.map((w) => (
                    <tr key={w.gruppeHash} style={{ opacity: ignoriert.has(w.gruppeHash) ? 0.5 : 1 }}>
                      <td>{w.name}<div className="small muted">{w.art === "kreditkarte" ? "Kreditkarte" : w.art === "steuer" ? "Steuer" : "Fixkosten"} · {w.rhythmus} · {w.anzahl}× · nächste {formatDate(w.naechste)}</div></td>
                      <td className="num right">{formatEuro(-w.betrag)}</td>
                      <td className="right"><form action={ignorierenAction}><input type="hidden" name="gruppe" value={w.gruppeHash} /><button className="btn-link small" type="submit">{ignoriert.has(w.gruppeHash) ? "wieder einrechnen" : "nicht einrechnen"}</button></form></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
        <aside className="col-side">
          <section className="card card-pad stack" style={{ gap: 10 }} id="einstellungen-liqui">
            <h2>Einstellungen</h2>
            <form action={liquiEinstellungenAction} className="stack" style={{ gap: 8 }}>
              <div className="field"><label className="label" htmlFor="li-reserve">Mindestreserve €</label><input className="input num" id="li-reserve" name="reserve" defaultValue={String(s.liquiditaet.reserve).replace(".", ",")} style={{ width: 120 }} data-testid="li-reserve" /></div>
              <div className="field"><span className="label">Kreditkarte (falls nicht im Kontoauszug erkannt)</span><div style={{ display: "flex", gap: 6 }}><input className="input num" name="kk_tag" placeholder="Tag" aria-label="Abbuchungstag" defaultValue={s.liquiditaet.kreditkarte.tag ?? ""} style={{ width: 60 }} /><input className="input num" name="kk_betrag" placeholder="Betrag" aria-label="Betrag" defaultValue={s.liquiditaet.kreditkarte.betrag ?? ""} style={{ width: 110 }} /></div></div>
              <div className="field"><label className="label" htmlFor="li-ziel">Zahlungsziel Lieferanten ohne Profil (Tage, 0 = sofort/Karte)</label><input className="input num" id="li-ziel" name="zahlungsziel" defaultValue={s.liquiditaet.zahlungszielStandard} style={{ width: 70 }} /></div>
              <label className="check small"><input type="checkbox" name="bestellvorschlaege" defaultChecked={s.liquiditaet.bestellvorschlaege} /> Bestellvorschläge als eigene Zeile „mögliche Einkäufe“ zeigen</label>
              <label className="check small"><input type="checkbox" name="vorschlaege_einrechnen" defaultChecked={s.liquiditaet.vorschlaegeEinrechnen} data-testid="li-vorschlaege-einrechnen" /> … und schon vor der Freigabe in den Kontostand einrechnen (auf „bestellen bis“)</label>
              <div className="small muted">Freigegeben = im Einkauf angelegt oder bestellt; das zählt immer.</div>
              <div className="field">
                <span className="label">Steuertermine (Schätzung)</span>
                {steuerZeilen.map((z, i) => (
                  <div key={i} style={{ display: "flex", gap: 4, marginBottom: 4, flexWrap: "wrap" }}>
                    <input className="input" name={`st_name_${i}`} defaultValue={z?.name ?? ""} placeholder={["USt-Voranmeldung", "USt Ausland (OSS)", "KSt-Vorauszahlung", "GewSt-Vorauszahlung"][i] ?? "Name"} aria-label="Name" style={{ width: 150 }} />
                    <input className="input num" name={`st_betrag_${i}`} defaultValue={z?.betrag ?? ""} placeholder="€" aria-label="Betrag" style={{ width: 80 }} />
                    <input className="input" name={`st_monate_${i}`} defaultValue={z ? monateText(z.monate) : ""} placeholder={["alle", "1,4,7,10", "3,6,9,12", "2,5,8,11"][i] ?? "Monate"} aria-label="Monate" style={{ width: 80 }} />
                    <input className="input num" name={`st_tag_${i}`} defaultValue={z?.tag ?? ""} placeholder="Tag" aria-label="Tag" style={{ width: 50 }} />
                  </div>
                ))}
                <span className="small muted">Monate: „alle“, „quartal“ oder Liste „3,6,9,12“. Beträge mit dem Steuerberater abstimmen.</span>
              </div>
              <div><SubmitButton className="btn" label="Speichern" pendingLabel="Speichere …" testId="li-speichern" /></div>
            </form>
          </section>
        </aside>
      </div>

      <section className="card" style={{ overflow: "auto" }}>
        <div className="card-head"><h2>Geplante Posten (von Hand)</h2></div>
        <form action={addCashItem} style={{ display: "flex", gap: 8, padding: 14, flexWrap: "wrap", alignItems: "end", borderBottom: "1px solid var(--border)" }}>
          <div className="field"><label className="label" htmlFor="c-dir">Art</label><select className="select" id="c-dir" name="direction"><option value="out">Ausgabe</option><option value="in">Einnahme</option></select></div>
          <div className="field"><label className="label" htmlFor="c-date">Datum</label><input className="input" id="c-date" name="date" type="date" required /></div>
          <div className="field"><label className="label" htmlFor="c-amount">Betrag €</label><input className="input num" id="c-amount" name="amount" required style={{ width: 110 }} /></div>
          <div className="field" style={{ flexGrow: 1 }}><label className="label" htmlFor="c-desc">Beschreibung</label><input className="input" id="c-desc" name="description" required placeholder="z. B. Großeinkauf Q4" /></div>
          <div className="field"><label className="label" htmlFor="c-cat">Kategorie</label><select className="select" id="c-cat" name="category"><option value="einkauf">Einkauf</option><option value="fixkosten">Fixkosten</option><option value="steuern">Steuern</option><option value="sonstiges">Sonstiges</option></select></div>
          <div className="field"><label className="label" htmlFor="c-rec">Wiederholung</label><select className="select" id="c-rec" name="recurrence"><option value="none">einmalig</option><option value="monthly">monatlich</option><option value="weekly">wöchentlich</option></select></div>
          <button className="btn btn-primary" type="submit">Hinzufügen</button>
        </form>
        <table className="table">
          <tbody>
            {items.length === 0 && <tr><td className="muted">Noch keine Posten.</td></tr>}
            {items.map((i) => (
              <tr key={i.id}>
                <td className="num">{formatDate(i.date)}</td>
                <td>{i.description}<div className="small muted">{i.category}{i.recurrence !== "none" ? ` · ${i.recurrence === "monthly" ? "monatlich" : "wöchentlich"}` : ""}</div></td>
                <td className="num right" style={{ color: i.amount < 0 ? "var(--danger)" : "var(--ok)" }}>{formatEuro(i.amount)}</td>
                <td className="right"><form action={deleteCashItem}><input type="hidden" name="id" value={i.id} /><button className="btn-link small danger" type="submit">löschen</button></form></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="small muted" data-testid="cash-scope">≈ = geschätzt. Amazon aus Rhythmus und Ø der letzten Abrechnungen; eBay/Temu aus dem Ø der letzten 28 Tage (sellerboard); Lieferantenrechnungen nur mit Zahlungsziel und solange keine passende Abbuchung im Kontoauszug steht; Einkäufe laut Bestellvorschlag zum „bestellen bis“. Offene Erstattungsansprüche sind nicht enthalten.</div>
    </>
  );
}
