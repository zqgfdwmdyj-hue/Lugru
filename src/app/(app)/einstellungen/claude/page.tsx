import Link from "next/link";
import { headers } from "next/headers";
import { and, desc, eq, gte, isNotNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { getIntegration } from "@/lib/integrations/store";
import { getSettings } from "@/lib/settings";
import { appUrl } from "@/lib/oauth/state";
import { claudeReachable, publicUrl } from "@/lib/public-url";
import { listGrants } from "@/lib/assistant/oauth-service";
import { scopeText } from "@/lib/assistant/oauth-logic";
import { ALL_TOOLS } from "@/lib/assistant/registry";
import { accountRights } from "@/lib/assistant/permissions";
import { STAFF_AREAS } from "@/lib/auth/areas";
import { revokeGrantAction, saveStufenAction } from "./actions";
import { AssistantSettings, CopyUrl } from "./forms";

const time = (d: Date | null) => (d ? new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d) : "–");

export default async function ClaudeSettingsPage() {
  const session = await requireOwner();
  const t = session.tenantId;
  const h = await headers();
  // Claude erreicht den Konnektor nur über eine öffentliche https-Adresse (PUBLIC_URL, sonst die normale Adresse).
  const base = publicUrl() ?? appUrl(new Request("http://x", { headers: { host: h.get("x-forwarded-host") ?? h.get("host") ?? "", "x-forwarded-proto": h.get("x-forwarded-proto") ?? "https" } }));
  const reach = claudeReachable(base);
  const [grants, s, key, log, usage, members] = await Promise.all([
    listGrants(t),
    getSettings(t),
    getIntegration(t, "anthropic"),
    db
      .select({ at: schema.assistantLog.createdAt, tool: schema.assistantLog.tool, channel: schema.assistantLog.channel, ok: schema.assistantLog.ok, summary: schema.assistantLog.summary, user: schema.users.name, email: schema.users.email })
      .from(schema.assistantLog)
      .leftJoin(schema.users, eq(schema.users.id, schema.assistantLog.userId))
      // Änderungen und nicht ausgeführte Aufrufe (nur die haben bei lesenden Werkzeugen eine Beschreibung; verschlüsselt)
      .where(and(eq(schema.assistantLog.tenantId, t), or(eq(schema.assistantLog.write, true), isNotNull(schema.assistantLog.summary))))
      .orderBy(desc(schema.assistantLog.createdAt))
      .limit(30),
    db
      .select({ chats: sql<number>`count(*)::int`, inTok: sql<number>`coalesce(sum(${schema.assistantChats.inputTokens}),0)::int`, outTok: sql<number>`coalesce(sum(${schema.assistantChats.outputTokens}),0)::int` })
      .from(schema.assistantChats)
      .where(and(eq(schema.assistantChats.tenantId, t), gte(schema.assistantChats.updatedAt, new Date(new Date().setDate(1)))))
      .then((r) => r[0]),
    db
      .select({ name: schema.users.name, email: schema.users.email, role: schema.memberships.role, areas: schema.memberships.areas, readOnly: schema.memberships.readOnly, privateAccess: schema.memberships.privateAccess })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.tenantId, t)),
  ]);
  const areaName = new Map(STAFF_AREAS.map((a) => [a.key as string, a.label.split(" (")[0]]));
  const titleOf = new Map(ALL_TOOLS.map((x) => [x.name, x.title]));
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/einstellungen">Einstellungen</Link></div><h1>Claude & KI-Assistent</h1></div>
      </div>

      <section className="card card-pad stack" style={{ gap: 12 }} id="claude" data-testid="claude-connector">
        <h2 style={{ margin: 0 }}>1 · Seller-System in deinem Claude (claude.ai, App)</h2>
        <p className="small" style={{ margin: 0 }}>
          Dann fragst du im normalen Claude-Chat – auch am Handy – nach Aufträgen, Paletten, Aufgaben, Kalender oder Privatem, zusammen mit deinen anderen Konnektoren (sellerboard, Gmail …). Läuft über dein Claude-Abo.
        </p>
        <ol className="small" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
          <li>In Claude: <strong>Einstellungen → Konnektoren → Eigenen Konnektor hinzufügen</strong>.</li>
          <li>Name „Seller-System“, als URL diese Adresse einfügen:</li>
        </ol>
        {reach.ok ? (
          <CopyUrl url={`${base}/api/mcp`} />
        ) : (
          <div className="notice notice-warn small" data-testid="claude-not-public">
            <strong>Noch keine öffentliche Adresse:</strong> {base} – {reach.reason}. Claude ruft den Konnektor aus dem Internet auf und braucht dafür eine https-Adresse.
            <div style={{ marginTop: 6 }}>Einmal einrichten – freigegeben werden <strong>nur</strong> Anmeldung, Freigabe-Seite und Konnektor (plus Kunden-Links für Sendungen), alles andere bleibt zu:</div>
            <ol style={{ margin: "6px 0", paddingLeft: 18 }}>
              <li>Beim Domain-Anbieter einen DNS-Eintrag anlegen: Typ A, Name z. B. <strong>claude</strong>, Wert = IP des Servers.</li>
              <li>Auf dem Server (mit Webserver Caddy):</li>
            </ol>
            <pre className="num" style={{ margin: "6px 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>sudo bash /opt/seller-system/deploy/claude-oeffentlich.sh domain claude.deine-domain.de</pre>
            <div>Ohne Zusatz zeigt das Skript, welche Variante zum Server passt (auch Tailscale). Danach diese Seite neu laden – hier steht dann die https-Adresse zum Kopieren.</div>
          </div>
        )}
        <ol className="small" start={3} style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
          <li>„Verbinden“ → Seller-System-Anmeldung → <strong>Erlauben</strong> (Ändern und Privatbereich dort an- oder abwählen).</li>
          <li>Im Chat fragen, z. B. „Welche Paletten kommen diese Woche?“ oder „Trag morgen 15–18 Uhr Kinderzeit für mich ein“.</li>
        </ol>
        <h3 style={{ margin: "8px 0 0", fontSize: 15 }}>Verbundene Zugänge</h3>
        {grants.length === 0 ? (
          <div className="small muted" data-testid="grants-empty">Noch keine Verbindung.</div>
        ) : (
          <table className="table">
            <thead><tr><th>Programm</th><th>Rechte</th><th>Verbunden</th><th>Zuletzt benutzt</th><th></th></tr></thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.id} data-testid="grant-row">
                  <td>{g.clientName || "Claude"}<div className="small muted">{g.userName || g.userEmail}</div></td>
                  <td className="small">{scopeText(g.scope)}</td>
                  <td className="small">{time(g.createdAt)}</td>
                  <td className="small">{time(g.lastUsedAt)}</td>
                  <td><form action={revokeGrantAction}><input type="hidden" name="id" value={g.id} /><button className="btn btn-small" type="submit" data-testid="grant-revoke">Trennen</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card card-pad stack" style={{ gap: 12 }} data-testid="assistant-box">
        <h2 style={{ margin: 0 }}>2 · Fragefeld im Seller-System (für Mitarbeiter)</h2>
        <p className="small" style={{ margin: 0 }}>
          Oben auf jeder Seite: Frage eintippen, Antwort kommt direkt – mit den Daten, die die Person sehen darf (Bereiche wie bei den Benutzern). Den Privatbereich gibt es hier nie. Abgerechnet über den KI-Schlüssel (Anbindungen → KI), pro Frage meist wenige Cent.
        </p>
        <AssistantSettings v={s.assistant} hasKey={Boolean(key?.apiKey)} />
        <div className="small muted" data-testid="assistant-usage">Diesen Monat: {usage?.chats ?? 0} Gespräche · {(usage?.inTok ?? 0).toLocaleString("de-DE")} Eingabe- und {(usage?.outTok ?? 0).toLocaleString("de-DE")} Ausgabe-Tokens.</div>
      </section>

      <section className="card card-pad stack" style={{ gap: 12 }} data-testid="rights">
        <h2 style={{ margin: 0 }}>3 · Wer darf was</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }} data-testid="rights-compare">
          <div className="card card-pad stack small" style={{ gap: 6 }}>
            <strong>Claude-Konnektor (claude.ai)</strong>
            <div><strong>Wer:</strong> nur der Inhaber kann verbinden – Mitarbeiter bekommen bei „Erlauben“ eine Absage.</div>
            <div><strong>Sieht:</strong> dieselben Bereiche wie das Konto im Seller-System.</div>
            <div><strong>Ändern:</strong> nur wenn bei „Erlauben“ <em>ändern</em> angehakt war. claude.ai fragt vor einer Änderung um Erlaubnis; der Konnektor weist Claude an, nur auf ausdrücklichen Wunsch zu ändern.</div>
            <div><strong>Privatbereich:</strong> nur mit Haken <em>privat</em> bei „Erlauben“ und wenn das Konto Privat-Zugang hat.</div>
            <div><strong>Beenden:</strong> oben bei „Verbundene Zugänge“ → „Trennen“ (sofort ungültig).</div>
          </div>
          <div className="card card-pad stack small" style={{ gap: 6 }}>
            <strong>Fragefeld im Seller-System</strong>
            <div><strong>Wer:</strong> jedes angemeldete Konto.</div>
            <div><strong>Sieht:</strong> nur die Bereiche des jeweiligen Kontos (wie bei den Benutzern eingestellt).</div>
            <div><strong>Ändern:</strong> nur wenn oben „Änderungen erlauben“ an ist und das Konto nicht „nur ansehen“ ist. Jede Änderung erscheint erst als Vorschlag mit „Ausführen“ / „Ablehnen“.</div>
            <div><strong>Privatbereich:</strong> Nie.</div>
            <div><strong>Beenden:</strong> oben „Fragefeld anzeigen“ aus.</div>
          </div>
        </div>
        <div className="small">
          <strong>Für beide:</strong> Ein Werkzeug ohne Recht wird vom Seller-System abgewiesen („nicht freigegeben“) – auch wenn es direkt aufgerufen wird; die Prüfung passiert auf dem Server, nicht in Claude. Jede Änderung, jeder abgelehnte Vorschlag und jeder abgewiesene Aufruf steht unten im Protokoll mit Zeit, Person und Weg.
        </div>
        <h3 style={{ margin: "4px 0 0", fontSize: 15 }}>Je Konto</h3>
        <div className="stack" style={{ gap: 6 }} data-testid="rights-accounts">
          {members.map((m) => {
            const r = accountRights(ALL_TOOLS, { role: m.role, areas: m.areas, readOnly: m.readOnly, privateAccess: m.privateAccess }, { allowWrite: s.assistant.allowWrite });
            const list = (names: string[]) => names.map((n) => titleOf.get(n) ?? n).join(", ");
            return (
              <div key={m.email} className="card card-pad small" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }} data-testid="rights-row" data-account={m.email}>
                <div>
                  <strong>{m.name || m.email}</strong>
                  <div className="muted">{m.role === "owner" ? "Inhaber" : m.areas === null ? "alle Bereiche" : m.areas.map((a) => areaName.get(a) ?? a).join(", ") || "keine Bereiche"}{m.readOnly ? " · nur ansehen" : ""}</div>
                </div>
                <div data-testid="rights-app">
                  <details><summary>Fragefeld: {r.fragefeld.lesen.length} lesen · {r.fragefeld.aendern.length} ändern</summary><div>Lesen: {list(r.fragefeld.lesen) || "–"}</div><div>Ändern: {list(r.fragefeld.aendern) || "–"}</div></details>
                </div>
                <div data-testid="rights-claude">
                  {r.claude ? (
                    <details><summary>Claude: bis {r.claude.lesen.length} lesen · {r.claude.aendern.length} ändern</summary><div>Lesen: {list(r.claude.lesen) || "–"}</div><div>Ändern: {list(r.claude.aendern) || "–"}</div><div className="muted">je nach Haken bei „Erlauben“</div></details>
                  ) : (
                    <span className="muted">Claude: kann nicht verbinden</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card card-pad stack" style={{ gap: 8, scrollMarginTop: 70 }} id="stufen" data-testid="assistant-stufen">
        <h2>Stufen je Aktion (Fragefeld)</h2>
        <div className="small muted">Grün = nach „Ausführen“ im Chat; gelb = zusätzlich einzeln bestätigen (Außenwirkung, Nachrichten an VA/Kunden); rot = nie durch den Assistenten (nur Hinweis + Link). Über 200 Datensätze immer mit zweiter Bestätigung. <Link href="/assistent-verlauf">Assistent-Verlauf</Link></div>
        <form action={saveStufenAction} className="stack" style={{ gap: 4 }}>
          <div className="table-wrap">
            <table className="table small">
              <tbody>
                {ALL_TOOLS.filter((x) => x.write && !x.privat).map((x) => {
                  const std = typeof x.stufe === "string" ? x.stufe : typeof x.stufe === "function" ? "je nach Eingabe" : "gruen";
                  return (
                    <tr key={x.name}>
                      <td>{x.title} <span className="muted">({x.name})</span></td>
                      <td>
                        <select className="select" name={`stufe_${x.name}`} defaultValue={s.assistant.stufen[x.name] ?? ""} aria-label={`Stufe ${x.title}`} style={{ padding: "2px 6px" }}>
                          <option value="">Standard ({std === "gruen" ? "grün" : std})</option>
                          <option value="gruen">grün</option>
                          <option value="gelb">gelb</option>
                          <option value="rot">rot</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div><button className="btn btn-small" type="submit" data-testid="stufen-speichern">Stufen speichern</button></div>
        </form>
      </section>

      <section className="card" data-testid="assistant-log">
        <div className="card-head"><h2>Protokoll: Änderungen und abgewiesene Aufrufe</h2><span className="small muted">die letzten 30</span></div>
        {/* Liste statt Tabelle: am Handy bleibt „Was“ lesbar. */}
        <div className="stack" style={{ gap: 0 }}>
          {log.length === 0 && <div className="small muted card-pad">Noch keine Änderungen.</div>}
          {log.map((l, i) => (
            <div key={i} data-testid="log-row" style={{ padding: "8px 20px", borderTop: i ? "1px solid var(--border)" : 0 }}>
              <div className="small muted"><span className="num">{time(l.at)}</span> · {l.user || l.email || "–"} · {l.channel === "claude" ? "Claude" : "Fragefeld"}</div>
              <div className="small" style={{ overflowWrap: "anywhere" }}>
                {titleOf.get(l.tool) ?? l.tool}{l.summary ? ` – ${l.summary}` : ""}
                {!l.ok && <span className="tag tag-warn" style={{ marginLeft: 4 }}>{l.summary?.startsWith("Abgewiesen") ? "abgewiesen" : l.summary?.startsWith("Abgelehnt") ? "abgelehnt" : "nicht ausgeführt"}</span>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
