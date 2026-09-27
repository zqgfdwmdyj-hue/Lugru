import { useState } from 'react';

function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

function previousMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** ZIP mit Rechnungsausgangsbuch (CSV) und allen Rechnungs-PDFs eines Monats oder Zeitraums. */
export function AccountingExport() {
  const [mode, setMode] = useState<'month' | 'range'>('month');
  const [month, setMonth] = useState(previousMonth);
  const [from, setFrom] = useState(() => monthRange(previousMonth()).from);
  const [to, setTo] = useState(() => monthRange(previousMonth()).to);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function download() {
    const range = mode === 'month' ? monthRange(month) : { from, to };
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/ebay/export/accounting?from=${range.from}&to=${range.to}`);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Serverfehler (HTTP ${res.status})`);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `Buchhaltung_${range.from}_bis_${range.to}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="export-box">
      <h3>Export für die Buchhaltung</h3>
      <p className="muted">
        ZIP-Datei mit dem Rechnungsausgangsbuch (CSV, öffnet in Excel) und allen Rechnungen als PDF — zum Weitergeben an
        Steuerberater oder Buchhaltungsprogramm und zum Aufbewahren.
      </p>
      <div className="row row-end">
        <label>
          Zeitraum
          <select value={mode} onChange={(e) => setMode(e.target.value as 'month' | 'range')}>
            <option value="month">Monat</option>
            <option value="range">von – bis</option>
          </select>
        </label>
        {mode === 'month' ? (
          <label>
            Monat
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
        ) : (
          <>
            <label>Von<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label>Bis<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </>
        )}
        <button className="primary" disabled={busy} onClick={() => void download()}>
          {busy ? 'Wird erstellt …' : 'ZIP herunterladen'}
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
    </section>
  );
}
