import { requireArea } from "@/lib/auth/session";
import { AMPEL_TEXT, profitgoLink } from "@/lib/deal-ampel/logic";
import { dealPruefen, type DealPruefung } from "@/lib/deal-ampel/service";
import { parseAmount } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { dealAmpelEinstellungenAction } from "./actions";

// Deal-Ampel (Einkaufs-Prüfung): ein Deal – z. B. aus der Deal-Gruppe – in Sekunden bewerten.

const eur = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${n.toFixed(2).replace(".", ",")} €`);
/** Prozent im deutschen Format („1,9 %“), höchstens eine Nachkommastelle. */
const pz = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${n.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`);
const AMPEL_TAG = { gruen: "tag-ok", gelb: "tag-warn", rot: "tag-danger" } as const;

export default async function DealAmpelPage({ searchParams }: { searchParams: Promise<{ code?: string; ek?: string; netto?: string; menge?: string; laender?: string; gespeichert?: string }> }) {
  const session = await requireArea("lieferanten");
  const sp = await searchParams;
  const s = await getSettings(session.tenantId);
  const code = (sp.code ?? "").trim();
  const ek = parseAmount(sp.ek ?? "");
  const menge = sp.menge ? Math.max(0, Math.round(parseAmount(sp.menge) ?? 0)) || null : null;
  const laender = (sp.laender ?? "").split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x));
  let r: DealPruefung | null = null;
  let fehler: string | null = null;
  if (code && ek) {
    try {
      r = await dealPruefen(session.tenantId, { code, ek, ekIstNetto: sp.netto === "1", menge, laender });
    } catch (e) {
      fehler = e instanceof Error ? e.message : String(e);
    }
  } else if (code || sp.ek) fehler = "Bitte ASIN/EAN/Link und Einkaufspreis eingeben.";

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Einkauf & Lieferanten</div>
          <h1>Deal-Ampel</h1>
          <div className="small muted">Einkauf in Sekunden prüfen: Gewinn je Land, Abverkauf, empfohlene Menge.</div>
        </div>
      </div>
      <form className="card card-pad" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginBottom: 14 }} data-testid="deal-ampel-form">
        <label className="small" style={{ flex: 2, minWidth: 220 }}>ASIN, EAN oder Amazon-Link<input name="code" defaultValue={code} required data-testid="deal-ampel-code" /></label>
        <label className="small" style={{ width: 120 }}>Einkaufspreis €<input name="ek" defaultValue={sp.ek ?? ""} required inputMode="decimal" data-testid="deal-ampel-ek" /></label>
        <label className="small">
          Preis ist
          <select name="netto" defaultValue={sp.netto === "1" ? "1" : "0"}>
            <option value="0">brutto</option>
            <option value="1">netto</option>
          </select>
        </label>
        <label className="small" style={{ width: 90 }}>Menge<input name="menge" defaultValue={sp.menge ?? ""} inputMode="numeric" data-testid="deal-ampel-menge" /></label>
        <label className="small" style={{ width: 150 }}>Länder<input name="laender" defaultValue={sp.laender ?? s.dealAmpel.laender.join(" ")} /></label>
        <button className="btn btn-primary" type="submit" data-testid="deal-ampel-pruefen">Prüfen</button>
      </form>
      {sp.gespeichert && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>Ziele gespeichert.</div>}
      {fehler && <div className="notice notice-warn small" role="alert">{fehler}</div>}
      {r && (
        <section className="stack" style={{ gap: 12 }} data-testid="deal-ampel-ergebnis">
          <div className="card card-pad">
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span className={`tag ${AMPEL_TAG[r.ampel]}`} style={{ fontSize: 15, padding: "4px 10px" }} data-testid="deal-ampel" data-ampel={r.ampel}>{AMPEL_TEXT[r.ampel]}</span>
              <strong>{r.titel ?? r.asin}</strong>
              <a className="small" href={`https://www.amazon.de/dp/${r.asin}`} target="_blank" rel="noreferrer noopener">{r.asin}</a>
              <a className="small" href={`https://keepa.com/#!product/3-${r.asin}`} target="_blank" rel="noreferrer noopener">Keepa</a>
              {profitgoLink(s.dealAmpel.profitgoVorlage, r.asin) && <a className="small" href={profitgoLink(s.dealAmpel.profitgoVorlage, r.asin)!} target="_blank" rel="noreferrer noopener" data-testid="deal-ampel-profitgo">in ProfitGo öffnen</a>}
            </div>
            <p style={{ margin: "10px 0 0", maxWidth: 880 }} data-testid="deal-ampel-begruendung">{r.begruendung}</p>
            <div className="small muted" style={{ marginTop: 6 }}>
              EK netto {eur(r.ekNetto)}{s.dealAmpel.nebenkosten ? ` + ${eur(s.dealAmpel.nebenkosten)} Nebenkosten` : ""} · Gebühren: Provision {Math.round(r.gebuehren.provision * 100)} %, FBA {eur(r.gebuehren.fba)}{r.gebuehren.geschaetzt ? " (geschätzt)" : ""}
              {r.abverkauf.empfohlen && <> · empfohlene Menge <strong data-testid="deal-ampel-menge-empfohlen">{r.abverkauf.empfohlen.von}–{r.abverkauf.empfohlen.bis}</strong> (30–45 Tage)</>}
            </div>
            {r.hinweise.length > 0 && <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18 }}>{r.hinweise.map((h, i) => <li key={i}>{h}</li>)}</ul>}
          </div>
          <div className="table-wrap card">
            <table className="table" data-testid="deal-ampel-laender">
              <thead>
                <tr>
                  <th>Land</th>
                  <th className="right">Buy Box</th>
                  <th className="right">Ø 90 T.</th>
                  <th className="right">Tief 12 M.</th>
                  <th className="right">Gewinn jetzt</th>
                  <th className="right">Gewinn Ø 90</th>
                  <th className="right">Marge Ø 90</th>
                  <th className="right" title="Verkäufe aller Anbieter im Monat (Keepa); ≈ = geschätzt, dieselbe Zahl wie im Text">Verkäufe/Monat</th>
                  <th className="right">Angebote</th>
                  <th className="right">Amazon</th>
                  <th>Hinweis</th>
                </tr>
              </thead>
              <tbody>
                {r.laender.map((l) => (
                  <tr key={l.land} style={r.bestes?.land === l.land ? { fontWeight: 600 } : undefined}>
                    <td>{l.land}{r.bestes?.land === l.land ? " ★" : ""}</td>
                    <td className="num right">{eur(l.vkEur)}</td>
                    <td className="num right">{eur(l.vk90Eur)}</td>
                    <td className="num right">{eur(l.tief12Eur)}</td>
                    <td className="num right">{eur(l.aktuell?.gewinn)}</td>
                    <td className="num right">{eur(l.schnitt90?.gewinn)}</td>
                    <td className="num right">{pz(l.schnitt90?.marge)}</td>
                    <td className="num right" data-testid={r.bestes?.land === l.land ? "deal-ampel-verkaeufe-bestes" : undefined}>{l.verkaeufeMonat ?? (r.bestes?.land === l.land && r.verkaeufeGeschaetzt ? <span title={`geschätzt aus ${r.verkaeufeGeschaetzt.aus} über die Marktgröße – dieselbe Zahl wie im Text`}>≈ {r.verkaeufeGeschaetzt.wert}</span> : "–")}</td>
                    <td className="num right">{l.angebote ?? "–"}</td>
                    <td className="num right">{pz(l.amazonProzent)}</td>
                    <td className="small">{[l.aktionsmuster, l.fehler].filter(Boolean).join(" · ") || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="small muted">
            Gewinn je Stück = Buy Box netto (USt des Landes) − Provision − FBA − EK netto − Nebenkosten. Ampel: Rot bei Marge unter {s.dealAmpel.zielMarge} % beim 90-Tage-Mittel, Amazon ≥ 80 % in der Buy Box, Preisverfall ≥ {s.dealAmpel.preisverfallProzent * 2} % oder mehr als {s.dealAmpel.maxAngebote} Angeboten; Grün nur ohne Warnzeichen und mit Abverkauf ≤ {s.dealAmpel.maxAbverkaufTage} Tagen. <a href="#ziele">Ziele einstellen</a>
          </div>
        </section>
      )}
      {session.role === "owner" && (
        <details className="card card-pad" style={{ marginTop: 14 }} id="ziele">
          <summary><strong>Ziele der Ampel</strong></summary>
          <form action={dealAmpelEinstellungenAction} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginTop: 8 }}>
            <label className="small">Zielmarge %<input name="zielMarge" defaultValue={s.dealAmpel.zielMarge} style={{ width: 70 }} /></label>
            <label className="small">Abverkauf max. Tage<input name="maxAbverkaufTage" defaultValue={s.dealAmpel.maxAbverkaufTage} style={{ width: 70 }} /></label>
            <label className="small">Angebote max.<input name="maxAngebote" defaultValue={s.dealAmpel.maxAngebote} style={{ width: 70 }} /></label>
            <label className="small">Amazon ab % gelb<input name="amazonMaxProzent" defaultValue={s.dealAmpel.amazonMaxProzent} style={{ width: 70 }} /></label>
            <label className="small">Preisverfall ab % gelb<input name="preisverfallProzent" defaultValue={s.dealAmpel.preisverfallProzent} style={{ width: 70 }} /></label>
            <label className="small">Nebenkosten €/Stück<input name="nebenkosten" defaultValue={String(s.dealAmpel.nebenkosten).replace(".", ",")} style={{ width: 80 }} /></label>
            <label className="small">Länder<input name="laender" defaultValue={s.dealAmpel.laender.join(" ")} style={{ width: 140 }} /></label>
            <label className="small" style={{ flexBasis: "100%" }}>ProfitGo-Link (optional, Adresse mit {"{asin}"}; leer = kein Link)<input name="profitgoVorlage" defaultValue={s.dealAmpel.profitgoVorlage} placeholder="https://…{asin}…" style={{ width: "100%", maxWidth: 480 }} data-testid="deal-ampel-profitgo-vorlage" /></label>
            <button className="btn" type="submit">Speichern</button>
          </form>
        </details>
      )}
    </>
  );
}
