import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { normRef, PRICE_KIND_LABEL, PRICE_KINDS, priceSummary } from "@/lib/watches/logic";
import { asNote, listPrices, requireFlip } from "@/lib/watches/service";
import { ConfirmButton } from "@/components/confirm-button";
import { addPriceAction, deletePriceAction } from "../actions";
import { FlipForm } from "../forms";
import { dmy, eur, FlipHead } from "../ui";

const KIND_SHORT = { verkauft: "verkauft", angeboten: "angeboten", ankauf: "Händler-Ankauf" } as const;

/** Eigene Marktbeobachtung je Referenz: verkauft, angeboten, Händler-Ankauf – mit Spanne und Median. */
export default async function PreisePage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { session, brandName } = await requireFlip();
  const sp = await searchParams;
  const ref = (sp.ref ?? "").slice(0, 60);
  const key = normRef(ref);
  const all = await listPrices(session.tenantId);
  const notes = all.map(asNote);
  const groups = [...new Map(all.map((p) => [p.refKey, p])).values()];
  const shown = key ? all.filter((p) => p.refKey === key) : all.slice(0, 60);
  const today = todayIso();

  return (
    <div className="flip stack" style={{ gap: 16 }}>
      <FlipHead title="Marktpreise" brand={brandName} sub="Dein Preisgefühl: notiere, was Uhren kosten – getrennt nach verkauft, angeboten und Händler-Ankauf." />

      <section className="card card-pad stack" data-testid="price-new">
        <h2>Preis notieren</h2>
        <FlipForm action={addPriceAction} submit="Notieren" testid="price-form" resetOnSuccess>
          <div className="flip-grid">
            <div className="field"><label className="label small" htmlFor="p-ref">Referenz *</label><input className="input" id="p-ref" name="reference" defaultValue={ref} required autoComplete="off" data-testid="p-ref" /></div>
            <div className="field"><label className="label small" htmlFor="p-label">Marke / Modell</label><input className="input" id="p-label" name="label" placeholder="z. B. Omega Speedmaster" autoComplete="off" /></div>
            <div className="field"><label className="label small" htmlFor="p-price">Preis € *</label><input className="input" id="p-price" name="price" inputMode="decimal" required autoComplete="off" data-testid="p-price" /></div>
            <div className="field">
              <label className="label small" htmlFor="p-kind">Art *</label>
              <select className="input" id="p-kind" name="kind" defaultValue="verkauft" data-testid="p-kind">
                {PRICE_KINDS.map((k) => <option key={k} value={k}>{PRICE_KIND_LABEL[k]}</option>)}
              </select>
            </div>
            <div className="field"><label className="label small" htmlFor="p-day">Datum</label><input className="input" id="p-day" name="day" type="date" defaultValue={today} max={today} /></div>
            <div className="field">
              <label className="label small" htmlFor="p-condition">Zustand</label>
              <select className="input" id="p-condition" name="condition" defaultValue="gebraucht"><option value="gebraucht">gebraucht</option><option value="neu">neu / ungetragen</option></select>
            </div>
            <div className="field"><label className="label small" htmlFor="p-source">Quelle</label><input className="input" id="p-source" name="source" placeholder="z. B. eBay verkauft" autoComplete="off" /></div>
            <div className="field" style={{ gridColumn: "span 2", minWidth: 0 }}><label className="label small" htmlFor="p-url">Link</label><input className="input" id="p-url" name="url" type="url" placeholder="https://…" autoComplete="off" /></div>
          </div>
          <label className="check small"><input type="checkbox" name="fullSet" /> mit Box und Papieren (Full Set)</label>
        </FlipForm>
        <p className="small muted">Tipp: Angebote liegen meist über dem, was am Ende bezahlt wird. Für deine Rechnung zählen die verkauften Preise.</p>
      </section>

      {groups.length > 0 && (
        <section className="stack" data-testid="price-groups">
          <h2>Nach Referenz</h2>
          <div className="table-wrap">
            <table className="table small">
              <thead><tr><th>Referenz</th><th className="right">verkauft (Median)</th><th className="right">angeboten (Median)</th><th className="right">Händler-Ankauf</th></tr></thead>
              <tbody>
                {groups.map((g) => {
                  const s = priceSummary(notes, g.reference);
                  const cell = (k: "verkauft" | "angeboten" | "ankauf") => (s[k] ? `${eur(s[k]!.median)} (${s[k]!.n}×)` : "–");
                  return (
                    <tr key={g.refKey}>
                      <td><Link href={`/marken/uhren/preise?ref=${encodeURIComponent(g.reference)}`}>{g.reference}</Link>{g.label ? <div className="muted">{g.label}</div> : null}</td>
                      <td className="num right">{cell("verkauft")}</td>
                      <td className="num right">{cell("angeboten")}</td>
                      <td className="num right">{cell("ankauf")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="stack" data-testid="price-list">
        <div className="between">
          <h2>{key ? `Notizen zu ${ref}` : "Letzte Notizen"}</h2>
          {key && <Link className="small" href="/marken/uhren/preise">alle anzeigen</Link>}
        </div>
        {shown.length === 0 ? (
          <p className="small muted">Noch nichts notiert.</p>
        ) : (
          <ul className="flip-list">
            {shown.map((p) => (
              <li key={p.id}>
                <div className="between" style={{ gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <strong>{eur(p.price)}</strong> <span className="small">· {KIND_SHORT[p.kind]} · {p.reference}</span>
                    <div className="small muted">{dmy(p.day)} · {p.condition}{p.fullSet ? " · Full Set" : ""}{p.source ? ` · ${p.source}` : ""}{p.url ? <> · <a href={p.url} target="_blank" rel="noopener noreferrer">Link ↗</a></> : null}</div>
                  </div>
                  <form action={deletePriceAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <ConfirmButton confirm="Diese Preis-Notiz löschen?" className="btn-link x-danger">×</ConfirmButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
