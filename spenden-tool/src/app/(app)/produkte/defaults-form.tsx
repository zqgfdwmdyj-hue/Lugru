import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { formatDate } from "@/lib/numbers";
import { outputPrice } from "@/lib/layout";
import { amountFromVariant, guessUnit, isDrink, mhdAuto, PACK_KINDS, packOffers, packText, STOCK_LABELS, unitLabel, UNITS } from "@/lib/price-logic";
import { saveProductDefaults } from "@/app/(app)/actions";

type Product = typeof schema.products.$inferSelect;

/** Daten für „Für Verteilungen“: Vorlage am Produkt, sonst die kommende bzw. letzte Verteilung mit diesem Produkt. */
export async function productDefaultsData(product: Product) {
  // „Für Verteilungen“: Vorlage am Produkt, sonst die kommende bzw. letzte Verteilung mit diesem Produkt.
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const items = await db
    .select({ item: schema.eventItems, eventDate: schema.events.eventDate })
    .from(schema.eventItems)
    .innerJoin(schema.events, eq(schema.events.id, schema.eventItems.eventId))
    .where(eq(schema.eventItems.productId, product.id))
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
  return { product, upcoming, base, drink, unitGuess };
}

/**
 * „Für Verteilungen“ – dieselben Felder wie in den Details der Produktliste. Wird in der Produktkartei und
 * aufgeklappt in der Produktübersicht verwendet (Feld-IDs je Produkt eindeutig).
 */
export function ProductDefaultsForm({ data, back, compact = false }: { data: Awaited<ReturnType<typeof productDefaultsData>>; back?: string; compact?: boolean }) {
  const { product, upcoming, base, drink, unitGuess } = data;
  const px = `pd-${product.id.slice(0, 8)}-`;
  return (
        <form action={saveProductDefaults} className={`card product-defaults${compact ? " product-defaults-inline" : ""}`}>
          <input type="hidden" name="productId" value={product.id} />
          {back && <input type="hidden" name="back" value={back} />}
          <div className="card-head">
            <h2>Für Verteilungen</h2>
            <span className="small muted">{upcoming.length ? `gilt sofort für ${upcoming.length} kommende Verteilung${upcoming.length === 1 ? "" : "en"} (${upcoming.map((u) => formatDate(u.eventDate)).join(", ")}) und als Vorlage` : "Vorlage für die nächste Verteilung mit diesem Produkt"}</span>
          </div>
          <div className="pd-grid">
            <fieldset>
              <legend>Spendenempfehlung</legend>
              <div className="form-grid">
                <div className="field">
                  <label className="label" htmlFor={`${px}unit`}>Abgabeeinheit</label>
                  <select className="select" id={`${px}unit`} name="unit" defaultValue={base.unit ?? ""}>
                    <option value="">nicht angegeben</option>
                    {Object.entries(UNITS).map(([key, u]) => <option key={key} value={key}>{u.label}</option>)}
                  </select>
                  {!base.unit && unitGuess && <span className="small muted">Vorschlag: {unitLabel(unitGuess.unit, unitGuess.count)}</span>}
                </div>
                <div className="field"><label className="label" htmlFor={`${px}count`}>{drink ? "Flaschen / Stück darin" : "Stück je Einheit"}</label><input className="input" id={`${px}count`} name="unitCount" defaultValue={base.unitCount ?? ""} inputMode="numeric" placeholder={drink ? "z. B. 20" : "z. B. 6"} /></div>
              </div>
              <div className="field"><label className="label" htmlFor={`${px}amount`}>Inhalt / Menge (optional)</label><input className="input" id={`${px}amount`} name="amount" defaultValue={product.amount ?? ""} placeholder={amountFromVariant(product.variant) ? `z. B. ${amountFromVariant(product.variant)}` : drink ? "z. B. 0,5 l" : "z. B. 1,5 kg"} /></div>
              <div className="field"><label className="label" htmlFor={`${px}note`}>Eigener Text vor dem Preis (optional)</label><input className="input" id={`${px}note`} name="priceNote" defaultValue={base.priceNote ?? ""} placeholder="z. B. je, 3 Stück" /></div>
            </fieldset>
            <fieldset>
              <legend>Varianten (je eigene Empfehlung)</legend>
              {[{ kind: base.packKind, count: base.packCount, price: base.packPrice, note: base.packNote }, ...base.morePacks, ...(base.packKind || base.packPrice != null ? [{ kind: null, count: null, price: null, note: null }] : [])].slice(0, 6).map((m, n) => {
                const pre = n === 0 ? { k: "packKind", c: "packCount", p: "packPrice", t: "packNote" } : { k: `mp${n - 1}k`, c: `mp${n - 1}c`, p: `mp${n - 1}p`, t: `mp${n - 1}n` };
                return (
                  <div key={n} className={n ? "more-pack" : undefined}>
                    <div className="form-grid">
                      <div className="field">
                        <label className="label" htmlFor={`${px}${pre.k}`}>{n === 0 ? "Art" : `Variante ${n + 1}`}</label>
                        <select className="select" id={`${px}${pre.k}`} name={pre.k} defaultValue={m.kind ?? ""}>
                          <option value="">–</option>
                          {Object.entries(PACK_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                        </select>
                      </div>
                      <div className="field"><label className="label" htmlFor={`${px}${pre.c}`}>{drink ? "Flaschen darin" : "Stück darin"}</label><input className="input" id={`${px}${pre.c}`} name={pre.c} defaultValue={m.count ?? ""} inputMode="numeric" /></div>
                      <div className="field"><label className="label" htmlFor={`${px}${pre.p}`}>Empfehlung €</label><input className="input" id={`${px}${pre.p}`} name={pre.p} defaultValue={m.price != null ? m.price.toFixed(2).replace(".", ",") : ""} inputMode="decimal" /></div>
                    </div>
                    <div className="field"><label className="label" htmlFor={`${px}${pre.t}`}>Eigene Bezeichnung (optional)</label><input className="input" id={`${px}${pre.t}`} name={pre.t} defaultValue={m.note ?? ""} placeholder={packText({ packKind: m.kind, packCount: m.count }, drink, product.variant)} /></div>
                  </div>
                );
              })}
              <span className="small muted">Nach dem Speichern erscheint eine leere Zeile für die nächste Variante. Alle Felder einer Variante leeren = entfernen.</span>
            </fieldset>
            <fieldset>
              <legend>Ausgabe & Bestand</legend>
              <label className="check"><input type="checkbox" name="inCollage" defaultChecked={base.inCollage} /> Auf der Collage / Social Media</label>
              <label className="check"><input type="checkbox" name="inFlyer" defaultChecked={base.inFlyer} /> Im Aushang / Messenger-Text</label>
              <div className="field"><label className="label" htmlFor={`${px}caption`}>Text auf dem Bild</label><input className="input" id={`${px}caption`} name="caption" defaultValue={base.caption ?? ""} placeholder="z. B. vegan, nur heute" /></div>
              {upcoming.length > 0 && (
                <>
                  <div className="field">
                    <label className="label" htmlFor={`${px}stock`}>Bestand (ca.) – kommende Verteilung</label>
                    <select className="select" id={`${px}stock`} name="stock" defaultValue="">
                      <option value="">{upcoming[0].stock ? `unverändert (${STOCK_LABELS[upcoming[0].stock]})` : "unverändert"}</option>
                      {Object.entries(STOCK_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                      <option value="leer">leeren</option>
                    </select>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor={`${px}mhd`}>MHD-Datum – kommende Verteilung{mhdAuto(product).relevant ? "" : " (nicht nötig)"}</label>
                    <input className="input" type="date" id={`${px}mhd`} name="mhd" defaultValue={upcoming[0].bestBefore ?? ""} />
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
  );
}
