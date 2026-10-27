import Link from "next/link";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { hasAdmin, requireAdmin } from "@/lib/auth";
import { recentActivity } from "@/lib/activity";
import { orphanFileStats } from "@/lib/service";
import { cleanupFiles, saveAutoAi } from "./actions";
import { autoAiMode } from "@/lib/settings";
import { AI_MODE_ESTIMATE, AI_MODE_INFO, AI_MODES } from "@/lib/ai-modes";
import { aiConfigured } from "@/lib/price-research";
import { CreateUserForm, UserRow } from "./forms";

const when = (d: Date | null) =>
  d ? d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "noch nie";

export default async function VerwaltungPage({ searchParams }: { searchParams: Promise<{ erster?: string }> }) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const [users, admin, orphans, log, auto] = await Promise.all([
    db.select().from(schema.users).orderBy(asc(schema.users.name)),
    hasAdmin(),
    orphanFileStats(),
    recentActivity({ limit: 100 }),
    autoAiMode(),
  ]);

  return (
    <>
      <div className="crumb"><Link href="/">Verteilungen</Link></div>
      <div className="page-head"><div><h1>Verwaltung</h1><div className="small muted">Zugänge, Aufräumen und wer was geändert hat</div></div></div>
      {sp.erster && <div className="notice notice-ok">Erster Admin angelegt – du bist jetzt damit angemeldet. Das Team-Passwort gilt ab sofort nicht mehr. Lege jetzt für alle im Team einen eigenen Zugang an.</div>}
      {!admin && <div className="notice notice-warn">Noch kein eigener Zugang: Alle melden sich mit dem gemeinsamen Team-Passwort an. Lege zuerst einen Admin an (am besten dich selbst).</div>}

      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }} className="stack">
          <section className="card">
            <div className="card-head"><h2>Zugänge ({users.length})</h2></div>
            {users.length === 0 && <div className="card-pad muted">Noch keine.</div>}
            <div className="stack" style={{ gap: 0 }}>
              {users.map((u) => (
                <UserRow key={u.id} self={u.id === me.id} user={{ id: u.id, name: u.name, login: u.login, email: u.email, isAdmin: u.isAdmin, active: u.active, lastLogin: when(u.lastLoginAt) }} />
              ))}
            </div>
            <div className="small muted" style={{ padding: "8px 14px" }}>Anmeldung mit E-Mail oder Anmeldename. Neues Passwort eintragen und speichern meldet die Person auf allen Geräten ab. „aktiv“ abwählen sperrt den Zugang sofort, „Entfernen“ löscht ihn (im Protokoll bleibt der Name).</div>
          </section>

          <section className="card">
            <div className="card-head"><h2>Protokoll</h2><span className="small muted">letzte 100 Einträge</span></div>
            <table className="table">
              <thead><tr><th>Wann</th><th>Wer</th><th>Was</th></tr></thead>
              <tbody>
                {log.length === 0 && <tr><td colSpan={3} className="muted">Noch nichts.</td></tr>}
                {log.map((a) => (
                  <tr key={a.id}>
                    <td className="num small" style={{ whiteSpace: "nowrap" }}>{when(a.createdAt)}</td>
                    <td className="small">{a.userName}</td>
                    <td className="small">{a.eventId ? <Link href={`/verteilung/${a.eventId}`}>{a.action}</Link> : a.productId ? <Link href={`/produkte/${a.productId}`}>{a.action}</Link> : a.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <aside className="col-side">
          <CreateUserForm first={!admin} />
          <form action={saveAutoAi} className="card card-pad stack" style={{ gap: 8 }}>
            <h2>KI nach dem Hochladen</h2>
            <div className="small muted">Erkennt jedes neue Produkt auf dem Foto selbst und füllt Name, Größe, Kategorie, MHD und einen Preisvorschlag aus (als „unbestätigt“) – ihr kontrolliert nur noch.{aiConfigured() ? "" : " Dafür muss ein KI-Schlüssel eingerichtet sein."}</div>
            <select className="select" name="autoAi" defaultValue={auto ?? "aus"} aria-label="KI nach dem Hochladen">
              {AI_MODES.map((m) => <option key={m} value={m}>{AI_MODE_INFO[m].label} (ca. {(AI_MODE_ESTIMATE[m] * 100).toFixed(1).replace(".", ",")} Cent je Produkt)</option>)}
              <option value="aus">Aus – nur per Knopf starten</option>
            </select>
            <button className="btn" type="submit">Speichern</button>
          </form>
          <form action={cleanupFiles} className="card card-pad stack" style={{ gap: 8 }}>
            <h2>Aufräumen</h2>
            <div className="small muted">Fotos, die nirgends mehr verwendet werden – ersetzt, entfernt oder von zusammengeführten Produkten. Sie machen Datenbank und Sicherungen unnötig groß.</div>
            <div><strong>{orphans.count}</strong> ungenutzte Fotos · {(orphans.bytes / 1024 / 1024).toFixed(1)} MB</div>
            <button className="btn" type="submit" disabled={orphans.count === 0}>Ungenutzte Fotos löschen</button>
            <div className="small muted">Produktfotos und MHD-Fotos bleiben immer erhalten. Die tägliche Sicherung enthält gelöschte Fotos noch 14 Tage.</div>
          </form>
        </aside>
      </div>
    </>
  );
}
