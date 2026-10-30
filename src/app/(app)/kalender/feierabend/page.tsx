import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { feierabend } from "@/lib/feierabend/service";
import { AUFWAND_TEXT, wochentag } from "@/lib/tagesplan/logic";
import { privatDetailsErlaubt } from "@/lib/tagesplan/service";
import { aufMorgenAction } from "./actions";

// Feierabend-Check: heute erledigt, offen (→ morgen), morgen Termine + Top-3 + Sperrzeiten; sonntags Wochenrückblick.

const WT = ["", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

export default async function FeierabendPage({ searchParams }: { searchParams: Promise<{ meldung?: string; rueckblick?: string; privat?: string }> }) {
  const session = await requireArea("kalender");
  const sp = await searchParams;
  const heute = todayIso();
  const mitPrivat = privatDetailsErlaubt(session) && sp.privat === "1";
  const f = await feierabend(session, { heute, mitPrivat, rueckblick: sp.rueckblick === "1" });
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Heute</div>
          <h1>Feierabend</h1>
          <div className="small muted">Was heute geschafft ist, was auf morgen rutscht – und was morgen ansteht.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!f.rueckblick && <Link className="btn" href="/kalender/feierabend?rueckblick=1">Wochenrückblick</Link>}
          {privatDetailsErlaubt(session) && <Link className="btn" href={mitPrivat ? "/kalender/feierabend" : `/kalender/feierabend?privat=1${sp.rueckblick === "1" ? "&rueckblick=1" : ""}`}>{mitPrivat ? "Privates ausblenden" : "Privates zeigen"}</Link>}
        </div>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>{sp.meldung}</div>}

      <div className="row">
        <section className="stack" style={{ flex: 1, minWidth: 0, gap: 12 }}>
          <div className="card card-pad" data-testid="fa-erledigt">
            <h2 style={{ marginTop: 0 }}>✓ Heute erledigt ({f.erledigt.length})</h2>
            {f.erledigt.length === 0 ? <p className="small muted">Heute noch nichts abgehakt.</p> : <ul className="small" style={{ paddingLeft: 18 }}>{f.erledigt.map((e) => <li key={e.id}>{e.link ? <Link href={e.link}>{e.titel}</Link> : e.titel}</li>)}</ul>}
          </div>
          <div className="card card-pad" data-testid="fa-offen">
            <h2 style={{ marginTop: 0 }}>Noch offen ({f.offen.length})</h2>
            {f.offen.length === 0 ? (
              <p className="small muted">Nichts mehr fällig – schönen Feierabend!</p>
            ) : (
              <>
                <ul className="small" style={{ paddingLeft: 18 }}>
                  {f.offen.map((o) => <li key={o.id}>{o.wichtig && <span className="tag tag-critical">wichtig</span>} {o.link ? <Link href={o.link}>{o.titel}</Link> : o.titel}{o.frist && o.frist < heute ? <span className="muted"> · seit {o.frist.split("-").reverse().join(".")}</span> : null}</li>)}
                </ul>
                <form action={aufMorgenAction}>
                  <button className="btn" type="submit" data-testid="fa-auf-morgen">Auf morgen schieben</button>
                  <span className="small muted"> – wichtige bleiben stehen und brauchen eine Entscheidung.</span>
                </form>
              </>
            )}
          </div>
        </section>
        <aside className="col-side">
          <div className="card card-pad" data-testid="fa-morgen">
            <h2 style={{ marginTop: 0 }}>Morgen · {WT[wochentag(f.morgen)]}</h2>
            <div className="small muted">{f.morgenArbeitszeit ? `Arbeitszeit ${f.morgenArbeitszeit.von}–${f.morgenArbeitszeit.bis}` : "kein Arbeitstag"}</div>
            {f.morgenSperren.length > 0 && (
              <div className="notice notice-info small" style={{ margin: "8px 0" }}>
                {f.morgenSperren.map((s, i) => <div key={i}>⛔ {s.ganztags ? "ganztägig" : s.art === "reserviert" ? "reserviert" : `${s.von}–${s.bis}`} · {s.titel}</div>)}
              </div>
            )}
            <h3 style={{ marginBottom: 4 }}>Termine</h3>
            {f.morgenTermine.length === 0 ? <p className="small muted">Keine.</p> : <ul className="small" style={{ paddingLeft: 18, marginTop: 0 }}>{f.morgenTermine.map((s, i) => <li key={i}>{s.von}–{s.bis} · {s.titel}</li>)}</ul>}
            <h3 style={{ marginBottom: 4 }}>Top 3</h3>
            {f.morgenTop3.length === 0 ? <p className="small muted">Nichts eingeplant.</p> : <ol className="small" style={{ paddingLeft: 18, marginTop: 0 }}>{f.morgenTop3.map((g) => <li key={g.id}>{g.titel} <span className="muted">({g.von} · {AUFWAND_TEXT[g.aufwand]})</span></li>)}</ol>}
            {f.morgenKonflikte.length > 0 && <div className="notice notice-warn small">{f.morgenKonflikte.map((k, i) => <div key={i}>{k.titel}: {k.text}</div>)}</div>}
            <Link className="small" href={`/kalender/tagesplan?tag=${f.morgen}`}>Tagesplan morgen →</Link>
          </div>
        </aside>
      </div>

      {f.rueckblick && (
        <section className="card card-pad" style={{ marginTop: 14 }} data-testid="fa-rueckblick">
          <h2 style={{ marginTop: 0 }}>Wochenrückblick</h2>
          <p className="small muted">{f.rueckblick.geschaeft.zeitraum.von.split("-").reverse().join(".")} – {f.rueckblick.geschaeft.zeitraum.bis.split("-").reverse().join(".")}: {f.rueckblick.geschaeft.erledigtGesamt} Aufgaben erledigt.</p>
          <ul className="small" style={{ paddingLeft: 18 }}>{f.rueckblick.geschaeft.erledigtJePerson.map((p) => <li key={p.person}>{p.person}: {p.anzahl}</li>)}</ul>
          {f.rueckblick.privat ? (
            <div className="small">
              <strong>Familie:</strong> {String(f.rueckblick.privat.familienzeitStunden).replace(".", ",")} Std. Familienzeit{f.rueckblick.privat.familienzeitOhneUhrzeit ? ` (+ ${f.rueckblick.privat.familienzeitOhneUhrzeit} Einträge ohne Uhrzeit)` : ""} · Paarzeit: {f.rueckblick.privat.paarzeit ? `ja (${f.rueckblick.privat.paarzeitAnzahl}×)` : "nein"}
            </div>
          ) : (
            privatDetailsErlaubt(session) && <div className="small muted">Familienzeit und Paarzeit: „Privates zeigen“.</div>
          )}
        </section>
      )}
    </>
  );
}
