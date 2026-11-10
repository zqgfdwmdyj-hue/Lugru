import type { Metadata } from "next";
import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { briefeDerCharge, versandVorschau } from "@/lib/abverkauf/versand";
import { statusAction, stornoAction, testbriefAction, versendenAction } from "../actions";

export const metadata: Metadata = { title: "Briefversand – Seller-System" };
export const dynamic = "force-dynamic";

// B34.3a Briefversand einer Charge über den Anbieter: Vorschau (Adressprüfung, Seiten, Beilage), Kostenvorschau,
// Testbrief an die eigene Adresse, Freigabe mit bestätigter Kostensumme, Status vom Anbieter. Nie automatisch.

const eur = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
const zeit = (d: Date | null) => (d ? d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–");
const ST: Record<string, string> = { uebergeben: "übergeben", angenommen: "angenommen", gedruckt: "gedruckt", zugestellt: "zugestellt", fehler: "Fehler", storniert: "storniert" };

export default async function VersandPage({ params, searchParams }: { params: Promise<{ charge: string }>; searchParams: Promise<{ meldung?: string }> }) {
  const s = await requireArea("b2b");
  const { charge } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(charge)) return <p>Charge nicht gefunden.</p>;
  const [v, briefe] = await Promise.all([versandVorschau(s.tenantId, charge), briefeDerCharge(s.tenantId, charge)]);
  const inhaber = s.role === "owner" && !s.readOnly;
  const offen = v.zeilen.filter((z) => z.ok);
  return (
    <div className="stack" style={{ maxWidth: 1100 }} data-testid="versand" data-modus={v.modus}>
      <div className="page-head"><div><div className="crumb">B2B › Abverkauf</div><h1>Briefversand über {v.anbieterName}</h1></div><Link href="/b2b/abverkauf#erfolg" className="btn">Zurück</Link></div>
      {sp.meldung && <div className="notice notice-ok small" role="status" data-testid="versand-meldung">{sp.meldung}</div>}
      <div className={`notice small ${v.modus === "live" ? "notice-warn" : ""}`} data-testid="versand-modus">
        {v.modus === "test" ? "Testmodus (Sandbox des Anbieters): nichts wird gedruckt oder verschickt." : "Live: Briefe werden gedruckt und verschickt – nur nach deiner Freigabe unten."}
        {" "}AV-Vertrag: {v.avVertrag ? "bestätigt" : "nicht bestätigt (Live gesperrt)"} · Testbrief: {v.testbrief ? `${zeit(v.testbrief.am)} (${ST[v.testbrief.status] ?? v.testbrief.status})` : "noch keiner"}
      </div>

      <section className="card card-pad stack" style={{ gap: 8 }}>
        <h2 style={{ margin: 0 }}>Vorschau und Adressprüfung</h2>
        <table className="table small" data-testid="versand-vorschau">
          <thead><tr><th>Händler</th><th>Ort</th><th>Seiten</th><th>Kosten (netto)</th><th>Prüfung</th></tr></thead>
          <tbody>
            {v.zeilen.map((z) => (
              <tr key={z.anschreibenId} data-testid="versand-zeile" data-ok={z.ok ? "1" : "0"}>
                <td>{z.firma}</td>
                <td>{z.ort}</td>
                <td>{z.seiten}</td>
                <td>{eur(z.kosten)}</td>
                <td>{z.uebergeben ? <span className="muted">schon übergeben ({z.uebergeben})</span> : z.ok ? <span className="tag tag-ok">ok</span> : <span className="tag tag-warn">{z.fehler.join("; ")}</span>}{z.hinweis && <div className="small muted">{z.hinweis}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small" style={{ margin: 0 }} data-testid="versand-summe" data-summe={v.summe ?? ""}>
          Kostenvorschau: <b>{offen.length} Brief{offen.length === 1 ? "" : "e"} · {v.summe === null ? "Preis fehlt" : `${eur(v.summe)} netto`}</b>
          {v.modus === "live" && <> · heute {v.limit.heute}/{v.limit.tageslimit} Briefe · bisher {eur(v.limit.bisherKosten)}{v.limit.budget !== null ? ` von ${eur(v.limit.budget)} Budget` : ""}</>}
        </p>
        {v.sperre && <div className="notice notice-warn small" data-testid="versand-sperre">{v.sperre}</div>}
        {inhaber && (
          <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <form action={testbriefAction}><input type="hidden" name="charge" value={charge} /><button className="btn btn-sm" type="submit" disabled={!v.zugang} data-testid="versand-testbrief">Testbrief an die eigene Adresse</button></form>
            <form action={versendenAction} className="row" style={{ gap: 8, alignItems: "center" }}>
              <input type="hidden" name="charge" value={charge} />
              <input type="hidden" name="summe" value={v.summe ?? ""} />
              <label className="small"><input type="checkbox" name="bestaetigt" data-testid="versand-bestaetigt" /> Kosten {v.summe === null ? "–" : eur(v.summe)} geprüft – {offen.length} Briefe freigeben</label>
              <button className="btn btn-sm btn-primary" type="submit" disabled={!!v.sperre} data-testid="versand-los">Charge an {v.anbieterName} übergeben</button>
            </form>
          </div>
        )}
        <p className="small muted" style={{ margin: 0 }}>Kein Anbieter / Problem? Fallback: <a href={`/b2b/abverkauf/datei?art=serienbrief&id=${charge}`}>Sammel-PDF</a> drucken.</p>
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }}>
        <div className="between"><h2 style={{ margin: 0 }}>Übergeben ({briefe.length})</h2>
          <form action={statusAction}><input type="hidden" name="charge" value={charge} /><button className="btn btn-sm" type="submit" data-testid="versand-status">Status abrufen</button></form>
        </div>
        {briefe.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Noch nichts übergeben.</p> : (
          <table className="table small" data-testid="versand-briefe">
            <thead><tr><th>Empfänger</th><th>Modus</th><th>Auftrag</th><th>Status</th><th>Kosten</th><th></th></tr></thead>
            <tbody>
              {briefe.map(({ b, firma }) => (
                <tr key={b.id} data-testid="versand-brief" data-status={b.status} data-test={b.testbrief ? "1" : "0"}>
                  <td>{b.testbrief ? "Testbrief (eigene Adresse)" : firma ?? "–"}</td>
                  <td>{b.modus === "test" ? "Test" : "live"}</td>
                  <td>{b.externeId ?? "–"}</td>
                  <td>{ST[b.status] ?? b.status}<div className="muted">{b.statusText ?? ""} · {zeit(b.statusAm)}</div></td>
                  <td>{eur(b.kostenNetto)}</td>
                  <td>{inhaber && ["uebergeben", "angenommen"].includes(b.status) && b.externeId && <form action={stornoAction}><input type="hidden" name="charge" value={charge} /><input type="hidden" name="id" value={b.id} /><button className="btn btn-sm" type="submit">Stornieren</button></form>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
