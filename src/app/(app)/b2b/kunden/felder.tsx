// Formularfelder eines B2B-Kunden (anlegen und bearbeiten).

type K = {
  firma?: string | null; ansprechpartner?: string | null; email?: string | null; strasse?: string | null; plz?: string | null; ort?: string | null;
  land?: string | null; ustId?: string | null; amazonName?: string | null; zahlungsart?: string | null; notiz?: string | null;
  abo?: { alle?: boolean; marken?: string[]; kategorien?: string[] };
};

function F({ label, name, v, width = 200, type = "text", required }: { label: string; name: string; v?: string | null; width?: number; type?: string; required?: boolean }) {
  return (
    <div className="field">
      <label className="label" htmlFor={`k-${name}`}>{label}{required ? " *" : ""}</label>
      <input className="input" id={`k-${name}`} name={name} type={type} defaultValue={v ?? ""} style={{ width, maxWidth: "100%" }} required={required} />
    </div>
  );
}

export function KundenFelder({ k = {} }: { k?: K }) {
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 } as const;
  const abo = k.abo ?? { alle: true };
  return (
    <>
      <div style={grid}>
        <F label="Firma" name="firma" v={k.firma} required />
        <F label="Ansprechpartner" name="ansprechpartner" v={k.ansprechpartner} />
        <F label="E-Mail (Portal-Anmeldung)" name="email" v={k.email} type="email" />
        <F label="Name im Amazon-Konto" name="amazonName" v={k.amazonName} />
        <F label="Straße" name="strasse" v={k.strasse} />
        <F label="PLZ" name="plz" v={k.plz} width={90} />
        <F label="Ort" name="ort" v={k.ort} />
        <F label="Land (Kürzel)" name="land" v={k.land ?? "DE"} width={60} />
        <F label="USt-IdNr." name="ustId" v={k.ustId} width={170} />
        <div className="field">
          <label className="label" htmlFor="k-zahlungsart">Zahlung</label>
          <select className="input" id="k-zahlungsart" name="zahlungsart" defaultValue={k.zahlungsart ?? "vorkasse"} style={{ width: 160 }}>
            <option value="vorkasse">Vorkasse</option>
            <option value="rechnung">auf Rechnung</option>
          </select>
        </div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <label className="check small"><input type="checkbox" name="abo_alle" defaultChecked={abo.alle !== false} /> Über alle neuen Deals benachrichtigen</label>
        <div style={grid}>
          <F label="… sonst nur Marken (Komma)" name="abo_marken" v={(abo.marken ?? []).join(", ")} />
          <F label="… oder Kategorien (Komma)" name="abo_kategorien" v={(abo.kategorien ?? []).join(", ")} />
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="k-notiz">Notiz (intern)</label>
        <textarea className="input" id="k-notiz" name="notiz" rows={2} defaultValue={k.notiz ?? ""} style={{ maxWidth: 560 }} />
      </div>
    </>
  );
}
