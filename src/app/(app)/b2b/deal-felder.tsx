// Formularfelder eines Deals – gemeinsam für „Deal anlegen“ und die Bearbeitung auf der Detailseite (Server-Komponente).

type Wert = string | number | null | undefined;
export type DealFeldWerte = {
  asin?: Wert; ean?: Wert; titel?: Wert; bildUrl?: Wert; marke?: Wert; kategorie?: Wert; supplierId?: Wert; angebotId?: Wert;
  ekNetto?: Wert; staffel?: Wert; moqLieferant?: Wert; lieferzeitTage?: Wert; angebotGueltigBis?: Wert; frist?: Wert;
  kundenpreisNetto?: Wert; mindestmengeKunde?: Wert; maxGesamt?: Wert; maxProKunde?: Wert; maxKunden?: Wert; nurRestmenge?: boolean;
  versandAnteil?: Wert; prepGebuehr?: Wert; hinweis?: Wert;
};

const dez = (v: Wert) => (v === null || v === undefined ? "" : typeof v === "number" ? String(v).replace(".", ",") : v);

function F({ label, name, v, width = 160, type = "text", help, disabled, required, testid }: { label: string; name: string; v?: Wert; width?: number; type?: string; help?: string; disabled?: boolean; required?: boolean; testid?: string }) {
  return (
    <div className="field">
      <label className="label" htmlFor={`f-${name}`}>{label}{required ? " *" : ""}</label>
      <input className="input" id={`f-${name}`} name={name} type={type} defaultValue={dez(v)} style={{ width, maxWidth: "100%" }} disabled={disabled} required={required} data-testid={testid} inputMode={type === "text" && /preis|ek|anteil|gebuehr/i.test(name) ? "decimal" : undefined} />
      {help && <span className="small muted">{help}</span>}
    </div>
  );
}

export function DealFelder({ w, lieferanten, mitPreis, fest }: { w: DealFeldWerte; lieferanten: { id: string; name: string }[]; mitPreis: boolean; fest?: boolean }) {
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 } as const;
  return (
    <>
      <h3 style={{ margin: 0 }}>Artikel</h3>
      <div style={grid}>
        <F label="ASIN" name="asin" v={w.asin} width={140} required disabled={fest} testid="deal-asin" />
        <F label="EAN" name="ean" v={w.ean} width={160} disabled={fest} />
        <F label="Marke" name="marke" v={w.marke} />
        <F label="Kategorie" name="kategorie" v={w.kategorie} />
      </div>
      <F label="Titel" name="titel" v={w.titel} width={560} help="Leer lassen: Titel kommt aus Keepa" />
      <F label="Bild-Adresse" name="bildUrl" v={w.bildUrl} width={560} />
      <h3 style={{ margin: "6px 0 0" }}>Einkauf beim Großhändler</h3>
      <div style={grid}>
        <div className="field">
          <label className="label" htmlFor="f-supplierId">Lieferant</label>
          <select className="input" id="f-supplierId" name="supplierId" defaultValue={w.supplierId ? String(w.supplierId) : ""} disabled={fest} style={{ width: 200, maxWidth: "100%" }}>
            <option value="">– wählen –</option>
            {lieferanten.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <F label="EK netto je Stück" name="ekNetto" v={w.ekNetto} width={100} required disabled={fest} testid="deal-ek" />
        <F label="MOQ Lieferant" name="moqLieferant" v={w.moqLieferant ?? 1} width={80} disabled={fest} />
        <F label="Staffel" name="staffel" v={w.staffel} width={200} help="z. B. „ab 100: 3,90; ab 250: 3,70“" disabled={fest} />
        <F label="Lieferzeit" name="lieferzeitTage" v={w.lieferzeitTage} width={70} help="Tage" />
        <F label="Angebot gültig bis" name="angebotGueltigBis" v={w.angebotGueltigBis} type="date" width={150} />
      </div>
      <h3 style={{ margin: "6px 0 0" }}>Für Kunden</h3>
      <div style={grid}>
        {mitPreis && <F label="Kundenpreis netto" name="kundenpreisNetto" v={w.kundenpreisNetto} width={100} help="Später in der Rechenhilfe anpassbar" testid="deal-preis" />}
        <F label="Reservieren bis" name="frist" v={w.frist} type="date" width={150} testid="deal-frist" />
        <F label="Mindestmenge je Kunde" name="mindestmengeKunde" v={w.mindestmengeKunde ?? 1} width={80} />
        <F label="Max. gesamt" name="maxGesamt" v={w.maxGesamt} width={80} help="Gegen Preiskampf – Vorschlag nach der Prognose" testid="deal-max" />
        <F label="Max. je Kunde" name="maxProKunde" v={w.maxProKunde} width={80} />
        <F label="Max. Kunden" name="maxKunden" v={w.maxKunden} width={80} help="Leer: Standard aus den Einstellungen" />
        <F label="Prep-Gebühr je Stück" name="prepGebuehr" v={w.prepGebuehr} width={80} help="Leer: Standard" />
        <F label="Versandanteil je Stück" name="versandAnteil" v={w.versandAnteil} width={80} help="Großhändler → Prep" />
      </div>
      <label className="check small"><input type="checkbox" name="nurRestmenge" defaultChecked={w.nurRestmenge} /> Wir führen die ASIN selbst – nur die Restmenge abgeben</label>
      <div className="field">
        <label className="label" htmlFor="f-hinweis">Hinweis für Kunden</label>
        <textarea className="input" id="f-hinweis" name="hinweis" rows={2} defaultValue={dez(w.hinweis)} style={{ maxWidth: 560 }} />
      </div>
      {w.angebotId ? <input type="hidden" name="angebotId" value={String(w.angebotId)} /> : null}
      {/* Nach dem Freischalten gesperrte Felder trotzdem mitschicken (deaktivierte Felder sendet der Browser nicht). */}
      {fest && (["asin", "ean", "ekNetto", "moqLieferant", "staffel", "supplierId"] as const).map((k) => <input key={k} type="hidden" name={k} value={dez(w[k])} />)}
    </>
  );
}
