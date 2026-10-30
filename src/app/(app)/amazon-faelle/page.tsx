import Link from "next/link";
import { requireOwner } from "@/lib/auth/session";
import { BEREICHE, BEREICH_LABEL, PHASE_LABEL, type Bereich, type Phase } from "@/lib/amazon-faelle/logic";
import { faelleKacheln, faelleListe, freischaltungen, infoDigest } from "@/lib/amazon-faelle/service";
import { todayIso } from "@/lib/dates";
import { abgleichAction } from "./actions";

// Amazon-Fall-Zentrale: alles, was Amazon zu Freischaltungen, Fällen, Erstattungen, Marke, Angeboten und Konto meldet –
// an einer Stelle, mit Status, Frist, Dringlichkeit und vorbereitetem Paket. Eingereicht wird in Seller Central.

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "–");
const DR = { rot: ["rot", "tag-danger"], gelb: ["gelb", "tag-warn"], grau: ["Info", "tag-neutral"] } as const;
const STATUS = { offen: "Offen", erledigt: "Erledigt", info: "Nur Info", alle: "Alle" } as const;

export default async function AmazonFaellePage({ searchParams }: { searchParams: Promise<{ bereich?: string; status?: string; markt?: string; q?: string; frist?: string; pruefen?: string; meldung?: string }> }) {
  const session = await requireOwner();
  const sp = await searchParams;
  const t = session.tenantId;
  const status = sp.status && sp.status in STATUS ? (sp.status as keyof typeof STATUS) : "offen";
  const bereich = sp.bereich && (BEREICHE as readonly string[]).includes(sp.bereich) ? sp.bereich : null;
  const frist = sp.frist && /^\d{1,2}$/.test(sp.frist) ? Number(sp.frist) : null;
  const [k, liste, fs, info] = await Promise.all([
    faelleKacheln(t),
    faelleListe(t, { status: status === "alle" ? null : status, bereich, marktplatz: sp.markt || null, q: sp.q || null, fristInTagen: frist, nurUnsicher: sp.pruefen === "1" }),
    freischaltungen(t),
    infoDigest(t),
  ]);
  const heute = todayIso();
  const link = (p: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const cur = { bereich, status, markt: sp.markt ?? null, q: sp.q ?? null, frist: sp.frist ?? null, pruefen: sp.pruefen ?? null, ...p };
    for (const [key, v] of Object.entries(cur)) if (v) q.set(key, v);
    return `/amazon-faelle?${q}`;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Amazon</div>
          <h1>Amazon-Fall-Zentrale</h1>
        </div>
        <form action={abgleichAction}>
          <button className="btn" type="submit" data-testid="faelle-abgleich">↻ Amazon-Mails einordnen</button>
        </form>
      </div>
      {sp.meldung && <div className="notice notice-info small" role="status" data-testid="faelle-meldung">{sp.meldung}</div>}
      <p className="small muted" style={{ margin: "0 0 12px", maxWidth: 880 }}>
        Freischaltungen, Fälle, Erstattungen, Markenbeschwerden, deaktivierte Angebote und Kontozustand aus allen Postfächern – zusammengehörige Mails (gleiche Fall-ID oder ASIN) in einem Vorgang. Wo etwas zu tun ist, liegt ein Paket bereit (Text DE/EN, Belege, Checkliste); eingereicht wird in Seller Central durch die VA oder dich.
      </p>

      <div className="grid-kpi" data-testid="faelle-kacheln">
        <Link className="card card-pad" href={link({ status: "offen", bereich: null, frist: null, pruefen: null, q: null })}>
          <div className="kpi-label">Antwort nötig</div>
          <div className="kpi-value" data-testid="kachel-antwort">{k.antwortNoetig}</div>
          <div className="small muted">{k.naechsteFrist ? `nächste Frist ${dmy(k.naechsteFrist)}` : "keine Frist offen"}</div>
        </Link>
        <Link className="card card-pad" href={link({ bereich: "freischaltung", status: "offen" })}>
          <div className="kpi-label">Freischaltungen</div>
          <div className="kpi-value" data-testid="kachel-freischaltung">{k.freiOffen} offen</div>
          <div className="small" style={k.freiEntzogen ? { color: "var(--danger)" } : undefined}>{k.freiAbgelehnt} abgelehnt · {k.freiEntzogen} entzogen</div>
        </Link>
        <Link className="card card-pad" href={link({ bereich: "fall", status: "offen" })}>
          <div className="kpi-label">Offene Fälle</div>
          <div className="kpi-value">{k.offeneFaelle}</div>
          <div className="small muted">{k.offeneFaelleBetrag ? eur(k.offeneFaelleBetrag) : "ohne Betrag"}</div>
        </Link>
        <Link className="card card-pad" href="/retouren">
          <div className="kpi-label">Erstattet ohne Rücksendung</div>
          <div className="kpi-value">{eur(k.ohneRuecksendung)}</div>
          <div className="small muted">{k.ohneRuecksendungN} Positionen (Retouren-Abgleich)</div>
        </Link>
        <div className="card card-pad">
          <div className="kpi-label">Von Amazon erhalten (7 Tage)</div>
          <div className="kpi-value">{eur(k.erhaltenWoche)}</div>
          <div className="small muted">{k.erhaltenWocheN} Entschädigungen</div>
        </div>
      </div>
      {(k.rot > 0 || k.unsicher > 0) && (
        <div className="small" style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "10px 0" }}>
          {k.rot > 0 && <span className="tag tag-danger" data-testid="faelle-rot">{k.rot} dringend (rot)</span>}
          {k.unsicher > 0 && <Link href={link({ pruefen: "1", status: "alle" })} className="tag tag-warn" data-testid="faelle-unsicher">{k.unsicher} bitte prüfen</Link>}
          {k.fristBald > 0 && <span className="tag tag-warn">{k.fristBald} mit Frist ≤ 3 Tage</span>}
        </div>
      )}

      <form className="small" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "14px 0 8px" }} data-testid="faelle-filter">
        <select className="select" name="bereich" defaultValue={bereich ?? ""} aria-label="Bereich" style={{ maxWidth: 220 }}>
          <option value="">alle Bereiche</option>
          {BEREICHE.map((b) => <option key={b} value={b}>{BEREICH_LABEL[b]}</option>)}
        </select>
        <select className="select" name="status" defaultValue={status} aria-label="Status" style={{ maxWidth: 140 }}>
          {Object.entries(STATUS).map(([key, v]) => <option key={key} value={key}>{v}</option>)}
        </select>
        <input className="input" name="markt" placeholder="Markt (DE …)" defaultValue={sp.markt ?? ""} aria-label="Marktplatz" style={{ maxWidth: 110 }} />
        <input className="input" name="frist" placeholder="Frist ≤ Tage" defaultValue={sp.frist ?? ""} aria-label="Frist in Tagen" style={{ maxWidth: 110 }} inputMode="numeric" />
        <input className="input" name="q" placeholder="Suche: Fall-ID, ASIN, Marke …" defaultValue={sp.q ?? ""} aria-label="Suche" style={{ maxWidth: 240 }} />
        <button className="btn btn-small" type="submit">Filtern</button>
      </form>

      {liste.length === 0 ? (
        <div className="card card-pad small muted" data-testid="faelle-leer">Keine Vorgänge für diesen Filter.</div>
      ) : (
        <div className="table-wrap card">
          <table className="table" data-testid="faelle-liste">
            <thead>
              <tr>
                <th></th>
                <th>Vorgang</th>
                <th>Bezug</th>
                <th>Frist</th>
                <th>Letzte Mail</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((v) => {
                const [dl, dc] = DR[v.dringlichkeit];
                const ueber = v.status === "offen" && v.frist && v.frist < heute;
                return (
                  <tr key={v.id} data-testid="fall-zeile" data-id={v.id} data-bereich={v.bereich} data-phase={v.phase}>
                    <td>
                      <span className={`tag ${v.status === "offen" ? dc : "tag-neutral"}`}>{v.status === "offen" ? dl : STATUS[v.status]}</span>
                      {v.unsicher && <div><span className="tag tag-warn" style={{ marginTop: 4 }}>bitte prüfen</span></div>}
                    </td>
                    <td style={{ maxWidth: 440 }}>
                      <Link href={`/amazon-faelle/${v.id}`} style={{ fontWeight: 600 }}>{v.titel}</Link>
                      <div className="small muted">{BEREICH_LABEL[v.bereich as Bereich] ?? v.bereich} · {PHASE_LABEL[v.phase as Phase] ?? v.phase}{v.zustaendig ? ` · zuständig: ${v.zustaendig === "va" ? "VA" : "Ludwig"}` : ""}</div>
                    </td>
                    <td className="small">
                      {v.fallnummer && <div>Fall {v.fallnummer}</div>}
                      {v.asins.length > 0 && <div className="num">{v.asins.slice(0, 2).join(", ")}{v.asins.length > 2 ? ` +${v.asins.length - 2}` : ""}</div>}
                      {v.marktplatz && <div className="muted">{v.marktplatz}{v.marke ? ` · ${v.marke}` : ""}</div>}
                      {v.betrag !== null && <div>{eur(v.betrag)}</div>}
                    </td>
                    <td className="small" style={ueber ? { color: "var(--danger)", fontWeight: 600 } : undefined}>{v.status === "offen" ? dmy(v.frist) : "–"}</td>
                    <td className="small num">{v.letzteMailAm.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ marginTop: 20 }}>Freischaltungen je Marke</h2>
      {fs.quote.length === 0 ? (
        <div className="card card-pad small muted">Noch keine Freischaltungs-Mails.</div>
      ) : (
        <div className="table-wrap card">
          <table className="table" data-testid="freischaltung-quote">
            <thead>
              <tr>
                <th>Marke</th>
                <th className="right">genehmigt</th>
                <th className="right">abgelehnt/entzogen</th>
                <th className="right">offen</th>
                <th>häufigste Gründe</th>
              </tr>
            </thead>
            <tbody>
              {fs.quote.map((q) => (
                <tr key={q.marke}>
                  <td>{q.marke}</td>
                  <td className="right num">{q.genehmigt}</td>
                  <td className="right num">{q.abgelehnt}</td>
                  <td className="right num">{q.offen}</td>
                  <td className="small">{q.haeufigsteGruende.join(", ") || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {fs.einkaufbar.length > 0 && <div className="notice notice-ok small" style={{ marginTop: 8 }}>Jetzt einkaufbar (genehmigt, offener Deal oder Deal-Eingang): {fs.einkaufbar.join(", ")}</div>}

      <h2 style={{ marginTop: 20 }}>Nur Info – letzte 7 Tage</h2>
      {info.length === 0 ? (
        <div className="card card-pad small muted">Keine Info-Mails.</div>
      ) : (
        <ul className="small" data-testid="faelle-info" style={{ margin: 0, paddingLeft: 18 }}>
          {info.map((i) => (
            <li key={i.id}><Link href={`/amazon-faelle/${i.id}`}>{i.titel}</Link> <span className="muted">· {i.am.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}</span></li>
          ))}
        </ul>
      )}
    </>
  );
}
