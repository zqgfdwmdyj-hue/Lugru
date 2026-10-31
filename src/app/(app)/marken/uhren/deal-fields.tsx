import { TAX_LABEL, TAX_MODES } from "@/lib/watches/calc";
import { CHANNELS, costsText, DEAL_STATUSES, DEAL_STATUS_LABEL, SET_LABEL, SETS, SOURCES } from "@/lib/watches/logic";
import type { Deal } from "@/lib/watches/service";

const num = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

function Field({ name, label, value, hint, type = "text", mode, placeholder, list }: { name: string; label: string; value?: string | number | null; hint?: string; type?: string; mode?: "decimal" | "numeric"; placeholder?: string; list?: string }) {
  return (
    <div className="field" style={{ minWidth: 0 }}>
      <label className="label small" htmlFor={`f-${name}`}>{label}</label>
      <input className="input" id={`f-${name}`} name={name} type={type} inputMode={mode} defaultValue={value ?? ""} placeholder={placeholder} list={list} autoComplete="off" data-testid={`f-${name}`} />
      {hint && <span className="small muted">{hint}</span>}
    </div>
  );
}

/** Alle Angaben eines Deals – für „Neuer Deal“ (kurz) und die Detailseite (vollständig). */
export function DealFields({ d, short = false }: { d?: Deal | null; short?: boolean }) {
  return (
    <>
      {d && <input type="hidden" name="id" value={d.id} />}
      <label className="check small"><input type="checkbox" name="practice" defaultChecked={d ? d.practice : true} data-testid="f-practice" /> Übungs-Deal (nur auf dem Papier – zählt getrennt von echten Deals)</label>
      <div className="flip-grid">
        <div className="field">
          <label className="label small" htmlFor="f-condition">Zustand</label>
          <select className="input" id="f-condition" name="condition" defaultValue={d?.condition ?? "gebraucht"} data-testid="f-condition">
            <option value="gebraucht">gebraucht</option>
            <option value="neu">neu / ungetragen</option>
          </select>
        </div>
        <Field name="maker" label="Marke *" value={d?.maker} placeholder="z. B. Omega" />
        <Field name="model" label="Modell" value={d?.model} placeholder="z. B. Speedmaster" />
        <Field name="reference" label="Referenz" value={d?.reference} hint="vom Gehäuse bzw. den Papieren" />
        <Field name="year" label="Baujahr" value={d?.year} mode="numeric" />
        <div className="field">
          <label className="label small" htmlFor="f-watchSet">Set</label>
          <select className="input" id="f-watchSet" name="watchSet" defaultValue={d?.watchSet ?? "ohne"}>
            {SETS.map((s) => <option key={s} value={s}>{SET_LABEL[s]}</option>)}
          </select>
        </div>
        <Field name="source" label="Quelle" value={d?.source} list="flip-sources" placeholder="z. B. Kleinanzeigen" />
        <Field name="askPrice" label="Angebotspreis €" value={num(d?.askPrice)} mode="decimal" hint="was der Verkäufer will" />
        <Field name="url" label="Link zur Anzeige" value={d?.url} type="url" placeholder="https://…" />
      </div>
      <datalist id="flip-sources">{SOURCES.map((s) => <option key={s} value={s} />)}</datalist>
      {!short && (
        <>
          <div className="flip-grid">
            <div className="field">
              <label className="label small" htmlFor="f-status">Status</label>
              <select className="input" id="f-status" name="status" defaultValue={d?.status ?? "beobachtet"} data-testid="f-status">
                {DEAL_STATUSES.map((s) => <option key={s} value={s}>{DEAL_STATUS_LABEL[s]}</option>)}
              </select>
            </div>
            <div className="field" style={{ gridColumn: "span 2", minWidth: 0 }}>
              <label className="label small" htmlFor="f-taxMode">Steuer</label>
              <select className="input" id="f-taxMode" name="taxMode" defaultValue={d?.taxMode ?? "privat"} data-testid="f-taxMode">
                {TAX_MODES.map((m) => <option key={m} value={m}>{TAX_LABEL[m]}</option>)}
              </select>
            </div>
          </div>
          <h3 style={{ margin: "4px 0 0" }}>Ankauf</h3>
          <div className="flip-grid">
            <Field name="buyPrice" label="Ankaufspreis €" value={num(d?.buyPrice)} mode="decimal" />
            <Field name="buyDate" label="Gekauft am" value={d?.buyDate} type="date" />
            <Field name="targetSell" label="Ziel-Verkaufspreis €" value={num(d?.targetSell)} mode="decimal" hint="realistisch, aus verkauften Vergleichen" />
          </div>
          <div className="field">
            <label className="label small" htmlFor="f-costs">Nebenkosten (je Zeile „Bezeichnung: Betrag“)</label>
            <textarea className="input" id="f-costs" name="costs" rows={3} defaultValue={d ? costsText(d.costs) : ""} placeholder={"Revision: 350\nAnreise: 25"} data-testid="f-costs" />
          </div>
          <h3 style={{ margin: "4px 0 0" }}>Verkauf</h3>
          <div className="flip-grid">
            <Field name="sellPrice" label="Verkaufspreis €" value={num(d?.sellPrice)} mode="decimal" />
            <Field name="sellDate" label="Verkauft am" value={d?.sellDate} type="date" />
            <Field name="channel" label="Kanal" value={d?.channel} list="flip-channels" placeholder="z. B. Kleinanzeigen" />
            <Field name="feePct" label="Gebühr in %" value={num(d?.feePct)} mode="decimal" hint="Plattform + Zahlung – im Gebührenverzeichnis nachsehen" />
            <Field name="feeFixed" label="Gebühr fest €" value={num(d?.feeFixed)} mode="decimal" />
            <Field name="shipping" label="Versand an Käufer €" value={num(d?.shipping)} mode="decimal" />
          </div>
          <datalist id="flip-channels">{CHANNELS.map((s) => <option key={s} value={s} />)}</datalist>
          <div className="field">
            <label className="label small" htmlFor="f-notes">Notizen</label>
            <textarea className="input" id="f-notes" name="notes" rows={3} defaultValue={d?.notes ?? ""} placeholder="Zustand, Mängel, Gespräch mit dem Verkäufer …" />
          </div>
          <div className="field">
            <label className="label small" htmlFor="f-lessons">Was habe ich gelernt?</label>
            <textarea className="input" id="f-lessons" name="lessons" rows={2} defaultValue={d?.lessons ?? ""} placeholder="Eine Erkenntnis für den nächsten Deal" data-testid="f-lessons" />
          </div>
          <Field name="rejectReason" label="Warum verworfen? (wenn verworfen)" value={d?.rejectReason} />
        </>
      )}
    </>
  );
}
