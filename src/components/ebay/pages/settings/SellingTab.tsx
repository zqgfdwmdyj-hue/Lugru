import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { PolicyLists, SettingsData, TabContext } from './types';

/** Vergleichbare Form der Adressfelder — zum Erkennen echter Änderungen. */
function addressKey(s: SettingsData): string {
  return JSON.stringify([s.locationAddressLine1, s.locationPostalCode, s.locationCity]);
}

export function SellingTab({ ctx }: { ctx: TabContext }) {
  const { s, status, set, run } = ctx;
  const [policies, setPolicies] = useState<PolicyLists | null>(null);
  const [needsOptIn, setNeedsOptIn] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [dirty, setDirty] = useState(false);
  // Stand der zuletzt an eBay geschickten Adresse — sonst ginge bei jedem
  // Speichern ein Standort-Aufruf raus, auch wenn nur ein Profil gewechselt hat.
  const [savedAddress, setSavedAddress] = useState(() => addressKey(s));

  const change = (patch: Partial<SettingsData>) => {
    set(patch);
    setDirty(true);
  };

  async function load() {
    setLoadError('');
    try {
      setPolicies(await api<PolicyLists>('/policies'));
      setNeedsOptIn(false);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setLoadError(m);
      setNeedsOptIn(/not eligible/i.test(m));
    }
  }

  // Die Profile kommen beim Öffnen des Reiters von selbst — der frühere
  // Klick auf „Profile von eBay laden" war ein Schritt ohne eigenen Zweck.
  const connected = Boolean(status?.connected);
  useEffect(() => {
    if (connected) void load();
  }, [connected]);

  return (
    <section className="stack">
      <h3>Verkaufsprofile</h3>
      {!connected ? (
        <p className="muted">Dafür muss zuerst die eBay-Verbindung stehen.</p>
      ) : (
        <>
          <p className="muted">Versand, Zahlung und Rückgabe — eBay hängt sie an jedes Angebot.</p>
          {needsOptIn && (
            <div className="banner warn">
              eBay muss dafür einmal freigeschaltet werden.{' '}
              <button
                className="linklike"
                onClick={() =>
                  run(async () => {
                    await api('/optin', { method: 'POST' });
                    await load();
                  }, 'Freigeschaltet.')
                }
              >
                Jetzt freischalten
              </button>
            </div>
          )}
          {loadError && !needsOptIn && <div className="banner error">{loadError}</div>}

          {policies && (
            <>
              <PolicySelect
                label="Versandprofil"
                options={policies.fulfillment}
                value={s.fulfillmentPolicyId ?? ''}
                onChange={(v) => change({ fulfillmentPolicyId: v })}
              />
              <PolicySelect
                label="Zahlungsprofil"
                options={policies.payment}
                value={s.paymentPolicyId ?? ''}
                onChange={(v) => change({ paymentPolicyId: v })}
              />
              <PolicySelect
                label="Rückgabeprofil"
                options={policies.return}
                value={s.returnPolicyId ?? ''}
                onChange={(v) => change({ returnPolicyId: v })}
              />
            </>
          )}
          <button className="linklike" onClick={() => void load()}>Profile neu laden</button>
        </>
      )}

      <h3>Artikelstandort</h3>
      <p className="muted">Von hier aus verschickst du. eBay zeigt die Stadt im Angebot an.</p>
      <label>
        Straße und Hausnummer
        <input
          value={s.locationAddressLine1}
          onChange={(e) => change({ locationAddressLine1: e.target.value })}
        />
      </label>
      <div className="row">
        <label>
          PLZ
          <input value={s.locationPostalCode} onChange={(e) => change({ locationPostalCode: e.target.value })} />
        </label>
        <label>
          Stadt
          <input value={s.locationCity} onChange={(e) => change({ locationCity: e.target.value })} />
        </label>
      </div>

      <div className="tab-actions">
        <button
          className="primary"
          disabled={!dirty}
          onClick={() =>
            run(async () => {
              const address = {
                addressLine1: s.locationAddressLine1,
                city: s.locationCity,
                postalCode: s.locationPostalCode,
              };
              const complete = Boolean(address.addressLine1 && address.city && address.postalCode);

              // Der Standort geht zu eBay und kann scheitern, die Profile sind
              // ein reiner Datenbankschreibvorgang. Deshalb der Standort zuerst:
              // stünden die Profile davor, wären sie bei einem Standortfehler
              // schon gespeichert, während die Meldung nur vom Standort spricht.
              if (complete && (addressKey(s) !== savedAddress || !status?.locationOk)) {
                await api('/location', { method: 'POST', body: JSON.stringify(address) });
                setSavedAddress(addressKey(s));
              }

              await api('/settings', {
                method: 'PUT',
                body: JSON.stringify({
                  fulfillmentPolicyId: s.fulfillmentPolicyId ?? '',
                  paymentPolicyId: s.paymentPolicyId ?? '',
                  returnPolicyId: s.returnPolicyId ?? '',
                }),
              });
              setDirty(false);
            }, 'Gespeichert.')
          }
        >
          Speichern
        </button>
        {dirty && <span className="muted">Es gibt ungespeicherte Änderungen.</span>}
      </div>
    </section>
  );
}

function PolicySelect({ label, options, value, onChange }: {
  label: string;
  options: { id: string; name: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— bitte wählen —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </label>
  );
}
