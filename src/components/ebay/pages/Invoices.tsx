import { useCallback, useEffect, useState } from 'react';
import { api, formatDate, formatPrice } from '../api';
import { AccountingExport } from '../components/AccountingExport';

interface InvoiceSummary {
  id: number;
  number: string;
  kind: 'invoice' | 'storno';
  orderId: string;
  date: string;
  buyerName: string;
  buyerEmail?: string;
  total: number;
  currency: string;
  emailedAt?: string;
  emailTo?: string;
  emailError?: string;
  cancelledBy?: string;
  cancels?: string;
}

interface OpenOrder {
  orderId: string;
  createdAt: string;
  buyer: { name: string };
  buyerUsername?: string;
  items: { title: string; quantity: number; totalGross: number }[];
  shippingGross: number;
  discountGross: number;
  currency: string;
}

interface SyncStatus { at: string; created: number; sent: number; error?: string }

interface InvoiceInfo {
  settings: { autoCreate?: boolean; autoSend?: boolean };
  missing: string[];
  env: string;
  lastSync: SyncStatus | null;
}

function orderTotal(o: OpenOrder): number {
  return o.items.reduce((s, i) => s + i.totalGross, 0) + o.shippingGross - o.discountGross;
}

/** Rechnungen zu eBay-Bestellungen: offene Bestellungen, erstellte Rechnungen, Versand und Storno. */
export function Invoices({ onSettings }: { onSettings: () => void }) {
  const [info, setInfo] = useState<InvoiceInfo | null>(null);
  const [invoices, setInvoices] = useState<InvoiceSummary[] | null>(null);
  const [orders, setOrders] = useState<OpenOrder[] | null>(null);
  const [ordersError, setOrdersError] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [confirmCancel, setConfirmCancel] = useState<number | null>(null);
  const [sendTo, setSendTo] = useState<{ id: number; to: string } | null>(null);

  const loadInvoices = useCallback(() => {
    api<InvoiceSummary[]>('/invoices').then(setInvoices).catch((e) => setError(e.message));
    api<InvoiceInfo>('/invoice-settings').then(setInfo).catch(() => {});
  }, []);

  const loadOrders = useCallback(() => {
    setOrdersError('');
    setOrders(null);
    api<OpenOrder[]>('/invoices/open-orders').then(setOrders).catch((e) => setOrdersError(e.message));
  }, []);

  useEffect(() => {
    loadInvoices();
    loadOrders();
  }, [loadInvoices, loadOrders]);

  async function act(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setError('');
    setMsg('');
    try {
      const m = await fn();
      if (m) setMsg(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
      loadInvoices();
    }
  }

  const ready = info && info.env === 'production' && info.missing.length === 0;

  return (
    <div className="card">
      <div className="invoice-head">
        <h1>Rechnungen</h1>
        <button
          className="primary"
          disabled={!ready || busy !== ''}
          onClick={() =>
            act('sync', async () => {
              const s = await api<SyncStatus>('/invoices/sync', { method: 'POST' });
              loadOrders();
              if (s.error) throw new Error(s.error);
              return s.created === 0 ? 'Keine neuen bezahlten Bestellungen.' : `${s.created} Rechnung(en) erstellt, ${s.sent} verschickt.`;
            })
          }
        >
          {busy === 'sync' ? 'Wird abgerufen …' : 'Alle offenen jetzt abrechnen'}
        </button>
      </div>

      {info && info.env !== 'production' && (
        <div className="banner warn">Rechnungen gibt es nur für echte Bestellungen — in den Einstellungen ist die Sandbox aktiv.</div>
      )}
      {info && info.missing.length > 0 && (
        <div className="banner warn">
          Für Rechnungen fehlen noch: {info.missing.join(', ')}.{' '}
          <button className="linklike" onClick={onSettings}>Jetzt eintragen</button>
        </div>
      )}
      {info && (
        <p className="muted">
          Automatik: {info.settings.autoCreate ? `an${info.settings.autoSend ? ', mit E-Mail-Versand' : ', ohne E-Mail-Versand'}` : 'aus'}
          {info.lastSync && <> · letzter Abruf {formatDate(info.lastSync.at)}{info.lastSync.error ? ` — Fehler: ${info.lastSync.error}` : ''}</>}
          {' · '}<button className="linklike" onClick={onSettings}>Einstellungen</button>
        </p>
      )}
      {msg && <div className="banner success">{msg}</div>}
      {error && <div className="banner error">{error}</div>}

      <h3>Bezahlte Bestellungen ohne Rechnung</h3>
      {ordersError ? (
        <div className="banner error">{ordersError}</div>
      ) : orders === null ? (
        <p className="muted">Bestellungen werden bei eBay abgerufen …</p>
      ) : orders.length === 0 ? (
        <p className="muted">Keine offenen Bestellungen.</p>
      ) : (
        <div className="table-wrap">
          <table className="history">
            <thead><tr><th>Bestellt</th><th>Käufer</th><th>Artikel</th><th>Betrag</th><th></th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.orderId}>
                  <td>{formatDate(o.createdAt)}</td>
                  <td>{o.buyer.name}{o.buyerUsername && <div className="muted small">{o.buyerUsername}</div>}</td>
                  <td className="title-cell" title={o.items.map((i) => i.title).join(', ')}>
                    {o.items.map((i) => `${i.quantity}× ${i.title}`).join(', ')}
                  </td>
                  <td className="mono">{formatPrice(orderTotal(o), o.currency)}</td>
                  <td className="actions">
                    <button
                      disabled={!ready || busy !== ''}
                      onClick={() =>
                        act(`o${o.orderId}`, async () => {
                          const inv = await api<InvoiceSummary>('/invoices/from-order', { method: 'POST', body: JSON.stringify({ orderId: o.orderId }) });
                          setOrders((list) => (list ?? []).filter((x) => x.orderId !== o.orderId));
                          return `Rechnung ${inv.number} erstellt.`;
                        })
                      }
                    >
                      Rechnung erstellen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Erstellte Rechnungen</h3>
      {invoices === null ? (
        <p className="muted">Lädt …</p>
      ) : invoices.length === 0 ? (
        <p className="muted">Noch keine Rechnungen.</p>
      ) : (
        <div className="table-wrap">
          <table className="history">
            <thead><tr><th>Nummer</th><th>Datum</th><th>Käufer</th><th>Betrag</th><th>E-Mail</th><th></th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className={i.cancelledBy ? 'cancelled' : undefined}>
                  <td className="mono">
                    {i.number}
                    {i.kind === 'storno' && <div className="muted small">Storno zu {i.cancels}</div>}
                    {i.cancelledBy && <div className="muted small">storniert durch {i.cancelledBy}</div>}
                  </td>
                  <td>{formatDate(i.date)}</td>
                  <td>{i.buyerName}<div className="muted small">Bestellung {i.orderId}</div></td>
                  <td className="mono">{formatPrice(i.total, i.currency)}</td>
                  <td>
                    {i.emailedAt
                      ? <span title={i.emailTo}>✓ {formatDate(i.emailedAt)}</span>
                      : i.emailError
                        ? <span className="neg" title={i.emailError}>Fehler</span>
                        : <span className="muted">—</span>}
                  </td>
                  <td className="actions">
                    <a href={`/api/ebay/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>
                    <button className="linklike" disabled={busy !== ''} onClick={() => setSendTo({ id: i.id, to: i.emailTo ?? i.buyerEmail ?? '' })}>
                      Senden
                    </button>
                    {i.kind === 'invoice' && !i.cancelledBy && (
                      <button className="linklike" disabled={busy !== ''} onClick={() => setConfirmCancel(i.id)}>Stornieren</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sendTo && (
        <div className="banner">
          <label>
            Rechnung per E-Mail senden an
            <span className="with-toggle">
              <input value={sendTo.to} onChange={(e) => setSendTo({ ...sendTo, to: e.target.value })} placeholder="E-Mail-Adresse" />
              <button
                className="primary"
                disabled={busy !== '' || sendTo.to.trim() === ''}
                onClick={() =>
                  act('send', async () => {
                    const r = await api<InvoiceSummary>(`/invoices/${sendTo.id}/send`, { method: 'POST', body: JSON.stringify({ to: sendTo.to }) });
                    setSendTo(null);
                    return `Rechnung ${r.number} an ${r.emailTo} gesendet.`;
                  })
                }
              >
                Senden
              </button>
              <button onClick={() => setSendTo(null)}>Abbrechen</button>
            </span>
          </label>
        </div>
      )}

      {confirmCancel !== null && (
        <div className="banner warn">
          Rechnung {invoices?.find((i) => i.id === confirmCancel)?.number} stornieren? Dafür wird eine Stornorechnung mit
          eigener Nummer erstellt — die Originalrechnung bleibt erhalten, wie es das Gesetz verlangt.
          <span className="legacy-bulk">
            <button
              className="primary"
              onClick={() =>
                act('cancel', async () => {
                  const s = await api<InvoiceSummary>(`/invoices/${confirmCancel}/cancel`, { method: 'POST' });
                  setConfirmCancel(null);
                  loadOrders();
                  return `Stornorechnung ${s.number} erstellt.`;
                })
              }
            >
              Stornorechnung erstellen
            </button>
            <button onClick={() => setConfirmCancel(null)}>Abbrechen</button>
          </span>
        </div>
      )}

      <AccountingExport />
    </div>
  );
}
