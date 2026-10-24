"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { cleanImages, descriptionFromParts, MAX_IMAGES, sanitizeDescription, type AmazonContent } from "@/lib/ebay-review/content";
import { amazonContentAction, applyContentAction, uploadImagesAction, type ActionState } from "./actions";

type AspectDef = { name: string; required: boolean; recommended: boolean; values: string[]; multi: boolean };
type Row = { id: number; name: string; value: string };

const join = (vs: string[]) => vs.join("; ");
const split = (s: string) => s.split(/\s*;\s*/).map((x) => x.trim()).filter(Boolean);
const rowsToAspects = (rows: Row[]) => {
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    const name = r.name.trim();
    const values = split(r.value);
    if (name && values.length) out[name] = [...new Set([...(out[name] ?? []), ...values])];
  }
  return out;
};
const sameAspects = (a: Record<string, string[]>, b: Record<string, string[]>) => {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => b[k] && join(a[k]) === join(b[k]));
};

/**
 * Bilder, Beschreibung und Merkmale eines laufenden eBay-Angebots bearbeiten: Bilder ordnen, entfernen, per
 * Link oder Datei hinzufügen oder von Amazon (Keepa) übernehmen; Beschreibung als HTML mit Vorschau; alle
 * Merkmale. Gesendet wird nur, was geändert wurde – erst nach Nachfrage.
 */
export function ContentEditor({
  itemId,
  images: initialImages,
  descriptionHtml,
  aspects: initialAspects,
  defs,
  ean,
  title,
  recentApplied = null,
  disabled = false,
}: {
  itemId: string;
  images: string[];
  /** null = Beschreibung noch nicht geladen (ältere Prüfung) → erst „Neu prüfen“. */
  descriptionHtml: string | null;
  aspects: Record<string, string[]>;
  defs: AspectDef[];
  ean: string | null;
  title: string;
  /** Zuletzt gesendete Änderungen (die Seite lädt danach neu). */
  recentApplied?: string | null;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState>(null);

  // ---- Bilder
  const [images, setImages] = useState<string[]>(initialImages);
  const [newUrl, setNewUrl] = useState("");
  const [imgMsg, setImgMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imagesChanged = JSON.stringify(images) !== JSON.stringify(initialImages);
  const move = (i: number, d: number) =>
    setImages((l) => {
      const j = i + d;
      if (j < 0 || j >= l.length) return l;
      const n = [...l];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const toFront = (i: number) => setImages((l) => [l[i], ...l.filter((_, k) => k !== i)]);
  const remove = (i: number) => setImages((l) => l.filter((_, k) => k !== i));
  // Aktueller Stand auch nach dem Hochladen (das Ergebnis kommt später als der Klick).
  const imagesRef = useRef(images);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  const addImages = (urls: string[], front = false) => {
    const cur = imagesRef.current;
    const { images: next, dropped } = cleanImages(front ? [...urls, ...cur] : [...cur, ...urls]);
    setImages(next);
    imagesRef.current = next;
    const added = next.filter((u) => !cur.includes(u)).length;
    const bad = dropped.filter((u) => !/^https:\/\//i.test(u));
    setImgMsg(
      bad.length
        ? { ok: false, text: `Nicht übernommen: ${bad.slice(0, 2).join(", ")} – nur https-Adressen.` }
        : next.length >= MAX_IMAGES && added < urls.length
          ? { ok: false, text: `eBay erlaubt höchstens ${MAX_IMAGES} Bilder – ${added} hinzugefügt.` }
          : { ok: true, text: added ? `${added} Bild${added === 1 ? "" : "er"} hinzugefügt – noch nicht bei eBay.` : "Schon in der Liste." },
    );
  };
  const upload = () => {
    const files = fileRef.current?.files;
    if (!files?.length) return;
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append("files", f);
    start(async () => {
      const r = await uploadImagesAction(fd);
      if (!r.ok) return setImgMsg({ ok: false, text: r.message });
      addImages(r.urls);
      if (r.errors.length) setImgMsg({ ok: false, text: `Hochgeladen: ${r.urls.length}. Fehler: ${r.errors.join(" · ")}` });
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  // ---- Beschreibung
  const [desc, setDesc] = useState(descriptionHtml ?? "");
  const [preview, setPreview] = useState(false);
  const descChanged = descriptionHtml !== null && desc.trim() !== descriptionHtml.trim();
  const previewDoc = useMemo(
    () => (preview ? `<!doctype html><meta charset="utf-8"><base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;margin:12px;color:#222;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style>${sanitizeDescription(desc)}` : ""),
    [preview, desc],
  );

  // ---- Merkmale
  const nextId = useRef(0);
  const mkRow = (name: string, value: string): Row => ({ id: nextId.current++, name, value });
  const [rows, setRows] = useState<Row[]>(() => {
    const own = Object.entries(initialAspects).map(([k, v]) => mkRow(k, join(v)));
    const have = new Set(Object.keys(initialAspects).map((k) => k.toLowerCase()));
    const open = defs.filter((d) => (d.required || d.recommended) && !have.has(d.name.toLowerCase())).map((d) => mkRow(d.name, ""));
    return [...own, ...open];
  });
  const aspects = rowsToAspects(rows);
  const aspectsChanged = !sameAspects(aspects, initialAspects);
  const defOf = (name: string) => defs.find((d) => d.name.toLowerCase() === name.trim().toLowerCase());
  const setRow = (id: number, patch: Partial<Row>) => setRows((l) => l.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const missingRequired = defs.filter((d) => d.required && !Object.keys(aspects).some((k) => k.toLowerCase() === d.name.toLowerCase()));

  // ---- Amazon (Keepa)
  const [code, setCode] = useState("");
  const [amz, setAmz] = useState<AmazonContent | null>(null);
  const [amzMsg, setAmzMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [pickAsp, setPickAsp] = useState<Set<string>>(new Set());
  const fetchAmazon = () =>
    start(async () => {
      setAmzMsg(null);
      const r = await amazonContentAction(itemId, code);
      if (!r.ok) {
        setAmz(null);
        return setAmzMsg({ ok: false, text: r.message });
      }
      setAmz(r.content);
      setPick(new Set(r.content.images.filter((u) => !images.includes(u))));
      setPickAsp(new Set(Object.keys(r.content.aspects).filter((k) => !Object.keys(aspects).some((x) => x.toLowerCase() === k.toLowerCase()))));
      setAmzMsg({ ok: true, text: `Gefunden: ${r.content.images.length} Bilder, ${r.content.bullets.length} Stichpunkte${r.tokensLeft !== null ? ` · Keepa-Tokens übrig: ${r.tokensLeft}` : ""}` });
    });
  const takeAspects = () => {
    if (!amz) return;
    setRows((l) => {
      let next = [...l];
      for (const k of pickAsp) {
        const v = amz.aspects[k];
        const i = next.findIndex((r) => r.name.trim().toLowerCase() === k.toLowerCase());
        if (i >= 0) next[i] = { ...next[i], value: v };
        else next = [...next, mkRow(k, v)];
      }
      return next;
    });
  };
  const bulletsHtml = amz ? descriptionFromParts({ bullets: amz.bullets }) : "";

  const dirty = imagesChanged || descChanged || aspectsChanged;
  const changeList = [imagesChanged && `Bilder (${initialImages.length} → ${images.length})`, descChanged && "Beschreibung", aspectsChanged && `Merkmale (${Object.keys(aspects).length})`].filter(Boolean) as string[];
  const send = () => {
    if (!dirty) return;
    if (imagesChanged && !images.length) return setResult({ ok: false, message: "Mindestens ein Bild muss bleiben." });
    if (!window.confirm(`Jetzt bei eBay ändern: ${changeList.join(", ")}? Das Angebot wird sofort geändert.`)) return;
    start(async () => {
      const r = await applyContentAction({
        itemId,
        ...(imagesChanged ? { images } : {}),
        ...(descChanged ? { description: desc } : {}),
        ...(aspectsChanged ? { aspects } : {}),
      });
      setResult(r);
    });
  };

  return (
    <div className="stack" style={{ gap: 18 }} data-testid="content-editor">
      {/* Amazon / Keepa */}
      <details className="ce-box" data-testid="amazon-box">
        <summary>
          <strong>Von Amazon übernehmen</strong> <span className="small muted">– Bilder, Stichpunkte und Merkmale über Keepa (1 Token)</span>
        </summary>
        <div className="stack" style={{ gap: 10, marginTop: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input className="input" style={{ flex: "1 1 200px", minWidth: 0 }} value={code} onChange={(e) => setCode(e.target.value)} placeholder={ean ? `EAN des Angebots (${ean}) oder ASIN` : "ASIN oder EAN"} aria-label="ASIN oder EAN" data-testid="amazon-code" />
            <button type="button" className="btn" onClick={fetchAmazon} disabled={pending || disabled} data-testid="amazon-fetch">
              {pending ? "Hole …" : "Von Amazon holen"}
            </button>
          </div>
          {amzMsg && <div className="small" role="status" style={{ color: amzMsg.ok ? "var(--ok)" : "var(--danger)" }} data-testid="amazon-msg">{amzMsg.text}</div>}
          {amz && (
            <div className="stack" style={{ gap: 12 }} data-testid="amazon-result">
              <div className="small">
                {amz.title ?? "–"} {amz.amazonUrl && <a href={amz.amazonUrl} target="_blank" rel="noreferrer">bei Amazon ansehen</a>}
              </div>
              {amz.images.length > 0 && (
                <div className="stack" style={{ gap: 6 }}>
                  <div className="ce-grid">
                    {amz.images.map((u) => (
                      <label key={u} className={`ce-tile ce-pick${pick.has(u) ? " on" : ""}`}>
                        <img src={u} alt="" loading="lazy" />
                        <span className="small">
                          <input type="checkbox" checked={pick.has(u)} onChange={(e) => setPick((s) => { const n = new Set(s); if (e.target.checked) n.add(u); else n.delete(u); return n; })} /> {images.includes(u) ? "schon drin" : "übernehmen"}
                        </span>
                      </label>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-small" disabled={!pick.size} onClick={() => addImages(amz.images.filter((u) => pick.has(u)))} data-testid="amazon-add-images">Ausgewählte anhängen ({pick.size})</button>
                    <button type="button" className="btn btn-small" disabled={!pick.size} onClick={() => addImages(amz.images.filter((u) => pick.has(u)), true)}>vorne einfügen</button>
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={!pick.size}
                      onClick={() => {
                        if (window.confirm("Alle bisherigen Bilder durch die ausgewählten ersetzen? (Erst mit „Bei eBay ändern“ wirksam.)")) {
                          setImages(cleanImages(amz.images.filter((u) => pick.has(u))).images);
                          setImgMsg({ ok: true, text: "Bilder ersetzt – noch nicht bei eBay." });
                        }
                      }}
                    >
                      bisherige ersetzen
                    </button>
                  </div>
                </div>
              )}
              {amz.bullets.length > 0 && (
                <div className="stack" style={{ gap: 6 }}>
                  <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                    {amz.bullets.map((b, i) => <li key={i}>{b}</li>)}
                  </ul>
                  {descriptionHtml !== null && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="btn btn-small" onClick={() => setDesc((d) => `${d.trim()}\n${bulletsHtml}`.trim())} data-testid="amazon-bullets">Stichpunkte an Beschreibung anhängen</button>
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => {
                          if (!desc.trim() || window.confirm("Beschreibung neu aus Titel, Stichpunkten und Amazon-Text erstellen? Die bisherige wird im Feld ersetzt.")) {
                            setDesc(descriptionFromParts({ heading: title, bullets: amz.bullets, text: amz.description }));
                          }
                        }}
                      >
                        Beschreibung neu daraus
                      </button>
                    </div>
                  )}
                </div>
              )}
              {Object.keys(amz.aspects).length > 0 && (
                <div className="stack" style={{ gap: 6 }}>
                  <div className="ce-asp-pick small">
                    {Object.entries(amz.aspects).map(([k, v]) => (
                      <label key={k} className="check">
                        <input type="checkbox" checked={pickAsp.has(k)} onChange={(e) => setPickAsp((s) => { const n = new Set(s); if (e.target.checked) n.add(k); else n.delete(k); return n; })} /> {k}: {v}
                      </label>
                    ))}
                  </div>
                  <div>
                    <button type="button" className="btn btn-small" disabled={!pickAsp.size} onClick={takeAspects} data-testid="amazon-aspects">Merkmale übernehmen ({pickAsp.size})</button>
                  </div>
                </div>
              )}
              <div className="small muted">Nur Bilder und Texte verwenden, die du nutzen darfst – z. B. Herstellerbilder bei Neuware genau dieses Produkts. Bilder werden beim Senden zu eBay kopiert.</div>
            </div>
          )}
        </div>
      </details>

      {/* Bilder */}
      <div className="stack" style={{ gap: 8 }}>
        <div className="label" style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          Bilder <span className="small muted" data-testid="image-count">({images.length}/{MAX_IMAGES})</span>
          {imagesChanged && <button type="button" className="btn-link small" onClick={() => { setImages(initialImages); setImgMsg(null); }}>zurücksetzen</button>}
        </div>
        {images.length ? (
          <ol className="ce-grid" data-testid="image-list">
            {images.map((u, i) => (
              <li key={u} className="ce-tile" data-testid="image-tile">
                <img src={u} alt={`Bild ${i + 1}`} loading="lazy" />
                <div className="ce-tile-bar">
                  <span className="small">{i === 0 ? <strong>Hauptbild</strong> : i + 1}</span>
                  <span style={{ display: "inline-flex", gap: 2 }}>
                    <button type="button" className="ce-ico" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Bild ${i + 1} nach vorne`} title="nach vorne">←</button>
                    <button type="button" className="ce-ico" onClick={() => move(i, 1)} disabled={i === images.length - 1} aria-label={`Bild ${i + 1} nach hinten`} title="nach hinten">→</button>
                    {i > 0 && <button type="button" className="ce-ico" onClick={() => toFront(i)} aria-label={`Bild ${i + 1} als Hauptbild`} title="als Hauptbild">★</button>}
                    <button type="button" className="ce-ico ce-del" onClick={() => remove(i)} aria-label={`Bild ${i + 1} entfernen`} title="entfernen">✕</button>
                  </span>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="small" style={{ color: "var(--danger)" }}>Keine Bilder – mindestens eins ist nötig.</div>
        )}
        <div className="ce-add">
          <input className="input" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="Bild-Adresse (https://…)" aria-label="Bild-Adresse" data-testid="image-url" />
          <button type="button" className="btn btn-small" onClick={() => { if (newUrl.trim()) { addImages([newUrl.trim()]); setNewUrl(""); } }} data-testid="image-url-add">Hinzufügen</button>
        </div>
        <div className="ce-add">
          <input ref={fileRef} id={`ce-files-${itemId}`} type="file" accept="image/*" multiple className="ce-file" onChange={upload} disabled={pending || disabled} data-testid="image-files" />
          <label htmlFor={`ce-files-${itemId}`} className={`btn btn-small${pending || disabled ? " disabled" : ""}`} aria-disabled={pending || disabled} data-testid="image-upload">
            {pending ? "Lade hoch …" : "Bilder vom Gerät hochladen"}
          </label>
          <span className="small muted">JPG/PNG, bis 12 MB je Bild – gehen direkt zu eBay, ins Angebot erst mit „Bei eBay ändern“.</span>
        </div>
        {imgMsg && <div className="small" role="status" style={{ color: imgMsg.ok ? "var(--ok)" : "var(--danger)" }} data-testid="image-msg">{imgMsg.text}</div>}
      </div>

      {/* Beschreibung */}
      <div className="stack" style={{ gap: 8 }}>
        <div className="label" style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          Beschreibung
          {descriptionHtml !== null && (
            <>
              <span className="small muted">({desc.length.toLocaleString("de-DE")} Zeichen, HTML)</span>
              <button type="button" className="btn-link small" onClick={() => setPreview((p) => !p)} data-testid="desc-preview-toggle">{preview ? "bearbeiten" : "Vorschau"}</button>
              {descChanged && <button type="button" className="btn-link small" onClick={() => setDesc(descriptionHtml)}>zurücksetzen</button>}
            </>
          )}
        </div>
        {descriptionHtml === null ? (
          <div className="small muted">Die Beschreibung ist noch nicht geladen – oben „Neu prüfen“, dann kannst du sie hier bearbeiten.</div>
        ) : preview ? (
          <iframe title="Vorschau der Beschreibung" sandbox="" srcDoc={previewDoc} className="ce-preview" data-testid="desc-preview" />
        ) : (
          <textarea className="input ce-desc" value={desc} onChange={(e) => setDesc(e.target.value)} rows={10} spellCheck={false} aria-label="Beschreibung (HTML)" data-testid="desc" />
        )}
        {descriptionHtml !== null && <div className="small muted">Skripte, eingebettete Seiten und Formulare entfernt das System vor dem Senden – eBay lehnt sie ab.</div>}
      </div>

      {/* Merkmale */}
      <div className="stack" style={{ gap: 8 }}>
        <div className="label">
          Merkmale <span className="small muted">(mehrere Werte mit ; trennen · leere Zeilen werden ignoriert · entfernte Merkmale löscht eBay)</span>
        </div>
        <div className="ce-asp" data-testid="aspect-rows">
          {rows.map((r) => {
            const d = defOf(r.name);
            return (
              <div className="ce-asp-row" key={r.id} data-testid="aspect-row">
                <input className="input" value={r.name} onChange={(e) => setRow(r.id, { name: e.target.value })} placeholder="Name" aria-label="Merkmal" maxLength={65} />
                <div style={{ minWidth: 0 }}>
                  <input className="input" value={r.value} onChange={(e) => setRow(r.id, { value: e.target.value })} placeholder={d?.required ? "Pflicht bei eBay" : d?.recommended ? "von eBay empfohlen" : "Wert"} aria-label={`Wert für ${r.name || "Merkmal"}`} list={d?.values.length ? `ce-l-${r.id}` : undefined} autoComplete="off" />
                  {d?.values.length ? (
                    <datalist id={`ce-l-${r.id}`}>
                      {d.values.slice(0, 200).map((v) => <option key={v} value={v} />)}
                    </datalist>
                  ) : null}
                </div>
                <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                  {d?.required && !r.value.trim() && <span className="tag tag-danger">Pflicht</span>}
                  <button type="button" className="ce-ico ce-del" onClick={() => setRows((l) => l.filter((x) => x.id !== r.id))} aria-label={`Merkmal ${r.name} entfernen`} title="entfernen">✕</button>
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="btn btn-small" onClick={() => setRows((l) => [...l, mkRow("", "")])} data-testid="aspect-add">Merkmal hinzufügen</button>
          {aspectsChanged && <button type="button" className="btn-link small" onClick={() => setRows(Object.entries(initialAspects).map(([k, v]) => mkRow(k, join(v))))}>zurücksetzen</button>}
          {missingRequired.length > 0 && <span className="small" style={{ color: "var(--danger)" }}>Pflicht fehlt: {missingRequired.map((d) => d.name).join(", ")}</span>}
        </div>
      </div>

      <div className="ce-send">
        <button type="button" className="btn btn-primary" onClick={send} disabled={!dirty || pending || disabled} aria-busy={pending} data-testid="content-send">
          {pending ? "Ändere bei eBay …" : "Bei eBay ändern"}
        </button>
        <span className="small muted" data-testid="content-changes">{dirty ? `Geändert: ${changeList.join(", ")}` : "Noch nichts geändert."}</span>
        {result ? (
          <span className="small" role="status" style={{ color: result.ok ? "var(--ok)" : "var(--danger)" }} data-testid="content-result">
            {result.message}
          </span>
        ) : recentApplied && !dirty ? (
          <span className="small" role="status" style={{ color: "var(--ok)" }} data-testid="content-result">
            ✓ Bei eBay geändert: {recentApplied}
          </span>
        ) : null}
      </div>
    </div>
  );
}
