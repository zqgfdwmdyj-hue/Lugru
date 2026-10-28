import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLogin } from "@/lib/auth";
import { loadEventView, sourceLabel, type EventRow } from "@/lib/event-view";
import { knownCategories, productPicker } from "@/lib/service";
import { aiConfigured } from "@/lib/price-research";
import { AI_MODE_ESTIMATE } from "@/lib/ai-modes";
import { stockPrice } from "@/lib/pricing";
import { autoAiMode } from "@/lib/settings";
import { amountFromVariant, isMultiUnit, ISSUE_HELP, ISSUE_TIER, OUTCOME_LABELS, PACK_KINDS, packOffers, packText, STOCK_LABELS, cleanAiText, ISSUE_FILTERS, isSecondHand, mhdAuto, guessUnit, unitIssue, unitLabel, UNITS, UNSORTED_CATEGORY } from "@/lib/price-logic";
import { mhdLabel, outputPrice } from "@/lib/layout";
import { formatDate, formatEuro } from "@/lib/numbers";
import { addToEvent, applyPackSuggestion, applySuggestion, markPhotoPrice, createProduct, resolvePhotoPrice, saveItems, uploadMhdPhoto, uploadPhotos } from "@/app/(app)/actions";
import { PriceCheckChip } from "@/components/price-check";
import { ImageForm } from "@/components/image-form";
import { PhotoUpload } from "@/components/photo-upload";
import { PriceLinks } from "@/components/price-links";
import { MhdPhoto } from "@/components/mhd-photo";
import { CategorySelect } from "@/components/category-select";
import { UnsavedGuard } from "@/components/unsaved-guard";
import { RotateButtons } from "@/components/rotate-buttons";
import { AddPhotos } from "@/components/add-photos";
import { AddPanel, BulkBar, ListControls } from "./list-controls";

const priceText = (v: number | null) => (v === null ? "" : v.toFixed(2).replace(".", ","));
const FORM = "produktliste";

export default async function ProduktePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; kat?: string; status?: string; dbq?: string; hinzufuegen?: string; offen?: string }> }) {
  await requireLogin();
  const { id } = await params;
  const sp = await searchParams;
  const view = await loadEventView(id);
  if (!view) notFound();
  const { rows } = view;
  const dbq = (sp.dbq ?? "").trim().slice(0, 80);
  const [picker, categories] = await Promise.all([productPicker(id, dbq), knownCategories()]);
  const ai = aiConfigured();
  const autoAi = ai && !!(await autoAiMode());

  const catCounts = new Map<string, number>();
  for (const r of rows) catCounts.set(r.product.category, (catCounts.get(r.product.category) ?? 0) + 1);
  const usedCats = [...catCounts].sort((a, b) => a[0].localeCompare(b[0], "de")).map(([name, count]) => ({ name, count }));
  const statuses = [
    ...ISSUE_FILTERS.map((f) => ({ key: f.key, label: f.label, count: rows.filter((r) => r.issues.some((i) => i.key === f.key)).length })),
    { key: "fertig", label: "✓ Fertig", count: rows.filter((r) => r.issues.length === 0).length },
  ];
  const conflicts = rows.filter((r) => r.state.conflict).length;
  const pastEvent = view.event.eventDate <= new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const withoutOutcome = rows.filter((r) => !r.item.outcome).length;
  const open = rows.filter((r) => r.issues.length > 0).length;
  const addInitial = ["fotos", "datenbank", "manuell"].includes(sp.hinzufuegen ?? "") ? sp.hinzufuegen! : rows.length === 0 ? "fotos" : "";

  return (
    <>
      <AddPanel
        initial={addInitial}
        photos={<PhotoUpload eventId={id} action={uploadPhotos} variant="card" categories={categories} ai={ai} autoAi={autoAi} />}
        database={
          <form action={addToEvent} className="card card-pad stack" style={{ gap: 8 }}>
            <input type="hidden" name="eventId" value={id} />
            <h2>Aus der Produktdatenbank wählen</h2>
            <div style={{ display: "flex", gap: 6 }}>
              <input className="input" name="dbq" defaultValue={dbq} placeholder="Name, Variante oder Kategorie …" aria-label="Produktdatenbank durchsuchen" />
              <input type="hidden" name="hinzufuegen" value="datenbank" />
              <button className="btn" type="submit" formAction={`/verteilung/${id}`} formMethod="get">Suchen</button>
            </div>
            <div className="picker-list">
              {picker.length === 0 && <div className="small muted">{dbq ? "Nichts gefunden." : "Alle Produkte sind schon dabei – oder es gibt noch keine."}</div>}
              {picker.map(({ p, lastUsed, times }) => (
                <label key={p.id} className="picker-row">
                  <input type="checkbox" name="productId" value={p.id} />
                  {p.imageFileId ? <img src={`/datei/${p.imageFileId}?w=200`} alt="" className="thumb thumb-sm" loading="lazy" /> : <span className="thumb thumb-sm" />}
                  <span style={{ minWidth: 0, flexGrow: 1 }}>
                    <span className="picker-name">{p.name}{p.variant ? ` · ${p.variant}` : ""}</span>
                    <span className="small muted">{p.category}{times ? ` · ${times}× dabei, zuletzt ${formatDate(lastUsed)}` : " · neu"}</span>
                  </span>
                  <span className="num small">{p.price !== null ? formatEuro(p.price) : ""}</span>
                </label>
              ))}
            </div>
            {picker.length > 0 && <button className="btn btn-primary" type="submit">Ausgewählte hinzufügen</button>}
          </form>
        }
        manual={
          <ImageForm action={createProduct} className="card card-pad stack" style={{ gap: 8 }}>
            <input type="hidden" name="eventId" value={id} />
            <h2>Neues Produkt anlegen</h2>
            <div className="form-grid">
              <div className="field"><label className="label" htmlFor="nn">Name</label><input className="input" id="nn" name="name" placeholder="leer lassen = KI erkennt vom Foto" /></div>
              <div className="field"><label className="label" htmlFor="nv">Variante / Größe</label><input className="input" id="nv" name="variant" placeholder="z. B. 500 g" /></div>
              <div className="field"><label className="label" htmlFor="np">Spendenempfehlung €</label><input className="input" id="np" name="price" inputMode="decimal" placeholder="0,50" /></div>
              <div className="field"><label className="label" htmlFor="nc">Kategorie</label><CategorySelect id="nc" name="category" value={UNSORTED_CATEGORY} categories={categories} /></div>
            </div>
            <div className="field"><label className="label" htmlFor="ni">Fotos (optional, mehrere möglich)</label><input className="input" id="ni" name="image" type="file" accept="image/*" multiple /><span className="small muted">Vorder- und Rückseite (mit MHD) – die KI nimmt die Vorderseite als Titelbild und füllt Name, Größe und Kategorie aus. Mit Fotos darf der Name leer bleiben.</span></div>
            <button className="btn btn-primary" type="submit">Anlegen und hinzufügen</button>
          </ImageForm>
        }
      />

      {pastEvent && withoutOutcome > 0 && (
        <div className="notice notice-results" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span>📊 Die Verteilung ist vorbei: Wie lief es? Für {withoutOutcome} von {rows.length} Produkten fehlt noch das Ergebnis.</span>
          <Link href={`/verteilung/${id}/ergebnisse`} className="btn btn-small btn-results">Ergebnisse erfassen</Link>
        </div>
      )}
      {conflicts > 0 && (
        <div className="notice notice-error">
          ✕ {conflicts === 1 ? "Bei einem Produkt widersprechen" : `Bei ${conflicts} Produkten widersprechen`} sich Foto und eingetragener Preis. Ausgegeben wird überall der eingetragene Preis. <Link href={`/verteilung/${id}/pruefen`}>Jetzt prüfen</Link>
        </div>
      )}
      {view.busy && <div className="notice notice-info">KI arbeitet im Hintergrund (Fotos lesen / Preise suchen) … die Seite aktualisiert sich von selbst.</div>}

      <form action={saveItems} id={FORM} className="card product-list">
        <input type="hidden" name="eventId" value={id} />
        <div className="list-top">
          <ListControls listId={FORM} categories={usedCats} statuses={statuses} total={rows.length} initial={{ q: sp.q ?? "", kat: sp.kat ?? "", status: sp.status ?? "" }} />
          <div className="list-top-actions">
            <span className="small muted">{open ? `${open} insgesamt mit offenen Punkten` : rows.length ? "Alles geprüft" : ""}</span>
            <button className="btn btn-small" type="submit" name="op" value="sort" title="Nach Kategorie und Name ordnen (wie im Aushang)">Sortieren</button>
          </div>
        </div>
        <BulkBar formId={FORM} categories={categories} ai={ai} costs={AI_MODE_ESTIMATE} />
        {rows.length === 0 && <div className="card-pad muted">Noch keine Produkte. Oben „📷 Fotos hochladen“ wählen – am Handy öffnet sich direkt die Kamera oder die Fotomediathek.</div>}
        <div className="pl">
          {rows.map((r, i) => (
            <ProductRow key={r.item.id} r={r} eventId={id} categories={categories} ai={ai} first={i === 0} last={i === rows.length - 1} open={sp.offen === r.product.id} />
          ))}
        </div>
        <UnsavedGuard formId={FORM} eventId={id} save={saveItems} />
      </form>
    </>
  );
}

/** Versteckter Stand beim Laden: nur Geändertes wird gespeichert (siehe saveItems). */
const O = ({ name, value }: { name: string; value: string }) => <input type="hidden" name={`o_${name}`} value={value} />;

function StatusTags({ r }: { r: EventRow }) {
  if (r.issues.length === 0) return <span className="tag tag-ok">Fertig</span>;
  return (
    <>
      {r.issues.slice(0, 3).map((i) => <span key={i.key} className={`tag ${ISSUE_TIER[i.key] === 1 ? "tag-danger" : ISSUE_TIER[i.key] === 2 ? "tag-warn" : "tag-neutral"}`} title={ISSUE_HELP[i.key]}>{i.label}</span>)}
      {r.issues.length > 3 && <span className="tag tag-neutral">+{r.issues.length - 3}</span>}
    </>
  );
}

function ProductRow({ r, eventId, categories, ai, first, last, open }: { r: EventRow; eventId: string; categories: string[]; ai: boolean; first: boolean; last: boolean; open?: boolean }) {
  const { item, product, state, check } = r;
  const name = r.unnamed ? "" : product.name;
  const unit = unitLabel(item.unit, item.unitCount);
  const guess = !item.unit ? guessUnit(item.priceNote, product.variant, r.drink) : null;
  const unitProblem = unitIssue({ unit: item.unit, unitCount: item.unitCount, unitConfirmed: item.unitConfirmed, price: item.price });
  const mhd = mhdAuto(product);
  const shownAs = outputPrice({ ...item, amount: product.amount });
  // Inhalt/Menge aus der Variante vorschlagen („1,5 kg Gastrodose“ → „1,5 kg“)
  const amountHint = amountFromVariant(product.variant);
  // Viel da (Palette, Kartons)? Dann eher günstiger – nur als Vorschlag.
  const stockHint = stockPrice(item.price, item.stock);
  const search = [product.name, product.variant, product.category, item.caption].filter(Boolean).join(" ").toLocaleLowerCase("de-DE");
  const k = (f: string) => `${f}_${item.id}`;
  const kp = (f: string) => `${f}_${product.id}`;
  return (
    <div className="pl-row" id={`p-${product.id}`} data-row data-search={search} data-cat={product.category} data-issues={r.issues.map((x) => x.key).join(" ")}>
      <input type="hidden" name={`row_${item.id}`} value="1" />
      {/* Auf-/Zuklappen ohne JavaScript – funktioniert auch, bevor die Seite fertig geladen ist. */}
      <input type="checkbox" id={`open-${item.id}`} className="pl-open sr-only" defaultChecked={open} aria-label={`Details zu ${name || "Produkt ohne Namen"}`} />
      <div className="pl-main">
        <input type="checkbox" name="sel" value={item.id} className="pl-sel" aria-label={`${name || "Produkt ohne Namen"} auswählen`} />
        <label htmlFor={`open-${item.id}`} className="pl-photo" title="Details bearbeiten">
          {product.imageFileId ? <img src={`/datei/${product.imageFileId}?w=200`} alt="" className="thumb" loading="lazy" /> : <span className="thumb thumb-empty">kein Foto</span>}
        </label>
        <div className="pl-name">
          <label htmlFor={`open-${item.id}`} className="pl-title">{name || <span className="muted">Ohne Namen – bitte eintragen</span>}</label>
          <div className="small muted">
            {[product.variant, product.category, item.stock ? `Bestand: ${STOCK_LABELS[item.stock]}` : null].filter(Boolean).join(" · ")}
            {item.bestBefore ? <span className={item.bestBeforeSource === "foto-ki" ? "warn-text" : ""}> · {mhdLabel(item.bestBefore)}{item.bestBeforeSource === "foto-ki" ? " (KI – prüfen)" : ""}</span> : null}
          </div>
          {item.outcome && <div className="small muted">Ergebnis: {OUTCOME_LABELS[item.outcome]}</div>}
        </div>
        <div className="pl-unit">
          <span className="pl-label">Abgabe</span>
          {unit || item.priceNote ? <span>{unit || item.priceNote}</span> : <span className="muted" title="Abgabeeinheit unter „Details“ festlegen">{guess ? `${unitLabel(guess.unit, guess.count)}?` : "–"}</span>}
          {/* Einheit wird getrennt vom Preis bestätigt */}
          <span className={`small ${unitProblem ? "warn-text" : "muted"}`}>{unitProblem ? (item.unitConfirmed ? "prüfen" : "offen") : "bestätigt"}</span>
        </div>
        <div className="pl-price">
          <label className="pl-label" htmlFor={k("price")}>Spendenempfehlung</label>
          <span className="price-input">
            <input className="input input-compact num" id={k("price")} name={k("price")} defaultValue={priceText(item.price)} inputMode="decimal" placeholder="–" />
            <span>€</span>
          </span>
          <O name={k("price")} value={priceText(item.price)} />
          <span className={`small ${item.price !== null && !item.priceConfirmed ? "warn-text" : "muted"}`}>{sourceLabel(r)}</span>
          {packOffers(item, r.drink, product.variant).map((pk) => <span key={pk.label + pk.price} className="small">+ {pk.label} {priceText(pk.price)} €</span>)}
        </div>
        <div className="pl-status"><StatusTags r={r} /></div>
        <label htmlFor={`open-${item.id}`} className="btn btn-small pl-toggle"><span className="when-closed">Details bearbeiten</span><span className="when-open">Details schließen</span></label>
      </div>

      <div className="pl-details">
        <fieldset>
          <legend>Produkt</legend>
          {check?.status === "done" && check.multipleProducts && (
            <div className="notice notice-warn small">
              📷 Auf dem Foto sind <strong>mehrere verschiedene Produkte</strong> – die KI kann sie nicht sicher trennen. Bitte jedes Produkt einzeln fotografieren und neu hochladen (dieses dann entfernen).{" "}
              <button className="btn-link small" type="submit" name="op" value={`mehrere-ok:${item.id}`}>Ist nur ein Produkt</button>
            </div>
          )}
          {product.reviewNote && (
            <div className="notice notice-info small">
              🤖 {product.reviewNote}. <button className="btn-link small" type="submit" name="op" value={`angaben-ok:${item.id}`}>Angaben stimmen</button>
            </div>
          )}
          <div className="field"><label className="label" htmlFor={kp("name")}>Name</label><input className="input input-compact" id={kp("name")} name={kp("name")} defaultValue={name} placeholder="Name eintragen" /></div>
          <O name={kp("name")} value={name} />
          <div className="field"><label className="label" htmlFor={kp("variant")}>{r.drink ? "Inhalt je Flasche / Sorte" : "Variante / Packungsgröße"}</label><input className="input input-compact" id={kp("variant")} name={kp("variant")} defaultValue={product.variant ?? ""} placeholder="z. B. 240 g, 6 x 125 g" /></div>
          <O name={kp("variant")} value={product.variant ?? ""} />
          <div className="field">
            <label className="label" htmlFor={kp("amount")}>Inhalt / Menge (optional)</label>
            <input className="input input-compact" id={kp("amount")} name={kp("amount")} defaultValue={product.amount ?? ""} placeholder={amountHint ? `z. B. ${amountHint}` : r.drink ? "z. B. 0,5 l" : "z. B. 1,5 kg"} />
            <span className="small muted">Steht in Collage, Aushang und Messenger vor dem Preis{item.priceNote ? " – außer es gibt einen eigenen Text vor dem Preis" : ""}.</span>
            {amountHint && !product.amount && <button className="btn-link small" type="submit" name="op" value={`menge:${item.id}`} style={{ textAlign: "left" }}>„{amountHint}“ aus der Variante übernehmen</button>}
          </div>
          <O name={kp("amount")} value={product.amount ?? ""} />
          <div className="field"><label className="label" htmlFor={kp("cat")}>Kategorie</label><CategorySelect key={product.category} compact id={kp("cat")} name={kp("cat")} value={product.category} categories={categories} /></div>
          {/* key: Auswahllisten übernehmen geänderte Werte vom Server sonst nicht (z. B. nach einer Stapelaktion) –
              dann würde das nächste Speichern den alten Wert zurückschreiben. */}
          <O name={kp("cat")} value={product.category} />
          {r.catHint && (
            <div className="notice notice-warn small">
              Kategorie auffällig: {r.catHint.reason} → Vorschlag „{r.catHint.suggest}“. Oben ändern oder{" "}
              <button className="btn-link small" type="submit" name="op" value={`kategorie-ok:${item.id}`}>Kategorie stimmt</button>
            </div>
          )}
          <div className="field">
            <label className="label" htmlFor={kp("mhdmode")}>MHD nötig?</label>
            <select key={product.mhdMode ?? ""} className="select select-compact" id={kp("mhdmode")} name={kp("mhdmode")} defaultValue={product.mhdMode ?? ""}>
              <option value="">Automatisch: {mhd.unsure ? "unklar" : mhd.relevant ? "ja" : "nein"} ({mhd.reason})</option>
              <option value="ja">Ja – Lebensmittel / Nahrung</option>
              <option value="nein">Nein – Zubehör, Spielzeug, Haushalt</option>
            </select>
            {mhd.unsure && !product.mhdMode && <span className="small warn-text">MHD-Relevanz prüfen: Ist das Nahrung (ja) oder Zubehör (nein)?</span>}
          </div>
          <O name={kp("mhdmode")} value={product.mhdMode ?? ""} />
          <div className="field">
            <label className="label" htmlFor={k("mhd")}>MHD-Datum{mhd.relevant ? "" : " (nicht nötig)"}</label>
            <input className="input input-compact num" type="date" id={k("mhd")} name={k("mhd")} defaultValue={item.bestBefore ?? ""} />
            {item.bestBeforeSource === "foto-ki" && (
              <span className="small warn-text">
                Automatisch aus dem Foto gelesen – stimmt es?{" "}
                <button className="btn-link small" type="submit" name="op" value={`mhd-ok:${item.id}`}>✓ MHD stimmt</button>
                <span className="muted"> (sonst Datum oben korrigieren)</span>
              </span>
            )}
          </div>
          <O name={k("mhd")} value={item.bestBefore ?? ""} />
          <MhdPhoto itemId={item.id} fileId={item.bestBeforeFileId} action={uploadMhdPhoto.bind(null, item.id)} />
        </fieldset>

        <fieldset>
          <legend>Spendenempfehlung</legend>
          <div className="form-grid">
            <div className="field">
              <label className="label" htmlFor={k("unit")}>Abgabeeinheit</label>
              <select key={item.unit ?? ""} className="select select-compact" id={k("unit")} name={k("unit")} defaultValue={item.unit ?? ""}>
                <option value="">nicht angegeben</option>
                {Object.entries(UNITS).map(([key, u]) => <option key={key} value={key}>{u.label}</option>)}
              </select>
              {guess && <span className="small muted">Vorschlag: {unitLabel(guess.unit, guess.count)}</span>}
              {r.drink && (!item.unit || item.unit === "stueck") && <span className="small muted">Getränke im Ganzen? Dann Kasten, Tray oder Palette wählen – der Preis gilt für das ganze Gebinde, kein Flaschenpreis nötig.</span>}
              {unitProblem && <span className="small warn-text">{unitProblem}</span>}
              {unitProblem && item.unit && <button className="btn-link small" type="submit" name="op" value={`einheit-ok:${item.id}`} style={{ textAlign: "left" }}>Einheit stimmt so</button>}
            </div>
            <O name={k("unit")} value={item.unit ?? ""} />
            <div className="field">
              <label className="label" htmlFor={k("unitcount")}>{item.unit === "kasten" || (r.drink && isMultiUnit(item.unit)) ? "Flaschen darin" : "Stück je Einheit"}</label>
              <input className="input input-compact num" id={k("unitcount")} name={k("unitcount")} defaultValue={item.unitCount ?? ""} inputMode="numeric" placeholder="z. B. 6" />
            </div>
            <O name={k("unitcount")} value={item.unitCount ? String(item.unitCount) : ""} />
          </div>
          <div className="field">
            <label className="label" htmlFor={k("note")}>Eigener Text vor dem Preis (optional)</label>
            <input className="input input-compact" id={k("note")} name={k("note")} defaultValue={item.priceNote ?? ""} placeholder="z. B. je, 3 Stück" />
          </div>
          <O name={k("note")} value={item.priceNote ?? ""} />
          <div className="sub-legend">{isMultiUnit(item.unit) && item.unit !== "packung" ? "Weitere Gebinde, z. B. Palette (je eigene Empfehlung)" : `Varianten: ganze Packung${r.drink ? " / Kasten" : " / Karton"}, Palette … (je eigene Empfehlung)`}</div>
          <div className="form-grid">
            <div className="field">
              <label className="label" htmlFor={k("packkind")}>Art</label>
              <select key={item.packKind ?? ""} className="select select-compact" id={k("packkind")} name={k("packkind")} defaultValue={item.packKind ?? ""}>
                <option value="">–</option>
                {Object.entries(PACK_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </div>
            <O name={k("packkind")} value={item.packKind ?? ""} />
            <div className="field"><label className="label" htmlFor={k("packcount")}>{r.drink ? "Flaschen darin" : "Stück darin"}</label><input className="input input-compact num" id={k("packcount")} name={k("packcount")} defaultValue={item.packCount ?? ""} inputMode="numeric" placeholder={r.drink ? "z. B. 12" : "z. B. 24"} /></div>
            <O name={k("packcount")} value={item.packCount ? String(item.packCount) : ""} />
            <div className="field"><label className="label" htmlFor={k("packprice")}>Empfehlung €</label><input className="input input-compact num" id={k("packprice")} name={k("packprice")} defaultValue={priceText(item.packPrice)} inputMode="decimal" placeholder="z. B. 5" /></div>
            <O name={k("packprice")} value={priceText(item.packPrice)} />
          </div>
          {r.packSuggestion && r.packSuggestion.price !== item.packPrice && (
            <div className="small">
              Vorschlag: <strong>{priceText(r.packSuggestion.price)} €</strong> ({Math.round(r.packSuggestion.share * 100)} % von {priceText(r.packSuggestion.retail)} € im Handel{r.drink ? ", Getränk" : ""}){" "}
              <button className="btn-link small" type="submit" formAction={applyPackSuggestion.bind(null, item.id, r.packSuggestion.price)}>übernehmen</button>
            </div>
          )}
          {r.drink && <div className="small muted">Inhalt je Flasche steht unter „Variante“ (z. B. 0,5 l) – daraus wird „Kasten (12 × 0,5 l)“.</div>}
          <div className="field"><label className="label" htmlFor={k("packnote")}>Eigene Bezeichnung (optional)</label><input className="input input-compact" id={k("packnote")} name={k("packnote")} defaultValue={item.packNote ?? ""} placeholder={packText({ packKind: item.packKind, packCount: item.packCount }, r.drink, product.variant)} /></div>
          <O name={k("packnote")} value={item.packNote ?? ""} />
          {item.morePacks.map((m, n) => (
            <div key={n} className="more-pack">
              <div className="form-grid">
                <div className="field">
                  <label className="label" htmlFor={k(`mpk${n}`)}>Weitere Variante {n + 2}</label>
                  <select key={m.kind ?? ""} className="select select-compact" id={k(`mpk${n}`)} name={k(`mpk${n}`)} defaultValue={m.kind ?? ""}>
                    <option value="">–</option>
                    {Object.entries(PACK_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </div>
                <O name={k(`mpk${n}`)} value={m.kind ?? ""} />
                <div className="field"><label className="label" htmlFor={k(`mpc${n}`)}>{r.drink ? "Flaschen darin" : "Stück darin"}</label><input className="input input-compact num" id={k(`mpc${n}`)} name={k(`mpc${n}`)} defaultValue={m.count ?? ""} inputMode="numeric" /></div>
                <O name={k(`mpc${n}`)} value={m.count ? String(m.count) : ""} />
                <div className="field"><label className="label" htmlFor={k(`mpp${n}`)}>Empfehlung €</label><input className="input input-compact num" id={k(`mpp${n}`)} name={k(`mpp${n}`)} defaultValue={priceText(m.price)} inputMode="decimal" /></div>
                <O name={k(`mpp${n}`)} value={priceText(m.price)} />
              </div>
              <div className="field"><label className="label" htmlFor={k(`mpn${n}`)}>Eigene Bezeichnung (optional)</label><input className="input input-compact" id={k(`mpn${n}`)} name={k(`mpn${n}`)} defaultValue={m.note ?? ""} placeholder={packText({ packKind: m.kind, packCount: m.count }, r.drink, product.variant)} /></div>
              <O name={k(`mpn${n}`)} value={m.note ?? ""} />
              <button className="btn-link small" type="submit" name="op" value={`pack-del:${item.id}.${n}`}>Variante {n + 2} entfernen</button>
            </div>
          ))}
          <div><button className="btn btn-small" type="submit" name="op" value={`pack-add:${item.id}`}>+ weitere Variante (z. B. Karton und Palette)</button></div>
          <div className="output-preview">
            <span className="small muted">So steht es in Collage, Aushang und Messenger:</span>
            <strong>{[shownAs || "kein Preis", ...packOffers(item, r.drink, product.variant).map((pk) => `${pk.label} ${priceText(pk.price)} €`)].join(" · ")}</strong>
          </div>
          {item.price !== null && !item.priceConfirmed && <button className="btn btn-small" type="submit" name="op" value={`confirm:${item.id}`}>✓ Preis bestätigen</button>}
          {stockHint && (
            <div className="small">
              Viel Bestand ({STOCK_LABELS[item.stock!]}): eher <strong>{priceText(stockHint.price)} €</strong> statt {priceText(item.price)} €, damit es weggeht{" "}
              <button className="btn-link small" type="submit" name="op" value={`bestand-preis:${item.id}`}>übernehmen</button>
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend>Preis prüfen</legend>
          <PhotoPrice r={r} eventId={eventId} />
          <div className="stack" style={{ gap: 4 }}>
            {check && <div><PriceCheckChip check={check} /></div>}
            {r.compare && <div className={`small ${r.compare.level === "passt" ? "ok-text" : "warn-text"}`}>{r.compare.level === "passt" ? "✓ vergleichbar" : r.compare.level === "abweichend" ? "✗ nicht vergleichbar" : "? unsicher"}: {r.compare.reason}</div>}
            {r.suggestion !== null && r.suggestion !== item.price && (
              <div className="small">
                KI-Vorschlag: <strong>{priceText(r.suggestion)} €</strong>{" "}
                <button className="btn-link small" type="submit" formAction={applySuggestion.bind(null, check!.id, eventId)}>übernehmen</button>
              </div>
            )}
            {check?.summary && <div className="small muted">KI-Notiz (intern): {cleanAiText(check.summary)}</div>}
            {check?.offers.some((o) => isSecondHand(o.title, o.shop)) && <div className="small warn-text">Unter den Angeboten ist B-Ware/Gebrauchtes – zählt nicht als Vergleichspreis.</div>}
            {!r.unnamed && <div className="small muted">Selbst suchen: <PriceLinks name={product.name} variant={product.variant} /></div>}
            {ai && check?.status !== "pending" && check?.status !== "running" && (
              <div><button className="btn btn-small" type="submit" name="op" value={`ai:${item.id}`} title="KI erkennt das Produkt und sucht den Preis im Internet">{check ? "KI erneut suchen" : "Preis mit KI suchen"}</button></div>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend>Ausgabe & Bestand</legend>
          <label className="check"><input key={String(item.inCollage)} type="checkbox" name={k("col")} defaultChecked={item.inCollage} /> Auf der Collage / Social Media</label>
          <O name={k("col")} value={item.inCollage ? "on" : ""} />
          <label className="check"><input key={String(item.inFlyer)} type="checkbox" name={k("fly")} defaultChecked={item.inFlyer} /> Im Aushang / Messenger-Text</label>
          <O name={k("fly")} value={item.inFlyer ? "on" : ""} />
          <div className="field"><label className="label" htmlFor={k("caption")}>Text auf dem Bild</label><input className="input input-compact" id={k("caption")} name={k("caption")} defaultValue={item.caption ?? ""} placeholder="z. B. vegan, nur heute" /></div>
          <O name={k("caption")} value={item.caption ?? ""} />
          <div className="form-grid">
            <div className="field"><label className="label" htmlFor={k("qty")}>Menge (optional)</label><input className="input input-compact num" id={k("qty")} name={k("qty")} defaultValue={item.quantity ?? ""} inputMode="numeric" /></div>
            <O name={k("qty")} value={item.quantity !== null ? String(item.quantity) : ""} />
            <div className="field">
              <label className="label" htmlFor={k("stock")}>Bestand (ca.)</label>
              <select key={item.stock ?? ""} className="select select-compact" id={k("stock")} name={k("stock")} defaultValue={item.stock ?? ""}>
                <option value="">–</option>
                {Object.entries(STOCK_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </div>
            <O name={k("stock")} value={item.stock ?? ""} />
            <div className="field">
              <label className="label" htmlFor={k("outcome")}>Wie lief es? (nachher)</label>
              <select key={item.outcome ?? ""} className="select select-compact" id={k("outcome")} name={k("outcome")} defaultValue={item.outcome ?? ""}>
                <option value="">noch offen</option>
                {Object.entries(OUTCOME_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </div>
            <O name={k("outcome")} value={item.outcome ?? ""} />
          </div>
        </fieldset>

        <div className="pl-detail-actions">
          {product.imageFileId && <span className="small muted" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>Foto drehen <RotateButtons productId={product.id} compact /></span>}
          <AddPhotos productId={product.id} />
          {r.backPhotos.length > 0 && (
            <span className="small muted" style={{ display: "inline-flex", gap: 6, alignItems: "center" }} title="Rückseite/Infofoto – erscheint nicht auf Collage oder Social Media">
              Rückseite:
              {r.backPhotos.map((f) => <a key={f} href={`/datei/${f}`} target="_blank" rel="noreferrer"><img src={`/datei/${f}?w=200`} alt="Rückseite" className="thumb thumb-sm" /></a>)}
            </span>
          )}
          <span style={{ display: "inline-flex", gap: 4 }}>
            <button className="btn btn-small" type="submit" name="op" value={`up:${item.id}`} disabled={first} aria-label="Nach oben">↑</button>
            <button className="btn btn-small" type="submit" name="op" value={`down:${item.id}`} disabled={last} aria-label="Nach unten">↓</button>
          </span>
          <Link href={`/produkte/${product.id}?zurueck=${eventId}`} className="small">In der Produktdatenbank öffnen</Link>
          <button className="btn btn-small btn-danger-link" type="submit" name="op" value={`remove:${item.id}`} title="Aus dieser Verteilung entfernen (bleibt in der Datenbank)">Aus Verteilung entfernen</button>
          <label htmlFor={`open-${item.id}`} className="btn btn-small">Schließen</label>
        </div>
      </div>
    </div>
  );
}

/** Preis im Foto: Lesestand, Widerspruch mit den drei Entscheidungen. */
function PhotoPrice({ r, eventId }: { r: EventRow; eventId: string }) {
  const { state, item } = r;
  if (state.photo === "wird-gelesen") return <div className="small muted">📷 Preis im Foto wird gelesen …</div>;
  if (!state.printed) {
    if (!r.product.imageFileId) return null;
    return (
      <div className="small stack" style={{ gap: 4 }}>
        <span className="muted">📷 {state.unread ? "Foto noch nicht auf einen eingebrannten Preis geprüft." : "Kein Preis im Foto erkannt."}</span>
        {/* Erkennung übersehen? Dann von Hand – sonst stünde der Preis in der Collage doppelt. */}
        <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          Steht doch ein Preis im Foto?
          <input className="input input-compact num" name={`photoprice_${item.id}`} placeholder={priceText(item.price) || "Betrag"} inputMode="decimal" aria-label="Preis im Foto" style={{ width: 80 }} data-lazy="1" />
          <button className="btn btn-small" type="submit" formAction={markPhotoPrice.bind(null, item.id)}>Eintragen</button>
        </span>
      </div>
    );
  }
  const text = state.printed.text;
  if (!state.conflict) {
    const what = state.photo === "gleich" ? "passt zum eingetragenen Preis – wird nicht doppelt gedruckt"
      : state.photo === "abweichend-geloest" ? `eingetragener Preis gilt – die Collage setzt ${priceText(item.price)} € darüber`
      : state.photo === "mehrere" ? "mehrere Preise im Foto – Foto bleibt unverändert"
      : "ohne erkennbaren Betrag";
    return <div className="small">📷 Im Foto: <strong>„{text}“</strong> – {what}.</div>;
  }
  return (
    <div className="conflict-box">
      {r.product.imageFileId && (
        <a href={`/datei/${r.product.imageFileId}`} target="_blank" rel="noreferrer" title="Foto in voller Größe öffnen">
          <img src={`/datei/${r.product.imageFileId}?w=400`} alt="Produktfoto mit erkanntem Preis" className="conflict-photo" loading="lazy" />
        </a>
      )}
      <div className="small"><strong>Widerspruch:</strong> Im Foto erkannt „{text}“{state.printed.price !== null ? ` (${priceText(state.printed.price)} €)` : ""}, eingetragen {item.price !== null ? `${priceText(item.price)} €` : "nichts"}.</div>
      {state.suspicious && <div className="small warn-text">Die Erkennung ist wahrscheinlich falsch (ungewöhnlich hoher Betrag) – bitte im Foto nachsehen.</div>}
      <div className="conflict-actions">
        {item.price !== null && <button className="btn btn-small btn-primary" type="submit" formAction={resolvePhotoPrice.bind(null, item.id, "eingetragen")}>Eingetragenen Preis bestätigen</button>}
        {state.printed.price !== null && <button className="btn btn-small" type="submit" formAction={resolvePhotoPrice.bind(null, item.id, "foto")}>Fotopreis übernehmen ({priceText(state.printed.price)} €)</button>}
        <button className="btn btn-small" type="submit" formAction={resolvePhotoPrice.bind(null, item.id, "falsch")}>Erkennung falsch</button>
      </div>
      <Link href={`/verteilung/${eventId}/pruefen#p-${item.id}`} className="small">Alle Widersprüche unter „Prüfen“</Link>
    </div>
  );
}
