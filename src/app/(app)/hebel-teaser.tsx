import Link from "next/link";
import type { HebelData } from "@/lib/hebel/service";
import { HEBEL_INFO } from "@/lib/hebel/rules";

// Startseite: die fünf größten Hebel für Umsatz und Marge.

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

export function HebelTeaser({ data }: { data: HebelData }) {
  const top = data.list.filter((h) => h.impact > 0).slice(0, 5);
  if (!top.length) return null;
  const total = data.summary.filter((s) => s.type !== "ek_fehlt").reduce((n, s) => n + s.impact, 0);
  return (
    <section className="card hebel-teaser" data-testid="hebel-teaser">
      <div className="card-head" style={{ flexWrap: "wrap", gap: 8 }}>
        <h2>
          Hebel: mehr Umsatz &amp; Marge <span className="small muted" style={{ fontWeight: 400 }}>zusammen ca. {eur(total)} im Monat</span>
        </h2>
        <Link href="/hebel" className="small">Alle {data.list.length} ansehen →</Link>
      </div>
      {top.map((h) => (
        <Link key={h.key} href={`/hebel?typ=${h.type}`} className="hebel-teaser-row" data-testid="hebel-teaser-row">
          <span className="tag tag-neutral" style={{ flexShrink: 0 }}>{HEBEL_INFO[h.type].label.toUpperCase()}</span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <strong style={{ overflowWrap: "anywhere" }}>{h.name ?? h.sku}</strong>
            <span className="small muted"> · {h.headline}</span>
          </span>
          <span className="num" style={{ flexShrink: 0 }}>{eur(h.impact)}</span>
        </Link>
      ))}
    </section>
  );
}
