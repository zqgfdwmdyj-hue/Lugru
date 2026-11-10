import type { Metadata } from "next";
import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { ZIELGRUPPEN, type Zielgruppe } from "@/lib/abverkauf/kampagne-logic";
import { kampagnenListe } from "@/lib/abverkauf/kampagnen";
import { kampagneNeuAction } from "./actions";

export const metadata: Metadata = { title: "Kampagnen – Seller-System" };
export const dynamic = "force-dynamic";

// B34.3b Kampagnen: Zielgruppe + Produkte + Preise + Brieftext + Lead-Filter; Brief mit QR-Code zur Anfrageseite.

export default async function KampagnenPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const s = await requireArea("b2b");
  const sp = await searchParams;
  const liste = await kampagnenListe(s.tenantId);
  return (
    <div className="stack" style={{ maxWidth: 1100 }} data-testid="kampagnen">
      <div className="page-head"><div><div className="crumb">B2B › Abverkauf</div><h1>Kampagnen</h1></div><Link href="/b2b/abverkauf" className="btn">Abverkauf</Link></div>
      {sp.meldung && <div className="notice notice-ok small" role="status" data-testid="km-meldung">{sp.meldung}</div>}
      <section className="card card-pad stack" style={{ gap: 8 }}>
        <h2 style={{ margin: 0 }}>Neue Kampagne</h2>
        <form action={kampagneNeuAction} className="row small" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }} data-testid="km-neu">
          <label className="stack" style={{ gap: 2 }}>Zielgruppe<select className="input" name="zielgruppe" data-testid="km-zielgruppe">{(Object.keys(ZIELGRUPPEN) as Zielgruppe[]).map((z) => <option key={z} value={z}>{ZIELGRUPPEN[z].name}</option>)}</select></label>
          <label className="stack" style={{ gap: 2 }}>Name<input className="input" name="name" placeholder="z. B. Friseure Herbst" data-testid="km-name" /></label>
          <label><input type="checkbox" name="nachfass" /> Nachfassen nach 3 Wochen (Aufgabe)</label>
          <button className="btn btn-sm btn-primary" type="submit" disabled={s.readOnly} data-testid="km-anlegen">Anlegen</button>
        </form>
      </section>
      <section className="card card-pad stack" style={{ gap: 8 }}>
        <h2 style={{ margin: 0 }}>Kampagnen ({liste.length})</h2>
        {liste.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Noch keine.</p> : (
          <table className="table small" data-testid="km-liste">
            <thead><tr><th>Name</th><th>Zielgruppe</th><th>Code</th><th>Positionen</th><th>Anschreiben</th><th>Antworten</th><th>Anfragen</th></tr></thead>
            <tbody>
              {liste.map((k) => (
                <tr key={k.id} data-testid="km-zeile" data-code={k.code}>
                  <td><Link href={`/b2b/abverkauf/kampagnen/${k.id}`}>{k.name}</Link>{!k.aktiv && <span className="muted"> (beendet)</span>}</td>
                  <td>{ZIELGRUPPEN[k.zielgruppe].name}</td>
                  <td>{k.code}</td>
                  <td>{k.positionen.filter((p) => p.angeboten).length} / {k.positionen.length}</td>
                  <td>{k.anschreiben}</td>
                  <td>{k.beantwortet}</td>
                  <td>{k.anfragen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
