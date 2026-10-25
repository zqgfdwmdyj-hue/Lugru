import { partnerHolders, type PartnerKey } from "@/lib/private/logic";
import { privateMembers } from "@/lib/private/service";
import { assignMeAction } from "./actions";

/**
 * Einmal fragen statt raten: Ist dieses Konto noch keiner Person zugeordnet, steht oben diese Karte.
 * Von wem eine Wertschätzung, eine Stimmung oder ein „erledigt“ ist, hängt davon ab. Eine Rolle, die schon
 * ein anderes Konto hat, ist gesperrt – Konten mit ähnlichem Namen werden nie zusammengeführt.
 */
export async function WhoAmI({ partners, account, tenantId, userId, userPartner }: { partners: { a: string; b: string }; account: string; tenantId: string; userId: string; userPartner: Record<string, PartnerKey> }) {
  const taken = partnerHolders(userPartner, await privateMembers(tenantId), userId);
  return (
    <section className="notice notice-warn stack" style={{ gap: 8 }} data-testid="who-am-i">
      <strong>Wer bist du?</strong>
      <div className="small">
        Dein Konto „{account}“ ist noch keiner Person zugeordnet. Einträge wie Wertschätzung, Stimmung und „erledigt von“ sowie die Vorauswahl in
        Formularen hängen davon ab – das System nimmt nichts an.
      </div>
      <form action={assignMeAction} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(["a", "b"] as const).map((k) => (
          <button key={k} className="btn btn-small" type="submit" name="me" value={k} data-testid={`who-${k}`} disabled={Boolean(taken[k])} title={taken[k] ? `Schon dem Konto „${taken[k]}“ zugeordnet` : undefined}>
            Ich bin {partners[k]}{taken[k] ? ` (vergeben an „${taken[k]}“)` : ""}
          </button>
        ))}
      </form>
      {(taken.a || taken.b) && (
        <div className="small" data-testid="who-taken">
          Eine Person gehört genau zu einem Konto – Konten mit ähnlichem Namen werden nicht zusammengeführt. Ist das andere Konto ein altes von dir, entzieht der Inhaber dort den Privat-Zugang (Einstellungen → Benutzer).
        </div>
      )}
      <div className="small muted">Namen anpassen oder Zuordnung ändern: Privat → Einstellungen.</div>
    </section>
  );
}
