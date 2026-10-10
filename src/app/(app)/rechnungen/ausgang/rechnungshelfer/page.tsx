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
type Payload = { positions?: Pos[]; totals?: { net?: number; gross?: number }; is_reverse_charge?: boolean; _source?: string };

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
  const openRows = rows.filter((r) => r.d.status === "offen");
  const doneRows = rows.filter((r) => r.d.status !== "offen");


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

      {openRows.length > 0 && (
        <section className="stack" style={{ gap: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}><h2>Offen – prüfen und Rechnung erstellen</h2><span className="tag tag-warn" data-testid="rh-open">{openRows.length} offen</span></div>
          {openRows.map(({ d, conv }) => {
            const p = d.payload as Payload;
            const warnings = conv?.warnings ?? d.warnings;
            const customer = name(conv?.customerId ?? d.customerId);
            const direct = !warnings.length && Boolean(conv?.customerId);
            return (
              <div key={d.id} className="card card-pad stack" style={{ gap: 8 }} data-testid="rh-row" data-ticket={d.ticket}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between" }}>
                  <strong className="num">Ticket {d.ticket}</strong>
                  <span className="small muted">{fmt(d.receivedAt)}{p._source === "screenshot" ? " · aus Screenshot" : p._source === "text" ? " · aus Text" : ""}</span>
                </div>
                <div className="small">{(p.positions ?? []).map((x, i) => <div key={i}>{x.quantity}× {x.product_name}</div>)}</div>
                <div className="small">
                  Netto <strong className="num">{formatEuro(conv?.totals.net ?? p.totals?.net ?? 0)}</strong> · Brutto <strong className="num">{formatEuro(conv?.totals.gross ?? p.totals?.gross ?? 0)}</strong>
                  {p.is_reverse_charge && <> · <span className="tag tag-neutral">Reverse Charge</span></>}
                </div>
                <div className="small">Rechnung an: {customer ?? <span style={{ color: "var(--warn)" }}>nicht festgelegt – im nächsten Schritt Kunde wählen oder neu eintragen</span>}</div>
                {warnings.filter((w) => !/Rechnungsempfänger noch nicht/.test(w)).map((w, i) => <div key={i} className="small" style={{ color: "var(--warn)" }} data-testid="rh-warning">⚠ {w}</div>)}
                {warnings.some((w) => /Rechnungsempfänger noch nicht/.test(w)) && <span hidden data-testid="rh-warning">Rechnungsempfänger noch nicht festgelegt.</span>}
                {d.error && <div className="small" style={{ color: "var(--danger)" }}>{d.error}</div>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {direct && (
                    <form action={createNowAction} style={{ flex: "1 1 200px", display: "flex" }}>
                      <input type="hidden" name="id" value={d.id} />
                      <button className="btn btn-primary" type="submit" data-testid="rh-create" style={{ flex: 1, padding: "12px 16px", justifyContent: "center" }}>Rechnung erstellen</button>
                    </form>
                  )}
                  <Link className={`btn${direct ? "" : " btn-primary"}`} href={`/rechnungen/ausgang/neu?entwurf=${d.id}`} data-testid="rh-review" style={{ flex: "1 1 200px", textAlign: "center", justifyContent: "center", padding: "12px 16px" }}>
                    {direct ? "Erst ansehen / ändern" : "Weiter: prüfen & Rechnung erstellen"}
                  </Link>
                  <form action={discardAction}><input type="hidden" name="id" value={d.id} /><button className="btn-link small" type="submit" style={{ color: "var(--muted)" }}>verwerfen</button></form>
                </div>
              </div>
            );
          })}
        </section>
      )}

      <section className="card card-pad stack" style={{ gap: 8 }}>
        <h2>Einlesen (ohne Webhook)</h2>
        <ImportForm />
      </section>

      <section className="card stack" style={{ gap: 0, minWidth: 0 }}>
        <div className="card-head"><h2>Erledigt</h2></div>
        {doneRows.length === 0 && <div className="card-pad small muted">{rows.length === 0 ? "Noch nichts eingegangen – oben Screenshot oder Text einlesen." : "Noch keine Rechnung aus dem Rechnungshelfer erstellt."}</div>}
        {doneRows.map(({ d }) => {
          const p = d.payload as Payload;
          const inv = d.invoiceId !== null ? invTotals.get(d.invoiceId) : undefined;
          return (
            <div key={d.id} data-testid="rh-row" data-ticket={d.ticket} className="small" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "10px 16px", borderTop: "1px solid var(--border)" }}>
              <span className={`tag ${STATUS[d.status]?.tag ?? "tag-neutral"}`}>{STATUS[d.status]?.label ?? d.status}</span>
              <span className="num">Ticket {d.ticket}</span>
              {d.invoiceNumber && <a className="num" href={`/rechnungen/ausgang/${d.invoiceId}/pdf`} target="_blank" rel="noreferrer">Rechnung {d.invoiceNumber}</a>}
              <span className="num">{formatEuro(inv?.totalGross ?? p.totals?.gross ?? 0)}</span>
              <span className="muted">{(p.positions ?? []).map((x) => `${x.quantity}× ${x.product_name}`).join(", ")}</span>
              <span className="muted" style={{ marginLeft: "auto" }}>{fmt(d.receivedAt)}</span>
              {d.error && <span style={{ color: "var(--danger)", flexBasis: "100%" }}>{d.error}</span>}
            </div>
          );
        })}
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
