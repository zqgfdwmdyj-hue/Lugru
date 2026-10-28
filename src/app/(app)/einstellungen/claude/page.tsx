import Link from "next/link";
import { headers } from "next/headers";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { getIntegration } from "@/lib/integrations/store";
import { getSettings } from "@/lib/settings";
import { appUrl } from "@/lib/oauth/state";
import { listGrants } from "@/lib/assistant/oauth-service";
import { scopeText } from "@/lib/assistant/oauth-logic";
import { ALL_TOOLS } from "@/lib/assistant/registry";
import { revokeGrantAction } from "./actions";
import { AssistantSettings, CopyUrl } from "./forms";

const time = (d: Date | null) => (d ? new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d) : "–");

export default async function ClaudeSettingsPage() {
  const session = await requireOwner();
  const t = session.tenantId;
  const h = await headers();
  const base = appUrl(new Request("http://x", { headers: { host: h.get("x-forwarded-host") ?? h.get("host") ?? "", "x-forwarded-proto": h.get("x-forwarded-proto") ?? "https" } }));
  const [grants, s, key, log, usage] = await Promise.all([
    listGrants(t),
    getSettings(t),
    getIntegration(t, "anthropic"),
    db
      .select({ at: schema.assistantLog.createdAt, tool: schema.assistantLog.tool, channel: schema.assistantLog.channel, ok: schema.assistantLog.ok, summary: schema.assistantLog.summary, user: schema.users.name, email: schema.users.email })
      .from(schema.assistantLog)
      .leftJoin(schema.users, eq(schema.users.id, schema.assistantLog.userId))
      .where(and(eq(schema.assistantLog.tenantId, t), eq(schema.assistantLog.write, true)))
      .orderBy(desc(schema.assistantLog.createdAt))
      .limit(30),
    db
      .select({ chats: sql<number>`count(*)::int`, inTok: sql<number>`coalesce(sum(${schema.assistantChats.inputTokens}),0)::int`, outTok: sql<number>`coalesce(sum(${schema.assistantChats.outputTokens}),0)::int` })
      .from(schema.assistantChats)
      .where(and(eq(schema.assistantChats.tenantId, t), gte(schema.assistantChats.updatedAt, new Date(new Date().setDate(1)))))
      .then((r) => r[0]),
  ]);
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
        <CopyUrl url={`${base}/api/mcp`} />
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

      <section className="card" data-testid="assistant-log">
        <div className="card-head"><h2>Änderungen über Claude und das Fragefeld</h2><span className="small muted">die letzten 30</span></div>
        <table className="table">
          <thead><tr><th>Zeit</th><th>Wer</th><th>Weg</th><th>Was</th></tr></thead>
          <tbody>
            {log.length === 0 && <tr><td colSpan={4} className="muted">Noch keine Änderungen.</td></tr>}
            {log.map((l, i) => (
              <tr key={i} data-testid="log-row">
                <td className="small num">{time(l.at)}</td>
                <td className="small">{l.user || l.email || "–"}</td>
                <td className="small">{l.channel === "claude" ? "Claude" : "Fragefeld"}</td>
                <td className="small">{titleOf.get(l.tool) ?? l.tool}{l.summary ? ` – ${l.summary}` : ""}{!l.ok && <span className="tag tag-warn" style={{ marginLeft: 4 }}>nicht ausgeführt</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
