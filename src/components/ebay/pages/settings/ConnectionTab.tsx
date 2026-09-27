import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { TabContext } from './types';


function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function ConnectionTab({ ctx }: { ctx: TabContext }) {
  const { s, status, run } = ctx;
  const [consentUrl, setConsentUrl] = useState('');
  const [redirectUrl, setRedirectUrl] = useState('');
  /** Bestellungen lesen (für Rechnungen) mit anfragen — abschaltbar, falls eBay die Anmeldung damit ablehnt. */
  const [withOrders, setWithOrders] = useState(true);

  const until = formatDate(status?.connectionExpiresAt ?? null);
  /** Zugangsdaten der gewählten Umgebung – im bisherigen Tool per setup.cmd, hier im Formular. */
  const [keys, setKeys] = useState({ clientId: s.clientId ?? '', clientSecret: s.clientSecret ?? '', ruName: s.ruName ?? '' });
  // Nach einem Umgebungswechsel oder Speichern die Felder aus den geladenen Einstellungen füllen.
  useEffect(() => {
    setKeys({ clientId: s.clientId ?? '', clientSecret: s.clientSecret ?? '', ruName: s.ruName ?? '' });
  }, [s.env, s.clientId, s.clientSecret, s.ruName]);
  const keysDirty =
    keys.clientId !== (s.clientId ?? '') || keys.clientSecret !== (s.clientSecret ?? '') || keys.ruName !== (s.ruName ?? '');

  return (
    <section className="stack">
      <label>
        Umgebung
        <select
          value={s.env}
          onChange={(e) =>
            run(async () => {
              await api('/settings', { method: 'PUT', body: JSON.stringify({ env: e.target.value }) });
            }, 'Umgebung gewechselt.')
          }
        >
          <option value="sandbox">Sandbox (Testsystem)</option>
          <option value="production">Production (echtes eBay)</option>
        </select>
      </label>
      <p className="muted">Sandbox ist eBays Testsystem — Angebote dort sind nicht öffentlich sichtbar.</p>

      <h3>eBay-Zugang ({s.env === 'production' ? 'Production' : 'Sandbox'})</h3>
      <p className="muted">
        Client ID, Client Secret und RuName von developer.ebay.com → Application Keys (je Umgebung eigene Werte).
        Der RuName steht unter User Tokens → „Get a Token from eBay via Your Application" → eBay Redirect URL.
      </p>
      <div className="row">
        <label>
          Client ID (App ID)
          <input value={keys.clientId} onChange={(e) => setKeys({ ...keys, clientId: e.target.value.trim() })} autoComplete="off" />
        </label>
        <label>
          Client Secret (Cert ID)
          <input
            type="password"
            value={keys.clientSecret}
            onChange={(e) => setKeys({ ...keys, clientSecret: e.target.value.trim() })}
            placeholder={s.clientSecret ? 'gespeichert' : ''}
            autoComplete="new-password"
          />
        </label>
      </div>
      <label>
        RuName
        <input value={keys.ruName} onChange={(e) => setKeys({ ...keys, ruName: e.target.value.trim() })} autoComplete="off" />
      </label>
      <div className="tab-actions">
        <button
          className="primary"
          disabled={!keysDirty || keys.clientId === '' || keys.ruName === ''}
          onClick={() =>
            run(async () => {
              await api('/settings', { method: 'PUT', body: JSON.stringify(keys) });
            }, 'eBay-Zugang gespeichert.')
          }
        >
          Zugang speichern
        </button>
      </div>

      {!status ? null : !status.keysOk ? (
        <div className="banner warn">Für diese Umgebung ist noch kein eBay-Zugang hinterlegt — bitte oben eintragen.</div>
      ) : (
        <>
          <div className={'banner ' + (status.connected ? 'success' : 'warn')}>
            {status.connected
              ? until
                ? `Mit eBay verbunden · gültig bis ${until}`
                : 'Mit eBay verbunden'
              : 'Noch nicht mit eBay verbunden.'}
          </div>
          <p className="muted">
            Die Verbindung erneuert sich von selbst. Läuft sie ab oder wechselst du das eBay-Konto,
            hier neu verbinden.
          </p>

          <label className="check">
            <input type="checkbox" checked={withOrders} onChange={(e) => setWithOrders(e.target.checked)} />
            Bestellungen lesen erlauben (nötig für Rechnungen)
          </label>
          <p className="muted small">
            Zeigt eBay schon vor der Anmeldung „invalid_request", das Häkchen entfernen und erneut verbinden.
            Klappt es dann, ist die Bestell-Berechtigung für deinen Entwicklerzugang nicht freigegeben;
            sonst passt der RuName nicht zur Client ID (oben prüfen).
          </p>
          <button
            onClick={() =>
              run(async () => {
                const r = await api<{ url: string }>(`/auth/url${withOrders ? '' : '?orders=0'}`);
                setConsentUrl(r.url);
                window.open(r.url, '_blank');
              }, 'eBay-Anmeldung geöffnet.')
            }
          >
            {status.connected ? 'Verbindung erneuern' : 'Mit eBay verbinden'}
          </button>

          {consentUrl && (
            <>
              <p className="muted">
                Öffnet sich kein Fenster, diese Adresse von Hand aufrufen. Nach der Zustimmung die
                komplette Adresse aus der Adresszeile des Browsers kopieren und unten einfügen.
              </p>
              <input readOnly value={consentUrl} onFocus={(e) => e.currentTarget.select()} />
              <label>
                Adresse nach der Zustimmung
                <input
                  value={redirectUrl}
                  onChange={(e) => setRedirectUrl(e.target.value)}
                  placeholder="https://…?code=…"
                />
              </label>
              <button
                className="primary"
                disabled={redirectUrl.trim() === ''}
                onClick={() =>
                  run(async () => {
                    await api('/auth/code', { method: 'POST', body: JSON.stringify({ redirectUrl }) });
                    setRedirectUrl('');
                    setConsentUrl('');
                  }, 'Verbunden.')
                }
              >
                Fertig
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
