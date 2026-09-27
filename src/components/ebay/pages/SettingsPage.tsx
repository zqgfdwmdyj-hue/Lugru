import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Tabs } from '../components/Tabs';
import { CalcTab } from './settings/CalcTab';
import { ConnectionTab } from './settings/ConnectionTab';
import { SellingTab } from './settings/SellingTab';
import { ImagesTab } from './settings/ImagesTab';
import { InvoicesTab } from './settings/InvoicesTab';
import { BackupTab } from './settings/BackupTab';
import type { SettingsData, StatusData, TabContext } from './settings/types';

type TabId = 'connection' | 'selling' | 'calc' | 'images' | 'invoices' | 'backup';
const TAB_IDS: TabId[] = ['connection', 'selling', 'calc', 'images', 'invoices', 'backup'];

export function SettingsPage({ initialTab }: { initialTab?: string } = {}) {
  const [s, setS] = useState<SettingsData | null>(null);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [tab, setTab] = useState<TabId>(TAB_IDS.includes(initialTab as TabId) ? (initialTab as TabId) : 'connection');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    api<SettingsData>('/settings').then(setS).catch((e) => setError(e.message));
    api<StatusData>('/status').then(setStatus).catch(() => {});
  }, []);

  useEffect(reload, [reload]);

  const run = useCallback(
    async (fn: () => Promise<void>, success: string) => {
      setError('');
      try {
        await fn();
        setMsg(success);
        setTimeout(() => setMsg(''), 4000);
        reload();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [reload],
  );

  if (!s) {
    return <div className="card narrow">{error ? <div className="banner error">{error}</div> : 'Lädt …'}</div>;
  }

  const ctx: TabContext = { s, status, set: (patch) => setS({ ...s, ...patch }), run };

  const connectionOpen = Boolean(status && (!status.keysOk || !status.connected));
  const sellingOpen = Boolean(status && (!status.policiesOk || !status.locationOk));

  const open: string[] = [];
  if (status && !status.keysOk) open.push('eBay-Zugang');
  else if (status && !status.connected) open.push('Verbindung');
  if (status && !status.policiesOk) open.push('Verkaufsprofile');
  if (status && !status.locationOk) open.push('Artikelstandort');

  return (
    <div className="card narrow">
      <h1>Einstellungen</h1>

      {open.length > 0 && <div className="banner warn">Noch offen: {open.join(', ')}</div>}

      <Tabs
        active={tab}
        onChange={(id) => setTab(id as TabId)}
        tabs={[
          { id: 'connection', label: 'Verbindung', flag: connectionOpen },
          { id: 'selling', label: 'Verkauf', flag: sellingOpen },
          { id: 'calc', label: 'Kalkulation' },
          { id: 'images', label: 'Bildquellen' },
          { id: 'invoices', label: 'Rechnungen' },
          { id: 'backup', label: 'Datensicherung' },
        ]}
      />

      {msg && <div className="banner success">{msg}</div>}
      {error && <div className="banner error">{error}</div>}

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'connection' && <ConnectionTab ctx={ctx} />}
        {tab === 'selling' && <SellingTab ctx={ctx} />}
        {tab === 'calc' && <CalcTab ctx={ctx} />}
        {tab === 'images' && <ImagesTab ctx={ctx} />}
        {tab === 'invoices' && <InvoicesTab />}
        {tab === 'backup' && <BackupTab />}
      </div>
    </div>
  );
}
