import Link from "next/link";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { CHANNELS } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { CHANNEL_LABEL } from "@/lib/labels";
import { formatEuro } from "@/lib/numbers";
import { ebayToolLink } from "@/lib/ebay/tool-link";
import { availableOf, stockSkuOf, targetQuantity } from "@/lib/stock/channel-logic";
import { channelsWithStockApi, stockLevels } from "@/lib/stock/channel-sync";
import { UNKNOWN_SKU } from "@/lib/stock/ebay-link";
import { adoptEbayAction, confirmManualAction, deleteListing, draftsFromOwnStock, ebayStockAction, linkAmazonFbmAction, publishAction, saveListing, setListingStockAction, syncNowAction, toggleSyncAction } from "./actions";

const STATUS: Record<string, [string, string]> = { draft: ["ENTWURF", "tag-neutral"], active: ["AKTIV", "tag-ok"], ended: ["BEENDET", "tag-neutral"], error: ["FEHLER", "tag-critical"] };

export default async function ListingsPage({ searchParams }: { searchParams: Promise<{ kanal?: string; sku?: string; meldung?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const L = schema.listings;
  const where: SQL[] = [eq(L.tenantId, session.tenantId)];
  if (CHANNELS.includes(sp.kanal as never)) where.push(eq(L.channel, sp.kanal as never));
  const rows = await db.select().from(L).where(and(...where)).orderBy(desc(L.updatedAt)).limit(500);
  const levels = await stockLevels(session.tenantId);
  const withApi = new Set(await channelsWithStockApi());
  return (
    <>
      <div className="page-head">
        <div><div className="crumb">WaWi</div><h1>Listings</h1></div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <form action={syncNowAction}><input type="hidden" name="kanal" value={sp.kanal ?? ""} /><button className="btn btn-primary" type="submit">Bestand jetzt abgleichen</button></form>
        <form action={adoptEbayAction}><button className="btn" type="submit" title="Angebote aus dem eBay-Tool in die Wawi holen und fehlenden Wawi-Bestand aus der eBay-Menge anlegen">eBay-Angebote aus dem Tool übernehmen</button></form>
        <form action={linkAmazonFbmAction}><button className="btn" type="submit" title="SKUs aus Amazon-FBM-Bestellungen mit eigenem Lager">Amazon FBM verknüpfen</button></form>
        <form action={draftsFromOwnStock} style={{ display: "flex", gap: 6 }}>
          <label htmlFor="dch" className="sr-only">Kanal</label>
          <select className="select" id="dch" name="channel" defaultValue="ebay">{CHANNELS.filter((c) => c !== "manual").map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}</select>
          <button className="btn" type="submit">Entwürfe aus eigenem Lager</button>
        </form>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-info" data-testid="sync-msg">{sp.meldung}</div>}
      <div className="small muted">
        <strong>Bestandsabgleich:</strong> Die Wawi ist führend. Jedes aktive Angebot zeigt im Kanal den verfügbaren Bestand der Wawi-SKU
        (eigenes Lager − in offenen Aufträgen reserviert, ggf. gedeckelt). Neue Bestellungen von eBay und Amazon werden alle 5 Minuten geholt;
        danach gehen alle anderen Kanäle sofort herunter. Kanäle ohne Schnittstelle (Temu, TikTok …) bekommen eine Aufgabe mit der Zielmenge.
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Link href="/listings" className={`chip${!sp.kanal ? " active" : ""}`}>Alle</Link>
        {CHANNELS.filter((c) => c !== "manual").map((c) => <Link key={c} href={`/listings?kanal=${c}`} className={`chip${sp.kanal === c ? " active" : ""}`}>{CHANNEL_LABEL[c]}</Link>)}
      </div>
      <div className="stack">
        <section className="card" style={{ minWidth: 0, overflow: "auto" }}>
          <table className="table">
            <thead><tr><th>Kanal</th><th>SKU</th><th>Titel</th><th className="right">Preis</th><th className="right" title="Eigenes Lager − reserviert">Wawi verfügbar</th><th className="right">Im Kanal</th><th>Abgleich</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={9} className="muted">Noch keine Listings.</td></tr>}
              {rows.map((l) => {
                const ssku = stockSkuOf(l);
                const lvl = levels.get(ssku);
                const target = lvl ? targetQuantity(l, availableOf(lvl)) : null;
                const manual = !withApi.has(l.channel);
                const behind = l.status === "active" && l.stockSync && target !== null && target !== l.pushedQuantity;
                const attemptId = l.channel === "ebay" ? (l.payload as { attemptId?: number }).attemptId : undefined;
                // eBay-Entwürfe der Wawi werden im eBay-Tool eingestellt – alte Fehler vom direkten Einstellen zählen nicht mehr.
                const toolDraft = l.channel === "ebay" && (l.status === "draft" || l.status === "error") && !attemptId && !l.externalId;
                // Ohne Wawi-Bestand: eBay-Angebote aus dem Tool holen ihn aus der eBay-Menge, alle anderen bekommen ein Mengenfeld.
                const ebayNoStock = l.channel === "ebay" && l.status === "active" && !lvl && !UNKNOWN_SKU.test(l.lastError ?? "");
                const askStock = l.status === "active" && !lvl && !ebayNoStock && (l.stockSync || l.channel === "ebay");
                return (
                <tr key={l.id} data-testid="listing-row" data-sku={l.sku}>
                  <td>{CHANNEL_LABEL[l.channel]}</td>
                  <td className="num small">{l.sku}{l.stockSku && <div className="muted">Wawi: {l.stockSku}</div>}</td>
                  <td style={{ maxWidth: 320 }}>
                    {l.title}
                    {toolDraft ? (
                      <div className="small muted" data-testid="tool-draft-hint">
                        {lvl ? `Im eBay-Tool einstellen – der Wawi-Bestand (${lvl.onHand}) wird dabei über die EAN verknüpft.` : "Im eBay-Tool einstellen – die eingestellte Menge wird dabei als Wawi-Bestand gebucht."}
                      </div>
                    ) : l.lastError && <div className="small" style={{ color: l.stockSync || l.status !== "active" ? "var(--danger)" : "var(--warn)" }}>{l.lastError}</div>}
                  </td>
                  <td className="num right">{formatEuro(l.price)}</td>
                  <td className="num right" title={lvl ? `Lager ${lvl.onHand} − reserviert ${lvl.reserved}` : "kein eigener Lagereintrag"}>
                    {lvl ? availableOf(lvl) : "–"}
                    {lvl && lvl.reserved > 0 && <div className="small muted">{lvl.reserved} reserviert</div>}
                    {lvl && lvl.reserved > lvl.onHand && <div className="small" style={{ color: "var(--danger)", fontWeight: 700 }}>Überverkauf</div>}
                  </td>
                  <td className="num right">{l.pushedQuantity ?? l.quantity}{l.maxQuantity !== null && <div className="small muted">max. {l.maxQuantity}</div>}</td>
                  <td className="small" style={{ whiteSpace: "nowrap" }}>
                    {l.status !== "active" ? <span className="muted">–</span> : ebayNoStock ? (
                      <form action={ebayStockAction}>
                        <input type="hidden" name="id" value={l.id} /><input type="hidden" name="kanal" value={sp.kanal ?? ""} />
                        <button className="btn btn-small btn-primary" type="submit" data-testid="ebay-stock-btn" title="Aktuelle eBay-Menge + verkauft, noch nicht versandt als Wawi-Bestand buchen und Abgleich einschalten">Bestand aus eBay anlegen</button>
                      </form>
                    ) : askStock ? (
                      <form action={setListingStockAction} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <input type="hidden" name="id" value={l.id} /><input type="hidden" name="kanal" value={sp.kanal ?? ""} />
                        <input className="input num" aria-label="Wawi-Bestand" name="quantity" defaultValue={l.pushedQuantity ?? l.quantity} style={{ width: 56, padding: "4px 6px" }} />
                        <button className="btn btn-small btn-primary" type="submit" data-testid="set-stock-btn" title="Als Wawi-Bestand buchen und Abgleich einschalten">Bestand setzen</button>
                      </form>
                    ) : !l.stockSync ? (
                      <form action={toggleSyncAction}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="on" value="1" /><button className="btn btn-small" type="submit">Einschalten</button></form>
                    ) : !lvl ? <span className="tag tag-warn">kein Wawi-Bestand</span> : behind && manual ? (
                      <form action={confirmManualAction}><input type="hidden" name="id" value={l.id} /><span className="tag tag-warn">auf {target} setzen</span> <button className="btn btn-small" type="submit" title="Im Kanal von Hand gesetzt">Gesetzt</button></form>
                    ) : behind ? <span className="tag tag-warn">→ {target} ausstehend</span> : <span className="tag tag-ok">{manual ? "von Hand · " : ""}aktuell</span>}
                    {l.status === "active" && l.stockSync && (
                      <form action={toggleSyncAction} style={{ display: "inline" }}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="on" value="0" /><button className="btn-link small" type="submit" style={{ marginLeft: 6, color: "var(--muted)" }} title="Abgleich für dieses Angebot ausschalten">aus</button></form>
                    )}
                  </td>
                  <td><span className={`tag ${STATUS[l.status][1]}`}>{STATUS[l.status][0]}</span>{l.externalId && <div className="small muted num">{l.externalId}</div>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {attemptId ? (
                      <Link className="btn btn-small" href={`/ebay?ansicht=vorschau&id=${attemptId}`}>Im eBay-Tool</Link>
                    ) : l.channel === "ebay" && l.status !== "active" ? (
                      // eBay-Angebote entstehen im eBay-Tool (Katalog, Bilder, HTML-Vorlage, Keepa) – vorausgefüllt.
                      <Link className="btn btn-small" href={ebayToolLink({ q: l.ean || l.title, vk: l.price, menge: lvl ? availableOf(lvl) : l.quantity })}>Im eBay-Tool einstellen</Link>
                    ) : (
                      <form action={publishAction} style={{ display: "inline" }}><input type="hidden" name="id" value={l.id} /><button className="btn btn-small" type="submit">{l.status === "active" ? "Aktualisieren" : "Einstellen"}</button></form>
                    )}
                    <Link className="btn-link small" href={`/listings?sku=${encodeURIComponent(l.sku)}&kanal=${l.channel}`} style={{ marginLeft: 8 }}>bearbeiten</Link>
                    <form action={deleteListing} style={{ display: "inline" }}><input type="hidden" name="id" value={l.id} /><button className="btn-link small" type="submit" style={{ marginLeft: 8, color: "var(--muted)" }}>×</button></form>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <div className="listing-forms">
          {!sp.sku && (
            <section className="card card-pad stack" style={{ gap: 8 }}>
              <h2>Neues eBay-Angebot</h2>
              <div className="small muted">Im eBay-Tool: EAN oder Titel suchen – Katalogdaten, Bilder, HTML-Vorlage, Keepa und Gewinnrechnung sind dort hinterlegt.</div>
              <Link className="btn btn-primary" href="/ebay">Zum eBay-Tool</Link>
            </section>
          )}
          <form action={saveListing} className="card card-pad stack" style={{ gap: 8 }}>
            <h2>{sp.sku ? "Listing bearbeiten" : "Neues Listing (andere Kanäle)"}</h2>
            {(() => {
              const cur = sp.sku ? rows.find((r) => r.sku === sp.sku && (!sp.kanal || r.channel === sp.kanal)) : undefined;
              return (
                <>
                  <div className="field"><label className="label" htmlFor="l-ch">Kanal</label><select className="select" id="l-ch" name="channel" defaultValue={cur?.channel ?? "amazon"}>{CHANNELS.filter((c) => c !== "manual" && (c !== "ebay" || cur?.channel === "ebay")).map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}</select></div>
                  <div className="field"><label className="label" htmlFor="l-sku">SKU im Kanal</label><input className="input" id="l-sku" name="sku" defaultValue={cur?.sku ?? sp.sku ?? ""} required /></div>
                  <div className="field"><label className="label" htmlFor="l-ssku">Wawi-SKU (eigenes Lager)</label><input className="input" id="l-ssku" name="stockSku" defaultValue={cur?.stockSku ?? ""} placeholder="leer = gleiche SKU" /></div>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                    <div className="field"><label className="label" htmlFor="l-st">Status im Kanal</label><select className="select" id="l-st" name="status" defaultValue={cur?.status ?? "draft"}><option value="draft">Entwurf</option><option value="active">Aktiv (läuft im Kanal)</option><option value="ended">Beendet</option></select></div>
                    <div className="field"><label className="label" htmlFor="l-max">Höchstens zeigen</label><input className="input num" id="l-max" name="maxQuantity" defaultValue={cur?.maxQuantity ?? ""} placeholder="alles" style={{ width: 80 }} /></div>
                  </div>
                  <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="stockSync" defaultChecked={cur ? cur.stockSync : true} /> Menge mit dem Wawi-Bestand abgleichen</label>
                  <div className="field"><label className="label" htmlFor="l-t">Titel (max. 80 Zeichen)</label><input className="input" id="l-t" name="title" maxLength={80} defaultValue={cur?.title ?? ""} placeholder="leer = Titel aus dem Artikel" /></div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div className="field"><label className="label" htmlFor="l-p">Preis €</label><input className="input num" id="l-p" name="price" defaultValue={cur?.price?.toFixed(2).replace(".", ",") ?? ""} /></div>
                    <div className="field"><label className="label" htmlFor="l-q" title="Bei aktivem Abgleich setzt die Wawi die Menge selbst">Menge</label><input className="input num" id="l-q" name="quantity" defaultValue={cur?.quantity ?? 1} /></div>
                  </div>
                  <div className="field"><label className="label" htmlFor="l-e">EAN</label><input className="input num" id="l-e" name="ean" defaultValue={cur?.ean ?? ""} /></div>
                  <div className="field"><label className="label" htmlFor="l-c">Zustand</label><select className="select" id="l-c" name="condition" defaultValue={cur?.condition ?? "NEW"}><option value="NEW">Neu</option><option value="LIKE_NEW">Wie neu</option><option value="USED_EXCELLENT">Gebraucht – sehr gut</option><option value="USED_GOOD">Gebraucht – gut</option></select></div>
                  <div className="field"><label className="label" htmlFor="l-cat">eBay-Kategorie-ID</label><input className="input num" id="l-cat" name="categoryId" defaultValue={(cur?.payload as { categoryId?: string } | undefined)?.categoryId ?? ""} /></div>
                  <div className="field"><label className="label" htmlFor="l-img">Bild-Links (https, eins pro Zeile)</label><textarea className="textarea" id="l-img" name="imageUrls" defaultValue={((cur?.payload as { imageUrls?: string[] } | undefined)?.imageUrls ?? []).join("\n")} style={{ minHeight: 60 }} /></div>
                  <div className="field"><label className="label" htmlFor="l-d">Beschreibung</label><textarea className="textarea" id="l-d" name="description" defaultValue={cur?.description ?? ""} style={{ minHeight: 100 }} /></div>
                  <button className="btn btn-primary" type="submit">Speichern</button>
                </>
              );
            })()}
          </form>
          <div className="small muted card card-pad">
            eBay: Angebote aus dem eBay-Tool landen beim Veröffentlichen automatisch hier und im Bestand (die eingestellte Menge wird als Wawi-Bestand gebucht,
            wenn die Wawi die Ware noch nicht führt). Ältere Angebote ohne Wawi-Bestand bekommen den Bestand aus der aktuellen eBay-Menge plus verkaufte,
            noch nicht versandte Stück – automatisch alle 15 Minuten oder per „Bestand aus eBay anlegen“. Damit eBay ein Angebot bei Menge 0 nicht beendet, in eBay unter
            Verkaufen → Einstellungen die Option „Nicht vorrätig“ (Out-of-stock control) einschalten.<br />
            Amazon FBM: „Amazon FBM verknüpfen“ übernimmt SKUs aus FBM-Bestellungen; FBA-Angebote werden erkannt und nie angefasst.<br />
            Temu, TikTok: Angebot hier mit Status „Aktiv“ anlegen – bis die Schnittstelle frei ist, kommt bei jeder Änderung eine Aufgabe mit der Zielmenge.
          </div>
        </div>
      </div>
    </>
  );
}
