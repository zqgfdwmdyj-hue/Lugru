import Link from "next/link";
import { notFound } from "next/navigation";
import { requireArea } from "@/lib/auth/session";
import { AMPEL_EMOJI, antwortEntwurf } from "@/lib/deal-eingang/logic";
import { eingang, keepaVerlaufAusCache, STATUS_TEXT } from "@/lib/deal-eingang/service";
import { miniChart, type MiniChart } from "@/lib/deal-eingang/chart-logic";
import { KeepaMini } from "../keepa-mini";
import { formatEuro } from "@/lib/numbers";
import { AutoRefresh } from "../../lieferanten/finden/refresh";
import { neuPruefenAction, statusAction, zeileAction, bestellvorschlagAction, b2bAction, gekauftAction, bewertenAction } from "../actions";
import { DAUMEN_GRUENDE } from "@/db/tables/deal-eingang";
import { angebotsLink } from "@/lib/deal-eingang/kauf-logic";

const eur = (n: number | null | undefined) => (n === null || n === undefined ? "–" : formatEuro(n));
const pz = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${String(Math.round(n * 10) / 10).replace(".", ",")} %`);

export default async function DealEingangDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ meldung?: string; zeile?: string; daumen?: string }> }) {
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
  const bilder = e.dateiIds.map((fid, i) => ({ id: fid, name: e.dateiNamen[i] ?? `Datei ${i + 1}` }));
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
        {e.gekauftAm && <div className="small" data-testid="de-gekauft">Gekauft: {e.gekauftMenge} Stk{e.gekauftPreis !== null ? ` zu ${eur(e.gekauftPreis)} netto` : ""} am {e.gekauftAm.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })} ({e.gekauftWeg === "mail" ? "Bestellbestätigung per Mail" : e.gekauftWeg === "claude" ? "über Claude" : e.gekauftWeg === "sprache" || e.gekauftWeg === "sms" ? "per Sprache/SMS" : "von Hand"}){e.bestellungId ? <> · <Link href={`/einkauf/${e.bestellungId}`}>Bestellung (Wareneingang, Rechnung)</Link></> : null}</div>}
        {e.daumen && <div className="small" data-testid="de-daumen">{e.daumen === "hoch" ? "👍" : "👎"}{e.daumenGrund ? ` ${e.daumenGrund}` : ""} ({e.daumenWeg === "discord" ? "Discord" : e.daumenWeg === "push" ? "Push" : e.daumenWeg === "claude" ? "Claude" : "Seite"})</div>}
        {e.ergebnis && <div className="small" data-testid="de-ergebnis">Ergebnis nach {e.ergebnis.tage} Tagen: {e.ergebnis.verkauft} verkauft{e.ergebnis.erstattet ? `, ${e.ergebnis.erstattet} erstattet` : ""}{e.ergebnis.oVk !== null ? `, Ø VK ${eur(e.ergebnis.oVk)}` : ""}{e.ergebnis.realerRoi !== null ? `, realer ROI ${pz(e.ergebnis.realerRoi)}` : ""}{e.ergebnis.tageBisAbverkauf !== null ? `, abverkauft nach ${e.ergebnis.tageBisAbverkauf} T` : ""}</div>}
      </div>

      {e.zeilen.map((z) => (
        <section key={z.nr} className="card card-pad stack" style={{ marginTop: 12 }} data-testid="de-zeile" data-nr={z.nr} data-ampel={z.ampel} data-asin={z.asin ?? ""}>
          <h2 style={{ margin: 0 }}>{AMPEL_EMOJI[z.ampel]} {z.titel ?? z.angebot.name ?? z.asin ?? `Angebot ${z.nr}`}</h2>
          <div className="small">
            {z.asin ? <a href={`https://www.amazon.de/dp/${z.asin}`} target="_blank" rel="noreferrer">{z.asin}</a> : "keine ASIN"}
            {z.zuordnung !== "asin" && z.asin ? ` (über ${z.zuordnung === "ean" ? "EAN" : "Titelsuche"})` : ""} · EK {z.ekNetto !== null ? `${eur(z.ekNetto)} netto` : "fehlt"}
            {z.bestesLand ? ` · bestes Land ${z.bestesLand}: ${eur(z.gewinn)}/Stk, ROI ${pz(z.roi)}, Marge ${pz(z.marge)}` : ""}
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
          {z.maxEk.length > 0 && <div className="small" data-testid="de-maxek">Max. EK für Ziel-ROI: {z.maxEk.map((m) => `${m.land} ${eur(m.ek)}`).join(" · ")}</div>}
          {z.eigen && <div className="small muted">Eigene Lage: {z.eigen.bestand} auf Lager{z.eigen.unterwegs ? `, ${z.eigen.unterwegs} unterwegs` : ""}{z.eigen.reichweite !== null ? `, Reichweite ${z.eigen.reichweite >= 9999 ? "∞" : `${z.eigen.reichweite} T`}` : ""}{z.eigen.kapitalAmpel ? `, Kapital-Ampel ${AMPEL_EMOJI[z.eigen.kapitalAmpel]}` : ""}{z.eigen.letzterEk ? `, letzter EK ${eur(z.eigen.letzterEk)}` : ""}{z.eigen.bestellvorschlag ? ", Bestellvorschlag offen" : ""}{z.eigen.verlustStopp ? `, ${z.eigen.verlustStopp}` : ""}</div>}
          {z.laender.length > 0 && (
            <div className="table-wrap">
              <table className="table small">
                <thead><tr><th>Land</th><th>Buy Box</th><th>Ø 90 T</th><th>Tief 12 M</th><th>Verk./Monat</th><th>Angebote</th><th>Amazon</th><th>Gewinn</th><th>ROI</th><th>max. EK</th></tr></thead>
                <tbody>
                  {z.laender.map((l) => (
                    <tr key={l.land}><td>{l.land}</td><td>{eur(l.vkEur)}</td><td>{eur(l.vk90Eur)}</td><td>{eur(l.tief12Eur)}</td><td>{l.verkaeufeMonat ?? "–"}</td><td>{l.angebote ?? "–"}</td><td>{l.amazonProzent !== null ? `${l.amazonProzent} %` : "–"}</td><td>{eur(l.gewinn)}</td><td>{pz(l.roi)}</td><td>{eur(l.maxEk)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {z.vorschlaege.length > 1 && <div className="small muted">Weitere Treffer: {z.vorschlaege.map((v) => `${v.asin} (${v.titel.slice(0, 40)})`).join(" · ")}</div>}
          {z.risiken.length > 0 && <div className="small muted">{z.risiken.join(" · ")}</div>}
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
      ))}

      {schreiben && e.pruefung === "fertig" && e.zeilen.some((z) => z.asin) && (() => {
        const z = e.zeilen.find((x) => x.nr === Number(sp.zeile)) ?? e.zeilen.filter((x) => x.asin).sort((a, b) => (a.ampel === "gruen" ? -1 : 0) - (b.ampel === "gruen" ? -1 : 0))[0];
        const link = angebotsLink(e.rohtext, z.asin, z.bestesLand);
        return (
          <section className="card card-pad stack" style={{ marginTop: 12, scrollMarginTop: 70 }} id="gekauft" data-testid="de-kaufen">
            <h2 style={{ margin: 0 }}>Kaufen</h2>
            <div className="small muted">Gekauft wird nie automatisch (Kauf-Bots verstoßen gegen die Shop-Bedingungen). {link && <a href={link} target="_blank" rel="noreferrer" data-testid="de-angebot-link">Zum Angebot →</a>}{z.maxEk[0] ? ` · max. EK ${eur(z.maxEk[0].ek)}` : ""}{z.angebot.gueltigBis ? ` · gültig bis ${z.angebot.gueltigBis}` : ""}</div>
            <form action={gekauftAction} className="row small" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }} data-testid="de-gekauft-form">
              <input type="hidden" name="id" value={e.id} />
              <select name="nr" defaultValue={String(z.nr)} aria-label="Zeile">{e.zeilen.filter((x) => x.asin).map((x) => <option key={x.nr} value={x.nr}>{(x.titel ?? x.angebot.name ?? x.asin ?? "").slice(0, 40)}</option>)}</select>
              <label>Menge <input name="menge" inputMode="numeric" defaultValue={e.gekauftMenge ?? z.empfohlen ?? z.angebot.menge ?? ""} style={{ width: 70 }} required /></label>
              <label>Preis netto/Stk <input name="preis" inputMode="decimal" defaultValue={e.gekauftPreis !== null ? String(e.gekauftPreis).replace(".", ",") : z.ekNetto !== null ? String(z.ekNetto).replace(".", ",") : ""} style={{ width: 80 }} /></label>
              <button className="btn btn-sm btn-primary" type="submit" data-testid="de-gekauft-knopf">Gekauft</button>
            </form>
          </section>
        );
      })()}

      {schreiben && e.pruefung === "fertig" && (
        <section className="card card-pad stack" style={{ marginTop: 12, scrollMarginTop: 70 }} id="bewerten" data-testid="de-bewerten">
          <h2 style={{ margin: 0 }}>Passt der Deal zu dir?</h2>
          <div className="small muted">Deine 👍/👎 lernt der Deal-Wert mit – auch per Reaktion in Discord (ProfitPath-Nachricht).</div>
          <form action={bewertenAction} className="row small" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <input type="hidden" name="id" value={e.id} />
            <input type="hidden" name="weg" value={sp.daumen ? "push" : "tool"} />
            <label><input type="radio" name="daumen" value="hoch" defaultChecked={(sp.daumen ?? e.daumen) === "hoch"} /> 👍</label>
            <label><input type="radio" name="daumen" value="runter" defaultChecked={(sp.daumen ?? e.daumen) === "runter"} /> 👎</label>
            <select name="grund" defaultValue={e.daumenGrund ?? ""} aria-label="Grund"><option value="">Grund (optional)</option>{DAUMEN_GRUENDE.map((g) => <option key={g} value={g}>{g}</option>)}</select>
            <button className="btn btn-sm" type="submit" data-testid="de-bewerten-knopf">Speichern</button>
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
