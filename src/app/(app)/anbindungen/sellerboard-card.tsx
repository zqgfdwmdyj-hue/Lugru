import { and, eq, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { readConn } from "@/lib/sellerboard/connection";
import { sellerboardSyncRunning } from "@/lib/sellerboard/sync";
import { zaehlerAnzeige } from "@/lib/sellerboard/budget";
import { AutoRefresh } from "../lieferanten/finden/refresh";
import { sellerboardAutomatikAction, sellerboardDisconnectAction, sellerboardSyncAction } from "./actions";

const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–");

/** Karte „sellerboard“: verbinden (Anmeldung bei sellerboard), Stand, Abgleich, trennen. */
export async function SellerboardCard({ tenantId, message }: { tenantId: string; message?: string }) {
  const conn = await readConn(tenantId);
  const connected = Boolean(conn?.secrets.refreshToken || conn?.secrets.accessToken);
  // „läuft“ nur, solange dieser Server-Prozess wirklich abgleicht (nach einem Neustart nicht hängen bleiben).
  const running = sellerboardSyncRunning(tenantId);
  const c = conn?.config;
  const [[stock], [costs], [fix]] = connected
    ? await Promise.all([
        db.select({ n: sql<number>`count(*)::int` }).from(schema.amazonInventory).where(and(eq(schema.amazonInventory.tenantId, tenantId), eq(schema.amazonInventory.source, "sellerboard"))),
        db.select({ n: sql<number>`count(*) filter (where ${schema.sellerboardProducts.cost} is not null)::int` }).from(schema.sellerboardProducts).where(eq(schema.sellerboardProducts.tenantId, tenantId)),
        db.select({ n: sql<number>`count(*)::int` }).from(schema.cashItems).where(and(eq(schema.cashItems.tenantId, tenantId), like(schema.cashItems.externalRef, "sellerboard:%"))),
      ])
    : [[{ n: 0 }], [{ n: 0 }], [{ n: 0 }]];
  // B29: Aufrufe heute (Limit 125 je Tag für alle Nutzer zusammen, Rücksetzung 00:00 UTC)
  const z = connected ? await zaehlerAnzeige(tenantId) : null;
  return (
    <section className="card" id="sellerboard" data-testid="sellerboard-card">
      <AutoRefresh active={running} everyMs={4000} />
      <div className="card-head">
        <div>
          <h2>sellerboard</h2>
          <div className="small muted" style={{ marginTop: 2 }}>Nur lesend: Einkaufspreise, FBA-Bestand, Nachbestell-Hinweise, FBA-Sendungen (Fehlmengen → Ansprüche), Gewinn je Monat/SKU und Fixkosten.</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {connected ? <span className="tag tag-ok" data-testid="sb-status">VERBUNDEN</span> : <span className="tag tag-neutral" data-testid="sb-status">NICHT VERBUNDEN</span>}
          {!connected && <a className="btn btn-primary btn-small" href="/api/sellerboard/start" data-testid="sb-connect">Mit sellerboard verbinden</a>}
        </div>
      </div>
      <div className="card-pad stack small" style={{ gap: 8 }}>
        {message && message !== "ok" && <div className="notice notice-warn" data-testid="sb-message">{message}</div>}
        {message === "ok" && <div className="notice notice-ok" data-testid="sb-message">Verbunden – der erste Abgleich läuft im Hintergrund (kann ein paar Minuten dauern).</div>}
        {!connected ? (
          <div className="muted">
            „Mit sellerboard verbinden“ öffnet die Anmeldung bei sellerboard; dort den Lesezugriff erlauben. Das Seller-System speichert den Zugang verschlüsselt und gleicht danach selbst ab – zu festen Uhrzeiten mit Tagesbudget (sellerboard erlaubt 125 Aufrufe am Tag für alle Nutzer zusammen).
            <div style={{ marginTop: 6 }} data-testid="sb-mobile-hint">
              Am Handy: Bleibt die sellerboard-Seite auf „Loading…“ stehen, vorher im selben Browser bei sellerboard anmelden – oder einmal am Computer verbinden.
            </div>
          </div>
        ) : (
          <>
            <div data-testid="sb-account">Konto: <strong>{c?.accountName ?? "–"}</strong> · verbunden seit {dt(c?.connectedAt)}</div>
            <div data-testid="sb-last">
              {running ? <strong>⏳ {c?.syncing ?? "Abgleich läuft …"}</strong> : <>Letzter Abgleich: <strong>{dt(c?.lastSyncAt)}</strong></>}
              {c?.lastCounts && !running && <span className="muted"> · {[c.lastCounts.produkte !== undefined && `${c.lastCounts.produkte} Produkte`, c.lastCounts.bestand !== undefined && `${c.lastCounts.bestand} Bestandszeilen`, c.lastCounts.sendungen !== undefined && `${c.lastCounts.sendungen} Sendungen`, c.lastCounts.monate !== undefined && `${c.lastCounts.monate} Monate`, c.lastCounts.fixkosten !== undefined && `${c.lastCounts.fixkosten} Fixkosten`].filter(Boolean).join(" · ")}</span>}
            </div>
            {c?.lastSyncError && !running && <div style={{ color: "var(--danger)" }} data-testid="sb-error">Fehler beim letzten Abgleich: {c.lastSyncError}</div>}
            {z && (
              <div data-testid="sb-aufrufe">
                <strong>{z.text}</strong>
                <span className="muted"> · Automatik höchstens {z.obergrenze_automatik}, „Verkauf“ hat Vorrang, Rücksetzung 00:00 UTC{z.stand_laut_sellerboard ? ` · Stand laut sellerboard ${z.stand_laut_sellerboard}` : ""}{z.uebersprungen_heute ? ` · ${z.uebersprungen_heute} Lauf/Läufe heute übersprungen (Tagesbudget)` : ""}</span>
                {z.pausiert_bis && <div className="notice notice-warn" style={{ marginTop: 6 }} data-testid="sb-pausiert">sellerboard-Tageslimit erreicht – alle Abrufe pausiert bis {z.pausiert_bis.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" })} Uhr, danach automatisch nachholen (Verkauf → Gewinn je Produkt → Rest).</div>}
                {z.morgenbericht_zeile && <div className="muted" data-testid="sb-gestern">{z.morgenbericht_zeile}</div>}
              </div>
            )}
            <div className="muted" data-testid="sb-usage">Im Einsatz: FBA-Bestand für {stock.n} SKU · EK in sellerboard für {costs.n} Produkte (gilt nur, wo im Seller-System kein eigener hinterlegt ist) · {fix.n} Fixkosten im Cash Flow.</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <form action={sellerboardSyncAction}><input type="hidden" name="scope" value="alles" /><button className="btn btn-small btn-primary" type="submit" disabled={running} data-testid="sb-sync" title="Alles von Hand – braucht ca. 40–60 der 125 Tagesaufrufe">Jetzt abgleichen</button></form>
              <form action={sellerboardSyncAction}><input type="hidden" name="scope" value="bestand" /><button className="btn btn-small" type="submit" disabled={running}>Nur Bestand</button></form>
              <form action={sellerboardAutomatikAction}><button className="btn btn-small" type="submit" disabled={running} data-testid="sb-automatik" title="Nur was laut Zeitplan fällig ist, mit Tagesbudget">Fällige Abrufe nachholen</button></form>
              <form action={sellerboardDisconnectAction}><button className="btn-link small" type="submit" style={{ color: "var(--danger)" }} data-testid="sb-disconnect">Verbindung trennen</button></form>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
