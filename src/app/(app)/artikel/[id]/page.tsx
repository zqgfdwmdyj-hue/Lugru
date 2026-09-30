import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { brandAllowed, canAccess } from "@/lib/auth/areas";
import { requireArea } from "@/lib/auth/session";
import { checklist } from "@/lib/articles/logic";
import { articleImages, toData } from "@/lib/articles/service";
import { calcProfit } from "@/lib/brands/market";
import { getIntegration } from "@/lib/integrations/store";
import { formatEuro } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { deleteArticleAction, imageAction } from "../actions";
import { AiTextsButton, AmazonButtons, EbayButton, ImageUpload, OptionSearch, SaveForm } from "./forms";

const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <label className="field">
    <span className="label">{label}</span>
    {children}
    {hint && <span className="small muted">{hint}</span>}
  </label>
);
const grid = (cols: number) => ({ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 8 }) as const;
const fmt = (n: number | string | null | undefined) => (n === null || n === undefined || n === "" ? "" : String(Number(n)).replace(".", ","));

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireArea("artikel");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = session.tenantId;
  const [row] = await db.select({ a: schema.articles, brand: schema.brands }).from(schema.articles).leftJoin(schema.brands, eq(schema.brands.id, schema.articles.brandId)).where(and(eq(schema.articles.tenantId, t), eq(schema.articles.id, id)));
  if (!row) notFound();
  const { a, brand } = row;
  if (a.brandId && !brandAllowed(session.brandIds, session.role, a.brandId)) notFound();
  const [images, ai, amazonMain, amazonSecond, settings] = await Promise.all([articleImages(t, a.id), getIntegration(t, "anthropic"), getIntegration(t, "amazon_sp"), getIntegration(t, "amazon_sp_2"), getSettings(t)]);
  const d = toData(a);
  const checks = checklist(d, images.length);
  const lc = a.amazon.lastCheck;
  const ready = Boolean(lc && lc.mode === "pruefen" && !lc.issues.some((i) => i.severity === "ERROR"));
  const referralPct = d.vatRate === 7 && (d.price ?? 0) <= 10 ? 8 : 15;
  const calc = d.price ? calcProfit({ price: d.price, cost: d.costPrice, vatRate: d.vatRate, referralPct, fbaFee: settings.pricing.defaultFbaFee }, "fba") : null;
  const canEbay = canAccess(session, "ebay");

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/artikel">Artikelstamm</Link>{brand && <> · <Link href={`/artikel?marke=${brand.id}`}>{brand.name}</Link></>}{a.ideaId && <> · <Link href={`/marken/ideen/${a.ideaId}`}>zur Idee</Link></>}</div>
          <h1>{a.title}</h1>
          <div className="small muted num">{a.sku}{a.asin ? ` · ASIN ${a.asin}` : ""}{a.productId ? " · in der WaWi verknüpft" : ""}</div>
        </div>
        <a className="btn" href={`/artikel/${a.id}/export`}>Alles als ZIP</a>
      </div>

      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <SaveForm id={a.id}>
            <section className="card card-pad stack" style={{ gap: 10 }}>
              <h2>Stammdaten</h2>
              <Field label="Titel (Amazon max. 200, eBay kürzt auf 80)"><input className="input" name="title" defaultValue={a.title} maxLength={200} /></Field>
              <div style={grid(3)}>
                <Field label="SKU"><input className="input num" name="sku" defaultValue={a.sku} /></Field>
                <Field label="Status">
                  <select className="select" name="status" defaultValue={a.status}><option value="entwurf">Entwurf</option><option value="aktiv">Aktiv</option><option value="archiv">Archiv</option></select>
                </Field>
                <Field label="USt">
                  <select className="select" name="vatRate" defaultValue={String(Number(a.vatRate))}><option value="7">7 % (Lebensmittel)</option><option value="19">19 %</option><option value="0">0 %</option></select>
                </Field>
              </div>
              <div style={grid(3)}>
                <Field label="EAN / GTIN"><input className="input num" name="ean" defaultValue={a.ean ?? ""} /></Field>
                <Field label="ASIN (falls schon vorhanden)"><input className="input num" name="asin" defaultValue={a.asin ?? ""} /></Field>
                <label className="small" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 20 }}><input type="checkbox" name="gtinExempt" defaultChecked={a.gtinExempt} /> GTIN-Befreiung (Marke)</label>
              </div>
              <div style={grid(4)}>
                <Field label="VK brutto €"><input className="input num" name="price" defaultValue={fmt(a.price)} /></Field>
                <Field label="EK €"><input className="input num" name="costPrice" defaultValue={fmt(a.costPrice)} /></Field>
                <Field label="Gewicht g"><input className="input num" name="weightGrams" defaultValue={a.weightGrams ?? ""} /></Field>
                <Field label="L × B × H cm">
                  <div style={{ display: "flex", gap: 4 }}>
                    <input className="input num" name="lengthCm" defaultValue={fmt(a.lengthCm)} aria-label="Länge" />
                    <input className="input num" name="widthCm" defaultValue={fmt(a.widthCm)} aria-label="Breite" />
                    <input className="input num" name="heightCm" defaultValue={fmt(a.heightCm)} aria-label="Höhe" />
                  </div>
                </Field>
              </div>
              {calc && (
                <div className="small muted">
                  Amazon FBA grob: netto {formatEuro(calc.netPrice)} − Provision {referralPct} % {formatEuro(calc.referral)} − FBA ~{formatEuro(calc.fulfilment)} − EK {formatEuro(d.costPrice)} ={" "}
                  <strong style={{ color: calc.profit < 0 ? "var(--danger)" : "var(--ok)" }}>{formatEuro(calc.profit)}</strong> ({calc.margin.toLocaleString("de-DE")} %)
                </div>
              )}
            </section>

            <section className="card card-pad stack" style={{ gap: 10 }}>
              <h2>Listing-Texte</h2>
              {[1, 2, 3, 4, 5].map((n) => (
                <Field key={n} label={`Stichpunkt ${n}`}><input className="input" name={`bullet${n}`} defaultValue={a.bullets[n - 1] ?? ""} maxLength={500} /></Field>
              ))}
              <Field label="Beschreibung (Absätze mit Leerzeile)"><textarea className="textarea" name="description" defaultValue={a.description ?? ""} style={{ minHeight: 140 }} /></Field>
              <Field label="Suchbegriffe (Amazon Backend, max. 250 Zeichen)"><input className="input" name="keywords" defaultValue={a.keywords ?? ""} maxLength={500} /></Field>
              <div style={grid(2)}>
                <Field label="Inhalt / Stückliste (eine Zeile je Position)"><textarea className="textarea" name="contents" defaultValue={a.contents.join("\n")} style={{ minHeight: 110 }} /></Field>
                <Field label="Merkmale „Name: Wert“ (je Zeile, für eBay/Amazon)"><textarea className="textarea" name="attributes" defaultValue={Object.entries(a.attributes).map(([k, v]) => `${k}: ${v}`).join("\n")} placeholder={"Produktart: Süßigkeiten-Box\nGeschmacksrichtung: Sauer"} style={{ minHeight: 110 }} /></Field>
              </div>
            </section>

            <section className="card card-pad stack" style={{ gap: 10 }}>
              <h2>Lebensmittel-Angaben {d.vatRate === 7 && <span className="tag tag-warn">Pflicht</span>}</h2>
              <div style={grid(2)}>
                <Field label="Zutaten"><textarea className="textarea" name="food_ingredients" defaultValue={a.food.ingredients ?? ""} style={{ minHeight: 80 }} /></Field>
                <Field label="Allergene"><textarea className="textarea" name="food_allergens" defaultValue={a.food.allergens ?? ""} style={{ minHeight: 80 }} /></Field>
                <Field label="Nährwerte (je 100 g)"><textarea className="textarea" name="food_nutrition" defaultValue={a.food.nutrition ?? ""} style={{ minHeight: 80 }} /></Field>
                <div className="stack" style={{ gap: 8 }}>
                  <Field label="Füllmenge"><input className="input" name="food_netQuantity" defaultValue={a.food.netQuantity ?? ""} placeholder="z. B. 450 g" /></Field>
                  <Field label="Mindesthaltbarkeit / Hinweis"><input className="input" name="food_bestBefore" defaultValue={a.food.bestBefore ?? ""} /></Field>
                </div>
                <Field label="Aufbewahrung"><input className="input" name="food_storage" defaultValue={a.food.storage ?? ""} placeholder="kühl und trocken lagern" /></Field>
                <Field label="Ursprungsland (ISO, z. B. US)"><input className="input" name="food_countryOfOrigin" defaultValue={a.food.countryOfOrigin ?? ""} /></Field>
              </div>
            </section>

            <section className="card card-pad stack" style={{ gap: 10 }}>
              <h2>Hersteller / Verantwortlicher (GPSR)</h2>
              <div style={grid(2)}>
                <Field label="Firma"><input className="input" name="m_companyName" defaultValue={a.manufacturer.companyName ?? ""} /></Field>
                <Field label="Straße und Nr."><input className="input" name="m_addressLine1" defaultValue={a.manufacturer.addressLine1 ?? ""} /></Field>
              </div>
              <div style={grid(3)}>
                <Field label="PLZ"><input className="input" name="m_postalCode" defaultValue={a.manufacturer.postalCode ?? ""} /></Field>
                <Field label="Ort"><input className="input" name="m_city" defaultValue={a.manufacturer.city ?? ""} /></Field>
                <Field label="Land (ISO)"><input className="input" name="m_country" defaultValue={a.manufacturer.country ?? "DE"} /></Field>
              </div>
              <div style={grid(2)}>
                <Field label="E-Mail"><input className="input" name="m_email" defaultValue={a.manufacturer.email ?? ""} /></Field>
                <Field label="Telefon"><input className="input" name="m_phone" defaultValue={a.manufacturer.phone ?? ""} /></Field>
              </div>
              {brand && <div className="small muted">Vorlage für neue Artikel: Markenprofil → Hersteller-Angaben.</div>}
            </section>

            <section className="card card-pad stack" style={{ gap: 10 }}>
              <h2>Kanal-Einstellungen</h2>
              <div style={grid(4)}>
                <Field label="Amazon-Konto">
                  <select className="select" name="amazon_account" defaultValue={a.amazon.account ?? "haupt"}>
                    <option value="haupt">Hauptkonto{amazonMain?.clientId ? "" : " (nicht verbunden)"}</option>
                    <option value="zweit">Zweites Konto{amazonSecond?.clientId ? "" : " (nicht verbunden)"}</option>
                  </select>
                </Field>
                <Field label="Amazon-Produkttyp"><input className="input num" name="amazon_productType" defaultValue={a.amazon.productType ?? ""} placeholder="rechts suchen" /></Field>
                <Field label="Versand">
                  <select className="select" name="amazon_fulfillment" defaultValue={a.amazon.fulfillment ?? "FBA"}><option value="FBA">FBA</option><option value="FBM">selbst (FBM)</option></select>
                </Field>
                <Field label="Menge (nur FBM)"><input className="input num" name="amazon_quantity" defaultValue={a.amazon.quantity ?? 0} /></Field>
              </div>
              <div style={grid(2)}>
                <Field label="eBay-Kategorie-ID"><input className="input num" name="ebay_categoryId" defaultValue={a.ebay.categoryId ?? ""} placeholder="rechts suchen" /></Field>
                <Field label="eBay-Kategorie"><input className="input" name="ebay_categoryName" defaultValue={a.ebay.categoryName ?? ""} readOnly /></Field>
              </div>
              <details>
                <summary className="small" style={{ cursor: "pointer" }}>Zusätzliche Amazon-Attribute (JSON, für Sonderfälle)</summary>
                <textarea className="textarea" name="amazon_extra" defaultValue={a.amazon.extraAttributes ?? ""} placeholder='{"flavor":[{"value":"Sauer","language_tag":"de_DE","marketplace_id":"A1PA6795UKMFR9"}]}' style={{ minHeight: 100, fontFamily: "var(--mono)", fontSize: 12, marginTop: 6 }} />
              </details>
              <Field label="Notizen"><textarea className="textarea" name="notes" defaultValue={a.notes ?? ""} style={{ minHeight: 80 }} /></Field>
            </section>
          </SaveForm>
        </div>

        <aside className="col-side">
          <section className="card card-pad stack" style={{ gap: 8 }}>
            <h2>Bilder ({images.length})</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {images.map((img, n) => (
                <div key={img.id} style={{ border: n === 0 ? "2px solid var(--accent)" : "1px solid var(--border)", borderRadius: 8, padding: 4, background: "#fff" }}>
                  <a href={`/datei/${img.fileId}`} target="_blank" rel="noopener noreferrer"><img src={`/datei/${img.fileId}`} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "contain" }} /></a>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    {n === 0 ? <span className="small muted">Hauptbild</span> : (
                      <form action={imageAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="imageId" value={img.id} /><input type="hidden" name="op" value="main" /><button className="btn-link small" type="submit">als Hauptbild</button></form>
                    )}
                    <form action={imageAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="imageId" value={img.id} /><input type="hidden" name="op" value="delete" /><button className="btn-link small muted" type="submit" aria-label="Bild löschen">×</button></form>
                  </div>
                </div>
              ))}
            </div>
            <ImageUpload id={a.id} />
            <div className="small muted">Hauptbild: Produkt auf reinweißem Hintergrund, mind. 1000 px. Weitere: Inhalt, Größenvergleich, Anlass/Stimmung.</div>
          </section>

          <section className="card card-pad stack" style={{ gap: 6 }}>
            <h2>Vollständigkeit</h2>
            {(["amazon", "ebay"] as const).map((ch) => (
              <div key={ch} className="small">
                <strong>{ch === "amazon" ? "Amazon" : "eBay"}</strong> {checks[ch].every((c) => c.ok) ? <span className="tag tag-ok">bereit</span> : <span className="tag tag-warn">{checks[ch].filter((c) => !c.ok).length} offen</span>}
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {checks[ch].filter((c) => !c.ok).map((c) => <li key={c.text} style={{ color: "var(--danger)" }}>{c.text}</li>)}
                </ul>
              </div>
            ))}
          </section>

          <section className="card card-pad stack" style={{ gap: 8 }}>
            <h2>Texte</h2>
            <AiTextsButton id={a.id} hasAi={Boolean(ai?.apiKey)} />
            <div className="small muted">Überschreibt Titel, Stichpunkte, Beschreibung und Suchbegriffe – nutzt Inhalt, Konzept und TikTok-Bestseller der Marke.</div>
          </section>

          <section className="card card-pad stack" style={{ gap: 8 }}>
            <h2>Amazon</h2>
            <div className="small">Konto: {a.amazon.account === "zweit" ? "zweites Konto" : "Hauptkonto"}{brand?.sellerName ? ` (Marke: ${brand.sellerName})` : ""} · Produkttyp: <strong>{a.amazon.productType ?? "–"}</strong>{a.asin && !a.amazon.ownListing ? " · nur Angebot zu vorhandener ASIN (Preis, Menge)" : ""}</div>
            {(!a.asin || a.amazon.ownListing) && <OptionSearch id={a.id} kind="producttype" placeholder="Produkttyp suchen, z. B. Süßigkeiten" />}
            <AmazonButtons id={a.id} ready={ready} />
            {lc && (
              <div className="small">
                <div className="muted">{lc.mode === "pruefen" ? "Prüfung" : "Senden/Status"} am {new Date(lc.at).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}: <strong>{lc.status}</strong></div>
                {lc.issues.length > 0 && (
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {lc.issues.slice(0, 20).map((i, n) => <li key={n} style={{ color: i.severity === "ERROR" ? "var(--danger)" : "var(--ink-2)" }}>{i.message}{i.attributes?.length ? ` (${i.attributes.join(", ")})` : ""}</li>)}
                  </ul>
                )}
              </div>
            )}
          </section>

          <section className="card card-pad stack" style={{ gap: 8 }}>
            <h2>eBay</h2>
            {!canEbay ? (
              <div className="small muted">Für eBay braucht es den Bereich eBay.</div>
            ) : (
              <>
                <div className="small">Kategorie: <strong>{a.ebay.categoryName ?? a.ebay.categoryId ?? "–"}</strong></div>
                <OptionSearch id={a.id} kind="ebaycat" placeholder="Kategorie suchen, z. B. Süßigkeiten" />
                <EbayButton id={a.id} disabled={!a.ebay.categoryId || !images.length} />
                {a.ebay.attemptId && <Link className="small" href={`/ebay?ansicht=vorschau&id=${a.ebay.attemptId}`}>Letzter Entwurf #{a.ebay.attemptId} im eBay-Tool öffnen</Link>}
                <div className="small muted">Bilder werden zu eBay hochgeladen; Titel, HTML-Beschreibung, Merkmale, Hersteller (GPSR), EK und VK kommen mit. Veröffentlichen im eBay-Tool (Vorschau).</div>
              </>
            )}
          </section>

          <form action={deleteArticleAction}>
            <input type="hidden" name="id" value={a.id} />
            <button className="btn-link small muted" type="submit">Artikel löschen</button>
          </form>
        </aside>
      </div>
    </>
  );
}
