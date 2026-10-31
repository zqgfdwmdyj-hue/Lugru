import Link from "next/link";
import { notFound } from "next/navigation";
import { requireArea } from "@/lib/auth/session";
import { miniChart } from "@/lib/deal-eingang/chart-logic";
import { keepaVerlaufAusCache } from "@/lib/deal-eingang/service";
import { lugruDeal } from "@/lib/lugru-deals/liste";
import { formatEuro } from "@/lib/numbers";
import { KeepaMini } from "../../keepa-mini";

// Ein Lugru-Deal: Zahlen laut Post, Reaktionen (nur Anzahl), Keepa-Schnappschuss beim Posten und Mini-Chart,
// Ampel und Deal-Wert mit Begründung und ähnlichen früheren Deals, eigene Entscheidung bzw. Ergebnis.

const AMPEL: Record<string, string> = { gruen: "🟢 grün", gelb: "🟡 gelb", rot: "🔴 rot" };
const eur = (n: number | null | undefined) => (n === null || n === undefined ? "–" : formatEuro(n));
const z = (n: number | null | undefined, e = "") => (n === null || n === undefined ? "–" : `${String(n).replace(".", ",")}${e}`);
const datum = (iso: string | null) => (iso ? new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" }) : "–");

export default async function LugruDealPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireArea("dealeingang");
  const { id } = await params;
  const d = await lugruDeal(session.tenantId, id);
  if (!d) notFound();
  const verlauf = await keepaVerlaufAusCache(session.tenantId, d.asin, d.zielmarkt);
  const chart = verlauf ? miniChart(verlauf.verlauf, { bis: new Date().toISOString().slice(0, 10) }) : null;
  const k = d.keepa_beim_posten;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/deal-eingang">Deal-Eingang</Link> › <Link href="/deal-eingang/lugru">Lugru Deals</Link></div>
          <h1 style={{ fontSize: 22 }}>{d.titel ?? d.asin}</h1>
          <div className="small muted">{datum(d.gepostet_am)}{d.kanal ? ` · #${d.kanal}` : ""} · {d.quelle === "discord" ? "aus Discord gelesen" : "aus Lugru Deals übertragen"}{d.link_discord ? <> · <a href={d.link_discord} target="_blank" rel="noreferrer">in Discord öffnen</a></> : null}</div>
        </div>
        {d.eingang_id && <Link className="btn" href={`/deal-eingang/${d.eingang_id}`} data-testid="lgd-eingang">Im Deal-Eingang öffnen</Link>}
      </div>

      <div className="grid-2" style={{ gap: 14 }}>
        <section className="card card-pad small" data-testid="lgd-post">
          <h2 style={{ marginTop: 0 }}>Laut Post</h2>
          <table className="table small"><tbody>
            <tr><td>ASIN</td><td>{d.asin}{d.asin_unsicher ? " (unsicher – frei im Text gefunden)" : ""}</td></tr>
            <tr><td>Shop</td><td>{d.shop ?? "–"}</td></tr>
            <tr><td>EK</td><td>{eur(d.ek)} {d.ek_netto ? "netto" : "brutto"}</td></tr>
            <tr><td>VK ({d.zielmarkt ?? "DE"})</td><td>{eur(d.vk)}</td></tr>
            <tr><td>Gewinn / Marge</td><td>{eur(d.gewinn)} · {z(d.marge, " %")}</td></tr>
            <tr><td>Verkäufe/Monat</td><td>{d.verkaeufe_monat ?? "–"}</td></tr>
            {d.max_menge ? <tr><td>Max. Menge</td><td>{d.max_menge} Stück</td></tr> : null}
            <tr><td>Status</td><td>{d.status === "ausverkauft" ? `ausverkauft${d.ausverkauft_am ? ` (${datum(d.ausverkauft_am)})` : ""}` : "aktiv"}</td></tr>
          </tbody></table>
        </section>
        <section className="card card-pad small" data-testid="lgd-reaktionen">
          <h2 style={{ marginTop: 0 }}>Reaktionen der Gruppe</h2>
          <div style={{ fontSize: 20 }}>{Object.entries(d.reaktionen).map(([e, n]) => `${e} ${n}`).join("  ") || "noch keine"}</div>
          <div className="muted">✅ gekauft: {d.gruppen_kaeufe} · ❌ weg: {d.nicht_verfuegbar} · nur Anzahlen, keine Namen. Fehlende Reaktion heißt nicht „nicht gekauft“.</div>
          <h3>Eigene Entscheidung</h3>
          <div data-testid="lgd-gekauft">{d.gekauft ? `✓ gekauft – ${d.gekauft_quelle}` : d.entscheidung ? `Deal-Eingang: ${d.entscheidung.status}` : "nicht gekauft (keine Bestellung mit dieser ASIN in den 14 Tagen nach dem Posten)"}</div>
          {d.realer_roi !== null && <div>Realer ROI (sellerboard): {z(d.realer_roi, " %")}</div>}
        </section>
      </div>

      <section className="card card-pad small" style={{ marginTop: 14 }} data-testid="lgd-wert">
        <h2 style={{ marginTop: 0 }}>Ampel {d.ampel ? AMPEL[d.ampel] : "– (nur live gelesene Deals werden geprüft)"} · Deal-Wert {d.deal_wert ?? "–"}/100</h2>
        {d.deal_wert_begruendung && (
          <>
            <div>{d.deal_wert_begruendung.begruendung}</div>
            <div className="grid-2" style={{ gap: 10, marginTop: 6 }}>
              <div><strong>Dafür</strong><ul style={{ margin: 0, paddingLeft: 18 }}>{d.deal_wert_begruendung.dafuer.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
              <div><strong>Dagegen</strong><ul style={{ margin: 0, paddingLeft: 18 }}>{d.deal_wert_begruendung.dagegen.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            </div>
          </>
        )}
        {d.aehnliche.length > 0 && (
          <>
            <h3>Ähnliche frühere Deals</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }} data-testid="lgd-aehnliche">{d.aehnliche.map((a, i) => <li key={i}>{a.titel ?? a.asin} ({a.datum.split("-").reverse().join(".")}, {a.quelle === "lugru" ? "Lugru" : "eigener"}): {a.ergebnis}</li>)}</ul>
          </>
        )}
      </section>

      <section className="card card-pad small" style={{ marginTop: 14 }} data-testid="lgd-keepa">
        <h2 style={{ marginTop: 0 }}>Keepa {k ? (k.art === "posten" ? "beim Posten" : k.art === "verlauf" ? "zum Zeitpunkt des Postens (aus dem Verlauf)" : "aktuell (Verlauf deckt den Zeitpunkt nicht ab)") : "– noch kein Schnappschuss"}</h2>
        {k && <div>Buy Box {eur(k.buyBox)} · Ø30 {eur(k.buyBox30)} · Ø90 {eur(k.buyBox90)} · Ø180 {eur(k.buyBox180)} · Einbrüche 12 M {k.einbrueche12 ?? "–"} · Angebote {k.angebote ?? "–"} (Trend 30 T {z(k.angeboteTrend30, " %")}) · Amazon {z(k.amazonAnteil, " %")} · Rang {k.rang?.toLocaleString("de-DE") ?? "–"}{k.gekauftImMonat ? ` · ${k.gekauftImMonat}+ im Monat gekauft` : ""}</div>}
        {chart && verlauf ? <KeepaMini chart={chart} land={verlauf.land} stand={verlauf.stand} /> : <div className="muted">Kein Keepa-Verlauf im Zwischenspeicher.</div>}
      </section>

      {d.weitere_posts_gleiche_asin.length > 0 && (
        <section className="card card-pad small" style={{ marginTop: 14 }}>
          <h2 style={{ marginTop: 0 }}>Weitere Posts dieser ASIN</h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{d.weitere_posts_gleiche_asin.map((w) => <li key={w.id}><Link href={`/deal-eingang/lugru/${w.id}`}>{datum(w.gepostet_am)}</Link>{w.kanal ? ` · #${w.kanal}` : ""} · EK {eur(w.ek)}{w.shop ? ` · ${w.shop}` : ""} · {w.gruppen_kaeufe}× ✅</li>)}</ul>
        </section>
      )}
    </>
  );
}
