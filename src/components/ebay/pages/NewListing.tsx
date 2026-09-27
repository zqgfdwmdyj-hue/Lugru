import { useEffect, useState, type FormEvent } from 'react';
import {
  api, CONDITION_LABELS, looksLikeEan, parseAmount,
  type Attempt, type Condition, type FeeSettings, type SearchResult,
} from '../api';
import { ProfitTable } from '../components/ProfitTable';
// Dieselben reinen Funktionen wie auf dem Server — nicht nachgebaut, damit die
// Zahl in Schritt 3 exakt der entspricht, die nach dem Anlegen zurückkommt.
import { estimateFee, resolveFeeRate } from '@/lib/ebay/pipeline/fees';
import { computeProfit } from '@/lib/ebay/pipeline/profit';
import { purchaseUnitNet } from '@/lib/ebay/pipeline/purchasePrice';
import { ResultGrid } from '../components/ResultGrid';
import { Stepper, type Step } from '../components/Stepper';
import { SearchIcon } from '../components/icons';

type PriceMode = 'unit' | 'total';
type VatMode = 'net' | 'gross';

/**
 * Der Workflow bis zur Vorschau: EAN oder Produkttitel suchen (1) → Listing
 * aus den Treffern wählen (2) → Verkaufs- und Einkaufsdaten eingeben (3).
 * Der angedachte Verkaufspreis wird dabei zum Angebotspreis; die Einkaufsdaten
 * sind optional und speisen später die Artikelhistorie.
 * Der Entwurf entsteht erst beim Absenden von Schritt 3 — vorher wird nichts
 * gespeichert.
 */
export function NewListing({ onCreated }: { onCreated: (id: number) => void }) {
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [targetPrice, setTargetPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [purchasedUnits, setPurchasedUnits] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchasePriceMode, setPurchasePriceMode] = useState<PriceMode>('unit');
  const [purchasePriceVat, setPurchasePriceVat] = useState<VatMode>('net');
  const [purchaseSource, setPurchaseSource] = useState('');
  const [condition, setCondition] = useState<Condition>('NEW');
  const [feeSettings, setFeeSettings] = useState<FeeSettings | null>(null);
  const [settingsError, setSettingsError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Einmal laden: USt-Satz, eigene Gebührensätze und Versandkosten gehören in die Schätzung.
  useEffect(() => {
    api<FeeSettings>('/settings')
      .then(setFeeSettings)
      .catch((err) => setSettingsError(err instanceof Error ? err.message : String(err)));
  }, []);

  const step: Step = selected ? 'Daten' : results ? 'Auswählen' : 'Suchen';

  function fail(err: unknown) {
    setError(err instanceof Error ? err.message : String(err));
  }

  async function search(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setError('');
    setBusy(true);
    setSelected(null);
    try {
      const found = await api<SearchResult[]>(`/search?q=${encodeURIComponent(q)}`);
      setResults(found);
      setSearched(q);
    } catch (err) {
      setResults(null);
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  // Kalkulation, die beim Tippen mitläuft — erst, wenn die Einstellungen da sind,
  // sonst zeigte sie kurz einen Gewinn ohne Umsatzsteuer und Versand.
  const vk = parseAmount(targetPrice);
  const units = Number(purchasedUnits) || 0;
  const ekRaw = parseAmount(purchasePrice);
  const vatRate = feeSettings?.vatPercentage;

  let ekNet: number | undefined;
  let purchaseError = '';
  if (purchasePrice.trim() !== '' && (ekRaw === undefined || ekRaw <= 0)) {
    purchaseError = `Einkaufspreis: „${purchasePrice.trim()}" ist keine gültige Zahl.`;
  } else if (feeSettings) {
    // Dieselbe Funktion, die der Server zum Speichern nutzt — keine zweite Formel,
    // die bei einer Änderung an der Rundung auseinanderlaufen könnte, und
    // derselbe Fehler, wenn zum Umrechnen etwas fehlt.
    try {
      ekNet = purchaseUnitNet(ekRaw, {
        mode: purchasePriceMode,
        units,
        vatMode: purchasePriceVat,
        vatPercentage: vatRate,
      });
    } catch (err) {
      purchaseError = err instanceof Error ? err.message : String(err);
    }
  }

  const rate =
    feeSettings && vk !== undefined && vk > 0 ? resolveFeeRate(selected?.categoryId, condition, feeSettings) : null;
  const fee = feeSettings && rate && vk !== undefined ? estimateFee(vk, rate, feeSettings) : undefined;
  const profit =
    feeSettings && vk !== undefined && fee !== undefined && purchaseError === ''
      ? computeProfit({
          salePrice: vk,
          purchasePrice: ekNet,
          fee,
          shipping: feeSettings.shippingAssumption,
          vatPercentage: vatRate,
        })
      : null;

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    // Was der Server ablehnen würde, hier schon abweisen — ein Tippfehler im
    // Einkaufspreis ginge sonst als NaN → null → „kein Einkaufspreis" still durch.
    if (vk === undefined || vk <= 0) {
      setError(`Angedachter Verkaufspreis: „${targetPrice.trim()}" ist keine gültige Zahl.`);
      return;
    }
    if (purchaseError !== '') {
      setError(purchaseError);
      return;
    }
    setError('');
    setBusy(true);
    try {
      const attempt = await api<Attempt>('/attempts', {
        method: 'POST',
        body: JSON.stringify({
          ref: selected.ref,
          epid: selected.epid,
          ean: looksLikeEan(searched) ? searched.trim() : undefined,
          price: vk,
          targetPrice: vk,
          quantity: Number(quantity),
          condition,
          purchasedUnits: purchasedUnits === '' ? undefined : Number(purchasedUnits),
          purchasePrice: ekRaw,
          purchasePriceMode,
          purchasePriceVat,
          purchaseSource: purchaseSource.trim() || undefined,
        }),
      });
      onCreated(attempt.id);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flow">
      <Stepper current={step} />

      <section className={'hero' + (results ? ' compact' : '')}>
        {!results && (
          <>
            <h1>Was möchtest du verkaufen?</h1>
            <p className="lead">
              EAN oder Produkttitel eingeben — Titel, Bilder und Artikelmerkmale kommen aus dem eBay-Katalog,
              sonst aus dem gewählten Angebot.
            </p>
          </>
        )}
        <form className="searchbar" onSubmit={search}>
          <SearchIcon className="searchbar-icon" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="EAN oder Produkttitel"
            aria-label="EAN oder Produkttitel"
            autoFocus
          />
          <button className="primary" disabled={busy || query.trim().length < 2}>
            {busy && !selected ? 'Sucht …' : 'Suchen'}
          </button>
        </form>
        {!results && <p className="hint">Ein eingefügter eBay-Link funktioniert auch.</p>}
      </section>

      {error && <div className="banner error">{error}</div>}

      {!selected && results !== null && (
        <section className="results">
          <div className="results-head">
            <h2>
              {results.length === 0 ? 'Keine Treffer' : `${results.length} Treffer`} für „{searched}"
            </h2>
            {results.length > 0 && <span className="muted">Listing auswählen, um weiterzumachen</span>}
          </div>
          {results.length === 0 ? (
            <p className="muted">
              Nichts gefunden. Anderen Suchbegriff probieren — Marke und Modell reichen oft, sonst die EAN.
            </p>
          ) : (
            <ResultGrid
              results={results}
              onSelect={(r) => {
                setError('');
                setSelected(r);
              }}
            />
          )}
        </section>
      )}

      {selected && (
        <section className="card details">
          <div className="chosen">
            {selected.imageUrl ? <img src={selected.imageUrl} alt="" /> : <div className="noimg">Kein Bild</div>}
            <div className="chosen-text">
              <div className="chosen-title">{selected.title}</div>
              <div className="muted">
                {selected.epid ? 'Mit Katalogdaten' : 'Ohne Katalogreferenz — Daten aus dem Angebot'}
                {selected.itemWebUrl && (
                  <>
                    {' · '}
                    <a href={selected.itemWebUrl} target="_blank" rel="noreferrer">Angebot ansehen ↗</a>
                  </>
                )}
              </div>
            </div>
            <button
              className="linklike"
              onClick={() => {
                setError('');
                setSelected(null);
              }}
            >
              Anderes Listing
            </button>
          </div>

          <form onSubmit={create} className="stack">
            <div className="row">
              <label>
                Angedachter Verkaufspreis (€)
                <input
                  value={targetPrice}
                  onChange={(e) => setTargetPrice(e.target.value)}
                  placeholder="z.B. 19,99"
                  inputMode="decimal"
                  autoFocus
                  required
                />
              </label>
              <label>
                Stückzahl im Angebot
                <input
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  type="number"
                  min={1}
                  step={1}
                  required
                />
              </label>
              <label>
                Zustand
                <select value={condition} onChange={(e) => setCondition(e.target.value as Condition)}>
                  {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
            </div>

            <fieldset className="purchase">
              <legend>Einkauf <span className="muted">— optional</span></legend>
              <div className="row">
                <label>
                  Gekaufte Einheiten
                  <input
                    value={purchasedUnits}
                    onChange={(e) => setPurchasedUnits(e.target.value)}
                    type="number"
                    min={1}
                    step={1}
                    placeholder="z.B. 10"
                    // Ein Gesamtbetrag ist ohne Stückzahl nicht umrechenbar.
                    required={purchasePriceMode === 'total' && purchasePrice.trim() !== ''}
                  />
                </label>
                <label>
                  Einkaufspreis (€)
                  <span className="with-toggle">
                    <input
                      value={purchasePrice}
                      onChange={(e) => setPurchasePrice(e.target.value)}
                      placeholder="z.B. 8,50"
                      inputMode="decimal"
                    />
                    <select
                      value={purchasePriceMode}
                      onChange={(e) => setPurchasePriceMode(e.target.value as PriceMode)}
                      aria-label="Einkaufspreis pro Stück oder gesamt"
                    >
                      <option value="unit">pro Stück</option>
                      <option value="total">gesamt</option>
                    </select>
                    <select
                      value={purchasePriceVat}
                      onChange={(e) => setPurchasePriceVat(e.target.value as VatMode)}
                      aria-label="Einkaufspreis netto oder brutto"
                      title={vatRate ? undefined : 'Brutto braucht einen USt-Satz in den Einstellungen.'}
                    >
                      <option value="net">netto</option>
                      <option value="gross" disabled={!vatRate}>brutto</option>
                    </select>
                  </span>
                </label>
                <label>
                  Einkaufsquelle
                  <input
                    value={purchaseSource}
                    onChange={(e) => setPurchaseSource(e.target.value)}
                    placeholder="Händler oder Link"
                  />
                </label>
              </div>
              {settingsError && (
                <div className="banner error">
                  Einstellungen konnten nicht geladen werden ({settingsError}) — ohne sie keine Kalkulation.
                </div>
              )}
              {purchaseError && <div className="banner warn">{purchaseError}</div>}
              {profit && (
                <>
                  <ProfitTable profit={profit} feePercent={rate?.percent} />
                  <p className="muted">
                    {rate && !rate.matched && (
                      selected?.categoryId
                        ? `Für Kategorie ${selected.categoryId} ist kein Gebührensatz hinterlegt — es gilt der Standardsatz. `
                        : 'Zu diesem Treffer liefert eBay keine Kategorie — es gilt der Standardsatz. '
                    )}
                    Geschätzt: die tatsächliche Provision steht erst nach dem Verkauf fest.
                  </p>
                </>
              )}
            </fieldset>
            <button className="primary big" disabled={busy}>
              {busy ? 'Katalog & GPSR werden geholt …' : 'Weiter zur Vorschau'}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
