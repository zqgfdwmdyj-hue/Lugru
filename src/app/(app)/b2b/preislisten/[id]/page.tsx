import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireArea } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { SubmitButton } from "@/components/submit-button";
import { preislisteAuswerten } from "@/lib/b2b/scanner";
import { nachladenAction } from "../actions";
import { b2bPrepJeStueck } from "@/lib/shipping/prep";
import { profitgoLink } from "@/lib/deal-ampel/logic";

const eur = (n: number | null | undefined, w = "EUR") => (n === null || n === undefined ? "–" : `${n.toFixed(2).replace(".", ",")} ${w === "EUR" ? "€" : w === "GBP" ? "£" : w}`);
const AMPEL = { gruen: ["tag-ok", "grün"], gelb: ["tag-warn", "gelb"], rot: ["tag-danger", "rot"] } as const;

type Sp = { meldung?: string; ampel?: string; land?: string; minroi?: string; minverk?: string; maxang?: string; ohneamazon?: string; q?: string };

export default async function ScannerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Sp> }) {
  const session = await requireArea("b2b");
  const { id } = await params;
  const sp = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const a = await preislisteAuswerten(session.tenantId, id);
  if (!a) notFound();
  const s = await getSettings(session.tenantId);
  const minRoi = Number(sp.minroi) || null;
  const minVerk = Number(sp.minverk) || null;
  const maxAng = Number(sp.maxang) || null;
  const q = (sp.q ?? "").trim().toLowerCase();
  const zeilen = a.zeilen
    .map((z) => ({ z, l: sp.land ? (z.laender.find((x) => x.land === sp.land) ?? null) : z.bester }))
    .filter(({ z, l }) => (!sp.ampel || z.ampel === sp.ampel) && (!q || `${z.titel} ${z.ean ?? ""} ${z.asin ?? ""} ${z.sku}`.toLowerCase().includes(q)))
    .filter(({ l }) => (!minRoi || (l?.roiBeiEk ?? -Infinity) >= minRoi) && (!minVerk || (l?.verkaeufe ?? 0) >= minVerk) && (!maxAng || (l?.angebote ?? Infinity) <= maxAng) && (!sp.ohneamazon || (l?.amazonProzent ?? 0) < 20))
    .sort((x, y) => ({ gruen: 0, gelb: 1, rot: 2 })[x.z.ampel] - ({ gruen: 0, gelb: 1, rot: 2 })[y.z.ampel] || (y.l?.vorschlag.marge ?? -999) - (x.l?.vorschlag.marge ?? -999));
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== "meldung" && v) as [string, string][]).toString();
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/b2b/preislisten">Preislisten</Link></div><h1>{a.feed.name}</h1></div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <a className="btn" href={`/b2b/preislisten/${id}/export?${qs}`} data-testid="scan-export">Export (CSV)</a>
          <form action={nachladenAction}><input type="hidden" name="feedId" value={id} /><SubmitButton className="btn" label="Marktdaten nachladen" pendingLabel="Lade …" /></form>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-info" data-testid="scan-meldung">{sp.meldung}</div>}
      <div className="small" data-testid="scan-stand">
        {a.stand.angebote} Angebote · {a.stand.mitAsin} mit ASIN · {a.stand.mitDaten} mit Marktdaten ({a.laender.join(", ")}){a.stand.offen ? ` · ${a.stand.offen} Länder-Abfragen offen (laufen im Hintergrund)` : ""}. NL/BE/PL/SE: im Deal live über Amazon.
      </div>
      <form method="get" className="card card-pad" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
        <div className="field"><label className="label" htmlFor="q">Suche</label><input className="input" id="q" name="q" defaultValue={sp.q ?? ""} style={{ width: 160 }} /></div>
        <div className="field"><label className="label" htmlFor="ampel">Ampel</label><select className="input" id="ampel" name="ampel" defaultValue={sp.ampel ?? ""} style={{ width: 100 }}><option value="">alle</option><option value="gruen">grün</option><option value="gelb">gelb</option><option value="rot">rot</option></select></div>
        <div className="field"><label className="label" htmlFor="land">Land</label><select className="input" id="land" name="land" defaultValue={sp.land ?? ""} style={{ width: 100 }}><option value="">bestes</option>{a.laender.map((l) => <option key={l} value={l}>{l}</option>)}</select></div>
        <div className="field"><label className="label" htmlFor="minroi">ROI bei EK ab %</label><input className="input" id="minroi" name="minroi" inputMode="numeric" defaultValue={sp.minroi ?? ""} style={{ width: 70 }} /></div>
        <div className="field"><label className="label" htmlFor="minverk">Verk./Monat ab</label><input className="input" id="minverk" name="minverk" inputMode="numeric" defaultValue={sp.minverk ?? ""} style={{ width: 70 }} /></div>
        <div className="field"><label className="label" htmlFor="maxang">Angebote bis</label><input className="input" id="maxang" name="maxang" inputMode="numeric" defaultValue={sp.maxang ?? ""} style={{ width: 70 }} /></div>
        <label className="check small"><input type="checkbox" name="ohneamazon" defaultChecked={!!sp.ohneamazon} /> Amazon selten in der Buy Box</label>
        <button className="btn" type="submit">Filtern</button>
      </form>
      <section className="card" style={{ overflow: "auto" }}>
        <table className="table" data-testid="scan-tabelle">
          <thead><tr><th>Ampel</th><th>Artikel</th><th className="right">EK/Verkauf</th><th>Land</th><th className="right">Buy Box / Ø90 / Tief</th><th className="right">Verk./M.</th><th className="right">Angeb.</th><th className="right">Amazon</th><th className="right">Gewinn / ROI bei EK</th><th className="right">Kundenpreis-Vorschlag</th><th></th></tr></thead>
          <tbody>
            {zeilen.length === 0 && <tr><td colSpan={11} className="muted">Keine Treffer.</td></tr>}
            {zeilen.slice(0, 300).map(({ z, l }) => (
              <tr key={z.offerId} data-testid="scan-zeile" data-asin={z.asin ?? ""}>
                <td><span className={`tag ${AMPEL[z.ampel][0]}`}>{AMPEL[z.ampel][1]}</span></td>
                <td style={{ maxWidth: 300 }}>
                  <div style={{ fontWeight: 600 }}>{z.titel}</div>
                  <div className="small muted num">{z.asin ? <a href={`https://www.amazon.de/dp/${z.asin}`} target="_blank" rel="noreferrer">{z.asin}</a> : "keine ASIN"}{profitgoLink(s.dealAmpel.profitgoVorlage, z.asin) && <> · <a href={profitgoLink(s.dealAmpel.profitgoVorlage, z.asin)!} target="_blank" rel="noreferrer noopener" data-testid="scan-profitgo">ProfitGo</a></>}{z.ean ? ` · ${z.ean}` : ""}{z.bestand !== null ? ` · Bestand ${z.bestand}` : ""}{z.moq ? ` · MOQ ${z.moq}` : ""}</div>
                  {z.warnungen.map((w) => <div key={w} className="small" style={{ color: "var(--warn)" }}>{w}</div>)}
                  {z.fehlend.length > 0 && <div className="small muted">Marktdaten fehlen: {z.fehlend.join(", ")}</div>}
                </td>
                <td className="num right">{eur(z.ekJeVerkauf)}</td>
                <td><b>{l?.land ?? "–"}</b></td>
                <td className="num right small">{eur(l?.vk, l?.waehrung)}<div className="muted">{eur(l?.vk90, l?.waehrung)} / {eur(l?.tief12, l?.waehrung)}</div></td>
                <td className="num right">{l?.verkaeufe ?? "–"}</td>
                <td className="num right">{l?.angebote ?? "–"}</td>
                <td className="num right">{l?.amazonProzent === null || l?.amazonProzent === undefined ? "–" : `${Math.round(l.amazonProzent)} %`}</td>
                <td className="num right">{eur(l?.gewinnBeiEk)}<div className="small muted">{l?.roiBeiEk === null || l?.roiBeiEk === undefined ? "–" : `${l.roiBeiEk.toFixed(0)} %`} · Geb. {eur(l?.gebuehren)}</div></td>
                <td className="num right">{eur(l?.vorschlag.preis)}<div className="small muted">{l?.vorschlag.marge === null || l?.vorschlag.marge === undefined ? "" : `uns ${l.vorschlag.marge.toFixed(0)} %`}</div></td>
                <td className="small">{z.dealId ? <Link href={`/b2b/${z.dealId}`}>Deal →</Link> : z.asin ? <Link href={`/b2b/neu?angebot=${z.offerId}`} data-testid="scan-deal">Deal anlegen</Link> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="small muted">Kundenpreis-Vorschlag: höchster Preis, bei dem der Kunde im Land noch {Math.round(s.b2b.minKundenRoi * 100)} % ROI hat (inkl. Prep {eur(b2bPrepJeStueck(s.b2b.prepGebuehr, s.prep.preisliste).betrag)}). Ampel grün: unsere Marge ≥ {Math.round(s.b2b.minMarge * 100)} % und Amazon selten in der Buy Box; gelb: knapp, Amazon stark oder Warnungen; rot: kein Spielraum. Gebühren aus Keepa bzw. Standard (Einstellungen). Marktdaten höchstens 24 Std. alt.</div>
    </>
  );
}
