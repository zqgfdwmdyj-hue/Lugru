import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { CopyButton } from "@/components/copy-button";
import { eventDateLabel, flyerSections, messengerText } from "@/lib/donations/layout";
import { knownCategories, loadEvent, loadEventItems, productPicker } from "@/lib/donations/service";
import { formatDate, formatEuro } from "@/lib/numbers";
import { addToEvent, createProduct, deleteEvent, saveItems, updateEvent, uploadPhotos } from "../actions";
import { ImageForm } from "../image-form";

const thumb: React.CSSProperties = { width: 52, height: 52, objectFit: "cover", borderRadius: 6, background: "var(--row)", display: "block" };
const priceText = (v: number | null) => (v === null ? "" : v.toFixed(2).replace(".", ","));

export default async function SpendenAktionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const session = await requireSession();
  const t = session.tenantId;
  const { id } = await params;
  const q = ((await searchParams).q ?? "").trim().slice(0, 80);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const event = await loadEvent(t, id);
  if (!event) notFound();
  const [rows, picker, categories] = await Promise.all([loadEventItems(t, id), productPicker(t, id, q), knownCategories(t)]);

  const sections = flyerSections(rows.filter((r) => r.item.inFlyer).map((r) => ({ ...r.product, price: r.item.price, priceNote: r.item.priceNote })));
  const text = messengerText({ ...event, dateLabel: eventDateLabel(event.eventDate) }, sections);
  const missingPrice = rows.filter((r) => r.item.price === null).length;
  const missingImage = rows.filter((r) => r.item.inCollage && !r.product.imageFileId).length;
  const unnamed = rows.filter((r) => r.product.name === "Neues Produkt").length;
  const value = rows.reduce((s, r) => s + (r.item.price ?? 0) * (r.item.quantity ?? 0), 0);

  return (
    <>
      <datalist id="spenden-kategorien">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <div className="crumb"><Link href="/spenden">Verteilungen</Link></div>
      <div className="page-head">
        <div>
          <h1>{eventDateLabel(event.eventDate)}{event.eventTime ? ` · ${event.eventTime}` : ""}</h1>
          <div className="small muted">{event.title} · {rows.length} Produkte{value ? ` · Warenwert ${formatEuro(value)}` : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href={`/spenden/${id}/collage`} className="btn btn-primary">Collage erstellen</Link>
          <Link href={`/aushang/${id}`} className="btn" target="_blank">Aushang drucken</Link>
        </div>
      </div>

      {(missingPrice > 0 || missingImage > 0 || unnamed > 0) && (
        <div className="notice notice-warn">
          {[unnamed && `${unnamed} Produkt(e) noch ohne Namen`, missingPrice && `${missingPrice} ohne Preis`, missingImage && `${missingImage} ohne Foto (erscheinen auf der Collage als Textkachel)`].filter(Boolean).join(" · ")}
        </div>
      )}

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
            <table className="table spenden-items">
              <thead>
                <tr><th></th><th>Produkt</th><th>Preis €</th><th>Text · Menge</th><th title="Auf Collage / im Aushang">Zeigen</th><th></th></tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={6} className="muted">Noch keine Produkte. Rechts Fotos hochladen oder aus der Datenbank übernehmen.</td></tr>}
                {rows.map(({ item, product }, i) => (
                  <tr key={item.id}>
                    <td>
                      <Link href={`/spenden/produkte/${product.id}?zurueck=${id}`} title="Produkt bearbeiten / Foto ändern">
                        {product.imageFileId ? <img src={`/datei/${product.imageFileId}`} alt="" style={thumb} loading="lazy" /> : <span style={{ ...thumb, display: "grid", placeItems: "center", fontSize: 11, color: "var(--muted)" }}>kein Foto</span>}
                      </Link>
                    </td>
                    <td style={{ minWidth: 150 }}>
                      <input className="input input-compact" name={`name_${product.id}`} defaultValue={product.name === "Neues Produkt" ? "" : product.name} placeholder="Name eintragen" aria-label="Name" />
                      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                        <input className="input input-compact" name={`variant_${product.id}`} defaultValue={product.variant ?? ""} placeholder="Variante (z. B. 5kg)" aria-label="Variante" />
                        <input className="input input-compact" name={`cat_${product.id}`} defaultValue={product.category} list="spenden-kategorien" aria-label="Kategorie" />
                      </div>
                    </td>
                    <td>
                      <input className="input input-compact num" name={`price_${item.id}`} defaultValue={priceText(item.price)} inputMode="decimal" style={{ width: 80 }} placeholder="Preis" aria-label="Preis" />
                      <input className="input input-compact" name={`note_${item.id}`} defaultValue={item.priceNote ?? ""} placeholder="z. B. je" title="Steht vor dem Preis, z. B. „je“ oder „3er Packung“" style={{ width: 80, marginTop: 4, display: "block" }} aria-label="Zusatz vor dem Preis" />
                    </td>
                    <td>
                      <input className="input input-compact" name={`caption_${item.id}`} defaultValue={item.caption ?? ""} placeholder="Text auf dem Bild" style={{ width: 130 }} aria-label="Collage-Text" />
                      <input className="input input-compact num" name={`qty_${item.id}`} defaultValue={item.quantity ?? ""} inputMode="numeric" placeholder="Menge" title="Wie viel da ist (optional)" style={{ width: 70, marginTop: 4, display: "block" }} aria-label="Menge" />
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
                ))}
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
          <ImageForm action={uploadPhotos} className="card card-pad stack" style={{ gap: 8 }}>
            <input type="hidden" name="eventId" value={id} />
            <h2>Fotos hochladen</h2>
            <div className="small muted">Mehrere Fotos auf einmal – jedes wird ein neues Produkt in dieser Verteilung. Namen und Preise danach links eintragen.</div>
            <input className="input" name="photos" type="file" accept="image/*" multiple required aria-label="Fotos" />
            <div className="field"><label className="label" htmlFor="pc">Kategorie</label><input className="input" id="pc" name="category" list="spenden-kategorien" defaultValue="Lebensmittel" /></div>
            <button className="btn btn-primary" type="submit">Hochladen</button>
          </ImageForm>

          <form action={addToEvent} className="card card-pad stack" style={{ gap: 8 }}>
            <input type="hidden" name="eventId" value={id} />
            <h2>Aus der Datenbank</h2>
            <div style={{ display: "flex", gap: 6 }}>
              <input className="input" name="q" defaultValue={q} placeholder="Suchen …" aria-label="Produkte suchen" />
              <button className="btn" type="submit" formAction={`/spenden/${id}`} formMethod="get">Suchen</button>
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
            <div className="field"><label className="label" htmlFor="nc">Kategorie</label><input className="input" id="nc" name="category" list="spenden-kategorien" defaultValue="Lebensmittel" /></div>
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
