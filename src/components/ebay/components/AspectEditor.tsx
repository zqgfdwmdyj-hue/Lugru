import { useEffect, useMemo, useState } from 'react';
import { GTIN_ASPECT, isValidGtin, type CategoryAspect } from '@/lib/ebay/pipeline/aspects';
import { api, type Attempt } from '../api';

interface AspectInfo {
  aspects: CategoryAspect[];
  error?: string;
  missing: string[];
  fromError: string[];
  problems: string[];
}

/** Bis zu so vielen erlaubten Werten ist eine Auswahlliste bequemer als ein Textfeld. */
const SELECT_MAX = 80;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const join = (v?: string[]) => (v ?? []).join('; ');
const split = (raw: string, multi: boolean) =>
  (multi ? raw.split(/[;,]/) : [raw]).map((s) => s.trim()).filter((s) => s !== '');

/**
 * Artikelmerkmale und EAN in der Vorschau bearbeiten. Pflicht- und empfohlene
 * Merkmale kommen live aus eBays Kategorie; was eBay beim letzten Versuch als
 * fehlend gemeldet hat, steht mit oben. Gespeichert wird beim Verlassen eines Feldes.
 */
export function AspectEditor({ attempt, editable, onPatch, onMissing }: {
  attempt: Attempt;
  editable: boolean;
  onPatch: (body: Record<string, unknown>) => Promise<Attempt | null>;
  onMissing?: (names: string[]) => void;
}) {
  const [info, setInfo] = useState<AspectInfo | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [ean, setEan] = useState(attempt.ean ?? '');
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const current = attempt.aspects ?? {};

  async function load() {
    try {
      const r = await api<AspectInfo>(`/attempts/${attempt.id}/aspects`);
      setInfo(r);
      onMissing?.(r.missing);
    } catch (err) {
      setInfo({ aspects: [], error: err instanceof Error ? err.message : String(err), missing: [], fromError: [], problems: [] });
    }
  }

  // Neu laden, wenn sich Kategorie, Merkmale, EAN oder eBays Fehlermeldung ändern.
  const signature = JSON.stringify([attempt.categoryId, attempt.aspects, attempt.ean, attempt.errorMessage]);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  useEffect(() => setEan(attempt.ean ?? ''), [attempt.ean]);

  const defs = useMemo(() => (info?.aspects ?? []).filter((d) => !GTIN_ASPECT.test(d.name)), [info]);
  const missing = new Set((info?.missing ?? []).map((n) => n.toLowerCase()));

  const required: CategoryAspect[] = [
    ...defs.filter((d) => d.required),
    // Von eBay als fehlend gemeldet, aber nicht in der Kategorie-Liste (oder Liste nicht abrufbar).
    ...(info?.fromError ?? [])
      .filter((n) => !defs.some((d) => same(d.name, n)) && !GTIN_ASPECT.test(n))
      .map((name) => ({ name, required: true, recommended: false, selectionOnly: false, multi: false, values: [] })),
  ];
  const recommended = defs.filter((d) => !d.required && d.recommended);
  const listed = [...required, ...recommended];
  const others = Object.keys(current).filter((k) => !listed.some((d) => same(d.name, k)) && !GTIN_ASPECT.test(k));
  const valueOf = (name: string) => Object.entries(current).find(([k]) => same(k, name))?.[1];
  const draftOf = (name: string) => drafts[name] ?? join(valueOf(name));
  const filledRecommended = recommended.filter((d) => valueOf(d.name)?.length).length;

  async function save(name: string, values: string[]) {
    const def = defs.find((d) => same(d.name, name));
    if (def?.selectionOnly && def.values.length > 0) {
      const bad = values.filter((v) => !def.values.some((x) => same(x, v)));
      if (bad.length) {
        setFieldError((e) => ({ ...e, [name]: `„${bad.join('", "')}" steht nicht in der eBay-Liste — bitte einen Vorschlag wählen.` }));
        return;
      }
    }
    setFieldError((e) => ({ ...e, [name]: '' }));
    const key = Object.keys(current).find((k) => same(k, name)) ?? name;
    const next: Record<string, string[]> = { ...current };
    if (values.length) next[key] = values;
    else delete next[key];
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    const saved = await onPatch({ aspects: next });
    if (saved) setDrafts((d) => { const c = { ...d }; delete c[name]; return c; });
  }

  async function saveEan() {
    const v = ean.replace(/[\s-]/g, '');
    if (v === (attempt.ean ?? '')) return setFieldError((e) => ({ ...e, ean: '' }));
    if (v !== '' && !isValidGtin(v)) {
      setFieldError((e) => ({ ...e, ean: /^\d+$/.test(v) ? 'Ungültig — Länge (8, 12, 13 oder 14 Ziffern) oder Prüfziffer stimmt nicht.' : 'Bitte nur Ziffern.' }));
      return;
    }
    setFieldError((e) => ({ ...e, ean: '' }));
    await onPatch({ ean: v });
  }

  async function addCustom() {
    const name = newName.trim();
    const values = split(newValue, true);
    if (!name || !values.length) return;
    await save(name, [...(valueOf(name) ?? []), ...values]);
    setNewName('');
    setNewValue('');
  }

  function field(d: CategoryAspect, removable = false) {
    const isMissing = missing.has(d.name.toLowerCase());
    const listId = `asp-${attempt.id}-${d.name.replace(/\W+/g, '_')}`;
    const useSelect = d.selectionOnly && !d.multi && d.values.length > 0 && d.values.length <= SELECT_MAX;
    return (
      <label key={d.name} className={'aspect-field' + (isMissing ? ' missing' : '')} data-aspect={d.name}>
        <span className="aspect-name">
          {d.name}{d.required ? ' *' : ''}
          {removable && editable && (
            <button type="button" className="aspect-remove" aria-label={`${d.name} entfernen`} onClick={() => void save(d.name, [])}>×</button>
          )}
        </span>
        {useSelect ? (
          <select value={valueOf(d.name)?.[0] ?? ''} disabled={!editable} onChange={(e) => void save(d.name, e.target.value ? [e.target.value] : [])}>
            <option value="">– bitte wählen –</option>
            {d.values.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        ) : (
          <>
            <input
              value={draftOf(d.name)}
              disabled={!editable}
              list={d.values.length ? listId : undefined}
              maxLength={d.multi ? undefined : d.maxLength ?? 65}
              placeholder={d.multi ? 'Werte mit ; trennen' : d.values.length ? 'eintippen oder Vorschlag wählen' : ''}
              onChange={(e) => setDrafts((x) => ({ ...x, [d.name]: e.target.value }))}
              onBlur={() => drafts[d.name] !== undefined && void save(d.name, split(drafts[d.name], d.multi))}
            />
            {d.values.length > 0 && (
              <datalist id={listId}>
                {d.values.map((v) => <option key={v} value={v} />)}
              </datalist>
            )}
          </>
        )}
        {fieldError[d.name] && <span className="aspect-error">{fieldError[d.name]}</span>}
      </label>
    );
  }

  return (
    <section className="aspect-box" data-testid="aspect-editor">
      <h3>Artikelmerkmale</h3>
      {info === null && <p className="muted">Merkmale der Kategorie werden geladen …</p>}
      {info?.error && <p className="muted">{info.error}</p>}
      {info && info.missing.length > 0 && (
        <div className="banner error" data-testid="aspects-missing">
          Pflichtangaben fehlen: <strong>{info.missing.join(', ')}</strong> — unten ausfüllen, dann erneut erstellen.
        </div>
      )}
      {info && info.problems.length > 0 && <div className="banner warn">{info.problems.join(' ')}</div>}

      <div className="aspect-grid">
        <label className={'aspect-field' + (fieldError.ean ? ' missing' : '')}>
          <span className="aspect-name">EAN / GTIN</span>
          <input
            value={ean}
            disabled={!editable}
            inputMode="numeric"
            placeholder="13 Ziffern, z. B. von der Verpackung"
            onChange={(e) => setEan(e.target.value)}
            onBlur={() => void saveEan()}
            aria-label="EAN"
          />
          {fieldError.ean && <span className="aspect-error">{fieldError.ean}</span>}
          {!attempt.ean && <span className="muted">Ohne EAN lehnt eBay viele Kategorien ab und das Angebot ist schlechter auffindbar.</span>}
        </label>
        {required.map((d) => field(d))}
      </div>

      {recommended.length > 0 && (
        <details open={required.length === 0}>
          <summary>Empfohlen von eBay ({filledRecommended}/{recommended.length} ausgefüllt) — bessere Auffindbarkeit</summary>
          <div className="aspect-grid">{recommended.map((d) => field(d))}</div>
        </details>
      )}

      {(others.length > 0 || editable) && (
        <details open={others.length > 0 && others.length <= 8}>
          <summary>Weitere Merkmale ({others.length})</summary>
          <div className="aspect-grid">
            {others.map((name) => field({ name, required: false, recommended: false, selectionOnly: false, multi: (current[name] ?? []).length > 1, values: [] }, true))}
          </div>
          {editable && (
            <div className="aspect-add">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Merkmal, z. B. Farbe" aria-label="Neues Merkmal" />
              <input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="Wert, z. B. Weiß" aria-label="Wert des neuen Merkmals" onKeyDown={(e) => e.key === 'Enter' && void addCustom()} />
              <button type="button" onClick={() => void addCustom()} disabled={!newName.trim() || !newValue.trim()}>Hinzufügen</button>
            </div>
          )}
        </details>
      )}
    </section>
  );
}
