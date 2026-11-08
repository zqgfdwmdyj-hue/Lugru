import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { darfDrucken, PROTOKOLL_TAGE, VORLAGEN, WARTESCHLANGE_TAGE, type VorlageId } from "@/lib/druck/logic";
import { auftraege } from "@/lib/druck/service";
import { DruckerSymbol } from "@/components/drucker-symbol";
import { abbrechenAction, druckenAction, erneutAction, pruefenAction } from "./actions";

// Lager → Drucken: Vorlagen (62 mm → QL-800, 102 mm → QL-1100) mit Vorschau, Warteschlange (7 Tage) und
// Druckprotokoll (90 Tage). Gedruckt wird vom Druckagenten im Lager – auch vom Handy aus, auch unterwegs.

type SP = { vorlage?: string; druck?: string; tage?: string } & Record<string, string | undefined>;

const STATUS: Record<string, string> = { wartet: "wartet", abgeholt: "wird gedruckt", gedruckt: "gedruckt", fehler: "Fehler", abgelaufen: "abgelaufen", abgebrochen: "abgebrochen" };
const zeit = (d: Date | null) => (d ? new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d) : "–");

export default async function DruckenPage({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const auswahl = (Object.keys(VORLAGEN) as VorlageId[]).filter((v) => !["dhl", "kartonlabel", "fnsku_pdf"].includes(v) && darfDrucken(s, v));
  const vorlage = (auswahl.includes(sp.vorlage as VorlageId) ? sp.vorlage : auswahl[0]) as VorlageId | undefined;
  const v = vorlage ? VORLAGEN[vorlage] : null;
  const eingabe = Object.fromEntries(Object.entries(sp).filter(([k, x]) => k.startsWith("e_") && typeof x === "string")) as Record<string, string>;
  const tage = sp.tage === String(PROTOKOLL_TAGE) ? PROTOKOLL_TAGE : WARTESCHLANGE_TAGE;
  const liste = await auftraege(s.tenantId, tage);
  const vorschauUrl = v ? `/api/drucken/vorschau?${new URLSearchParams({ vorlage: v.id, ...eingabe }).toString()}` : null;
  const pflichtDa = v ? v.felder.every((f) => !f.pflicht || (eingabe[`e_${f.name}`] ?? "").trim()) : false;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Drucken</h1>
          <p className="small muted" style={{ margin: 0 }}>Aufträge gehen an den Druckagenten im Lager und bleiben {WARTESCHLANGE_TAGE} Tage in der Warteschlange, bis der Drucker bereit ist.</p>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <DruckerSymbol tenantId={s.tenantId} modell="QL-800" />
          <DruckerSymbol tenantId={s.tenantId} modell="QL-1100" />
        </div>
      </div>
      {sp.druck && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }} data-testid="druck-meldung">{sp.druck}</div>}
      <div className="row small" style={{ gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <Link href="/drucken/datei">📄 PDF drucken (Kartonlabels, FNSKU-Bogen, DHL)</Link>
        <Link href="/lager/scannen">🔫 Scanner-Arbeitsplatz</Link>
        {s.role === "owner" && <Link href="/einstellungen/drucker">⚙️ Drucker & Agent</Link>}
      </div>

      {v && (
        <section className="card card-pad stack" data-testid="druck-vorlage">
          <form method="get" className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "end" }}>
            <label className="small">Vorlage{" "}
              <select className="input" name="vorlage" defaultValue={v.id} data-testid="druck-vorlage-wahl">
                {auswahl.map((id) => <option key={id} value={id}>{VORLAGEN[id].text} · {VORLAGEN[id].drucker}</option>)}
              </select>
            </label>
            {v.felder.map((f) => (
              <label key={f.name} className="small">{f.text}{f.pflicht ? " *" : ""}{" "}
                <input className="input" name={`e_${f.name}`} defaultValue={eingabe[`e_${f.name}`] ?? ""} style={{ width: 170 }} data-testid={`druck-feld-${f.name}`} />
              </label>
            ))}
            <button className="btn btn-sm" type="submit" data-testid="druck-vorschau-los">Vorschau</button>
          </form>
          {pflichtDa && vorschauUrl && (
            <div className="row" style={{ gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={vorschauUrl} alt="Vorschau" data-testid="druck-vorschau" style={{ maxWidth: 360, border: "1px solid var(--border)", background: "#fff" }} />
              <form action={druckenAction} className="row" style={{ gap: 8, alignItems: "center" }}>
                <input type="hidden" name="vorlage" value={v.id} />
                <input type="hidden" name="zurueck" value={`/drucken?vorlage=${v.id}`} />
                {Object.entries(eingabe).map(([k, x]) => <input key={k} type="hidden" name={k} value={x} />)}
                <input className="input" name="anzahl" type="number" min={1} max={500} defaultValue={1} style={{ width: 70 }} aria-label="Anzahl" data-testid="druck-anzahl" />
                <button className="btn btn-primary" type="submit" data-testid="druck-los">🖨 Drucken ({v.drucker})</button>
              </form>
            </div>
          )}
        </section>
      )}

      <section className="card" style={{ marginTop: 12, overflow: "auto" }}>
        <div className="card-pad row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <strong>{tage === PROTOKOLL_TAGE ? `Druckprotokoll (${PROTOKOLL_TAGE} Tage)` : `Warteschlange (${WARTESCHLANGE_TAGE} Tage)`}</strong>
          <span className="row small" style={{ gap: 10 }}>
            {s.role === "owner" && !s.readOnly && (
              <form action={pruefenAction}>
                <button className="btn btn-sm" data-testid="druck-pruefen" title="Wartende Aufträge prüfen (läuft sonst alle 2 Minuten im Hintergrund)">Wartende prüfen</button>
              </form>
            )}
            <Link href={tage === PROTOKOLL_TAGE ? "/drucken" : `/drucken?tage=${PROTOKOLL_TAGE}`}>{tage === PROTOKOLL_TAGE ? "nur 7 Tage" : `Protokoll ${PROTOKOLL_TAGE} Tage`}</Link>
          </span>
        </div>
        {liste.length ? (
          <table className="table small" data-testid="druck-liste">
            <thead><tr><th>Zeit</th><th>Was</th><th>Drucker</th><th className="right">Anzahl</th><th>Von</th><th>Seite</th><th>Status</th><th /></tr></thead>
            <tbody>
              {liste.map((j) => (
                <tr key={j.id} data-testid="druck-auftrag" data-status={j.status} data-id={j.id}>
                  <td>{zeit(j.createdAt)}</td>
                  <td>{j.titel}{j.seiten > 1 ? <div className="muted">{j.seiten} Etiketten je Satz</div> : null}{j.erneutVon ? <div className="muted">erneut gedruckt</div> : null}</td>
                  <td>{j.drucker}<div className="muted">{j.agent ?? ""}</div></td>
                  <td className="right">{j.anzahl}</td>
                  <td>{j.von ?? j.vonMail ?? "–"}</td>
                  <td className="muted">{j.seite ?? "–"}</td>
                  <td data-testid="druck-status">{STATUS[j.status] ?? j.status}{j.gedrucktAm ? <div className="muted">{zeit(j.gedrucktAm)}</div> : null}{j.meldung ? <div className="muted">{j.meldung}</div> : null}</td>
                  <td>
                    <span className="row" style={{ gap: 4 }}>
                      <a className="btn btn-sm" href={`/api/drucken/vorschau?auftrag=${j.id}`} target="_blank" rel="noreferrer">Vorschau</a>
                      {darfDrucken(s, j.vorlage as VorlageId) && <form action={erneutAction}><input type="hidden" name="id" value={j.id} /><button className="btn btn-sm" type="submit" data-testid="druck-erneut">erneut drucken</button></form>}
                      {(j.status === "wartet" || j.status === "abgeholt") && !s.readOnly && <form action={abbrechenAction}><input type="hidden" name="id" value={j.id} /><button className="btn btn-sm" type="submit" data-testid="druck-abbrechen">abbrechen</button></form>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="card-pad small muted" data-testid="druck-leer">Keine Aufträge.</div>
        )}
      </section>
    </>
  );
}
