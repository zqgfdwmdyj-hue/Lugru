import type { Metadata } from "next";
import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { beilageProbleme } from "@/lib/abverkauf/briefe";
import { beilageLint } from "@/lib/abverkauf/kampagne-logic";
import { CHARGE_MAX, QUELLE_NAME, mailErlaubt, quelleSperre, type LeadQuelleTyp } from "@/lib/abverkauf/logic";
import { adelprepVorschlaege, anschreibenListe, einstellungen, erfolgJeCharge, kandidaten, leadsListe, letztePreislisten, loeschfaellig } from "@/lib/abverkauf/service";
import { getIntegration } from "@/lib/integrations/store";
import { adelprepAction, adelprepVorschlagAction, anschreibenAction, beilageAction, briefversandAction, einstellungenAction, entwuerfeAction, freigebenAction, lagerAction, leadAction, leadAdelprepAction, leadMailAction, leadQuellenAction, leadsImportAction, preislisteAction, verschicktAction } from "./actions";

export const metadata: Metadata = { title: "Abverkauf an Händler – Seller-System" };
export const dynamic = "force-dynamic";

// B34.3 Ladenhüter an Händler: Preisliste → Leads (CSV) → Anschreiben (KI-Entwurf, Freigabe in Chargen bis 20) →
// Antworten und Erfolg je Charge. Brief ist der Standard; E-Mail an Fremdkontakte gesperrt, solange „Rechtlich
// geprüft“ aus ist. Keine Rechtsberatung – vor Massenversand rechtlich prüfen lassen.

const eur = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
const datum = (iso: string) => iso.split("-").reverse().join(".");
/** Website aus der CSV nur als http(s)-Link anzeigen. */
const webUrl = (w: string | null) => {
  if (!w?.trim()) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(w.trim()) ? w.trim() : `https://${w.trim()}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
};
const STATUS: Record<string, string> = { entwurf: "Entwurf", freigegeben: "freigegeben (Brief drucken)", versendet: "verschickt", beantwortet: "beantwortet", gesperrt: "gesperrt" };

export default async function AbverkaufPage({ searchParams }: { searchParams: Promise<{ meldung?: string; pl?: string; adelprep?: string }> }) {
  const s = await requireArea("b2b");
  const sp = await searchParams;
  const [cfg, kand, listen, leads, anschreiben, erfolg, faellig, vorschlaege] = await Promise.all([einstellungen(s.tenantId), kandidaten(s.tenantId).catch(() => []), letztePreislisten(s.tenantId), leadsListe(s.tenantId), anschreibenListe(s.tenantId), erfolgJeCharge(s.tenantId), loeschfaellig(s.tenantId), adelprepVorschlaege(s.tenantId)]);
  const inhaber = s.role === "owner" && !s.readOnly;
  const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
  const entwuerfe = anschreiben.filter((x) => x.a.status === "entwurf");
  const nurAdelprep = sp.adelprep === "1";
  const leadsSicht = nurAdelprep ? leads.filter((l) => l.adelprep) : leads;
  const ap = cfg.adelprep;
  const beilageFehler = beilageProbleme(cfg);
  const lint = beilageLint(ap.text, ap.bestaetigt);
  const bv = cfg.briefversand;
  const bvZugang = await getIntegration(s.tenantId, bv.anbieter).then((z) => !!z).catch(() => false);
  const bvPreis = bv.preise[bv.anbieter];
  return (
    <div className="stack" style={{ maxWidth: 1200 }} data-testid="abverkauf">
      <div className="page-head"><div><div className="crumb">B2B</div><h1>Abverkauf an Händler (Ladenhüter)</h1></div><div className="row" style={{ gap: 6 }}><Link href="/b2b/abverkauf/kampagnen" className="btn btn-primary" data-testid="av-kampagnen-link">Kampagnen</Link><Link href="/b2b/bilanz" className="btn">B2B-Bilanz</Link></div></div>
      {sp.meldung && <div className="notice notice-ok small" role="status" data-testid="av-meldung">{sp.meldung}</div>}
      <div className="notice notice-warn small">Keine Rechtsberatung – vor Massenversand rechtlich prüfen lassen. Standard ist der Brief mit Datenschutzhinweis (Art. 14 DSGVO). E-Mails an Fremdkontakte nur mit dokumentierter Einwilligung und erst, wenn „Rechtlich geprüft“ an ist. Nichts wird automatisch verschickt. Das Seller-System sammelt keine Adressen – Leads kommen per CSV (z. B. Apify).</div>

      <section className="card card-pad stack" style={{ gap: 8 }} id="einstellungen">
        <h2 style={{ margin: 0 }}>Einstellungen</h2>
        <form action={einstellungenAction} className="row small" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }} data-testid="av-einstellungen">
          <label><input type="checkbox" name="rechtlichGeprueft" defaultChecked={cfg.rechtlichGeprueft} disabled={!inhaber} data-testid="av-rechtlich" /> Rechtlich geprüft (E-Mail an Fremdkontakte mit Einwilligung)</label>
          <label>Tageslimit <input className="input" name="tageslimit" type="number" min={1} max={200} defaultValue={cfg.tageslimit} style={{ width: 70 }} disabled={!inhaber} /></label>
          <label>Aufschlag % <input className="input" name="aufschlag" defaultValue={cfg.aufschlagProzent} style={{ width: 60 }} disabled={!inhaber} /></label>
          <label>Ladenhüter: Reichweite &gt; <input className="input" name="reichweite" defaultValue={cfg.kriterien.reichweiteTage} style={{ width: 55 }} disabled={!inhaber} /> T oder Lager &gt; <input className="input" name="lagertage" defaultValue={cfg.kriterien.lagerTage} style={{ width: 55 }} disabled={!inhaber} /> T, Kapital &gt; <input className="input" name="kapital" defaultValue={cfg.kriterien.kapital} style={{ width: 65 }} disabled={!inhaber} /> €</label>
          <label>Löschfrist je Lead <input className="input" name="loeschfrist" defaultValue={cfg.loeschfristTage} style={{ width: 60 }} disabled={!inhaber} /> Tage</label>
          {inhaber && <button className="btn btn-sm" type="submit">Speichern</button>}
        </form>
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }} id="beilage" data-testid="av-beilage" data-bereit={beilageFehler.length ? "0" : "1"}>
        <h2 style={{ margin: 0 }}>Beilage AdelPrep (eigener Brief der Logistik-Firma)</h2>
        <p className="small muted" style={{ margin: 0 }}>Eigenes Blatt mit eigenem Absender, Impressum und Datenschutzhinweis – nicht mit dem Restposten-Brief vermischt. Je Brief zu- oder abwählbar; Leads mit „Zielgruppe AdelPrep“ bekommen sie vorgeschlagen. Formulierung z. B. „FBA-Prep ab … € netto je Artikel“ – nicht „all-in“ oder „Komplettpreis“. Angaben zu Fläche/Stellplätzen, kostenloser Zählung, NDA und Gefahrgut erst nach Rückfrage verwenden.</p>
        <form action={adelprepAction} className="stack small" style={{ gap: 6 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input className="input" name="firma" defaultValue={ap.firma} placeholder="Firma" style={{ width: 220 }} disabled={!inhaber} data-testid="av-ap-firma" />
            <input className="input" name="strasse" defaultValue={ap.strasse} placeholder="Straße" style={{ width: 200 }} disabled={!inhaber} data-testid="av-ap-strasse" />
            <input className="input" name="plz" defaultValue={ap.plz} placeholder="PLZ" style={{ width: 70 }} disabled={!inhaber} data-testid="av-ap-plz" />
            <input className="input" name="ort" defaultValue={ap.ort} placeholder="Ort" style={{ width: 140 }} disabled={!inhaber} data-testid="av-ap-ort" />
            <input className="input" name="email" defaultValue={ap.email} placeholder="E-Mail" style={{ width: 200 }} disabled={!inhaber} data-testid="av-ap-email" />
            <input className="input" name="telefon" defaultValue={ap.telefon} placeholder="Telefon" style={{ width: 140 }} disabled={!inhaber} />
            <input className="input" name="web" defaultValue={ap.web} placeholder="Website" style={{ width: 180 }} disabled={!inhaber} />
          </div>
          <label className="stack" style={{ gap: 2 }}>Impressum (Registergericht, Nummer, USt-ID, Geschäftsführung)<textarea className="input" name="impressum" defaultValue={ap.impressum} rows={2} disabled={!inhaber} data-testid="av-ap-impressum" /></label>
          <label className="stack" style={{ gap: 2 }}>Datenschutzhinweis der Logistik-Firma (leer = Standardtext mit dieser Firma als Verantwortlicher)<textarea className="input" name="datenschutz" defaultValue={ap.datenschutz} rows={2} disabled={!inhaber} /></label>
          <label className="stack" style={{ gap: 2 }}>Textbaustein<textarea className="input" name="text" defaultValue={ap.text} rows={4} disabled={!inhaber} data-testid="av-ap-text" /></label>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <label><input type="checkbox" name="standard" defaultChecked={ap.standardBeilegen} disabled={!inhaber} /> bei Zielgruppe AdelPrep standardmäßig beilegen</label>
            <span className="muted">Bestätigt (nach Rückfrage):</span>
            <label><input type="checkbox" name="b_flaeche" defaultChecked={ap.bestaetigt.flaeche} disabled={!inhaber} /> Fläche/Stellplätze</label>
            <label><input type="checkbox" name="b_nda" defaultChecked={ap.bestaetigt.nda} disabled={!inhaber} /> NDA</label>
            <label><input type="checkbox" name="b_gefahrgut" defaultChecked={ap.bestaetigt.gefahrgut} disabled={!inhaber} /> Gefahrgut/LQ</label>
            <label><input type="checkbox" name="b_ean" defaultChecked={!!ap.bestaetigt.eanFba} disabled={!inhaber} data-testid="av-ap-ean" /> EAN-Prüfung bei direktem FBA-Versand inklusive</label>
          </div>
          <p className="small muted" style={{ margin: 0 }} data-testid="av-ap-regeln">Textregeln: Preis netto je Artikel; „all-in“ nur mit Aufzählung („Enthalten: …“), nie „Komplettpreis“; Karton gesondert nennen. Zählung nie „kostenlos“ oder „Pflicht“ – beim direkten FBA-Versand ist die Stückzahl durch das Verpacken erfasst, bei Einlagerung ist die Mengenzählung optional zubuchbar.</p>
          {inhaber && <div><button className="btn btn-sm" type="submit" data-testid="av-ap-speichern">Beilage speichern</button></div>}
        </form>
        <div className={`notice small ${beilageFehler.length ? "notice-warn" : "notice-ok"}`} data-testid="av-ap-pruefung">
          {beilageFehler.length ? <>Beilage wird nicht beigelegt: {beilageFehler.join(" · ")}</> : "Beilage bereit – Text geprüft."}
          {lint.hinweise.length > 0 && <div className="muted">Hinweis: {lint.hinweise.join(" · ")}</div>}
        </div>
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }} id="briefversand">
        <h2 style={{ margin: 0 }}>Briefversand per Anbieter</h2>
        <div className="small" data-testid="av-bv-stand" data-zugang={bvZugang ? "1" : "0"}>Aktuell: <strong>{bv.anbieter === "ebrief" ? "eBrief" : bv.anbieter === "letterxpress" ? "LetterXpress" : "E-POST"}</strong> · Zugang {bvZugang ? "hinterlegt" : "fehlt (Anbindungen)"} · Preis {bvPreis.grund !== null ? `${eur(bvPreis.grund)} 1. Blatt${bvPreis.jeWeitereSeite !== null ? `, ${eur(bvPreis.jeWeitereSeite)} je weitere Seite` : ""} netto` : "fehlt – bitte unten eintragen"} · {bv.live ? "live" : "Testmodus"}{bv.live && !bv.avVertrag ? " (gesperrt: AV-Vertrag fehlt)" : ""}</div>
        <p className="small muted" style={{ margin: 0 }}>Austauschbarer Anbieter (eBrief – Vorschlag, noch zu bestätigen –, LetterXpress, E-POST vorbereitet). Zugangsdaten verschlüsselt unter <Link href="/einstellungen/anbindungen">Anbindungen</Link>. Preise je Brief hier eintragen (laut Preisseite des Anbieters). Live nur mit AV-Vertrag und nach einem Testbrief; jede Charge braucht deine Freigabe.</p>
        <form action={briefversandAction} className="stack small" style={{ gap: 6 }} data-testid="av-bv-form">
          <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <label>Anbieter <select className="input" name="anbieter" defaultValue={bv.anbieter} disabled={!inhaber} data-testid="av-bv-anbieter"><option value="ebrief">eBrief</option><option value="letterxpress">LetterXpress</option><option value="epost">E-POST (vorbereitet)</option></select></label>
            <label><input type="checkbox" name="live" defaultChecked={bv.live} disabled={!inhaber} data-testid="av-bv-live" /> Live (sonst Testmodus)</label>
            <label><input type="checkbox" name="av" defaultChecked={bv.avVertrag} disabled={!inhaber} data-testid="av-bv-av" /> AV-Vertrag liegt vor</label>
            <input className="input" name="avdatum" type="date" defaultValue={bv.avDatum ?? ""} disabled={!inhaber} />
            <label>Tageslimit <input className="input" name="tageslimit" defaultValue={bv.tageslimit} style={{ width: 60 }} disabled={!inhaber} /></label>
            <label>Gesamtbudget € <input className="input" name="budget" defaultValue={bv.budget ?? ""} style={{ width: 80 }} disabled={!inhaber} data-testid="av-bv-budget" /></label>
            <label><input type="checkbox" name="farbe" defaultChecked={bv.farbe} disabled={!inhaber} /> Farbe</label>
            <label><input type="checkbox" name="duplex" defaultChecked={bv.duplex} disabled={!inhaber} /> beidseitig</label>
          </div>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            {(["ebrief", "letterxpress", "epost"] as const).map((a) => (
              <span key={a}>{a === "ebrief" ? "eBrief" : a === "letterxpress" ? "LetterXpress" : "E-POST"}: <input className="input" name={`p_${a}_grund`} defaultValue={bv.preise[a].grund ?? ""} placeholder="1. Blatt €" style={{ width: 70 }} disabled={!inhaber} data-testid={`av-bv-preis-${a}`} /> + <input className="input" name={`p_${a}_seite`} defaultValue={bv.preise[a].jeWeitereSeite ?? ""} placeholder="je weitere" style={{ width: 70 }} disabled={!inhaber} data-testid={`av-bv-seite-${a}`} /> € netto</span>
            ))}
          </div>
          {inhaber && <div><button className="btn btn-sm" type="submit" data-testid="av-bv-speichern">Briefversand speichern</button></div>}
        </form>
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }} id="lager">
        <h2 style={{ margin: 0 }}>Lager-Standort (Umkreis, Lagerkosten)</h2>
        <form action={lagerAction} className="row small" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }} data-testid="av-lager-form">
          <input className="input" name="name" defaultValue={cfg.lager.name} placeholder="Bezeichnung" style={{ width: 160 }} disabled={!inhaber} />
          <label>Breite <input className="input" name="lat" defaultValue={cfg.lager.lat ?? ""} style={{ width: 90 }} disabled={!inhaber} data-testid="av-lager-lat" /></label>
          <label>Länge <input className="input" name="lng" defaultValue={cfg.lager.lng ?? ""} style={{ width: 90 }} disabled={!inhaber} data-testid="av-lager-lng" /></label>
          <label>Preis je Palette/Monat € <input className="input" name="preis" defaultValue={cfg.lager.preisJePaletteMonat ?? ""} style={{ width: 70 }} disabled={!inhaber} /></label>
          {inhaber && <button className="btn btn-sm" type="submit" data-testid="av-lager-speichern">Speichern</button>}
        </form>
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }} id="preisliste">
        <h2 style={{ margin: 0 }}>1. Preisliste aus Ladenhütern ({kand.length})</h2>
        <p className="small muted" style={{ margin: 0 }}>Preis = Break-even + Aufschlag, Staffeln {cfg.staffeln.map((x) => `ab ${x.ab}: −${x.rabattProzent} %`).join(", ")} (nie unter Break-even). Die Preisliste enthält nur Artikel, Menge und Preis – keinen Einkaufspreis, keinen Break-even und keine internen Hinweise.</p>
        {kand.length === 0 ? <p className="small muted">Keine Ladenhüter nach den Kriterien (Kapital-Ampel).</p> : (
          <form action={preislisteAction} className="stack" style={{ gap: 8 }} data-testid="av-preisliste-form">
            <table className="table small">
              <thead><tr><th></th><th>Artikel</th><th>Warum</th><th>Bestand</th><th>Menge</th><th>Break-even (intern)</th></tr></thead>
              <tbody>
                {kand.map((k) => (
                  <tr key={k.sku} data-testid="av-kandidat" data-sku={k.sku}>
                    <td><input type="checkbox" name="sku" value={k.sku} defaultChecked /></td>
                    <td>{k.titel}<div className="muted">{k.sku}{k.asin ? ` · ${k.asin}` : ""}</div></td>
                    <td>{k.grund}</td>
                    <td>{k.stueck}</td>
                    <td><input className="input" name={`menge_${k.sku}`} defaultValue={k.stueck} style={{ width: 70 }} /></td>
                    <td>{eur(k.breakEven)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <label className="small">Aufschlag % <input className="input" name="aufschlag" defaultValue={cfg.aufschlagProzent} style={{ width: 60 }} /></label>
              <button className="btn btn-primary" type="submit" disabled={s.readOnly} data-testid="av-preisliste-los">Preisliste erzeugen</button>
            </div>
          </form>
        )}
        {listen.length > 0 && (
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }} data-testid="av-preislisten">
            {listen.map((p) => (
              <li key={p.id} data-id={p.id} style={{ fontWeight: p.id === sp.pl ? 700 : undefined }}>
                {p.createdAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} · {p.positionen.length} Positionen · Aufschlag {p.aufschlagProzent} % · <a href={`/b2b/abverkauf/datei?id=${p.id}&format=pdf`} data-testid="av-pdf">PDF</a> · <a href={`/b2b/abverkauf/datei?id=${p.id}&format=xlsx`} data-testid="av-xlsx">Excel</a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }} id="leads">
        <div className="between"><h2 style={{ margin: 0 }}>2. Händler-Leads ({leadsSicht.length}{nurAdelprep ? ` von ${leads.length}` : ""})</h2>
          <Link className="btn btn-sm" href={nurAdelprep ? "/b2b/abverkauf#leads" : "/b2b/abverkauf?adelprep=1#leads"} data-testid="av-filter-adelprep">{nurAdelprep ? "Alle Leads" : "Nur Zielgruppe AdelPrep"}</Link>
        </div>
        <form action={leadsImportAction} className="row small" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }} data-testid="av-import">
          <label className="stack" style={{ gap: 2 }}>CSV/Excel (Firma, Anschrift/PLZ/Ort, Kategorie, E-Mail + E-Mail-Quelle, Website)<input type="file" name="datei" accept=".csv,.xlsx,.xls,text/csv" /></label>
          <label className="stack" style={{ gap: 2 }}>Quelle (leer = automatisch)<input className="input" name="quelle" placeholder="z. B. Apify Google Maps, Suche …" style={{ width: 260 }} data-testid="av-import-quelle" /></label>
          <label className="stack" style={{ gap: 2 }}>Datum der Quelle (leer = aus der Datei, sonst heute)<input className="input" type="date" name="datum" max={heute} data-testid="av-import-datum" /></label>
          <button className="btn btn-sm" type="submit" disabled={s.readOnly} data-testid="av-import-los">Importieren</button>
        </form>
        <p className="small muted" style={{ margin: 0 }}>Apify-, LUCID-, Keepa- und Helium-10-Exporte werden erkannt; Quelle und Datum trägt das System ein. Das Seller-System scrapt nicht selbst. E-Mails nur aus dem Impressum (Spalte „E-Mail-Quelle“ oder Apify-Export) – gespeichert nur für Antworten, nie für Werbe-E-Mails (UWG § 7). Je Lead: Quelle, Datum, Zweck, Rechtsgrundlage, Löschfrist. Sperrliste verhindert erneuten Import.</p>
        {leads.length > 0 && (
          <>
            <form id="entwurf-form" action={entwuerfeAction} className="row small" style={{ gap: 8, alignItems: "center" }}>
              <input type="hidden" name="preisliste" value={sp.pl ?? listen[0]?.id ?? ""} />
              <button className="btn btn-sm btn-primary" type="submit" disabled={s.readOnly} data-testid="av-entwuerfe">KI-Entwürfe für Auswahl (höchstens {CHARGE_MAX})</button>
              <span className="muted">Nichts wird verschickt – erst nach Freigabe.</span>
            </form>
            <table className="table small" data-testid="av-leads">
              <thead><tr><th></th><th>Firma</th><th>Ort</th><th>Kategorie</th><th>AdelPrep</th><th>E-Mail</th><th>Kontaktweg</th><th>Quelle / Datum</th><th>Löschen am</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {leadsSicht.map((l) => {
                  const m = mailErlaubt({ bestandskunde: l.bestandskunde, einwilligung: l.einwilligung, email: l.email, status: l.status }, cfg.rechtlichGeprueft);
                  const qs = quelleSperre(l, cfg.leadQuellen);
                  const web = webUrl(l.website);
                  return (
                    <tr key={l.id} data-testid="av-lead" data-firma={l.firma} data-status={l.status}>
                      <td>{l.status !== "gesperrt" && <input type="checkbox" name="lead" value={l.id} form="entwurf-form" />}</td>
                      <td>{l.firma}<div className="muted">{l.rechtsgrundlage}</div>{l.stueckJeArtikel !== null && <div className="muted" data-testid="av-lead-stueck">ca. {l.stueckJeArtikel.toLocaleString("de-DE")} Stück je Artikel</div>}</td>
                      <td>{[l.plz, l.ort].filter(Boolean).join(" ")}</td>
                      <td>{l.kategorie ?? "–"}</td>
                      <td><form action={leadAdelprepAction}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="adelprep" value={l.adelprep ? "0" : "1"} /><button className={`btn btn-sm ${l.adelprep ? "btn-primary" : ""}`} type="submit" disabled={s.readOnly} data-testid="av-lead-adelprep" data-an={l.adelprep ? "1" : "0"}>{l.adelprep ? "ja" : "nein"}</button></form></td>
                      <td data-testid="av-lead-email" data-email={l.email ? "1" : "0"} data-mail={m.erlaubt ? "erlaubt" : "gesperrt"}>
                        {l.email ? (
                          <>
                            {l.email}
                            <div className="muted">{l.emailQuelle ?? "Quelle unbekannt"} · {m.erlaubt ? `Mail erlaubt: ${m.grund}` : "nur für Antworten – keine Werbe-E-Mail"}</div>
                            <form action={leadMailAction}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="email" value="" /><button className="btn btn-sm" type="submit" disabled={s.readOnly}>entfernen</button></form>
                          </>
                        ) : (
                          <form action={leadMailAction} className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                            <input type="hidden" name="id" value={l.id} />
                            <input className="input" name="email" type="email" placeholder="E-Mail aus dem Impressum" style={{ width: 150 }} data-testid="av-lead-mail-feld" />
                            <button className="btn btn-sm" type="submit" disabled={s.readOnly} data-testid="av-lead-mail-speichern">Mail speichern</button>
                            {web && <a className="small" href={web} target="_blank" rel="noopener noreferrer nofollow">Website öffnen</a>}
                          </form>
                        )}
                      </td>
                      <td>
                        <form action={leadAction} className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                          <input type="hidden" name="id" value={l.id} />
                          <input type="hidden" name="bestandskunde_da" value="1" />
                          <select className="input" name="kontaktweg" defaultValue={l.kontaktweg} style={{ width: 80 }} aria-label="Kontaktweg"><option value="brief">Brief</option><option value="email" disabled={!l.email}>E-Mail</option></select>
                          <label title="Bestandskunde"><input type="checkbox" name="bestandskunde" defaultChecked={l.bestandskunde} /> Kunde</label>
                          <input className="input" name="einwilligung" defaultValue={l.einwilligung ?? ""} placeholder="Einwilligung (Nachweis)" style={{ width: 150 }} />
                          <button className="btn btn-sm" type="submit" disabled={s.readOnly}>✓</button>
                        </form>
                        {l.kontaktweg === "email" && <div className={m.erlaubt ? "muted" : "small"} style={{ color: m.erlaubt ? undefined : "var(--danger)" }} data-testid="av-mail-status">{m.erlaubt ? `E-Mail erlaubt: ${m.grund}` : `E-Mail gesperrt: ${m.grund}`}</div>}
                      </td>
                      <td data-testid="av-lead-quelle" data-typ={l.quelleTyp ?? ""}>{l.quelle}<div className="muted">{datum(l.quelleDatum)}</div>{qs && <div className="small" style={{ color: "var(--danger)" }} data-testid="av-lead-quelle-sperre">{qs}</div>}</td>
                      <td>{datum(l.loeschenAm)}</td>
                      <td>{l.status}</td>
                      <td>{l.status !== "gesperrt" && <form action={leadAction}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="was" value="sperren" /><button className="btn btn-sm" type="submit" disabled={s.readOnly} data-testid="av-sperren">Sperren</button></form>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }} id="adelprep-vorschlaege" data-testid="av-ap-vorschlaege">
        <h2 style={{ margin: 0 }}>Vorschläge „Zielgruppe AdelPrep“ ({vorschlaege.length})</h2>
        <p className="small muted" style={{ margin: 0 }}>Leads mit großen Stückzahlen je Artikel (ab {cfg.leadQuellen.adelprepAbStueck} Stück, Spalte „Stück je Artikel“/„Units“ aus LUCID-, Keepa- oder Helium-10-Export). Nichts wird automatisch gesetzt – Auswahl übernehmen.</p>
        {vorschlaege.length > 0 && (
          <form action={adelprepVorschlagAction} className="stack small" style={{ gap: 4 }}>
            {vorschlaege.map((v) => (
              <label key={v.id} className="row" style={{ gap: 6 }} data-testid="av-ap-vorschlag" data-firma={v.firma}>
                <input type="checkbox" name="lead" value={v.id} defaultChecked /> {v.firma} – {[v.plz, v.ort].filter(Boolean).join(" ")} <span className="muted">{v.grund} · {v.quelle}</span>
              </label>
            ))}
            <div><button className="btn btn-sm" type="submit" disabled={s.readOnly} data-testid="av-ap-uebernehmen">Auswahl als Zielgruppe AdelPrep markieren</button></div>
          </form>
        )}
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }} id="lead-quellen" data-testid="av-lead-quellen">
        <h2 style={{ margin: 0 }}>Lead-Quellen (Stufe 1)</h2>
        <p className="small muted" style={{ margin: 0 }}>Leads nur per Datei-Import (Apify, LUCID, Keepa, Helium 10, eigene CSV). Briefe werden vorbereitet, verschickt wird nur nach Freigabe (Tageslimit, Budget). Stufe 2 (automatischer Apify-Lauf mit Monatslimit) ist nicht eingerichtet – erst nach rechtlicher Prüfung.</p>
        <form action={leadQuellenAction} className="row small" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label><input type="checkbox" name="lucid" defaultChecked={cfg.leadQuellen.lucidGeklaert} disabled={!inhaber} data-testid="av-lucid" /> LUCID-Daten für Werbung rechtlich geklärt</label>
          <label>AdelPrep-Vorschlag ab <input className="input" name="ab" defaultValue={cfg.leadQuellen.adelprepAbStueck} style={{ width: 70 }} disabled={!inhaber} data-testid="av-ap-ab" /> Stück je Artikel</label>
          {inhaber && <button className="btn btn-sm" type="submit" data-testid="av-lead-quellen-speichern">Speichern</button>}
        </form>
        <div className="small muted">Erkannte Quellen: {(["apify", "lucid", "keepa", "helium10", "csv"] as LeadQuelleTyp[]).map((t) => `${QUELLE_NAME[t]} (${leads.filter((l) => (l.quelleTyp ?? "csv") === t).length})`).join(" · ")}. LUCID-Leads bleiben ohne Entwurf und ohne Brief, bis der Haken gesetzt ist. Keine Rechtsberatung.</div>
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }} id="anschreiben">
        <h2 style={{ margin: 0 }}>3. Anschreiben ({entwuerfe.length} Entwürfe)</h2>
        {anschreiben.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Noch keine – oben Leads auswählen und Entwürfe erstellen.</p> : (
          <>
            {inhaber && entwuerfe.length > 0 && (
              <form id="freigabe-form" action={freigebenAction} className="row small" style={{ gap: 8, alignItems: "center" }}>
                <button className="btn btn-sm btn-primary" type="submit" data-testid="av-freigeben">Auswahl freigeben (Charge, höchstens {CHARGE_MAX}, Tageslimit {cfg.tageslimit})</button>
              </form>
            )}
            <table className="table small" data-testid="av-anschreiben">
              <thead><tr><th></th><th>Bezug</th><th>Händler</th><th>Weg</th><th>Betreff / Text</th><th>Beilage</th><th>Status</th><th>Umsatz / Marge</th></tr></thead>
              <tbody>
                {anschreiben.map(({ a, firma, ort }) => (
                  <tr key={a.id} data-testid="av-anschreiben-zeile" data-status={a.status} data-kanal={a.kanal} data-code={a.code}>
                    <td>{a.status === "entwurf" && <input type="checkbox" name="anschreiben" value={a.id} form="freigabe-form" defaultChecked />}</td>
                    <td>{a.code}{a.ki ? <div className="muted">KI-Entwurf</div> : null}</td>
                    <td>{firma}<div className="muted">{ort ?? ""}</div></td>
                    <td>{a.kanal === "email" ? "E-Mail" : "Brief"}</td>
                    <td>
                      <details><summary>{a.betreff}</summary>
                        {a.status === "entwurf" ? (
                          <form action={anschreibenAction} className="stack" style={{ gap: 4 }}>
                            <input type="hidden" name="id" value={a.id} />
                            <input className="input" name="betreff" defaultValue={a.betreff} />
                            <textarea className="input" name="text" defaultValue={a.text} rows={8} />
                            <button className="btn btn-sm" type="submit" disabled={s.readOnly}>Text speichern</button>
                          </form>
                        ) : <pre className="small" style={{ whiteSpace: "pre-wrap" }}>{a.text}</pre>}
                      </details>
                      {a.fehler && <div className="small" style={{ color: "var(--danger)" }} data-testid="av-fehler">{a.fehler}</div>}
                    </td>
                    <td>{a.kanal === "brief" && (a.status === "entwurf" || a.status === "freigegeben") ? <form action={beilageAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="beilage" value={a.adelprepBeilage ? "0" : "1"} /><button className={`btn btn-sm ${a.adelprepBeilage ? "btn-primary" : ""}`} type="submit" disabled={s.readOnly} data-testid="av-beilage-schalter" data-an={a.adelprepBeilage ? "1" : "0"}>{a.adelprepBeilage ? "AdelPrep ✓" : "ohne"}</button></form> : a.adelprepBeilage ? "AdelPrep" : "–"}</td>
                    <td>{STATUS[a.status] ?? a.status}</td>
                    <td>
                      {(a.status === "beantwortet" || a.status === "versendet") ? (
                        <form action={anschreibenAction} className="row" style={{ gap: 4 }}>
                          <input type="hidden" name="id" value={a.id} />
                          <input className="input" name="umsatz" defaultValue={a.umsatz ?? ""} placeholder="Umsatz €" style={{ width: 75 }} />
                          <input className="input" name="marge" defaultValue={a.marge ?? ""} placeholder="Marge €" style={{ width: 75 }} />
                          <button className="btn btn-sm" type="submit" disabled={s.readOnly}>✓</button>
                        </form>
                      ) : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }} id="erfolg">
        <h2 style={{ margin: 0 }}>4. Chargen und Erfolg</h2>
        {erfolg.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Noch keine Charge freigegeben.</p> : (
          <table className="table small" data-testid="av-chargen">
            <thead><tr><th>Charge</th><th>Weg</th><th>Freigegeben</th><th>Anschreiben</th><th>Rücklauf</th><th>Umsatz</th><th>Marge</th><th>Briefkosten</th><th>je Rücklauf</th><th></th></tr></thead>
            <tbody>
              {erfolg.map((c) => (
                <tr key={c.id} data-testid="av-charge" data-nr={c.nr}>
                  <td>{c.nr}</td>
                  <td>{c.kanal === "email" ? "E-Mail" : "Brief"}</td>
                  <td>{c.freigegebenAm.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}</td>
                  <td>{c.anzahl} ({c.versendet} verschickt)</td>
                  <td>{c.ruecklaufProzent === null ? "–" : `${c.beantwortet} / ${c.ruecklaufProzent} %`}</td>
                  <td>{eur(c.umsatz)}</td>
                  <td>{eur(c.marge)}</td>
                  <td data-testid="av-charge-kosten">{eur(c.kosten)}</td>
                  <td data-testid="av-charge-je-ruecklauf">{eur(c.kostenJeRuecklauf)}</td>
                  <td className="row" style={{ gap: 6 }}>
                    {c.kanal === "brief" && <Link className="btn btn-sm btn-primary" href={`/b2b/abverkauf/versand/${c.id}`} data-testid="av-versand">Per Anbieter versenden</Link>}
                    {c.kanal === "brief" && <a className="btn btn-sm" href={`/b2b/abverkauf/datei?art=serienbrief&id=${c.id}`} data-testid="av-serienbrief">Serienbrief-PDF</a>}
                    {c.kanal === "brief" && !c.versendetAm && <form action={verschicktAction}><input type="hidden" name="charge" value={c.id} /><button className="btn btn-sm" type="submit" disabled={s.readOnly}>als verschickt markieren</button></form>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="small muted" style={{ margin: 0 }}>Antworten mit dem Bezug „AV-…“ (bzw. von der Lead-E-Mail) landen im Posteingang, setzen das Anschreiben auf „beantwortet“ und legen eine Aufgabe an; „keine Angebote“/Widerspruch setzt den Händler auf die Sperrliste.</p>
      </section>

      {faellig.length > 0 && (
        <section className="card card-pad stack" style={{ gap: 6 }}>
          <h2 style={{ margin: 0 }}>Löschfrist abgelaufen ({faellig.length})</h2>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {faellig.map((l) => (
              <li key={l.id} className="row" style={{ gap: 8 }}>{l.firma} · Löschfrist {datum(l.loeschenAm)} {inhaber && <form action={leadAction}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="was" value="loeschen" /><button className="btn btn-sm" type="submit">Jetzt löschen</button></form>}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
