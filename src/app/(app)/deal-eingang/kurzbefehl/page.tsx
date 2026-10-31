import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { tokens } from "@/lib/deal-eingang/service";
import { publicUrl } from "@/lib/public-url";
import { getSettings } from "@/lib/settings";
import { tokenWiderrufenAction } from "../actions";
import { TokenForm } from "../token-form";

// iPhone-Kurzbefehl „Deal prüfen“ (Geräte-Schlüssel) und Teilen-Ziel (Android/Chrome) einrichten.

export default async function KurzbefehlPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("dealeingang");
  const sp = await searchParams;
  const [liste, s] = await Promise.all([tokens(session.tenantId, session.userId), getSettings(session.tenantId)]);
  const basis = publicUrl() ?? "";
  return (
    <>
      <div className="page-head"><div><div className="crumb"><Link href="/deal-eingang">Deal-Eingang</Link></div><h1>Teilen aus WhatsApp</h1></div></div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>{sp.meldung}</div>}

      <section className="card card-pad stack" data-testid="de-android">
        <h2 style={{ margin: 0 }}>Android / Chrome</h2>
        <ol className="small" style={{ margin: 0 }}>
          <li>Seller-System im Chrome öffnen → Menü → „Zum Startbildschirm hinzufügen“ (App installieren).</li>
          <li>In WhatsApp Nachricht lange drücken → Teilen → „Seller“ wählen. Die Seite zeigt kurz „wird geprüft …“ und dann das Ergebnis.</li>
        </ol>
      </section>

      <section className="card card-pad stack" style={{ marginTop: 12 }} data-testid="de-iphone">
        <h2 style={{ margin: 0 }}>iPhone: Kurzbefehl „Deal prüfen“</h2>
        {s.dealEingang.kurzbefehlLink ? (
          <p className="small" style={{ margin: 0 }}>Fertigen Kurzbefehl laden: <a href={s.dealEingang.kurzbefehlLink}>iCloud-Link</a> – danach nur noch den Schlüssel eintragen.</p>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>iCloud-Link zum fertigen Kurzbefehl: noch nicht hinterlegt (Deal-Eingang → „Weitere Einstellungen“).</p>
        )}
        <ol className="small stack" style={{ margin: 0, gap: 10 }} data-testid="de-anleitung">
          <li>
            Unten einen Schlüssel für dieses iPhone erzeugen und kopieren (beginnt mit <code>dk_</code>).
          </li>
          <li>
            App „Kurzbefehle“ → „+“ → Name „Deal prüfen“ → Einstellungen (ⓘ): „Im Share-Sheet anzeigen“ an, Typen: Text, Bilder, PDF, Dateien.
            <Skizze titel="Details" zeilen={[["Im Share-Sheet anzeigen", "an"], ["Typen", "Text · Bilder · PDF · Dateien"]]} />
          </li>
          <li>
            Aktion „Inhalte von URL abrufen“ hinzufügen und so ausfüllen:
            <Skizze
              titel="🌐 Inhalte von URL abrufen"
              zeilen={[
                ["URL", `${basis || "https://<deine Adresse>"}/api/deal-eingang`],
                ["Methode", "POST"],
                ["Header", "Authorization = Bearer dk_…"],
                ["Haupttext", "Formular"],
                ["Feld", "text = Kurzbefehleingabe"],
                ["bei Bildern/PDF", "Feld datei = Kurzbefehleingabe (Datei)"],
              ]}
            />
          </li>
          <li>
            Aktion „Mitteilung anzeigen“ mit dem Feld <code>text</code> aus der Antwort:
            <Skizze titel="💬 Mitteilung anzeigen" zeilen={[["Inhalt", "Wörterbuchwert „text“ in Inhalte von URL"]]} />
          </li>
          <li>
            Testen: in WhatsApp eine Nachricht lange drücken → Teilen → „Deal prüfen“. Nach höchstens einer Minute kommt die Mitteilung mit der Ampel.
            <Skizze titel="Mitteilung" zeilen={[["Deal prüfen", "Wird geprüft – Ergebnis gleich als Mitteilung bzw. im Deal-Eingang."]]} />
          </li>
        </ol>
        <p className="small muted" style={{ margin: 0 }}>Die Bilder sind Skizzen der Kurzbefehle-App, keine Bildschirmfotos – Beschriftungen können je nach iOS-Version leicht abweichen.</p>
        <TokenForm />
        {liste.length > 0 && (
          <table className="table small" data-testid="de-tokens">
            <thead><tr><th>Gerät</th><th>Schlüssel</th><th>zuletzt genutzt</th><th /></tr></thead>
            <tbody>
              {liste.map((t) => (
                <tr key={t.id} data-testid="de-token" data-widerrufen={t.revokedAt ? "1" : "0"}>
                  <td>{t.name}</td><td>{t.anfang}…</td>
                  <td>{t.revokedAt ? "widerrufen" : t.lastUsedAt ? t.lastUsedAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" }) : "noch nie"}</td>
                  <td>{!t.revokedAt && !session.readOnly && <form action={tokenWiderrufenAction}><input type="hidden" name="id" value={t.id} /><button className="btn btn-sm" type="submit">widerrufen</button></form>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="small muted" style={{ margin: 0 }}>Je Gerät ein eigener Schlüssel. Widerrufen wirkt sofort. Höchstens 20 Eingänge in 10 Minuten je Schlüssel.</p>
      </section>
    </>
  );
}

/** Skizze einer Kurzbefehle-Aktion (graue Karte wie in der App) – statt Bildschirmfotos, die je iOS-Version abweichen. */
function Skizze({ titel, zeilen }: { titel: string; zeilen: [string, string][] }) {
  return (
    <div aria-hidden="true" data-testid="de-skizze" style={{ marginTop: 6, maxWidth: 420, border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-2)", padding: "8px 12px", fontFamily: "var(--sans)" }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{titel}</div>
      {zeilen.map(([k, v]) => (
        <div key={k} className="row" style={{ gap: 8, justifyContent: "space-between", borderTop: "1px solid var(--border)", padding: "4px 0" }}>
          <span className="muted">{k}</span>
          <span style={{ color: "var(--link)", textAlign: "right", overflowWrap: "anywhere" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}
