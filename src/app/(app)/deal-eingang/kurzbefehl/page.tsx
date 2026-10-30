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
          <p className="small muted" style={{ margin: 0 }}>iCloud-Link zum fertigen Kurzbefehl: noch nicht hinterlegt (Einstellungen → Deal-Eingang).</p>
        )}
        <ol className="small" style={{ margin: 0 }}>
          <li>Unten einen Schlüssel für dieses iPhone erzeugen und kopieren.</li>
          <li>App „Kurzbefehle“ → „+“ → Name „Deal prüfen“ → Einstellungen (i): „Im Share-Sheet anzeigen“ an, Typen: Text, Bilder, PDF, Dateien.</li>
          <li>Aktion „Inhalte von URL abrufen“: URL <code>{basis || "https://<deine Adresse>"}/api/deal-eingang</code>, Methode POST, Header <code>Authorization</code> = <code>Bearer &lt;Schlüssel&gt;</code>, Text: „Formular“ mit Feld <code>text</code> = Kurzbefehleingabe (bei Bildern/PDF: Feld <code>datei</code> als Datei).</li>
          <li>Aktion „Mitteilung anzeigen“ mit dem Ergebnis (Feld <code>text</code> aus der Antwort).</li>
          <li>Testen: in WhatsApp Nachricht teilen → „Deal prüfen“. Das Ergebnis erscheint im Deal-Eingang.</li>
        </ol>
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
