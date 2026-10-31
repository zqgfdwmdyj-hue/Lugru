import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { mobilProtokollListe, mobilTokens } from "@/lib/mobil/token";
import { publicUrl } from "@/lib/public-url";
import { ART_TEXT, type SchnellArt } from "@/lib/schnell/logic";
import { eingangsliste } from "@/lib/schnell/service";
import { bestaetigenAction, mobilTokenWiderrufenAction, verwerfenAction } from "./actions";
import { ErfassenForm, SchluesselForm } from "./formulare";

// Schnellerfassung per Sprache (Modul 11): Eingangsliste (nur eigene Diktate) und Handy-Schlüssel.

const WAHL: SchnellArt[] = ["aufgabe", "termin", "notiz", "einkauf", "privat_aufgabe", "privat_termin"];
const zeit = (d: Date) => d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });

export default async function SchnellPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const [liste, schluessel, protokoll] = await Promise.all([eingangsliste(session), mobilTokens(session.tenantId, session.userId), mobilProtokollListe(session.tenantId, session.userId, 10)]);
  const privat = session.privateAccess && session.privateScope === "voll";
  const wahl = WAHL.filter((a) => privat || !a.startsWith("privat_"));
  const offen = liste.filter((e) => e.status === "offen");
  const basis = publicUrl() ?? "";
  return (
    <>
      <div className="page-head"><div><div className="crumb">Heute</div><h1>Schnellerfassung</h1></div></div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }} data-testid="schnell-meldung">{sp.meldung}</div>}
      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }} className="stack">
          <section className="card card-pad"><ErfassenForm /></section>
          <section className="card card-pad stack" data-testid="schnell-offen">
            <h2 style={{ margin: 0 }}>Zur Bestätigung ({offen.length})</h2>
            {offen.length === 0 && <div className="small muted">Nichts offen.</div>}
            {offen.map((e) => {
              const o = e.daten.einordnung;
              return (
                <div key={e.id} className="card card-pad stack" style={{ gap: 6 }} data-testid="schnell-eintrag">
                  <div>„{e.daten.text}“</div>
                  <div className="small muted">{zeit(e.createdAt)} · Vorschlag: {ART_TEXT[o.art as SchnellArt] ?? o.art} – {o.grund}</div>
                  <form action={bestaetigenAction} className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <input type="hidden" name="id" value={e.id} />
                    <select className="input" name="art" defaultValue={wahl.includes(o.art as SchnellArt) ? o.art : "aufgabe"} aria-label="Art" style={{ width: 170 }}>
                      {wahl.map((a) => <option key={a} value={a}>{ART_TEXT[a]}</option>)}
                    </select>
                    <input className="input" name="titel" defaultValue={o.titel} aria-label="Titel" style={{ minWidth: 200, flexGrow: 1 }} />
                    <input className="input" type="date" name="tag" defaultValue={o.tag ?? ""} aria-label="Tag" style={{ width: 150 }} />
                    <input className="input" type="time" name="uhrzeit" defaultValue={o.uhrzeit ?? ""} aria-label="Uhrzeit" style={{ width: 110 }} />
                    <button className="btn btn-small btn-primary" type="submit">Anlegen</button>
                  </form>
                  <form action={verwerfenAction}><input type="hidden" name="id" value={e.id} /><button className="btn-link small" type="submit">verwerfen</button></form>
                </div>
              );
            })}
          </section>
          <section className="card" style={{ overflow: "auto" }}>
            <table className="table small" data-testid="schnell-erledigt">
              <thead><tr><th>Wann</th><th>Diktat</th><th>Ergebnis</th></tr></thead>
              <tbody>
                {liste.filter((e) => e.status !== "offen").slice(0, 20).map((e) => (
                  <tr key={e.id}><td className="num">{zeit(e.createdAt)}</td><td>{e.daten.text}</td><td>{e.status === "verworfen" ? "verworfen" : (e.daten.ergebnis ?? ART_TEXT[(e.art ?? "unklar") as SchnellArt])}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
        <aside className="col-side">
          <section className="card card-pad stack small" data-testid="mobil-schluessel">
            <h2 style={{ margin: 0 }}>iPhone: „Hey Siri, Seller-System“</h2>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              <li>Unten einen Schlüssel für dieses Handy erzeugen und kopieren.</li>
              <li>Kurzbefehle → „+“ → Name „Seller-System“. Aktion „Diktieren“.</li>
              <li>Aktion „Inhalte von URL abrufen“: <code>{basis || "https://<deine Adresse>"}/api/mobil/erfassen</code>, POST, Header <code>Authorization</code> = <code>Bearer &lt;Schlüssel&gt;</code>, JSON-Feld <code>text</code> = diktierter Text.</li>
              <li>Aktion „Text sprechen“ mit dem Feld <code>antwort</code> aus dem Ergebnis.</li>
            </ol>
            <div className="muted" data-testid="schnell-deal-pruefen">Deals aus WhatsApp prüfen (Kurzbefehl „Deal prüfen“, eigener dk_-Schlüssel): <Link href="/deal-eingang/kurzbefehl">Anleitung</Link>.</div>
            <SchluesselForm />
            {schluessel.length > 0 && (
              <table className="table small">
                <thead><tr><th>Gerät</th><th>Schlüssel</th><th>zuletzt</th><th /></tr></thead>
                <tbody>
                  {schluessel.map((t) => (
                    <tr key={t.id} data-testid="mobil-token">
                      <td>{t.name}</td><td>{t.anfang}…</td>
                      <td>{t.revokedAt ? "widerrufen" : t.lastUsedAt ? zeit(t.lastUsedAt) : "noch nie"}</td>
                      <td>{!t.revokedAt && <form action={mobilTokenWiderrufenAction}><input type="hidden" name="id" value={t.id} /><button className="btn-link small" type="submit">widerrufen</button></form>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="muted">Je Gerät ein Schlüssel, widerrufbar. Höchstens 30 Aufrufe in 10 Minuten. Angelegt wird mit deinen Rechten; Privates nur mit Privat-Zugang, Privat-Zeiten immer zur Bestätigung.</div>
            {protokoll.length > 0 && <div className="muted">Letzte Aufrufe: {protokoll.map((p) => `${zeit(p.createdAt)} ${p.endpunkt} (${p.status})`).join(" · ")}</div>}
          </section>
        </aside>
      </div>
    </>
  );
}
