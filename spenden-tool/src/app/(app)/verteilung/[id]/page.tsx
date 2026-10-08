import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLogin } from "@/lib/auth";
import { CopyButton } from "@/components/copy-button";
import { eventDateLabel, flyerSections, isPlaceholderName, messengerText } from "@/lib/layout";
import { knownCategories, latestPriceChecks, loadEvent, loadEventItems, printedInfo, productPicker } from "@/lib/service";
import { differsFromPhoto } from "@/lib/printed-price";
import { aiConfigured } from "@/lib/price-research";
import { AutoRefresh } from "@/components/auto-refresh";
import { AiModeSelect, PriceCheckChip, usd } from "@/components/price-check";
import { aiCostUsd } from "@/lib/ai-modes";
import { db, schema } from "@/db";
import { inArray } from "drizzle-orm";
import { formatDate, formatEuro } from "@/lib/numbers";
import { addToEvent, applyPhotoPrices, clearPrintedPrice, scanEventPhotoPrices, applyAllSuggestions, applySuggestion, uploadMhdPhoto, createProduct, deleteEvent, researchEvent, saveItems, updateEvent, uploadPhotos } from "@/app/(app)/actions";
import { ImageForm } from "@/components/image-form";
import { PhotoUpload } from "@/components/photo-upload";
import { PriceLinks } from "@/components/price-links";
import { MhdPhoto } from "@/components/mhd-photo";
import { CategorySelect } from "@/components/category-select";

const thumb: React.CSSProperties = { width: 52, height: 52, objectFit: "cover", borderRadius: 6, background: "var(--row)", display: "block" };
const priceText = (v: number | null) => (v === null ? "" : v.toFixed(2).replace(".", ","));

export default async function SpendenAktionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; zeige?: string; kat?: string }> }) {
  await requireLogin();
  const { id } = await params;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const event = await loadEvent(id);
  if (!event) notFound();
  const [rows, picker, categories] = await Promise.all([loadEventItems(id), productPicker(id, q), knownCategories()]);

  const sections = flyerSections(rows.filter((r) => r.item.inFlyer).map((r) => ({ ...r.product, price: r.item.price, priceNote: r.item.priceNote, bestBefore: r.item.bestBefore })));
  const text = messengerText({ ...event, dateLabel: eventDateLabel(event.eventDate) }, sections);
  const missingPrice = rows.filter((r) => r.item.price === null).length;
  const missingImage = rows.filter((r) => r.item.inCollage && !r.product.imageFileId).length;
  const unnamed = rows.filter((r) => isPlaceholderName(r.product.name)).length;
  const checks = await latestPriceChecks(rows.map((r) => r.product.id));
  const reading = rows.filter((r) => r.photo?.status === "pending").length;
  const busy = [...checks.values()].some((c) => c.status === "pending" || c.status === "running") || reading > 0;
  const differ = rows.filter((r) => r.product.imageFileId && differsFromPhoto(printedInfo(r.photo), r.item.price)).length;
  const unread = rows.filter((r) => r.product.imageFileId && (!r.photo?.status || r.photo.status === "error")).length;
  const ai = aiConfigured();
  const allChecks = rows.length ? await db.select().from(schema.priceChecks).where(inArray(schema.priceChecks.productId, rows.map((r) => r.product.id))) : [];
  const aiCost = allChecks.reduce((n, c) => n + aiCostUsd(c.mode, c.inputTokens, c.outputTokens, c.searches), 0);
  // Filter über der Liste: nur bestimmte Produkte anzeigen (z. B. die 6 ohne Namen unter 100).
  const suggestionReady = (r: (typeof rows)[number]) => {
    const c = checks.get(r.product.id);
    return c?.status === "done" && c.suggestedPrice !== null && r.item.price === null && !r.photo?.text;
  };
  const FILTERS: { key: string; label: string; test: (r: (typeof rows)[number]) => boolean }[] = [
    { key: "ohne-namen", label: "Ohne Namen", test: (r) => isPlaceholderName(r.product.name) },
    { key: "ohne-preis", label: "Ohne Preis", test: (r) => r.item.price === null },
    { key: "ki-vorschlag", label: "KI-Vorschlag da", test: suggestionReady },
    { key: "ohne-foto", label: "Ohne Foto", test: (r) => !r.product.imageFileId },
    { key: "ohne-mhd", label: "Ohne MHD", test: (r) => !r.item.bestBefore },
    { key: "preis-im-foto", label: "Preis im Foto", test: (r) => !!r.photo?.text },
  ];
  const filter = FILTERS.find((f) => f.key === sp.zeige);
  const kat = categories.includes(sp.kat ?? "") ? sp.kat! : "";
  const shown = rows.filter((r) => (!filter || filter.test(r)) && (!kat || r.product.category === kat));
  const usedCats = [...new Set(rows.map((r) => r.product.category))].sort((a, b) => a.localeCompare(b, "de"));
  const suggestions = rows.filter(suggestionReady).length;
  const link = (o: { zeige?: string; kat?: string }) => {
    const u = new URLSearchParams();
    const z = "zeige" in o ? o.zeige : filter?.key;
    const k = "kat" in o ? o.kat : kat;
    if (z) u.set("zeige", z);
    if (k) u.set("kat", k);
    const str = u.toString();
    return `/verteilung/${id}${str ? `?${str}` : ""}`;
  };
  const value = rows.reduce((s, r) => s + (r.item.price ?? 0) * (r.item.quantity ?? 0), 0);

  return (
    <>
      <datalist id="spenden-kategorien">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <div className="crumb"><Link href="/">Verteilungen</Link></div>
      <div className="page-head">
        <div>
          <h1>{eventDateLabel(event.eventDate)}{event.eventTime ? ` · ${event.eventTime}` : ""}</h1>
          <div className="small muted">{event.title} · {rows.length} Produkte{value ? ` · Warenwert ${formatEuro(value)}` : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <PhotoUpload eventId={id} action={uploadPhotos} categories={categories} ai={ai} />
          <Link href={`/verteilung/${id}/collage`} className="btn">Collage erstellen</Link>
          <Link href={`/verteilung/${id}/social`} className="btn">Social Media</Link>
          <Link href={`/aushang/${id}`} className="btn" target="_blank">Aushang drucken</Link>
        </div>
      </div>

      {(missingPrice > 0 || missingImage > 0 || unnamed > 0) && (
        <div className="notice notice-warn" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {unnamed > 0 && <Link href={link({ zeige: "ohne-namen", kat: "" })}>{unnamed} Produkt(e) noch ohne Namen</Link>}
          {missingPrice > 0 && <Link href={link({ zeige: "ohne-preis", kat: "" })}>{missingPrice} ohne Preis</Link>}
          {missingImage > 0 && <Link href={link({ zeige: "ohne-foto", kat: "" })}>{missingImage} ohne Foto</Link>}
        </div>
      )}

      {ai && unread > 0 && reading === 0 && (
        <form action={scanEventPhotoPrices.bind(null, id)} className="notice notice-info" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span>{unread} Foto(s) wurden noch nicht auf einen aufgedruckten Preis geprüft (z. B. „30 Cent“ aus alten Collagen).</span>
          <button className="btn btn-small btn-primary" type="submit" name="umfang" value="neu">Preise aus Fotos lesen</button>
          <span className="small muted">ca. 0,2 Cent pro Foto</span>
        </form>
      )}
      {differ > 0 && (
        <form action={applyPhotoPrices.bind(null, id, null)} className="notice notice-warn" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span>Bei {differ} Produkt(en) steht im Foto ein anderer Preis als eingetragen – die Collage zeigt den Preis aus dem Foto.</span>
          <button className="btn btn-small btn-primary" type="submit">Preise vom Foto übernehmen</button>
          <Link href={link({ zeige: "preis-im-foto", kat: "" })} className="small">ansehen</Link>
        </form>
      )}
      {reading > 0 && <div className="notice notice-info">📷 {reading} Foto(s) werden auf aufgedruckte Preise geprüft … die Seite aktualisiert sich von selbst.</div>}

      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }} className="stack">
          <form action={saveItems} className="card" style={{ overflow: "auto" }}>
            <input type="hidden" name="eventId" value={id} />
            <div className="card-head">
              <h2>Produkte</h2>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-small" type="submit" name="op" value="sort" title="Nach Kategorie und Name ordnen">Sortieren</button>
                <button className="btn btn-small btn-primary" type="submit" name="op" value="save">Speichern</button>
              </div>
            </div>
            <div className="filter-bar">
              <Link href={link({ zeige: "", kat: "" })} className={`chip${!filter && !kat ? " active" : ""}`}>Alle ({rows.length})</Link>
              {FILTERS.map((f) => {
                const n = rows.filter(f.test).length;
                return <Link key={f.key} href={link({ zeige: filter?.key === f.key ? "" : f.key })} className={`chip${filter?.key === f.key ? " active" : ""}`}>{f.label} ({n})</Link>;
              })}
              {usedCats.length > 1 && usedCats.map((c) => (
                <Link key={c} href={link({ kat: kat === c ? "" : c })} className={`chip chip-cat${kat === c ? " active" : ""}`}>{c}</Link>
              ))}
            </div>
            {suggestions > 0 && (
              <div style={{ padding: "0 14px 10px" }}>
                <button className="btn btn-small" type="submit" formAction={applyAllSuggestions.bind(null, id)} title="Für alle Produkte ohne Preis den fertigen KI-Vorschlag eintragen">
                  Alle {suggestions} KI-Vorschläge als Preis übernehmen
                </button>
              </div>
            )}
            {(filter || kat) && <div className="small muted" style={{ padding: "0 14px 8px" }}>{shown.length} von {rows.length} Produkten angezeigt. <Link href={link({ zeige: "", kat: "" })}>Alle anzeigen</Link></div>}
            <table className="table spenden-items">
              <thead>
                <tr><th></th><th>Produkt</th><th>Preis €</th><th>Text · Menge · MHD</th><th title="Auf Collage / im Aushang">Zeigen</th><th></th></tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={6} className="muted">Noch keine Produkte. Oben auf „📷 Fotos hinzufügen“ tippen – am Handy geht dabei direkt die Kamera oder die Fotomediathek auf.</td></tr>}
                {(filter || kat) && shown.length === 0 && <tr><td colSpan={6} className="muted">Keine Produkte für diesen Filter – alles erledigt.</td></tr>}
                {shown.map(({ item, product, photo }) => { const i = rows.findIndex((r) => r.item.id === item.id); return (
                  <tr key={item.id}>
                    <td>
                      <Link href={`/produkte/${product.id}?zurueck=${id}`} title="Produkt bearbeiten / Foto ändern">
                        {product.imageFileId ? <img src={`/datei/${product.imageFileId}`} alt="" style={thumb} loading="lazy" /> : <span style={{ ...thumb, display: "grid", placeItems: "center", fontSize: 11, color: "var(--muted)" }}>kein Foto</span>}
                      </Link>
                    </td>
                    <td style={{ minWidth: 150 }}>
                      <input className="input input-compact" name={`name_${product.id}`} defaultValue={isPlaceholderName(product.name) ? "" : product.name} placeholder="Name eintragen" aria-label="Name" />
                      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                        <input className="input input-compact" name={`variant_${product.id}`} defaultValue={product.variant ?? ""} placeholder="Variante (z. B. 5kg)" aria-label="Variante" />
                        <CategorySelect compact name={`cat_${product.id}`} value={product.category} categories={categories} />
                      </div>
                    </td>
                    <td>
                      <input className="input input-compact num" name={`price_${item.id}`} defaultValue={priceText(item.price)} inputMode="decimal" style={{ width: 80 }} placeholder="Preis" aria-label="Preis" />
                      <input className="input input-compact" name={`note_${item.id}`} defaultValue={item.priceNote ?? ""} placeholder="z. B. je" title="Steht vor dem Preis, z. B. „je“ oder „3er Packung“" style={{ width: 80, marginTop: 4, display: "block" }} aria-label="Zusatz vor dem Preis" />
                    
                      {(() => {
                        const c = checks.get(product.id);
                        return (
                          <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
                            <PriceCheckChip check={c} />
                            {(() => {
                              const printed = printedInfo(product.imageFileId ? photo : null);
                              if (photo?.status === "pending") return <span className="small muted">📷 Preis im Foto wird gelesen …</span>;
                              if (!printed) return null;
                              return (
                                <span className="small" title="Dieser Preis steht schon im Foto. Die Collage druckt ihn nicht ein zweites Mal.">
                                  📷 Im Foto: <strong>{printed.text}</strong>
                                  {differsFromPhoto(printed, item.price) && <span style={{ color: "var(--danger)" }}> · weicht vom eingetragenen Preis ab</span>}
                                  {differsFromPhoto(printed, item.price) && <>{" "}<button className="btn-link small" type="submit" formAction={applyPhotoPrices.bind(null, id, item.id)} title="Den Preis aus dem Foto eintragen">Foto-Preis übernehmen</button></>}
                                  {" "}<button className="btn-link small" type="submit" formAction={clearPrintedPrice.bind(null, product.imageFileId!, `/verteilung/${id}`)} title="Kein Preis im Foto – Collage druckt den Preis wieder normal">falsch erkannt</button>
                                </span>
                              );
                            })()}
                            {!isPlaceholderName(product.name) && <span className="small muted">selbst suchen: <PriceLinks name={product.name} variant={product.variant} /></span>}
                            {c?.status === "done" && c.suggestedPrice !== null && c.suggestedPrice !== item.price && !photo?.text && (
                              <button className="btn-link small" type="submit" formAction={applySuggestion.bind(null, c.id, id)} title="Vorschlag der KI als Spendenpreis übernehmen" style={{ whiteSpace: "nowrap" }}>{priceText(c.suggestedPrice)} € übernehmen</button>
                            )}
                            {ai && c?.status !== "pending" && c?.status !== "running" && (
                              <button className="btn-link small" type="submit" name="op" value={`ai:${item.id}`} title="KI erkennt das Produkt und sucht den Preis im Internet">{c ? "neu suchen" : "Preis suchen (KI)"}</button>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td>
                      <input className="input input-compact" name={`caption_${item.id}`} defaultValue={item.caption ?? ""} placeholder="Text auf dem Bild" style={{ width: 130 }} aria-label="Collage-Text" />
                      <input className="input input-compact num" name={`qty_${item.id}`} defaultValue={item.quantity ?? ""} inputMode="numeric" placeholder="Menge" title="Wie viel da ist (optional)" style={{ width: 70, marginTop: 4, display: "block" }} aria-label="Menge" />
                      <input className="input input-compact num" type="date" name={`mhd_${item.id}`} defaultValue={item.bestBefore ?? ""} title="Mindesthaltbarkeitsdatum – steht im Aushang, nicht auf der Collage" style={{ width: 150, marginTop: 4, display: "block" }} aria-label="MHD" />
                      <MhdPhoto itemId={item.id} fileId={item.bestBeforeFileId} action={uploadMhdPhoto.bind(null, item.id)} />
                    </td>
                    <td className="small" style={{ whiteSpace: "nowrap" }}>
                      <label style={{ display: "block" }}><input type="checkbox" name={`col_${item.id}`} defaultChecked={item.inCollage} aria-label="Auf der Collage" /> Collage</label>
                      <label style={{ display: "block", marginTop: 6 }}><input type="checkbox" name={`fly_${item.id}`} defaultChecked={item.inFlyer} aria-label="Im Aushang" /> Aushang</label>
                    </td>
                    <td>
                      <div style={{ display: "grid", gridTemplateColumns: "auto", gap: 3 }}>
                      <button className="btn btn-small" type="submit" name="op" value={`up:${item.id}`} disabled={i === 0} aria-label="Nach oben">↑</button>
                      <button className="btn btn-small" type="submit" name="op" value={`down:${item.id}`} disabled={i === rows.length - 1} aria-label="Nach unten">↓</button>
                      <button className="btn btn-small" type="submit" name="op" value={`remove:${item.id}`} aria-label="Aus dieser Verteilung entfernen" title="Aus dieser Verteilung entfernen (bleibt in der Datenbank)">✕</button>
                      </div>
                    </td>
                  </tr>
                ); })}
              </tbody>
            </table>
            {rows.length > 0 && <div style={{ padding: "10px 14px", display: "flex", justifyContent: "flex-end" }}><button className="btn btn-primary" type="submit" name="op" value="save">Speichern</button></div>}
          </form>

          <section className="card card-pad stack">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <h2>Text für WhatsApp / Signal / Telegram</h2>
              <CopyButton text={text} label="Text kopieren" />
            </div>
            <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "var(--sans)", maxHeight: 260, overflow: "auto", background: "var(--surface-2)", padding: 12, borderRadius: 8 }}>{text}</pre>
          </section>
        </div>

        <aside className="col-side">
          <AutoRefresh active={busy} />
          {ai ? (
            <form action={researchEvent} className="card card-pad stack" style={{ gap: 8 }}>
              <input type="hidden" name="eventId" value={id} />
              <h2>KI: erkennen & Preise suchen</h2>
              <div className="small muted">Die KI erkennt die Produkte auf den Fotos, trägt fehlende Namen ein und sucht auf Wunsch den günstigsten Preis im deutschen Handel. Läuft im Hintergrund.</div>
              <AiModeSelect />
              <div className="small muted">Produkte mit einem Ergebnis aus den letzten 60 Tagen werden übersprungen – wiederkehrende Produkte kosten nur einmal.{aiCost > 0 ? ` Bisher für diese Produkte: ca. ${usd(aiCost)}.` : ""}</div>
              {busy && <div className="notice notice-info">KI sucht gerade … die Seite aktualisiert sich von selbst.</div>}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="btn btn-primary" type="submit" name="umfang" value="fehlend" disabled={busy}>Nur fehlende</button>
                <button className="btn" type="submit" name="umfang" value="alle" disabled={busy}>Alle</button>
              </div>
            </form>
          ) : (
            <div className="card card-pad small muted">KI-Preisrecherche ist aus – dafür auf dem Server <code>ANTHROPIC_API_KEY</code> setzen (siehe README).</div>
          )}
          <PhotoUpload eventId={id} action={uploadPhotos} variant="card" categories={categories} ai={ai} />
          {ai && rows.length > 0 && (
            <form action={scanEventPhotoPrices.bind(null, id)} className="card card-pad stack" style={{ gap: 8 }}>
              <h2>Preise aus alten Fotos</h2>
              <div className="small muted">Für Fotos, auf denen der Preis schon steht (z. B. aus früheren Collagen): Die KI liest ihn ab und trägt ihn ein, wo noch keiner steht. Collage und Social Media drucken dann keinen zweiten Preis darüber – bei geändertem Preis wird der alte überdeckt. Kostet ca. 0,2 Cent pro Foto.</div>
              {reading > 0 && <div className="notice notice-info">{reading} Foto(s) werden gelesen …</div>}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="btn" type="submit" name="umfang" value="neu" disabled={reading > 0 || unread === 0}>{unread ? `${unread} ungelesene Fotos` : "Alle Fotos gelesen"}</button>
                <button className="btn btn-small" type="submit" name="umfang" value="alle" disabled={reading > 0}>Alle neu lesen</button>
              </div>
            </form>
          )}

          <form action={addToEvent} className="card card-pad stack" style={{ gap: 8 }}>
            <input type="hidden" name="eventId" value={id} />
            <h2>Aus der Datenbank</h2>
            <div style={{ display: "flex", gap: 6 }}>
              <input className="input" name="q" defaultValue={q} placeholder="Suchen …" aria-label="Produkte suchen" />
              {filter && <input type="hidden" name="zeige" value={filter.key} />}
              {kat && <input type="hidden" name="kat" value={kat} />}
              <button className="btn" type="submit" formAction={`/verteilung/${id}`} formMethod="get">Suchen</button>
            </div>
            <div style={{ maxHeight: 420, overflow: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
              {picker.length === 0 && <div className="small muted">{q ? "Nichts gefunden." : "Alle Produkte sind schon dabei – oder es gibt noch keine."}</div>}
              {picker.map(({ p, lastUsed, times }) => (
                <label key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: 4, borderRadius: 6, cursor: "pointer" }}>
                  <input type="checkbox" name="productId" value={p.id} />
                  {p.imageFileId ? <img src={`/datei/${p.imageFileId}`} alt="" style={{ ...thumb, width: 36, height: 36 }} loading="lazy" /> : <span style={{ ...thumb, width: 36, height: 36 }} />}
                  <span style={{ minWidth: 0, flexGrow: 1 }}>
                    <span style={{ display: "block", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}{p.variant ? ` · ${p.variant}` : ""}</span>
                    <span className="small muted">{p.category}{times ? ` · ${times}× dabei, zuletzt ${formatDate(lastUsed)}` : " · neu"}</span>
                  </span>
                  <span className="num small">{p.price !== null ? formatEuro(p.price) : ""}</span>
                </label>
              ))}
            </div>
            {picker.length > 0 && <button className="btn btn-primary" type="submit">Ausgewählte hinzufügen</button>}
          </form>

          <ImageForm action={createProduct} className="card card-pad stack" style={{ gap: 8 }}>
            <input type="hidden" name="eventId" value={id} />
            <h2>Einzelnes Produkt neu</h2>
            <div className="field"><label className="label" htmlFor="nn">Name</label><input className="input" id="nn" name="name" required placeholder="z. B. Getrocknete Tomaten" /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 8 }}>
              <div className="field"><label className="label" htmlFor="nv">Variante</label><input className="input" id="nv" name="variant" placeholder="z. B. 5kg" /></div>
              <div className="field"><label className="label" htmlFor="np">Preis €</label><input className="input" id="np" name="price" inputMode="decimal" placeholder="0,50" /></div>
            </div>
            <div className="field"><label className="label" htmlFor="nc">Kategorie</label><CategorySelect id="nc" name="category" value="Lebensmittel" categories={categories} /></div>
            <input className="input" name="image" type="file" accept="image/*" aria-label="Foto" />
            <button className="btn btn-primary" type="submit">Anlegen und hinzufügen</button>
          </ImageForm>

          <form action={updateEvent} className="card card-pad stack" style={{ gap: 8 }}>
            <input type="hidden" name="eventId" value={id} />
            <h2>Eckdaten</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div className="field"><label className="label" htmlFor="ed">Datum</label><input className="input" id="ed" name="eventDate" type="date" required defaultValue={event.eventDate} /></div>
              <div className="field"><label className="label" htmlFor="et">Uhrzeit</label><input className="input" id="et" name="eventTime" defaultValue={event.eventTime ?? ""} placeholder="11 Uhr" /></div>
            </div>
            <div className="field"><label className="label" htmlFor="ti">Überschrift</label><input className="input" id="ti" name="title" defaultValue={event.title} /></div>
            <div className="field"><label className="label" htmlFor="st">Unterzeile</label><input className="input" id="st" name="subtitle" defaultValue={event.subtitle ?? ""} /></div>
            <div className="field"><label className="label" htmlFor="lo">Ort</label><input className="input" id="lo" name="location" defaultValue={event.location ?? ""} /></div>
            <div className="field"><label className="label" htmlFor="no">Interne Notiz</label><textarea className="input" id="no" name="note" rows={3} defaultValue={event.note ?? ""} /></div>
            <button className="btn" type="submit">Speichern</button>
          </form>

          <details className="small">
            <summary className="muted" style={{ cursor: "pointer" }}>Verteilung löschen …</summary>
            <form action={deleteEvent} style={{ marginTop: 6 }}>
              <input type="hidden" name="eventId" value={id} />
              <button className="btn btn-small" type="submit" style={{ color: "var(--danger)" }}>Endgültig löschen</button>
              <span className="muted"> Die Produkte bleiben in der Datenbank.</span>
            </form>
          </details>
        </aside>
      </div>
    </>
  );
}
