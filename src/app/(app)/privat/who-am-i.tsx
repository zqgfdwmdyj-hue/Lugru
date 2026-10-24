import { assignMeAction } from "./actions";

/**
 * Einmal fragen statt raten: Ist dieses Konto noch keiner Person zugeordnet, steht oben diese Karte.
 * Von wem eine Wertschätzung, eine Stimmung oder ein „erledigt“ ist, hängt davon ab.
 */
export function WhoAmI({ partners, account }: { partners: { a: string; b: string }; account: string }) {
  return (
    <section className="notice notice-warn stack" style={{ gap: 8 }} data-testid="who-am-i">
      <strong>Wer bist du?</strong>
      <div className="small">
        Dein Konto „{account}“ ist noch keiner Person zugeordnet. Einträge wie Wertschätzung, Stimmung und „erledigt von“ sowie die Vorauswahl in
        Formularen hängen davon ab – das System nimmt nichts an.
      </div>
      <form action={assignMeAction} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-small" type="submit" name="me" value="a" data-testid="who-a">Ich bin {partners.a}</button>
        <button className="btn btn-small" type="submit" name="me" value="b" data-testid="who-b">Ich bin {partners.b}</button>
      </form>
      <div className="small muted">Namen anpassen oder Zuordnung ändern: Privat → Einstellungen.</div>
    </section>
  );
}
