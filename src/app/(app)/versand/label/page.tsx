import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { canAccess } from "@/lib/auth/areas";
import { getSettings } from "@/lib/settings";
import { publicUrl } from "@/lib/public-url";
import { KANAELE, VERSAND_PRODUKTE } from "@/lib/versand-label/logic";
import { labelLaden, labelProtokoll, stammadressen } from "@/lib/versand-label/service";
import { LabelFormular, type Vorbelegung } from "./formular";
import { labelEinstellungenAction } from "./actions";

// Versand → Label erstellen (Bauauftrag DHL-Label aus Chat): für Inhaber und alle mit „Service“ (auch die VA).
// Protokoll: Inhaber sieht alle Labels mit Kosten laut Preisliste, alle anderen nur die eigenen (ohne Kosten).

const zeit = (d: Date) => d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const euro = (n: number | null) => (n === null ? "–" : `${n.toFixed(2).replace(".", ",")} €`);
const STATUS: Record<string, string> = { erstellt: "erstellt", vorlage: "Vorlage", entwurf: "vom Handy", fehler: "abgelehnt" };

export default async function LabelPage({ searchParams }: { searchParams: Promise<{ vorlage?: string; meldung?: string }> }) {
  const s = await requireArea("service");
  const sp = await searchParams;
  const inhaber = s.role === "owner" && !s.readOnly;
  const b2b = canAccess(s, "b2b");
  const settings = await getSettings(s.tenantId);
  const [stamm, protokoll] = await Promise.all([stammadressen(s.tenantId, { userId: s.userId, mitB2b: b2b, alle: inhaber }), labelProtokoll(s.tenantId, { userId: s.userId, alle: inhaber })]);
  const v = sp.vorlage && /^[0-9a-f-]{36}$/.test(sp.vorlage) ? await labelLaden(s.tenantId, sp.vorlage, { userId: s.userId, alle: inhaber }) : null;
  const vorbelegung: Vorbelegung | null = v && v.status !== "erstellt"
    ? { id: v.id, kanal: v.kanal, produkt: v.produkt, empfaenger: v.empfaenger ?? undefined, unsicher: v.unsicher, gewichtKg: v.gewichtKg ?? "", artikel: v.artikel ?? "", sku: v.sku ?? "", menge: v.menge, preis: v.preis ?? "", zahlungsart: v.zahlungsart ?? "" }
    : null;
  const offen = protokoll.filter((p) => p.status !== "erstellt");
  const a2 = settings.versandLabel.absender2;
  const p = settings.versandLabel.preise;
  const basis = publicUrl() ?? "";
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/auftraege">Aufträge & Versand</Link></div>
          <h1>Label erstellen</h1>
          <div className="small muted">Adresse aus WhatsApp, Kleinanzeigen oder Screenshot – DHL-Label in einem Schritt, Auftrag wird angelegt.</div>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }} data-testid="label-meldung">{sp.meldung}</div>}
      {v && v.status !== "erstellt" && (
        <div className="notice notice-info small" style={{ marginBottom: 12 }} data-testid="label-vorlage-geladen">
          {v.status === "entwurf" ? "Adresse vom Handy übernommen" : v.status === "fehler" ? `Zuletzt abgelehnt: ${v.fehler ?? ""}` : "Vorlage geöffnet"} – bitte prüfen und „Label erstellen“.
        </div>
      )}
      {s.readOnly ? (
        <div className="notice notice-info small">Nur ansehen – Labels erstellen geht mit diesem Zugang nicht.</div>
      ) : (
        <LabelFormular key={v?.id ?? "neu"} stamm={stamm} vorbelegung={vorbelegung} b2bErlaubt={b2b} absender1={settings.shipper.name1 || "LuGru GmbH"} absender2={a2?.name1 ?? null} />
      )}

      {offen.length > 0 && (
        <section className="card card-pad stack" style={{ gap: 6, marginTop: 16 }} data-testid="label-vorlagen">
          <h2 style={{ margin: 0 }}>Vorlagen und Abgelehntes</h2>
          {offen.map((o) => (
            <div key={o.id} className="small" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className={`tag ${o.status === "fehler" ? "tag-critical" : "tag-warn"}`}>{STATUS[o.status] ?? o.status}</span>
              <span>{zeit(o.createdAt)} · {o.an}</span>
              <Link href={`/versand/label?vorlage=${o.id}`} data-testid="label-vorlage-oeffnen">öffnen</Link>
            </div>
          ))}
        </section>
      )}

      <section className="card card-pad stack" style={{ gap: 6, marginTop: 16 }} data-testid="label-protokoll">
        <h2 style={{ margin: 0 }}>{inhaber ? "Protokoll (alle)" : "Meine Labels"}</h2>
        {protokoll.filter((x) => x.status === "erstellt").length ? (
          <div className="table-wrap">
            <table className="table small">
              <thead>
                <tr><th>Wann</th>{inhaber && <th>Wer</th>}<th>An</th><th>Kanal</th><th>Produkt</th><th>Sendung</th>{inhaber && <th>Kosten</th>}</tr>
              </thead>
              <tbody>
                {protokoll.filter((x) => x.status === "erstellt").map((x) => (
                  <tr key={x.id} data-testid="label-protokoll-zeile">
                    <td style={{ whiteSpace: "nowrap" }}>{zeit(x.createdAt)}</td>
                    {inhaber && <td>{x.wer ?? x.werMail ?? "–"}</td>}
                    <td>{x.an}{x.gefahrgut?.lq ? <span className="tag tag-warn" style={{ marginLeft: 4 }}>LQ</span> : null}</td>
                    <td>{KANAELE.find((k) => k.key === x.kanal)?.titel ?? x.kanal}</td>
                    <td>{VERSAND_PRODUKTE.find((p2) => p2.key === x.produkt)?.titel ?? x.produkt}</td>
                    <td>{x.labelFileId ? <a href={`/datei/${x.labelFileId}`} target="_blank" rel="noreferrer">{x.sendungsnummer ?? "PDF"}</a> : (x.sendungsnummer ?? "–")}{x.orderId ? <> · <Link href={`/auftraege/${x.orderId}`}>Auftrag</Link></> : null}</td>
                    {inhaber && <td data-testid="label-kosten">{euro(x.kosten)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="small muted">Noch keine Labels.</div>
        )}
        {inhaber && !Object.keys(p).length && <div className="small muted">Kosten erscheinen, sobald unten die Preise laut DHL-Vertrag hinterlegt sind.</div>}
      </section>

      <section className="card card-pad stack" style={{ gap: 6, marginTop: 16 }} data-testid="label-iphone">
        <h2 style={{ margin: 0 }}>iPhone: aus dem Teilen-Menü</h2>
        <div className="small">
          Kurzbefehl „Label erstellen“ (App Kurzbefehle → <strong>+</strong> → in den Details „Im Share-Sheet zeigen“, Eingabe: Bilder und Text): Aktion <strong>„Inhalte von URL abrufen“</strong> mit <code>{basis || "https://<deine Adresse>"}/api/mobil/label</code>, Methode POST, Header <code>Authorization: Bearer mk_…</code> (Handy-Schlüssel aus <Link href="/schnell">Schnellerfassung</Link>), Anfragetext <strong>Formular</strong> mit Feld <code>bild</code> = Kurzbefehl-Eingabe (bzw. <code>text</code>). Dann <strong>„Wörterbuchwert abrufen“</strong> <code>url</code> → <strong>„URLs öffnen“</strong>. Die Seite öffnet sich mit der erkannten Adresse.
        </div>
      </section>

      {inhaber && (
        <section className="card card-pad stack" style={{ gap: 8, marginTop: 16 }} id="einstellungen" data-testid="label-einstellungen">
          <h2 style={{ margin: 0 }}>Einstellungen (nur Inhaber)</h2>
          <form action={labelEinstellungenAction} className="stack" style={{ gap: 8 }}>
            <strong className="small">Zweiter Absender (z. B. Wittmann & Grunert)</strong>
            <div className="label-felder">
              {([["a2_name", "Name", a2?.name1], ["a2_name2", "Zusatz", a2?.name2], ["a2_street", "Straße", a2?.street], ["a2_house", "Hausnr.", a2?.houseNo], ["a2_zip", "PLZ", a2?.zip], ["a2_city", "Ort", a2?.city], ["a2_country", "Land (DEU)", a2?.country], ["a2_email", "E-Mail", a2?.email], ["a2_phone", "Telefon", a2?.phone]] as const).map(([k, t, w]) => (
                <div className="field" key={k}>
                  <label className="label" htmlFor={k}>{t}</label>
                  <input className="input" id={k} name={k} defaultValue={w ?? ""} />
                </div>
              ))}
            </div>
            <strong className="small">Preisliste (€ netto laut DHL-Vertrag – fürs Protokoll; leer = nicht hinterlegt)</strong>
            <div className="label-felder">
              {[...VERSAND_PRODUKTE.map((x) => [x.key, x.titel] as const), ["versicherung", "Zuschlag Versicherung"] as const, ["alterssicht", "Zuschlag Alterssichtprüfung"] as const].map(([k, t]) => (
                <div className="field" key={k}>
                  <label className="label" htmlFor={`preis_${k}`}>{t}</label>
                  <input className="input" id={`preis_${k}`} name={`preis_${k}`} inputMode="decimal" defaultValue={p[k] !== undefined ? String(p[k]).replace(".", ",") : ""} data-testid={`preis-${k}`} />
                </div>
              ))}
            </div>
            <div><button className="btn btn-primary" type="submit" data-testid="label-einstellungen-speichern">Speichern</button></div>
          </form>
        </section>
      )}
    </>
  );
}
