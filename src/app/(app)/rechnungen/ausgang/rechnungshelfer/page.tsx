import Link from "next/link";
import { headers } from "next/headers";
import { requireArea } from "@/lib/auth/session";
import { listCustomers } from "@/lib/invoices/customers";
import { draftConversion, listDrafts, rhConfig } from "@/lib/invoices/rechnungshelfer-service";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { formatEuro } from "@/lib/numbers";
import { createNowAction, discardAction, settingsAction } from "./actions";
import { ImportForm } from "./import-form";
import { Copy, TokenForm } from "./token-form";

const fmt = (d: Date | string) => new Date(d).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const STATUS: Record<string, { label: string; tag: string }> = {
  offen: { label: "offen", tag: "tag-warn" },
  erstellt: { label: "erstellt", tag: "tag-ok" },
  verworfen: { label: "verworfen", tag: "tag-neutral" },
  ignoriert: { label: "ignoriert", tag: "tag-neutral" },
};

type Pos = { product_name?: string; quantity?: number };

export default async function RechnungshelferPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("buchhaltung");
  const sp = await searchParams;
  const t = session.tenantId;
  const [cfg, customers, drafts] = await Promise.all([rhConfig(t), listCustomers(t), listDrafts(t)]);
  const h = await headers();
  const base = (process.env.APP_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`).replace(/\/$/, "");
  const url = `${base}/api/public/rechnungshelfer`;
  const rows = await Promise.all(drafts.map(async (d) => ({ d, conv: d.status === "offen" ? await draftConversion(t, d).catch(() => null) : null })));
  // Erstellte: Beträge der tatsächlichen Rechnung zeigen.
  const invIds = drafts.map((d) => d.invoiceId).filter((x): x is number => x !== null);
  const I = schema.ebayInvoices;
  const invTotals = new Map(
    invIds.length
      ? (await db.select({ id: I.id, data: I.data }).from(I).where(and(eq(I.tenantId, t), inArray(I.id, invIds)))).map((r) => [r.id, r.data as { totalNet?: number; totalGross?: number }])
      : [],
  );
  const name = (id?: string | null) => customers.find((c) => c.id === id)?.name;
  const open = rows.filter((r) => r.d.status === "offen").length;


  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/rechnungen/ausgang">Ausgangsrechnungen</Link></div><h1>Rechnungshelfer (Discord)</h1></div>
        <Link className="btn" href="/rechnungen/kunden">Kunden</Link>
      </div>
      {sp.meldung && <div className="notice notice-info" data-testid="rh-msg">{sp.meldung}</div>}
      <div className="small muted" style={{ maxWidth: 760 }}>
        Aus dem „Rechnungshelfer“ im Ticket wird deine Rechnung im eigenen Nummernkreis (PDF + E-Rechnung) – sie geht wie jede B2B-Rechnung an Stotax. Ohne Webhook: Screenshot hochladen oder Text einfügen. Mit Webhook (Knopf <strong>JSON</strong> im Ticket) kommt alles von selbst.
      </div>

      <section className="card card-pad stack" style={{ gap: 8 }}>
        <h2>Einlesen (ohne Webhook)</h2>
        <ImportForm />
      </section>

      <section className="card" style={{ minWidth: 0, overflow: "auto" }}>
        <div className="card-head"><h2>Eingang</h2>{open > 0 && <span className="tag tag-warn" data-testid="rh-open">{open} offen</span>}</div>
        <table className="table">
          <thead><tr><th>Eingang</th><th>Ticket</th><th>Positionen</th><th className="right">Netto</th><th className="right">Brutto</th><th>Kunde</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="muted">Noch nichts eingegangen. Erst unten einrichten, dann im Ticket auf „JSON“ drücken.</td></tr>}
            {rows.map(({ d, conv }) => {
              const p = d.payload as { positions?: Pos[]; totals?: { net?: number; gross?: number }; is_reverse_charge?: boolean };
              const warnings = d.status === "offen" ? (conv?.warnings ?? d.warnings) : [];
              const inv = d.invoiceId !== null ? invTotals.get(d.invoiceId) : undefined;
              const net = conv?.totals.net ?? inv?.totalNet ?? p.totals?.net ?? 0;
              const gross = conv?.totals.gross ?? inv?.totalGross ?? p.totals?.gross ?? 0;
              return (
                <tr key={d.id} data-testid="rh-row" data-ticket={d.ticket}>
                  <td className="num small">{fmt(d.receivedAt)}</td>
                  <td className="num">{d.ticket}{p.is_reverse_charge && <div><span className="tag tag-neutral">Reverse Charge</span></div>}</td>
                  <td className="small" style={{ maxWidth: 280 }}>{(p.positions ?? []).map((x, i) => <div key={i}>{x.quantity}× {x.product_name}</div>)}</td>
                  <td className="num right">{formatEuro(net)}</td>
                  <td className="num right">{formatEuro(gross)}</td>
                  <td className="small">{name(conv?.customerId ?? d.customerId) ?? <span style={{ color: "var(--warn)" }}>nicht festgelegt</span>}</td>
                  <td className="small" style={{ maxWidth: 320 }}>
                    <span className={`tag ${STATUS[d.status]?.tag ?? "tag-neutral"}`}>{STATUS[d.status]?.label ?? d.status}</span>
                    {d.invoiceNumber && <> <a className="num" href={`/rechnungen/ausgang/${d.invoiceId}/pdf`} target="_blank" rel="noreferrer">{d.invoiceNumber}</a></>}
                    {warnings.map((w, i) => <div key={i} style={{ color: "var(--warn)" }} data-testid="rh-warning">{w}</div>)}
                    {d.error && <div style={{ color: "var(--danger)" }}>{d.error}</div>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {d.status === "offen" && (
                      <>
                        {!warnings.length && conv?.customerId && (
                          <form action={createNowAction} style={{ display: "inline" }}><input type="hidden" name="id" value={d.id} /><button className="btn btn-small btn-primary" type="submit" data-testid="rh-create">Erstellen</button></form>
                        )}
                        <Link className="btn btn-small" href={`/rechnungen/ausgang/neu?entwurf=${d.id}`} style={{ marginLeft: 6 }} data-testid="rh-review">Prüfen & erstellen</Link>
                        <form action={discardAction} style={{ display: "inline" }}><input type="hidden" name="id" value={d.id} /><button className="btn-link small" type="submit" style={{ marginLeft: 6, color: "var(--muted)" }}>verwerfen</button></form>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        <section className="card card-pad stack" style={{ gap: 10 }} data-testid="rh-setup">
          <h2>Webhook (Knopf „JSON“ im Ticket)</h2>
          <div className="small muted">Braucht auf dem Ankauf-Server mindestens die Rolle „Allstars“ – sonst (z. B. als VIP) oben per Screenshot oder Text einlesen.</div>
          <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Schlüssel erzeugen und kopieren.</li>
            <li>In Discord auf dem Dashboard-Server <span className="num">/webhook_pull</span> ausführen: Webhook-URL und Auth-Header einfügen.</li>
            <li>Rechnungsempfänger festlegen (der Ankäufer – oder beim ersten Entwurf auswählen, wird gemerkt).</li>
            <li>Im Ticket „Rechnungshelfer“ → <strong>JSON</strong> drücken.</li>
          </ol>
          <div className="stack" style={{ gap: 4 }}>
            <div className="label">Webhook-URL</div>
            <Copy value={url} testId="rh-url" />
          </div>
          <TokenForm hint={cfg.tokenHint} createdAt={cfg.tokenCreatedAt} />
          <div className="small muted">{cfg.lastReceivedAt ? `Letzter Eingang: ${fmt(cfg.lastReceivedAt)}.` : "Noch kein Eingang."} Andere Exporte über denselben Webhook (z. B. To-do-CSV) werden angenommen und ignoriert.</div>
        </section>

        <section className="card card-pad stack" style={{ gap: 10 }}>
          <h2>Rechnungsempfänger & Automatik</h2>
          <div className="small muted">Im JSON steht kein Käufer – alle Rechnungen aus dem Rechnungshelfer gehen an diesen Kunden (den Ankäufer). Anlegen unter <Link href="/rechnungen/kunden">Kunden</Link> (Firma, Anschrift, USt-IdNr.).</div>
          <form action={settingsAction} className="stack" style={{ gap: 8 }} data-testid="rh-settings">
            <div className="field">
              <label className="label" htmlFor="rh-customer">Rechnungsempfänger</label>
              <select className="select" name="customerId" id="rh-customer" defaultValue={cfg.customerId ?? ""}>
                <option value="">– noch nicht festgelegt –</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.city ? `, ${c.city}` : ""}</option>)}
              </select>
            </div>
            <label className="small" style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <input type="checkbox" name="auto" defaultChecked={Boolean(cfg.auto)} data-testid="rh-auto" />
              <span>Automatisch erstellen, wenn nichts zu prüfen ist (Empfänger festgelegt, Summen stimmen mit dem Rechnungshelfer überein, Reverse Charge eindeutig). Sonst bleibt es ein Entwurf.</span>
            </label>
            <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" name="mailCustomer" defaultChecked={Boolean(cfg.mailCustomer)} />
              Erstellte Rechnung gleich an den Kunden mailen (wenn beim Kunden eine E-Mail steht)
            </label>
            <div><button className="btn btn-small" type="submit">Speichern</button></div>
          </form>
        </section>
      </div>
    </>
  );
}
