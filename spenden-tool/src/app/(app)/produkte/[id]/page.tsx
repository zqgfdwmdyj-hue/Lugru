import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireLogin } from "@/lib/auth";
import { isPlaceholderName, mhdLabel } from "@/lib/layout";
import { amountFromVariant, guessUnit, isDrink, mhdAuto, PACK_KINDS, packOffers, packText, STOCK_LABELS, unitLabel, UNITS } from "@/lib/price-logic";
import { outputPrice } from "@/lib/layout";
import { extraPhotos, knownCategories, latestPriceChecks, productHistory, productsWithSamePhoto } from "@/lib/service";
import { aiConfigured } from "@/lib/price-research";
import { AutoRefresh } from "@/components/auto-refresh";
import { AiModeSelect, PriceCheckBox } from "@/components/price-check";
import { formatDate, formatEuro } from "@/lib/numbers";
import { changeExtraPhoto, saveProductDefaults, deleteProduct, mergeProducts, researchProduct, updateProduct } from "@/app/(app)/actions";
import { ImageForm } from "@/components/image-form";
import { PriceLinks } from "@/components/price-links";
import { CategorySelect } from "@/components/category-select";
import { AddPhotos } from "@/components/add-photos";
import { RotateButtons } from "@/components/rotate-buttons";

export default async function SpendenProduktPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ zurueck?: string; neu?: string }> }) {
  await requireLogin();
  const { id } = await params;
  const sp = await searchParams;
  const zurueck = sp.zurueck ?? "";
  const isNew = sp.neu === "1";
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const P = schema.products;
  const [product] = await db.select().from(P).where(eq(P.id, id));
  if (!product) notFound();
  const [history, categories, twins, checks, extra] = await Promise.all([
    productHistory(id),
    knownCategories(),
    db
      .select({ id: P.id, name: P.name, variant: P.variant, imageFileId: P.imageFileId })
      .from(P)
      .where(and(ne(P.id, id), sql`lower(${P.name}) = lower(${product.name})`, sql`coalesce(lower(${P.variant}), '') = coalesce(lower(${product.variant}), '')`)),
    latestPriceChecks([id]),
    extraPhotos([id]),
  ]);
  const backs = extra.get(id) ?? [];
  const lastMhd = history.find((h) => h.bestBefore);
  // „Für Verteilungen“: Vorlage am Produkt, sonst die kommende bzw. letzte Verteilung mit diesem Produkt.
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const items = await db
    .select({ item: schema.eventItems, eventDate: schema.events.eventDate })
    .from(schema.eventItems)
    .innerJoin(schema.events, eq(schema.events.id, schema.eventItems.eventId))
    .where(eq(schema.eventItems.productId, id))
    .orderBy(desc(schema.events.eventDate));
  const upcoming = items.filter((x) => x.eventDate >= today).reverse().map((x) => ({ ...x.item, eventDate: x.eventDate }));
  const from = upcoming[0] ?? items[0]?.item ?? null;
  const base = product.itemDefaults ?? {
    unit: from?.unit ?? null,
    unitCount: from?.unitCount ?? null,
    priceNote: from?.priceNote ?? null,
    caption: from?.caption ?? null,
    packKind: from?.packKind ?? null,
    packCount: from?.packCount ?? null,
    packPrice: from?.packPrice ?? null,
    packNote: from?.packNote ?? null,
    morePacks: from?.morePacks ?? [],
    inCollage: from?.inCollage ?? true,
    inFlyer: from?.inFlyer ?? true,
  };
  const drink = isDrink(product);
  const unitGuess = guessUnit(base.priceNote, product.variant, drink);
  // Dazu Produkte mit (fast) demselben Foto, auch wenn sie anders heißen.
  const samePhoto = await productsWithSamePhoto(id);
  const known = new Set(twins.map((t) => t.id));
  const photoTwins = samePhoto.filter((s) => !known.has(s.productId));
  if (photoTwins.length) {
    const more = await db.select({ id: P.id, name: P.name, variant: P.variant, imageFileId: P.imageFileId }).from(P).where(inArray(P.id, photoTwins.map((s) => s.productId)));
    twins.push(...more);
  }
  const photoNote = new Map(samePhoto.map((s) => [s.productId, s.match === "gleich" ? "gleiches Foto" : "ähnliches Foto"]));
  const check = checks.get(id);
  const busy = check?.status === "pending" || check?.status === "running";
  const back = /^[0-9a-f-]{36}$/i.test(zurueck) ? `/verteilung/${zurueck}` : "";

  return (
    <>
      <datalist id="spenden-kategorien">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <div className="crumb">{back ? <Link href={back}>Zurück zur Verteilung</Link> : <Link href="/produkte">Produkte</Link>}</div>
      <div className="page-head"><div><h1>{product.name}{product.variant ? ` · ${product.variant}` : ""}</h1><div className="small muted">{product.category}{lastMhd ? ` · ${mhdLabel(lastMhd.bestBefore)}` : ""}{product.archived ? " · archiviert" : ""}</div></div></div>
      {isNew && (
        <div className="notice notice-ok">
          Neu angelegt – bitte kurz kontrollieren.{busy ? " Die KI erkennt das Produkt gerade und füllt Name, Größe und Kategorie aus (die Seite aktualisiert sich)." : ""}
        </div>
      )}
      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }} className="stack">
          <section className="card card-pad" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {product.imageFileId
              ? <div><a href={`/datei/${product.imageFileId}`} target="_blank"><img src={`/datei/${product.imageFileId}`} alt={product.name} style={{ maxWidth: 320, maxHeight: 320, borderRadius: 8, display: "block" }} /></a><div style={{ marginTop: 6 }}><RotateButtons productId={product.id} /></div></div>
              : <div className="muted" style={{ width: 240, height: 180, display: "grid", placeItems: "center", background: "var(--row)", borderRadius: 8 }}>noch kein Foto</div>}
            <div><AddPhotos productId={product.id} label="📷 Weitere Fotos (Rückseite, Zutaten …)" /></div>
            {backs.length > 0 && (
              <form className="stack" style={{ gap: 6 }}>
                <div className="label">Rückseite / Infofotos</div>
                <div className="small muted" style={{ maxWidth: 220 }}>Nur zur Information (Zutaten, Gewicht, MHD) – erscheinen nicht auf Collage oder Social Media.</div>
                {backs.map((f) => (
                  <div key={f} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <a href={`/datei/${f}`} target="_blank" rel="noreferrer"><img src={`/datei/${f}?w=200`} alt="Rückseite" style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 6 }} /></a>
                    <span className="stack" style={{ gap: 4 }}>
                      <button className="btn btn-small" formAction={changeExtraPhoto.bind(null, product.id, f, "hauptfoto")}>Als Hauptfoto</button>
                      <button className="btn btn-small btn-danger-link" formAction={changeExtraPhoto.bind(null, product.id, f, "entfernen")}>Entfernen</button>
                    </span>
                  </div>
                ))}
              </form>
            )}
            <div className="stack" style={{ flex: "1 1 260px", gap: 8 }}>
              <h2>Preis im Internet</h2>
              {!isPlaceholderName(product.name) && <div className="small">Kostenlos selbst nachschauen: <PriceLinks name={product.name} variant={product.variant} small={false} /></div>}
              <AutoRefresh active={busy} />
              {!aiConfigured() ? (
                <div className="small muted">Für die KI-Preisrecherche muss auf dem Server ANTHROPIC_API_KEY gesetzt sein (siehe README).</div>
              ) : (
                <>
                  <div className="small muted">Die KI erkennt das Produkt auf dem Foto und sucht den günstigsten aktuellen Preis bei deutschen Händlern.</div>
                  <form action={researchProduct} className="stack" style={{ gap: 6 }}>
                    <input type="hidden" name="productId" value={id} />
                    <AiModeSelect compact />
                    <button className="btn btn-small" type="submit" disabled={busy}>{check ? "Neu recherchieren" : "Preis recherchieren"}</button>
                  </form>
                </>
              )}
              {check && <PriceCheckBox check={check} eventId={/^[0-9a-f-]{36}$/i.test(zurueck) ? zurueck : undefined} unnamed={isPlaceholderName(product.name)} />}
            </div>
          </section>
          <form action={saveProductDefaults} className="card product-defaults">
            <input type="hidden" name="productId" value={id} />
            <div className="card-head">
              <h2>Für Verteilungen</h2>
              <span className="small muted">{upcoming.length ? `gilt sofort für ${upcoming.length} kommende Verteilung${upcoming.length === 1 ? "" : "en"} (${upcoming.map((u) => formatDate(u.eventDate)).join(", ")}) und als Vorlage` : "Vorlage für die nächste Verteilung mit diesem Produkt"}</span>
            </div>
            <div className="pd-grid">
              <fieldset>
                <legend>Spendenempfehlung</legend>
                <div className="form-grid">
                  <div className="field">
                    <label className="label" htmlFor="pd-unit">Abgabeeinheit</label>
                    <select className="select" id="pd-unit" name="unit" defaultValue={base.unit ?? ""}>
                      <option value="">nicht angegeben</option>
                      {Object.entries(UNITS).map(([key, u]) => <option key={key} value={key}>{u.label}</option>)}
                    </select>
                    {!base.unit && unitGuess && <span className="small muted">Vorschlag: {unitLabel(unitGuess.unit, unitGuess.count)}</span>}
                  </div>
                  <div className="field"><label className="label" htmlFor="pd-count">{drink ? "Flaschen / Stück darin" : "Stück je Einheit"}</label><input className="input" id="pd-count" name="unitCount" defaultValue={base.unitCount ?? ""} inputMode="numeric" placeholder={drink ? "z. B. 20" : "z. B. 6"} /></div>
                </div>
                <div className="field"><label className="label" htmlFor="pd-amount">Inhalt / Menge (optional)</label><input className="input" id="pd-amount" name="amount" defaultValue={product.amount ?? ""} placeholder={amountFromVariant(product.variant) ? `z. B. ${amountFromVariant(product.variant)}` : drink ? "z. B. 0,5 l" : "z. B. 1,5 kg"} /></div>
                <div className="field"><label className="label" htmlFor="pd-note">Eigener Text vor dem Preis (optional)</label><input className="input" id="pd-note" name="priceNote" defaultValue={base.priceNote ?? ""} placeholder="z. B. je, 3 Stück" /></div>
              </fieldset>
              <fieldset>
                <legend>Varianten (je eigene Empfehlung)</legend>
                {[{ kind: base.packKind, count: base.packCount, price: base.packPrice, note: base.packNote }, ...base.morePacks, ...(base.packKind || base.packPrice != null ? [{ kind: null, count: null, price: null, note: null }] : [])].slice(0, 6).map((m, n) => {
                  const pre = n === 0 ? { k: "packKind", c: "packCount", p: "packPrice", t: "packNote" } : { k: `mp${n - 1}k`, c: `mp${n - 1}c`, p: `mp${n - 1}p`, t: `mp${n - 1}n` };
                  return (
                    <div key={n} className={n ? "more-pack" : undefined}>
                      <div className="form-grid">
                        <div className="field">
                          <label className="label" htmlFor={`pd-${pre.k}`}>{n === 0 ? "Art" : `Variante ${n + 1}`}</label>
                          <select className="select" id={`pd-${pre.k}`} name={pre.k} defaultValue={m.kind ?? ""}>
                            <option value="">–</option>
                            {Object.entries(PACK_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                          </select>
                        </div>
                        <div className="field"><label className="label" htmlFor={`pd-${pre.c}`}>{drink ? "Flaschen darin" : "Stück darin"}</label><input className="input" id={`pd-${pre.c}`} name={pre.c} defaultValue={m.count ?? ""} inputMode="numeric" /></div>
                        <div className="field"><label className="label" htmlFor={`pd-${pre.p}`}>Empfehlung €</label><input className="input" id={`pd-${pre.p}`} name={pre.p} defaultValue={m.price != null ? m.price.toFixed(2).replace(".", ",") : ""} inputMode="decimal" /></div>
                      </div>
                      <div className="field"><label className="label" htmlFor={`pd-${pre.t}`}>Eigene Bezeichnung (optional)</label><input className="input" id={`pd-${pre.t}`} name={pre.t} defaultValue={m.note ?? ""} placeholder={packText({ packKind: m.kind, packCount: m.count }, drink, product.variant)} /></div>
                    </div>
                  );
                })}
                <span className="small muted">Nach dem Speichern erscheint eine leere Zeile für die nächste Variante. Alle Felder einer Variante leeren = entfernen.</span>
              </fieldset>
              <fieldset>
                <legend>Ausgabe & Bestand</legend>
                <label className="check"><input type="checkbox" name="inCollage" defaultChecked={base.inCollage} /> Auf der Collage / Social Media</label>
                <label className="check"><input type="checkbox" name="inFlyer" defaultChecked={base.inFlyer} /> Im Aushang / Messenger-Text</label>
                <div className="field"><label className="label" htmlFor="pd-caption">Text auf dem Bild</label><input className="input" id="pd-caption" name="caption" defaultValue={base.caption ?? ""} placeholder="z. B. vegan, nur heute" /></div>
                {upcoming.length > 0 && (
                  <>
                    <div className="field">
                      <label className="label" htmlFor="pd-stock">Bestand (ca.) – kommende Verteilung</label>
                      <select className="select" id="pd-stock" name="stock" defaultValue="">
                        <option value="">{upcoming[0].stock ? `unverändert (${STOCK_LABELS[upcoming[0].stock]})` : "unverändert"}</option>
                        {Object.entries(STOCK_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                        <option value="leer">leeren</option>
                      </select>
                    </div>
                    <div className="field">
                      <label className="label" htmlFor="pd-mhd">MHD-Datum – kommende Verteilung{mhdAuto(product).relevant ? "" : " (nicht nötig)"}</label>
                      <input className="input" type="date" id="pd-mhd" name="mhd" defaultValue={upcoming[0].bestBefore ?? ""} />
                    </div>
                  </>
                )}
              </fieldset>
            </div>
            <div className="output-preview" style={{ margin: "0 14px" }}>
              <span className="small muted">So steht es in Collage, Aushang und Messenger:</span>
              <strong>{[outputPrice({ price: upcoming[0]?.price ?? product.price, priceNote: base.priceNote, unit: base.unit, unitCount: base.unitCount, amount: product.amount }) || "kein Preis", ...packOffers(base, drink, product.variant).map((pk) => `${pk.label} ${pk.price.toFixed(2).replace(".", ",")} €`)].join(" · ")}</strong>
            </div>
            <div className="card-pad"><button className="btn btn-primary" type="submit">Für Verteilungen speichern</button></div>
          </form>
          <section className="card" style={{ overflow: "auto" }}>
            <div className="card-head"><h2>Verlauf</h2><span className="small muted">{history.length}× verteilt</span></div>
            <table className="table">
              <thead><tr><th>Datum</th><th>Verteilung</th><th className="right">Preis</th><th className="right">Menge</th><th>MHD</th></tr></thead>
              <tbody>
                {history.length === 0 && <tr><td colSpan={5} className="muted">Noch in keiner Verteilung.</td></tr>}
                {history.map((h) => (
                  <tr key={h.eventId}>
                    <td className="num">{formatDate(h.eventDate)}</td>
                    <td><Link href={`/verteilung/${h.eventId}`}>{h.title}</Link></td>
                    <td className="num right">{h.priceNote ? `${h.priceNote} ` : ""}{formatEuro(h.price)}</td>
                    <td className="num right">{h.quantity ?? "–"}</td>
                    <td className="num">{formatDate(h.bestBefore)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          {twins.length > 0 && (
            <form action={mergeProducts} className="card card-pad stack" style={{ gap: 8 }}>
              <input type="hidden" name="productId" value={id} />
              <h2>Doppelt angelegt?</h2>
              <div className="small muted">Diese Produkte heißen genauso oder haben (fast) dasselbe Foto. Zusammenführen übernimmt deren Verlauf in dieses Produkt und löscht die Doppelten. Nur anhaken, was wirklich dasselbe Produkt ist.</div>
              {twins.map((w) => (
                <label key={w.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="checkbox" name="mergeId" value={w.id} defaultChecked={photoNote.get(w.id) !== "ähnliches Foto"} />
                  {w.imageFileId && <img src={`/datei/${w.imageFileId}?w=200`} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4 }} />}
                  <Link href={`/produkte/${w.id}`}>{w.name}{w.variant ? ` · ${w.variant}` : ""}</Link>
                  {photoNote.has(w.id) && <span className="small muted">{photoNote.get(w.id)}</span>}
                </label>
              ))}
              <div><button className="btn" type="submit">Zusammenführen</button></div>
            </form>
          )}
        </div>
        <aside className="col-side">
          <ImageForm action={updateProduct} className="card card-pad stack" style={{ gap: 8 }} busyLabel="Speichere …" reset={false}>
            <input type="hidden" name="productId" value={id} />
            <input type="hidden" name="back" value={back} />
            <h2>Bearbeiten</h2>
            <div className="field"><label className="label" htmlFor="nn">Name</label><input className="input" id="nn" name="name" required defaultValue={product.name} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 8 }}>
              <div className="field"><label className="label" htmlFor="nv">Variante</label><input className="input" id="nv" name="variant" defaultValue={product.variant ?? ""} /></div>
              <div className="field"><label className="label" htmlFor="np">Preis €</label><input className="input" id="np" name="price" inputMode="decimal" defaultValue={product.price !== null ? product.price.toFixed(2).replace(".", ",") : ""} /></div>
            </div>
            {product.reviewNote && <div className="notice notice-info small">🤖 {product.reviewNote}. Mit „Speichern“ gelten die Angaben als geprüft.</div>}
            <div className="field"><label className="label" htmlFor="nc">Kategorie</label><CategorySelect id="nc" name="category" value={product.category} categories={categories} /></div>
            <div className="field">
              <label className="label" htmlFor="nm">MHD nötig?</label>
              <select className="select" id="nm" name="mhdMode" defaultValue={product.mhdMode ?? ""}>
                <option value="">Automatisch (nach Kategorie)</option>
                <option value="ja">Ja, MHD erfassen</option>
                <option value="nein">Nein (z. B. Spielzeug, Haushalt)</option>
              </select>
              <span className="small muted">
                {lastMhd ? <>Zuletzt: <strong>{mhdLabel(lastMhd.bestBefore)}</strong> (Verteilung {formatDate(lastMhd.eventDate)}). </> : null}
                Das Datum gilt je Lieferung – eintragen in der Verteilung unter „Details bearbeiten“ → MHD-Datum, oder automatisch vom Foto der Rückseite.
              </span>
            </div>
            <div className="field"><label className="label" htmlFor="nt">Notiz</label><textarea className="input" id="nt" name="note" rows={2} defaultValue={product.note ?? ""} /></div>
            <div className="field"><label className="label" htmlFor="ni">{product.imageFileId ? "Foto ersetzen" : "Foto"}</label><input className="input" id="ni" name="image" type="file" accept="image/*" /></div>
            {product.imageFileId && <label className="small"><input type="checkbox" name="removeImage" /> Foto entfernen</label>}
            <label className="small"><input type="checkbox" name="archived" defaultChecked={product.archived} /> Archiviert (wird bei der Auswahl nicht mehr angeboten)</label>
            <button className="btn btn-primary" type="submit">Speichern</button>
          </ImageForm>
          <details className="small">
            <summary className="muted" style={{ cursor: "pointer" }}>Produkt löschen …</summary>
            <form action={deleteProduct} style={{ marginTop: 6 }}>
              <input type="hidden" name="productId" value={id} />
              <button className="btn btn-small" type="submit" style={{ color: "var(--danger)" }}>Löschen</button>
              <span className="muted"> War es schon in einer Verteilung, wird es nur archiviert.</span>
            </form>
          </details>
        </aside>
      </div>
    </>
  );
}
