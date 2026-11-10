import { requireSession } from "@/lib/auth/session";
import { heuteGescannt, scanLesen } from "@/lib/scan/service";
import { Scanner, type HeuteDaten, type Vorgabe } from "./scanner";

// Scan-Modus (B13, ausgebaut B34.1) – Handy im Laden oder online: Kamera/Eingabe, Ziffernfeld, Ampel in Sekunden,
// Aktionen je Scan und „Heute gescannt“. Nichts wird automatisch gekauft.

export const dynamic = "force-dynamic";

export default async function ScanPage({ searchParams }: { searchParams: Promise<{ modus?: string; code?: string; preis?: string; shop?: string; id?: string }> }) {
  const s = await requireSession();
  const q = await searchParams;
  const h = await heuteGescannt(s);
  const heute: HeuteDaten = {
    summe: h.summe,
    budget: h.budget,
    kapital: h.kapital,
    zeilen: h.zeilen.map((z) => ({ id: z.id, code: z.code, asin: z.asin, titel: z.titel, ampel: z.ampel, preis: z.preis, netto: z.netto, rueckverguetung: z.rueckverguetung, gewinnStueck: z.gewinnStueck, roi: z.roi, roiPa: z.roiPa, aktion: z.aktion, listeMenge: z.listeMenge, listeOrt: z.listeOrt, offline: z.offline, fehler: z.fehler, modus: z.modus, belege: z.belege.length, uhr: z.gescanntAm.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }) })),
  };
  // Aus dem Push „Offline-Scan geprüft“: diesen Scan zeigen.
  const offen = q.id ? await scanLesen(s, q.id) : null;
  const vorgabe: Vorgabe = {
    modus: q.modus === "online" || offen?.modus === "online" ? "online" : q.modus === "laden" ? "laden" : null,
    code: (q.code ?? "").slice(0, 300),
    preis: (q.preis ?? "").slice(0, 20),
    shop: (q.shop ?? "").slice(0, 500),
    // Geteilt aus der Amazon-/Shop-App: sofort prüfen (Amazon-Link auch ohne Preis – dann Buy-Box-Preis des Landes).
    auto: Boolean(q.code && (q.modus === "online" || q.preis)),
    offen: offen?.ergebnis ? { id: offen.id, code: offen.code, preis: offen.preis, modus: offen.modus, shop: offen.shopUrl, r: offen.ergebnis } : null,
  };
  return (
    <>
      <div className="page-head"><div><div className="crumb">Einkauf</div><h1>Scan-Modus</h1></div></div>
      <Scanner vorgabe={vorgabe} heute={heute} />
      <p className="small muted">
        Kamera (BarcodeDetector, sonst ZXing), Handscanner, Eingabe oder iPhone-Kurzbefehl „Scan“. Aus der Amazon- oder Shop-App „Teilen → Seller-System“ öffnet den Online-Modus. Keepa aus dem 6-Stunden-Cache, Gebühren je Land über die Amazon-Anbindung. Gekauft wird nichts automatisch.
      </p>
    </>
  );
}
