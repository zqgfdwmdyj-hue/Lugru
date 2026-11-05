import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { dealLieferanten } from "@/lib/deal-eingang/bestellmail";
import { adresseAusAbsender } from "@/lib/deal-eingang/bestellmail-logic";
import { bestellEinstellungenAction, dealQuelleAction } from "../actions";

// B28.5 Einstellungen → Deal-Quellen: Lieferant je Deal-Quelle (Mailadresse, Ansprechpartner, Zahlungsweg, Rechnung mit
// EAN) für die Bestellmail bei „Gekauft“, dazu Liefer-/Rechnungsadresse und Kopie ans eigene Postfach.

export default async function DealQuellenPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("dealeingang");
  const sp = await searchParams;
  const [liste, s] = await Promise.all([dealLieferanten(session.tenantId), getSettings(session.tenantId)]);
  const schreiben = !session.readOnly;
  const ausAbsender = adresseAusAbsender(s.shipper);
  const feld = (name: string, label: string, wert: string | null, o: { type?: string; placeholder?: string; testid?: string } = {}) => (
    <label className="field">
      {label}
      <input className="input" name={name} type={o.type ?? "text"} defaultValue={wert ?? ""} placeholder={o.placeholder} data-testid={o.testid} />
    </label>
  );
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/deal-eingang">Deal-Eingang</Link> · Einstellungen</div>
          <h1>Deal-Quellen</h1>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }} data-testid="dq-meldung">{sp.meldung}</div>}
      <p className="small muted">
        Lieferant je Deal-Quelle: Kommt ein Deal mit passender Quelle (Feld „Quelle“ am Deal, z. B. der Name des Ansprechpartners oder „WhatsApp-Deals“), schlägt der Knopf
        „Gekauft“ eine Bestellmail an diesen Lieferanten vor – erst als Entwurf, gesendet wird nur mit „Senden“.
      </p>

      <section className="card card-pad stack" data-testid="dq-liste">
        <h2 style={{ margin: 0 }}>Lieferanten</h2>
        {liste.length === 0 && <p className="small muted">Noch keine Deal-Quelle hinterlegt.</p>}
        {liste.map((l) => (
          <form key={l.supplierId} action={dealQuelleAction} className="stack small" style={{ gap: 6, borderTop: "1px solid var(--line)", paddingTop: 8 }} data-testid="dq-eintrag" data-name={l.name}>
            <input type="hidden" name="supplier_id" value={l.supplierId} />
            <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }}>
              {feld("name", "Name", l.name)}
              {feld("email", "Mailadresse", l.email, { type: "email" })}
              {feld("ansprechpartner", "Ansprechpartner", l.ansprechpartner)}
              {feld("zahlungsweg", "Standard-Zahlungsweg", l.zahlungsweg, { placeholder: "z. B. Überweisung Vorkasse" })}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }}>
              <label className="field" style={{ minWidth: 260 }}>
                Stichworte der Quelle (Komma)
                <input className="input" name="quellen" defaultValue={l.dealQuellen.filter((q) => q !== l.name).join(", ")} placeholder="z. B. WhatsApp-Deals" />
              </label>
              <label><input type="checkbox" name="rechnung_mit_ean" value="1" defaultChecked={l.rechnungMitEan} /> Rechnung mit EAN</label>
              {schreiben && (
                <>
                  <button className="btn btn-sm" type="submit" name="aktion" value="speichern">Speichern</button>
                  <button className="btn btn-sm" type="submit" name="aktion" value="entfernen">Entfernen</button>
                </>
              )}
            </div>
          </form>
        ))}
        {schreiben && (
          <form action={dealQuelleAction} className="stack small" style={{ gap: 6, borderTop: "1px solid var(--line)", paddingTop: 8 }} data-testid="dq-neu">
            <strong>Neue Deal-Quelle</strong>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }}>
              {feld("name", "Name des Lieferanten", null, { testid: "dq-name" })}
              {feld("email", "Mailadresse", null, { type: "email", testid: "dq-email" })}
              {feld("ansprechpartner", "Ansprechpartner", null, { testid: "dq-ansprechpartner" })}
              {feld("zahlungsweg", "Standard-Zahlungsweg", null, { placeholder: "z. B. Überweisung Vorkasse", testid: "dq-zahlungsweg" })}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }}>
              <label className="field" style={{ minWidth: 260 }}>
                Stichworte der Quelle (Komma)
                <input className="input" name="quellen" placeholder="z. B. WhatsApp-Deals" data-testid="dq-quellen" />
              </label>
              <label><input type="checkbox" name="rechnung_mit_ean" value="1" defaultChecked /> Rechnung mit EAN</label>
              <button className="btn btn-sm btn-primary" type="submit" name="aktion" value="speichern" data-testid="dq-speichern">Hinzufügen</button>
            </div>
          </form>
        )}
      </section>

      <section className="card card-pad stack" style={{ marginTop: 12 }} data-testid="dq-bestellmail">
        <h2 style={{ margin: 0 }}>Bestellmail</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Absender ist dein Standard-Postfach (Posteingang → Postfächer). Liefer- und Rechnungsadresse stehen in jeder Bestellmail; leer = Absender aus Versand-Einstellungen
          {ausAbsender ? ` („${ausAbsender.split("\n")[0]}“)` : " (noch nicht eingetragen)"}.
        </p>
        {session.role === "owner" && schreiben ? (
          <form action={bestellEinstellungenAction} className="stack small" style={{ gap: 8, maxWidth: 560 }}>
            <label className="field">
              Liefer- und Rechnungsadresse (mehrzeilig, erste Zeile = Firma)
              <textarea className="input" name="bestellAdresse" rows={4} defaultValue={s.dealEingang.bestellAdresse ?? ""} placeholder={ausAbsender || "Firma\nStraße Nr.\nPLZ Ort"} data-testid="dq-adresse" />
            </label>
            {feld("bestellUstId", "USt-IdNr. (für die Rechnung)", s.dealEingang.bestellUstId ?? "")}
            <label><input type="checkbox" name="bestellKopie" value="1" defaultChecked={s.dealEingang.bestellKopie !== false} /> Kopie jeder Bestellmail an das eigene Postfach</label>
            <div><button className="btn btn-sm" type="submit">Speichern</button></div>
          </form>
        ) : (
          <p className="small">{(s.dealEingang.bestellAdresse || ausAbsender || "–").split("\n").join(", ")}</p>
        )}
      </section>
    </>
  );
}
