import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { STEUER_CODES } from "@/lib/druck/logic";
import { DruckKnopf } from "@/components/druck-knopf";
import { Scanner } from "./scanner";

// Lager → Scannen: Scanner-Arbeitsplatz im Vollbild (iPad/Monitor an der Werkbank, Bluetooth-Handscanner als Tastatur).

export default async function ScannenPage({ searchParams }: { searchParams: Promise<{ druck?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/drucken">Drucken</Link></div><h1>Scannen</h1></div>
      </div>
      {sp.druck && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>{sp.druck}</div>}
      <Scanner />
      <details className="card card-pad" style={{ marginTop: 12 }}>
        <summary className="small">Steuer-Barcodes (Karte für die Werkbank)</summary>
        <p className="small" style={{ margin: "8px 0" }}>{Object.entries(STEUER_CODES).map(([c, t]) => `${t} = ${c}`).join(" · ")}. Stellplatz-Schilder tragen „FACH-…“ (Lager → Drucken → Stellplatz-Schild).</p>
        <DruckKnopf session={s} vorlage="steuerkarte" eingabe={{}} zurueck="/lager/scannen" text="Steuerkarte drucken (102 mm)" testid="steuerkarte" />
      </details>
    </>
  );
}
