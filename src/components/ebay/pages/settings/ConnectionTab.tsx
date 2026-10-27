import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { StatusData, TabContext } from './types';


function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('de-DE', { timeZone: "Europe/Berlin", day: '2-digit', month: '2-digit', year: 'numeric' });
}

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Läuft die neue eBay-Listing-Schnittstelle – oder fällt das System auf die bisherige zurück? */
function ListingApiNote({ a }: { a: NonNullable<StatusData['listingApi']> }) {
  const failing = a.lastErrorAt && (!a.lastOkAt || a.lastErrorAt > a.lastOkAt);
  let tag: [string, string];
  let text: string;
  if (a.tradingOnly) [tag, text] = [['tag-warn', 'abgeschaltet'], 'Per Notschalter abgeschaltet – alles läuft über die bisherige Trading-Schnittstelle.'];
  else if (a.granted === false) [tag, text] = [['tag-warn', 'nicht freigegeben'], 'Diese Verbindung erlaubt die neue Schnittstelle noch nicht. Unten mit Häkchen „Neue eBay-Listing-Schnittstelle“ einmal neu verbinden. Bis dahin läuft alles wie bisher.'];
  else if (failing) [tag, text] = [['tag-warn', 'Rückfall'], `Zuletzt am ${dateTime(a.lastErrorAt!)} auf die bisherige Schnittstelle ausgewichen: ${a.lastError ?? ''}`];
  else if (a.lastOkAt) [tag, text] = [['tag-ok', 'aktiv'], `Zuletzt genutzt am ${dateTime(a.lastOkAt)}.`];
  else [tag, text] = [['tag-missing', 'noch nicht genutzt'], 'Wird beim nächsten Abruf genutzt; klappt es nicht, springt die bisherige Schnittstelle ein.'];
  return (
    <p className="small" data-testid="ebay-listing-api">
      <strong>Neue eBay-Schnittstelle:</strong> <span className={`tag ${tag[0]}`}>{tag[1]}</span> {text}
    </p>
  );
}

export function ConnectionTab({ ctx }: { ctx: TabContext }) {
  const { s, status, run } = ctx;
  const [consentUrl, setConsentUrl] = useState('');
  const [redirectUrl, setRedirectUrl] = useState('');
  /** Bestellungen lesen (für Rechnungen) mit anfragen — abschaltbar, falls eBay die Anmeldung damit ablehnt. */
  const [withOrders, setWithOrders] = useState(true);
  const [withAnalytics, setWithAnalytics] = useState(true);
  /** Neue Listing-Schnittstelle (sell.listing) – abschaltbar, falls eBay sie für den Entwicklerzugang noch nicht freigibt. */
  const [withListing, setWithListing] = useState(true);

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
          {status.connected && status.listingApi && <ListingApiNote a={status.listingApi} />}
          <p className="muted">
            Die Verbindung erneuert sich von selbst. Läuft sie ab oder wechselst du das eBay-Konto,
            hier neu verbinden.
          </p>

          <label className="check">
            <input type="checkbox" checked={withOrders} onChange={(e) => setWithOrders(e.target.checked)} />
            Bestellungen lesen erlauben (nötig für Rechnungen)
          </label>
          <label className="check">
            <input type="checkbox" checked={withAnalytics} onChange={(e) => setWithAnalytics(e.target.checked)} />
            Verkehrsdaten lesen erlauben (Einblendungen, Klicks, Käufe für „Angebote prüfen")
          </label>
          <label className="check">
            <input type="checkbox" checked={withListing} onChange={(e) => setWithListing(e.target.checked)} />
            Neue eBay-Listing-Schnittstelle erlauben (ersetzt die alte Trading-Schnittstelle für Angebotsliste, Prüfen, Ändern und Mengen)
          </label>
          <p className="muted small">
            Zeigt eBay schon vor der Anmeldung „invalid_request", erst das Häkchen „Neue Listing-Schnittstelle", dann „Verkehrsdaten", dann „Bestellungen" entfernen und erneut verbinden.
            Klappt es dann, ist die Bestell-Berechtigung für deinen Entwicklerzugang nicht freigegeben;
            sonst passt der RuName nicht zur Client ID (oben prüfen).
          </p>
          <button
            onClick={() =>
              run(async () => {
                const q = [withOrders ? '' : 'orders=0', withAnalytics ? '' : 'analytics=0', withListing ? '' : 'listing=0'].filter(Boolean).join('&');
                const r = await api<{ url: string }>(`/auth/url${q ? `?${q}` : ''}`);
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
