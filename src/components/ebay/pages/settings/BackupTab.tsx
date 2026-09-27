import { useEffect, useRef, useState } from 'react';
import { api, formatDate } from '../../api';

interface BackupInfo {
  settings: { keep?: number };
  defaultKeep: number;
  status: { at: string; file?: string; error?: string; requested?: boolean } | null;
  dir: string | null;
  files: { name: string; size: number; at: string }[];
}

interface ImportResult {
  settings: number;
  tokens: number;
  listings: number;
  invoices: number;
  idealoPrices: number;
  lastInvoiceNumber?: string;
  automationWasOn: boolean;
}

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/**
 * Datensicherung: Im Seller-System sichert der Server die ganze Datenbank täglich
 * (Container „backup"). Dazu die einmalige Übernahme aus dem bisherigen eBay-Tool.
 */
export function BackupTab() {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [keep, setKeep] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () =>
    api<BackupInfo>('/backup').then((i) => {
      setInfo(i);
      setKeep(i.settings.keep === undefined ? '' : String(i.settings.keep));
    }).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, []);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      setMsg(await fn());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function importFile() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    await run(async () => {
      const res = await fetch('/api/ebay/import', { method: 'POST', body: file });
      const json = (await res.json().catch(() => ({}))) as ImportResult & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Serverfehler (HTTP ${res.status})`);
      setImported(json);
      if (fileRef.current) fileRef.current.value = '';
      return 'Daten übernommen.';
    });
  }

  if (!info) return <p className="muted">{error || 'Lädt …'}</p>;
  const dirty = keep !== (info.settings.keep === undefined ? '' : String(info.settings.keep));

  return (
    <section className="stack">
      {msg && <div className="banner success">{msg}</div>}
      {error && <div className="banner error">{error}</div>}

      <h3>Automatische Datensicherung</h3>
      <p className="muted">
        Der Server sichert einmal am Tag die ganze Datenbank des Seller-Systems — eBay-Angebote, Einkäufe und
        Rechnungen genauso wie alle anderen Bereiche.
        {info.dir && <> Die Sicherungen liegen auf dem Server in <code>{info.dir}</code>.</>}
      </p>
      {!info.dir ? (
        <div className="banner warn">
          Die automatische Sicherung läuft nur in der Server-Installation (Docker). Hier ist sie nicht eingerichtet.
        </div>
      ) : info.status ? (
        <div className={'banner ' + (info.status.error ? 'warn' : 'success')}>
          {info.status.requested
            ? 'Sicherung angefordert — sie startet innerhalb einer Minute.'
            : <>Letzte Sicherung: {formatDate(info.status.at)}</>}
          {info.status.error && <> — {info.status.error}</>}
        </div>
      ) : (
        <div className="banner warn">Noch keine Sicherung — die erste läuft kurz nach dem Start oder jetzt per Klick.</div>
      )}
      {info.dir && (
        <>
          <div className="tab-actions">
            <button
              disabled={busy}
              onClick={() => void run(async () => {
                await api('/backup/run', { method: 'POST' });
                return 'Sicherung angefordert.';
              })}
            >
              Jetzt sichern
            </button>
          </div>
          <label>
            Aufbewahren (Anzahl Sicherungen)
            <input type="number" min={1} max={365} value={keep} placeholder={String(info.defaultKeep)} onChange={(e) => setKeep(e.target.value)} />
          </label>
          <div className="tab-actions">
            <button
              className="primary"
              disabled={!dirty || busy}
              onClick={() => void run(async () => {
                await api('/backup', { method: 'PUT', body: JSON.stringify({ keep }) });
                return 'Gespeichert.';
              })}
            >
              Speichern
            </button>
          </div>
          <p className="muted">
            Eine Sicherung auf demselben Server hilft nicht, wenn der Server ausfällt — zusätzlich in der Hetzner-Konsole
            die Server-Backups einschalten oder die Dateien regelmäßig herunterladen.
          </p>
        </>
      )}

      {info.files.length > 0 && (
        <>
          <h3>Vorhandene Sicherungen</h3>
          <div className="table-wrap">
            <table className="history">
              <thead><tr><th>Datei</th><th>Erstellt</th><th>Größe</th></tr></thead>
              <tbody>
                {info.files.map((f) => (
                  <tr key={f.name}><td className="mono">{f.name}</td><td>{formatDate(f.at)}</td><td>{size(f.size)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">Zurückspielen: siehe TESTANLEITUNG.md, Abschnitt „Datensicherung zurückspielen".</p>
        </>
      )}

      <h3>Daten aus dem bisherigen eBay-Tool übernehmen</h3>
      <p className="muted">
        Einmalig: die Datei <code>data/lugru.db</code> des bisherigen LuGru eBay-Tools wählen. Übernommen werden
        Zugangsdaten und eBay-Verbindung, alle Angebote mit Einkaufsdaten, alle Rechnungen mit ihren Nummern und der
        idealo-Preisverlauf. Neue Rechnungen zählen lückenlos weiter.
      </p>
      <div className="banner warn">
        Die Rechnungs-Automatik ist nach der Übernahme aus. Erst einschalten, wenn das bisherige Tool beendet ist —
        sonst vergeben zwei Programme Rechnungsnummern.
      </div>
      <div className="image-url-row">
        <input ref={fileRef} type="file" accept=".db,application/octet-stream,application/x-sqlite3" aria-label="lugru.db wählen" />
        <button className="primary" disabled={busy} onClick={() => void importFile()}>Übernehmen</button>
      </div>
      {imported && (
        <div className="banner success">
          Übernommen: {imported.listings} Angebote, {imported.invoices} Rechnungen
          {imported.lastInvoiceNumber ? ` (zuletzt ${imported.lastInvoiceNumber})` : ''}, {imported.settings} Einstellungen,
          {' '}{imported.tokens ? 'eBay-Verbindung' : 'keine eBay-Verbindung'}, {imported.idealoPrices} idealo-Preise.
          {imported.automationWasOn && ' Die Rechnungs-Automatik war im bisherigen Tool eingeschaltet — hier ist sie vorerst aus.'}
        </div>
      )}
    </section>
  );
}
