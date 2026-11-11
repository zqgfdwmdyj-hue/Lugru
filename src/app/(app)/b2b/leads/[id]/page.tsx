import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireArea } from "@/lib/auth/session";
import { datumDe, leadDetail } from "@/lib/abverkauf/lead-maschine";
import { ZIEL_TEXT, type LeadZiel } from "@/lib/abverkauf/lead-maschine-logic";
import { konfliktAction, loeschenAction, sperrenAction } from "../actions";

export const metadata: Metadata = { title: "Lead – Seller-System" };
export const dynamic = "force-dynamic";

// B35 Einzelansicht: Quelle, Abrufdatum, Impressum-URL, Rechtsgrundlage, Löschdatum, Bewertung, Verlauf (Versanddaten),
// Auskunft (JSON) und Löschen mit einem Klick.

const PUNKTE_TEXT: Record<string, string> = { fit: "Fit", erreichbar: "Erreichbarkeit", nutzen: "Nutzen" };

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ meldung?: string }> }) {
  const s = await requireArea("b2b");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await leadDetail(s.tenantId, id);
  if (!d) notFound();
  const { l, sperre, anschreiben } = d;
  const inhaber = s.role === "owner" && !s.readOnly;
  const konflikt = (l.ausschluss ?? "").toLowerCase().includes("konflikt") || l.konfliktFreigabe;
  return (
    <div className="stack" style={{ maxWidth: 1000 }} data-testid="lead-detail" data-sperre={sperre ? "1" : "0"}>
      <div className="page-head"><div><div className="crumb"><Link href="/b2b/leads">Leads</Link></div><h1>{l.firma}</h1></div></div>
      {sp.meldung && <div className="notice notice-ok small" role="status" data-testid="ld-meldung">{sp.meldung}</div>}
      {sperre && <div className="notice notice-warn small" data-testid="lead-sperre">Nicht in einer Charge: {sperre}</div>}

      <section className="card card-pad stack" style={{ gap: 6 }}>
        <h2 style={{ margin: 0 }}>Stammdaten</h2>
        <table className="table small"><tbody>
          <tr><th>Anschrift</th><td>{[l.strasse, [l.plz, l.ort].filter(Boolean).join(" "), l.land].filter(Boolean).join(", ") || "– (ohne Anschrift kein Brief)"}</td></tr>
          <tr><th>Rechtsform / Branche</th><td>{l.rechtsform ?? "–"} · {l.kategorie ?? "–"}</td></tr>
          <tr><th>Website</th><td>{l.website ?? "–"}</td></tr>
          <tr><th>USt-IdNr. / Register</th><td data-testid="lead-ust">{l.ustId ?? "–"} · {l.registerNr ?? "–"}</td></tr>
          <tr><th>E-Mail</th><td>{l.email ? <>{l.email} <span className="muted">({l.emailQuelle ?? "Quelle unbekannt"} – nur für Antworten, keine Werbe-E-Mail)</span></> : "–"}</td></tr>
          <tr><th>Größe</th><td>{[l.mitarbeiter ? `${l.mitarbeiter} Mitarbeiter` : null, l.anzahlAsins ? `${l.anzahlAsins} Artikel` : null, l.stueckJeArtikel ? `ca. ${l.stueckJeArtikel} Stück je Artikel` : null, l.marken ? `Marken: ${l.marken}` : null].filter(Boolean).join(" · ") || "–"}</td></tr>
        </tbody></table>
      </section>

      <section className="card card-pad stack" style={{ gap: 6 }} data-testid="lead-herkunft">
        <h2 style={{ margin: 0 }}>Herkunft und Datenschutz</h2>
        <table className="table small"><tbody>
          <tr><th>Quelle</th><td>{l.quelle}</td></tr>
          <tr><th>Abrufdatum</th><td>{datumDe(l.quelleDatum)}</td></tr>
          <tr><th>Impressum</th><td>{l.impressumUrl ?? "–"}{l.impressumHinweis && <div className="muted">{l.impressumHinweis}</div>}</td></tr>
          <tr><th>Rechtsgrundlage / Zweck</th><td>{l.rechtsgrundlage} · {l.zweck}</td></tr>
          <tr><th>Löschen am</th><td>{datumDe(l.loeschenAm)} (12 Monate ohne Kontakt; jeder Brief/jede Antwort verlängert)</td></tr>
          <tr><th>Letzter Brief</th><td>{datumDe(l.letzterBriefAm)}</td></tr>
        </tbody></table>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <a className="btn btn-sm" href={`/b2b/leads/${l.id}/auskunft`} data-testid="lead-auskunft">Auskunft (JSON)</a>
          {l.status !== "gesperrt" && <form action={sperrenAction}><input type="hidden" name="id" value={l.id} /><button className="btn btn-sm" type="submit" disabled={s.readOnly} data-testid="lead-sperren">Sperren (Widerspruch)</button></form>}
          {inhaber && <form action={loeschenAction}><input type="hidden" name="id" value={l.id} /><button className="btn btn-sm" type="submit" data-testid="lead-loeschen">Alle Daten löschen</button></form>}
        </div>
      </section>

      <section className="card card-pad stack" style={{ gap: 6 }} data-testid="lead-bewertung">
        <h2 style={{ margin: 0 }}>Bewertung</h2>
        <div className="small">Priorität <strong data-testid="lead-prio">{l.prioritaet}</strong> · Empfehlung: <strong>{l.empfZiel ? ZIEL_TEXT[l.empfZiel as LeadZiel] : "–"}</strong>{l.empfBeilage ? " · Beilage AdelPrep empfohlen" : ""}</div>
        <div className="small muted">Priorität = Fit × Erreichbarkeit × Nutzen. {Object.entries(l.punkte ?? {}).map(([k, v]) => `${PUNKTE_TEXT[k] ?? k}: ${v}`).join(" · ")}</div>
        {l.markierungen.length > 0 && <div className="small">Hinweise: {l.markierungen.join(" · ")}</div>}
        {l.ausschluss && <div className="small" style={{ color: "var(--danger)" }}>Ausgeschlossen: {l.ausschluss}</div>}
        {konflikt && inhaber && (
          <form action={konfliktAction} className="row small" style={{ gap: 6 }}>
            <input type="hidden" name="id" value={l.id} />
            <input type="hidden" name="an" value={l.konfliktFreigabe ? "0" : "1"} />
            <button className="btn btn-sm" type="submit" data-testid="lead-konflikt">{l.konfliktFreigabe ? "Freigabe Konfliktbranche zurücknehmen" : "Konfliktbranche ausnahmsweise freigeben"}</button>
          </form>
        )}
      </section>

      <section className="card card-pad stack" style={{ gap: 6 }}>
        <h2 style={{ margin: 0 }}>Anschreiben ({anschreiben.length})</h2>
        {anschreiben.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Noch keine.</p> : (
          <table className="table small"><thead><tr><th>Bezug</th><th>Betreff</th><th>Weg</th><th>Status</th><th>Erstellt</th><th>Versendet</th><th>Beilage</th></tr></thead>
            <tbody>{anschreiben.map((a) => <tr key={a.id}><td>{a.code}</td><td>{a.betreff}</td><td>{a.kanal === "email" ? "E-Mail" : "Brief"}</td><td>{a.status}</td><td>{a.erstellt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}</td><td>{a.versendetAm ? a.versendetAm.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" }) : "–"}</td><td>{a.beilage ? "AdelPrep" : "–"}</td></tr>)}</tbody>
          </table>
        )}
      </section>

      <section className="card card-pad stack" style={{ gap: 6 }} data-testid="lead-verlauf">
        <h2 style={{ margin: 0 }}>Verlauf</h2>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {[...l.verlauf].reverse().map((v, i) => <li key={i}>{new Date(v.am).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })} – {v.was}</li>)}
        </ul>
      </section>
    </div>
  );
}
