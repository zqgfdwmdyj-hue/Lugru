import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { mobilTokens } from "@/lib/mobil/token";
import { publicUrl } from "@/lib/public-url";
import { befehlText, watchFrage } from "@/lib/mobil/watch-frage";

// Apple Watch: Einrichtung an einer Stelle – ein Kurzbefehl für alles („Hey Siri, Seller“), die Befehle im Überblick
// und „Ausprobieren“ (zeigt die Antwort genau so, wie sie auf der Uhr steht; ändernde Befehle laufen hier nicht).

const BEFEHLE: { sag: string; macht: string; aendert?: boolean }[] = [
  { sag: "Wie läuft's?", macht: "Umsatz heute, Monat, Gewinn; rote Fälle; nächster Termin" },
  { sag: "Was ist dringend?", macht: "die 3 wichtigsten Punkte wie „Jetzt dringend“ auf der Startseite" },
  { sag: "Erledigt", macht: "schließt die zuletzt per Push gemeldete Aufgabe; bei mehreren: „Welche? 1 … 2 …“ → „Nummer 2“", aendert: true },
  { sag: "Notiz Rechnung Tefal prüfen", macht: "Aufgabe für dich (Datum aus dem Diktat)", aendert: true },
  { sag: "Notiz VA bitte Rechnung prüfen", macht: "Nachricht an die VA auf Englisch – erst nach deiner Freigabe (Team & Verwaltung → VA & Delegation)", aendert: true },
  { sag: "Bestand Tefal 12 Stück", macht: "setzt die gezählte Menge im eigenen Lager (ohne Zahl: nur nachsehen)", aendert: true },
  { sag: "Deal B0… für 19,99", macht: "Deal-Ampel in einer Zeile (ROI, Gewinn je Stück, Empfehlung)" },
  { sag: "Tesla", macht: "Ladestand, Reichweite, Klima (nur lesen)" },
  { sag: "Kaufen 17", macht: "öffnet den Warenkorb von Deal 17 auf dem iPhone – kaufen tippst du selbst", aendert: true },
];

export default async function WatchPage({ searchParams }: { searchParams: Promise<{ probe?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const basis = publicUrl() ?? "";
  const url = `${basis || "https://<deine Adresse>"}/api/mobil/watch/frage`;
  const schluessel = (await mobilTokens(session.tenantId, session.userId)).filter((t) => !t.revokedAt);
  const probe = (sp.probe ?? "").trim().slice(0, 300);
  const antwort = probe ? await watchFrage(session, probe, { aendernErlaubt: false }) : null;
  return (
    <>
      <div className="page-head"><div><div className="crumb"><Link href="/einstellungen">Einstellungen</Link> · <Link href="/einstellungen/handy">Handy & Tesla</Link></div><h1>Apple Watch</h1></div></div>
      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }} className="stack">
          <section className="card card-pad stack" style={{ gap: 8 }} data-testid="watch-status">
            <h2 style={{ margin: 0 }}>So funktioniert es</h2>
            <div className="small">An der Uhr sagst du <strong>„Hey Siri, Seller“</strong>, dann deinen Befehl. Die Antwort steht in höchstens 3 Zeilen auf dem Display und wird vorgelesen. Das läuft über die App <strong>Kurzbefehle</strong> von Apple (auf iPhone und Watch schon installiert) – eine eigene App aus dem App Store braucht es dafür nicht.</div>
            <div className="small">
              Handy-Schlüssel: {schluessel.length ? <strong data-testid="watch-schluessel-ok">{schluessel.length} aktiv ({schluessel.map((s) => s.name).join(", ")})</strong> : <strong data-testid="watch-schluessel-fehlt" style={{ color: "var(--warn)" }}>noch keiner</strong>} · <Link href="/schnell">Schlüssel erstellen / verwalten</Link>
            </div>
          </section>

          <section className="card card-pad stack" style={{ gap: 8 }} data-testid="watch-anleitung">
            <h2 style={{ margin: 0 }}>Einrichten (einmal, ca. 5 Minuten am iPhone)</h2>
            <ol className="small" style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
              <li>Oben unter <Link href="/schnell">Schnellerfassung</Link> einen <strong>Handy-Schlüssel</strong> erstellen und kopieren (beginnt mit <code>mk_</code>).</li>
              <li>iPhone → App <strong>Kurzbefehle</strong> → <strong>+</strong> → Name <strong>„Seller“</strong>.</li>
              <li>Aktion <strong>„Text diktieren“</strong> (Sprache Deutsch, „Nach Pause beenden“).</li>
              <li>Aktion <strong>„Inhalte von URL abrufen“</strong>: URL <code data-testid="watch-url">{url}</code>, Methode <strong>POST</strong>, Header <code>Authorization</code> = <code>Bearer mk_…</code> (dein Schlüssel), Anfragetext <strong>JSON</strong> mit Feld <code>text</code> = „Diktierter Text“.</li>
              <li>Aktion <strong>„Wörterbuchwert abrufen“</strong> → Schlüssel <code>zeige</code> → Aktion <strong>„Ergebnis anzeigen“</strong>. Optional zum Vorlesen: Wert <code>sprich</code> → <strong>„Text sprechen“</strong>.</li>
              <li>Für „Kaufen 17“: Aktion <strong>„Wenn“</strong> Wörterbuchwert <code>url</code> hat einen Wert → <strong>„URLs öffnen“</strong> (öffnet am iPhone).</li>
              <li>In den Details des Kurzbefehls <strong>„Auf Apple Watch anzeigen“</strong> einschalten. Fertig – auch als Komplikation aufs Zifferblatt legen (Komplikation „Kurzbefehle“).</li>
            </ol>
            <div className="small muted">Wer lieber feste Sätze mag: einzelne Kurzbefehle mit <code>…/api/mobil/watch/stand</code>, <code>dringend</code>, <code>tesla</code> (GET) bzw. <code>erledigt</code>, <code>notiz</code>, <code>bestand</code>, <code>deal</code> (POST mit <code>text</code>) gehen weiterhin. Ausführlich im Wissen: „Handy & Tesla → Apple Watch“.</div>
          </section>

          <section className="card card-pad stack" style={{ gap: 8 }} data-testid="watch-probe">
            <h2 style={{ margin: 0 }}>Ausprobieren</h2>
            <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className="field" style={{ flex: 1, minWidth: 200 }}>
                <label className="label" htmlFor="watch-probe">Was du zur Uhr sagen würdest</label>
                <input className="input" id="watch-probe" name="probe" defaultValue={probe} placeholder="z. B. Wie läuft's?" data-testid="watch-probe-text" />
              </div>
              <button className="btn btn-primary" type="submit" data-testid="watch-probe-los">Antwort zeigen</button>
            </form>
            {antwort && (
              <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                <div className="watch-face" data-testid="watch-antwort" aria-label="So steht es auf der Uhr">
                  {antwort.zeilen.map((z, i) => <div key={i}>{z}</div>)}
                </div>
                <div className="small muted" data-testid="watch-befehl">Erkannt: <strong>{befehlText(antwort.befehl)}</strong>{antwort.ok ? "" : " – nicht ausgeführt"}<br />Vorgelesen: „{antwort.sprich}“</div>
              </div>
            )}
            <div className="small muted">Hier laufen nur lesende Befehle. Erledigt, Notiz, Bestand und Kaufen werden erkannt, aber nur an der Uhr ausgeführt.</div>
          </section>
        </div>
        <aside className="col-side">
          <section className="card card-pad small stack" style={{ gap: 6 }} data-testid="watch-befehle">
            <strong>Was du sagen kannst</strong>
            {BEFEHLE.map((b) => (
              <div key={b.sag}><strong>„{b.sag}“</strong>{b.aendert ? <span className="tag tag-warn" style={{ marginLeft: 6 }}>ändert</span> : null}<div className="muted">{b.macht}</div></div>
            ))}
            <div className="muted">Privates steht nie in „Wie läuft's“ oder „Was ist dringend“ (private Termine nur als „Termin außer Haus“).</div>
          </section>
        </aside>
      </div>
    </>
  );
}
