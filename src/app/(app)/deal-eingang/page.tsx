import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { AMPEL_EMOJI } from "@/lib/deal-eingang/logic";
import { eingaenge, quellen, STATUS_TEXT } from "@/lib/deal-eingang/service";
import { PushSchalter } from "@/components/push-schalter";
import { AutoRefresh } from "../lieferanten/finden/refresh";
import { einstellungenAction, eingangAction, profitPathAction } from "./actions";
import { getSettings } from "@/lib/settings";
import { budgetVerbraucht } from "@/lib/deal-eingang/kauf";
import { profitPathKonfig } from "@/lib/deal-eingang/profitpath";

// Deal-Eingang: Angebote aus WhatsApp & Co. einfügen bzw. teilen → KI erkennt → Deal-Ampel je Angebot.

const WEG = { manuell: "von Hand", teilen: "geteilt", kurzbefehl: "Kurzbefehl", mail: "Mail", claude: "Claude", profitpath: "ProfitPath", gruppe: "Gruppen-Chat" } as const;

export default async function DealEingangPage({ searchParams }: { searchParams: Promise<{ meldung?: string; quelle?: string; ampel?: string; status?: string }> }) {
  const session = await requireArea("dealeingang");
  const sp = await searchParams;
  const [liste, q, pp, st, verbraucht] = await Promise.all([eingaenge(session.tenantId, { quelle: sp.quelle, ampel: sp.ampel, status: sp.status, limit: 60 }), quellen(session.tenantId), profitPathKonfig(session.tenantId), getSettings(session.tenantId), budgetVerbraucht(session.tenantId)]);
  const de = st.dealEingang;
  const laeuft = liste.some((e) => e.pruefung === "offen" || e.pruefung === "laeuft");
  return (
    <>
      <AutoRefresh active={laeuft} />
      <div className="page-head">
        <div><div className="crumb">Einkauf</div><h1>Deal-Eingang</h1></div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <PushSchalter text="Deal-Push" />
          {pp && !session.readOnly && (
            <form action={profitPathAction}>
              <button className="btn" type="submit" data-testid="de-profitpath" title={`${pp.kanaele.length} ProfitPath-Kanal/Kanäle – sonst jede Minute automatisch`}>ProfitPath abrufen</button>
            </form>
          )}
          <Link className="btn" href="/deal-eingang/kurzbefehl">iPhone-Kurzbefehl &amp; Teilen</Link>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>{sp.meldung}</div>}
      {!session.readOnly && (
        <form action={eingangAction} className="card card-pad stack" style={{ gap: 8 }} data-testid="de-form">
          <textarea name="text" rows={4} placeholder="Nachricht aus WhatsApp einfügen (Text, mehrere Angebote möglich) …" style={{ width: "100%" }} />
          <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input type="file" name="datei" multiple accept="image/*,.pdf,.xlsx,.xls,.csv" />
            <input name="quelle" placeholder="Absender (optional, z. B. Konrad)" style={{ width: 220 }} />
            <button className="btn btn-primary" type="submit" data-testid="de-pruefen">Deal prüfen</button>
          </div>
          <div className="small muted">Screenshots und PDFs liest die KI. Tabellen (XLSX/CSV) und lange Listen gehen als Preisliste an den Preislisten-Scanner. Inhalte bleiben nur hier (nicht im Wissen) und werden nach der eingestellten Frist gelöscht.</div>
        </form>
      )}

      <section className="card card-pad" style={{ marginTop: 12 }} data-testid="de-liste">
        <div className="row small" style={{ gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          <Link href="/deal-eingang">alle</Link>
          {(["gruen", "gelb", "rot"] as const).map((a) => <Link key={a} href={`?ampel=${a}`}>{AMPEL_EMOJI[a]}</Link>)}
          <Link href="?status=neu">offen</Link>
        </div>
        {liste.length ? (
          <table className="table small">
            <tbody>
              {liste.map((e) => (
                <tr key={e.id} data-testid="de-eintrag" data-ampel={e.ampel ?? ""}>
                  <td style={{ whiteSpace: "nowrap" }}>{e.createdAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{e.ampel ? AMPEL_EMOJI[e.ampel] : e.pruefung === "fehler" ? "⚠️" : "⏳"}</td>
                  <td><Link href={`/deal-eingang/${e.id}`}>{e.pruefung === "fertig" ? (e.zusammenfassung ?? "–") : e.pruefung === "fehler" ? `Fehler: ${e.fehler ?? ""}` : "wird geprüft …"}</Link></td>
                  <td>{e.quelle ?? "–"}</td>
                  <td className="muted">{WEG[e.weg]} · {STATUS_TEXT[e.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="small muted">Noch keine Eingänge.</div>
        )}
      </section>

      {q.length > 0 && (
        <section className="card card-pad" style={{ marginTop: 12 }} data-testid="de-quellen">
          <h2 style={{ marginTop: 0 }}>Trefferquote je Absender bzw. ProfitPath-Modul</h2>
          <p className="small muted">ProfitPath: Was in Discord ankommt, hängt an den Alert-Einstellungen in ProfitPath (je Alarmgruppe ein Kanal), nicht an Presets/Filtern – dort nachschärfen, wenn ein Modul wenig Grün liefert.</p>
          <table className="table small">
            <thead><tr><th>Absender / Modul</th><th>gemeldet</th><th>Angebote</th><th>grün</th><th>gekauft</th><th>verworfen</th><th>Ø ROI (Prognose)</th><th>Ø ROI real</th></tr></thead>
            <tbody>
              {q.map((x) => (
                <tr key={x.quelle}><td><Link href={`?quelle=${encodeURIComponent(x.quelle)}`}>{x.quelle}</Link></td><td>{x.eingaenge}</td><td>{x.angebote}</td><td>{x.gruen}</td><td>{x.gekauft}</td><td>{x.verworfen}</td><td>{x.roiPrognose !== null ? `${x.roiPrognose} %` : "–"}</td><td title="Gewinn laut sellerboard je eingesetztem EK, ab 30 Tage nach dem Kauf">{x.roiReal !== null ? `${x.roiReal} % (${x.roiRealN})` : "–"}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card card-pad stack" style={{ marginTop: 12 }} data-testid="de-einstellungen">
        <h2 style={{ margin: 0 }}>Kaufen mit einem Tap: Budget und Deal-Wert</h2>
        <div className="small muted">
          Gekauft wird nie automatisch. Bei Grün (bzw. Deal-Wert ab {de.wertSchwelle}/100) kommt eine Meldung mit Direktlink, Menge, max. EK und Restbudget. Über der Budget-Grenze wird ein Deal höchstens Gelb. 0 = keine Grenze.
          {" "}Diese Woche gekauft: {verbraucht.woche.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}{de.budgetJeWoche ? ` von ${de.budgetJeWoche.toLocaleString("de-DE")} €` : ""}.
          {" "}<Link href="/deal-eingang/lernen">Wie gut liegt der Deal-Wert? →</Link>
        </div>
        {session.role === "owner" && !session.readOnly && (
          <form action={einstellungenAction} className="row small" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }} data-testid="de-einstellungen-form">
            <label className="field">Ziel-ROI %<input className="input" name="zielRoi" inputMode="numeric" defaultValue={de.zielRoi} style={{ width: 80 }} /></label>
            <label className="field">max. € je Deal<input className="input" name="budgetJeDeal" inputMode="numeric" defaultValue={de.budgetJeDeal || ""} placeholder="0" style={{ width: 100 }} /></label>
            <label className="field">je Tag<input className="input" name="budgetJeTag" inputMode="numeric" defaultValue={de.budgetJeTag || ""} placeholder="0" style={{ width: 100 }} /></label>
            <label className="field">je Woche<input className="input" name="budgetJeWoche" inputMode="numeric" defaultValue={de.budgetJeWoche || ""} placeholder="0" style={{ width: 100 }} /></label>
            <label className="field">Deal-Wert ab<input className="input" name="wertSchwelle" inputMode="numeric" defaultValue={de.wertSchwelle} style={{ width: 70 }} /></label>
            <button className="btn btn-small" type="submit">Speichern</button>
          </form>
        )}
      </section>
    </>
  );
}
