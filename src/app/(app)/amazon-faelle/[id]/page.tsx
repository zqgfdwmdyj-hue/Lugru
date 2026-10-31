import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/session";
import { ABLEHNUNGSGRUND_LABEL, BEREICHE, BEREICH_LABEL, PHASEN, PHASE_LABEL, VERLANGT_LABEL, type Ablehnungsgrund, type Bereich, type Phase, type Verlangt } from "@/lib/amazon-faelle/logic";
import { fallDetail, SETZBARE_PHASEN } from "@/lib/amazon-faelle/service";
import { anVaAction, einordnungAction, statusAction } from "../actions";

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "–");
const zeit = (d: Date) => d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });
const DR = { rot: "tag-danger", gelb: "tag-warn", grau: "tag-neutral" } as const;

export default async function FallPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireOwner();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await fallDetail(session.tenantId, id);
  if (!d) notFound();
  const v = d.vorgang;
  const p = v.paket;

  return (
    <>
      <div className="crumb"><Link href="/amazon-faelle">Amazon-Fall-Zentrale</Link> › {BEREICH_LABEL[v.bereich as Bereich] ?? v.bereich}</div>
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 20 }}>{v.titel}</h1>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            <span className={`tag ${v.status === "offen" ? DR[v.dringlichkeit] : "tag-neutral"}`} data-testid="fall-dringlichkeit">{v.status === "offen" ? v.dringlichkeit : v.status === "info" ? "Info" : "erledigt"}</span>
            <span className="tag tag-neutral" data-testid="fall-phase">{PHASE_LABEL[v.phase as Phase] ?? v.phase}</span>
            {v.unsicher && <span className="tag tag-warn">bitte prüfen</span>}
            {v.zustaendig && <span className="tag tag-neutral">zuständig: {v.zustaendig === "va" ? "VA" : "Ludwig"}</span>}
          </div>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-info small" role="status" data-testid="fall-meldung">{sp.meldung}</div>}

      <div className="row">
        <div className="stack" style={{ flexGrow: 1, minWidth: 0, gap: 14 }}>
          <section className="card card-pad small" data-testid="fall-bezuege">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
              <div><span className="muted">Fall-ID</span><div>{v.fallnummer ?? "–"}</div></div>
              <div><span className="muted">Frist</span><div style={v.status === "offen" && v.frist ? { fontWeight: 600 } : undefined}>{v.status === "offen" ? dmy(v.frist) : "–"}</div></div>
              <div><span className="muted">Marktplatz</span><div>{v.marktplatz ?? "–"}</div></div>
              <div><span className="muted">Marke</span><div>{v.marke ?? "–"}</div></div>
              <div><span className="muted">ASIN</span><div className="num">{v.asins.join(", ") || "–"}</div></div>
              <div><span className="muted">SKU</span><div>{v.skus.join(", ") || "–"}</div></div>
              {v.shipmentId && <div><span className="muted">Sendung</span><div>{v.shipmentId}</div></div>}
              {v.bestellnummer && <div><span className="muted">Bestellung</span><div>{v.bestellnummer}</div></div>}
              {v.betrag !== null && <div><span className="muted">Betrag</span><div>{eur(v.betrag)}</div></div>}
            </div>
            {v.ablehnungsgruende.length > 0 && <div style={{ marginTop: 8 }}><span className="muted">Ablehnungsgrund: </span>{v.ablehnungsgruende.map((g) => ABLEHNUNGSGRUND_LABEL[g as Ablehnungsgrund] ?? g).join(", ")}</div>}
            {v.verlangt.length > 0 && <div style={{ marginTop: 4 }}><span className="muted">Amazon verlangt: </span>{v.verlangt.map((x) => VERLANGT_LABEL[x as Verlangt] ?? x).join(", ")}</div>}
            {d.bestand && d.bestand.stueck > 0 && (
              <div className="notice notice-error small" style={{ marginTop: 8 }} data-testid="fall-bestand">
                Betroffener Bestand: {d.bestand.stueck} Stück · EK {eur(d.bestand.ekWert)} · Umsatz ~{eur(d.bestand.umsatzMonat)} je Monat
              </div>
            )}
            {(v.phase === "entzogen" || v.bereich === "marke") && <div className="small muted" style={{ marginTop: 6 }}>Bei Entzug oder Markenbeschwerde ggf. den SAS-Consultant einbeziehen. <Link href="/echtheit">Echtheits-Ordner / Audit-Paket</Link></div>}
          </section>

          {p && (
            <section className="card card-pad stack" style={{ gap: 10 }} data-testid="fall-paket">
              <h2>Paket</h2>
              {p.fehlt.length > 0 && (
                <div className="notice notice-warn small" data-testid="fall-fehlt">
                  <strong>Fehlt noch – so nicht einreichen:</strong>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{p.fehlt.map((f) => <li key={f}>{f}</li>)}</ul>
                </div>
              )}
              <div className="small">
                <strong>Checkliste</strong>
                <ol style={{ margin: "4px 0 0", paddingLeft: 18 }}>{p.checkliste.map((c) => <li key={c}>{c}</li>)}</ol>
              </div>
              {p.belege.length > 0 && (
                <div className="small" data-testid="fall-belege">
                  <strong>Belege</strong>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{p.belege.map((b) => <li key={b.id}>{b.fileId ? <a href={`/datei/${b.fileId}`}>{b.name}</a> : b.name}</li>)}</ul>
                </div>
              )}
              <div className="pk-form-grid">
                <div className="field"><label className="label small" htmlFor="text-de">Text DE (kopieren)</label><textarea id="text-de" className="textarea" readOnly rows={8} defaultValue={p.texte.de} data-testid="fall-text-de" /></div>
                <div className="field"><label className="label small" htmlFor="text-en">Text EN (kopieren)</label><textarea id="text-en" className="textarea" readOnly rows={8} defaultValue={p.texte.en} data-testid="fall-text-en" /></div>
              </div>
            </section>
          )}

          <section className="card card-pad stack" style={{ gap: 8 }} data-testid="fall-verlauf">
            <h2>Verlauf</h2>
            {d.verlauf.map((x) => (
              <div key={x.id} className="small" style={{ borderBottom: "1px solid var(--row)", paddingBottom: 6 }}>
                <div className="between"><strong>{x.art === "mail" ? "✉️ Mail" : x.art === "va" ? "🤝 VA" : x.art === "notiz" ? "📝 Notiz" : "🔁 Status"}</strong><span className="muted">{zeit(x.am)}{x.von ? ` · ${x.von}` : ""}</span></div>
                <div>{x.text}</div>
                {x.mailText && (
                  <details>
                    <summary style={{ cursor: "pointer" }}>Original{x.emailId && <> · <Link href={`/posteingang/${x.emailId}`}>im Posteingang</Link></>}</summary>
                    <div style={{ whiteSpace: "pre-wrap", marginTop: 6, color: "var(--ink-2)" }}>{x.mailText.slice(0, 6000)}</div>
                  </details>
                )}
              </div>
            ))}
            {d.todos.length > 0 && <div className="small muted">Amazon-ToDos dazu: {d.todos.map((t) => `${t.summary ?? t.category} (${t.status === "open" ? "offen" : "erledigt"})`).join(" · ")} – <Link href="/amazon-todos">Liste</Link></div>}
            {d.ansprueche.length > 0 && <div className="small">Ansprüche: {d.ansprueche.map((a) => <Link key={a.id} href={`/ansprueche/${a.id}`}>{a.title}</Link>)}</div>}
          </section>
        </div>

        <aside className="col-side stack" style={{ gap: 12 }}>
          <section className="card card-pad stack" style={{ gap: 8 }}>
            <h2>Übergabe</h2>
            <form action={anVaAction}>
              <input type="hidden" name="id" value={v.id} />
              <button className="btn btn-primary" type="submit" data-testid="fall-an-va" disabled={v.status === "erledigt"}>{d.task ? "Erneut an die VA" : "An die VA geben"}</button>
            </form>
            <div className="small muted">Discord-Thread mit Text DE/EN, Checkliste und Rechnungen; die VA meldet Fallnummer und ✅. {d.task ? `Aufgabe: ${d.task.status === "done" ? "erledigt" : "offen"}.` : ""}</div>
          </section>
          <section className="card card-pad stack" style={{ gap: 8 }}>
            <h2>Status</h2>
            <form action={statusAction} className="stack" style={{ gap: 8 }} data-testid="fall-status-form">
              <input type="hidden" name="id" value={v.id} />
              <select className="select" name="phase" defaultValue="" aria-label="Neuer Status">
                <option value="">Status unverändert</option>
                {SETZBARE_PHASEN.map((ph) => <option key={ph} value={ph}>{PHASE_LABEL[ph as Phase] ?? ph}</option>)}
              </select>
              <input className="input" name="fallnummer" placeholder="Fallnummer (optional)" defaultValue="" inputMode="numeric" aria-label="Fallnummer" />
              <textarea className="textarea" name="notiz" rows={2} placeholder="Notiz (optional)" aria-label="Notiz" />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn btn-small" type="submit" data-testid="fall-status-speichern">Speichern</button>
                <button className="btn btn-small" type="submit" name="erledigt" value="1" data-testid="fall-erledigt">Erledigt</button>
              </div>
            </form>
          </section>
          <details className="card card-pad" open={v.unsicher} data-testid="fall-einordnung">
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Einordnung korrigieren</summary>
            <form action={einordnungAction} className="stack" style={{ gap: 8, marginTop: 8 }}>
              <input type="hidden" name="id" value={v.id} />
              <select className="select" name="bereich" defaultValue={v.bereich} aria-label="Bereich">{BEREICHE.map((b) => <option key={b} value={b}>{BEREICH_LABEL[b]}</option>)}</select>
              <select className="select" name="phase" defaultValue={v.phase} aria-label="Phase">{PHASEN.map((ph) => <option key={ph} value={ph}>{PHASE_LABEL[ph]}</option>)}</select>
              <button className="btn btn-small" type="submit" data-testid="fall-einordnung-speichern">Übernehmen (lernt für gleiche Betreffs)</button>
            </form>
          </details>
        </aside>
      </div>
    </>
  );
}
