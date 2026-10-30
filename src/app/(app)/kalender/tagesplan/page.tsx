import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { AutoStatus } from "@/components/auto-status";
import { getIntegration } from "@/lib/integrations/store";
import { todayIso } from "@/lib/dates";
import { AUFWAND_TEXT, plusTage, wochentag, type TagPlan } from "@/lib/tagesplan/logic";
import { privatDetailsErlaubt, tagesplan } from "@/lib/tagesplan/service";
import { alleVerschiebenAction, arbeitszeitAction, aufwandAction, verschiebenAction } from "./actions";

// Tagesplan: was passt heute rein, was wird bewusst verschoben, welche Konflikte gibt es; Woche mit Ampel je Tag.

const WT = ["", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const dm = (iso: string) => `${WT[wochentag(iso)]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const std = (min: number) => (min % 60 ? `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")} Std.` : `${min / 60} Std.`);
const AMPEL = { gruen: ["tag-ok", "passt"], gelb: ["tag-warn", "voll"], rot: ["tag-danger", "überbucht"], frei: ["tag-neutral", "frei"] } as const;
const PRIO = { critical: ["tag-critical", "wichtig"], normal: null, low: ["tag-neutral", "niedrig"] } as const;
const SPERRE = { privat: "tag-info", termin: "tag-neutral", frei: "tag-ok", reserviert: "tag-warn" } as const;

export default async function TagesplanPage({ searchParams }: { searchParams: Promise<{ tag?: string; privat?: string; meldung?: string }> }) {
  const session = await requireArea("kalender");
  const sp = await searchParams;
  const heute = todayIso();
  const tag = sp.tag && /^\d{4}-\d{2}-\d{2}$/.test(sp.tag) ? sp.tag : heute;
  const darfPrivat = privatDetailsErlaubt(session);
  const mitPrivat = darfPrivat && sp.privat === "1";
  const p = await tagesplan(session, { start: tag, tage: 7, mitPrivat, heute });
  const d: TagPlan = p.tage[0];
  // Fahrzeugstatus (Modul 12) nur für den Inhaber und nur, wenn Tesla verbunden ist.
  const auto = session.role === "owner" && Boolean((await getIntegration(session.tenantId, "tesla"))?.accessToken);
  const hidden = (
    <>
      <input type="hidden" name="tag" value={tag} />
      {mitPrivat && <input type="hidden" name="privat" value="1" />}
    </>
  );
  const q = (o: Record<string, string>) => `/kalender/tagesplan?${new URLSearchParams({ ...(tag !== heute ? { tag } : {}), ...(mitPrivat ? { privat: "1" } : {}), ...o }).toString()}`;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Heute</div>
          <h1>Tagesplan</h1>
          <div className="small muted">Arbeitszeit minus Termine, Familienzeit und freie Zeiten – darin die Aufgaben nach Priorität und Frist.</div>
          {auto && <div style={{ marginTop: 6 }}><AutoStatus /></div>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Link className="btn" href={`/kalender/tagesplan?tag=${plusTage(tag, -1)}${mitPrivat ? "&privat=1" : ""}`}>‹</Link>
          <form style={{ display: "flex", gap: 6 }}>
            <input type="date" name="tag" defaultValue={tag} aria-label="Tag" />
            {mitPrivat && <input type="hidden" name="privat" value="1" />}
            <button className="btn" type="submit">Zeigen</button>
          </form>
          <Link className="btn" href={`/kalender/tagesplan?tag=${plusTage(tag, 1)}${mitPrivat ? "&privat=1" : ""}`}>›</Link>
          {tag !== heute && <Link className="btn" href="/kalender/tagesplan">Heute</Link>}
          {darfPrivat && (
            <Link className="btn" href={mitPrivat ? `/kalender/tagesplan?tag=${tag}` : `/kalender/tagesplan?tag=${tag}&privat=1`} data-testid="tagesplan-privat">
              {mitPrivat ? "Private Details ausblenden" : "Private Details zeigen"}
            </Link>
          )}
        </div>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>{sp.meldung}</div>}

      {/* Woche mit Ampel je Tag */}
      <div className="card card-pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, marginBottom: 14 }} data-testid="tagesplan-woche">
        {p.tage.map((t) => (
          <Link key={t.tag} href={q({ tag: t.tag })} className="small" style={{ display: "block", padding: 8, borderRadius: 8, border: t.tag === tag ? "2px solid var(--accent)" : "1px solid var(--border)", textDecoration: "none", color: "inherit" }} data-ampel={t.ampel}>
            <div><strong>{dm(t.tag)}</strong></div>
            <span className={`tag ${AMPEL[t.ampel][0]}`} data-testid="tagesplan-ampel">{t.ampel === "frei" && t.arbeitszeit ? "keine freie Zeit" : AMPEL[t.ampel][1]}</span>
            <div className="muted" style={{ marginTop: 4 }}>{t.kapazitaet ? `${std(t.belegt)} von ${std(t.kapazitaet)}` : t.arbeitszeit ? "Arbeitszeit belegt" : "keine Arbeitszeit"}</div>
            {t.konflikte.length > 0 && <div style={{ color: "var(--danger)" }}>{t.konflikte.length} Konflikt{t.konflikte.length === 1 ? "" : "e"}</div>}
          </Link>
        ))}
      </div>

      <div className="row">
        <section className="stack" style={{ gap: 12, flex: 1, minWidth: 0 }}>
          <div className="card card-pad" data-testid="tagesplan-tag">
            <h2 style={{ marginTop: 0 }}>
              {dm(d.tag)} · {d.arbeitszeit ? `${d.arbeitszeit.von}–${d.arbeitszeit.bis}` : "kein Arbeitstag"}
            </h2>
            <div className="small muted" data-testid="tagesplan-kapazitaet">
              Kapazität {std(d.kapazitaet)} · eingeplant {std(d.belegt)}
              {d.auslastung !== null ? ` (${d.auslastung} %)` : ""}
            </div>
            {d.konflikte.length > 0 && (
              <ul className="notice notice-warn small" style={{ margin: "10px 0", paddingLeft: 24 }} data-testid="tagesplan-konflikte">
                {d.konflikte.map((k, i) => (
                  <li key={i}>
                    <strong>{k.titel}:</strong> {k.text}
                  </li>
                ))}
              </ul>
            )}
            {d.geplant.length === 0 ? (
              <p className="muted small">Für diesen Tag ist nichts eingeplant.</p>
            ) : (
              <table className="table" style={{ marginTop: 10 }} data-testid="tagesplan-geplant">
                <tbody>
                  {d.geplant.map((g) => (
                    <tr key={g.id}>
                      <td className="num" style={{ whiteSpace: "nowrap" }}>{g.von}–{g.bis}</td>
                      <td>
                        {g.link ? <Link href={g.link}>{g.titel}</Link> : g.titel}
                        {PRIO[g.prioritaet] && <span className={`tag ${PRIO[g.prioritaet]![0]}`} style={{ marginLeft: 6 }}>{PRIO[g.prioritaet]![1]}</span>}
                        {g.faellig && g.faellig > d.tag && <span className="small muted"> · vorgezogen (Frist {dm(g.faellig)})</span>}
                      </td>
                      <td>
                        <form action={aufwandAction} style={{ display: "flex", gap: 4 }}>
                          {hidden}
                          <input type="hidden" name="id" value={g.id} />
                          <select name="aufwand" defaultValue={g.geschaetzt ? "" : g.aufwand} aria-label="Aufwand">
                            <option value="">{`${g.gelernt ? "gelernt" : "geschätzt"}: ${g.aufwand}`}</option>
                            {(["S", "M", "L"] as const).map((a) => <option key={a} value={a}>{AUFWAND_TEXT[a]}</option>)}
                          </select>
                          <button className="btn btn-small" type="submit">OK</button>
                        </form>
                      </td>
                      <td>
                        <form action={verschiebenAction} style={{ display: "flex", gap: 4 }}>
                          {hidden}
                          <input type="hidden" name="id" value={g.id} />
                          <input type="date" name="datum" defaultValue={plusTage(d.tag, 1)} aria-label="Neues Datum" />
                          <button className="btn btn-small" type="submit">verschieben</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {p.verschoben.length > 0 && (
            <div className="card card-pad" data-testid="tagesplan-verschoben">
              <h3 style={{ marginTop: 0 }}>Bewusst verschoben ({p.verschoben.length})</h3>
              <div className="small muted">Passt nicht mehr in den Tag – vorgeschlagen ist der nächste Tag mit Platz.</div>
              <table className="table" style={{ marginTop: 8 }}>
                <tbody>
                  {p.verschoben.map((v) => (
                    <tr key={v.id}>
                      <td>{v.link ? <Link href={v.link}>{v.titel}</Link> : v.titel}</td>
                      <td className="small" style={{ whiteSpace: "nowrap" }}>{v.faellig ? dm(v.faellig) : "–"} → <strong>{dm(v.neu)}</strong></td>
                      <td>
                        <form action={verschiebenAction}>
                          {hidden}
                          <input type="hidden" name="id" value={v.id} />
                          <input type="hidden" name="datum" value={v.neu} />
                          <button className="btn btn-small" type="submit">übernehmen</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <form action={alleVerschiebenAction} style={{ marginTop: 8 }}>
                {hidden}
                {p.verschoben.map((v) => <input key={v.id} type="hidden" name="v" value={`${v.id}|${v.neu}`} />)}
                <button className="btn" type="submit">Alle neuen Daten übernehmen</button>
              </form>
            </div>
          )}

          {p.ohneFrist.length > 0 && (
            <details className="card card-pad">
              <summary>
                <strong>Ohne Frist ({p.ohneFrist.length})</strong> <span className="small muted">– werden nicht eingeplant; bei Bedarf ein Datum setzen.</span>
              </summary>
              <ul className="small" style={{ paddingLeft: 18 }}>
                {p.ohneFrist.slice(0, 50).map((a) => <li key={a.id}>{a.link ? <Link href={a.link}>{a.titel}</Link> : a.titel}</li>)}
              </ul>
            </details>
          )}
        </section>

        <aside className="col-side">
          <div className="card card-pad" data-testid="tagesplan-sperren">
            <h3 style={{ marginTop: 0 }}>Belegt</h3>
            {d.sperren.length === 0 ? (
              <p className="small muted">Keine Termine oder Sperrzeiten.</p>
            ) : (
              <ul className="small" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {[...d.sperren].sort((a, b) => a.von.localeCompare(b.von)).map((s, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    <span className={`tag ${SPERRE[s.art]}`}>{s.ganztags ? "ganztägig" : s.art === "reserviert" ? "reserviert" : `${s.von}–${s.bis}`}</span> {s.titel}
                  </li>
                ))}
              </ul>
            )}
            {!mitPrivat && <div className="small muted" style={{ marginTop: 6 }}>Private Einträge erscheinen nur als „Privat belegt“.</div>}
          </div>

          {p.wartetAuf.length > 0 && (
            <div className="card card-pad" data-testid="tagesplan-wartet">
              <h3 style={{ marginTop: 0 }}>Wartet auf …</h3>
              {p.wartetAuf.map((w) => (
                <div key={w.person} style={{ marginBottom: 8 }}>
                  <strong className="small">{w.person}</strong> <span className="small muted">({w.aufgaben.length}{w.aufgaben.some((a) => a.ueberfaellig) ? `, ${w.aufgaben.filter((a) => a.ueberfaellig).length} überfällig` : ""})</span>
                  <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {w.aufgaben.slice(0, 8).map((a) => (
                      <li key={a.id} style={a.ueberfaellig ? { color: "var(--danger)" } : undefined}>
                        {a.link ? <Link href={a.link}>{a.titel}</Link> : a.titel}
                        {a.faellig ? ` · ${dm(a.faellig)}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {p.hinweise.length > 0 && (
            <ul className="small muted" style={{ paddingLeft: 18, margin: 0 }}>
              {p.hinweise.map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          )}

          <details className="card card-pad" id="arbeitszeit">
            <summary><strong>Meine Arbeitszeit</strong></summary>
            <form action={arbeitszeitAction} className="small" style={{ marginTop: 8 }}>
              {hidden}
              <table className="table">
                <tbody>
                  {[1, 2, 3, 4, 5, 6, 7].map((wt) => {
                    const a = p.arbeitszeit[String(wt)];
                    return (
                      <tr key={wt}>
                        <td>{WT[wt]}</td>
                        <td><input name={`von${wt}`} defaultValue={a?.von ?? ""} placeholder="frei" style={{ width: 70 }} aria-label={`${WT[wt]} von`} /></td>
                        <td><input name={`bis${wt}`} defaultValue={a?.bis ?? ""} placeholder="frei" style={{ width: 70 }} aria-label={`${WT[wt]} bis`} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="muted" style={{ margin: "6px 0" }}>Beide Felder leer = kein Arbeitstag. Feste freie Zeiten und reservierte Stunden: <Link href="/kalender/zeiten">Zeiten</Link>.</div>
              <button className="btn" type="submit">Speichern</button>
            </form>
          </details>
        </aside>
      </div>
    </>
  );
}
