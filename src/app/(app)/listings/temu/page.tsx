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
        <div><div className="crumb">Verkauf & Versand</div><h1>eBay → Temu / Wawi</h1></div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Link className="btn" href="/listings/temu?neu=1">eBay-Angebote neu laden</Link>
          <Link className="btn" href="/listings?kanal=temu">Temu-Listings</Link>
        </div>
      </div>
      <details className="card card-pad small" data-testid="temu-help">
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>So funktioniert’s</summary>
        <p style={{ margin: "8px 0 0" }}>
          Alle laufenden eBay-Angebote – aus dem eBay-Tool und ältere, direkt bei eBay eingestellte. In fünf Schritten: Angebote wählen, Preis (Basispreis-Rechner),
          Paket, Prüfen, Einstellen. <strong>Auf Temu einstellen</strong> überträgt Titel, Beschreibung, Bilder, Merkmale, EAN und Varianten; die Menge kommt aus der Wawi.
          <strong> Nur in die Wawi übernehmen</strong> bucht den Bestand aus der eBay-Menge (oder verknüpft per EAN/SKU mit vorhandenem Lager); danach gleicht die Wawi
          die Menge auf eBay, Temu, Amazon FBM … ab. Bei älteren Angeboten setzt die Wawi die Menge auf eBay über die Artikelnummer; Varianten ohne eigene SKU bei eBay
          bekommen dafür eine Aufgabe zum Nachtragen.
        </p>
        <p style={{ margin: "8px 0 0" }}>
          Stände: <strong>Entwurf</strong> = alles da (den Zustand neu/gebraucht älterer Angebote prüft das System erst beim Einstellen), <strong>unvollständig</strong> = es fehlen Angaben (in der Zeile steht was), <strong>in Arbeit</strong> = wird übertragen
          bzw. Temu prüft, <strong>veröffentlicht</strong> = bei Temu aktiv, <strong>fehlgeschlagen</strong> = Fehler (Grund in der Zeile, erneut versuchen möglich).
        </p>
      </details>
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
      <TransferTable candidates={data.candidates} rule={data.rule} pack={data.pack} temuConnected={data.temuConnected} running={data.running} allowHttp={process.env.TEMU_ALLOW_HTTP_IMAGES === "1"} />
      <div className="row" style={{ flexWrap: "wrap" }}>
        <div id="rechner" style={{ flex: "1 1 320px" }}><TemuCalculator rule={data.rule} /></div>
        <details className="card card-pad stack" style={{ gap: 6, flex: "1 1 320px" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Schon bei Temu vorhanden? Verknüpfen</summary>
          <div className="small muted">
            Auf anderem Weg zu Temu gekommen (Excel-Vorlage „Mehrfach-Upload“, „Synchronisierung von Drittanbieter-Shops“ oder von Hand)? Steht im
            Temu-Produkt dieselbe SKU wie bei eBay bzw. im Lager, verknüpft das System es mit der Wawi – danach folgt die Menge auf Temu dem Bestand.
            Läuft alle 6 Stunden auch von selbst.
          </div>
          <LinkTemuButton disabled={!data.temuConnected} />
        </details>
      </div>
    </>
  );
}
