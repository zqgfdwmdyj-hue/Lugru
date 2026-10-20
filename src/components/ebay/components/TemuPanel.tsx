import { useEffect, useState, type FormEvent } from 'react';
import { temuBasePrice, temuPriceNote, type TemuPriceRule } from '@/lib/temu/price';
import { api, formatPrice, parseAmount, type Attempt } from '../api';

type Panel = {
  connected: boolean;
  entries: { sku: string; label: string; goodsId: string | null; status: string | null; statusLabel: string; error: string | null; compliance?: string | null; complianceRaw?: string | null; price?: number | null }[];
  defaults: { weightG?: number; lengthCm?: number; widthCm?: number; heightCm?: number; quantities: Record<string, number>; rule: TemuPriceRule };
};

const text = (n: number | undefined) => (n === undefined ? '' : String(n).replace('.', ','));
const money = (n: number) => (n > 0 ? n.toFixed(2).replace('.', ',') : '');

/**
 * Dasselbe Angebot zusätzlich bei Temu (nur für auf eBay veröffentlichte Angebote): Preis nach dem
 * Temu-Basispreis-Rechner (je SKU änderbar), Gewicht und Paketmaße – Kategorie, Merkmale und
 * Herstellerangaben ordnet Temu selbst zu. Danach Stand je SKU.
 */
export function TemuPanel({ attempt }: { attempt: Attempt }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [factor, setFactor] = useState('85');
  const [food, setFood] = useState(false);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [weight, setWeight] = useState('');
  const [length, setLength] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const rows = attempt.variants
    ? attempt.variants.items.map((i) => ({ sku: i.sku, label: i.value, ref: i.price }))
    : [{ sku: attempt.sku ?? '', label: 'Preis', ref: attempt.price }];

  function recompute(f: string, isFood: boolean) {
    const rule = { factor: (parseAmount(f) ?? 0) / 100, food: isFood };
    setPrices(Object.fromEntries(rows.map((r) => [r.sku, money(temuBasePrice(r.ref, rule))])));
  }

  function adopt(p: Panel, first = false) {
    setPanel(p);
    setWeight((w) => w || text(p.defaults.weightG));
    setLength((v) => v || text(p.defaults.lengthCm));
    setWidth((v) => v || text(p.defaults.widthCm));
    setHeight((v) => v || text(p.defaults.heightCm));
    if (first) {
      const f = text(Math.round(p.defaults.rule.factor * 10000) / 100);
      setFactor(f);
      setFood(p.defaults.rule.food);
      recompute(f, p.defaults.rule.food);
    }
  }

  async function load(first = false) {
    try {
      adopt(await api<Panel>(`/attempts/${attempt.id}/temu`), first);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt.id]);

  if (!panel) return null;
  if (!panel.connected) {
    return (
      <section className="temu-box" data-testid="temu-panel">
        <h3>Temu</h3>
        <p className="muted">Temu ist nicht verbunden – unter <a href="/anbindungen?p=temu#temu">Anbindungen → Temu</a> einrichten, dann geht es hier auch bei Temu.</p>
      </section>
    );
  }

  const quantities = Object.values(panel.defaults.quantities);
  const rule = { factor: (parseAmount(factor) ?? 0) / 100, food };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const n = (v: string) => parseAmount(v);
    const pack = { weightG: n(weight), lengthCm: n(length), widthCm: n(width), heightCm: n(height) };
    if (Object.values(pack).some((v) => v === undefined || v <= 0)) {
      setError('Bitte Gewicht und alle drei Paketmaße angeben.');
      return;
    }
    const own = Object.fromEntries(rows.map((r) => [r.sku, n(prices[r.sku] ?? '')]));
    const missing = rows.filter((r) => !(own[r.sku]! > 0));
    if (missing.length) {
      setError(`Temu-Preis fehlt${attempt.variants ? ` (${missing.map((r) => r.label).join(', ')})` : ''} – der Rechner kommt bei so niedrigem eBay-Preis auf 0 € oder weniger; bitte eigenen Preis eintragen.`);
      return;
    }
    setBusy(true);
    try {
      adopt(await api<Panel>(`/attempts/${attempt.id}/temu`, { method: 'POST', body: JSON.stringify({ factor: rule.factor, food, prices: own, ...pack }) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="temu-box" data-testid="temu-panel">
      <h3>Temu</h3>
      {panel.entries.length > 0 ? (
        <>
          <table className="aspects" data-testid="temu-status">
            <tbody>
              {panel.entries.map((e) => (
                <tr key={e.sku}>
                  <th>{e.label}</th>
                  <td>
                    <span className={`badge ${e.status === 'ACTIVE' ? 'status-published' : 'status-draft'}`}>{e.statusLabel}</span>
                    {e.goodsId && <div className="muted">Temu-Nr. {e.goodsId}{e.price ? ` · Basispreis ${formatPrice(e.price)}` : ''}</div>}
                    {/* Was zu tun ist (z. B. im Seller Center ergänzen) – bei „aktiv“ nichts. */}
                    {e.error && e.status !== 'ACTIVE' && <div className="muted">{e.error}</div>}
                    {e.compliance && e.status !== 'ACTIVE' && <div className="muted temu-note" title={e.complianceRaw ?? undefined} data-testid="temu-compliance">Konformität: {e.compliance}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            Fehlen Temu Pflichtangaben der Kategorie, steht das Produkt dort als unvollständig bzw. Entwurf – dann im Seller Center
            ergänzen und absenden. Der Stand wird alle 30 Minuten abgefragt; sobald es aktiv ist, folgt die Menge auf Temu dem Wawi-Bestand.{' '}
            <button className="linklike" type="button" onClick={() => void load()}>Stand jetzt abfragen</button>
          </p>
        </>
      ) : (
        <form className="stack" onSubmit={submit} data-testid="temu-form">
          <p className="muted">
            Gleiches Angebot auch bei Temu – mit Titel, Beschreibung, Bildern, Merkmalen, EAN und Herstellerangaben von hier.
            {attempt.variants ? ` Alle ${attempt.variants.items.length} Varianten gehen mit.` : ''} Die Menge folgt dem Wawi-Bestand
            {quantities.length ? ` (jetzt ${quantities.reduce((s, q) => s + q, 0)} Stück)` : ''}.
          </p>
          <div className="row">
            <label>
              Faktor (%)
              <input value={factor} onChange={(e) => { setFactor(e.target.value); recompute(e.target.value, food); }} inputMode="decimal" aria-label="Faktor in Prozent" />
            </label>
            <label>
              Warengruppe
              <select value={food ? 'food' : 'nonfood'} onChange={(e) => { setFood(e.target.value === 'food'); recompute(factor, e.target.value === 'food'); }} aria-label="Warengruppe">
                <option value="nonfood">Non-Food (19 % MwSt.)</option>
                <option value="food">Food (7 % MwSt.)</option>
              </select>
            </label>
          </div>
          <table className="aspects temu-prices" data-testid="temu-prices">
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku}>
                  <th>{r.label}</th>
                  <td>
                    <span className="muted">eBay {formatPrice(r.ref)} → </span>
                    <input value={prices[r.sku] ?? ''} onChange={(e) => setPrices((p) => ({ ...p, [r.sku]: e.target.value }))} inputMode="decimal" aria-label={`Temu-Basispreis ${r.label}`} className="temu-price" /> €
                    <div className="muted temu-note">{temuPriceNote(r.ref, rule)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted temu-note">Temu-Basispreis = (eBay-Preis × Faktor{' '}− 2,99 € Versand, wenn das 30 € oder weniger sind) ÷ (1 + MwSt.) – wie im Basispreis-Kalkulator. Je Zeile änderbar.</p>
          <div className="row">
            <label>
              Gewicht verpackt (g)
              <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" aria-label="Gewicht in Gramm" />
            </label>
            <label>Länge (cm)<input value={length} onChange={(e) => setLength(e.target.value)} inputMode="decimal" aria-label="Länge in cm" /></label>
          </div>
          <div className="row">
            <label>Breite (cm)<input value={width} onChange={(e) => setWidth(e.target.value)} inputMode="decimal" aria-label="Breite in cm" /></label>
            <label>Höhe (cm)<input value={height} onChange={(e) => setHeight(e.target.value)} inputMode="decimal" aria-label="Höhe in cm" /></label>
          </div>
          <button className="primary" disabled={busy} data-testid="temu-submit">{busy ? 'Wird bei Temu angelegt …' : 'Auf Temu einstellen'}</button>
          <p className="muted">Kategorie, Pflichtmerkmale und Versandvorlage (Standardvorlage deines Shops) setzt Temu selbst; fehlt Temu etwas, bleibt das Angebot dort als Entwurf und du ergänzt es im Seller Center.</p>
        </form>
      )}
      {error && <div className="banner error">{error}</div>}
    </section>
  );
}
