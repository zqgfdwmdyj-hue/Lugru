import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { transferCandidates } from "@/lib/temu/transfer";
import { retryFailedAction } from "./actions";
import { TemuCalculator } from "./calculator";
import { LinkTemuButton, TransferTable } from "./transfer-table";

export default async function EbayTransferPage({ searchParams }: { searchParams: Promise<{ neu?: string }> }) {
  const session = await requireArea("wawi");
  const sp = await searchParams;
  const data = await transferCandidates(session.tenantId, { fresh: sp.neu === "1" });
  const failed = data.candidates.filter((c) => c.job?.status === "fehler").length;
  const legacy = data.candidates.filter((c) => c.source === "ebay").length;
  return (
    <>
      <div className="page-head">
        <div><div className="crumb">WaWi · Listings</div><h1>eBay-Angebote übernehmen</h1></div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Link className="btn" href="/listings/temu?neu=1">eBay-Angebote neu laden</Link>
          <Link className="btn" href="/listings?kanal=temu">Temu-Listings</Link>
        </div>
      </div>
      <div className="small muted">
        Alle laufenden eBay-Angebote – aus dem eBay-Tool und ältere, direkt bei eBay eingestellte. Auswählen, dann <strong>auf Temu einstellen</strong> (Titel,
        Beschreibung, Bilder, Merkmale, EAN, Varianten; Menge aus der Wawi) oder <strong>nur in die Wawi übernehmen</strong>: Bestand aus der eBay-Menge
        (oder per EAN/SKU mit vorhandenem Lager verknüpft), danach gleicht die Wawi die Menge auf eBay, Temu, Amazon FBM … ab. Bei älteren Angeboten setzt
        die Wawi die Menge auf eBay über die Artikelnummer; Varianten ohne eigene SKU bei eBay bekommen dafür eine Aufgabe zum Nachtragen.
      </div>
      {!data.ebay.connected && <div className="notice notice-warn">eBay ist nicht verbunden – unter eBay → eBay-Einstellungen → Verbindung anmelden, dann erscheinen hier auch die älteren Angebote.</div>}
      {data.ebay.error && <div className="notice notice-error" data-testid="ebay-error">Ältere eBay-Angebote konnten nicht geladen werden: {data.ebay.error}</div>}
      {!data.temuConnected && <div className="notice notice-info">Temu ist nicht verbunden – unter <Link href="/anbindungen?p=temu#temu">Anbindungen → Temu</Link> einrichten. „Nur in die Wawi übernehmen“ geht auch ohne.</div>}
      <div className="small muted" data-testid="transfer-summary">
        {data.candidates.length} Angebote ({legacy} ältere direkt bei eBay){data.ebay.loadedAt ? ` · von eBay geladen ${new Date(data.ebay.loadedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}` : ""}
        {data.running ? " · Übernahme läuft …" : ""}
      </div>
      {failed > 0 && (
        <form action={retryFailedAction} className="notice notice-warn" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>{failed} Übernahme(n) mit Fehler – Grund in der Zeile.</span>
          <button className="btn btn-small" type="submit">Fehlgeschlagene erneut versuchen</button>
        </form>
      )}
      <div id="rechner"><TemuCalculator rule={data.rule} /></div>
      <section className="card card-pad stack" style={{ gap: 6 }}>
        <div className="small muted">
          Schon auf anderem Weg bei Temu (Excel-Vorlage „Mehrfach-Upload“, „Synchronisierung von Drittanbieter-Shops“ oder von Hand)? Steht im
          Temu-Produkt dieselbe SKU wie bei eBay bzw. im Lager, verknüpft das System es mit der Wawi – danach folgt die Menge auf Temu dem Bestand.
          Läuft alle 6 Stunden auch von selbst.
        </div>
        <LinkTemuButton disabled={!data.temuConnected} />
      </section>
      <TransferTable candidates={data.candidates} rule={data.rule} pack={data.pack} temuConnected={data.temuConnected} running={data.running} />
    </>
  );
}
