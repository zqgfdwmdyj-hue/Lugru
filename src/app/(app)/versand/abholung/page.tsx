import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { getIntegration } from "@/lib/integrations/store";
import { getSettings } from "@/lib/settings";
import { ConfirmButton } from "@/components/confirm-button";
import { abholungenListe, labelsBereit } from "@/lib/abholung/service";
import { berlinHeute, datumText, DHL_ART, DIENST_NAME, naechsterAbholtag, ortAdresse, ortFinden, zeitNorm, type AbholDienst } from "@/lib/abholung/logic";
import { abholungBuchenAction, abholungStornierenAction, abholVorschlagPruefenAction } from "./actions";

// Versand → Abholung (Bauauftrag Abholung DHL/UPS): Inhaber und alle mit „Service“ (auch die VA) buchen und stornieren;
// Felder kommen aus den Stammdaten (Einstellungen → Abholung), je Buchung nur Datum, Fenster und Paketzahl.
// UPS in drei Klicks: Seite öffnen → „UPS“ → „Abholung buchen“.

const STATUS: Record<string, { text: string; tag: string }> = {
  gebucht: { text: "gebucht", tag: "tag-ok" },
  angefragt: { text: "angefragt", tag: "tag-warn" },
  storniert: { text: "storniert", tag: "tag-neutral" },
  fehler: { text: "nicht gebucht", tag: "tag-critical" },
};
const QUELLE: Record<string, string> = { seite: "Seite", claude: "Claude", vorschlag: "Vorschlag" };
const zeit = (d: Date) => d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

type Sp = { dienst?: string; datum?: string; pakete?: string; ort?: string; vorschlag?: string; meldung?: string; fehler?: string };

export default async function AbholungPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const s = await requireArea("service");
  const sp = await searchParams;
  const inhaber = s.role === "owner" && !s.readOnly;
  const dienst: AbholDienst = sp.dienst === "ups" ? "ups" : "dhl";
  const settings = await getSettings(s.tenantId);
  const orte = settings.abholung.orte;
  const [liste, bereit, dhlZugang, upsZugang] = await Promise.all([abholungenListe(s.tenantId), labelsBereit(s.tenantId, dienst), getIntegration(s.tenantId, "dhl"), getIntegration(s.tenantId, "ups")]);
  const ort = ortFinden(orte, sp.ort) ?? ortFinden(orte, null) ?? orte[0] ?? null;
  const heute = berlinHeute();
  const tag = sp.datum && /^\d{4}-\d{2}-\d{2}$/.test(sp.datum) ? sp.datum : naechsterAbholtag(dienst);
  const pakete = sp.pakete && /^\d{1,3}$/.test(sp.pakete) ? sp.pakete : bereit > 0 ? String(bereit) : "";
  const zugang = dienst === "dhl" ? Boolean(dhlZugang?.apiKey && dhlZugang.username) : Boolean(upsZugang?.clientId);
  const vorschlag = sp.vorschlag === "1" && ort && pakete;
  const offen = liste.filter((a) => (a.status === "gebucht" || a.status === "angefragt") && a.datum >= heute);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/auftraege">Aufträge & Versand</Link></div>
          <h1>Abholung DHL/UPS</h1>
          <div className="small muted">Abholung beim Paketdienst buchen – Adresse, Ansprechpartner und Kundennummer kommen aus den Stammdaten. Auch per Claude: „DHL-Abholung morgen 10 bis 12 Uhr, 15 Pakete“.</div>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }} data-testid="abholung-meldung">{sp.meldung}</div>}
      {sp.fehler && <div className="notice notice-error small" role="alert" style={{ marginBottom: 12 }} data-testid="abholung-fehler">{sp.fehler}</div>}

      {!orte.length ? (
        <div className="notice notice-info small" data-testid="abholung-keine-orte">
          Noch kein Abholort hinterlegt. {inhaber ? <Link href="/einstellungen/abholung">Einstellungen → Abholung</Link> : "Der Inhaber trägt die Abholorte unter Einstellungen → Abholung ein."}
        </div>
      ) : s.readOnly ? (
        <div className="notice notice-info small">Nur ansehen – Abholungen buchen geht mit diesem Zugang nicht.</div>
      ) : (
        <>
          {vorschlag && (
            <form action={abholungBuchenAction} className="card card-pad stack" style={{ gap: 8, marginBottom: 16, borderLeft: "4px solid var(--warn, #d97706)" }} data-testid="abholung-vorschlag">
              <strong>Vorschlag: {DIENST_NAME[dienst]}-Abholung am {datumText(tag)}{ort.von && ort.bis ? `, ${zeitNorm(ort.von)}–${zeitNorm(ort.bis)} Uhr` : ""}, {pakete} Pakete – {ort.name}</strong>
              <span className="small muted">Wird nicht automatisch gebucht. Ein Klick bucht genau das.</span>
              <input type="hidden" name="dienst" value={dienst} />
              <input type="hidden" name="datum" value={tag} />
              <input type="hidden" name="pakete" value={pakete} />
              <input type="hidden" name="ort" value={ort.key} />
              <input type="hidden" name="quelle" value="vorschlag" />
              <div><button type="submit" className="btn btn-primary" data-testid="abholung-vorschlag-buchen">Jetzt buchen</button></div>
            </form>
          )}
          <form action={abholungBuchenAction} className="card card-pad stack" style={{ gap: 12 }} data-testid="abholung-formular" key={`${dienst}-${tag}-${ort?.key}`}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="tablist" aria-label="Paketdienst">
              {(["dhl", "ups"] as const).map((d) => (
                <Link key={d} href={`/versand/abholung?dienst=${d}${ort ? `&ort=${encodeURIComponent(ort.key)}` : ""}`} className={`btn ${d === dienst ? "btn-primary" : ""}`} role="tab" aria-selected={d === dienst} data-testid={`abholung-dienst-${d}`}>
                  {DIENST_NAME[d]}
                </Link>
              ))}
            </div>
            <input type="hidden" name="dienst" value={dienst} />
            {!zugang && (
              <div className="notice notice-warn small" data-testid="abholung-kein-zugang">
                {DIENST_NAME[dienst]}-Zugang fehlt – {inhaber ? <Link href="/anbindungen">Anbindungen</Link> : "der Inhaber hinterlegt ihn unter Anbindungen"} ({dienst === "dhl" ? "DHL Geschäftskunden mit „Parcel DE Pickup“" : "UPS: Client-ID, Secret, Kontonummer"}).
              </div>
            )}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className="field">
                <label className="label" htmlFor="ab-ort">Abholort</label>
                <select className="select" id="ab-ort" name="ort" defaultValue={ort?.key} data-testid="abholung-ort">
                  {orte.map((o) => <option key={o.key} value={o.key}>{o.name} – {o.plz} {o.ort}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="ab-datum">Datum</label>
                <input className="input" id="ab-datum" name="datum" type="date" min={heute} defaultValue={tag} required data-testid="abholung-datum" />
              </div>
              <div className="field">
                <label className="label" htmlFor="ab-von">{dienst === "ups" ? "Bereit ab" : "Fenster von"}</label>
                <input className="input" id="ab-von" name="von" type="time" defaultValue={zeitNorm(ort?.von) ?? ""} required={dienst === "ups"} style={{ width: 120 }} />
              </div>
              <div className="field">
                <label className="label" htmlFor="ab-bis">{dienst === "ups" ? "Spätestens bis" : "bis"}</label>
                <input className="input" id="ab-bis" name="bis" type="time" defaultValue={zeitNorm(ort?.bis) ?? ""} required={dienst === "ups"} style={{ width: 120 }} />
              </div>
              <div className="field">
                <label className="label" htmlFor="ab-pakete">Pakete</label>
                <input className="input" id="ab-pakete" name="pakete" type="number" min={0} max={999} defaultValue={pakete} required style={{ width: 90 }} data-testid="abholung-pakete" />
              </div>
            </div>
            <details>
              <summary className="small">Paletten, Gewicht, Hinweis für den Fahrer</summary>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
                <div className="field"><label className="label" htmlFor="ab-pal">Paletten</label><input className="input" id="ab-pal" name="paletten" type="number" min={0} max={99} defaultValue={0} style={{ width: 90 }} /></div>
                <div className="field"><label className="label" htmlFor="ab-kg">Gesamtgewicht</label><div style={{ display: "flex", gap: 6, alignItems: "center" }}><input className="input" id="ab-kg" name="gewicht" inputMode="decimal" style={{ width: 90 }} /><span className="small muted">kg</span></div></div>
                <div className="field" style={{ flexGrow: 1, minWidth: 220 }}><label className="label" htmlFor="ab-hinweis">Hinweis (sonst der hinterlegte)</label><input className="input" id="ab-hinweis" name="hinweis" maxLength={100} placeholder={ort?.hinweis ?? ""} /></div>
              </div>
            </details>
            <div className="small muted">
              {bereit > 0 ? `${bereit} ${DIENST_NAME[dienst]}-Label${bereit === 1 ? "" : "s"} ${dienst === "ups" ? "bereit" : "heute erstellt"}. ` : ""}
              {dienst === "dhl" ? "DHL bucht keine feste Uhrzeit – das Fenster geht als Öffnungszeit mit; über 10 Pakete ist es eine Anfrage mit Bestätigung per Mail." : "UPS: Werktage Mo–Fr; die Abholnummer (PRN) wird gespeichert."}
            </div>
            <div><button type="submit" className="btn btn-primary" data-testid="abholung-buchen">Abholung buchen</button></div>
          </form>
        </>
      )}

      {offen.length > 0 && (
        <section className="card card-pad stack" style={{ gap: 6, marginTop: 16 }} data-testid="abholung-offen">
          <h2 style={{ margin: 0 }}>Kommende Abholungen</h2>
          {offen.map((a) => (
            <div key={a.id} className="small" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }} data-testid="abholung-offen-zeile">
              <span className={`tag ${STATUS[a.status]?.tag ?? ""}`}>{STATUS[a.status]?.text ?? a.status}</span>
              <strong>{DIENST_NAME[a.dienst]} {datumText(a.datum)}</strong>
              <span>{a.zeitVon && a.zeitBis ? `${a.zeitVon}–${a.zeitBis} · ` : ""}{a.pakete} Pakete{a.paletten ? ` + ${a.paletten} Paletten` : ""} · {a.ortName}</span>
              <span className="muted">Nr. {a.bestaetigung}</span>
            </div>
          ))}
        </section>
      )}

      <section className="card card-pad stack" style={{ gap: 6, marginTop: 16 }} data-testid="abholung-protokoll">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, flexGrow: 1 }}>Protokoll</h2>
          {!s.readOnly && orte.length > 0 && (
            <form action={abholVorschlagPruefenAction}>
              <button type="submit" className="btn btn-small" data-testid="abholung-vorschlag-pruefen" title={`Abends automatisch: mehr als ${settings.abholung.vorschlagAb} Labels und nichts gebucht → Aufgabe mit Push`}>Vorschlag jetzt prüfen</button>
            </form>
          )}
        </div>
        {liste.length ? (
          <div className="table-wrap">
            <table className="table small">
              <thead>
                <tr><th>Dienst</th><th>Datum</th><th>Fenster</th><th>Pakete</th><th>Abholort</th><th>Status</th><th>Bestätigung</th><th>Gebucht</th><th></th></tr>
              </thead>
              <tbody>
                {liste.map((a) => (
                  <tr key={a.id} data-testid="abholung-zeile" data-status={a.status}>
                    <td>{DIENST_NAME[a.dienst]}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{datumText(a.datum)}</td>
                    <td>{a.zeitVon && a.zeitBis ? `${a.zeitVon}–${a.zeitBis}` : "–"}</td>
                    <td>{a.pakete}{a.paletten ? ` + ${a.paletten} Pal.` : ""}</td>
                    <td>{a.ortName}</td>
                    <td>
                      <span className={`tag ${STATUS[a.status]?.tag ?? ""}`}>{STATUS[a.status]?.text ?? a.status}</span>
                      {a.abholArt && <div className="muted">{DHL_ART[a.abholArt] ?? a.abholArt}{a.kostenpflichtig ? " · kostenpflichtig" : ""}</div>}
                      {a.fehler && <div className="muted" style={{ maxWidth: 320 }}>{a.fehler}</div>}
                      {a.storniertAm && <div className="muted">storniert {zeit(a.storniertAm)}{a.storniertVonName ? ` von ${a.storniertVonName}` : ""}</div>}
                    </td>
                    <td data-testid="abholung-bestaetigung" style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{a.bestaetigung ?? "–"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{zeit(a.createdAt)}<div className="muted">{a.gebuchtVonName ?? "–"} · {QUELLE[a.quelle] ?? a.quelle}</div></td>
                    <td>
                      {!s.readOnly && (a.status === "gebucht" || a.status === "angefragt") && a.datum >= heute && (
                        <form action={abholungStornierenAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <ConfirmButton confirm={`${DIENST_NAME[a.dienst]}-Abholung am ${datumText(a.datum)} wirklich stornieren?`} testid="abholung-stornieren">Stornieren</ConfirmButton>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="small muted">Noch keine Abholungen.</div>
        )}
      </section>

      {orte.length > 0 && (
        <div className="small muted" style={{ marginTop: 12 }}>
          Abholorte: {orte.map((o) => ortAdresse(o)).join(" · ")}. {inhaber ? <Link href="/einstellungen/abholung">Abholorte bearbeiten</Link> : "Stammdaten pflegt der Inhaber."}
        </div>
      )}
    </>
  );
}
