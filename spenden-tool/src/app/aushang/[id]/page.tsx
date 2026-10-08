import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLogin } from "@/lib/auth";
import { PrintButton } from "@/components/print-button";
import { flyerSections } from "@/lib/layout";
import { loadEvent, loadEventItems } from "@/lib/service";
import { formatDate } from "@/lib/numbers";
import { FitSheet } from "./fit-sheet";

// Druckbarer Aushang „Unsere Spendenempfehlungen“ (A4), gestaltet wie der bisherige Zettel.
export default async function AushangPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ spalten?: string; groesse?: string }> }) {
  await requireLogin();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const event = await loadEvent(id);
  if (!event) notFound();
  const rows = await loadEventItems(id);
  const sections = flyerSections(rows.filter((r) => r.item.inFlyer).map((r) => ({ ...r.product, price: r.item.price, priceNote: r.item.priceNote, bestBefore: r.item.bestBefore })));
  const cols = [1, 2, 3, 4].includes(Number(sp.spalten)) ? Number(sp.spalten) : 3;
  // „auto“: so groß wie möglich (bis 26 px), sonst höchstens die gewählte Größe.
  const fixed = [12, 14, 16, 18, 20].includes(Number(sp.groesse)) ? Number(sp.groesse) : 0;
  const size = fixed || 26;
  const q = (o: { spalten?: number; groesse?: number | "auto" }) => `/aushang/${id}?spalten=${o.spalten ?? cols}&groesse=${o.groesse ?? (fixed || "auto")}`;

  return (
    <>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@600;700&display=swap" precedence="default" />
      <style>{CSS}</style>
      <div className="no-print" style={{ maxWidth: 794, margin: "0 auto", padding: "16px 0", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Link href={`/verteilung/${id}`} className="btn btn-small">← Zurück</Link>
        <span className="small muted" style={{ marginLeft: 8 }}>Spalten:</span>
        {[2, 3, 4].map((n) => <Link key={n} href={q({ spalten: n })} className={`chip${cols === n ? " active" : ""}`}>{n}</Link>)}
        <span className="small muted" style={{ marginLeft: 8 }}>Schrift:</span>
        <Link href={q({ groesse: "auto" })} className={`chip${!fixed ? " active" : ""}`}>auto</Link>
        {[12, 14, 16, 18, 20].map((n) => <Link key={n} href={q({ groesse: n })} className={`chip${fixed === n ? " active" : ""}`}>{n}</Link>)}
        <span style={{ flexGrow: 1 }} />
        <PrintButton />
      </div>
      <FitSheet maxSize={size}>
        <header className="fl-head">
          <div className="fl-band">
            <div className="fl-title">{event.title}</div>
            {event.subtitle && <div className="fl-sub">{event.subtitle}</div>}
          </div>
          <div className="fl-date">
            <div>{formatDate(event.eventDate)}</div>
            {event.eventTime && <div>{event.eventTime}</div>}
            {event.location && <div className="fl-loc">{event.location}</div>}
          </div>
        </header>
        {sections.length === 0 && <p>Noch keine Produkte für den Aushang ausgewählt.</p>}
        {sections.map((s) => (
          <section key={s.category} className="fl-sec">
            <h2>{s.category}</h2>
            <ul style={{ columnCount: cols }}>
              {s.lines.map((l, i) => (
                <li key={i}>
                  {l.text}{l.price ? ` ${l.price}` : ""}{l.mhd && <>{" "}<span className="fl-mhd">({l.mhd})</span></>}
                  {l.sub.length > 0 && <ul>{l.sub.map((x, j) => <li key={j}>{x.text}{x.price ? ` ${x.price}` : ""}{x.mhd && <>{" "}<span className="fl-mhd">({x.mhd})</span></>}</li>)}</ul>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </FitSheet>
    </>
  );
}

const CSS = `
.sheet { --fs: 16px; width: 794px; height: 1123px; margin: 0 auto 32px; background: #fff; padding: 44px 40px 32px; overflow: hidden;
  font-family: "Archivo", "Arial", sans-serif; font-weight: 700; font-size: var(--fs); line-height: 1.35; color: #111; box-shadow: 0 2px 12px rgba(0,0,0,.12); }
.fl-head { position: relative; margin-bottom: calc(var(--fs) * 1.2); padding-right: 0; }
.fl-band { position: relative; padding: 26px 20px 30px; }
.fl-band::before { content: ""; position: absolute; inset: 0; background: #bfe3ef; z-index: 0;
  clip-path: polygon(1% 18%, 12% 6%, 30% 10%, 52% 2%, 74% 8%, 97% 0%, 100% 40%, 98% 78%, 80% 90%, 55% 84%, 30% 100%, 8% 88%, 0% 62%); }
.fl-title, .fl-sub { position: relative; z-index: 1; font-family: "Archivo Black", "Arial Black", sans-serif; text-transform: uppercase; }
.fl-title { font-size: 40px; letter-spacing: .03em; line-height: 1.05; }
.fl-sub { font-size: 14px; letter-spacing: .04em; text-align: right; margin-top: 6px; padding-right: 60px; }
.fl-date { position: relative; z-index: 0; margin: -8px 0 0 auto; width: max-content; padding: 6px 24px; text-align: center;
  font-family: "Archivo Black", "Arial Black", sans-serif; font-size: 24px; line-height: 1.25; letter-spacing: .03em; }
.fl-date::before { content: ""; position: absolute; inset: 0; background: #f2e1da; z-index: -1; transform: rotate(-1deg);
  clip-path: polygon(0 10%, 30% 0, 70% 6%, 100% 0, 97% 90%, 60% 100%, 20% 94%, 2% 100%); }
.fl-date > div { position: relative; }
.fl-loc { font-size: 13px; }
.fl-sec { margin-bottom: calc(var(--fs) * 1.1); break-inside: avoid; }
.fl-sec h2 { font-family: "Archivo Black", "Arial Black", sans-serif; text-transform: uppercase; font-size: calc(var(--fs) * 1.15); letter-spacing: .03em; margin: 0 0 calc(var(--fs) * .35); }
.fl-sec > ul { margin: 0; padding: 0 0 0 1.1em; column-gap: 1.6em; }
.fl-sec li { break-inside: avoid; letter-spacing: .02em; }
.fl-mhd { font-size: .78em; font-weight: 600; color: #555; white-space: nowrap; }
.fl-sec ul ul { padding-left: 1.2em; list-style: circle; font-size: .88em; }
@page { size: A4; margin: 0; }
@media print {
  .no-print { display: none !important; }
  html, body, body > div { background: #fff !important; }
  .sheet { box-shadow: none; margin: 0; width: 210mm; height: 297mm; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;
