import type { Metadata } from "next";
import { connection } from "next/server";
import { anfrageKampagne } from "@/lib/abverkauf/kampagnen";
import { anfrageSendenAction } from "../actions";

// B34.3b Öffentliche Anfrageseite (QR-Code/Kurzlink im Brief mit Kampagnen-ID): Firma, USt-ID (Gewerbenachweis),
// Wunschartikel, Menge, Kontakt. Zeigt nur das Angebot – keine Einstände, keine internen Angaben.

export const metadata: Metadata = { title: "Anfrage", robots: { index: false, follow: false }, referrer: "no-referrer" };

const wrap: React.CSSProperties = { maxWidth: 640, margin: "0 auto", padding: "24px 16px 48px", display: "grid", gap: 14 };
const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

export default async function AnfragePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ b?: string; fehler?: string; danke?: string }> }) {
  await connection();
  const { code } = await params;
  const sp = await searchParams;
  const k = await anfrageKampagne(code);
  if (!k) {
    return (
      <main style={wrap} data-testid="anfrage-weg">
        <h1 style={{ fontSize: 22, margin: 0 }}>Anfrage</h1>
        <div className="notice notice-warn">Dieses Angebot ist nicht mehr aktiv. Bitte wenden Sie sich direkt an den Absender des Briefs.</div>
      </main>
    );
  }
  if (sp.danke) {
    return (
      <main style={wrap} data-testid="anfrage-danke">
        <h1 style={{ fontSize: 22, margin: 0 }}>Vielen Dank!</h1>
        <div className="notice notice-ok">Ihre Anfrage ist bei {k.absender.name} angekommen. Wir melden uns zeitnah.</div>
      </main>
    );
  }
  return (
    <main style={wrap} data-testid="anfrage" data-kampagne={k.kampagne.code}>
      <div>
        <div className="small muted">{k.absender.name}</div>
        <h1 style={{ fontSize: 22, margin: "4px 0 0" }}>Anfrage: {k.kampagne.name}</h1>
        <div className="small muted">Kampagne {k.kampagne.code}{sp.b ? ` · Bezug ${sp.b}` : ""} · nur für Gewerbetreibende · Preise netto zzgl. USt.</div>
      </div>
      {sp.fehler && <div className="notice notice-warn" role="alert" data-testid="anfrage-fehler">{sp.fehler}</div>}
      <form action={anfrageSendenAction} className="card card-pad stack" style={{ gap: 10 }} data-testid="anfrage-form">
        <input type="hidden" name="code" value={k.kampagne.code} />
        {sp.b && <input type="hidden" name="b" value={sp.b} />}
        <input type="text" name="website" tabIndex={-1} autoComplete="off" style={{ position: "absolute", left: -9999 }} aria-hidden="true" />
        {k.positionen.length > 0 && (
          <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0 }}>
            <legend className="small" style={{ fontWeight: 600 }}>Wunschartikel</legend>
            {k.positionen.map((p) => (
              <label key={p.sku} className="row small" style={{ gap: 8, alignItems: "flex-start" }} data-testid="anfrage-position">
                <input type="checkbox" name="wunsch" value={p.sku} />
                <span>{p.titel} – {eur(p.preis)} netto je Stück{p.mindestmenge > 1 ? `, ab ${p.mindestmenge} Stück` : ""}{p.staffel.length ? ` (${p.staffel.map((s) => `ab ${s.ab}: ${eur(s.preis)}`).join(", ")})` : ""}{p.mhd ? ` · MHD ${p.mhd.split("-").reverse().join(".")}` : ""}</span>
              </label>
            ))}
          </fieldset>
        )}
        <label className="stack small" style={{ gap: 2 }}>Weitere Wünsche<textarea className="input" name="freitext" rows={2} /></label>
        <label className="stack small" style={{ gap: 2 }}>Menge<input className="input" name="menge" placeholder="z. B. je 20 Stück" /></label>
        <label className="stack small" style={{ gap: 2 }}>Firma *<input className="input" name="firma" required /></label>
        <label className="stack small" style={{ gap: 2 }}>USt-ID (Gewerbenachweis) *<input className="input" name="ust" required placeholder="DE…" /></label>
        <label className="stack small" style={{ gap: 2 }}>Ansprechpartner<input className="input" name="name" /></label>
        <label className="stack small" style={{ gap: 2 }}>E-Mail<input className="input" name="email" type="email" /></label>
        <label className="stack small" style={{ gap: 2 }}>Telefon<input className="input" name="telefon" /></label>
        <label className="row small" style={{ gap: 8, alignItems: "flex-start" }}><input type="checkbox" name="einwilligung" required /> <span>Ich bin einverstanden, dass meine Angaben zur Bearbeitung dieser Anfrage verwendet werden.</span></label>
        <button className="btn btn-primary" type="submit" data-testid="anfrage-senden">Anfrage senden</button>
        <p className="small muted" style={{ margin: 0 }}>{k.datenschutz}</p>
      </form>
    </main>
  );
}
