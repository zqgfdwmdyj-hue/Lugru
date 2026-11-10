import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
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
  // B34.1 Abnahme 0: drei bekannte EANs (eigene Produkte) zum Ausprobieren – ein Tipp setzt die EAN im Laden-Modus ein.
  const probe = await db.select({ ean: schema.products.ean, titel: schema.products.title }).from(schema.products).where(and(eq(schema.products.tenantId, s.tenantId), isNotNull(schema.products.ean))).orderBy(desc(schema.products.createdAt)).limit(3);
  return (
    <>
      <div className="page-head"><div><div className="crumb">Einkauf</div><h1>Scan-Modus</h1></div></div>
      <Scanner vorgabe={vorgabe} heute={heute} />
      <details className="card card-pad small" data-testid="scan-startbildschirm">
        <summary><b>Auf den Handy-Startbildschirm</b> und mit 3 bekannten EANs ausprobieren</summary>
        <ol style={{ margin: "6px 0", paddingLeft: 18 }}>
          <li>iPhone: diese Seite in Safari öffnen → Teilen-Symbol → „Zum Home-Bildschirm“ → „Hinzufügen“. Danach startet „Seller“ direkt im Vollbild.</li>
          <li>Android: Chrome-Menü (⋮) → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“. Lange auf das Symbol tippen → „Scan-Modus“ öffnet direkt hier.</li>
          <li>Ausprobieren: unten eine bekannte EAN antippen, den Regalpreis eintippen, „Prüfen“ – das Ergebnis (Ampel, ROI) muss in wenigen Sekunden kommen.</li>
        </ol>
        {probe.length ? (
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {probe.map((p) => <a key={p.ean} className="btn btn-sm" href={`/scan?modus=laden&code=${encodeURIComponent(p.ean!)}`} data-testid="scan-probe" data-ean={p.ean}>{p.ean}{p.titel ? ` · ${p.titel.slice(0, 30)}` : ""}</a>)}
          </div>
        ) : <p className="muted" style={{ margin: 0 }}>Noch keine eigenen Produkte mit EAN – einfach drei EANs aus dem Regal scannen.</p>}
      </details>
      <p className="small muted">
        Kamera (BarcodeDetector, sonst ZXing), Handscanner, Eingabe oder iPhone-Kurzbefehl „Scan“. Aus der Amazon- oder Shop-App „Teilen → Seller-System“ öffnet den Online-Modus. Keepa aus dem 6-Stunden-Cache, Gebühren je Land über die Amazon-Anbindung. Gekauft wird nichts automatisch.
      </p>
    </>
  );
}
