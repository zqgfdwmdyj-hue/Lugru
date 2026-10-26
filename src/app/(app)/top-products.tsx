"use client";

import { useState } from "react";
import type { TopItem } from "@/lib/sellerboard/sales";

// Meistverkaufte Produkte heute/gestern (Amazon + eBay zusammen, nach Einheiten).

const eur = (n: number | null) => (n === null ? "–" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
const LABEL = { amazon: "Amazon", ebay: "eBay" } as const;

export function TopProducts({ top }: { top: { heute: { rows: TopItem[]; total: number }; gestern: { rows: TopItem[]; total: number } } }) {
  const [tab, setTab] = useState<"heute" | "gestern">("heute");
  const cur = top[tab];
  return (
    <div className="sales-top" data-testid="sales-top">
      <div className="sales-top-head">
        <strong>Produkte</strong>
        <div className="seg" role="tablist" aria-label="Zeitraum">
          {(["heute", "gestern"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`chip${tab === k ? " active" : ""}`} onClick={() => setTab(k)} data-testid={`sales-top-${k}`}>
              {k === "heute" ? "Heute" : "Gestern"}
            </button>
          ))}
        </div>
      </div>
      {cur.rows.length === 0 ? (
        <div className="small muted" style={{ padding: "6px 0 10px" }} data-testid="sales-top-empty">{tab === "heute" ? "Heute noch keine Verkäufe." : "Keine Verkäufe."}</div>
      ) : (
        <div className="sales-scroll">
          <table className="table sales-top-table">
            <thead>
              <tr>
                <th>Produkt</th>
                <th className="right">Einh.</th>
                <th className="right">Erstatt.</th>
                <th className="right">Umsatz</th>
                <th className="right">Gewinn</th>
              </tr>
            </thead>
            <tbody>
              {cur.rows.map((r, i) => (
                <tr key={`${r.channel}-${r.sku ?? i}-${i}`} data-testid="sales-top-row" data-channel={r.channel}>
                  <td>
                    <div className="sales-prod">
                      {r.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.image} alt="" width={36} height={36} loading="lazy" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="sales-prod-ph" aria-hidden="true" />
                      )}
                      <div style={{ minWidth: 0 }}>
                        <div className="sales-prod-name" title={r.name ?? undefined}>{r.link ? <a href={r.link} target="_blank" rel="noreferrer noopener">{r.name ?? r.sku}</a> : (r.name ?? r.sku)}</div>
                        <div className="small muted">
                          <span className={`sales-key sales-key-${r.channel}`} aria-hidden="true" /> {LABEL[r.channel]}
                          {r.sku ? ` · ${r.sku}` : ""}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="right num">{r.units}</td>
                  <td className="right num">{r.refunds}</td>
                  <td className="right num">{eur(r.sales)}</td>
                  <td className="right num" style={r.netProfit !== null && r.netProfit < 0 ? { color: "var(--danger)" } : undefined}>{eur(r.netProfit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cur.total > cur.rows.length && <div className="small muted" style={{ padding: "6px 0" }}>Die {cur.rows.length} meistverkauften von {cur.total} Produkten.</div>}
    </div>
  );
}
