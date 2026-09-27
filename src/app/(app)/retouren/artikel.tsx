import Link from "next/link";
import { formatEuro } from "@/lib/numbers";
import type { Mode, SkuStat } from "@/lib/returns/reconcile";

const COLS: [keyof SkuStat, string, boolean][] = [
  ["sku", "SKU / Artikel", false],
  ["sold", "Verkauft", true],
  ["refunded", "Erstattet", true],
  ["rate", "Retourenquote", true],
  ["notReturned", "Nicht zurück", true],
  ["refundAmount", "Erstatteter Betrag", true],
  ["open", "Offen", true],
];

const n1 = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

export function Artikel({ stats, mode, sort, dir, q }: { stats: SkuStat[]; mode: Mode; sort: string; dir: 1 | -1; q: string }) {
  const key = (COLS.find((c) => c[0] === sort)?.[0] ?? "rate") as keyof SkuStat;
  const nq = norm(q);
  const rows = stats
    .filter((s) => !nq || norm(s.sku + s.title).includes(nq))
    .sort((a, b) => {
      const va = key === "sku" ? a.sku : ((a[key] as number | null) ?? -1);
      const vb = key === "sku" ? b.sku : ((b[key] as number | null) ?? -1);
      return (va > vb ? 1 : va < vb ? -1 : 0) * dir;
    });
  const maxRate = Math.max(1, ...rows.map((s) => s.rate ?? 0));
  const href = (p: Record<string, string>) => `/retouren?${new URLSearchParams({ ansicht: "artikel", modus: mode, sort: key, dir: String(dir), ...(q ? { q } : {}), ...p })}`;

  return (
    <>
      <div className="between" style={{ flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <Link className={`chip${mode === "fba" ? " active" : ""}`} href="/retouren?ansicht=artikel&modus=fba">Versand durch Amazon (FBA)</Link>
          <Link className={`chip${mode === "fbm" ? " active" : ""}`} href="/retouren?ansicht=artikel&modus=fbm">Händlerversand (FBM)</Link>
        </div>
        <form style={{ display: "flex", gap: 6 }}>
          <input type="hidden" name="ansicht" value="artikel" />
          <input type="hidden" name="modus" value={mode} />
          <input className="input" type="search" name="q" defaultValue={q} placeholder="SKU oder Artikel suchen …" aria-label="Artikel suchen" style={{ width: 240 }} />
        </form>
      </div>
      <p className="small muted">Retourenquote = erstattete Menge geteilt durch verkaufte Menge im hochgeladenen Zeitraum. Die Verkäufe kommen aus dem Transaktionsbericht bzw. den Abrechnungen.</p>
      <section className="card" style={{ overflow: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              {COLS.map(([k, label, num]) => (
                <th key={k} className={num ? "right" : undefined}>
                  <Link href={href({ sort: k, dir: String(k === key ? -dir : k === "sku" ? 1 : -1) })} style={{ color: "inherit", textDecoration: "none" }}>
                    {label}{k === key ? (dir < 0 ? " ▾" : " ▴") : ""}
                  </Link>
                </th>
              ))}
              <th>Häufigste Gründe</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="muted">Noch keine Artikeldaten.</td></tr>}
            {rows.map((s) => (
              <tr key={s.sku}>
                <td style={{ maxWidth: 300 }}><div className="num small">{s.sku || "–"}</div><div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div></td>
                <td className="num right">{n1(s.sold)}</td>
                <td className="num right">{n1(s.refunded)}</td>
                <td className="num right" style={{ whiteSpace: "nowrap" }}>
                  {s.rate === null ? "–" : `${n1(s.rate)} %`}
                  {s.rate ? <span style={{ display: "inline-block", verticalAlign: "middle", marginLeft: 8, height: 6, borderRadius: 3, background: "#C8375F", width: Math.round((s.rate / maxRate) * 60) }} /> : null}
                </td>
                <td className="num right">{n1(s.notReturned)}</td>
                <td className="num right">{formatEuro(s.refundAmount)}</td>
                <td className="num right">{s.open ? formatEuro(s.open) : "–"}</td>
                <td className="small">{s.topReasons.map((x) => `${x.reason} (${n1(x.count)})`).join(", ") || "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
