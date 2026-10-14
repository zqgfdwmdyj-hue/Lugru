import { useEffect, useState, type FormEvent } from 'react';
import { api, formatPrice, parseAmount, type Attempt } from '../api';

type Panel = {
  connected: boolean;
  entries: { sku: string; label: string; goodsId: string | null; status: string | null; statusLabel: string; error: string | null }[];
  defaults: { weightG?: number; lengthCm?: number; widthCm?: number; heightCm?: number; quantities: Record<string, number> };
};

const text = (n: number | undefined) => (n === undefined ? '' : String(n).replace('.', ','));

/**
 * Dasselbe Angebot zusätzlich bei Temu (nur für auf eBay veröffentlichte Angebote): Preis (Prozent
 * vom eBay-Preis), Gewicht und Paketmaße – Kategorie, Merkmale und Herstellerangaben ordnet Temu
 * selbst zu. Danach Stand je SKU.
 */
export function TemuPanel({ attempt }: { attempt: Attempt }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [percent, setPercent] = useState('100');
  const [weight, setWeight] = useState('');
  const [length, setLength] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function adopt(p: Panel) {
    setPanel(p);
    setWeight((w) => w || text(p.defaults.weightG));
    setLength((v) => v || text(p.defaults.lengthCm));
    setWidth((v) => v || text(p.defaults.widthCm));
    setHeight((v) => v || text(p.defaults.heightCm));
  }

  async function load() {
    try {
      adopt(await api<Panel>(`/attempts/${attempt.id}/temu`));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void load();
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

  const p = parseAmount(percent) ?? 0;
  const prices = attempt.variants ? attempt.variants.items.map((i) => i.price) : [attempt.price];
  const minPrice = Math.min(...prices.map((x) => Math.round(x * p) / 100));
  const quantities = Object.values(panel.defaults.quantities);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const n = (v: string) => parseAmount(v);
    const body = { pricePercent: n(percent), weightG: n(weight), lengthCm: n(length), widthCm: n(width), heightCm: n(height) };
    if (Object.values(body).some((v) => v === undefined || v <= 0)) {
      setError('Bitte Preis-Prozent, Gewicht und alle drei Paketmaße angeben.');
      return;
    }
    setBusy(true);
    try {
      adopt(await api<Panel>(`/attempts/${attempt.id}/temu`, { method: 'POST', body: JSON.stringify(body) }));
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
                    {e.goodsId && <div className="muted">Temu-Nr. {e.goodsId}</div>}
                    {/* „in Prüfung“ sagt das Abzeichen schon – sonst der Grund (z. B. im Seller Center ergänzen). */}
                    {e.error && e.status && !['ACTIVE', 'INCOMPLETE'].includes(e.status) && <div className="muted">{e.error}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            Temu ordnet Kategorie und Merkmale selbst zu und prüft neue Angebote (meist innerhalb von Stunden). Der Stand wird
            alle 30 Minuten abgefragt; sobald es aktiv ist, folgt die Menge auf Temu dem Wawi-Bestand.{' '}
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
              Preis bei Temu (% vom eBay-Preis)
              <input value={percent} onChange={(e) => setPercent(e.target.value)} inputMode="decimal" aria-label="Preis bei Temu in Prozent" />
              <span className="muted">{p > 0 ? `${attempt.variants ? 'ab ' : ''}${formatPrice(minPrice)}` : ''}</span>
            </label>
            <label>
              Gewicht verpackt (g)
              <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" aria-label="Gewicht in Gramm" />
            </label>
          </div>
          <div className="row">
            <label>Länge (cm)<input value={length} onChange={(e) => setLength(e.target.value)} inputMode="decimal" aria-label="Länge in cm" /></label>
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
