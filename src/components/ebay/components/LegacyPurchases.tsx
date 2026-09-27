import { useCallback, useEffect, useState } from 'react';
import { api, formatDate, formatPercent, formatPrice, type Attempt } from '../api';
// Dieselbe Umrechnung wie auf dem Server — die Vorschau der Netto-Werte muss dem Ergebnis entsprechen.
import { purchaseUnitNet } from '@/lib/ebay/pipeline/purchasePrice';

interface Unconfirmed {
  attempts: Attempt[];
  vatPercentage?: number;
  netBasisSince: string;
}

/**
 * Einkaufspreise aus der Zeit vor der Netto-Umstellung. Damals zählte der
 * gezahlte Betrag, also eher brutto — ob ein Wert schon netto war, weiß nur
 * der Nutzer. Deshalb entscheidet er je Zeile oder gesammelt; das Banner
 * verschwindet, sobald nichts Unbestätigtes mehr da ist.
 */
export function LegacyPurchases({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<Unconfirmed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<Unconfirmed>('/purchases/unconfirmed').then(setData).catch((err) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  if (!data || data.attempts.length === 0) return error ? <div className="banner error">{error}</div> : null;

  const vat = data.vatPercentage;
  const netOf = (gross: number) => (vat ? purchaseUnitNet(gross, { vatMode: 'gross', vatPercentage: vat }) : undefined);

  async function settle(ids: number[], action: 'confirm' | 'convert') {
    setError('');
    setBusy(true);
    try {
      await api('/purchases/basis', { method: 'POST', body: JSON.stringify({ ids, action }) });
      load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const all = data.attempts.map((a) => a.id);

  return (
    <div className="banner warn legacy">
      <strong>{data.attempts.length === 1 ? 'Ein Einkaufspreis' : `${data.attempts.length} Einkaufspreise`} ohne bestätigte Basis.</strong>{' '}
      Seit der Gewinnrechnung wird der Einkaufspreis netto gespeichert. Diese Werte wurden davor erfasst
      und sind noch nicht bestätigt — damals zählte der gezahlte Betrag, also eher brutto. Bis zur
      Entscheidung rechnet der Gewinn mit dem gespeicherten Wert als netto.
      {vat
        ? ` Umrechnung mit ${formatPercent(vat)} USt.`
        : ' Zum Umrechnen fehlt ein USt-Satz in den Einstellungen.'}
      {error && <div className="banner error">{error}</div>}
      <div className="table-wrap">
        <table className="history">
          <thead>
            <tr>
              <th>Datum</th><th>Artikel</th><th>EK gespeichert</th><th>nach Umrechnung</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.attempts.map((a) => {
              const net = netOf(a.purchasePrice!);
              return (
                <tr key={a.id}>
                  <td className="legacy-date">
                    {formatDate(a.createdAt)}
                    {a.createdAt < data.netBasisSince && <div className="muted">vor der Umstellung</div>}
                  </td>
                  <td className="title-cell" title={a.title}>{a.title ?? a.ean ?? `#${a.id}`}</td>
                  <td className="mono">{formatPrice(a.purchasePrice!)}</td>
                  <td className="mono">{net !== undefined ? formatPrice(net) : '—'}</td>
                  <td className="actions">
                    <button className="linklike" disabled={busy} onClick={() => settle([a.id], 'confirm')}>ist netto</button>
                    <button className="linklike" disabled={busy || !vat} onClick={() => settle([a.id], 'convert')}>
                      war brutto → umrechnen
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="legacy-bulk">
        <button disabled={busy} onClick={() => settle(all, 'confirm')}>Alle als netto bestätigen</button>
        <button disabled={busy || !vat} onClick={() => settle(all, 'convert')}>Alle umrechnen (waren brutto)</button>
      </div>
    </div>
  );
}
