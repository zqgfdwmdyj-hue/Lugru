import { useState } from 'react';
import { api, parseAmount } from '../../api';
import type { SettingsData, TabContext } from './types';

/** Zahlenfeld, das leer bleiben darf — leer heißt „hinterlegten Wert nehmen". */
function NumberField({ label, value, onChange, ...rest }: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        {...rest}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    </label>
  );
}

export function CalcTab({ ctx }: { ctx: TabContext }) {
  const { s, set, run } = ctx;
  const [rateCategory, setRateCategory] = useState('');
  const [ratePercent, setRatePercent] = useState('');
  const [rateError, setRateError] = useState('');
  const [dirty, setDirty] = useState(false);

  const change = (patch: Partial<SettingsData>) => {
    set(patch);
    setDirty(true);
  };

  const putRates = (rates: Record<string, number>, success: string) =>
    run(async () => {
      await api('/settings', { method: 'PUT', body: JSON.stringify({ feeCategoryRates: JSON.stringify(rates) }) });
    }, success);

  function addRate() {
    setRateError('');
    const category = rateCategory.trim();
    const percent = parseAmount(ratePercent);
    if (!/^\d+$/.test(category)) {
      setRateError('Die Kategorie-ID besteht nur aus Ziffern (steht in der Vorschau unter „Kategorie").');
      return;
    }
    if (percent === undefined || percent < 0 || percent > 100) {
      setRateError('Der Satz muss eine Zahl zwischen 0 und 100 sein.');
      return;
    }
    const existing = s.feeCategoryRates?.[category];
    if (
      existing !== undefined &&
      existing !== percent &&
      !window.confirm(`Für Kategorie ${category} sind bereits ${existing} % hinterlegt — mit ${percent} % überschreiben?`)
    ) {
      return;
    }
    void putRates({ ...(s.feeCategoryRates ?? {}), [category]: percent }, 'Satz gespeichert.').then((ok) => {
      if (!ok) return;
      setRateCategory('');
      setRatePercent('');
    });
  }

  return (
    <section className="stack">
      <h3>Umsatzsteuer</h3>
      <p className="muted">
        Dein Verkaufspreis gilt als Bruttopreis — diesen Satz zieht das Tool für die Gewinnrechnung
        ab. Leer lassen, wenn du keine Umsatzsteuer ausweist.
      </p>
      <NumberField
        label="Satz in %"
        min={0}
        max={30}
        step={0.1}
        value={s.vatPercentage}
        onChange={(v) => change({ vatPercentage: v })}
      />

      <h3>eBay-Gebühren</h3>
      <p className="muted">
        Damit rechnet das Tool deinen Gewinn aus. Die üblichen eBay-Sätze sind schon hinterlegt —
        ändere sie nur, wenn für dich andere gelten.
      </p>
      <div className="row">
        <NumberField label="Provision (%)" min={0} max={30} step={0.1} value={s.feePercent} onChange={(v) => change({ feePercent: v })} />
        <NumberField label="Fixbetrag (€)" min={0} step={0.01} value={s.feeFixed} onChange={(v) => change({ feeFixed: v })} />
        <NumberField label="Fixbetrag über Schwelle (€)" min={0} step={0.01} value={s.feeFixedAbove} onChange={(v) => change({ feeFixedAbove: v })} />
        <NumberField label="Schwelle (€)" min={0} step={0.01} value={s.feeFixedThreshold} onChange={(v) => change({ feeFixedThreshold: v })} />
      </div>

      <h3>Versandkosten</h3>
      <p className="muted">Deine Kosten je Verkauf, netto. Gehen in den Gewinn ein.</p>
      <NumberField label="Je Verkauf (€)" min={0} step={0.01} value={s.shippingAssumption} onChange={(v) => change({ shippingAssumption: v })} />

      <h3>Eigene Sätze je Kategorie</h3>
      <p className="muted">
        Gilt für eine Kategorie ein anderer Satz — etwa durch einen Shop-Rabatt — trag ihn hier ein.
      </p>
      {rateError && <div className="banner error">{rateError}</div>}
      <div className="row">
        <label>
          Kategorie-ID
          <input value={rateCategory} onChange={(e) => setRateCategory(e.target.value)} placeholder="z.B. 15032" inputMode="numeric" />
        </label>
        <label>
          Satz (%)
          <input value={ratePercent} onChange={(e) => setRatePercent(e.target.value)} placeholder="z.B. 6,3" inputMode="decimal" />
        </label>
        <div className="row-end">
          <button onClick={addRate} disabled={rateCategory.trim() === '' || ratePercent.trim() === ''}>
            Satz merken
          </button>
        </div>
      </div>
      {s.feeCategoryRates && Object.keys(s.feeCategoryRates).length > 0 && (
        <ul className="rates">
          {Object.entries(s.feeCategoryRates).map(([cat, pct]) => (
            <li key={cat}>
              <span className="mono">{cat}</span> — {pct} %
              <button
                className="linklike"
                onClick={() => {
                  const rest = { ...s.feeCategoryRates };
                  delete rest[cat];
                  void putRates(rest, 'Satz entfernt.');
                }}
              >
                entfernen
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="tab-actions">
        <button
          className="primary"
          disabled={!dirty}
          onClick={() =>
            run(async () => {
              const num = (v: number | undefined) => (v === undefined ? '' : String(v));
              await api('/settings', {
                method: 'PUT',
                body: JSON.stringify({
                  vatPercentage: num(s.vatPercentage),
                  feePercent: num(s.feePercent),
                  feeFixed: num(s.feeFixed),
                  feeFixedAbove: num(s.feeFixedAbove),
                  feeFixedThreshold: num(s.feeFixedThreshold),
                  shippingAssumption: num(s.shippingAssumption),
                }),
              });
              setDirty(false);
            }, 'Gespeichert.')
          }
        >
          Speichern
        </button>
        {dirty && <span className="muted">Es gibt ungespeicherte Änderungen.</span>}
      </div>
    </section>
  );
}
