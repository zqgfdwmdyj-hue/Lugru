import { CopyButton } from "@/components/copy-button";
import type { ListingFacts } from "@/lib/ebay-review/logic";
import { KA_EINSTELLEN_URL, kleinanzeigenEntwurf } from "@/lib/kleinanzeigen/logic";

// Kleinanzeigen-Entwurf am eBay-Angebot: Titel, Text, Preis, Kategorie, Zustand und Bilder zum Kopieren. Eingestellt
// wird von Hand in der Kleinanzeigen-App (etwa eine Minute) – keine Schnittstelle, kein Bot, kein Login im System.

export function KleinanzeigenEntwurf({ itemId, f }: { itemId: string; f: ListingFacts }) {
  const e = kleinanzeigenEntwurf({ title: f.title, price: f.price, categoryName: f.categoryName, conditionName: f.conditionName, conditionId: f.conditionId, images: f.images, descriptionText: f.descriptionText, aspects: f.aspects, brand: f.brand, ean: f.ean });
  return (
    <details className="card card-pad" style={{ marginTop: 14 }} data-testid="ka-entwurf">
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Kleinanzeigen-Entwurf</summary>
      <p className="small muted">Zum Kopieren in die Kleinanzeigen-App – nichts wird automatisch eingestellt. Reihenfolge in der App: Bilder → Titel → Kategorie → Zustand → Beschreibung → Preis.</p>
      <div className="stack" style={{ gap: 10 }}>
        <div>
          <div className="small muted">Titel ({e.titel.length}/65)</div>
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <strong data-testid="ka-titel" style={{ overflowWrap: "anywhere" }}>{e.titel}</strong>
            <CopyButton text={e.titel} label="Titel kopieren" />
          </div>
        </div>
        <div className="small">
          Kategorie: <strong data-testid="ka-kategorie">{e.kategorie ?? "bitte in der App wählen"}</strong> · Zustand: <strong data-testid="ka-zustand">{e.zustand}</strong> · Preis: <strong data-testid="ka-preis">{e.preisText}</strong> <CopyButton text={String(e.preis)} label="Preis kopieren" />
        </div>
        <div>
          <div className="small muted">Beschreibung ({e.text.length}/4.000)</div>
          <textarea readOnly value={e.text} rows={8} style={{ width: "100%" }} data-testid="ka-text" />
          <CopyButton text={e.text} label="Text kopieren" />
        </div>
        {e.bilder.length > 0 && (
          <div>
            <div className="small muted">{e.bilder.length} Bild{e.bilder.length === 1 ? "" : "er"} – am Handy einzeln antippen und sichern oder alle als ZIP laden</div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 4 }}>
              {e.bilder.map((b, i) => (
                <a key={b} href={b} target="_blank" rel="noreferrer" data-testid="ka-bild">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={b} alt={`Bild ${i + 1}`} width={64} height={64} style={{ objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)" }} />
                </a>
              ))}
            </div>
            <a className="btn btn-small" href={`/ebay/pruefen/${itemId}/kleinanzeigen-bilder`} data-testid="ka-bilder-zip" style={{ marginTop: 6 }}>Bilder als ZIP</a>
          </div>
        )}
        {e.hinweise.length > 0 && (
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }} data-testid="ka-hinweise">
            {e.hinweise.map((h) => <li key={h}>{h}</li>)}
          </ul>
        )}
        <div>
          <a className="btn btn-primary btn-small" href={KA_EINSTELLEN_URL} target="_blank" rel="noreferrer" data-testid="ka-oeffnen">Kleinanzeigen öffnen</a>
        </div>
      </div>
    </details>
  );
}
