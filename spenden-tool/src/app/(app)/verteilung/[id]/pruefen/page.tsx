import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLogin } from "@/lib/auth";
import { loadEventView, sourceLabel, type EventRow } from "@/lib/event-view";
import { aiConfigured } from "@/lib/price-research";
import { AI_MODE_ESTIMATE } from "@/lib/ai-modes";
import { AiModeSelect } from "@/components/price-check";
import { guessUnit, LEGACY_CATEGORIES, ISSUE_HELP, ISSUE_TIER, issueSummary, mhdAuto, TIER_LABELS, publicText, splitInternal, unitIssue, UNITS, UNSORTED_CATEGORY } from "@/lib/price-logic";
import { UnitReview } from "./unit-review";
import { outputPrice } from "@/lib/layout";
import { applyAllSuggestions, applyCategory, cleanInternalText, confirmCategories, confirmItems, confirmProducts, confirmUnits, keepSeparate, mergeBackside, readEventMhd, researchEvent, setMhdMode, resolvePhotoPrice, scanEventPhotoPrices } from "@/app/(app)/actions";

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
  const { rows, pairs } = view;
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
  // Lebensmittel ohne MHD, deren Fotos noch nicht ohne Ergebnis gelesen wurden
  const mhdOpen = rows.filter((r) => r.issues.some((i) => i.key === "mhd") && r.item.bestBeforeSource !== "foto-ki-leer" && r.product.imageFileId).length;
  const mhdUnsure = rows.filter((r) => r.issues.some((i) => i.key === "mhd-pruefen"));
  const oldPhoto = rows.filter((r) => r.issues.some((i) => i.key === "foto-alt"));
  const suggestions = rows.filter((r) => r.item.price === null && r.suggestion !== null && r.compare?.level !== "abweichend");
  const unread = rows.filter((r) => r.state.unread).length;
  const missingForAi = rows.filter((r) => r.item.price === null || r.unnamed).length;
  const done = rows.filter((r) => r.issues.length === 0).length;
  // Stufen: 1 zuerst klären, 2 prüfen, 3 optional (siehe ISSUE_TIER)
  const tierCount = (t: 1 | 2 | 3) => rows.filter((r) => r.issues.some((i) => ISSUE_TIER[i.key] === t)).length;
  const first = [
    { key: "preis", label: "ohne Preis" },
    { key: "name", label: "ohne Namen" },
    { key: "mehrere", label: "mehrere Produkte im Foto" },
  ].map((m) => ({ ...m, n: rows.filter((r) => has(r, m.key)).length }));
  const noPhoto = rows.filter((r) => has(r, "foto")).length;
  const legacyRows = rows.filter((r) => (LEGACY_CATEGORIES as readonly string[]).includes(r.product.category)).length;
  const mhdMissing = rows.filter((r) => has(r, "mhd")).length;
  const mhdKi = rows.filter((r) => has(r, "mhd-ki")).length;
  const mhdTotal = mhdMissing + mhdKi + mhdUnsure.length;
  const issueRows = rows.filter((r) => r.issues.length > 0).sort((a, b) => ISSUE_TIER[a.issues[0].key] - ISSUE_TIER[b.issues[0].key] || title(a).localeCompare(title(b), "de"));

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card card-pad check-summary">
        <div>
          <h2>{rows.length - done === 0 ? "✓ Alles geprüft" : `${rows.length - done} von ${rows.length} Produkten mit offenen Punkten`}</h2>
          <div className="small muted">Ausgegeben wird überall die eingetragene Spendenempfehlung. Was die KI oder die Fotoerkennung vorschlägt, gilt erst, wenn es hier bestätigt oder übernommen wird.</div>
        </div>
        <div className="tier-summary">
          <div className="tier-line tier-1">
            <strong>① {TIER_LABELS[1]} ({tierCount(1)})</strong>
            <span className="summary-chips">
              {conflicts.length > 0 && <a href="#widersprueche" className="chip chip-danger">{conflicts.length} Preiswiderspruch</a>}
              {oldPhoto.length > 0 && <a href="#foto-alt" className="chip chip-danger">{oldPhoto.length} Foto mit altem Preis</a>}
              {pairs.length > 0 && <a href="#rueckseiten" className="chip chip-danger">{pairs.length} mögliche Rückseite(n)</a>}
              {first.filter((m) => m.n).map((m) => <Link key={m.key} href={`${list}?status=${m.key}`} className="chip chip-danger">{m.n} {m.label}</Link>)}
              {tierCount(1) === 0 && <span className="chip chip-done">✓ nichts</span>}
            </span>
          </div>
          <div className="tier-line tier-2">
            <strong>② {TIER_LABELS[2]} ({tierCount(2)})</strong>
            <span className="summary-chips">
              {unconfirmed.length > 0 && <a href="#unbestaetigt" className="chip chip-warn">{unconfirmed.length} Preise unbestätigt</a>}
              {compare.length > 0 && <a href="#vergleich" className="chip chip-warn">{compare.length} Preisvergleich unsicher</a>}
              {aiData.length > 0 && <a href="#ki-angaben" className="chip chip-warn">{aiData.length} KI-Angaben</a>}
              {units.length > 0 && <a href="#einheiten" className="chip chip-warn">{units.length} Abgabeeinheit offen</a>}
              {mhdTotal > 0 && <a href="#mhd" className="chip chip-warn">{mhdTotal} MHD</a>}
              {(unsorted.length > 0 || catHints.length > 0) && <a href="#kategorien" className="chip chip-warn">{unsorted.length + catHints.length} Kategorie</a>}
              {tierCount(2) === 0 && <span className="chip chip-done">✓ nichts</span>}
            </span>
          </div>
          <div className="tier-line tier-3">
            <strong>③ {TIER_LABELS[3]} ({tierCount(3)})</strong>
            <span className="summary-chips">
              {internal.length > 0 && <a href="#optional" className="chip">{internal.length} interne Hinweise im Text</a>}
              {noPhoto > 0 && <Link href={`${list}?status=foto`} className="chip">{noPhoto} ohne Foto (Collage)</Link>}
              {tierCount(3) === 0 && <span className="chip chip-done">✓ nichts</span>}
            </span>
          </div>
        </div>
        {issueRows.length > 0 && <a href="#je-produkt" className="small">Alle {issueRows.length} Produkte einzeln mit Zusammenfassung ansehen ↓</a>}
      </section>

      {tierCount(1) > 0 && <h2 className="tier-head tier-1">① {TIER_LABELS[1]}: Preise und Konflikte</h2>}
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
                    <tr><th>Wird ausgegeben</th><td><strong>{outputPrice({ ...r.item, amount: r.product.amount }) || "kein Preis"}</strong></td></tr>
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

      {oldPhoto.length > 0 && (
        <section id="foto-alt" className="card">
          <div className="card-head"><h2>Fotos mit altem, abweichendem Preis ({oldPhoto.length})</h2></div>
          <div className="small muted" style={{ padding: "8px 14px 0" }}>Der alte Preis im Foto lässt sich nicht gezielt verdecken. Damit nicht zwei Preise zu sehen sind, druckt die Collage keinen zusätzlichen – bitte ein Foto ohne Preis hochladen.</div>
          <div className="check-list">
            {oldPhoto.map((r) => (
              <div key={r.item.id} className="check-row">
                <Thumb r={r} size={64} />
                <span className="check-text"><strong className="wrap-anywhere">{title(r)}</strong><span className="small muted">Im Foto: „{r.state.printed?.text}“ · eingetragen: {outputPrice({ ...r.item, amount: r.product.amount })}</span></span>
                <Link href={`/produkte/${r.product.id}?zurueck=${id}`} className="btn btn-small">Neues Foto hochladen</Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {pairs.length > 0 && (
        <section id="rueckseiten" className="stack">
          <h2>Mögliche Rückseiten ({pairs.length})</h2>
          <div className="small muted">Pro Foto entsteht ein Produkt. Diese Fotos zeigen wahrscheinlich dasselbe Produkt von vorne und hinten. Beim Zusammenführen wird die Rückseite nur noch Infofoto (Zutaten, Gewicht, MHD) – sie erscheint nicht mehr als eigenes Produkt in Collage, Aushang und Messenger.</div>
          {pairs.map((p) => {
            const f = rows.find((r) => r.item.id === p.front)!;
            const b = rows.find((r) => r.item.id === p.back)!;
            return (
              <form key={p.front} className="card pair-card">
                <div className="pair-photos">
                  <figure><img src={`/datei/${f.product.imageFileId}?w=400`} alt="" /><figcaption><span className="tag tag-ok">Vorderseite – bleibt</span><strong className="wrap-anywhere">{title(f)}</strong><span className="small muted">{euro(f.item.price)}</span></figcaption></figure>
                  <figure><img src={`/datei/${b.product.imageFileId}?w=400`} alt="" /><figcaption><span className="tag tag-neutral">Rückseite – wird Infofoto</span><strong className="wrap-anywhere">{title(b)}</strong><span className="small muted">{euro(b.item.price)}</span></figcaption></figure>
                </div>
                <div className="small muted">Grund: {p.reason}</div>
                <div className="conflict-actions">
                  <button className="btn btn-small btn-primary" formAction={mergeBackside.bind(null, id, f.product.id, b.product.id)}>Zusammenführen</button>
                  <button className="btn btn-small" formAction={mergeBackside.bind(null, id, b.product.id, f.product.id)}>Andersherum (rechts ist vorne)</button>
                  <button className="btn btn-small" formAction={keepSeparate.bind(null, id, f.product.id, b.product.id)}>Sind verschiedene Produkte</button>
                </div>
              </form>
            );
          })}
        </section>
      )}

      {(first.some((m) => m.n) || suggestions.length > 0) && (
        <section className="card card-pad stack" style={{ gap: 10 }}>
          <h2>Fehlende Preise und Namen</h2>
          <div className="summary-chips">
            {first.map((m) => m.n > 0 ? <Link key={m.key} href={`${list}?status=${m.key}`} className="chip chip-danger">{m.n} {m.label} →</Link> : <span key={m.key} className="chip chip-done">✓ keine {m.label}</span>)}
          </div>
          {suggestions.length > 0 && (
            <form action={applyAllSuggestions.bind(null, id)} className="notice notice-info" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span>Für {suggestions.length} Produkt(e) ohne Preis gibt es einen vergleichbaren KI-Vorschlag. Übernommen werden sie als „unbestätigt“; eingetragene Preise bleiben unverändert.</span>
              <button className="btn btn-small" type="submit">{suggestions.length} KI-Vorschläge eintragen</button>
            </form>
          )}
        </section>
      )}

      {tierCount(2) > 0 && <h2 className="tier-head tier-2">② {TIER_LABELS[2]}</h2>}
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
                <span className="num">{outputPrice({ ...r.item, amount: r.product.amount })}</span>
                <Link href={`${list}?q=${encodeURIComponent(r.unnamed ? "" : r.product.name)}`} className="small">ändern</Link>
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
                <span className="num">{outputPrice({ ...r.item, amount: r.product.amount }) || "–"}</span>
                <Link href={`${list}?q=${encodeURIComponent(r.product.name)}`} className="small">Einheit/Preis ändern</Link>
              </div>
            ))}
          </div>
        </section>
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

      {units.length > 0 && (
        <form action={confirmUnits.bind(null, id)}>
          <UnitReview
            units={Object.fromEntries(Object.entries(UNITS).map(([k, u]) => [k, u.label]))}
            rows={units.map((r) => {
              const g = r.item.unit ? { unit: r.item.unit, count: r.item.unitCount, sure: true } : guessUnit(r.item.priceNote, r.product.variant, r.drink);
              const problem = g ? unitIssue({ unit: g.unit, unitCount: g.count, unitConfirmed: true, price: r.item.price }) : null;
              return {
                itemId: r.item.id,
                title: title(r),
                thumb: r.product.imageFileId ? `/datei/${r.product.imageFileId}?w=200` : null,
                priceText: euro(r.item.price),
                note: r.item.priceNote,
                unit: g?.unit ?? "",
                count: g?.count ?? null,
                hasSuggestion: !!g,
                // Nur eindeutige und plausible Vorschläge vorauswählen (kein „Einzelstück für 4 €“).
                sure: !!g?.sure && !problem,
                problem,
              };
            })}
          />
        </form>
      )}

      {mhdTotal > 0 && (
        <section id="mhd" className="card">
          <div className="card-head"><h2>MHD ({mhdTotal})</h2></div>
          <div className="card-pad stack" style={{ gap: 8 }}>
            <div className="summary-chips">
              {mhdMissing > 0 && <Link href={`${list}?status=mhd`} className="chip chip-warn">{mhdMissing} Lebensmittel ohne MHD →</Link>}
              {mhdKi > 0 && <Link href={`${list}?status=mhd-ki`} className="chip chip-warn">{mhdKi} automatisch gelesen – bestätigen →</Link>}
              {mhdUnsure.length > 0 && <a href="#mhd-pruefen" className="chip chip-warn">{mhdUnsure.length} unklar: Nahrung oder Zubehör?</a>}
            </div>
            {ai && mhdOpen > 0 && (
              <form action={readEventMhd.bind(null, id)} className="notice notice-info" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span>Die KI liest das Datum von den Fotos ab (zuerst Rückseiten) für {mhdOpen} Produkt(e). Gelesene Daten sind als „automatisch gelesen“ markiert. Ca. 0,2 Cent je Foto.</span>
                <button className="btn btn-small" type="submit">MHD aus Fotos lesen</button>
              </form>
            )}
          </div>
        </section>
      )}

      {mhdUnsure.length > 0 && (
        <form id="mhd-pruefen" className="card">
          <div className="card-head"><h2>MHD-Relevanz prüfen ({mhdUnsure.length})</h2></div>
          <div className="small muted" style={{ padding: "8px 14px 0" }}>Nicht eindeutig erkannt, ob Nahrung oder Zubehör. Bis zur Entscheidung zählen sie vorsichtshalber als „MHD nötig“.</div>
          <div className="check-list">
            {mhdUnsure.map((r) => (
              <label key={r.item.id} className="check-row">
                <input type="checkbox" name="productId" value={r.product.id} />
                <Thumb r={r} size={44} />
                <span className="check-text"><strong className="wrap-anywhere">{title(r)}</strong><span className="small muted">{r.product.category} · {mhdAuto(r.product).reason}</span></span>
              </label>
            ))}
          </div>
          <div className="review-foot">
            <button className="btn btn-small" formAction={setMhdMode.bind(null, id, "ja")}>Angehakte: Nahrung – MHD nötig</button>
            <button className="btn btn-small" formAction={setMhdMode.bind(null, id, "nein")}>Angehakte: Zubehör – kein MHD</button>
          </div>
        </form>
      )}

      {(unsorted.length > 0 || catHints.length > 0) && (
        <details id="kategorien" className="card review-block" open={unsorted.length + catHints.length <= 8 || undefined}>
          <summary className="card-head"><h2>Kategorien prüfen ({unsorted.length + catHints.length})</h2>{unsorted.length > 0 && <Link href={`${list}?status=kategorie`} className="btn btn-small">{unsorted.length} „{UNSORTED_CATEGORY}“ in der Liste zuordnen</Link>}</summary>
          {legacyRows > 0 && (
            <div className="notice notice-warn" style={{ margin: "10px 14px 0" }}>
              {legacyRows} Produkt(e) stehen noch in einer alten Kategorie (z. B. „Drogerie & Haushalt“). <Link href="/produkte?filter=kategorie">Alle alten Kategorien auf einmal verteilen →</Link>
            </div>
          )}
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
        </details>
      )}

      {internal.length > 0 && (
        <details id="optional" className="card review-block">
          <summary className="card-head"><h2>③ Optional ({tierCount(3)})</h2><span className="small muted">stört die Ausgabe nicht</span></summary>
          <div className="card-pad stack" style={{ gap: 10 }}>
      {internal.length > 0 && (
        <form id="intern" action={cleanInternalText.bind(null, id)}>
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
                    {/* Vorschau = genau der Text, der in Collage, Aushang und Messenger steht (publicText) */}
                    <span className="small">Bisher: <span className="muted">{[r.product.name, r.product.variant].filter(Boolean).join(" · ")}</span></span>
                    <strong className="wrap-anywhere">Ausgabe: {[publicText(r.product.name), publicText(r.product.variant)].filter(Boolean).join(" · ")}</strong>
                    <span className="small muted">Wird interne Notiz: {[...n.notes, ...v.notes].join("; ")}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </form>
      )}

          </div>
        </details>
      )}
      {internal.length === 0 && noPhoto > 0 && (
        <section className="card card-pad small muted">③ Optional: <Link href={`${list}?status=foto`}>{noPhoto} Produkt(e) ohne Foto</Link> – erscheinen nicht auf der Collage.</section>
      )}

      {issueRows.length > 0 && (
        <details id="je-produkt" className="card review-block" open={issueRows.length <= 12 || undefined}>
          <summary className="card-head"><h2>Je Produkt ({issueRows.length})</h2><span className="small muted">wichtigste zuerst · antippen für Details</span></summary>
          <div className="issue-products">
            {issueRows.map((r) => {
              const top = ISSUE_TIER[r.issues[0].key];
              return (
                <details key={r.item.id} className={`issue-product tier-${top}`}>
                  <summary>
                    <Thumb r={r} size={44} />
                    <span className="check-text">
                      <strong className="wrap-anywhere">{title(r)}</strong>
                      <span className="small">{issueSummary(r.issues)}</span>
                    </span>
                    <span className={`tag ${top === 1 ? "tag-danger" : top === 2 ? "tag-warn" : "tag-neutral"}`}>{r.issues.length}</span>
                  </summary>
                  <ul className="issue-detail">
                    {r.issues.map((i) => (
                      <li key={i.key} className={`tier-${ISSUE_TIER[i.key]}`}>
                        <strong>{ISSUE_TIER[i.key] === 1 ? "✕" : ISSUE_TIER[i.key] === 2 ? "!" : "○"} {i.label}</strong>
                        <span className="small muted"> – {ISSUE_HELP[i.key]}</span>
                      </li>
                    ))}
                  </ul>
                  <Link href={`${list}?offen=${r.product.id}#p-${r.product.id}`} className="btn btn-small">In der Liste bearbeiten</Link>
                </details>
              );
            })}
          </div>
        </details>
      )}

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
            <div className="small muted">Für Fotos aus früheren Collagen, auf denen schon ein Preis steht. Erkannte Preise werden nur dort eingetragen, wo noch keiner steht – als „unbestätigt“. Weicht ein Fotopreis ab, erscheint er oben als Widerspruch. Ca. 0,4 Cent pro Foto.</div>
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
