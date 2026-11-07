import Link from "next/link";
import { notFound } from "next/navigation";
import { requireArea } from "@/lib/auth/session";
import { AMPEL_EMOJI, antwortEntwurf, freischaltungLink, landKennzahlen, margeBrutto, realeMarge } from "@/lib/deal-eingang/logic";
import { eingang, keepaSzenarioAusCache, keepaVerlaufAusCache, STATUS_TEXT } from "@/lib/deal-eingang/service";
import { getSettings } from "@/lib/settings";
import { PreisSzenario, type SzenarioLand } from "./szenario";
import { miniChart, type MiniChart } from "@/lib/deal-eingang/chart-logic";
import { KeepaMini } from "../keepa-mini";
import { formatEuro } from "@/lib/numbers";
import { AutoRefresh } from "../../lieferanten/finden/refresh";
import { neuPruefenAction, statusAction, zeileAction, bestellvorschlagAction, b2bAction, gekauftAction, bewertenAction, wareAction, bestellmailEntwurfAction, bestellmailAction } from "../actions";
import { DAUMEN_GRUENDE, DAUMEN_GRUENDE_HOCH, DEAL_VERPACKUNG, VERPACKUNG_TEXT } from "@/db/tables/deal-eingang";
import { bestellmailsFuerDeal, dealLieferanten, lieferantFuerDeal } from "@/lib/deal-eingang/bestellmail";
import { angebotsLink } from "@/lib/deal-eingang/kauf-logic";
import { kaufVorschlag } from "@/lib/deal-eingang/kauf";
import { kaufNrGueltig } from "@/lib/deal-eingang/shop-logic";
import { CopyButton } from "@/components/copy-button";
import { umschlagErklaerung, umschlagSchaetzen } from "@/lib/deal-eingang/umschlag-logic";
import { vorlaufFuer } from "@/lib/money/durchlauf";

const eur = (n: number | null | undefined) => (n === null || n === undefined ? "–" : formatEuro(n));
const pz = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${String(Math.round(n * 10) / 10).replace(".", ",")} %`);

export default async function DealEingangDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ meldung?: string; zeile?: string; daumen?: string; code?: string; kauf?: string }> }) {
  const session = await requireArea("dealeingang");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const e = await eingang(session.tenantId, id);
  if (!e) notFound();
  const laeuft = e.pruefung === "offen" || e.pruefung === "laeuft";
  const schreiben = !session.readOnly;
  // Keepa-Mini-Chart 90 Tage je Angebot – nur aus dem Zwischenspeicher (keine Tokens beim Ansehen).
  const heute = new Date().toISOString().slice(0, 10);
  const charts = new Map<number, { chart: MiniChart; land: string; stand: Date }>();
  await Promise.all(
    e.zeilen
      .filter((z) => z.asin)
      .map(async (z) => {
        const v = await keepaVerlaufAusCache(session.tenantId, z.asin!, z.bestesLand).catch(() => null);
        const chart = v ? miniChart(v.verlauf, { bis: heute }) : null;
        if (v && chart) charts.set(z.nr, { chart, land: v.land, stand: v.stand });
      }),
  );
  // B28.2: Keepa-Tagesverlauf je Land fürs Preis-Szenario – ebenfalls nur aus dem Zwischenspeicher.
  const szenarioKeepa = new Map<number, Awaited<ReturnType<typeof keepaSzenarioAusCache>>>();
  await Promise.all(
    e.zeilen
      .filter((z) => z.asin && z.laender.some((l) => l.provision !== undefined))
      .map(async (z) => szenarioKeepa.set(z.nr, await keepaSzenarioAusCache(session.tenantId, z.asin!, z.laender.map((l) => l.land)).catch(() => ({})))),
  );
  const de = (await getSettings(session.tenantId)).dealEingang;
  const zielRoi = de.zielRoi;
  const zielMarge = de.zielMarge ?? 10;
  // B28.6: Vorlauf aus den eigenen Durchlaufzeiten – für ältere Prüfungen ohne gespeicherte Umschlagszeit.
  const vorlauf = e.zeilen.some((z) => z.laender.some((l) => l.umschlag === undefined)) ? await vorlaufFuer(session.tenantId, e.quelle).catch(() => undefined) : undefined;
  const bilder = e.dateiIds.map((fid, i) => ({ id: fid, name: e.dateiNamen[i] ?? `Datei ${i + 1}` }));
  // Kaufen mit einem Tap: vorbereiteter Kauf aus dem Push bzw. jetzt berechnet (Shop-Profil, Menge, Gutschein).
  const vorschlag = e.pruefung === "fertig" ? await kaufVorschlag(e).catch(() => null) : null;
  const kauf = vorschlag?.kauf ?? null;
  const nrGueltig = e.kaufNr && kaufNrGueltig(e.kauf?.am) ? e.kaufNr : null;
  // B28.5: Lieferant zur Quelle (Einstellungen → Deal-Quellen) und Bestellmails am Deal
  const [lieferant, bestellmails, alleLieferanten] = await Promise.all([lieferantFuerDeal(session.tenantId, e.quelle, e.weg, e.rohtext).catch(() => null), bestellmailsFuerDeal(session.tenantId, e.id).catch(() => []), dealLieferanten(session.tenantId).catch(() => [])]);
  // Auswahl am Gekauft-Knopf: erkannter Lieferant; ohne Quelle und mit nur einem Lieferanten dieser vorgewählt.
  const mitMail = alleLieferanten.filter((l) => l.email);
  const vorwahl = lieferant?.email ? lieferant.supplierId : !e.quelle && mitMail.length === 1 ? mitMail[0].supplierId : "";
  const lieferantAuswahl = (testid: string) =>
    mitMail.length > 0 ? (
      <label>
        Lieferant{" "}
        <select name="lieferant" defaultValue={vorwahl} data-testid={testid}>
          <option value="">{lieferant ? "–" : "– wählen –"}</option>
          {mitMail.map((l) => <option key={l.supplierId} value={l.supplierId}>{l.name}</option>)}
        </select>
      </label>
    ) : null;
  const datum = (d: Date | null) => (d ? d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }) : "–");
  return (
    <>
      <AutoRefresh active={laeuft} everyMs={3000} />
      <div className="page-head">
        <div><div className="crumb"><Link href="/deal-eingang">Deal-Eingang</Link></div><h1>{e.ampel ? `${AMPEL_EMOJI[e.ampel]} ` : ""}{e.quelle ?? "Angebot"} · {e.createdAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}</h1></div>
        {schreiben && !laeuft && <form action={neuPruefenAction}><input type="hidden" name="id" value={e.id} /><button className="btn" type="submit">Neu prüfen</button></form>}
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>{sp.meldung}</div>}
      <div className="card card-pad stack" data-testid="de-detail" data-pruefung={e.pruefung} data-ampel={e.ampel ?? ""}>
        <div data-testid="de-zusammenfassung">{laeuft ? "Wird geprüft …" : e.pruefung === "fehler" ? `Fehler: ${e.fehler}` : e.zusammenfassung}</div>
        {e.ohneKi && <div className="small muted">Ohne KI erkannt (Regeln) – Zeilen bitte prüfen.</div>}
        {e.preislisteId && <div className="small"><Link href={`/b2b/preislisten/${e.preislisteId}`}>Zur Preisliste im Scanner →</Link></div>}
        <details>
          <summary className="small">Originalnachricht{e.dateiNamen.length ? ` + ${e.dateiNamen.length} Datei(en)` : ""}</summary>
          <pre className="small" style={{ whiteSpace: "pre-wrap" }}>{e.rohtext || "–"}</pre>
          {bilder.length > 0 && (
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }} data-testid="de-dateien">
              {bilder.map((b) =>
                /\.(png|jpe?g|gif|webp|heic)$/i.test(b.name) ? (
                  <a key={b.id} href={`/deal-eingang/${e.id}/datei/${b.id}`} target="_blank" rel="noreferrer" title={b.name}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- geschützte Datei, kein öffentliches Bild */}
                    <img src={`/deal-eingang/${e.id}/datei/${b.id}`} alt={b.name} style={{ maxWidth: 220, maxHeight: 320, border: "1px solid var(--border)", borderRadius: 8 }} data-testid="de-bild" />
                  </a>
                ) : (
                  <a key={b.id} className="small" href={`/deal-eingang/${e.id}/datei/${b.id}`} target="_blank" rel="noreferrer">{b.name}</a>
                ),
              )}
            </div>
          )}
        </details>
        <div className="small muted">Status: {STATUS_TEXT[e.status]}{e.grund ? ` – ${e.grund}` : ""}</div>
        {e.gekauftAm && <div className="small" data-testid="de-gekauft">Gekauft: {e.gekauftMenge} Stk{e.gekauftPreis !== null ? ` zu ${eur(e.gekauftPreis)} netto` : ""} am {e.gekauftAm.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })} ({e.gekauftWeg === "automatisch" ? `automatisch erkannt – ${e.gekauftRef ?? "Beleg"}` : e.gekauftWeg === "mail" ? "Bestellbestätigung per Mail" : e.gekauftWeg === "claude" ? "über Claude" : e.gekauftWeg === "sprache" || e.gekauftWeg === "sms" ? "per Sprache/SMS" : "von Hand"}){e.bestellungId ? <> · <Link href={`/einkauf/${e.bestellungId}`}>Bestellung (Wareneingang, Rechnung)</Link></> : null}</div>}
        {e.daumen && (
          <div className="small" data-testid="de-daumen">
            {e.daumen === "hoch" ? "👍" : "👎"}
            {e.daumenGrund ? ` ${e.daumenGrund}` : ""}
            {e.daumenGruende.length ? ` ${e.daumenGruende.join(" · ")}` : ""}
            {e.daumenFreitext ? ` – „${e.daumenFreitext}“` : ""} ({e.daumenWeg === "discord" ? "Discord" : e.daumenWeg === "push" ? "Push" : e.daumenWeg === "claude" ? "Claude" : "Seite"})
            {e.daumen === "hoch" && e.daumenWeg === "discord" && e.daumenFrageRef && !e.daumenGruende.length && !e.daumenFreitext ? <span className="muted"> · Rückfrage nach dem Grund im Discord-Thread offen</span> : null}
          </div>
        )}
        {e.ergebnis && <div className="small" data-testid="de-ergebnis">Ergebnis nach {e.ergebnis.tage} Tagen: {e.ergebnis.verkauft} verkauft{e.ergebnis.erstattet ? `, ${e.ergebnis.erstattet} erstattet` : ""}{e.ergebnis.oVk !== null ? `, Ø VK ${eur(e.ergebnis.oVk)}` : ""}{e.ergebnis.realerRoi !== null ? `, realer ROI ${pz(e.ergebnis.realerRoi)}` : ""}{realeMarge(e.ergebnis) !== null ? `, reale Marge ${pz(realeMarge(e.ergebnis))}` : ""}{e.ergebnis.tageBisAbverkauf !== null ? `, abverkauft nach ${e.ergebnis.tageBisAbverkauf} T` : ""}</div>}
      </div>

      {e.zeilen.map((z) => {
        const kz = new Map(z.laender.map((l) => [l.land, landKennzahlen(l, z.ekNetto, zielMarge)]));
        const um = new Map(z.laender.map((l) => [l.land, l.umschlag !== undefined ? l.umschlag : umschlagSchaetzen({ verkaeufeMonat: l.verkaeufeMonat ?? l.verkaeufeGeschaetzt ?? null, angebote: l.angebote, amazonProzent: l.amazonProzent, menge: z.angebot.menge ?? z.angebot.moq ?? z.empfohlen, roi: l.roi, vorlauf })]));
        const umBest = um.get(z.bestesLand ?? "") ?? null;
        const bestLand = z.laender.find((l) => l.land === z.bestesLand);
        const margeBest = z.margeBrutto ?? (bestLand ? margeBrutto(bestLand.gewinn, bestLand.vk90Eur ?? bestLand.vkEur) : null);
        const maxEkMarge = z.laender.filter((l) => kz.get(l.land)?.maxEkMarge != null).map((l) => ({ land: l.land, ek: kz.get(l.land)!.maxEkMarge! })).sort((a, b) => b.ek - a.ek);
        const keepaSz = szenarioKeepa.get(z.nr);
        const szenario: SzenarioLand[] = keepaSz
          ? z.laender
              .filter((l) => l.provision !== undefined && l.mwstSatz !== undefined)
              .map((l) => ({ land: l.land, vk: l.vkEur ?? l.vk90Eur, mwstSatz: l.mwstSatz!, provision: l.provision!, fba: l.fba ?? 0, prep: l.prep ?? 0, tage: keepaSz[l.land]?.tage ?? [], verkauftVerlauf: keepaSz[l.land]?.verkauftVerlauf ?? [], aktuellVerkaeufe: l.verkaeufeMonat ?? keepaSz[l.land]?.aktuell ?? null }))
          : [];
        return (
        <section key={z.nr} className="card card-pad stack" style={{ marginTop: 12 }} data-testid="de-zeile" data-nr={z.nr} data-ampel={z.ampel} data-asin={z.asin ?? ""}>
          <h2 style={{ margin: 0 }}>{AMPEL_EMOJI[z.ampel]} {z.titel ?? z.angebot.name ?? z.asin ?? `Angebot ${z.nr}`}</h2>
          <div className="small">
            {z.asin ? <a href={`https://www.amazon.de/dp/${z.asin}`} target="_blank" rel="noreferrer">{z.asin}</a> : "keine ASIN"}
            {z.zuordnung !== "asin" && z.asin ? ` (über ${z.zuordnung === "ean" ? "EAN" : "Titelsuche"})` : ""} · EK {z.ekNetto !== null ? `${eur(z.ekNetto)} netto` : "fehlt"}
            {z.bestesLand ? ` · bestes Land ${z.bestesLand}: ${eur(z.gewinn)}/Stk, Marge ${pz(margeBest)}, ROI ${pz(z.roi)}` : ""}
            {z.empfohlen !== null ? ` · empfohlen ${z.empfohlen} Stk${z.kapitalbedarf ? ` (${eur(z.kapitalbedarf)})` : ""}` : ""}
          </div>
          {z.gruende.length > 0 && <ul className="small" style={{ margin: 0 }} data-testid="de-gruende">{z.gruende.map((g) => <li key={g}>{g}</li>)}</ul>}
          {z.wert && (
            <div className="small" data-testid="de-wert" data-wert={z.wert.wert} title="Lernt aus deinen Käufen, 👍/👎, realen Ergebnissen und (schwach gewichtet) den Reaktionen der Lugru-Gruppe. Ersetzt keine Prüfung – Rot-Gründe der Ampel gelten immer.">
              <strong>{z.wert.begruendung}</strong>
              {z.wert.aehnliche.length > 0 && (
                <details style={{ marginTop: 4 }}>
                  <summary>Ähnliche frühere Deals ({z.wert.aehnliche.length})</summary>
                  <ul style={{ margin: "4px 0 0" }} data-testid="de-aehnliche">{z.wert.aehnliche.map((a, i) => <li key={i}>{a.id ? <Link href={`/deal-eingang/${a.id}`}>{(a.titel ?? a.asin ?? "Deal").slice(0, 50)}</Link> : (a.titel ?? a.asin ?? "Deal").slice(0, 50)} · {a.datum} · {a.quelle === "lugru" ? "Lugru-Gruppe" : "eigener Deal"}: {a.ergebnis}</li>)}</ul>
                </details>
              )}
            </div>
          )}
          {charts.has(z.nr) && <KeepaMini {...charts.get(z.nr)!} />}
          {(z.maxEk.length > 0 || maxEkMarge.length > 0) && (
            <div className="small" data-testid="de-maxek">
              {z.maxEk.length > 0 && <span data-testid="de-maxek-roi">Max. EK für Ziel-ROI ({zielRoi} %): {z.maxEk.map((m) => `${m.land} ${eur(m.ek)}`).join(" · ")}</span>}
              {z.maxEk.length > 0 && maxEkMarge.length > 0 && <br />}
              {maxEkMarge.length > 0 && <span data-testid="de-maxek-marge">Max. EK für Ziel-Marge ({zielMarge} %): {maxEkMarge.map((m) => `${m.land} ${eur(m.ek)}`).join(" · ")}</span>}
            </div>
          )}
          {z.eigen && <div className="small muted">Eigene Lage: {z.eigen.bestand} auf Lager{z.eigen.unterwegs ? `, ${z.eigen.unterwegs} unterwegs` : ""}{z.eigen.reichweite !== null ? `, Reichweite ${z.eigen.reichweite >= 9999 ? "∞" : `${z.eigen.reichweite} T`}` : ""}{z.eigen.kapitalAmpel ? `, Kapital-Ampel ${AMPEL_EMOJI[z.eigen.kapitalAmpel]}` : ""}{z.eigen.letzterEk ? `, letzter EK ${eur(z.eigen.letzterEk)}` : ""}{z.eigen.bestellvorschlag ? ", Bestellvorschlag offen" : ""}{z.eigen.verlustStopp ? `, ${z.eigen.verlustStopp}` : ""}</div>}
          {z.laender.length > 0 && (
            <div className="table-wrap">
              <table className="table small">
                <thead><tr><th>Land</th><th>Buy Box</th><th>Ø 90 T</th><th>Tief 12 M</th><th>Verk./Monat</th><th>Angebote</th><th>Amazon</th><th>Gewinn</th><th title="Gewinn ÷ Buy-Box-Preis brutto (90-Tage-Mittel)">Marge</th><th>ROI</th><th title="Erwartete Umschlagszeit: Vorlauf (Wareneingang, Prep Center, Amazon-Eingang) + Verkauf der Menge + 14 Tage bis Auszahlung – geschätzt">Umschlag</th><th title="ROI × 365 ÷ Umschlagszeit (Mitte der Spanne)">ROI p. a.</th><th>max. EK (ROI)</th><th>max. EK (Marge)</th></tr></thead>
                <tbody>
                  {z.laender.map((l) => (
                    <tr key={l.land} data-testid="de-land" data-land={l.land}>
                      <td>{l.land}</td><td>{eur(l.vkEur)}</td><td>{eur(l.vk90Eur)}</td><td>{eur(l.tief12Eur)}</td>
                      <td data-testid="de-verkaeufe">{l.verkaeufeMonat ?? (l.verkaeufeGeschaetzt ? <span title="Keepa hat keine „x+ gekauft“-Angabe – geschätzt aus dem Verkaufsrang (Rang-Verbesserungen in 30 Tagen)">≈ {l.verkaeufeGeschaetzt} (geschätzt)</span> : "–")}</td>
                      <td>{l.angebote ?? "–"}</td><td>{l.amazonProzent !== null ? `${l.amazonProzent} %` : "–"}</td>
                      <td data-testid="de-gewinn">{eur(l.gewinn)}</td><td data-testid="de-marge">{pz(kz.get(l.land)?.marge)}</td><td data-testid="de-roi">{pz(l.roi)}</td>
                      {(() => {
                        const u = um.get(l.land);
                        return u ? (
                          <>
                            <td data-testid="de-umschlag" title={umschlagErklaerung(u)}>{u.text.replace("ca. ", "")} <span className="muted">(geschätzt)</span></td>
                            <td data-testid="de-roipa">{u.roiPa === null ? "–" : u.roiPa < (de.minRoiPa ?? 100) ? <span className="tag tag-warn" title={`unter dem Mindestwert ${de.minRoiPa ?? 100} %`}>{u.roiPa} %</span> : `${u.roiPa} %`}</td>
                          </>
                        ) : (
                          <>
                            <td data-testid="de-umschlag" className="muted" title="Ohne Verkäufe/Monat keine Schätzung">–</td>
                            <td data-testid="de-roipa">–</td>
                          </>
                        );
                      })()}
                      <td>{eur(l.maxEk)}</td><td data-testid="de-maxek-marge-land">{eur(kz.get(l.land)?.maxEkMarge)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {umBest && (
            <div className="small muted" data-testid="de-umschlag-info">
              Umschlag {z.bestesLand}: {umBest.text} (geschätzt{umBest.mengeAngenommen ? ", Menge für 30 Tage angenommen" : `, ${umBest.menge} Stk`}){umBest.roiPa !== null ? ` · ROI p. a. ${umBest.roiPa} % (Ziel ≥ ${de.minRoiPa ?? 100} %)` : ""} · Vorlauf {umBest.vorlauf.quelle === "eigene Daten" ? `aus eigenen Daten${umBest.vorlauf.basis ? ` (${umBest.vorlauf.basis} Einkäufe)` : ""}` : "Standardwerte"}
            </div>
          )}
          {umBest?.warnung && <div className="notice notice-warn small" data-testid="de-umschlag-warnung">{umBest.warnung}</div>}
          {z.vorschlaege.length > 1 && <div className="small muted">Weitere Treffer: {z.vorschlaege.map((v) => `${v.asin} (${v.titel.slice(0, 40)})`).join(" · ")}</div>}
          {szenario.length > 0 && <PreisSzenario nr={z.nr} ekNetto={z.ekNetto} laender={szenario} />}
          {z.laender.length > 0 && !szenario.length && z.asin && <div className="small muted">Preis-Szenario („Was wäre bei VK x?“): nach „Neu prüfen“ verfügbar.</div>}
          {z.risiken.length > 0 && (
            <div className="small muted" data-testid="de-risiken">
              {z.risiken.map((r, i) => (
                <span key={r}>
                  {i > 0 ? " · " : ""}
                  {r}
                </span>
              ))}
            </div>
          )}
          {/* B28.4: Knopf je Angebot – auch wenn die SP-API verbunden ist (z. B. bei „Marke gesperrt“) */}
          {z.asin && (
            <div className="small">
              <a className="btn btn-sm" href={freischaltungLink(z.asin, z.bestesLand ?? "DE")} target="_blank" rel="noreferrer" data-testid="de-freischaltung">Freischaltung im Seller Central prüfen →</a>
            </div>
          )}
          <details>
            <summary className="small">Antwort-Entwurf</summary>
            <pre className="small" style={{ whiteSpace: "pre-wrap", userSelect: "all" }} data-testid="de-antwort">{antwortEntwurf({ name: z.angebot.name, titel: z.titel, ampel: z.ampel, empfohlen: z.empfohlen, ekNetto: z.ekNetto, maxEk: z.maxEk })}</pre>
          </details>
          {schreiben && (
            <form action={zeileAction} className="row small" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }} data-testid="de-zeile-form">
              <input type="hidden" name="id" value={e.id} /><input type="hidden" name="nr" value={z.nr} />
              <input name="asin" defaultValue={z.asin ?? ""} placeholder="ASIN" style={{ width: 120 }} />
              <input name="ean" defaultValue={z.angebot.ean ?? ""} placeholder="EAN" style={{ width: 130 }} />
              <input name="ek" defaultValue={z.angebot.ek !== null ? String(z.angebot.ek).replace(".", ",") : ""} placeholder="EK" style={{ width: 80 }} />
              <select name="netto" defaultValue={z.angebot.ekNetto === false ? "brutto" : "netto"}><option value="netto">netto</option><option value="brutto">brutto</option></select>
              <input name="menge" defaultValue={z.angebot.menge ?? z.angebot.moq ?? ""} placeholder="Menge" style={{ width: 70 }} />
              <input name="packung" defaultValue={z.angebot.packung ?? ""} placeholder="Pack" style={{ width: 60 }} />
              <button className="btn btn-sm" type="submit">neu rechnen</button>
            </form>
          )}
        </section>
        );
      })}

      {schreiben && e.pruefung === "fertig" && e.zeilen.some((z) => z.asin) && (() => {
        const z = e.zeilen.find((x) => x.nr === Number(sp.zeile)) ?? e.zeilen.filter((x) => x.asin).sort((a, b) => (a.ampel === "gruen" ? -1 : 0) - (b.ampel === "gruen" ? -1 : 0))[0];
        const link = angebotsLink(e.rohtext, z.asin, z.bestesLand);
        return (
          <section className="card card-pad stack" style={{ marginTop: 12, scrollMarginTop: 70 }} id="gekauft" data-testid="de-kaufen">
            <h2 style={{ margin: 0 }}>Kaufen{nrGueltig ? ` · Deal ${nrGueltig}` : ""}</h2>
            {sp.kauf && <div className="notice notice-warn small" data-testid="de-kauf-hinweis">{sp.kauf === "abgelaufen" ? "Die Deal-Nummer aus dem Push ist abgelaufen (24 Std.) – hier neu öffnen." : sp.kauf === "kein_link" ? "Für diesen Deal ist kein Einkaufs-Shop bekannt – Link aus der Nachricht nutzen." : "Deal-Nummer nicht gefunden."}</div>}
            {kauf && !e.gekauftAm && (
              <div className="stack" style={{ gap: 6 }} data-testid="de-kauf-link">
                <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <a className="btn btn-primary" href={`/k/${e.id}`} target="_blank" rel="noreferrer" data-testid="de-warenkorb">{kauf.warenkorb ? `In den Warenkorb (${kauf.menge})` : "Produktseite öffnen"}</a>
                  <span className="small">{kauf.shop}{kauf.warenkorb ? " · Warenkorb vorbereitet – „Jetzt kaufen“ tippst du selbst" : kauf.hinweis ? ` · ${kauf.hinweis}` : ""}</span>
                </div>
                {kauf.warenkorb && kauf.fallbackUrl && <div className="small muted">Warenkorb leer? <a href={`/k/${e.id}?produkt=1`} target="_blank" rel="noreferrer" data-testid="de-produktseite">Produktseite öffnen (Menge {kauf.menge} wählen)</a></div>}
                {kauf.gutschein && (
                  <div className={sp.code === "1" ? "notice notice-ok small row" : "small row"} style={{ gap: 8, alignItems: "center" }} data-testid="de-gutschein">
                    Gutschein aus dem Post: <code style={{ fontSize: 15 }}>{kauf.gutschein}</code> <CopyButton text={kauf.gutschein} label="Code kopieren" />
                  </div>
                )}
                {kauf.payback && <div className="small muted" data-testid="de-payback">Payback: {kauf.payback}{kauf.kuerzel === "AMZDE" ? <> · <Link href="/einstellungen/shop-profile">eingerichtet?</Link></> : null}</div>}
              </div>
            )}
            {e.kaufVorbereitetAm && !e.gekauftAm && <div className="small" data-testid="de-kauf-vorbereitet">Kauf vorbereitet ({e.kaufVorbereitetMenge ?? "?"} Stk) am {e.kaufVorbereitetAm.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })} – nach 24 Std. prüft das System die sellerboard-SKUs; gekauft? Dann unten eintragen.</div>}
            <div className="small muted">Gekauft wird nie automatisch (Kauf-Bots verstoßen gegen die Shop-Bedingungen). {link && <a href={link} target="_blank" rel="noreferrer" data-testid="de-angebot-link">Zum Angebot →</a>}{z.maxEk[0] ? ` · max. EK ${eur(z.maxEk[0].ek)}` : ""}{z.angebot.gueltigBis ? ` · gültig bis ${z.angebot.gueltigBis}` : ""}</div>
            <form action={gekauftAction} className="row small" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }} data-testid="de-gekauft-form">
              <input type="hidden" name="id" value={e.id} />
              <select name="nr" defaultValue={String(z.nr)} aria-label="Zeile">{e.zeilen.filter((x) => x.asin).map((x) => <option key={x.nr} value={x.nr}>{(x.titel ?? x.angebot.name ?? x.asin ?? "").slice(0, 40)}</option>)}</select>
              <label>Menge <input name="menge" inputMode="numeric" defaultValue={e.gekauftMenge ?? z.empfohlen ?? z.angebot.menge ?? ""} style={{ width: 70 }} required /></label>
              <label>Preis netto/Stk <input name="preis" inputMode="decimal" defaultValue={e.gekauftPreis !== null ? String(e.gekauftPreis).replace(".", ",") : z.ekNetto !== null ? String(z.ekNetto).replace(".", ",") : ""} style={{ width: 80 }} /></label>
              <label>Verpackung <select name="verpackung" defaultValue={e.verpackung ?? ""} data-testid="de-verpackung"><option value="">–</option>{DEAL_VERPACKUNG.map((v) => <option key={v} value={v}>{VERPACKUNG_TEXT[v]}</option>)}</select></label>
              <label>EAN weicht ab <select name="ean_abweichend" defaultValue={e.eanAbweichend === null ? "" : e.eanAbweichend ? "ja" : "nein"} data-testid="de-ean-abweichend"><option value="">–</option><option value="nein">Nein</option><option value="ja">Ja</option></select></label>
              {lieferantAuswahl("de-lieferant-wahl")}
              <label title={mitMail.length ? "Legt einen Entwurf an den Lieferanten an – gesendet wird erst mit „Senden“" : "Noch kein Lieferant mit Mailadresse – Deal-Eingang → Deal-Quellen"}>
                <input type="checkbox" name="bestellmail" value="1" defaultChecked={!!lieferant?.email && !bestellmails.some((m) => m.status === "gesendet")} disabled={!mitMail.length} data-testid="de-bestellmail-schalter" /> Bestellmail senden
              </label>
              <button className="btn btn-sm btn-primary" type="submit" data-testid="de-gekauft-knopf">Gekauft</button>
            </form>
            {!mitMail.length ? (
              <div className="small muted">Bestellmail an den Lieferanten: noch kein Lieferant mit Mailadresse hinterlegt – <Link href="/deal-eingang/quellen">Deal-Eingang → Deal-Quellen</Link>.</div>
            ) : !lieferant?.email ? (
              <div className="small muted" data-testid="de-lieferant-hinweis">
                {e.quelle ? `Zur Quelle „${e.quelle}“ passt kein Lieferant` : "Der Deal hat keine Quelle"} – für die Bestellmail oben den Lieferanten wählen und „Bestellmail senden“ anhaken. Ohne Quelle wird der Lieferant als Quelle gespeichert.
              </div>
            ) : null}
            {e.eanAbweichend && <div className="notice notice-warn small" data-testid="de-fnsku-hinweis">EAN weicht ab – FNSKU-Etikett nötig (Amazon-Barcode statt Hersteller-EAN).</div>}
            {e.gekauftAm && (
              <form action={wareAction} className="row small" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <input type="hidden" name="id" value={e.id} />
                <span className="muted">Ware:</span>
                <select name="verpackung" defaultValue={e.verpackung ?? ""} aria-label="Verpackung"><option value="">Verpackung –</option>{DEAL_VERPACKUNG.map((v) => <option key={v} value={v}>{VERPACKUNG_TEXT[v]}</option>)}</select>
                <select name="ean_abweichend" defaultValue={e.eanAbweichend === null ? "" : e.eanAbweichend ? "ja" : "nein"} aria-label="EAN weicht ab"><option value="">EAN weicht ab –</option><option value="nein">EAN gleich</option><option value="ja">EAN weicht ab</option></select>
                <button className="btn btn-sm" type="submit">Speichern</button>
              </form>
            )}
          </section>
        );
      })()}

      {(bestellmails.length > 0 || (schreiben && e.status === "gekauft" && mitMail.length > 0)) && (
        <section className="card card-pad stack" style={{ marginTop: 12, scrollMarginTop: 70 }} id="bestellmail" data-testid="de-bestellmail">
          <h2 style={{ margin: 0 }}>Bestellmail an den Lieferanten</h2>
          {bestellmails.map((m) =>
            m.status === "gesendet" ? (
              <div key={m.id} className="stack small" style={{ gap: 4 }} data-testid="de-bestellmail-gesendet">
                <div>
                  <span className="tag tag-ok">Bestellung gesendet</span> am {datum(m.gesendetAm)} an {m.an}
                  {m.kopieAn ? ` · Kopie an ${m.kopieAn}` : ""} · Zustellstatus: gesendet
                </div>
                <div data-testid="de-bestellmail-antwort">
                  {m.antwortAm ? (
                    <>
                      Antwort am {datum(m.antwortAm)}
                      {m.sendungsnummer ? <> · Sendungsnummer <strong data-testid="de-bestellmail-sendungsnr">{m.sendungsnummer}</strong></> : ""}
                      {m.rechnungErhalten ? " · Rechnung erhalten" : " · Rechnung noch offen"}
                      {m.antwortId && <> · <Link href={`/posteingang/${m.antwortId}`}>Mail öffnen</Link></>}
                    </>
                  ) : (
                    <span className="muted">Noch keine Antwort (Rechnung, Sendungsnummer) – wird über den Posteingang zugeordnet.</span>
                  )}
                </div>
                <details><summary>Gesendeter Text</summary><div style={{ fontWeight: 600 }}>{m.betreff}</div><pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{m.text}</pre></details>
              </div>
            ) : schreiben ? (
              <form key={m.id} action={bestellmailAction} className="stack small" style={{ gap: 6 }} data-testid="de-bestellmail-entwurf">
                <input type="hidden" name="id" value={e.id} />
                <input type="hidden" name="mail_id" value={m.id} />
                {m.status === "fehler" && <div className="notice notice-warn">Nicht gesendet: {m.fehler}</div>}
                <div className="muted">Entwurf – wird erst mit „Senden“ verschickt (Absender: dein Geschäfts-Postfach, Kopie an dich).</div>
                <label>An <input name="an" defaultValue={m.an} style={{ width: "100%", maxWidth: 420 }} data-testid="de-bestellmail-an" /></label>
                <label>Betreff <input name="betreff" defaultValue={m.betreff} style={{ width: "100%" }} data-testid="de-bestellmail-betreff" /></label>
                <textarea name="text" defaultValue={m.text} rows={18} style={{ width: "100%", fontFamily: "inherit" }} data-testid="de-bestellmail-text" />
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn btn-sm btn-primary" type="submit" name="aktion" value="senden" data-testid="de-bestellmail-senden">Senden</button>
                  <button className="btn btn-sm" type="submit" name="aktion" value="speichern">Entwurf speichern</button>
                  <button className="btn btn-sm" type="submit" name="aktion" value="verwerfen">Verwerfen</button>
                </div>
              </form>
            ) : null,
          )}
          {schreiben && e.status === "gekauft" && mitMail.length > 0 && !bestellmails.some((m) => m.status === "entwurf" || m.status === "fehler") && (
            <form action={bestellmailEntwurfAction} className="row small" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <input type="hidden" name="id" value={e.id} />
              {lieferantAuswahl("de-bestellmail-lieferant")}
              <button className="btn btn-sm" type="submit" data-testid="de-bestellmail-neu">{bestellmails.length ? "Weitere Bestellmail (Entwurf)" : "Bestellmail (Entwurf) erstellen"}</button>
            </form>
          )}
        </section>
      )}

      {schreiben && e.pruefung === "fertig" && (
        <section className="card card-pad stack" style={{ marginTop: 12, scrollMarginTop: 70 }} id="bewerten" data-testid="de-bewerten">
          <h2 style={{ margin: 0 }}>Passt der Deal zu dir?</h2>
          <div className="small muted">Deine 👍/👎 lernt der Deal-Wert mit – auch per Reaktion in Discord (ProfitPath-Nachricht; nach 👍 fragt der Bot im Thread kurz nach dem Grund). Ein 👍 mit Grund zählt mehr als ein 👍 ohne.</div>
          <form action={bewertenAction} className="stack small de-bewerten" style={{ gap: 6 }}>
            <input type="hidden" name="id" value={e.id} />
            <input type="hidden" name="weg" value={sp.daumen ? "push" : "tool"} />
            <div className="row" style={{ gap: 10 }}>
              <label><input type="radio" name="daumen" value="hoch" defaultChecked={(sp.daumen ?? e.daumen) === "hoch"} data-testid="de-daumen-hoch" /> 👍</label>
              <label><input type="radio" name="daumen" value="runter" defaultChecked={(sp.daumen ?? e.daumen) === "runter"} data-testid="de-daumen-runter" /> 👎</label>
            </div>
            <fieldset className="de-gruende-hoch" data-testid="de-gruende-hoch" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="muted">Warum passt der Deal? (👍, mehrere möglich)</legend>
              {DAUMEN_GRUENDE_HOCH.map((g, i) => (
                <label key={g} style={{ display: "block" }}>
                  <input type="checkbox" name="gruende" value={g} defaultChecked={e.daumenGruende.includes(g)} data-testid={`de-grund-hoch-${i + 1}`} /> {g}
                </label>
              ))}
            </fieldset>
            <label className="de-grund-runter">Grund bei 👎 <select name="grund" defaultValue={e.daumenGrund ?? ""} aria-label="Grund"><option value="">(optional)</option>{DAUMEN_GRUENDE.map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
            <label>Freitext (optional) <input name="freitext" defaultValue={e.daumenFreitext ?? ""} maxLength={500} style={{ width: "100%", maxWidth: 420 }} data-testid="de-grund-freitext" /></label>
            <div><button className="btn btn-sm" type="submit" data-testid="de-bewerten-knopf">Speichern</button></div>
          </form>
        </section>
      )}

      {schreiben && e.pruefung === "fertig" && (
        <section className="card card-pad row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap", alignItems: "center" }} data-testid="de-entscheidung">
          <form action={bestellvorschlagAction}><input type="hidden" name="id" value={e.id} /><button className="btn btn-sm" type="submit" data-testid="de-bestellvorschlag" title="Einkaufsentwurf beim Lieferanten (Quelle) mit der empfohlenen Menge – alle nicht roten Zeilen mit ASIN (sind alle rot: alle)">In Bestellvorschläge übernehmen</button></form>
          <form action={b2bAction}><input type="hidden" name="id" value={e.id} /><button className="btn btn-sm" type="submit" data-testid="de-b2b" title="Entwurf eines B2B-Deals (beste Zeile) – Preis je Kunde und Freischalten im B2B-Bereich">Als B2B-Deal anlegen</button></form>
          <form action={statusAction} className="row" style={{ gap: 6 }}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="status" value="verworfen" /><input name="grund" placeholder="Grund" style={{ width: 200 }} /><button className="btn btn-sm" type="submit">Verworfen</button></form>
        </section>
      )}
    </>
  );
}

/** Buy Box der letzten 90 Tage (Linie), Amazon gestrichelt; darunter Ø, Tief, Hoch, aktuell und Datenstand. */
