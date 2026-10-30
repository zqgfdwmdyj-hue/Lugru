import Link from "next/link";
import { notFound } from "next/navigation";
import { requireArea } from "@/lib/auth/session";
import { AMPEL_EMOJI, antwortEntwurf } from "@/lib/deal-eingang/logic";
import { eingang, STATUS_TEXT } from "@/lib/deal-eingang/service";
import { formatEuro } from "@/lib/numbers";
import { AutoRefresh } from "../../lieferanten/finden/refresh";
import { neuPruefenAction, statusAction, zeileAction, bestellvorschlagAction, b2bAction } from "../actions";

const eur = (n: number | null | undefined) => (n === null || n === undefined ? "–" : formatEuro(n));
const pz = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${String(Math.round(n * 10) / 10).replace(".", ",")} %`);

export default async function DealEingangDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("dealeingang");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const e = await eingang(session.tenantId, id);
  if (!e) notFound();
  const laeuft = e.pruefung === "offen" || e.pruefung === "laeuft";
  const schreiben = !session.readOnly;
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
          {e.dateiNamen.length > 0 && <div className="small muted">{e.dateiNamen.join(", ")}</div>}
        </details>
        <div className="small muted">Status: {STATUS_TEXT[e.status]}{e.grund ? ` – ${e.grund}` : ""}</div>
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

      {schreiben && e.pruefung === "fertig" && (
        <section className="card card-pad row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap", alignItems: "center" }} data-testid="de-entscheidung">
          <form action={statusAction}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="status" value="gekauft" /><button className="btn btn-sm" type="submit">Gekauft</button></form>
          <form action={bestellvorschlagAction}><input type="hidden" name="id" value={e.id} /><button className="btn btn-sm" type="submit" data-testid="de-bestellvorschlag" title="Einkaufsentwurf beim Lieferanten (Quelle) mit der empfohlenen Menge – alle nicht roten Zeilen mit ASIN (sind alle rot: alle)">In Bestellvorschläge übernehmen</button></form>
          <form action={b2bAction}><input type="hidden" name="id" value={e.id} /><button className="btn btn-sm" type="submit" data-testid="de-b2b" title="Entwurf eines B2B-Deals (beste Zeile) – Preis je Kunde und Freischalten im B2B-Bereich">Als B2B-Deal anlegen</button></form>
          <form action={statusAction} className="row" style={{ gap: 6 }}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="status" value="verworfen" /><input name="grund" placeholder="Grund" style={{ width: 200 }} /><button className="btn btn-sm" type="submit">Verworfen</button></form>
        </section>
      )}
    </>
  );
}
