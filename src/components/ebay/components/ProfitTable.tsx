import { formatPercent, formatPrice, type Profit } from '../api';

/**
 * Die Gewinnaufstellung, wie sie überall gleich aussehen soll: Verkaufspreis
 * oben, Kosten mit Minuszeichen, Gewinn abgesetzt. Die Zeilen sind serverseitig
 * gerundet und summieren sich exakt — sie sollen zum Nachrechnen einladen.
 */
export function ProfitTable({ profit, feePercent }: { profit: Profit; feePercent?: number }) {
  const rows: { label: string; value: number; cost?: boolean }[] = [
    { label: 'Verkaufspreis', value: profit.salePrice },
    { label: 'Einkaufspreis', value: profit.purchasePrice, cost: true },
    {
      label: `Verkaufsprovision${feePercent !== undefined ? ` (${formatPercent(feePercent)})` : ''}`,
      value: profit.fee,
      cost: true,
    },
  ];
  if (profit.shipping > 0) rows.push({ label: 'Versand', value: profit.shipping, cost: true });
  if (profit.vat !== undefined) rows.push({ label: 'Umsatzsteuer', value: profit.vat, cost: true });

  // Kostenzeilen führen einen positiven Betrag und bekommen das Minus hier; der
  // Gewinn bringt sein Vorzeichen selbst mit — formatPrice setzt dasselbe Zeichen.
  const signed = (value: number, cost?: boolean) => (cost ? `−${formatPrice(value)}` : formatPrice(value));

  return (
    <table className="profit">
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <th scope="row">{r.label}</th>
            <td className={r.cost ? 'cost' : undefined}>{signed(r.value, r.cost)}</td>
          </tr>
        ))}
        <tr className="total">
          <th scope="row">Gewinn</th>
          <td className={profit.profit < 0 ? 'cost' : undefined}>
            {signed(profit.profit)} <span className="muted">({formatPercent(profit.profitPercent)})</span>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
