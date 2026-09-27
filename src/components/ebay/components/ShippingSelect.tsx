import { useEffect, useState } from 'react';
import { api, formatPrice, type Attempt } from '../api';

interface ShippingPolicy {
  id: string;
  name: string;
  cost?: number;
  freeShipping?: boolean;
  handlingDays?: number;
}

function label(p: ShippingPolicy): string {
  const cost = p.freeShipping ? 'kostenlos' : p.cost !== undefined ? formatPrice(p.cost) : undefined;
  return cost ? `${p.name} — ${cost}` : p.name;
}

/**
 * Versandprofil je Angebot. Die Profile kommen live von eBay — so stehen hier
 * genau die Versandarten, die im eBay-Konto hinterlegt sind. „Standard" ist
 * das Profil aus den Einstellungen.
 */
export function ShippingSelect({ attempt, editable, onChange }: {
  attempt: Attempt;
  editable: boolean;
  onChange: (fulfillmentPolicyId: string) => void;
}) {
  const [policies, setPolicies] = useState<ShippingPolicy[] | null>(null);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const r = await api<{ policies: ShippingPolicy[]; defaultId: string | null }>('/shipping-policies');
      setPolicies(r.policies);
      setDefaultId(r.defaultId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const fallback = policies?.find((p) => p.id === defaultId);
  const selected = attempt.fulfillmentPolicyId ?? '';
  // Ein gespeichertes Profil, das es bei eBay nicht mehr gibt, bleibt sichtbar statt still zu verschwinden.
  const unknown = selected !== '' && policies !== null && !policies.some((p) => p.id === selected);

  return (
    <label>
      Versand
      <select value={selected} disabled={!editable || policies === null} onChange={(e) => onChange(e.target.value)}>
        <option value="">
          {policies === null
            ? error ? 'Versandprofile nicht ladbar' : 'Versandprofile werden geladen …'
            : fallback ? `Standard: ${label(fallback)}` : 'Standard aus den Einstellungen'}
        </option>
        {(policies ?? []).map((p) => (
          <option key={p.id} value={p.id}>{label(p)}</option>
        ))}
        {unknown && <option value={selected}>Profil {selected} (bei eBay nicht mehr vorhanden)</option>}
      </select>
      {error && (
        <span className="muted small">
          {error} <button type="button" className="linklike" onClick={() => void load()}>Erneut laden</button>
        </span>
      )}
    </label>
  );
}
