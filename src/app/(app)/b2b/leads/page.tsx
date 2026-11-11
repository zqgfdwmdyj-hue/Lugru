import type { Metadata } from "next";
import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { datumDe, laeufe, leadKennzahlen, leadsSeite, leadsWoche, monatsKosten, type LeadZeile } from "@/lib/abverkauf/lead-maschine";
import { ZIEL_TEXT, ZIELE } from "@/lib/abverkauf/lead-maschine-logic";
import { CHARGE_MAX, QUELLE_NAME } from "@/lib/abverkauf/logic";
import { einstellungen } from "@/lib/abverkauf/service";
import { getIntegration } from "@/lib/integrations/store";
import { chargeAction, laufAction, lieferantensucheAction, loeschenAction, neuBewertenAction, quellenAction, schutzregelnAction } from "./actions";

export const metadata: Metadata = { title: "Leads – Seller-System" };
export const dynamic = "force-dynamic";

// B35 Lead-Maschine: Firmen finden (Datei, Lieferantensuche, Stufe 2: Apify/Places/Impressum), anreichern, bewerten,
// Schutzregeln, Charge vorbereiten. Nichts wird automatisch verschickt – jede Charge braucht die Freigabe unter
// Abverkauf bzw. Kampagnen. Keine Werbe-E-Mails an Leads (UWG § 7). Keine Rechtsberatung.

type Such = { meldung?: string; ziel?: string; quelle?: string; status?: string; prio?: string; km?: string; sperre?: string; q?: string };
const eur = (n: number | null | undefined, w = "EUR") => (n === null || n === undefined ? "–" : n.toLocaleString("de-DE", { style: "currency", currency: w }));
const QUELLEN_TYPEN = ["apify", "places", "lucid", "keepa", "helium10", "lieferantensuche", "csv"] as const;
const QUELLE_TEXT: Record<string, string> = { ...QUELLE_NAME, places: "Google Places", lieferantensuche: "Lieferantensuche" };
const STATUS_TEXT: Record<string, string> = { neu: "neu", angeschrieben: "angeschrieben", geantwortet: "geantwortet", kunde: "Kunde", kein_interesse: "kein Interesse", gesperrt: "gesperrt" };
const LAUF_TEXT: Record<string, string> = { datei: "Datei", apify: "Apify", places: "Google Places", impressum: "Impressum", lieferantensuche: "Lieferantensuche", charge: "Charge" };
const LAUF_STATUS: Record<string, string> = { laeuft: "läuft", fertig: "fertig", abgebrochen: "abgebrochen", uebersprungen: "übersprungen", fehler: "Fehler" };

/** Einfache Karte (SVG): Lager in der Mitte, Leads als Punkte, Umkreis als Kreis. */
function Karte({ zeilen, lager, umkreisKm }: { zeilen: LeadZeile[]; lager: { lat: number; lng: number } | null; umkreisKm: number | null }) {
  const punkte = zeilen.filter((z) => z.lat !== null && z.lng !== null).slice(0, 500) as (LeadZeile & { lat: number; lng: number })[];
  if (!lager && !punkte.length) return <p className="small muted" style={{ margin: 0 }} data-testid="ld-karte-leer">Keine Koordinaten – Lager-Standort unter Abverkauf eintragen; Koordinaten kommen aus Apify/Places oder der CSV.</p>;
  const mitte = lager ?? { lat: punkte.reduce((a, p) => a + p.lat, 0) / punkte.length, lng: punkte.reduce((a, p) => a + p.lng, 0) / punkte.length };
  const kosLat = Math.cos((mitte.lat * Math.PI) / 180);
  // Ausdehnung in km (größte Entfernung bzw. Umkreis), mindestens 10 km
  const kmX = (lng: number) => (lng - mitte.lng) * 111.32 * kosLat;
  const kmY = (lat: number) => (lat - mitte.lat) * 110.57;
  const weite = Math.max(10, umkreisKm ?? 0, ...punkte.map((p) => Math.max(Math.abs(kmX(p.lng)), Math.abs(kmY(p.lat))))) * 1.1;
  const W = 320;
  const sk = W / 2 / weite;
  const x = (lng: number) => W / 2 + kmX(lng) * sk;
  const y = (lat: number) => W / 2 - kmY(lat) * sk;
  return (
    <svg viewBox={`0 0 ${W} ${W}`} width="100%" style={{ maxWidth: 360, background: "var(--surface-2, #f6f6f6)", borderRadius: 8 }} role="img" aria-label="Karte der Leads um das Lager" data-testid="ld-karte" data-punkte={punkte.length}>
      {umkreisKm && lager && <circle cx={W / 2} cy={W / 2} r={umkreisKm * sk} fill="none" stroke="var(--accent, #2563eb)" strokeDasharray="4 4" />}
      {punkte.map((p) => (
        <circle key={p.id} cx={x(p.lng)} cy={y(p.lat)} r={4} fill={p.sperre ? "var(--muted, #999)" : "var(--accent, #2563eb)"} opacity={0.85}>
          <title>{`${p.firma} · ${p.ort}${p.km !== null ? ` · ${p.km} km` : ""}${p.sperre ? ` · gesperrt: ${p.sperre}` : ""}`}</title>
        </circle>
      ))}
      {lager && <rect x={W / 2 - 5} y={W / 2 - 5} width={10} height={10} fill="var(--danger, #c00)"><title>Lager</title></rect>}
      <text x={6} y={W - 6} fontSize={10} fill="currentColor">{`± ${Math.round(weite)} km`}</text>
    </svg>
  );
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Such> }) {
  const s = await requireArea("b2b");
  const sp = await searchParams;
  const inhaber = s.role === "owner" && !s.readOnly;
  const filter = { ziel: sp.ziel || undefined, quelle: sp.quelle || undefined, status: sp.status || undefined, prio: sp.prio ? Number(sp.prio) : null, umkreisKm: sp.km ? Number(sp.km) : null, nurSperre: sp.sperre === "1", suche: sp.q };
  const [cfg, seite, woche, kpi, laufListe, kostenApify, kostenPlaces, apifyZugang, placesZugang] = await Promise.all([
    einstellungen(s.tenantId),
    leadsSeite(s.tenantId, filter),
    leadsWoche(s.tenantId),
    leadKennzahlen(s.tenantId),
    laeufe(s.tenantId, 20),
    monatsKosten(s.tenantId, "apify"),
    monatsKosten(s.tenantId, "places"),
    getIntegration(s.tenantId, "apify").then((z) => !!z?.token).catch(() => false),
    getIntegration(s.tenantId, "google_places").then((z) => !!z?.apiKey).catch(() => false),
  ]);
  const q = cfg.leadQuellen;
  const stufe2 = !!q.rechtlichGeprueftAm;
  const bereit = seite.zeilen.filter((z) => !z.sperre).length;
  const gemeldet = laufListe.filter((l) => (l.status === "uebersprungen" || l.status === "abgebrochen" || /captcha/i.test(l.meldung ?? "")) && Date.now() - l.gestartetAm.getTime() < 7 * 86_400_000);
  return (
    <div className="stack" style={{ maxWidth: 1200 }} data-testid="leads">
      <div className="page-head">
        <div><div className="crumb">B2B</div><h1>Leads (Lead-Maschine)</h1></div>
        <div className="row" style={{ gap: 6 }}><Link href="/b2b/abverkauf#anschreiben" className="btn btn-primary">Entwürfe &amp; Freigabe</Link><Link href="/b2b/abverkauf/kampagnen" className="btn">Kampagnen</Link></div>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" data-testid="ld-meldung">{sp.meldung}</div>}
      <div className="notice notice-warn small">Nichts wird automatisch verschickt – jede Charge braucht deine Freigabe (Vorschau, Kostenvorschau). Keine Werbe-E-Mails an Leads (UWG § 7): gefundene Adressen nur für Antworten. Datenschutzhinweis (Art. 14 DSGVO) im Brief bleibt Platzhalter bis zur rechtlichen Prüfung. Keine Rechtsberatung.</div>

      <section className="card card-pad stack" style={{ gap: 8 }} id="bericht" data-testid="ld-bericht">
        <h2 style={{ margin: 0 }}>Wochenbericht und Kennzahlen</h2>
        <div className="row small" style={{ gap: 16, flexWrap: "wrap" }}>
          <span data-testid="ld-neu7">Neue Leads (7 Tage): <strong>{woche.neu7}</strong></span>
          <span>Offene Entwürfe: <strong>{woche.entwuerfe}</strong></span>
          <span>Rücklauf (7 Tage): <strong>{woche.ruecklauf7}</strong> · Anfragen (QR/Link): <strong>{woche.anfragen7}</strong></span>
          <span>Kosten Monat: Quellen {eur(woche.kostenQuellenMonat)} · Briefe {eur(woche.kostenBriefeMonat)}</span>
        </div>
        <div className="row small" style={{ gap: 16, flexWrap: "wrap" }} data-testid="ld-kpi">
          <span>Kosten je Lead: <strong>{eur(kpi.kostenJeLead)}</strong></span>
          <span>Kosten je Rücklauf: <strong>{eur(kpi.kostenJeRuecklauf)}</strong></span>
          <span>Umsatz je Kampagne: {kpi.umsatzJeKampagne.length ? kpi.umsatzJeKampagne.map((k) => `${k.kampagne}: ${eur(k.umsatz)} (${k.antworten}/${k.briefe} Antworten)`).join(" · ") : "–"}</span>
        </div>
        {gemeldet.length > 0 && (
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }} data-testid="ld-gemeldet">
            {gemeldet.map((l) => <li key={l.id}>{LAUF_TEXT[l.quelle] ?? l.quelle} {l.gestartetAm.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}: {LAUF_STATUS[l.status] ?? l.status} – {l.meldung}</li>)}
          </ul>
        )}
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }} id="liste">
        <div className="between" style={{ flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Leads ({seite.zeilen.length} von {seite.gesamt}, {bereit} ohne Sperre)</h2>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <form action={neuBewertenAction}><button className="btn btn-sm" type="submit" disabled={s.readOnly} data-testid="ld-bewerten">Neu bewerten</button></form>
            <form action={lieferantensucheAction}><button className="btn btn-sm" type="submit" disabled={s.readOnly} data-testid="ld-lieferantensuche">Aus Lieferantensuche übernehmen</button></form>
            {inhaber && (
              <form action={chargeAction} className="row" style={{ gap: 4 }}>
                <input className="input" name="anzahl" defaultValue={q.wochenCharge.anzahl} style={{ width: 55 }} aria-label="Anzahl" data-testid="ld-charge-anzahl" />
                <button className="btn btn-sm btn-primary" type="submit" data-testid="ld-charge">Charge vorbereiten (Top N, höchstens {CHARGE_MAX})</button>
              </form>
            )}
          </div>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Neue Leads per Datei unter <Link href="/b2b/abverkauf#leads">Abverkauf → Händler-Leads</Link>. Beim Import: Dubletten (Name+PLZ, Website, USt-IdNr., Handelsregister) zusammengeführt, Abgleich mit Lieferanten, Kunden, Palettenkunden und Sperrnamen, Bewertung je Kampagne. Charge vorbereiten = nur Entwürfe; ohne Anschrift, mit Sperre oder unter dem Mindestabstand ({q.mindestabstandMonate} Monate) nie in einer Charge.</p>
        <form method="get" className="row small" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }} data-testid="ld-filter">
          <label className="stack" style={{ gap: 2 }}>Kampagne<select className="input" name="ziel" defaultValue={sp.ziel ?? ""}><option value="">alle</option>{ZIELE.map((z) => <option key={z} value={z}>{ZIEL_TEXT[z]}</option>)}<option value="-">ohne Empfehlung</option></select></label>
          <label className="stack" style={{ gap: 2 }}>Quelle<select className="input" name="quelle" defaultValue={sp.quelle ?? ""}><option value="">alle</option>{QUELLEN_TYPEN.map((t) => <option key={t} value={t}>{QUELLE_TEXT[t] ?? t}</option>)}</select></label>
          <label className="stack" style={{ gap: 2 }}>Status<select className="input" name="status" defaultValue={sp.status ?? ""}><option value="">alle</option>{Object.entries(STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="stack" style={{ gap: 2 }}>Priorität ab<input className="input" name="prio" defaultValue={sp.prio ?? ""} style={{ width: 60 }} /></label>
          <label className="stack" style={{ gap: 2 }}>Umkreis km<input className="input" name="km" defaultValue={sp.km ?? ""} style={{ width: 60 }} data-testid="ld-filter-km" /></label>
          <label className="stack" style={{ gap: 2 }}>Suche<input className="input" name="q" defaultValue={sp.q ?? ""} style={{ width: 140 }} /></label>
          <label><input type="checkbox" name="sperre" value="1" defaultChecked={sp.sperre === "1"} /> nur gesperrte</label>
          <button className="btn btn-sm" type="submit" data-testid="ld-filter-los">Filtern</button>
          <Link className="btn btn-sm" href="/b2b/leads">zurücksetzen</Link>
        </form>
        <div className="row" style={{ gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <Karte zeilen={seite.zeilen} lager={seite.lager} umkreisKm={filter.umkreisKm} />
          <div style={{ flex: 1, minWidth: 0, overflowX: "auto" }}>
            {seite.zeilen.length === 0 ? <p className="small muted">Keine Leads für diesen Filter.</p> : (
              <table className="table small" data-testid="ld-tabelle">
                <thead><tr><th>Firma</th><th>Ort / km</th><th>Prio</th><th>Empfehlung</th><th>Hinweise</th><th>Quelle</th><th>Status</th><th>Letzter Brief</th><th></th></tr></thead>
                <tbody>
                  {seite.zeilen.slice(0, 300).map((z) => (
                    <tr key={z.id} data-testid="ld-lead" data-firma={z.firma} data-prio={z.prioritaet} data-ziel={z.empfZiel ?? ""} data-sperre={z.sperre ? "1" : "0"}>
                      <td><Link href={`/b2b/leads/${z.id}`}>{z.firma}</Link>{z.adelprep && <div className="muted">Zielgruppe AdelPrep</div>}</td>
                      <td>{z.ort || "–"}{z.km !== null && <div className="muted">{z.km} km</div>}</td>
                      <td>{z.prioritaet}</td>
                      <td>{z.empfZiel ? ZIEL_TEXT[z.empfZiel] : "–"}</td>
                      <td>{z.markierungen.length > 0 && <div className="muted">{z.markierungen.join(" · ")}</div>}{z.sperre && <div style={{ color: "var(--danger)" }} data-testid="ld-sperre">{z.sperre}</div>}</td>
                      <td>{QUELLE_TEXT[z.quelleTyp ?? "csv"] ?? z.quelle}<div className="muted">{datumDe(z.quelleDatum)}</div></td>
                      <td>{STATUS_TEXT[z.status] ?? z.status}</td>
                      <td>{datumDe(z.letzterBriefAm)}</td>
                      <td>{inhaber && <form action={loeschenAction}><input type="hidden" name="id" value={z.id} /><button className="btn btn-sm" type="submit" title="Lead mit allen Daten löschen" data-testid="ld-loeschen">Löschen</button></form>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }} id="quellen" data-testid="ld-quellen" data-stufe2={stufe2 ? "1" : "0"}>
        <h2 style={{ margin: 0 }}>Quellen und Läufe (Stufe 2)</h2>
        <div className={`notice small ${stufe2 ? "notice-ok" : "notice-warn"}`} data-testid="ld-stufe2">{stufe2 ? `Stufe 2 freigegeben – rechtliche Prüfung am ${datumDe(q.rechtlichGeprueftAm)}${q.rechtlichGeprueftVon ? ` (${q.rechtlichGeprueftVon})` : ""}. Läufe nur mit Budget, erzeugen nur Leads/Entwürfe.` : "Stufe 2 gesperrt – automatische Läufe (Apify, Google Places, Impressum) und die Wochen-Charge erst nach eingetragener rechtlicher Prüfung."}</div>
        <p className="small muted" style={{ margin: 0 }}>Kein Auslesen von Google-Suchergebnissen, keine Marktplatz-Anmeldung, nie über das Verkäuferkonto. Impressum-Abruf: robots.txt wird beachtet, mindestens 6 s Pause, eigener User-Agent, nie parallel; bei Captcha/Sperre wird die Seite übersprungen und hier gemeldet, nicht erneut versucht. Zugangsdaten nur unter <Link href="/einstellungen/anbindungen">Anbindungen</Link> (Apify: {apifyZugang ? "hinterlegt" : "fehlt"} · Google Places: {placesZugang ? "hinterlegt" : "fehlt"}). Google Places: Speicherregeln der Nutzungsbedingungen bei der rechtlichen Prüfung klären. LUCID: nur Datei-Import (kein automatischer Lauf).</p>
        <form action={quellenAction} className="stack small" style={{ gap: 8 }} data-testid="ld-quellen-form">
          <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <label>Rechtliche Prüfung am <input className="input" type="date" name="geprueftAm" defaultValue={q.rechtlichGeprueftAm ?? ""} disabled={!inhaber} data-testid="ld-geprueft-am" /></label>
            <label>von <input className="input" name="geprueftVon" defaultValue={q.rechtlichGeprueftVon} placeholder="Kanzlei / Person" style={{ width: 180 }} disabled={!inhaber} /></label>
            <label><input type="checkbox" name="woche" defaultChecked={q.wochenCharge.aktiv} disabled={!inhaber} data-testid="ld-woche" /> Wöchentlich Charge vorbereiten</label>
            <label><input className="input" name="wocheAnzahl" defaultValue={q.wochenCharge.anzahl} style={{ width: 55 }} disabled={!inhaber} /> Briefe</label>
          </div>
          <fieldset className="stack" style={{ gap: 4, border: "1px solid var(--border)", borderRadius: 6, padding: 8 }}>
            <legend>Apify (Läufe mit Kostenobergrenze, USD) · diesen Monat {eur(kostenApify, "USD")}</legend>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <label><input type="checkbox" name="apify" defaultChecked={q.apify.aktiv} disabled={!inhaber} data-testid="ld-apify" /> an</label>
              <label>Actor <input className="input" name="apifyActor" defaultValue={q.apify.actorId} placeholder="z. B. anbieter/actor" style={{ width: 200 }} disabled={!inhaber} data-testid="ld-apify-actor" /></label>
              <label>Budget je Lauf $ <input className="input" name="apifyLauf" defaultValue={q.apify.budgetLauf ?? ""} style={{ width: 60 }} disabled={!inhaber} data-testid="ld-apify-lauf" /></label>
              <label>je Monat $ <input className="input" name="apifyMonat" defaultValue={q.apify.budgetMonat ?? ""} style={{ width: 60 }} disabled={!inhaber} data-testid="ld-apify-monat" /></label>
              <label>höchstens <input className="input" name="apifyMax" defaultValue={q.apify.maxItems} style={{ width: 60 }} disabled={!inhaber} /> Ergebnisse</label>
            </div>
            <label className="stack" style={{ gap: 2 }}>Eingabe (JSON, z. B. Suchbegriffe und Ort)<textarea className="input" name="apifyEingabe" defaultValue={q.apify.eingabe} rows={2} disabled={!inhaber} data-testid="ld-apify-eingabe" /></label>
          </fieldset>
          <fieldset className="stack" style={{ gap: 4, border: "1px solid var(--border)", borderRadius: 6, padding: 8 }}>
            <legend>Google Places (Text-Suche, EUR) · diesen Monat {eur(kostenPlaces)}</legend>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <label><input type="checkbox" name="places" defaultChecked={q.places.aktiv} disabled={!inhaber} data-testid="ld-places" /> an</label>
              <label>Preis je Abruf € <input className="input" name="placesPreis" defaultValue={q.places.preisJeAbruf ?? ""} style={{ width: 60 }} disabled={!inhaber} data-testid="ld-places-preis" /></label>
              <label>Budget je Lauf € <input className="input" name="placesLauf" defaultValue={q.places.budgetLauf ?? ""} style={{ width: 60 }} disabled={!inhaber} data-testid="ld-places-lauf" /></label>
              <label>je Monat € <input className="input" name="placesMonat" defaultValue={q.places.budgetMonat ?? ""} style={{ width: 60 }} disabled={!inhaber} data-testid="ld-places-monat" /></label>
            </div>
            <label className="stack" style={{ gap: 2 }}>Suchen – je Zeile „Branche | Ort/PLZ | Radius km“<textarea className="input" name="placesSuchen" defaultValue={q.places.suchen} rows={2} placeholder="Friseur | 12345 | 30" disabled={!inhaber} data-testid="ld-places-suchen" /></label>
          </fieldset>
          <fieldset className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", border: "1px solid var(--border)", borderRadius: 6, padding: 8 }}>
            <legend>Impressum der Firmenwebsite (kostenlos, langsam)</legend>
            <label><input type="checkbox" name="impressum" defaultChecked={q.impressum.aktiv} disabled={!inhaber} data-testid="ld-impressum" /> an</label>
            <label>höchstens <input className="input" name="impressumMax" defaultValue={q.impressum.maxJeLauf} style={{ width: 55 }} disabled={!inhaber} /> Websites je Lauf</label>
          </fieldset>
          {inhaber && <div><button className="btn btn-sm" type="submit" data-testid="ld-quellen-speichern">Quellen speichern</button></div>}
        </form>
        {inhaber && stufe2 && (
          <div className="row small" style={{ gap: 6, flexWrap: "wrap" }}>
            {(["apify", "places", "impressum"] as const).map((x) => (
              <form key={x} action={laufAction}><input type="hidden" name="quelle" value={x} /><button className="btn btn-sm" type="submit" disabled={!q[x].aktiv} data-testid={`ld-lauf-${x}`}>{LAUF_TEXT[x]}: jetzt laufen lassen</button></form>
            ))}
          </div>
        )}
        {laufListe.length > 0 && (
          <table className="table small" data-testid="ld-laeufe">
            <thead><tr><th>Start</th><th>Quelle</th><th>Status</th><th>Neu</th><th>Zusammengef.</th><th>Kosten / Budget</th><th>Meldung</th></tr></thead>
            <tbody>
              {laufListe.map((l) => (
                <tr key={l.id} data-testid="ld-lauf" data-quelle={l.quelle} data-status={l.status}>
                  <td>{l.gestartetAm.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}</td>
                  <td>{LAUF_TEXT[l.quelle] ?? l.quelle}</td>
                  <td>{LAUF_STATUS[l.status] ?? l.status}</td>
                  <td>{l.neu}</td>
                  <td>{l.zusammengefuehrt}</td>
                  <td>{l.kosten ? eur(l.kosten, l.waehrung) : "–"}{l.budget !== null ? ` / ${eur(l.budget, l.waehrung)}` : ""}</td>
                  <td>{l.meldung}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }} id="schutzregeln" data-testid="ld-schutzregeln">
        <h2 style={{ margin: 0 }}>Schutzregeln</h2>
        <p className="small muted" style={{ margin: 0 }}>Automatisch gesperrt: Lieferanten, B2B-Kunden, Palettenkunden, Kunden, bereits angeschriebene Firmen (Mindestabstand), Widersprüche (Sperrliste). Insolvenz, Frischware, unklare Zuordnung und vermutliche Privatpersonen werden nicht aufgenommen. Konfliktbranchen nur mit Freigabe je Lead. Listen hier eintragen – je Zeile oder mit Komma getrennt.</p>
        <form action={schutzregelnAction} className="stack small" style={{ gap: 6 }}>
          <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <label>Mindestabstand <input className="input" name="abstand" defaultValue={q.mindestabstandMonate} style={{ width: 50 }} disabled={!inhaber} data-testid="ld-abstand" /> Monate je Firma</label>
            <label>Löschfrist ohne Kontakt <input className="input" name="loeschfrist" defaultValue={cfg.loeschfristTage} style={{ width: 60 }} disabled={!inhaber} /> Tage</label>
            <label>Umkreis lokal <input className="input" name="lokal" defaultValue={q.umkreisLokalKm} style={{ width: 55 }} disabled={!inhaber} /> km</label>
            <label>Umkreis Lager <input className="input" name="lagerkm" defaultValue={q.umkreisLagerKm} style={{ width: 55 }} disabled={!inhaber} /> km</label>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <label className="stack" style={{ gap: 2, flex: "1 1 220px" }}>Konfliktbranchen (eigene Marke – standardmäßig ausgeschlossen)<textarea className="input" name="konflikt" defaultValue={q.konfliktbranchen.join("\n")} rows={3} disabled={!inhaber} data-testid="ld-konflikt" /></label>
            <label className="stack" style={{ gap: 2, flex: "1 1 220px" }}>Mitbewerber / Firmen nie anschreiben (Sperrnamen)<textarea className="input" name="sperrnamen" defaultValue={q.sperrNamen.join("\n")} rows={3} disabled={!inhaber} data-testid="ld-sperrnamen" /></label>
            <label className="stack" style={{ gap: 2, flex: "1 1 220px" }}>Großmarken mit eigener Logistik (niedrigere Priorität)<textarea className="input" name="grossmarken" defaultValue={q.grossmarken.join("\n")} rows={3} disabled={!inhaber} data-testid="ld-grossmarken" /></label>
            <label className="stack" style={{ gap: 2, flex: "1 1 220px" }}>„Lagerbedingungen klären“ (nicht in der Standard-Charge)<textarea className="input" name="lagerbedingungen" defaultValue={q.lagerbedingungen.join("\n")} rows={3} disabled={!inhaber} /></label>
          </div>
          {inhaber && <div><button className="btn btn-sm" type="submit" data-testid="ld-schutz-speichern">Schutzregeln speichern</button></div>}
        </form>
      </section>
    </div>
  );
}
