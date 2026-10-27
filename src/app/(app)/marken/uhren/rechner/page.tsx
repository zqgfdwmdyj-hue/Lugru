import { requireFlip } from "@/lib/watches/service";
import { Calculator } from "../forms";
import { FlipHead } from "../ui";

/** Deal-Rechner: Gewinn, Umsatzsteuer, Rendite, Break-even und höchster Ankaufspreis – live. */
export default async function RechnerPage({ searchParams }: { searchParams: Promise<{ zustand?: string }> }) {
  const { brandName } = await requireFlip();
  const sp = await searchParams;
  const neu = sp.zustand === "neu";
  return (
    <div className="flip stack" style={{ gap: 16 }}>
      <FlipHead title="Deal-Rechner" brand={brandName} sub="Vorwärts: Was bleibt übrig? Rückwärts: Wie viel darf ich höchstens zahlen?" />
      <Calculator defaults={neu ? { condition: "neu", mode: "regel" } : {}} />
      <details className="small">
        <summary style={{ cursor: "pointer" }}>Welche Steuerart passt?</summary>
        <ul style={{ paddingLeft: 18 }}>
          <li><strong>Ohne Umsatzsteuer:</strong> gelegentlicher Privatverkauf oder Kleinunternehmer (§ 19 UStG).</li>
          <li><strong>Differenzbesteuerung (§ 25a):</strong> Händler, gebrauchte Uhr ohne Vorsteuer gekauft (z. B. von Privat) – Steuer nur auf die Differenz Verkauf − Einkauf.</li>
          <li><strong>Regelbesteuerung:</strong> Händler, mit Rechnung inkl. ausgewiesener Umsatzsteuer gekauft (z. B. neue Uhr) – 19 % auf den vollen Preis, Vorsteuer abziehen.</li>
        </ul>
        <p className="muted">Überblick, keine Steuerberatung.</p>
      </details>
    </div>
  );
}
