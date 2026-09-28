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
    <section className="card card-pad stack" style={{ gap: 12 }}>
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
        <section className="card card-pad stack" style={{ flexGrow: 1, minWidth: 0, gap: 14 }}>
          <h2>Mit Passwort (IMAP/SMTP) – der einfachste Weg</h2>
          <div className="small muted">
            Funktioniert mit fast allen Anbietern: Google/Gmail und Google Workspace, iCloud, GMX, WEB.DE, T-Online, IONOS, STRATO, eigene Domains … Die Server werden automatisch ermittelt.
            Bei Google und Apple ist ein <strong>App-Passwort</strong> nötig (normales Passwort geht dort nicht).
          </div>
          <ImapForm />
          <details className="small">
            <summary style={{ cursor: "pointer" }}>So bekommst du ein App-Passwort</summary>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
              <li><strong>Google / Gmail / Workspace:</strong> myaccount.google.com → Sicherheit → Bestätigung in zwei Schritten (muss an sein) → ganz unten „App-Passwörter“ → Name z. B. „Seller-System“ → 16-stelligen Code hier einfügen. Bei Workspace muss der Admin App-Passwörter erlauben.</li>
              <li><strong>iCloud:</strong> account.apple.com → Anmeldung und Sicherheit → App-spezifische Passwörter.</li>
              <li><strong>GMX / WEB.DE:</strong> normales Passwort; in den Einstellungen „POP3/IMAP Abruf“ einschalten.</li>
              <li><strong>Outlook.com / Microsoft 365:</strong> Passwort-Anmeldung ist dort meist abgeschaltet – rechts „Mit Microsoft anmelden“ nutzen.</li>
            </ul>
          </details>
        </section>
        <aside className="col-side">
          {oauth("google", "Google", Boolean(google?.clientId && google.clientSecret))}
          {oauth("microsoft", "Microsoft", Boolean(microsoft?.clientId && microsoft.clientSecret))}
        </aside>
      </div>
    </>
  );
}
