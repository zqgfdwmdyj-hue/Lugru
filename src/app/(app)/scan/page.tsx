import { requireSession } from "@/lib/auth/session";
import { Scanner } from "./scanner";

// Scanner mit Ampel (B13) – für das Handy im Laden/beim Großhändler.

export default async function ScanPage() {
  await requireSession();
  return (
    <>
      <div className="page-head"><div><div className="crumb">Einkauf</div><h1>Scan mit Ampel</h1></div></div>
      <Scanner />
      <p className="small muted">Ohne Kamera-Unterstützung: Handscanner, Eingabe oder iPhone-Kurzbefehl „Scan“ (Anleitung im Wissen). Gebühren je Land über die Amazon-Anbindung, sonst Pauschale mit Hinweis.</p>
    </>
  );
}
