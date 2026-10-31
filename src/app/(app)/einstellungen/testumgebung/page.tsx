import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { blockedCalls, isTestEnv } from "@/lib/testenv";

const time = (d: Date | string) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(d));

type SimCall = { at: string; dienst: string; method: string; path: string; simuliert: boolean };

/** Was hätte die Testumgebung nach außen geschickt? Mails, gesperrte Verbindungen, simulierte Aufrufe. */
export default async function TestumgebungPage() {
  const session = await requireOwner();
  const head = (
    <div className="page-head">
      <div><div className="crumb"><Link href="/einstellungen">Einstellungen</Link></div><h1>Testumgebung</h1></div>
    </div>
  );
  if (!isTestEnv()) {
    return (
      <>
        {head}
        <section className="card card-pad stack" style={{ gap: 10 }} data-testid="testenv-off">
          <div className="notice notice-info"><strong>Normalbetrieb.</strong> Das hier ist das echte System – Mails gehen raus, Labels werden gekauft.</div>
          <p className="small" style={{ margin: 0 }}>
            Zum gefahrlosen Ausprobieren gibt es eine getrennte Testumgebung mit eigener Datenbank und erfundenen Daten. Dort werden Mails abgefangen und Post, DHL, Amazon, eBay und Claude nur simuliert. Einrichten auf dem Server:
          </p>
          <pre className="num" style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>sudo bash /opt/seller-system/deploy/testumgebung.sh an</pre>
        </section>
      </>
    );
  }
  const [mails, members] = await Promise.all([
    db.select().from(schema.testMails).where(eq(schema.testMails.tenantId, session.tenantId)).orderBy(desc(schema.testMails.createdAt)).limit(50),
    db
      .select({ email: schema.users.email, name: schema.users.name, role: schema.memberships.role, areas: schema.memberships.areas, readOnly: schema.memberships.readOnly, privateAccess: schema.memberships.privateAccess })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.tenantId, session.tenantId)),
  ]);
  let sim: SimCall[] | null = null;
  if (process.env.TESTDIENSTE_URL) {
    try {
      const r = await fetch(`${process.env.TESTDIENSTE_URL.replace(/\/$/, "")}/__log`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
      sim = r.ok ? ((await r.json()) as SimCall[]).slice(-50).reverse() : null;
    } catch {
      sim = null;
    }
  }
  const blocked = blockedCalls();
  return (
    <>
      {head}
      <div className="notice notice-warn" data-testid="testenv-on">
        <strong>Testumgebung aktiv.</strong> Eigene Datenbank, erfundene Daten. Nichts von hier erreicht Kunden, Marktplätze oder Versanddienste.
      </div>

      <section className="card" data-testid="testenv-mails">
        <div className="card-head"><h2>Abgefangene Mails</h2><span className="small muted">{mails.length ? `die letzten ${mails.length}` : "noch keine"}</span></div>
        {mails.length === 0 && <div className="card-pad small muted">Noch keine – z. B. Sendung verschieben (mit Meldung per E-Mail) oder Rechnung senden.</div>}
        {mails.map((m) => (
          <details key={m.id} style={{ padding: "8px 20px", borderTop: "1px solid var(--border)" }} data-testid="testenv-mail">
            <summary className="small" style={{ cursor: "pointer", overflowWrap: "anywhere" }}>
              <span className="muted num">{time(m.createdAt)}</span> · an {m.to} · <strong>{m.subject}</strong>{m.attachments ? ` · 📎 ${m.attachments}` : ""}
            </summary>
            <pre className="small" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "6px 0 0" }}>{m.text}</pre>
          </details>
        ))}
      </section>

      <section className="card" data-testid="testenv-sim">
        <div className="card-head"><h2>Simulierte Aufrufe (Post, DHL, Amazon, eBay, Claude …)</h2><span className="small muted">Testdienste</span></div>
        {sim === null && <div className="card-pad small muted">Testdienste nicht erreichbar (TESTDIENSTE_URL).</div>}
        {sim?.length === 0 && <div className="card-pad small muted">Noch keine.</div>}
        {sim?.map((c, i) => (
          <div key={i} className="small" style={{ padding: "6px 20px", borderTop: "1px solid var(--border)", overflowWrap: "anywhere" }} data-testid="testenv-sim-row">
            <span className="muted num">{time(c.at)}</span> · <strong>{c.dienst}</strong> · {c.method} {c.path}
            {c.simuliert && <span className="tag tag-info" style={{ marginLeft: 6 }}>simuliert</span>}
          </div>
        ))}
      </section>

      <section className="card" data-testid="testenv-blocked">
        <div className="card-head"><h2>Gesperrte Verbindungen nach außen</h2><span className="small muted">seit dem Start des Servers</span></div>
        {blocked.length === 0 && <div className="card-pad small muted">Keine – alles lief gegen die Testdienste.</div>}
        {blocked.map((b, i) => (
          <div key={i} className="small" style={{ padding: "6px 20px", borderTop: "1px solid var(--border)", overflowWrap: "anywhere" }}>
            <span className="muted num">{time(b.at)}</span> · {b.method} {b.target} <span className="tag tag-warn" style={{ marginLeft: 6 }}>gesperrt</span>
          </div>
        ))}
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }} data-testid="testenv-accounts">
        <h2 style={{ margin: 0 }}>Testkonten</h2>
        <div className="small muted">Passwörter stehen in der Ausgabe von <code>deploy/testumgebung.sh</code> (bzw. für die automatischen Prüfungen in e2e/README.md).</div>
        {members.map((m) => (
          <div key={m.email} className="small">
            <strong>{m.email}</strong> – {m.name} · {m.role === "owner" ? "Inhaber" : m.areas === null ? "alle Bereiche" : m.areas.join(", ")}
            {m.readOnly ? " · nur ansehen" : ""}
            {m.privateAccess ? " · Privat" : ""}
          </div>
        ))}
      </section>
    </>
  );
}
