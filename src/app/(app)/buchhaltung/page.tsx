import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { SKR04 } from "@/lib/buchhaltung/kontierung";
import { buchhaltungStatus, buchungenListe, kandidaten, monatOk, ustAuswertung } from "@/lib/buchhaltung/service";
import { landName } from "@/lib/buchhaltung/ust-bericht";
import { todayIso } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { abgleichAction, alleBestaetigenAction, amexAction, belegeAnfordernAction, buchungAction, einstellungenAction, festschreibenAction, manuellAction, sparkasseAction, ustAction, zuordnungAction } from "./actions";

// Buchhaltung je Firma und Monat: Kontoauszug + Amex hochladen → Abgleich → Vorkontierung (SKR04) bestätigen →
// festschreiben → DATEV-Export bzw. CSV + Belege als ZIP. Nur LuGru/WiGru (AdelPrep läuft über Lexoffice).

const eur = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
const dmy = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "–");
const SICHER = { hoch: "tag-ok", mittel: "tag-warn", niedrig: "tag-danger" } as const;
const ART = { beleg: "Beleg", amex_sammel: "Amex-Sammelabbuchung", marktplatz: "Marktplatz-Auszahlung", ohne_beleg: "ohne Einzelbeleg" } as const;
const vormonat = (heute: string) => {
  const [j, m] = heute.split("-").map(Number);
  return m === 1 ? `${j - 1}-12` : `${j}-${String(m - 1).padStart(2, "0")}`;
};

export default async function BuchhaltungPage({ searchParams }: { searchParams: Promise<{ firma?: string; monat?: string; meldung?: string; fehler?: string }> }) {
  const session = await requireArea("geld");
  const sp = await searchParams;
  const monat = monatOk(sp.monat) ? sp.monat : vormonat(todayIso());
  const s = await buchhaltungStatus(session.tenantId, monat, sp.firma);
  const [buchungen, ust, settings] = await Promise.all([buchungenListe(session.tenantId, s.firma, monat), ustAuswertung(session.tenantId, s.firma, monat), getSettings(session.tenantId)]);
  const kand = new Map(await Promise.all(s.listen.ohneBeleg.filter((z) => z.betrag < 0).slice(0, 25).map(async (z) => [z.id, await kandidaten(session.tenantId, s.firma, z)] as const)));
  const hidden = (
    <>
      <input type="hidden" name="firma" value={s.firma} />
      <input type="hidden" name="monat" value={monat} />
    </>
  );
  const q = `firma=${encodeURIComponent(s.firma)}&monat=${monat}`;
  const datev = settings.buchhaltung.datev[s.firma] ?? {};

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Geld</div>
          <h1>Buchhaltung</h1>
          <div className="small muted">Belege ↔ Zahlungen abgleichen, vorkontieren ({settings.buchhaltung.kontenrahmen}), festschreiben, an den Steuerberater exportieren. Nur Vorschläge – keine Steuerberatung.</div>
        </div>
        <form style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          <label className="small">
            Firma
            <select name="firma" defaultValue={s.firma}>
              {s.firmen.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="small">Monat<input type="month" name="monat" defaultValue={monat} /></label>
          <button className="btn" type="submit">Zeigen</button>
        </form>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }} data-testid="bh-meldung">{sp.meldung}</div>}
      {sp.fehler && <div className="notice notice-warn small" role="alert" style={{ marginBottom: 12 }} data-testid="bh-fehler">{sp.fehler}</div>}

      <div className="grid-kpi" style={{ marginBottom: 14 }} data-testid="bh-kpi">
        <div className="card card-pad">
          <div className="kpi-label">Abstimmungsgrad</div>
          <div className="kpi-value" data-testid="bh-grad">{s.abstimmungsgrad === null ? "–" : `${s.abstimmungsgrad} %`}</div>
          <div className="small muted">{s.zahlungen.zugeordnet} von {s.zahlungen.gesamt} Zahlungen zugeordnet</div>
        </div>
        <div className="card card-pad">
          <div className="kpi-label">Zahlungen ohne Beleg</div>
          <div className="kpi-value">{s.zahlungen.ohneBeleg}</div>
          <div className="small muted">{s.zahlungen.vorschlaege} Vorschläge offen</div>
        </div>
        <div className="card card-pad">
          <div className="kpi-label">Belege ohne Zahlung</div>
          <div className="kpi-value">{s.belege.ohneZahlung}</div>
          <div className="small muted">{s.belege.neu} neu · {s.belege.unsicher} unsicher</div>
        </div>
        <div className="card card-pad">
          <div className="kpi-label">Buchungen</div>
          <div className="kpi-value">{s.buchungen.bestaetigt + s.buchungen.festgeschrieben}</div>
          <div className="small muted">{s.buchungen.vorschlag} offen · {s.buchungen.festgeschrieben} festgeschrieben · Export {s.export ? `am ${s.export.am.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}` : "noch nicht"}</div>
        </div>
      </div>

      {/* 1. Hochladen */}
      <section className="card card-pad" style={{ marginBottom: 14 }}>
        <h2 style={{ marginTop: 0 }}>1. Kontoauszüge hochladen</h2>
        <p className="small muted" style={{ marginTop: -6 }}>Geht auch zentral für alles: <Link href="/uploads">Uploads</Link> erkennt die Datei selbst.</p>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <form action={sparkasseAction} className="small" style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
            {hidden}
            <label>Sparkasse (CSV, CAMT oder PDF)<input type="file" name="datei" accept=".csv,.txt,.xml,.pdf" data-testid="bh-sparkasse" /></label>
            <label>Saldo laut Bank (optional)<input name="saldo" inputMode="decimal" style={{ width: 110 }} /></label>
            <button className="btn" type="submit" data-testid="bh-sparkasse-hochladen">Einlesen</button>
          </form>
          <form action={amexAction} className="small" style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
            {hidden}
            <label>American Express (CSV)<input type="file" name="datei" accept=".csv,.xlsx" data-testid="bh-amex" /></label>
            <button className="btn" type="submit" data-testid="bh-amex-hochladen">Einlesen</button>
          </form>
          <form action={ustAction} className="small" style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
            {hidden}
            <label>Amazon-Umsatzsteuerbericht<input type="file" name="datei" accept=".csv,.txt" /></label>
            <button className="btn" type="submit">Auswerten</button>
          </form>
        </div>
        {s.importe.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary className="small">Letzte Uploads mit Saldo-Kontrolle</summary>
            <table className="table small" data-testid="bh-importe">
              <thead>
                <tr><th>Datei</th><th>Zeitraum</th><th className="right">neu/doppelt</th><th className="right">Summe</th><th className="right">Anfangssaldo</th><th className="right">Endsaldo</th></tr>
              </thead>
              <tbody>
                {s.importe.map((i) => (
                  <tr key={i.id}>
                    <td>{i.art === "amex" ? "Amex" : "Sparkasse"} · {i.dateiname}</td>
                    <td>{dmy(i.von)} – {dmy(i.bis)}</td>
                    <td className="num right">{i.neu}/{i.doppelt}</td>
                    <td className="num right">{eur(i.summe)}</td>
                    <td className="num right">{eur(i.anfangssaldo)}</td>
                    <td className="num right">{eur(i.endsaldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </section>

      {/* 2. Abgleich */}
      <section className="card card-pad" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>2. Abgleich Zahlung ↔ Beleg</h2>
          <form action={abgleichAction}>
            {hidden}
            <button className="btn btn-primary" type="submit" data-testid="bh-abgleich">Abgleich starten</button>
          </form>
        </div>
        <p className="small muted">Reihenfolge: Rechnungsnummer im Verwendungszweck → Betrag + Lieferant/IBAN (±3 Tage, Teilzahlungen) → Betrag + Datum ±5 Tage. Sicher = automatisch; sonst hier bestätigen. Amex-Lastschrift = Summe der Kartenumsätze; Amazon-Auszahlung = Abrechnung.</p>
        {s.listen.vorschlaege.length > 0 && (
          <table className="table small" data-testid="bh-vorschlaege">
            <thead>
              <tr><th>Zahlung</th><th>Vorschlag</th><th>Sicherheit</th><th /></tr>
            </thead>
            <tbody>
              {s.listen.vorschlaege.map((v) => (
                <tr key={v.id}>
                  <td>{v.zahlung ? <>{dmy(v.zahlung.buchungstag)} · <strong>{eur(v.zahlung.betrag)}</strong> · {(v.zahlung.gegenpartei || v.zahlung.zweck || "").slice(0, 50)}</> : "–"}</td>
                  <td>{ART[v.art]} – {v.regel}</td>
                  <td><span className={`tag ${SICHER[v.sicherheit]}`}>{v.sicherheit}</span></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <form action={zuordnungAction} style={{ display: "inline-flex", gap: 4 }}>
                      {hidden}
                      <input type="hidden" name="id" value={v.id} />
                      <button className="btn btn-small" name="aktion" value="ok" type="submit" data-testid="bh-bestaetigen">bestätigen</button>
                      <button className="btn btn-small" name="aktion" value="ablehnen" type="submit">ablehnen</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3 id="ohne-beleg">Zahlungen ohne Beleg ({s.listen.ohneBeleg.length})</h3>
        {s.listen.ohneBeleg.length === 0 ? (
          <p className="small muted">Keine – alles zugeordnet.</p>
        ) : (
          <>
            <form action={belegeAnfordernAction} style={{ marginBottom: 8 }}>
              {hidden}
              <button className="btn btn-small" type="submit" data-testid="bh-anfordern">Aufgabe „Belege anfordern“ anlegen</button>
              <span className="small muted"> – landet beim Zuständigen (z. B. Assistenz), ohne Kontozugang.</span>
            </form>
            <table className="table small" data-testid="bh-ohne-beleg">
              <tbody>
                {s.listen.ohneBeleg.slice(0, 80).map((z) => (
                  <tr key={z.id}>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>{dmy(z.datum)}</td>
                    <td className="num right" style={{ whiteSpace: "nowrap" }}>{eur(z.betrag)}</td>
                    <td>{z.karte && <span className="tag tag-neutral">Amex</span>} {(z.gegenpartei || "").slice(0, 50)} <span className="muted">{z.zweck.slice(0, 60)}</span></td>
                    <td>
                      {(kand.get(z.id) ?? []).length > 0 && (
                        <form action={manuellAction} style={{ display: "flex", gap: 4 }}>
                          {hidden}
                          <input type="hidden" name="umsatz" value={z.id} />
                          <select name="beleg" aria-label="Beleg wählen">
                            {kand.get(z.id)!.map((b) => <option key={b.id} value={b.id}>{dmy(b.datum)} · {eur(b.rest)} · {(b.lieferant ?? "").slice(0, 25)} {b.nummer ?? ""}</option>)}
                          </select>
                          <button className="btn btn-small" type="submit">zuordnen</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <h3>Belege ohne Zahlung ({s.listen.belegeOhneZahlung.length})</h3>
        {s.listen.belegeOhneZahlung.length === 0 ? (
          <p className="small muted">Keine offenen Belege in diesem Monat.</p>
        ) : (
          <table className="table small" data-testid="bh-belege-offen">
            <tbody>
              {s.listen.belegeOhneZahlung.slice(0, 80).map((b) => (
                <tr key={b.id}>
                  <td className="num">{dmy(b.datum)}</td>
                  <td className="num right">{eur(b.rest)}{b.brutto !== null && Math.abs(b.brutto) !== b.rest ? <span className="muted"> von {eur(Math.abs(b.brutto))}</span> : null}</td>
                  <td>{b.lieferant ?? "–"} <span className="muted">{b.nummer ?? ""}</span>{b.docType === "gutschrift" && <span className="tag tag-info" style={{ marginLeft: 4 }}>Gutschrift</span>}</td>
                  <td><Link href={`/rechnungen/${b.id}`} className="small">öffnen</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 3. Vorkontierung */}
      <section className="card card-pad" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>3. Vorkontierung {settings.buchhaltung.kontenrahmen}</h2>
          <div style={{ display: "flex", gap: 6 }}>
            <form action={alleBestaetigenAction}>
              {hidden}
              <button className="btn btn-small" type="submit" disabled={!s.buchungen.vorschlag}>Alle Vorschläge bestätigen</button>
            </form>
            <form action={festschreibenAction}>
              {hidden}
              <button className="btn btn-small" type="submit" disabled={!s.buchungen.bestaetigt} data-testid="bh-festschreiben">Monat festschreiben</button>
            </form>
          </div>
        </div>
        <p className="small muted">Konto ändern = bestätigt; mit „merken“ lernt das System die Zuordnung für diesen Lieferanten. Festgeschriebene Buchungen sind unveränderbar (nur Storno).</p>
        {buchungen.length === 0 ? (
          <p className="small muted">Noch keine Buchungen – erst den Abgleich starten.</p>
        ) : (
          <div className="table-wrap">
            <table className="table small" data-testid="bh-buchungen">
              <thead>
                <tr><th>Datum</th><th className="right">Betrag</th><th>S/H</th><th>Konto · BU</th><th>Gegenkonto</th><th>Beleg / Text</th><th>Status</th></tr>
              </thead>
              <tbody>
                {buchungen.map(({ b, storniert }) => (
                  <tr key={b.id} style={b.status === "vorschlag" ? { background: "var(--warn-soft)" } : undefined}>
                    <td className="num">{dmy(b.datum)}</td>
                    <td className="num right">{eur(b.betrag)}</td>
                    <td>{b.sollHaben}</td>
                    <td>
                      {b.status === "festgeschrieben" ? (
                        <>{b.konto}{b.buSchluessel ? ` · ${b.buSchluessel}` : ""}</>
                      ) : (
                        <form action={buchungAction} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          {hidden}
                          <input type="hidden" name="id" value={b.id} />
                          <input name="konto" defaultValue={b.konto} list="skr" style={{ width: 70 }} aria-label="Konto" />
                          <input name="bu" defaultValue={b.buSchluessel ?? ""} style={{ width: 40 }} aria-label="BU-Schlüssel" />
                          {b.invoiceId && <label title="Für diesen Lieferanten merken" style={{ display: "flex", gap: 2 }}><input type="checkbox" name="lernen" value="1" />merken</label>}
                          <button className="btn btn-small" type="submit">OK</button>
                        </form>
                      )}
                      <div className="muted">{SKR04[b.konto] ?? ""}</div>
                    </td>
                    <td>{b.gegenkonto}</td>
                    <td>{b.buchungstext}{b.hinweis && <div className="muted">{b.hinweis}</div>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {b.status === "festgeschrieben" ? "🔒 fest" : b.status === "bestaetigt" ? "bestätigt" : "Vorschlag"}
                      {b.stornoVon && <div className="muted">Storno</div>}
                      {b.status === "festgeschrieben" && !storniert && !b.stornoVon && (
                        <form action={buchungAction}>
                          {hidden}
                          <input type="hidden" name="id" value={b.id} />
                          <button className="btn-link small" name="aktion" value="storno" type="submit">stornieren</button>
                        </form>
                      )}
                      {storniert && <div className="muted">storniert</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="skr">{Object.entries(SKR04).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</datalist>
          </div>
        )}
      </section>

      {/* 4. Export */}
      <section className="card card-pad" style={{ marginBottom: 14 }}>
        <h2 style={{ marginTop: 0 }}>4. Export für den Steuerberater</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="btn btn-primary" href={`/buchhaltung/export?${q}&art=datev`} data-testid="bh-datev">DATEV-Buchungsstapel (CSV)</a>
          <a className="btn" href={`/buchhaltung/export?${q}&art=zip`} data-testid="bh-zip">CSV + Belege (ZIP)</a>
          <Link className="btn" href="/buchhaltung/verfahren">Verfahrensdokumentation</Link>
          <Link className="btn" href="/buchhaltung/protokoll">Protokoll</Link>
        </div>
        {(!datev.beraternummer || !datev.mandantennummer) && <p className="small muted">Für den DATEV-Import fehlen noch Berater- und Mandantennummer von {s.firma} (vom Steuerberater) – unten bei „Einstellungen“.</p>}
        {s.exporte.length > 0 && (
          <ul className="small" style={{ paddingLeft: 18 }} data-testid="bh-exporte">
            {s.exporte.slice(0, 5).map((e) => <li key={e.id}>{e.createdAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} · {e.art === "datev" ? "DATEV" : "CSV + ZIP"} · {e.buchungen} Buchungen{e.belege ? `, ${e.belege} Belege` : ""}{e.festgeschrieben ? " · festgeschrieben" : ""}</li>)}
          </ul>
        )}
      </section>

      {ust && (
        <section className="card card-pad" style={{ marginBottom: 14 }} data-testid="bh-ust">
          <h2 style={{ marginTop: 0 }}>Auslandsumsätze (Amazon-Umsatzsteuerbericht)</h2>
          <ul className="notice notice-info small" style={{ paddingLeft: 24 }}>{ust.daten.hinweise.map((h, i) => <li key={i}>{h}</li>)}</ul>
          <table className="table small">
            <thead>
              <tr><th>Land</th><th>Vorgang</th><th>Verfahren</th><th className="right">Satz</th><th className="right">Netto</th><th className="right">USt</th><th className="right">Anzahl</th></tr>
            </thead>
            <tbody>
              {ust.daten.zeilen.map((z, i) => (
                <tr key={i}>
                  <td>{landName(z.land)}</td>
                  <td>{z.vorgang}</td>
                  <td>{z.verfahren}</td>
                  <td className="num right">{z.satz === null ? "–" : `${Math.round(z.satz * 1000) / 10} %`}</td>
                  <td className="num right">{eur(z.netto)}</td>
                  <td className="num right">{eur(z.ust)}</td>
                  <td className="num right">{z.anzahl}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">Nur Aufbereitung – welche Meldungen anfallen, entscheidet der Steuerberater.</p>
        </section>
      )}

      {session.role === "owner" && (
        <details className="card card-pad">
          <summary><strong>Einstellungen</strong></summary>
          <form action={einstellungenAction} className="small" style={{ display: "grid", gap: 8, marginTop: 8, maxWidth: 640 }}>
            {hidden}
            <label>Firmen (kommagetrennt; die erste ist die Hauptfirma)<input name="firmen" defaultValue={settings.buchhaltung.firmen.join(", ")} /></label>
            {settings.buchhaltung.firmen.map((f) => (
              <div key={f} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <strong style={{ width: 80 }}>{f}</strong>
                <label>DATEV-Beraternummer<input name={`berater_${f}`} defaultValue={settings.buchhaltung.datev[f]?.beraternummer ?? ""} style={{ width: 100 }} /></label>
                <label>Mandantennummer<input name={`mandant_${f}`} defaultValue={settings.buchhaltung.datev[f]?.mandantennummer ?? ""} style={{ width: 80 }} /></label>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <label>Bank<input name="bank" defaultValue={settings.buchhaltung.geldkonten.bank} style={{ width: 70 }} /></label>
              <label>Kreditkarte<input name="kreditkarte" defaultValue={settings.buchhaltung.geldkonten.kreditkarte} style={{ width: 70 }} /></label>
              <label>Geldtransit<input name="transit" defaultValue={settings.buchhaltung.geldkonten.transit} style={{ width: 70 }} /></label>
              <label>Marktplatz-Verrechnung<input name="marktplatz" defaultValue={settings.buchhaltung.geldkonten.marktplatz} style={{ width: 70 }} /></label>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
              <label>
                USt-Voranmeldung (für die Fristenliste)
                <select name="ustva" defaultValue={settings.buchhaltung.ustva.rhythmus}>
                  <option value="aus">nicht anzeigen</option>
                  <option value="monatlich">monatlich</option>
                  <option value="quartal">vierteljährlich</option>
                </select>
              </label>
              <label>
                <input type="checkbox" name="dauerfrist" defaultChecked={settings.buchhaltung.ustva.dauerfrist} /> Dauerfristverlängerung
              </label>
            </div>
            <div className="muted">Konten und Rhythmus mit dem Steuerberater abstimmen – das System rechnet nur das Datum. AdelPrep (Wittmann & Grunert) läuft über Lexoffice und gehört nicht hierher.</div>
            <button className="btn" type="submit">Speichern</button>
          </form>
        </details>
      )}
    </>
  );
}
