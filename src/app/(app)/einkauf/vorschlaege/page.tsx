import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { formatEuro } from "@/lib/numbers";
import { purchaseSuggestions } from "@/lib/purchasing/service";
import { SuggestSubmit } from "../forms";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysIso, todayIso } from "@/lib/dates";
import { formatDate } from "@/lib/numbers";

const clampInt = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};

export default async function VorschlaegePage({ searchParams }: { searchParams: Promise<{ lieferzeit?: string; reichweite?: string; alle?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const leadDays = clampInt(sp.lieferzeit, 14, 0, 120);
  const coverDays = clampInt(sp.reichweite, 30, 7, 365);
  const all = sp.alle === "1";
  const rows = await purchaseSuggestions(session.tenantId, { leadDays, coverDays, all });
  // Nachbestellen laut sellerboard (eigene Rechnung mit Lieferzeiten/Puffer aus sellerboard) – nur Lesen.
  const SBI = schema.sellerboardInventory;
  const sbRows = await db
    .select()
    .from(SBI)
    .where(and(eq(SBI.tenantId, session.tenantId), gt(SBI.qtyToReorder, 0), sql`upper(coalesce(${SBI.timeToReorder}, '')) in ('YES', 'SOON')`))
    .orderBy(desc(sql`upper(coalesce(${SBI.timeToReorder}, '')) = 'YES'`), asc(SBI.daysToReorder), asc(SBI.daysLeft))
    .limit(300);
  const sbStand = sbRows[0]?.syncedAt ?? null;
  const today = todayIso();

  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/einkauf">Einkauf</Link></div><h1>Bestellvorschläge</h1></div>
      </div>
      <p className="muted" style={{ margin: 0, maxWidth: 860 }}>
        Wie in JTL: Aus dem Abverkauf der letzten 30 und 90 Tage (alle Kanäle), dem Bestand (FBA, unterwegs zu Amazon, eigenes Lager) und offenen Bestellungen wird berechnet, was nachgekauft werden sollte,
        damit die Ware über die Lieferzeit plus die gewünschte Reichweite reicht. Einkaufspreis vorbelegt mit dem günstigsten Feed-Angebot bzw. dem letzten EK.
      </p>
      <form className="card card-pad" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="field"><label className="label" htmlFor="lz">Lieferzeit (Tage)</label><input className="input" id="lz" name="lieferzeit" type="number" defaultValue={leadDays} style={{ width: 110 }} /></div>
        <div className="field"><label className="label" htmlFor="rw">Reichweite danach (Tage)</label><input className="input" id="rw" name="reichweite" type="number" defaultValue={coverDays} style={{ width: 110 }} /></div>
        <label className="small" style={{ display: "flex", gap: 6, alignItems: "center", paddingBottom: 10 }}><input type="checkbox" name="alle" value="1" defaultChecked={all} /> auch Artikel ohne Bedarf zeigen</label>
        <button className="btn" type="submit">Neu berechnen</button>
      </form>

      {sbRows.length > 0 && (
        <section className="card" style={{ overflow: "auto" }} id="sellerboard" data-testid="sb-reorder">
          <div className="card-head">
            <div>
              <h2>Nachbestellen laut sellerboard</h2>
              <div className="small muted" style={{ marginTop: 2 }}>
                {sbRows.filter((r) => (r.timeToReorder ?? "").toUpperCase() === "YES").length} jetzt · {sbRows.filter((r) => (r.timeToReorder ?? "").toUpperCase() === "SOON").length} bald · Stand {sbStand ? sbStand.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–"} · sellerboard rechnet mit seinen eigenen Lieferzeiten und Puffern (dort einstellbar).
              </div>
            </div>
            <span className="small muted">Investition ca. {formatEuro(sbRows.reduce((s, r) => s + (r.cost ?? 0) * r.qtyToReorder, 0))}{sbRows.some((r) => r.cost === null) ? " (ohne Artikel ohne EK)" : ""}</span>
          </div>
          <table className="table">
            <thead><tr><th>Artikel</th><th className="right">FBA</th><th className="right">Unterwegs</th><th className="right">Pro Tag</th><th className="right">Reicht noch</th><th className="right">Menge</th><th>Bestellen bis</th><th className="right">EK × Menge</th></tr></thead>
            <tbody>
              {sbRows.map((r) => {
                const now = (r.timeToReorder ?? "").toUpperCase() === "YES";
                const by = r.daysToReorder === null ? null : r.daysToReorder <= 0 ? today : addDaysIso(today, r.daysToReorder);
                return (
                  <tr key={r.id} data-testid="sb-reorder-row" data-sku={r.sku}>
                    <td style={{ maxWidth: 320 }}>
                      <Link href={`/produkte/sku/${encodeURIComponent(r.sku)}`} className="num">{r.sku}</Link>
                      <div className="small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name ?? ""}</div>
                    </td>
                    <td className="num right">{r.fbaStock}</td>
                    <td className="num right">{r.inbound || "–"}</td>
                    <td className="num right">{r.salesVelocity === null ? "–" : Number(r.salesVelocity).toLocaleString("de-DE")}</td>
                    <td className="num right" style={r.daysLeft !== null && r.daysLeft < 14 ? { color: "var(--danger)", fontWeight: 600 } : undefined}>{r.daysLeft === null ? "–" : `${r.daysLeft} T.`}</td>
                    <td className="num right"><strong>{r.qtyToReorder}</strong></td>
                    <td>{now ? <span className="tag tag-danger">{r.daysToReorder !== null && r.daysToReorder < 0 ? `überfällig seit ${-r.daysToReorder} T.` : "jetzt"}</span> : <span className="tag tag-warn">bald{by ? ` – bis ${formatDate(by)}` : ""}</span>}</td>
                    <td className="num right">{r.cost === null ? <span className="muted">EK fehlt</span> : formatEuro(r.cost * r.qtyToReorder)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <SuggestSubmit>
        <section className="card" style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }}></th><th>Artikel</th><th className="right">Verkauft 30/90 T.</th><th className="right">Pro Tag</th>
                <th className="right">FBA</th><th className="right">Unterwegs</th><th className="right">Lager</th><th className="right">Bestellt</th><th className="right">Reicht</th>
                <th className="right">Vorschlag</th><th>Lieferant</th><th className="right">EK brutto</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={12} className="muted">Kein Nachkaufbedarf – oder noch keine Verkaufsdaten (Aufträge bzw. Amazon-Abrechnungen importieren).</td></tr>}
              {rows.map((r) => {
                const ekNum = r.bestOffer?.price ?? (r.lastCostNet != null ? r.lastCostNet * 1.19 : null);
                const ek = ekNum == null ? "" : ekNum.toFixed(2).replace(".", ",");
                const sup = r.bestOffer?.supplier ?? r.lastSupplier ?? "";
                return (
                  <tr key={r.asin}>
                    <td><input type="checkbox" name="pick" value={r.asin} defaultChecked={r.need > 0 && Boolean(sup)} aria-label={`${r.asin} übernehmen`} /></td>
                    <td style={{ maxWidth: 300 }}>
                      <span className="num">{r.asin}</span>
                      <div className="small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title ?? ""}</div>
                      <input type="hidden" name={`title:${r.asin}`} value={r.title ?? ""} />
                      {r.lastDate && <div className="small muted">zuletzt {r.lastSupplier} · {r.lastCostNet != null ? `${formatEuro(r.lastCostNet)} netto` : ""}</div>}
                    </td>
                    <td className="num right">{r.sold30} / {r.sold90}</td>
                    <td className="num right">{r.daily.toLocaleString("de-DE")}</td>
                    <td className="num right">{r.fba}</td>
                    <td className="num right">{r.inbound}</td>
                    <td className="num right">{r.own}</td>
                    <td className="num right">{r.onOrder || "–"}</td>
                    <td className="num right" style={r.daysLeft !== null && r.daysLeft < leadDays ? { color: "var(--danger)", fontWeight: 600 } : undefined}>{r.daysLeft === null ? "–" : `${r.daysLeft} T.`}</td>
                    <td className="right"><input className="input" name={`qty:${r.asin}`} defaultValue={r.need || ""} inputMode="numeric" style={{ width: 64, textAlign: "right" }} aria-label="Menge" /></td>
                    <td><input className="input" name={`sup:${r.asin}`} defaultValue={sup} style={{ width: 110 }} aria-label="Lieferant" />{r.bestOffer && <div className="small muted">Feed{r.bestOffer.stock != null ? `, ${r.bestOffer.stock} verfügbar` : ""}</div>}</td>
                    <td className="right"><input className="input" name={`ek:${r.asin}`} defaultValue={ek} inputMode="decimal" style={{ width: 84, textAlign: "right" }} aria-label="EK brutto" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </SuggestSubmit>
    </>
  );
}
