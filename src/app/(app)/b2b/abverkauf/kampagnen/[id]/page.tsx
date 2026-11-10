import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireArea } from "@/lib/auth/session";
import { lagerkosten, OFFENE_PUNKTE_LAGER, ZIELGRUPPEN } from "@/lib/abverkauf/kampagne-logic";
import { anfragenListe, bestandKandidaten, kampagneLesen, leadsFuerKampagne } from "@/lib/abverkauf/kampagnen";
import { einstellungen } from "@/lib/abverkauf/service";
import { appUrl } from "@/lib/oauth/state";
import { publicUrl } from "@/lib/public-url";
import { kampagneEntwuerfeAction, kampagneSpeichernAction, positionenAction, punkteAction } from "../actions";

export const metadata: Metadata = { title: "Kampagne – Seller-System" };
export const dynamic = "force-dynamic";

const eur = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
const STATUS = ["neu", "angeschrieben", "geantwortet", "kunde", "kein_interesse"] as const;

export default async function KampagnePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ meldung?: string; suche?: string; rw?: string; kap?: string; paletten?: string }> }) {
  const s = await requireArea("b2b");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const k = await kampagneLesen(s.tenantId, id);
  if (!k) notFound();
  const z = ZIELGRUPPEN[k.zielgruppe];
  const [cfg, leads, anfragen] = await Promise.all([einstellungen(s.tenantId), leadsFuerKampagne(s.tenantId, k), anfragenListe(s.tenantId, k.id)]);
  const suche = sp.suche ?? "";
  const bestand = suche || sp.rw || sp.kap ? await bestandKandidaten(s.tenantId, { suche, minReichweite: Number(sp.rw) || null, minKapital: Number(sp.kap) || null }) : [];
  const schon = new Set(k.positionen.map((p) => p.sku));
  const imFilter = leads.filter((l) => l.ok);
  const ohneKoord = leads.filter((l) => l.grund === "ohne Koordinaten").length;
  const link = `${publicUrl() ?? appUrl()}/anfrage/${k.code}`;
  const paletten = Math.max(0, Number(sp.paletten) || 0);
  const lk = paletten ? lagerkosten({ paletten, preisJePaletteMonat: cfg.lager.preisJePaletteMonat }) : null;
  return (
    <div className="stack" style={{ maxWidth: 1200 }} data-testid="kampagne" data-code={k.code}>
      <div className="page-head"><div><div className="crumb">B2B › Abverkauf › Kampagnen</div><h1>{k.name}</h1></div><Link href="/b2b/abverkauf/kampagnen" className="btn">Alle Kampagnen</Link></div>
      {sp.meldung && <div className="notice notice-ok small" role="status" data-testid="km-meldung">{sp.meldung}</div>}
      <p className="small" style={{ margin: 0 }}>Zielgruppe: <b>{z.name}</b> · Kampagnen-ID <b data-testid="km-code">{k.code}</b> · Anfrageseite (QR-Code im Brief): <a href={link} target="_blank" rel="noreferrer" data-testid="km-link">{link}</a></p>

      <section className="card card-pad stack" style={{ gap: 6 }}>
        <h2 style={{ margin: 0 }}>Rechtliche Hinweise (keine Rechtsberatung)</h2>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }} data-testid="km-hinweise">{z.hinweise.map((h) => <li key={h}>{h}</li>)}</ul>
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }} id="einstellungen">
        <h2 style={{ margin: 0 }}>Brief, Preise und Lead-Filter</h2>
        <form action={kampagneSpeichernAction} className="stack small" style={{ gap: 6 }} data-testid="km-einstellungen">
          <input type="hidden" name="id" value={k.id} />
          <label className="stack" style={{ gap: 2 }}>Name / Betreff<input className="input" name="name" defaultValue={k.name} /></label>
          <label className="stack" style={{ gap: 2 }}>Brieftext (Anrede, Positionen, QR-Hinweis und Gruß kommen automatisch dazu)<textarea className="input" name="brieftext" defaultValue={k.brieftext} rows={4} /></label>
          <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <label>Aufschlag auf Einstand % <input className="input" name="aufschlag" defaultValue={k.aufschlagProzent} style={{ width: 60 }} /></label>
            <label>Mindestrestlaufzeit MHD (Monate) <input className="input" name="mhdMonate" defaultValue={k.mindestRestlaufzeitMonate} style={{ width: 50 }} data-testid="km-mhd-monate" /></label>
            <label><input type="checkbox" name="nachfass" defaultChecked={k.nachfassTage !== null} /> Nachfassen nach <input className="input" name="nachfassTage" defaultValue={k.nachfassTage ?? 21} style={{ width: 45 }} /> Tagen (Aufgabe)</label>
          </div>
          <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <label>Branche enthält <input className="input" name="branche" defaultValue={k.filter.branche ?? ""} style={{ width: 120 }} data-testid="km-branche" /></label>
            <label>PLZ beginnt mit <input className="input" name="plz" defaultValue={k.filter.plz ?? ""} style={{ width: 70 }} /></label>
            <label>Umkreis um Lager km <input className="input" name="umkreis" defaultValue={k.filter.umkreisKm ?? ""} style={{ width: 60 }} data-testid="km-umkreis" /></label>
            <label>Größe <select className="input" name="groesse" defaultValue={k.filter.groesse ?? ""}><option value="">alle</option><option value="klein">klein</option><option value="mittel">mittel</option><option value="gross">groß</option></select></label>
            <label><input type="checkbox" name="nurAdelprep" defaultChecked={k.filter.nurAdelprep} /> nur Zielgruppe AdelPrep</label>
            <span>Status: {STATUS.map((st) => <label key={st} style={{ marginRight: 6 }}><input type="checkbox" name="status" value={st} defaultChecked={k.filter.status.includes(st)} /> {st}</label>)}</span>
          </div>
          <div><button className="btn btn-sm" type="submit" disabled={s.readOnly} data-testid="km-speichern">Speichern</button></div>
          {!cfg.lager.lat && <p className="muted" style={{ margin: 0 }}>Für den Umkreis zuerst den Lager-Standort eintragen (Abverkauf → Lager-Standort).</p>}
        </form>
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }} id="produkte">
        <h2 style={{ margin: 0 }}>Produkte ({k.positionen.filter((p) => p.angeboten).length} angeboten)</h2>
        <form method="get" className="row small" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }} data-testid="km-suche">
          <label className="stack" style={{ gap: 2 }}>Marke/Kategorie (im Titel)<input className="input" name="suche" defaultValue={suche} style={{ width: 180 }} data-testid="km-suche-text" /></label>
          <label className="stack" style={{ gap: 2 }}>Reichweite ≥ Tage<input className="input" name="rw" defaultValue={sp.rw ?? ""} style={{ width: 70 }} /></label>
          <label className="stack" style={{ gap: 2 }}>Kapital ≥ €<input className="input" name="kap" defaultValue={sp.kap ?? ""} style={{ width: 70 }} /></label>
          <button className="btn btn-sm" type="submit" data-testid="km-suchen">Bestand suchen</button>
        </form>
        <form action={positionenAction} className="stack" style={{ gap: 6 }} data-testid="km-positionen-form">
          <input type="hidden" name="id" value={k.id} />
          <table className="table small">
            <thead><tr><th></th><th>Artikel</th><th>Menge</th><th>Mindestmenge</th><th>MHD</th><th>Charge</th><th>Einstand</th><th>Preis netto</th><th>Angebot</th></tr></thead>
            <tbody>
              {k.positionen.map((p) => (
                <tr key={p.sku} data-testid="km-position" data-sku={p.sku} data-angeboten={p.angeboten ? "1" : "0"}>
                  <td><input type="checkbox" name="sku" value={p.sku} defaultChecked /></td>
                  <td>{p.titel}<div className="muted">{p.sku}</div></td>
                  <td><input className="input" name={`menge_${p.sku}`} defaultValue={p.menge} style={{ width: 60 }} /></td>
                  <td><input className="input" name={`mindest_${p.sku}`} defaultValue={p.mindestmenge} style={{ width: 50 }} /></td>
                  <td><input className="input" name={`mhd_${p.sku}`} defaultValue={p.mhd ?? ""} placeholder="JJJJ-MM" style={{ width: 95 }} /></td>
                  <td><input className="input" name={`charge_${p.sku}`} defaultValue={p.charge ?? ""} style={{ width: 80 }} /></td>
                  <td>{eur(p.einstand)}</td>
                  <td>{p.angeboten ? <>{eur(p.preis)}{p.staffel.length > 0 && <div className="muted">{p.staffel.map((st) => `ab ${st.ab}: ${eur(st.preis)}`).join(", ")}</div>}</> : "–"}</td>
                  <td>{p.angeboten ? <span className="tag tag-ok">angeboten</span> : <span className="tag tag-warn" data-testid="km-grund">{p.grund}</span>}</td>
                </tr>
              ))}
              {bestand.filter((b) => !schon.has(b.sku)).map((b) => (
                <tr key={b.sku} data-testid="km-bestand" data-sku={b.sku}>
                  <td><input type="checkbox" name="sku" value={b.sku} /></td>
                  <td>{b.titel}<div className="muted">{b.sku} · {b.stueck} Stk · Reichweite {b.reichweite === null ? "–" : b.reichweite >= 9999 ? "∞" : `${b.reichweite} T`}</div></td>
                  <td><input className="input" name={`menge_${b.sku}`} defaultValue={b.stueck} style={{ width: 60 }} /></td>
                  <td><input className="input" name={`mindest_${b.sku}`} defaultValue={1} style={{ width: 50 }} /></td>
                  <td><input className="input" name={`mhd_${b.sku}`} placeholder="JJJJ-MM" style={{ width: 95 }} /></td>
                  <td><input className="input" name={`charge_${b.sku}`} style={{ width: 80 }} /></td>
                  <td>{eur(b.ek)}</td>
                  <td>–</td>
                  <td className="muted">aus dem Bestand</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div><button className="btn btn-sm btn-primary" type="submit" disabled={s.readOnly} data-testid="km-positionen-los">Auswahl übernehmen (Preis = Einstand + {k.aufschlagProzent} %)</button></div>
          <p className="small muted" style={{ margin: 0 }}>{z.mhdPflicht ? "Kosmetik: ohne MHD und Charge oder unter der Mindestrestlaufzeit wird eine Position nicht angeboten." : "MHD/Charge optional – wenn angegeben, gilt die Mindestrestlaufzeit."} Preise netto zzgl. USt.</p>
        </form>
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }} id="leads">
        <h2 style={{ margin: 0 }}>Leads im Filter ({imFilter.length} von {leads.length}{ohneKoord ? `, ${ohneKoord} ohne Koordinaten` : ""})</h2>
        <form action={kampagneEntwuerfeAction} className="stack" style={{ gap: 6 }}>
          <input type="hidden" name="id" value={k.id} />
          <table className="table small" data-testid="km-leads">
            <thead><tr><th></th><th>Firma</th><th>Ort</th><th>Branche</th><th>Entfernung</th><th>Filter</th></tr></thead>
            <tbody>
              {leads.filter((l) => l.ok || l.grund !== "gesperrt").slice(0, 300).map((l) => (
                <tr key={l.id} data-testid="km-lead" data-firma={l.firma} data-ok={l.ok ? "1" : "0"}>
                  <td>{l.ok && !l.angeschrieben && <input type="checkbox" name="lead" value={l.id} defaultChecked />}</td>
                  <td>{l.firma}</td>
                  <td>{[l.plz, l.ort].filter(Boolean).join(" ")}</td>
                  <td>{l.kategorie ?? "–"}</td>
                  <td>{l.km === null ? "–" : `${l.km.toLocaleString("de-DE")} km`}</td>
                  <td>{l.angeschrieben ? "schon angeschrieben" : l.ok ? <span className="tag tag-ok">im Filter</span> : <span className="muted">{l.grund}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div><button className="btn btn-sm btn-primary" type="submit" disabled={s.readOnly} data-testid="km-entwuerfe">Entwürfe für Auswahl (höchstens 20, Brief mit QR-Code)</button></div>
        </form>
      </section>

      {k.zielgruppe === "adelprep_lager" && (
        <section className="card card-pad stack" style={{ gap: 8 }} id="lager" data-testid="km-lager">
          <h2 style={{ margin: 0 }}>Lager & Logistik: Kosten und offene Punkte</h2>
          <form method="get" className="row small" style={{ gap: 8, alignItems: "end" }}>
            <label className="stack" style={{ gap: 2 }}>Europaletten<input className="input" name="paletten" defaultValue={paletten || ""} style={{ width: 70 }} data-testid="km-paletten" /></label>
            <button className="btn btn-sm" type="submit">Rechnen</button>
          </form>
          {lk && <p className="small" style={{ margin: 0 }} data-testid="km-lagerkosten">{paletten} Paletten = {lk.m3.toLocaleString("de-DE")} m³ (1,44 m³ je Europalette) · {lk.jePaletteMonat === null ? "Preis je Palette fehlt (Abverkauf → Lager-Standort)" : `${eur(lk.jePaletteMonat)} je Palette/Monat = ${eur(lk.jeM3Monat)} je m³ · ${eur(lk.monat)} im Monat`}</p>}
          <p className="small muted" style={{ margin: 0 }}>Abrechnung über das <Link href="/paletten">Palettenlager</Link> (je Palette und Monat, Ein-/Auslagerung) – Lagerkunden dort anlegen.</p>
          <form action={punkteAction} className="row small" style={{ gap: 10, flexWrap: "wrap" }}>
            <input type="hidden" name="id" value={k.id} />
            {OFFENE_PUNKTE_LAGER.map((p, i) => <label key={p}><input type="checkbox" name={`p${i}`} defaultChecked={!!k.offenePunkte[p]} /> {p}</label>)}
            <button className="btn btn-sm" type="submit" disabled={s.readOnly}>Speichern</button>
          </form>
        </section>
      )}

      <section className="card card-pad stack" style={{ gap: 8 }} id="anfragen">
        <h2 style={{ margin: 0 }}>Anfragen über die Anfrageseite ({anfragen.length})</h2>
        {anfragen.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Noch keine.</p> : (
          <table className="table small" data-testid="km-anfragen">
            <thead><tr><th>Eingang</th><th>Firma</th><th>USt-ID</th><th>Wunsch</th><th>Menge</th><th>Kontakt</th></tr></thead>
            <tbody>{anfragen.map((a) => <tr key={a.id} data-testid="km-anfrage"><td>{a.createdAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}</td><td>{a.firma}</td><td>{a.ustId}{a.ustIdOk ? " ✓" : ""}</td><td>{a.wunsch ?? "–"}</td><td>{a.menge ?? "–"}</td><td>{a.kontakt ?? "–"}</td></tr>)}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}
