import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { getIntegration } from "@/lib/integrations/store";
import { getSettings } from "@/lib/settings";
import { handySpeichern, teslaTest, testSms } from "./actions";

// Handy & Tesla (B13): Orte für Briefing/Fahrtenbuch, Fahrzeit, SMS (nur eigene Nummer), Verspätung, Fahrzeug.

export default async function HandyPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const s = (await getSettings(session.tenantId)).mobil;
  const owner = session.role === "owner" && !session.readOnly;
  const [tesla, twilio] = await Promise.all([getIntegration(session.tenantId, "tesla"), getIntegration(session.tenantId, "twilio")]);
  const sms = owner ? await db.select().from(schema.smsMeldungen).where(eq(schema.smsMeldungen.tenantId, session.tenantId)).orderBy(desc(schema.smsMeldungen.createdAt)).limit(15) : [];
  return (
    <>
      <div className="page-head"><div><div className="crumb"><Link href="/einstellungen">Einstellungen</Link></div><h1>Handy & Tesla</h1></div></div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }} data-testid="handy-meldung">{sp.meldung}</div>}
      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }} className="stack">
          {!owner && <div className="notice notice-info small">Nur der Inhaber kann das einstellen.</div>}
          <form action={handySpeichern} className="card card-pad stack" style={{ gap: 10 }} data-testid="handy-form">
            <h2 style={{ margin: 0 }}>Orte (Ziel-Erkennung)</h2>
            <div className="grid-2" style={{ gap: 8 }}>
              <div className="field"><label className="label" htmlFor="h-lager">Lager (eine Adresse je Zeile)</label><textarea className="input" id="h-lager" name="lager" rows={2} defaultValue={s.orte.lager.join("\n")} disabled={!owner} /></div>
              <div className="field"><label className="label" htmlFor="h-prep">Prep Center</label><textarea className="input" id="h-prep" name="prep" rows={2} defaultValue={s.orte.prep.join("\n")} disabled={!owner} /></div>
              <div className="field"><label className="label" htmlFor="h-pal">Palettenlager</label><textarea className="input" id="h-pal" name="palettenlager" rows={2} defaultValue={s.orte.palettenlager.join("\n")} disabled={!owner} /></div>
              <div className="field"><label className="label" htmlFor="h-home">Zuhause (nur als Ort, wird nicht ausgewertet)</label><input className="input" id="h-home" name="zuhause" defaultValue={s.orte.zuhause} disabled={!owner} /></div>
            </div>
            <div className="small muted">Lieferanten-Adressen und -Telefon stehen im Lieferanten-Profil.</div>
            <h2 style={{ margin: "8px 0 0" }}>Fahrzeit und Anrufe</h2>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <div className="field"><label className="label" htmlFor="h-fz">Fahrzeit vor Terminen mit Ort (Min.)</label><input className="input" id="h-fz" name="fahrzeitMin" type="number" min={0} max={180} defaultValue={s.fahrzeitMin} disabled={!owner} /></div>
              <div className="field"><label className="label" htmlFor="h-ja">Minuten je Anruf</label><input className="input" id="h-ja" name="jeAnrufMin" type="number" min={1} max={60} defaultValue={s.jeAnrufMin} disabled={!owner} /></div>
              <div className="field"><label className="label" htmlFor="h-tol">Verspätung ab … Min. (Entwurf)</label><input className="input" id="h-tol" name="toleranz" type="number" min={0} max={120} defaultValue={s.verspaetungToleranz} disabled={!owner} /></div>
            </div>
            <h2 style={{ margin: "8px 0 0" }}>SMS (nur an deine Nummer)</h2>
            <label className="small"><input type="checkbox" name="smsAn" defaultChecked={s.sms.an} disabled={!owner} /> Wichtiges als SMS (Konto/Angebot deaktiviert, Frist morgen, grüner Deal über Schwelle, VA-Rückfrage zu wichtiger Aufgabe)</label>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <div className="field"><label className="label" htmlFor="h-nr">Handynummer</label><input className="input" id="h-nr" name="nummer" placeholder="+49…" defaultValue={s.sms.nummer} disabled={!owner} /></div>
              <div className="field"><label className="label" htmlFor="h-lim">Höchstens je Tag</label><input className="input" id="h-lim" name="limit" type="number" min={1} max={50} defaultValue={s.sms.limit} disabled={!owner} /></div>
              <div className="field"><label className="label" htmlFor="h-rv">Ruhe von</label><input className="input" id="h-rv" name="ruheVon" type="time" defaultValue={s.sms.ruheVon} disabled={!owner} /></div>
              <div className="field"><label className="label" htmlFor="h-rb">bis</label><input className="input" id="h-rb" name="ruheBis" type="time" defaultValue={s.sms.ruheBis} disabled={!owner} /></div>
              <div className="field"><label className="label" htmlFor="h-ds">Deal-Schwelle (€ Gewinn)</label><input className="input" id="h-ds" name="dealSchwelle" type="number" min={0} defaultValue={s.sms.dealSchwelle} disabled={!owner} /></div>
            </div>
            <div className="small muted">In Familienzeit (Tagesplan) und Ruhezeit nur rote Konto-Themen. Antworten: VA / SPÄTER / OK / KAUFEN n – „KAUFEN“ legt nur einen Einkaufsentwurf an.</div>
            <h2 style={{ margin: "8px 0 0" }}>Tesla</h2>
            <div className="field"><label className="label" htmlFor="h-vin">Fahrgestellnummer (VIN)</label><input className="input" id="h-vin" name="vin" defaultValue={s.tesla.vin} disabled={!owner} /></div>
            <div className="small muted">Tokens stehen nur in der Anbindung (Anbindungen → Tesla), nie hier. Kein Laden; Klima nur auf Knopfdruck.</div>
            {owner && <div><button className="btn btn-primary btn-small" type="submit">Speichern</button></div>}
          </form>
        </div>
        <aside className="col-side stack">
          <section className="card card-pad small stack" style={{ gap: 6 }}>
            <div>Tesla: <strong>{tesla?.accessToken ? "verbunden" : "nicht verbunden"}</strong> · SMS: <strong>{twilio?.accountSid ? (s.sms.an ? "an" : "eingerichtet, aus") : "nicht eingerichtet"}</strong></div>
            {owner && <form action={teslaTest}><button className="btn btn-small" type="submit">Tesla prüfen</button></form>}
            {owner && <form action={testSms}><button className="btn btn-small" type="submit">Test-SMS senden</button></form>}
            <Link href="/schnell">Handy-Schlüssel (Kurzbefehle, Widget)</Link>
            <Link href="/kalender/fahrten">Fahrtenbuch</Link>
            <Link href="/scan">Scan mit Ampel</Link>
          </section>
          {sms.length > 0 && (
            <section className="card card-pad small" data-testid="sms-liste">
              <strong>Letzte SMS</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {sms.map((m) => <li key={m.id}>[{m.ref}] {m.status}{m.grund ? ` (${m.grund})` : ""}{m.ergebnis ? ` → ${m.ergebnis}` : ""}</li>)}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
