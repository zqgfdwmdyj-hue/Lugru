import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLogin } from "@/lib/auth";
import { loadEventView, sourceLabel, type EventRow } from "@/lib/event-view";
import { aiConfigured } from "@/lib/price-research";
import { AI_MODE_ESTIMATE } from "@/lib/ai-modes";
import { AiModeSelect } from "@/components/price-check";
import { guessUnit, splitInternal, unitIssue, UNITS, UNSORTED_CATEGORY } from "@/lib/price-logic";
import { outputPrice } from "@/lib/layout";
import { applyAllSuggestions, applyCategory, cleanInternalText, confirmCategories, confirmItems, confirmProducts, confirmUnits, researchEvent, resolvePhotoPrice, scanEventPhotoPrices } from "@/app/(app)/actions";

const euro = (v: number | null) => (v === null ? "–" : `${v.toFixed(2).replace(".", ",")} €`);
const usd = (v: number) => `${v.toFixed(2).replace(".", ",")} $`;

function Thumb({ r, size = 56 }: { r: EventRow; size?: number }) {
  return r.product.imageFileId
    ? <img src={`/datei/${r.product.imageFileId}?w=200`} alt="" className="thumb" style={{ width: size, height: size }} loading="lazy" />
    : <span className="thumb thumb-empty" style={{ width: size, height: size }}>kein Foto</span>;
}
const title = (r: EventRow) => (r.unnamed ? "Ohne Namen" : `${r.product.name}${r.product.variant ? ` · ${r.product.variant}` : ""}`);

export default async function PruefenPage({ params }: { params: Promise<{ id: string }> }) {
  await requireLogin();
  const { id } = await params;
  const view = await loadEventView(id);
  if (!view) notFound();
  const { rows } = view;
  const ai = aiConfigured();
  const list = (`/verteilung/${id}`);
  const has = (r: EventRow, key: string) => r.issues.some((i) => i.key === key);

  const conflicts = rows.filter((r) => r.state.conflict);
  const unconfirmed = rows.filter((r) => has(r, "preis-unbestaetigt"));
  const aiData = rows.filter((r) => has(r, "ki-angaben"));
  const compare = rows.filter((r) => has(r, "vergleich"));
  const unsorted = rows.filter((r) => r.product.category === UNSORTED_CATEGORY);
  const catHints = rows.filter((r) => r.catHint);
  const units = rows.filter((r) => !r.unnamed && r.issues.some((i) => i.key === "einheit"));
  const internal = rows.filter((r) => r.issues.some((i) => i.key === "intern"));
  const oldPhoto = rows.filter((r) => r.issues.some((i) => i.key === "foto-alt"));
  const suggestions = rows.filter((r) => r.item.price === null && r.suggestion !== null && r.compare?.level !== "abweichend");
  const missing = [
    { key: "name", label: "ohne Namen" },
    { key: "preis", label: "ohne Preis" },
    { key: "mhd", label: "ohne MHD (nur wo nötig)" },
    { key: "foto", label: "ohne Foto (Collage)" },
  ].map((m) => ({ ...m, n: rows.filter((r) => has(r, m.key)).length }));
  const unread = rows.filter((r) => r.product.imageFileId && (!r.photo?.status || r.photo.status === "error")).length;
  const missingForAi = rows.filter((r) => r.item.price === null || r.unnamed).length;
  const done = rows.filter((r) => r.issues.length === 0).length;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card card-pad check-summary">
        <div>
          <h2>{rows.length - done === 0 ? "✓ Alles geprüft" : `${rows.length - done} von ${rows.length} Produkten mit offenen Punkten`}</h2>
          <div className="small muted">Ausgegeben wird überall die eingetragene Spendenempfehlung. Was die KI oder die Fotoerkennung vorschlägt, gilt erst, wenn es hier bestätigt oder übernommen wird.</div>
        </div>
        <div className="summary-chips">
          {conflicts.length > 0 && <a href="#widersprueche" className="chip chip-danger">{conflicts.length} Preiswiderspruch</a>}
          {unconfirmed.length > 0 && <a href="#unbestaetigt" className="chip">{unconfirmed.length} Preise unbestätigt</a>}
          {aiData.length > 0 && <a href="#ki-angaben" className="chip">{aiData.length} KI-Angaben</a>}
          {compare.length > 0 && <a href="#vergleich" className="chip">{compare.length} Preisvergleich unsicher</a>}
          {oldPhoto.length > 0 && <a href="#foto-alt" className="chip chip-danger">{oldPhoto.length} Foto mit altem Preis</a>}
          {units.length > 0 && <a href="#einheiten" className="chip">{units.length} Abgabeeinheit offen</a>}
          {internal.length > 0 && <a href="#intern" className="chip">{internal.length} interne Hinweise im Text</a>}
          {(unsorted.length > 0 || catHints.length > 0) && <a href="#kategorien" className="chip">{unsorted.length + catHints.length} Kategorie prüfen</a>}
          {missing.filter((m) => m.n).map((m) => <Link key={m.key} href={`${list}?status=${m.key}`} className="chip">{m.n} {m.label}</Link>)}
        </div>
      </section>

      {conflicts.length > 0 && (
        <section id="widersprueche" className="stack">
          <h2>Preiswidersprüche: Foto und Angabe passen nicht zusammen</h2>
          <div className="small muted">Bis zur Entscheidung gilt der eingetragene Preis – die Collage setzt ihn als Feld über den alten Preis im Foto. Bitte vor dem Export klären.</div>
          {conflicts.map((r) => (
            <form key={r.item.id} id={`p-${r.item.id}`} className="card conflict-card">
              <a href={`/datei/${r.product.imageFileId}`} target="_blank" rel="noreferrer" className="conflict-big" title="Foto in voller Größe öffnen">
                <img src={`/datei/${r.product.imageFileId}?w=400`} alt={`Foto von ${title(r)}`} />
              </a>
              <div className="stack" style={{ gap: 8, minWidth: 0 }}>
                <strong className="wrap-anywhere">{title(r)}</strong>
                <table className="compare-table">
                  <tbody>
                    <tr><th>Im Foto erkannt</th><td>„{r.state.printed!.text}“{r.state.printed!.price !== null ? ` = ${euro(r.state.printed!.price)}` : ""}{r.state.suspicious && <span className="tag tag-warn" style={{ marginLeft: 6 }}>Erkennung wohl falsch</span>}</td></tr>
                    <tr><th>Eingetragen</th><td>{euro(r.item.price)} <span className="small muted">{sourceLabel(r)}</span></td></tr>
                    {r.suggestion !== null && <tr><th>KI-Vorschlag</th><td>{euro(r.suggestion)}</td></tr>}
                    <tr><th>Wird ausgegeben</th><td><strong>{outputPrice(r.item) || "kein Preis"}</strong></td></tr>
                  </tbody>
                </table>
                <div className="conflict-actions">
                  {r.item.price !== null && <button className="btn btn-small btn-primary" formAction={resolvePhotoPrice.bind(null, r.item.id, "eingetragen")}>Eingetragenen Preis bestätigen</button>}
                  {r.state.printed!.price !== null && <button className="btn btn-small" formAction={resolvePhotoPrice.bind(null, r.item.id, "foto")}>Fotopreis übernehmen ({euro(r.state.printed!.price)})</button>}
                  <button className="btn btn-small" formAction={resolvePhotoPrice.bind(null, r.item.id, "falsch")} title="Im Foto steht kein (oder ein anderer) Preis – die Erkennung wird verworfen">Erkennung falsch</button>
                </div>
              </div>
            </form>
          ))}
        </section>
      )}

      {unconfirmed.length > 0 && (
        <form id="unbestaetigt" action={confirmItems.bind(null, id)} className="card">
          <div className="card-head"><h2>Unbestätigte Preise ({unconfirmed.length})</h2><button className="btn btn-small btn-primary" type="submit">Angehakte bestätigen</button></div>
          <div className="small muted" style={{ padding: "8px 14px 0" }}>Aus dem Foto gelesen oder als KI-Vorschlag im Stapel übernommen. Bitte kurz ansehen – stimmt etwas nicht, in der Produktliste ändern.</div>
          <div className="check-list">
            {unconfirmed.map((r) => (
              <label key={r.item.id} className="check-row">
                <input type="checkbox" name="itemId" value={r.item.id} defaultChecked />
                <Thumb r={r} size={44} />
                <span className="check-text"><strong className="wrap-anywhere">{title(r)}</strong><span className="small muted">{sourceLabel(r)}{r.compare && r.compare.level !== "passt" ? ` · ${r.compare.reason}` : ""}</span></span>
                <span className="num">{outputPrice(r.item)}</span>
                <Link href={`${list}?q=${encodeURIComponent(r.unnamed ? "" : r.product.name)}`} className="small">ändern</Link>
              </label>
            ))}
          </div>
        </form>
      )}

      {aiData.length > 0 && (
        <form id="ki-angaben" action={confirmProducts.bind(null, id)} className="card">
          <div className="card-head"><h2>Von der KI eingetragen ({aiData.length})</h2><button className="btn btn-small btn-primary" type="submit">Angehakte stimmen</button></div>
          <div className="check-list">
            {aiData.map((r) => (
              <label key={r.item.id} className="check-row">
                <input type="checkbox" name="productId" value={r.product.id} />
                <Thumb r={r} size={44} />
                <span className="check-text"><strong className="wrap-anywhere">{title(r)}</strong><span className="small muted">{r.product.category} · {r.product.reviewNote}</span></span>
                <Link href={`${list}?q=${encodeURIComponent(r.product.name)}`} className="small">ändern</Link>
              </label>
            ))}
          </div>
        </form>
      )}

      {compare.length > 0 && (
        <section id="vergleich" className="card">
          <div className="card-head"><h2>Preisvergleich unsicher ({compare.length})</h2></div>
          <div className="small muted" style={{ padding: "8px 14px 0" }}>Der Handelspreis gilt nur als vergleichbar, wenn Variante und Packungsgröße passen. Prüfen, worauf sich die Spendenempfehlung bezieht (Einzelstück, Packung, Karton).</div>
          <div className="check-list">
            {compare.map((r) => (
              <div key={r.item.id} className="check-row">
                <Thumb r={r} size={44} />
                <span className="check-text">
                  <strong className="wrap-anywhere">{title(r)}</strong>
                  <span className={`small ${r.compare!.level === "abweichend" ? "warn-text" : "muted"}`}>{r.compare!.level === "abweichend" ? "✗ nicht vergleichbar" : "? unsicher"}: {r.compare!.reason}</span>
                  {r.check?.offers[0] && <span className="small muted">Handel: {r.check.offers[0].shop} „{r.check.offers[0].title}“ {euro(r.check.offers[0].price)}</span>}
                </span>
                <span className="num">{outputPrice(r.item) || "–"}</span>
                <Link href={`${list}?q=${encodeURIComponent(r.product.name)}`} className="small">Einheit/Preis ändern</Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {oldPhoto.length > 0 && (
        <section id="foto-alt" className="card">
          <div className="card-head"><h2>Fotos mit altem, abweichendem Preis ({oldPhoto.length})</h2></div>
          <div className="small muted" style={{ padding: "8px 14px 0" }}>Der alte Preis im Foto lässt sich nicht gezielt verdecken. Damit nicht zwei Preise zu sehen sind, druckt die Collage keinen zusätzlichen – bitte ein Foto ohne Preis hochladen.</div>
          <div className="check-list">
            {oldPhoto.map((r) => (
              <div key={r.item.id} className="check-row">
                <Thumb r={r} size={64} />
                <span className="check-text"><strong className="wrap-anywhere">{title(r)}</strong><span className="small muted">Im Foto: „{r.state.printed?.text}“ · eingetragen: {outputPrice(r.item)}</span></span>
                <Link href={`/produkte/${r.product.id}?zurueck=${id}`} className="btn btn-small">Neues Foto hochladen</Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {units.length > 0 && (
        <form id="einheiten" action={confirmUnits.bind(null, id)} className="card">
          <div className="card-head"><h2>Abgabeeinheit offen ({units.length})</h2><button className="btn btn-small btn-primary" type="submit">Angehakte bestätigen</button></div>
          <div className="small muted" style={{ padding: "8px 14px 0" }}>Worauf bezieht sich die Spendenempfehlung – ein Stück, eine Packung (wie viele?) oder ein Karton? Vorausgewählt ist nur ein Vorschlag aus Variante/Zusatz; gespeichert wird erst mit „Bestätigen“. Das ist getrennt von der Bestätigung des Preises.</div>
          <div className="check-list">
            {units.map((r) => {
              const g = r.item.unit ? { unit: r.item.unit, count: r.item.unitCount } : guessUnit(r.item.priceNote, r.product.variant);
              const problem = unitIssue({ unit: r.item.unit, unitCount: r.item.unitCount, unitConfirmed: r.item.unitConfirmed, price: r.item.price });
              return (
                <div key={r.item.id} className="check-row unit-row">
                  <input type="checkbox" name="itemId" value={r.item.id} defaultChecked={!!g?.unit && !problem?.startsWith("Einzelstück")} aria-label={`${title(r)} bestätigen`} />
                  <Thumb r={r} size={44} />
                  <span className="check-text"><strong className="wrap-anywhere">{title(r)}</strong><span className="small muted">{euro(r.item.price)}{r.item.priceNote ? ` · Zusatz „${r.item.priceNote}“` : ""}{problem && problem !== "Abgabeeinheit offen" ? ` · ${problem}` : ""}</span></span>
                  <span className="unit-inputs">
                    <select className="select select-compact" name={`unit_${r.item.id}`} defaultValue={g?.unit ?? ""} aria-label="Abgabeeinheit">
                      <option value="">nicht angeben</option>
                      {Object.entries(UNITS).map(([k, u]) => <option key={k} value={k}>{u.label}</option>)}
                    </select>
                    <input className="input input-compact num" name={`unitcount_${r.item.id}`} defaultValue={g?.count ?? ""} placeholder="Stück" inputMode="numeric" aria-label="Stück je Einheit" style={{ width: 70 }} />
                  </span>
                </div>
              );
            })}
          </div>
        </form>
      )}

      {internal.length > 0 && (
        <form id="intern" action={cleanInternalText.bind(null, id)} className="card">
          <div className="card-head"><h2>Interne Hinweise in Name oder Variante ({internal.length})</h2><button className="btn btn-small btn-primary" type="submit">Angehakte bereinigen</button></div>
          <div className="small muted" style={{ padding: "8px 14px 0" }}>Solche Hinweise der KI stehen nie in Collage, Aushang oder Messenger. „Bereinigen“ verschiebt sie in die interne Notiz des Produkts.</div>
          <div className="check-list">
            {internal.map((r) => {
              const n = splitInternal(r.product.name);
              const v = splitInternal(r.product.variant);
              return (
                <label key={r.item.id} className="check-row">
                  <input type="checkbox" name="productId" value={r.product.id} defaultChecked />
                  <Thumb r={r} size={44} />
                  <span className="check-text">
                    <strong className="wrap-anywhere">{[n.clean || r.product.name, v.clean].filter(Boolean).join(" · ")}</strong>
                    <span className="small muted">Interne Notiz: {[...n.notes, ...v.notes].join("; ")}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </form>
      )}

      {(unsorted.length > 0 || catHints.length > 0) && (
        <section id="kategorien" className="card">
          <div className="card-head"><h2>Kategorien prüfen</h2>{unsorted.length > 0 && <Link href={`${list}?status=kategorie`} className="btn btn-small">{unsorted.length} „{UNSORTED_CATEGORY}“ in der Liste zuordnen</Link>}</div>
          {catHints.length > 0 && (
            <>
              <div className="small muted" style={{ padding: "8px 14px 0" }}>Diese Kategorien wirken unpassend (nach Produktname oder KI). Nichts wird automatisch umsortiert – übernehmen oder bestätigen, dass es so stimmt.</div>
              <div className="check-list">
                {catHints.map((r) => (
                  <form key={r.item.id} className="check-row cat-row">
                    <input type="hidden" name="productId" value={r.product.id} />
                    <Thumb r={r} size={44} />
                    <span className="check-text"><strong className="wrap-anywhere">{title(r)}</strong><span className="small muted">jetzt: {r.product.category} → Vorschlag: <strong>{r.catHint!.suggest}</strong> ({r.catHint!.reason})</span></span>
                    <span className="conflict-actions">
                      <button className="btn btn-small btn-primary" formAction={applyCategory.bind(null, r.product.id, r.catHint!.suggest, id)}>Übernehmen</button>
                      <button className="btn btn-small" formAction={confirmCategories.bind(null, id)}>Stimmt so</button>
                    </span>
                  </form>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      <section className="card card-pad stack" style={{ gap: 10 }}>
        <h2>Fehlende Angaben</h2>
        <div className="summary-chips">
          {missing.map((m) => m.n > 0 ? <Link key={m.key} href={`${list}?status=${m.key}`} className="chip">{m.n} {m.label} →</Link> : <span key={m.key} className="chip chip-done">✓ keine {m.label}</span>)}
        </div>
        {suggestions.length > 0 && (
          <form action={applyAllSuggestions.bind(null, id)} className="notice notice-info" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span>Für {suggestions.length} Produkt(e) ohne Preis gibt es einen vergleichbaren KI-Vorschlag. Übernommen werden sie als „unbestätigt“; eingetragene Preise bleiben unverändert.</span>
            <button className="btn btn-small" type="submit">{suggestions.length} KI-Vorschläge eintragen</button>
          </form>
        )}
      </section>

      {ai ? (
        <div className="tool-grid">
          <form action={researchEvent} className="card card-pad stack" style={{ gap: 8 }}>
            <input type="hidden" name="eventId" value={id} />
            <h2>KI: Produkte erkennen & Preise suchen</h2>
            <div className="small muted">Läuft im Hintergrund. Eingetragene Preise werden nie überschrieben – Ergebnisse erscheinen als Vorschlag. Produkte mit Ergebnis aus den letzten 60 Tagen werden übersprungen.</div>
            <AiModeSelect />
            <div className="small">
              <strong>Nur fehlende</strong>: {missingForAi} Produkte (ohne Preis oder Namen) · höchstens ca. {usd(missingForAi * AI_MODE_ESTIMATE.sparsam)} bei „sparsam“<br />
              <strong>Alle</strong>: {rows.length} Produkte · höchstens ca. {usd(rows.length * AI_MODE_ESTIMATE.sparsam)} bei „sparsam“
            </div>
            {view.busy && <div className="notice notice-info">KI arbeitet gerade … die Seite aktualisiert sich von selbst.</div>}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button className="btn btn-primary" type="submit" name="umfang" value="fehlend" disabled={view.busy || missingForAi === 0}>Nur fehlende ({missingForAi})</button>
              <button className="btn" type="submit" name="umfang" value="alle" disabled={view.busy}>Alle ({rows.length})</button>
            </div>
          </form>
          <form action={scanEventPhotoPrices.bind(null, id)} className="card card-pad stack" style={{ gap: 8 }}>
            <h2>Preise aus alten Fotos lesen</h2>
            <div className="small muted">Für Fotos aus früheren Collagen, auf denen schon ein Preis steht. Erkannte Preise werden nur dort eingetragen, wo noch keiner steht – als „unbestätigt“. Weicht ein Fotopreis ab, erscheint er oben als Widerspruch. Ca. 0,2 Cent pro Foto.</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button className="btn" type="submit" name="umfang" value="neu" disabled={view.busy || unread === 0}>{unread ? `${unread} ungelesene Fotos lesen` : "Alle Fotos gelesen"}</button>
              <button className="btn btn-small" type="submit" name="umfang" value="alle" disabled={view.busy}>Alle neu lesen</button>
            </div>
          </form>
        </div>
      ) : (
        <div className="card card-pad small muted">KI ist aus – dafür auf dem Server <code>ANTHROPIC_API_KEY</code> setzen (siehe README).</div>
      )}
    </div>
  );
}
