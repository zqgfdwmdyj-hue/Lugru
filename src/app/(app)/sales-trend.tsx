"use client";

import { useEffect, useRef, useState } from "react";
import type { SalesDay } from "@/lib/sellerboard/sales";
import type { SbChannel } from "@/lib/sellerboard/parse";

// Verlauf der letzten 30 Tage: Umsatz je Tag (gestapelt Amazon/eBay) und Gewinn je Tag – zwei Diagramme mit
// gleicher Zeitachse statt zwei Skalen in einem. Hover/Fokus zeigt alle Werte des Tages; Tabelle als Alternative.

const LABEL: Record<SbChannel, string> = { amazon: "Amazon", ebay: "eBay" };
const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const dayLabel = (iso: string) => `${WD[new Date(`${iso}T12:00:00Z`).getUTCDay()]}, ${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

function niceTicks(min: number, max: number, count = 3) {
  if (max - min < 1e-9) max = min + 1;
  const raw = (max - min) / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}
const tick = (v: number) => (Math.abs(v) >= 10_000 ? `${(v / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} T` : v.toLocaleString("de-DE", { maximumFractionDigits: 0 }));

/** Säule mit 4px gerundetem Datenende, eckig an der Grundlinie (y0 = Grundlinie, y1 = Datenende). */
function colPath(x: number, w: number, y0: number, y1: number, round: boolean) {
  const h = Math.abs(y0 - y1);
  const r = round ? Math.min(4, h, w / 2) : 0;
  const up = y1 < y0;
  const e = up ? y1 + r : y1 - r;
  return `M${x},${y0}L${x},${e}Q${x},${y1} ${x + r},${y1}L${x + w - r},${y1}Q${x + w},${y1} ${x + w},${e}L${x + w},${y0}Z`;
}

export function SalesTrend({ days, channels }: { days: SalesDay[]; channels: SbChannel[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hasData = days.some((d) => d.amazon || d.ebay);
  const total = (d: SalesDay, k: "sales" | "netProfit") => (d.amazon?.[k] ?? 0) + (d.ebay?.[k] ?? 0);
  const left = 44;
  const plotW = width - left - 4;
  const band = plotW / days.length;
  const barW = Math.max(3, Math.min(24, band - 2));
  const xOf = (i: number) => left + i * band + (band - barW) / 2;

  // Umsatz
  const sH = 130;
  const sTicks = niceTicks(0, Math.max(1, ...days.map((d) => total(d, "sales"))));
  const sMax = sTicks[sTicks.length - 1];
  const sY = (v: number) => 6 + (sH - 12) * (1 - v / sMax);
  // Gewinn
  const pH = 96;
  const pVals = days.map((d) => total(d, "netProfit"));
  const pTicks = niceTicks(Math.min(0, ...pVals), Math.max(1, ...pVals), 2);
  const pMin = pTicks[0];
  const pMax = pTicks[pTicks.length - 1];
  const pY = (v: number) => 6 + (pH - 12) * (1 - (v - pMin) / (pMax - pMin));

  const hd = hover === null ? null : days[hover];
  const today = days.length - 1;

  return (
    <div ref={wrap} className="sales-trend" data-testid="sales-trend">
      <div className="sales-trend-head">
        <strong>Verlauf 30 Tage</strong>
        {channels.length > 1 && (
          <span className="sales-legend" data-testid="sales-legend">
            {channels.map((c) => (
              <span key={c}>
                <span className={`sales-key sales-key-${c}`} aria-hidden="true" /> {LABEL[c]}
              </span>
            ))}
          </span>
        )}
        <button type="button" className="btn-link small" onClick={() => setTable((t) => !t)} data-testid="sales-trend-toggle" style={{ marginLeft: "auto" }}>
          {table ? "Als Diagramm" : "Als Tabelle"}
        </button>
      </div>
      {!hasData ? (
        <div className="small muted" style={{ padding: "4px 0 10px" }}>Der Verlauf kommt mit dem nächsten großen Abgleich (einmal täglich oder „Jetzt abgleichen“).</div>
      ) : table ? (
        <div className="sales-scroll">
          <table className="table" data-testid="sales-trend-table">
            <thead>
              <tr>
                <th>Tag</th>
                {channels.length > 1 && channels.map((c) => <th key={c} className="right">Umsatz {LABEL[c]}</th>)}
                <th className="right">Umsatz</th>
                <th className="right">Gewinn</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.day}>
                  <td>{dayLabel(d.day)}{d.day === days[today].day ? " (läuft)" : ""}</td>
                  {channels.length > 1 && channels.map((c) => <td key={c} className="right num">{d[c] ? eur(d[c]!.sales) : "–"}</td>)}
                  <td className="right num">{d.amazon || d.ebay ? eur(total(d, "sales")) : "–"}</td>
                  <td className="right num" style={total(d, "netProfit") < 0 ? { color: "var(--danger)" } : undefined}>{d.amazon || d.ebay ? eur(total(d, "netProfit")) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="sales-chart" onPointerLeave={() => setHover(null)}>
          <div className="sales-chart-title small muted">Umsatz je Tag (€)</div>
          <svg width={width} height={sH} role="img" aria-label={`Umsatz der letzten 30 Tage, zuletzt ${eur(total(days[today], "sales"))} heute`}>
            {sTicks.map((v) => (
              <g key={v}>
                <line x1={left} x2={width - 4} y1={sY(v)} y2={sY(v)} className="sales-grid-line" />
                <text x={left - 6} y={sY(v) + 4} textAnchor="end" className="sales-tick">{tick(v)}</text>
              </g>
            ))}
            {days.map((d, i) => {
              const a = d.amazon?.sales ?? 0;
              const e = d.ebay?.sales ?? 0;
              const ya = sY(Math.max(0, a));
              const ye = sY(Math.max(0, a) + Math.max(0, e));
              const gap = a > 0 && ye < ya - 2 ? 2 : 0;
              return (
                <g key={d.day}>
                  {hover === i && <rect x={left + i * band} y={0} width={band} height={sH} className="sales-hover-band" />}
                  {a > 0 && <path d={colPath(xOf(i), barW, sY(0), ya, e <= 0 || ye >= ya - 2)} className="sales-bar-amazon" />}
                  {e > 0 && ye < ya - gap && <path d={colPath(xOf(i), barW, ya - gap, ye, true)} className="sales-bar-ebay" />}
                </g>
              );
            })}
            {days.map((d, i) => (
              <rect key={`hit-${d.day}`} x={left + i * band} y={0} width={band} height={sH} fill="transparent" onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />
            ))}
          </svg>
          <div className="sales-chart-title small muted">Gewinn je Tag (€)</div>
          <svg width={width} height={pH + 18} role="img" aria-label={`Gewinn der letzten 30 Tage, zuletzt ${eur(total(days[today], "netProfit"))} heute`}>
            {pTicks.map((v) => (
              <g key={v}>
                <line x1={left} x2={width - 4} y1={pY(v)} y2={pY(v)} className={v === 0 ? "sales-zero-line" : "sales-grid-line"} />
                <text x={left - 6} y={pY(v) + 4} textAnchor="end" className="sales-tick">{tick(v)}</text>
              </g>
            ))}
            {days.map((d, i) => {
              if (!d.amazon && !d.ebay) return null;
              const v = total(d, "netProfit");
              return (
                <g key={d.day}>
                  {hover === i && <rect x={left + i * band} y={0} width={band} height={pH} className="sales-hover-band" />}
                  {v !== 0 && <path d={colPath(xOf(i), barW, pY(0), pY(v), true)} className="sales-bar-profit" />}
                </g>
              );
            })}
            {days.map((d, i) =>
              i === today || (today - i) % 7 === 0 ? (
                <text key={`x-${d.day}`} x={left + i * band + band / 2} y={pH + 14} textAnchor={i === today ? "end" : "middle"} className="sales-tick">
                  {i === today ? "heute" : `${d.day.slice(8, 10)}.${d.day.slice(5, 7)}.`}
                </text>
              ) : null,
            )}
            {days.map((d, i) => (
              <rect key={`hit-${d.day}`} x={left + i * band} y={0} width={band} height={pH} fill="transparent" onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />
            ))}
          </svg>
          {/* Tastatur: ein Fokuspunkt, Pfeiltasten wechseln den Tag */}
          <div
            className="sales-kbd"
            tabIndex={0}
            role="slider"
            aria-label="Tag im Verlauf"
            aria-valuemin={0}
            aria-valuemax={today}
            aria-valuenow={hover ?? today}
            aria-valuetext={hd ? `${dayLabel(hd.day)}: Umsatz ${eur(total(hd, "sales"))}, Gewinn ${eur(total(hd, "netProfit"))}` : undefined}
            onFocus={() => setHover((h) => h ?? today)}
            onBlur={() => setHover(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? today) - 1));
              if (e.key === "ArrowRight") setHover((h) => Math.min(today, (h ?? today) + 1));
            }}
          />
          {hd && (
            <div
              className="sales-tip"
              data-testid="sales-tip"
              style={{ left: Math.min(Math.max(left + hover! * band + band / 2 - 95, 0), width - 190) }}
              role="status"
            >
              <div className="small muted">{dayLabel(hd.day)}{hover === today ? " · läuft noch" : ""}</div>
              {!hd.amazon && !hd.ebay ? (
                <div className="small">Keine Werte</div>
              ) : (
                <>
                  <div className="sales-tip-row"><strong>{eur(total(hd, "sales"))}</strong> <span className="muted">Umsatz</span></div>
                  {channels.length > 1 &&
                    channels.map((c) => (
                      <div key={c} className="sales-tip-row small">
                        <span className={`sales-line sales-line-${c}`} aria-hidden="true" />
                        <strong>{hd[c] ? eur(hd[c]!.sales) : "–"}</strong> <span className="muted">{LABEL[c]}</span>
                      </div>
                    ))}
                  <div className="sales-tip-row" style={{ marginTop: 4 }}>
                    <strong style={total(hd, "netProfit") < 0 ? { color: "var(--danger)" } : undefined}>{eur(total(hd, "netProfit"))}</strong> <span className="muted">Gewinn</span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
