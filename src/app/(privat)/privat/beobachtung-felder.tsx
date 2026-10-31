/** Die drei Spalten des Therapie-Bogens. „[?]“ im Text markiert eine Stelle als noch unvollständig. */
export function BeobachtungFelder({ id = "neu", werte }: { id?: string; werte?: { situation: string; problematik: string | null; veraenderung: string | null } }) {
  return (
    <>
      <div className="field">
        <label className="label" htmlFor={`o-sit-${id}`}>Situation</label>
        <textarea className="input" id={`o-sit-${id}`} name="situation" rows={2} maxLength={1000} placeholder="z. B. Abendessen, Kinder müde, ab 17 Uhr gereizt" defaultValue={werte?.situation ?? ""} required />
      </div>
      <div className="field">
        <label className="label" htmlFor={`o-pro-${id}`}>Problematik <span className="muted">(optional)</span></label>
        <textarea className="input" id={`o-pro-${id}`} name="problematik" rows={2} maxLength={1000} placeholder="Was war schwierig?" defaultValue={werte?.problematik ?? ""} />
      </div>
      <div className="field">
        <label className="label" htmlFor={`o-ver-${id}`}>Gewünschte Veränderung <span className="muted">(optional)</span></label>
        <textarea className="input" id={`o-ver-${id}`} name="veraenderung" rows={2} maxLength={1000} placeholder="Was wünschst du dir stattdessen?" defaultValue={werte?.veraenderung ?? ""} />
      </div>
      <div className="small muted">Noch unsicher? „[?]“ an die Stelle schreiben – im Therapie-Bogen steht dann „unvollständig“.</div>
    </>
  );
}
