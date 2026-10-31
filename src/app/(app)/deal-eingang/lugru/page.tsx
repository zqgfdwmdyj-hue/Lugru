import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { lugruKanalStand } from "@/lib/lugru-deals/discord";
import { lugruKanalNamen, lugruListe, lugruStatistikFuer } from "@/lib/lugru-deals/liste";
import { getIntegration } from "@/lib/integrations/store";
import { lugruHistorieStand } from "@/lib/lugru-deals/historie";
import { lugruAbrufenAction, lugruEingaengeAction, lugruHistorieAction, lugruKaufAction } from "../actions";

// Lugru Deals: alle in der Deal-Gruppe geposteten Deals (vom Seller-System in Discord gelesen bzw. aus Lugru Deals
// übertragen) mit Reaktionen (nur Anzahl), Ampel, Deal-Wert und eigenen Käufen; Statistik-Kacheln und Import-Stand.

const AMPEL: Record<string, string> = { gruen: "🟢", gelb: "🟡", rot: "🔴" };
const euro = (n: number | null) => (n === null ? "–" : `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const datum = (iso: string | null) => (iso ? new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }) : "–");
const zahl = (n: number | null) => (n === null ? "–" : String(n).replace(".", ","));

type SP = { von?: string; bis?: string; kanal?: string; ampel?: string; gekauft?: string; wert?: string; suche?: string; seite?: string; meldung?: string; test?: string };
const tag = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "–");

export default async function LugruDealsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requireArea("dealeingang");
  const sp = await searchParams;
  const t = session.tenantId;
  const ampel = sp.ampel === "gruen" || sp.ampel === "gelb" || sp.ampel === "rot" ? sp.ampel : null;
  const seite = Math.max(0, Number(sp.seite) || 0);
  const mitTest = sp.test === "1";
  const [liste, stat, stand, kanaele, cfg, imEingang] = await Promise.all([
    lugruListe(t, { von: sp.von, bis: sp.bis, kanal: sp.kanal || null, ampel, gekauft: sp.gekauft === "ja" ? true : sp.gekauft === "nein" ? false : null, minWert: sp.wert ? Number(sp.wert) : null, suche: sp.suche, limit: 50, offset: seite * 50, mitTest }),
    lugruStatistikFuer(t, { von: sp.von, bis: sp.bis, mitTest }),
    lugruKanalStand(t),
    lugruKanalNamen(t, { mitTest }),
    getIntegration(t, "lugru_deals"),
    lugruHistorieStand(t),
  ]);
  const k = cfg as { kanalIds?: string; schluessel?: string } | null;
  // Weg B: das Seller-System liest die Deal-Kanäle in Discord (Kanal-IDs nötig). Weg A: Lugru Deals (PC) schickt
  // jeden Deal selbst – dann braucht es keine Kanal-IDs.
  const eingerichtet = Boolean(k?.kanalIds);
  const wegA = Boolean(k?.schluessel) || stand.deals - stand.ausDiscord > 0;
  const appAlt = stand.appZuletzt ? Date.now() - Date.parse(stand.appZuletzt) > 24 * 3600_000 : false;
  const qs = (extra: Record<string, string>) => new URLSearchParams(Object.entries({ ...sp, meldung: "", ...extra }).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/deal-eingang">Deal-Eingang</Link></div>
          <h1>Lugru Deals</h1>
          <div className="small muted">Deals aus den Deal-Kanälen der Gruppe – Reaktionen nur als Anzahl, keine Namen.</div>
        </div>
        {!session.readOnly && eingerichtet && (
          <div className="row" style={{ gap: 8 }}>
            <form action={lugruAbrufenAction}><button className="btn" type="submit" data-testid="lg-abrufen">Jetzt abrufen</button></form>
            <form action={lugruHistorieAction}><button className="btn" type="submit" data-testid="lg-historie">History importieren</button></form>
          </div>
        )}
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }} data-testid="lg-meldung">{sp.meldung}</div>}
      {wegA ? (
        <div className={`notice ${appAlt ? "notice-warn" : "notice-ok"} small`} style={{ marginBottom: 12 }} data-testid="lg-weg-a">
          <strong>Weg A aktiv:</strong> Lugru Deals (PC) schickt jeden Deal direkt nach dem Posten ans Seller-System – Deal-Eingang mit Ampel und Push. Discord-Kanal-IDs sind dafür nicht nötig{eingerichtet ? " (zusätzlich liest das Seller-System die eingetragenen Kanäle – Weg B)" : ""}.{" "}
          {stand.appZuletzt ? <>Zuletzt übertragen: {datum(stand.appZuletzt)}{stand.appNeuesterPost ? ` (neuester Deal gepostet ${datum(stand.appNeuesterPost)})` : ""}.</> : "Schlüssel eingerichtet – noch nichts übertragen."}
          {appAlt && <> Seit über 24 Std. nichts Neues – läuft Lugru Deals auf dem PC und ist dort die Adresse des Seller-Systems eingetragen?</>}
        </div>
      ) : (
        !eingerichtet && (
          <div className="notice notice-warn small" style={{ marginBottom: 12 }} data-testid="lg-einrichten">
            Noch nicht eingerichtet: unter <Link href="/anbindungen?p=lugru_deals#lugru_deals">Anbindungen → „Lugru Deals“</Link> den Schlüssel für die Lugru-Deals-App erzeugen und dort eintragen (Weg A, empfohlen – jeder Deal kommt direkt nach dem Posten) oder die IDs der Deal-Kanäle eintragen (Weg B, Bot mit Leserecht im Server der Gruppe).
          </div>
        )
      )}

      <section className="grid-kpi" style={{ marginBottom: 14 }} data-testid="lg-kacheln">
        <div className="card card-pad" data-testid="lg-kachel-deals"><div className="kpi-label">Deals im Zeitraum {tag(stat.zeitraum.von)}–{tag(stat.zeitraum.bis)}</div><div className="kpi-value">{stat.deals.toLocaleString("de-DE")}</div><div className="kpi-label">{zahl(stat.dealsJeWoche)} je Woche · <span data-testid="lg-gesamt">insgesamt {stat.gesamt.deals.toLocaleString("de-DE")}{stat.gesamt.seit ? ` seit ${tag(stat.gesamt.seit)}` : ""}</span></div></div>
        <div className="card card-pad"><div className="kpi-label">Reaktionen ({tag(stat.zeitraum.von)}–{tag(stat.zeitraum.bis)})</div><div className="kpi-value">{zahl(stat.reaktionenSchnitt)}</div><div className="kpi-label" title={stat.reaktionenHinweis ?? undefined}>Ø je Deal · {stat.gruppenKaeufe.toLocaleString("de-DE")}× ✅ im Zeitraum, {stat.gesamt.gruppenKaeufe.toLocaleString("de-DE")}× insgesamt</div></div>
        <div className="card card-pad"><div className="kpi-label">Anteil grün</div><div className="kpi-value">{stat.anteilGruen === null ? "–" : `${stat.anteilGruen} %`}</div><div className="kpi-label">von {stat.mitAmpel} geprüften</div></div>
        <div className="card card-pad"><div className="kpi-label">Selbst gekauft</div><div className="kpi-value" data-testid="lg-gekauft">{stat.gekauft}</div><div className="kpi-label">Ø realer ROI {stat.realerRoiSchnitt === null ? "– (noch kein Ergebnis)" : `${zahl(stat.realerRoiSchnitt)} % aus ${stat.mitErgebnis}`}</div><div className="kpi-label" data-testid="lg-gekauft-regel">erkannt an Charge (SKU-Kaufdatum), Einkaufs-Bestellung oder „gekauft“ im Deal-Eingang – gleiche ASIN, bis 14 Tage nach dem Post</div>{!session.readOnly && <form action={lugruKaufAction} style={{ marginTop: 4 }}><button className="btn btn-small" type="submit" data-testid="lg-kauf-abgleich">Eigene Käufe abgleichen</button></form>}</div>
      </section>
      {(stat.besteMarken.length > 0 || stat.emojis.length > 0) && (
        <section className="card card-pad small" style={{ marginBottom: 14 }} data-testid="lg-beste">
          {stat.besteMarken.length > 0 && <div><strong>Beste Marken</strong> (✅ je Deal): {stat.besteMarken.map((m) => `${m.name} ${zahl(m.kaeufeJeDeal)} (${m.deals} Deals)`).join(" · ")}</div>}
          {stat.besteKategorien.length > 0 && <div><strong>Beste Kategorien:</strong> {stat.besteKategorien.map((m) => `${m.name} ${zahl(m.kaeufeJeDeal)}`).join(" · ")}</div>}
          {stat.emojis.length > 0 && <div><strong>Reaktionen:</strong> {stat.emojis.map((e) => `${e.emoji} ${e.anzahl}`).join(" · ")}{stat.reaktionenHinweis ? <span className="muted"> – {stat.reaktionenHinweis}</span> : null}</div>}
        </section>
      )}
      <section className="card card-pad small" style={{ marginBottom: 14 }} data-testid="lg-eingang-stand">
        <strong>Im Deal-Eingang:</strong> {imEingang.imEingang.toLocaleString("de-DE")} von {imEingang.gesamt.toLocaleString("de-DE")} Deals, {imEingang.mitAmpel.toLocaleString("de-DE")} mit Ampel
        {imEingang.imEingang < imEingang.gesamt ? " – ältere werden im Hintergrund nachgetragen (neueste zuerst, ohne Push; Ampel aus den Zahlen des Posts und dem Keepa-Stand beim Posten)." : "."}{" "}
        {imEingang.imEingang > 0 && <Link href={`/deal-eingang?quelle=${encodeURIComponent("Lugru Deals")}`}>im Deal-Eingang ansehen</Link>}
        {!mitTest && stat.gesamt.testAusgeblendet > 0 && <span className="muted"> · {stat.gesamt.testAusgeblendet} Deals aus Testkanälen ausgeblendet</span>}
        {!session.readOnly && imEingang.imEingang < imEingang.gesamt && (
          <form action={lugruEingaengeAction} style={{ marginTop: 6 }}>
            <button className="btn btn-small" type="submit" data-testid="lg-nachtragen" title="Bis zu 1.000 Deals auf einmal, neueste zuerst – ohne Push">Jetzt nachtragen</button>
          </form>
        )}
      </section>

      <form className="card card-pad row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }} data-testid="lg-filter">
        <label className="small">von<br /><input type="date" name="von" defaultValue={sp.von} /></label>
        <label className="small">bis<br /><input type="date" name="bis" defaultValue={sp.bis} /></label>
        <label className="small">Kanal<br /><select name="kanal" defaultValue={sp.kanal ?? ""}><option value="">alle</option>{kanaele.map((k) => <option key={k} value={k}>#{k}</option>)}</select></label>
        <label className="small">Ampel<br /><select name="ampel" defaultValue={ampel ?? ""}><option value="">alle</option><option value="gruen">🟢 grün</option><option value="gelb">🟡 gelb</option><option value="rot">🔴 rot</option></select></label>
        <label className="small">Gekauft<br /><select name="gekauft" defaultValue={sp.gekauft ?? ""}><option value="">egal</option><option value="ja">ja</option><option value="nein">nein</option></select></label>
        <label className="small">Deal-Wert ab<br /><input type="number" name="wert" min={0} max={100} defaultValue={sp.wert} style={{ width: 80 }} /></label>
        <label className="small">Suche<br /><input name="suche" defaultValue={sp.suche} placeholder="Titel, ASIN, Shop" /></label>
        <label className="small row" style={{ gap: 4, alignItems: "center" }}><input type="checkbox" name="test" value="1" defaultChecked={mitTest} data-testid="lg-test" /> Testkanäle zeigen</label>
        <button className="btn" type="submit">Filtern</button>
      </form>

      <section className="card" data-testid="lg-liste">
        <div style={{ overflowX: "auto" }}>
          <table className="table small">
            <thead><tr><th>Gepostet</th><th>Deal</th><th>Kanal</th><th className="right">EK</th><th className="right">Gewinn</th><th>Reaktionen</th><th>Ampel</th><th className="right">Deal-Wert</th><th>Gekauft</th></tr></thead>
            <tbody>
              {liste.deals.length === 0 && <tr><td colSpan={9} className="muted">{eingerichtet ? "Noch keine Lugru-Deals – „Jetzt abrufen“ bzw. „History importieren“." : wegA ? "Noch keine Lugru-Deals übertragen." : "Noch keine Lugru-Deals."}</td></tr>}
              {liste.deals.map((d) => (
                <tr key={d.id} data-testid="lg-zeile">
                  <td style={{ whiteSpace: "nowrap" }}>{datum(d.gepostet_am)}</td>
                  <td><Link href={`/deal-eingang/lugru/${d.id}`}>{(d.titel ?? d.asin).slice(0, 70)}</Link><div className="muted">{d.asin}{d.asin_unsicher ? " (unsicher)" : ""}{d.shop ? ` · ${d.shop}` : ""}{d.status === "ausverkauft" ? " · ausverkauft" : ""}</div></td>
                  <td>{d.kanal ? `#${d.kanal}` : "–"}</td>
                  <td className="num right">{euro(d.ek)}</td>
                  <td className="num right">{euro(d.gewinn)}{d.marge !== null ? <div className="muted">{zahl(d.marge)} %</div> : null}</td>
                  <td title={d.reaktionen_hinweis}>{Object.entries(d.reaktionen).map(([e, n]) => `${e} ${n}`).join(" ") || "–"}</td>
                  <td>{d.ampel ? AMPEL[d.ampel] : "–"}</td>
                  <td className="num right">{d.deal_wert ?? "–"}</td>
                  <td>{d.gekauft ? "✓" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row small" style={{ gap: 12, padding: 10 }}>
          <span className="muted">{liste.gesamt} Deals</span>
          {seite > 0 && <Link href={`?${qs({ seite: String(seite - 1) })}`}>‹ zurück</Link>}
          {(seite + 1) * 50 < liste.gesamt && <Link href={`?${qs({ seite: String(seite + 1) })}`}>weiter ›</Link>}
        </div>
      </section>

      <section className="card card-pad small" style={{ marginTop: 14 }} data-testid="lg-stand">
        <strong>Import-Stand:</strong> {stand.deals} Deals ({stand.ausDiscord} aus Discord gelesen{stand.deals - stand.ausDiscord ? `, ${stand.deals - stand.ausDiscord} aus Lugru Deals übertragen` : ""})
        {stand.kanaele.length > 0 && (
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {stand.kanaele.map((k) => (
              <li key={k.kanalId}>#{k.kanal}: {k.gelesen.toLocaleString("de-DE")} Nachrichten gelesen, {k.erkannt.toLocaleString("de-DE")} Deals · History {k.historieFertig ? "vollständig" : "läuft"}{k.historieBis ? ` (zurück bis ${datum(k.historieBis)})` : ""}{k.letzterLauf ? ` · zuletzt ${datum(k.letzterLauf)}` : ""}{k.fehler ? <span className="tag tag-warn" style={{ marginLeft: 6 }}>{k.fehler}</span> : null}</li>
            ))}
          </ul>
        )}
        {!session.readOnly && eingerichtet && (
          <form action={lugruHistorieAction} style={{ marginTop: 6 }}>
            <input type="hidden" name="neu" value="1" />
            <button className="btn btn-small" type="submit" title="Vorhandene Deals bleiben; es wird nur noch einmal von vorn gelesen.">History von vorn lesen</button>
          </form>
        )}
      </section>
    </>
  );
}
