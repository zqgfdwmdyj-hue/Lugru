import { useEffect, useRef, useState } from 'react';
import {
  api, CONDITION_LABELS, STATUS_LABELS, formatPercent, formatPrice, parseAmount,
  type Attempt, type CompanyContact, type Condition,
} from '../api';
import { ListingSearch } from './ListingSearch';
import { ImageManager } from './ImageManager';
import { Stepper } from '../components/Stepper';
import { ArrowLeftIcon } from '../components/icons';
import { ProfitTable } from '../components/ProfitTable';
import { ShippingSelect } from '../components/ShippingSelect';
import { DescriptionEditor } from '../components/DescriptionEditor';
import { IdealoPanel } from '../components/IdealoPanel';
import {
  asInput, fieldAfterToggle, placeholderFor, planPurchaseSave, type PriceMode, type VatMode,
} from '../purchaseEntry';

/** Die Eingabefelder, die einen Wert des Entwurfs spiegeln. */
type Field = 'title' | 'price' | 'quantity' | 'purchasedUnits' | 'purchasePrice' | 'purchaseSource';
const ALL_FIELDS: Field[] = ['title', 'price', 'quantity', 'purchasedUnits', 'purchasePrice', 'purchaseSource'];

/** Schritt 4: Vorschau des Entwurfs, Feinschliff und „Listing erstellen". */
export function Preview({ id, onBack }: { id: number; onBack: () => void }) {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [purchasedUnits, setPurchasedUnits] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchasePriceMode, setPurchasePriceMode] = useState<PriceMode>('unit');
  const [purchasePriceVat, setPurchasePriceVat] = useState<VatMode>('net');
  /** Nach einem Umschalten auf gesamt/brutto geleert — wartet auf eine Neueingabe (siehe purchaseEntry.ts). */
  const [purchasePending, setPurchasePending] = useState(false);
  /** Rückmeldung nach einer Umrechnung — das Feld zeigt danach einen anderen Wert als getippt. */
  const [purchaseNote, setPurchaseNote] = useState('');
  const [purchaseSource, setPurchaseSource] = useState('');
  const [rateInput, setRateInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const purchasePriceInput = useRef<HTMLInputElement>(null);
  // Speichern läuft nacheinander: zwei schnelle Blur-Events dürfen sich nicht überholen.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  /**
   * Übernimmt eine Server-Antwort. In die Eingabefelder zurückgeschrieben werden
   * nur die genannten — sonst überschriebe die Antwort auf das eben verlassene
   * Feld, was im nächsten gerade getippt wird.
   */
  function adopt(a: Attempt, fields: Field[] = ALL_FIELDS) {
    setAttempt(a);
    for (const f of fields) {
      if (f === 'title') setTitle(a.title ?? '');
      else if (f === 'price') setPrice(asInput(a.price));
      else if (f === 'quantity') setQuantity(String(a.quantity));
      else if (f === 'purchasedUnits') setPurchasedUnits(a.purchasedUnits === undefined ? '' : String(a.purchasedUnits));
      else if (f === 'purchasePrice') {
        setPurchasePrice(asInput(a.purchasePrice));
        setPurchasePending(false);
      } else if (f === 'purchaseSource') setPurchaseSource(a.purchaseSource ?? '');
    }
  }

  useEffect(() => {
    api<Attempt>(`/attempts/${id}`).then((a) => adopt(a)).catch((err) => setError(err.message));
  }, [id]);

  if (!attempt) {
    return <div className="card narrow">{error ? <div className="banner error">{error}</div> : 'Lädt …'}</div>;
  }

  const editable = attempt.status === 'draft' || attempt.status === 'publish_failed';

  /**
   * Speichert und meldet, ob es geklappt hat. Ein Treffer-Wechsel (`ref`, `url`)
   * ändert Titel, Bilder und Merkmale — dann werden alle Felder übernommen;
   * sonst nur die aus dem Body, weil der Server sie normalisiert (Titel gekürzt,
   * Einkaufspreis auf den Netto-Stückpreis gebracht).
   */
  function patch(body: Record<string, unknown>): Promise<Attempt | null> {
    const fields = 'ref' in body || 'url' in body ? ALL_FIELDS : ALL_FIELDS.filter((f) => f in body);
    const run = queue.current.then(async () => {
      setError('');
      try {
        const a = await api<Attempt>(`/attempts/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
        adopt(a, fields);
        return a;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    });
    queue.current = run;
    return run;
  }

  async function publish() {
    setError('');
    setBusy(true);
    try {
      setAttempt(await api<Attempt>(`/attempts/${id}/publish`, { method: 'POST' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function saveTitle() {
    if (title.trim() !== '' && title !== attempt!.title) void patch({ title });
  }

  function savePrice() {
    const value = parseAmount(price);
    if (value === undefined || value <= 0) {
      setError(`Preis: „${price.trim()}" ist keine gültige Zahl.`);
      return;
    }
    if (value !== attempt!.price) void patch({ price: value });
  }

  function saveQuantity() {
    const value = parseAmount(quantity);
    if (value === undefined || !Number.isInteger(value) || value < 1) {
      setError('Stückzahl: bitte eine ganze Zahl ab 1.');
      return;
    }
    if (value !== attempt!.quantity) void patch({ quantity: value });
  }

  /**
   * Leere Eingabe löscht das Feld. Eine ungültige Eingabe wird abgewiesen, statt
   * gesendet zu werden: `Number('abc')` ist `NaN`, und `JSON.stringify` macht
   * daraus `null` — ein Tippfehler würde den gespeicherten Wert sonst
   * kommentarlos löschen.
   */
  function saveUnits() {
    const trimmed = purchasedUnits.trim();
    if (trimmed === '') {
      if (attempt!.purchasedUnits !== undefined) void patch({ purchasedUnits: null });
      return;
    }
    const value = parseAmount(trimmed);
    if (value === undefined || !Number.isInteger(value) || value < 1) {
      setError('Gekaufte Einheiten: bitte eine ganze Zahl ab 1.');
      return;
    }
    if (value !== attempt!.purchasedUnits) void patch({ purchasedUnits: value });
  }

  /** Feld und Umschalter zurück auf den gespeicherten Stand — ohne zu speichern. */
  function resetPurchaseField() {
    setPurchasePriceMode('unit');
    setPurchasePriceVat('net');
    setPurchasePending(false);
    setPurchasePrice(asInput(attempt!.purchasePrice));
  }

  /**
   * Der Betrag darf wie in Schritt 3 gesamt und/oder brutto sein. Gespeichert
   * wird der Netto-Stückpreis; das Feld zeigt danach diesen Wert, und die
   * Umschalter springen zurück. Was zu tun ist, entscheidet planPurchaseSave —
   * insbesondere, dass ein Umschalten ohne Neueingabe nichts umrechnet.
   */
  async function savePurchasePrice() {
    const plan = planPurchaseSave({
      raw: purchasePrice,
      mode: purchasePriceMode,
      vat: purchasePriceVat,
      pending: purchasePending,
      stored: attempt!.purchasePrice,
      unitsRaw: purchasedUnits,
    });
    if (plan.kind === 'skip') return;
    if (plan.kind === 'restore') return resetPurchaseField();
    if (plan.kind === 'error') return setError(plan.message);
    if (plan.kind === 'clear') {
      await patch({ purchasePrice: null });
      return;
    }
    const saved = await patch(plan.body);
    if (saved) {
      setPurchasePriceMode('unit');
      setPurchasePriceVat('net');
      setPurchasePending(false);
      if (plan.converting && saved.purchasePrice !== undefined) {
        setPurchaseNote(`Gespeichert: ${formatPrice(saved.purchasePrice)} je Stück netto (aus ${plan.entered}).`);
      }
    }
  }

  /**
   * Die Umschalter beschreiben eine neue Eingabe: Für gesamt/brutto wird das
   * Feld geleert und fokussiert, damit der gespeicherte Netto-Stückpreis nicht
   * als Gesamt- oder Bruttobetrag durchgeht.
   */
  function switchPurchase(mode: PriceMode, vat: VatMode) {
    setPurchasePriceMode(mode);
    setPurchasePriceVat(vat);
    const next = fieldAfterToggle(mode, vat, attempt!.purchasePrice);
    setPurchasePrice(next.raw);
    setPurchasePending(next.pending);
    setPurchaseNote('');
    if (next.pending) purchasePriceInput.current?.focus();
  }

  /** Altbestand: der Nutzer sagt, ob der gespeicherte Wert schon netto war oder brutto und umgerechnet wird. */
  async function settleBasis(action: 'confirm' | 'convert') {
    setError('');
    try {
      await api('/purchases/basis', { method: 'POST', body: JSON.stringify({ ids: [id], action }) });
      adopt(await api<Attempt>(`/attempts/${id}`), ['purchasePrice']);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Trägt den Satz für diese Kategorie in die Einstellungen ein — so wächst die Liste beim Arbeiten. */
  async function saveRate() {
    const categoryId = attempt?.categoryId;
    if (!categoryId) return;
    const percent = parseAmount(rateInput);
    if (percent === undefined || percent < 0 || percent > 100) {
      setError('Der Satz muss eine Zahl zwischen 0 und 100 sein.');
      return;
    }
    setError('');
    try {
      const current = await api<{ feeCategoryRates?: Record<string, number> }>('/settings');
      const rates = { ...(current.feeCategoryRates ?? {}), [categoryId]: percent };
      await api('/settings', { method: 'PUT', body: JSON.stringify({ feeCategoryRates: JSON.stringify(rates) }) });
      setRateInput('');
      // Nur die Zahlen ändern sich — die Eingabefelder bleiben, wie sie sind.
      setAttempt(await api<Attempt>(`/attempts/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const gpsr = attempt.gpsr;

  return (
    <div className="flow">
      <Stepper current="Vorschau" />

      <div className="card">
        <div className="preview-head">
          <button className="back" onClick={onBack}><ArrowLeftIcon size={16} /> Neue Suche</button>
          <span className={`badge status-${attempt.status}`}>{STATUS_LABELS[attempt.status]}</span>
        </div>

        {attempt.status === 'published' && (
          <div className="banner success">
            Listing ist live!{' '}
            {attempt.listingUrl && (
              <a href={attempt.listingUrl} target="_blank" rel="noreferrer">Bei eBay ansehen ↗</a>
            )}
          </div>
        )}
        {attempt.errorMessage && attempt.status !== 'published' && (
          <div className="banner error">{attempt.errorMessage}</div>
        )}
        {(attempt.warnings ?? []).map((w, i) => (
          <div key={i} className="banner warn">{w}</div>
        ))}
        {error && <div className="banner error">{error}</div>}

        {(attempt.status === 'no_catalog_match' || attempt.status === 'no_images') && (
          <ListingSearch attempt={attempt} onApplied={(a) => adopt(a)} />
        )}

        {attempt.status !== 'no_catalog_match' && (
          <ImageManager
            attempt={attempt}
            // Auch im no_images-Blocker bedienbar: ein eigenes Foto hebt ihn auf (siehe pipeline/images.ts).
            editable={editable || attempt.status === 'no_images'}
            onChanged={setAttempt}
          />
        )}

        <div className="stack">
          {(attempt.catalogMatches ?? []).length > 1 && editable && (
            <label>
              Katalogtreffer ({attempt.catalogMatches!.length})
              <select
                value={attempt.catalogMatches!.find((m) => m.epid && m.epid === attempt.epid)?.ref ?? attempt.catalogMatches![0].ref}
                onChange={(e) => void patch({ ref: e.target.value })}
              >
                {attempt.catalogMatches!.map((m) => (
                  <option key={m.ref} value={m.ref}>{m.title}</option>
                ))}
              </select>
            </label>
          )}

          <label>
            Titel ({title.length}/80)
            <input
              value={title}
              disabled={!editable}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              maxLength={80}
              placeholder="Titel eingeben (Pflicht)"
            />
          </label>

          <div className="row">
            <label>
              Preis (€)
              <input
                value={price}
                disabled={!editable}
                onChange={(e) => setPrice(e.target.value)}
                onBlur={savePrice}
                inputMode="decimal"
              />
            </label>
            <label>
              Stückzahl
              <input
                value={quantity}
                disabled={!editable}
                onChange={(e) => setQuantity(e.target.value)}
                onBlur={saveQuantity}
                type="number"
                min={1}
                step={1}
              />
            </label>
            <label>
              Zustand
              <select
                value={attempt.condition}
                disabled={!editable}
                onChange={(e) => void patch({ condition: e.target.value as Condition })}
              >
                {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          </div>

          <ShippingSelect
            attempt={attempt}
            editable={editable}
            onChange={(v) => void patch({ fulfillmentPolicyId: v })}
          />

          <IdealoPanel attempt={attempt} />

          <fieldset className="purchase">
            <legend>Einkauf & Gewinn</legend>
            <div className="row">
              <label>
                Gekaufte Einheiten
                <input
                  value={purchasedUnits}
                  onChange={(e) => setPurchasedUnits(e.target.value)}
                  onBlur={saveUnits}
                  type="number"
                  min={1}
                  step={1}
                />
              </label>
              <label>
                Einkaufspreis (€)
                <span className="with-toggle">
                  <input
                    ref={purchasePriceInput}
                    value={purchasePrice}
                    onChange={(e) => {
                      setPurchasePrice(e.target.value);
                      setPurchaseNote('');
                    }}
                    onBlur={() => void savePurchasePrice()}
                    placeholder={placeholderFor(purchasePriceMode, purchasePriceVat)}
                    inputMode="decimal"
                  />
                  <select
                    value={purchasePriceMode}
                    onChange={(e) => switchPurchase(e.target.value as PriceMode, purchasePriceVat)}
                    aria-label="Einkaufspreis pro Stück oder gesamt"
                  >
                    <option value="unit">pro Stück</option>
                    <option value="total">gesamt</option>
                  </select>
                  <select
                    value={purchasePriceVat}
                    onChange={(e) => switchPurchase(purchasePriceMode, e.target.value as VatMode)}
                    aria-label="Einkaufspreis netto oder brutto"
                    title={attempt.vatPercentage ? undefined : 'Brutto braucht einen USt-Satz in den Einstellungen.'}
                  >
                    <option value="net">netto</option>
                    <option value="gross" disabled={!attempt.vatPercentage}>brutto</option>
                  </select>
                </span>
              </label>
              <label>
                Einkaufsquelle
                <input
                  value={purchaseSource}
                  onChange={(e) => setPurchaseSource(e.target.value)}
                  onBlur={() => purchaseSource !== (attempt.purchaseSource ?? '') && void patch({ purchaseSource })}
                  placeholder="Händler oder Link"
                />
              </label>
            </div>
            <p className="muted">
              Gespeichert wird der Einkaufspreis je Stück, netto — für „gesamt" oder „brutto" erst
              umschalten, dann den Betrag eingeben; umgerechnet wird beim Verlassen des Feldes.
            </p>
            {purchaseNote && <p className="muted">{purchaseNote}</p>}

            {attempt.purchasePrice !== undefined && attempt.purchasePriceBasis === undefined && (
              <div className="banner warn">
                Dieser Einkaufspreis stammt aus der Zeit vor der Netto-Umstellung und ist unbestätigt —
                damals zählte der gezahlte Betrag, also eher brutto. Bis zur Entscheidung rechnet der
                Gewinn mit {formatPrice(attempt.purchasePrice)} als netto.
                <span className="legacy-bulk">
                  <button onClick={() => void settleBasis('confirm')}>Ist netto</button>
                  <button
                    disabled={!attempt.vatPercentage}
                    title={attempt.vatPercentage ? undefined : 'Zum Umrechnen fehlt ein USt-Satz in den Einstellungen.'}
                    onClick={() => void settleBasis('convert')}
                  >
                    War brutto → umrechnen{attempt.vatPercentage ? ` (${formatPercent(attempt.vatPercentage)} USt)` : ''}
                  </button>
                </span>
              </div>
            )}

            {attempt.targetPrice !== undefined && attempt.targetPrice !== attempt.price && (
              <p className="muted">
                Angedacht waren {formatPrice(attempt.targetPrice)} — gelistet ist {formatPrice(attempt.price)}.
              </p>
            )}

            {attempt.profit ? (
              <>
                <ProfitTable profit={attempt.profit} feePercent={attempt.feePercent} />
                <p className="muted">Geschätzt: die tatsächliche Provision steht erst nach dem Verkauf fest.</p>
              </>
            ) : (
              <dl className="figures">
                <div><dt>Verkaufspreis</dt><dd>{formatPrice(attempt.price)}</dd></div>
                {attempt.fee !== undefined && (
                  <div>
                    <dt>Verkaufsprovision (geschätzt)</dt>
                    <dd>{formatPrice(attempt.fee)}{attempt.feePercent !== undefined ? ` · ${formatPercent(attempt.feePercent)}` : ''}</dd>
                  </div>
                )}
                <div><dt>Gewinn</dt><dd className="muted">Einkaufspreis fehlt</dd></div>
              </dl>
            )}

            {attempt.source?.url && (
              <p className="muted">
                Quelle: <a href={attempt.source.url} target="_blank" rel="noreferrer">{attempt.source.merchant} ↗</a>
              </p>
            )}

            {attempt.feeMatched === false && attempt.categoryId && (
              <div className="banner warn">
                Kategorie {attempt.categoryId} — kein Gebührensatz hinterlegt, es gilt der Standardsatz
                {attempt.feePercent !== undefined ? ` von ${formatPercent(attempt.feePercent)}` : ''}.
                <span className="with-toggle" style={{ marginTop: 8 }}>
                  <input
                    value={rateInput}
                    onChange={(e) => setRateInput(e.target.value)}
                    placeholder="Satz in % für diese Kategorie"
                    inputMode="decimal"
                  />
                  <button onClick={saveRate} disabled={rateInput.trim() === ''}>Satz merken</button>
                </span>
              </div>
            )}
          </fieldset>

          <section className={'gpsr-box ' + (gpsr ? 'ok' : 'missing')}>
            <h3>GPSR — Produktsicherheit</h3>
            {gpsr ? (
              <div className="row">
                <div>
                  <strong>Hersteller</strong>
                  <ContactBlock c={gpsr.manufacturer} />
                </div>
                {gpsr.responsiblePersons.length > 0 && (
                  <div>
                    <strong>EU-verantwortliche Person</strong>
                    {gpsr.responsiblePersons.map((p, i) => <ContactBlock key={i} c={p} />)}
                  </div>
                )}
              </div>
            ) : (
              <p className="muted">Keine GPSR-Daten gefunden — Veröffentlichung wird versucht, eBay kann sie aber ablehnen.</p>
            )}
          </section>

          {Object.keys(attempt.aspects ?? {}).length > 0 && (
            <details>
              <summary>Artikelmerkmale ({Object.keys(attempt.aspects!).length})</summary>
              <table className="aspects">
                <tbody>
                  {Object.entries(attempt.aspects!).map(([k, v]) => (
                    <tr key={k}><th>{k}</th><td>{v.join(', ')}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          <DescriptionEditor
            attempt={attempt}
            editable={editable}
            onSave={(html) => patch({ description: html })}
            onReset={() => patch({ resetDescription: true })}
          />

          <div className="meta muted">
            {attempt.ean ? <>EAN {attempt.ean}</> : 'ohne EAN'}
            {attempt.epid ? <> · ePID {attempt.epid}</> : null}
            {attempt.categoryId ? <> · Kategorie {attempt.categoryId}</> : null}
            {attempt.sku ? <> · SKU {attempt.sku}</> : null}
          </div>

          {editable && (
            <button className="primary big" onClick={publish} disabled={busy || title.trim() === ''}>
              {busy
                ? 'Wird bei eBay erstellt …'
                : title.trim() === ''
                  ? 'Titel eingeben, um das Listing zu erstellen'
                  : `${attempt.status === 'publish_failed' ? 'Erneut erstellen' : 'Listing erstellen'} — ${formatPrice(attempt.price)}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ContactBlock({ c }: { c: CompanyContact }) {
  return (
    <address>
      {c.companyName && <div>{c.companyName}</div>}
      {c.addressLine1 && <div>{c.addressLine1}</div>}
      {c.addressLine2 && <div>{c.addressLine2}</div>}
      {(c.postalCode || c.city) && <div>{[c.postalCode, c.city].filter(Boolean).join(' ')}</div>}
      {c.country && <div>{c.country}</div>}
      {c.email && <div>{c.email}</div>}
      {c.phone && <div>{c.phone}</div>}
      {c.contactUrl && <div>{c.contactUrl}</div>}
    </address>
  );
}
