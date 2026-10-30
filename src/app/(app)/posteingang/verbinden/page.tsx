import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getIntegration } from "@/lib/integrations/store";
import { ImapForm, PasteForm } from "./forms";

export default async function VerbindenPage({ searchParams }: { searchParams: Promise<{ fehler?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const [google, microsoft] = await Promise.all([getIntegration(session.tenantId, "google"), getIntegration(session.tenantId, "microsoft")]);
  const isOwner = session.role === "owner";

  const oauth = (p: "google" | "microsoft", name: string, ready: boolean) => (
    <section className="card card-pad stack" style={{ gap: 12, flex: "1 1 280px", minWidth: 0 }}>
      <h2>Mit {name} anmelden</h2>
      {!ready ? (
        <div className="small muted">
          Dafür muss einmalig eine {name}-App unter Anbindungen eingetragen sein (Anleitung dort).{" "}
          {isOwner && <Link href={`/anbindungen?p=${p}#${p}`}>Jetzt eintragen</Link>}
        </div>
      ) : (
        <>
          <div className="small">
            1. <a className="btn btn-small" href={`/api/oauth/${p}/start?modus=einfuegen`} target="_blank" rel="noopener">Anmeldung bei {name} öffnen</a>
          </div>
          <div className="small muted">
            Nach dem Anmelden landet der Browser auf einer Seite, die nicht lädt („localhost“) – das ist richtig. Die Adresse oben aus der Browserzeile kopieren und hier einfügen. Gleicher Ablauf wie beim eBay-Tool.
          </div>
          <PasteForm provider={p} />
        </>
      )}
    </section>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/posteingang">Posteingang</Link></div>
          <h1>Postfach verbinden</h1>
        </div>
      </div>
      {sp.fehler && <div className="notice notice-error">{sp.fehler}</div>}
      <p className="muted" style={{ margin: 0, maxWidth: 780 }}>
        Verbundene Postfächer werden alle 15 Minuten abgerufen (Amazon-, eBay- und Kundenmails werden eingeordnet) – und über sie verschickt das System E-Mails, z. B. die eBay-Rechnungen.
      </p>
      <div className="row">
        <section className="card card-pad stack" style={{ flexGrow: 1, minWidth: 0, gap: 14 }} data-testid="imap-verbinden">
          <h2>Mit App-Passwort (IMAP/SMTP) – der Standardweg</h2>
          <div className="small muted">
            Adresse und App-Passwort eingeben – die Server werden automatisch erkannt (Gmail/Google Workspace, Outlook/Microsoft 365, GMX, WEB.DE, IONOS, STRATO, T-Online, iCloud und eigene Domains über den MX-Eintrag).
            Ist der Versand-Port gesperrt, wird automatisch 587 (STARTTLS) versucht; klappt auch das nicht, wird das Postfach nur zum Abrufen verbunden.
          </div>
          <ImapForm />
          <details className="small" open data-testid="app-passwort-anleitung">
            <summary style={{ cursor: "pointer" }}>So bekommst du ein App-Passwort</summary>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
              <li><strong>Google / Gmail / Workspace:</strong> myaccount.google.com → Sicherheit → Bestätigung in zwei Schritten (muss an sein) → „App-Passwörter“ → Name z. B. „Seller-System“ → 16-stelligen Code hier einfügen. In Gmail muss IMAP an sein (Einstellungen → Weiterleitung und POP/IMAP). Bei Workspace muss der Admin App-Passwörter erlauben.</li>
              <li><strong>Outlook.com / Microsoft 365:</strong> mysignins.microsoft.com → Sicherheitsinformationen → Methode hinzufügen → „App-Kennwort“ (nur mit Zwei-Faktor-Anmeldung). Hat der Admin IMAP/SMTP mit Passwort abgeschaltet, unten unter „Erweitert“ mit Microsoft anmelden.</li>
              <li><strong>GMX / WEB.DE:</strong> normales Passwort; in den Einstellungen „POP3/IMAP Abruf“ erlauben (sonst meldet das System „IMAP beim Anbieter aus“).</li>
              <li><strong>IONOS / STRATO:</strong> Passwort des E-Mail-Postfachs (nicht das Kundenkonto-Passwort).</li>
              <li><strong>iCloud:</strong> account.apple.com → Anmeldung und Sicherheit → App-spezifische Passwörter.</li>
            </ul>
          </details>
          <div className="small muted">Amazon-Mails landen per Filter oft im Archiv oder unter einem Label: nach dem Verbinden unter Posteingang → Postfach → „Ordner“ die passenden Ordner wählen (bei Gmail automatisch „Alle Nachrichten“).</div>
        </section>
      </div>
      <details className="card card-pad" data-testid="oauth-erweitert">
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Erweitert: Anmeldung mit Google oder Microsoft (OAuth, optional)</summary>
        <div className="small muted" style={{ margin: "8px 0 12px" }}>Nur nötig, wenn App-Passwörter beim Anbieter nicht erlaubt sind. Dafür muss einmalig eine eigene App unter Anbindungen eingetragen sein.</div>
        <div className="row">
          {oauth("google", "Google", Boolean(google?.clientId && google.clientSecret))}
          {oauth("microsoft", "Microsoft", Boolean(microsoft?.clientId && microsoft.clientSecret))}
        </div>
      </details>
    </>
  );
}
