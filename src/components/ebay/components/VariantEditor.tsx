import { useState, type FormEvent } from 'react';
import { api, formatPercent, formatPrice, looksLikeEan, parseAmount, type Attempt, type SearchResult } from '../api';
import { groupIdOfRef, suggestVariantValue, VARIATION_NAMES, type ImportedVariants } from '@/lib/ebay/pipeline/variants';

/** Eine Zeile im Editor – Eingaben als Text, gespeichert wird erst mit „Varianten speichern“. */
type Row = { key: string; sku?: string; value: string; ean: string; price: string; quantity: string; purchasePrice: string; imageUrl: string; set: boolean };

const asText = (n: number | undefined) => (n === undefined ? '' : String(n).replace('.', ','));
let seq = 0;
const newKey = () => `n${++seq}`;

function rowsOf(a: Attempt): Row[] {
  return (a.variants?.items ?? []).map((i) => ({
    key: i.sku,
    sku: i.sku,
    value: i.value,
    ean: i.ean ?? '',
    price: asText(i.price),
    quantity: String(i.quantity),
    purchasePrice: asText(i.purchasePrice),
    imageUrl: i.imageUrl ?? '',
    set: Boolean(i.set),
  }));
}

/** Komplettset: so oft, wie es sich aus den Einzelvarianten bilden lässt (je 1×). */
function setQty(rows: Row[]): number {
  const singles = rows.filter((r) => !r.set);
  return singles.length ? Math.min(...singles.map((r) => Math.max(0, Math.floor(Number(r.quantity) || 0)))) : 0;
}

/** EK-Vorschlag für ein Set: Summe der Einzelvarianten, wenn alle einen haben. */
function setEk(rows: Row[]): number | undefined {
  const eks = rows.filter((r) => !r.set).map((r) => parseAmount(r.purchasePrice));
  return eks.length && eks.every((e) => e !== undefined) ? Math.round(eks.reduce((s, e) => s + e!, 0) * 100) / 100 : undefined;
}

/**
 * Angebot mit Varianten (Mehrfachangebot): ein eBay-Angebot, mehrere Sorten/Größen/Farben –
 * jede mit eigenem Preis, eigener Menge, eigener EAN, eigenem Bild und eigenem Einkaufspreis.
 * Weitere Varianten lassen sich per EAN oder Titel suchen (Bild und Wert werden vorgeschlagen).
 */
export function VariantEditor({ attempt, editable, onSaved, onDirty }: {
  attempt: Attempt;
  editable: boolean;
  onSaved: (a: Attempt) => void;
  /** Ungespeicherte Änderungen – solange wird nicht veröffentlicht. */
  onDirty: (dirty: boolean) => void;
}) {
  const active = Boolean(attempt.variants);
  const [name, setName] = useState(attempt.variants?.name ?? 'Sorte');
  const [rows, setRows] = useState<Row[]>(() => rowsOf(attempt));
  const [dirty, setDirtyState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<SearchResult[] | null>(null);
  const [picker, setPicker] = useState<string | null>(null);
  const [pickUrl, setPickUrl] = useState('');
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');
  /** Der gewählte Treffer ist selbst ein Angebot mit Varianten – dann gleich anbieten, sie zu übernehmen. */
  const sourceGroup = groupIdOfRef(attempt.catalogMatches?.[attempt.catalogMatches.length - 1]?.ref);

  const setDirty = (d: boolean) => {
    setDirtyState(d);
    onDirty(d);
  };
  const change = (key: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  /** Startet das Mehrfachangebot: das bisherige Produkt wird die erste Variante. */
  function start() {
    const first: Row = {
      key: newKey(),
      value: '',
      ean: attempt.ean ?? '',
      price: asText(attempt.price),
      quantity: String(attempt.quantity),
      purchasePrice: asText(attempt.purchasePrice),
      imageUrl: attempt.imageUrls?.[0] ?? '',
      set: false,
    };
    setRows([first, { key: newKey(), value: '', ean: '', price: asText(attempt.price), quantity: '1', purchasePrice: '', imageUrl: '', set: false }]);
    setDirty(true);
  }

  function addRow(r: Partial<Row> = {}) {
    const last = rows[rows.length - 1];
    setRows((rs) => [...rs, { key: newKey(), value: '', ean: '', price: last?.price ?? asText(attempt.price), quantity: '1', purchasePrice: '', imageUrl: '', set: false, ...r }]);
    setDirty(true);
  }

  async function save() {
    setError('');
    const items = [];
    for (const r of rows) {
      const price = parseAmount(r.price);
      const ek = r.purchasePrice.trim() === '' ? null : parseAmount(r.purchasePrice);
      const label = r.value.trim() || `Variante ${rows.indexOf(r) + 1}`;
      if (price === undefined) return setError(`${label}: Preis „${r.price.trim()}" ist keine gültige Zahl.`);
      if (ek === undefined) return setError(`${label}: Einkaufspreis „${r.purchasePrice.trim()}" ist keine gültige Zahl.`);
      items.push({ sku: r.sku, value: r.value, ean: r.ean, price, quantity: r.set ? 0 : r.quantity.trim() === '' ? 0 : Number(r.quantity), purchasePrice: ek, imageUrl: r.imageUrl, set: r.set });
    }
    setBusy(true);
    try {
      const a = await api<Attempt>(`/attempts/${attempt.id}`, { method: 'PATCH', body: JSON.stringify({ variants: { name, items } }) });
      setRows(rowsOf(a));
      setName(a.variants?.name ?? name);
      setDirty(false);
      onSaved(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Varianten entfernen und wieder ein einfaches Angebot daraus machen?')) return;
    setBusy(true);
    setError('');
    try {
      const a = await api<Attempt>(`/attempts/${attempt.id}`, { method: 'PATCH', body: JSON.stringify({ variants: null }) });
      setRows([]);
      setDirty(false);
      onSaved(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Varianten aus einem bestehenden eBay-Angebot übernehmen (Sortennamen, Bilder, EAN, Preis als
   * Vorschlag). Ohne Link: aus dem gewählten Treffer. Vorhandene Werte bleiben, Neues kommt dazu.
   */
  async function importFrom(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    setNote('');
    try {
      const got = await api<ImportedVariants>(`/attempts/${attempt.id}/ebay-variants?q=${encodeURIComponent(link.trim())}`);
      const have = new Set(rows.map((r) => r.value.trim().toLowerCase()));
      const fresh = got.items
        .filter((i) => !have.has(i.value.toLowerCase()))
        .map((i): Row => ({
          key: newKey(),
          value: i.value,
          ean: i.ean ?? '',
          price: asText(i.price ?? attempt.price),
          quantity: '',
          purchasePrice: '',
          imageUrl: i.imageUrl ?? '',
          // „Komplettset (6 Shaker)“ → gleich als Set aus den Einzelsorten.
          set: /komplett/i.test(i.value),
        }));
      if (rows.length === 0) setName(got.name);
      setRows((rs) => [...rs, ...fresh]);
      setDirty(true);
      setLink('');
      setNote(`${fresh.length} Varianten übernommen (Merkmal „${got.name}“). Eigene Preise und Mengen eintragen – Bilder nur verwenden, wenn du darfst.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function search(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setBusy(true);
    setError('');
    try {
      setFound((await api<SearchResult[]>(`/search?q=${encodeURIComponent(q)}`)).slice(0, 6));
    } catch (err) {
      setFound(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function take(r: SearchResult) {
    addRow({ value: suggestVariantValue(attempt.title, r.title), ean: looksLikeEan(query) ? query.replace(/\s/g, '') : '', imageUrl: r.imageUrl ?? '' });
    setFound(null);
    setQuery('');
  }

  const importForm = (
    <form className="with-toggle variant-search" onSubmit={importFrom}>
      <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link eines eBay-Angebots mit Varianten" aria-label="Varianten aus eBay-Angebot übernehmen" />
      <button disabled={busy || link.trim().length < 5}>Varianten übernehmen</button>
    </form>
  );

  if (!active && rows.length === 0) {
    if (!editable) return null;
    return (
      <div className="variant-start">
        <button type="button" onClick={start} data-testid="variants-start">+ Varianten anlegen (z. B. Sorten, Größen)</button>
        <span className="muted">Ein Angebot, mehrere Sorten – jede mit eigenem Preis, eigener Menge, EAN und Bild.</span>
        {sourceGroup && (
          <button type="button" disabled={busy} onClick={() => void importFrom()} data-testid="variants-from-source">
            Varianten des gewählten eBay-Angebots übernehmen
          </button>
        )}
        {importForm}
        {error && <div className="banner error">{error}</div>}
      </div>
    );
  }

  const figures = new Map((attempt.variantFigures ?? []).map((f) => [f.sku, f]));
  const images = attempt.imageUrls ?? [];

  return (
    <fieldset className="purchase variants" data-testid="variants">
      <legend>Varianten (Mehrfachangebot)</legend>
      <label className="variant-name">
        Variantenmerkmal
        <input value={name} disabled={!editable} list="variation-names" onChange={(e) => { setName(e.target.value); setDirty(true); }} placeholder="z. B. Sorte" />
        <datalist id="variation-names">{VARIATION_NAMES.map((n) => <option key={n} value={n} />)}</datalist>
      </label>

      <div className="variant-head muted">
        <span>Bild</span><span>{name || 'Wert'}</span><span>EAN</span><span>Preis €</span><span>Menge</span><span>EK netto €</span><span />
      </div>
      {rows.map((r, n) => {
        const f = r.sku ? figures.get(r.sku) : undefined;
        return (
          <div key={r.key} className="variant-row" data-testid="variant-row">
            <button type="button" className="variant-img" disabled={!editable} title="Bild der Variante wählen" onClick={() => { setPicker(picker === r.key ? null : r.key); setPickUrl(''); }}>
              {r.imageUrl ? <img src={r.imageUrl} alt="" /> : <span>Bild</span>}
            </button>
            <label className="vf"><span className="vf-cap">{name || 'Wert'}</span><input aria-label={`Wert Variante ${n + 1}`} value={r.value} disabled={!editable} onChange={(e) => change(r.key, { value: e.target.value })} placeholder="z. B. Kirsche" maxLength={65} /></label>
            <label className="vf"><span className="vf-cap">EAN</span><input aria-label={`EAN Variante ${n + 1}`} value={r.ean} disabled={!editable} onChange={(e) => change(r.key, { ean: e.target.value })} inputMode="numeric" placeholder="optional" /></label>
            <label className="vf"><span className="vf-cap">Preis €</span><input aria-label={`Preis Variante ${n + 1}`} value={r.price} disabled={!editable} onChange={(e) => change(r.key, { price: e.target.value })} inputMode="decimal" /></label>
            <label className="vf"><span className="vf-cap">Menge</span><input aria-label={`Menge Variante ${n + 1}`} value={r.set ? String(setQty(rows)) : r.quantity} disabled={!editable || r.set} title={r.set ? 'Ergibt sich aus den Einzelsorten' : undefined} onChange={(e) => change(r.key, { quantity: e.target.value })} type="number" min={0} step={1} placeholder="Menge" /></label>
            <label className="vf"><span className="vf-cap">EK netto €</span><input aria-label={`EK Variante ${n + 1}`} value={r.purchasePrice} disabled={!editable} onChange={(e) => change(r.key, { purchasePrice: e.target.value })} inputMode="decimal" placeholder={r.set && setEk(rows) !== undefined ? `Summe ${asText(setEk(rows))}` : 'optional'} /></label>
            {editable ? (
              <button type="button" className="variant-remove" title="Variante entfernen" aria-label="Variante entfernen" onClick={() => { setRows((rs) => rs.filter((x) => x.key !== r.key)); setDirty(true); }}>×</button>
            ) : <span />}
            {(editable || r.set) && (
              <label className="variant-set" title="Set aus je einem Stück jeder anderen Sorte – ein Verkauf bucht die Einzelsorten ab">
                <input type="checkbox" checked={r.set} disabled={!editable} onChange={(e) => change(r.key, { set: e.target.checked })} />
                {r.set ? 'Komplettset – je 1× jede andere Sorte, Menge ergibt sich daraus' : 'Komplettset'}
              </label>
            )}
            {f && !dirty && (
              <div className="variant-profit muted" data-testid="variant-profit">
                {f.profit
                  ? <>Gewinn {formatPrice(f.profit.profit)} ({formatPercent(f.profit.profitPercent)})</>
                  : 'Gewinn: EK fehlt'}
                {' · '}Provision {formatPrice(f.fee)}
              </div>
            )}
            {picker === r.key && (
              <div className="variant-picker">
                <div className="gallery">
                  {images.map((u) => (
                    <button type="button" key={u} className={'thumb' + (u === r.imageUrl ? ' chosen' : '')} onClick={() => { change(r.key, { imageUrl: u }); setPicker(null); }}>
                      <img src={u} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
                <div className="image-url-row">
                  <input value={pickUrl} onChange={(e) => setPickUrl(e.target.value)} placeholder="oder Bild-URL einfügen (mit Nutzungsrechten)" />
                  <button type="button" disabled={pickUrl.trim() === ''} onClick={() => { change(r.key, { imageUrl: pickUrl.trim() }); setPicker(null); }}>Übernehmen</button>
                  {r.imageUrl && <button type="button" onClick={() => { change(r.key, { imageUrl: '' }); setPicker(null); }}>Kein eigenes Bild</button>}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {editable && (
        <>
          <div className="variant-actions">
            <button type="button" onClick={() => addRow()}>+ Variante</button>
            <form className="with-toggle variant-search" onSubmit={search}>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Variante per EAN oder Titel suchen" aria-label="Variante per EAN oder Titel suchen" />
              <button disabled={busy || query.trim().length < 2}>Suchen</button>
            </form>
          </div>
          <div className="variant-actions">
            {sourceGroup && <button type="button" disabled={busy} onClick={() => void importFrom()}>Varianten des gewählten Angebots übernehmen</button>}
            {importForm}
          </div>
          {note && <p className="muted" data-testid="variants-note">{note}</p>}
          {found && (
            <div className="variant-found">
              {found.length === 0 && <span className="muted">Nichts gefunden.</span>}
              {found.map((r) => (
                <button type="button" key={r.ref} className="variant-hit" onClick={() => take(r)} title="Als Variante übernehmen">
                  {r.imageUrl ? <img src={r.imageUrl} alt="" /> : <span className="noimg">Kein Bild</span>}
                  <span>{r.title}</span>
                </button>
              ))}
            </div>
          )}
          {error && <div className="banner error">{error}</div>}
          <div className="variant-actions">
            <button type="button" className="primary" disabled={busy || !dirty} onClick={() => void save()} data-testid="variants-save">
              {busy ? 'Speichert …' : dirty ? 'Varianten speichern' : 'Gespeichert'}
            </button>
            {active && <button type="button" className="linklike" onClick={() => void remove()}>Varianten entfernen</button>}
            {!active && <button type="button" className="linklike" onClick={() => { setRows([]); setDirty(false); }}>Abbrechen</button>}
          </div>
          <p className="muted">
            Titel, Bilder, Merkmale und Beschreibung gelten für alle Varianten. Jede Variante bekommt bei eBay
            eine eigene SKU; in der Wawi wird jede Sorte ein eigenes Angebot mit eigenem Bestand.
          </p>
        </>
      )}
    </fieldset>
  );
}
