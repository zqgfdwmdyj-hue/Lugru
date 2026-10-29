import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { RETOUREN_BEFUNDE, RETOUREN_VERBLEIB } from "@/db/schema";
import { requireArea } from "@/lib/auth/session";
import { CopyButton } from "@/components/copy-button";
import { CLAIM_STATUS_LABEL } from "@/lib/claims/labels";
import { formatDate, formatEuro } from "@/lib/numbers";
import { fallPaket } from "@/lib/retouren-station/fall";
import { BEFUND_KURZ, ENTSCHEIDUNG_TEXT, fehlendeFotos, grundText, VERBLEIB_TEXT } from "@/lib/retouren-station/logic";
import { eingereichtAction, falltextNeuAction, korrekturAction, retSkuAction } from "../../actions";

const MELDUNG: Record<string, [string, string]> = {
  eingereicht: ["Als eingereicht markiert – die Frist-Überwachung zählt jetzt Amazons Antwort.", "notice-ok"],
  abgeschlossen: ["Der Anspruch ist schon abgeschlossen – nichts geändert.", "notice-warn"],
  "kein-anspruch": ["Zu diesem Artikel gibt es (noch) keinen Anspruch. Er entsteht nach „Fertig“, wenn die Regeln einen Fall vorschlagen.", "notice-warn"],
  fallnummer: ["Die Fallnummer ist zu kurz.", "notice-warn"],
  text: ["Falltext neu erzeugt.", "notice-ok"],
  korrigiert: ["Befund/Verbleib gespeichert, Entscheidung neu gerechnet.", "notice-ok"],
  ungueltig: ["Ungültige Angaben.", "notice-warn"],
  ret: ["RET-SKU angelegt (EK von der Ursprungs-Charge).", "notice-ok"],
  "ret-fehlt": ["RET-SKU nicht angelegt: Produkt (ASIN) im System unbekannt oder schon vorhanden.", "notice-warn"],
  verbleib: ["RET-SKU nur bei Verbleib FBA, B-Ware oder eBay.", "notice-warn"],
};

export default async function FallPaketPage({ params, searchParams }: { params: Promise<{ positionId: string }>; searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("amazon");
  const id = z.string().uuid().safeParse((await params).positionId);
  if (!id.success) notFound();
  const f = await fallPaket(session.tenantId, id.data);
  if (!f) notFound();
  const { position: x, pruefung: p, dateien, video, anspruch: c } = f;
  const meldung = MELDUNG[(await searchParams).meldung ?? ""];
  const fehlen = fehlendeFotos(dateien.map((d) => d.medium.art));
  const st = c ? (CLAIM_STATUS_LABEL[c.status] ?? [c.status, "tag-neutral"]) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/remissionen/pruefungen">Prüfungen & Fälle</Link> · <Link href={`/remissionen/pruefungen/${p.id}`}>Paket vom {p.angelegtAm.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}</Link></div>
          <h1>Fall-Paket: {x.titel ?? x.lpn ?? `Artikel ${x.nr}`}</h1>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <a className="btn btn-primary" href={`/remissionen/pruefungen/fall/${x.id}/zip`} data-testid="fall-zip">ZIP herunterladen</a>
          {c && <Link className="btn" href={`/ansprueche/${c.id}`}>Anspruch öffnen</Link>}
        </div>
      </div>
      {meldung && <div className={`notice ${meldung[1]}`} role="status" data-testid="fall-meldung">{meldung[0]}</div>}

      <div className="row" style={{ alignItems: "flex-start" }}>
        <section className="card card-pad stack" style={{ flex: "1 1 520px", minWidth: 0, gap: 12 }}>
          <div className="between" style={{ flexWrap: "wrap", gap: 8 }}>
            <h2>Text für Amazon</h2>
            <form action={falltextNeuAction}><input type="hidden" name="positionId" value={x.id} /><button className="btn btn-small" type="submit">Text neu erzeugen</button></form>
          </div>
          {!x.fallTextDe ? (
            <div className="muted">Noch kein Text – entsteht nach „Fertig“, wenn ein Fall vorgeschlagen wird, oder mit „Text neu erzeugen“.</div>
          ) : (
            <>
              <div className="field">
                <div className="between"><span className="label">Betreff</span><CopyButton text={x.fallBetreff ?? ""} label="Betreff kopieren" /></div>
                <div data-testid="fall-betreff">{x.fallBetreff}</div>
              </div>
              <div className="field">
                <div className="between"><span className="label">Deutsch</span><CopyButton text={x.fallTextDe} label="Deutsch kopieren" /></div>
                <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }} data-testid="fall-text-de">{x.fallTextDe}</pre>
              </div>
              {x.fallTextEn && (
                <div className="field">
                  <div className="between"><span className="label">Englisch</span><CopyButton text={x.fallTextEn} label="Englisch kopieren" /></div>
                  <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }} data-testid="fall-text-en">{x.fallTextEn}</pre>
                </div>
              )}
            </>
          )}

          <h2>Fotos (in dieser Reihenfolge anhängen)</h2>
          {fehlen.length > 0 && <div className="notice notice-warn small" data-testid="fall-fotos-fehlen">Es fehlen: {fehlen.map((a) => ({ etikett: "Versandetikett", lieferschein: "Lieferschein", produkt_lpn: "Produkt mit LPN", inhalt: "Inhalt" })[a]).join(", ")}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }} data-testid="fall-fotos">
            {dateien.map((d) => (
              <a key={d.medium.id} href={`/remissionen/pruefungen/medien/${d.medium.id}`} target="_blank" rel="noreferrer" className="small" style={{ textDecoration: "none", color: "inherit" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/remissionen/pruefungen/medien/${d.medium.id}?klein=1`} alt={d.name} style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 6, background: "#eee" }} />
                <div className="num" data-testid="fall-foto-name">{d.name}</div>
              </a>
            ))}
          </div>
          {video && <div className="small">Video des Pakets: <a href={`/remissionen/pruefungen/medien/${video.id}`} target="_blank" rel="noreferrer">ansehen</a> ({video.teile} Teile, löschen ab {formatDate(video.loeschenAb)})</div>}
        </section>

        <aside className="stack" style={{ flex: "0 1 360px", minWidth: 0, gap: 12 }}>
          <section className="card card-pad stack" style={{ gap: 6 }}>
            <h2>Eingereicht?</h2>
            {c ? (
              <>
                <div className="small">Anspruch: <span className={`tag ${st![1]}`} data-testid="fall-status">{st![0]}</span> · {formatEuro(c.expectedAmount)} · Frist <b data-testid="fall-frist">{formatDate(c.deadline)}</b></div>
                {c.amazonCaseId && <div className="small">Fallnummer: <b data-testid="fall-nummer">{c.amazonCaseId}</b></div>}
                <form action={eingereichtAction} className="stack" style={{ gap: 6 }}>
                  <input type="hidden" name="positionId" value={x.id} />
                  <label className="label" htmlFor="fallnummer">Fallnummer (Case-ID)</label>
                  <input className="input" id="fallnummer" name="fallnummer" defaultValue={c.amazonCaseId ?? ""} placeholder="z. B. 12345678901" />
                  <button className="btn btn-primary" type="submit" data-testid="fall-eingereicht">Eingereicht</button>
                </form>
              </>
            ) : (
              <div className="small muted" data-testid="fall-kein-anspruch">Kein Anspruch: {x.entscheidung ? ENTSCHEIDUNG_TEXT[x.entscheidung] : "noch kein Befund"}.</div>
            )}
          </section>
          <section className="card card-pad stack small" style={{ gap: 4 }}>
            <h2>Artikel</h2>
            <div>LPN: <b>{x.lpn ?? "–"}</b>{x.fnsku ? ` · FNSKU ${x.fnsku}` : ""}</div>
            <div>SKU {x.sku ?? "–"} · ASIN {x.asin ?? "–"}</div>
            <div>Bestellung: {x.bestellnummer ?? "– (keine Kundenretoure)"}</div>
            <div>Rückgabe: {formatDate(x.rueckgabeDatum)} · Grund: {grundText(x.rueckgabegrund) ?? "–"}{x.amazonZustand ? ` · Amazon: ${x.amazonZustand}` : ""}</div>
            {x.kundenkommentar && <div className="muted">Kunde: „{x.kundenkommentar}“</div>}
            <div>An den Kunden erstattet: <b>{x.erstattetBetrag === null ? "unbekannt" : formatEuro(x.erstattetBetrag)}</b>{(x.amazonGezahlt ?? 0) > 0 ? ` · von Amazon gezahlt ${formatEuro(x.amazonGezahlt)}` : ""}</div>
            <div>Befund: <b>{x.befund ? BEFUND_KURZ[x.befund] : "–"}</b> · {x.entscheidung ? ENTSCHEIDUNG_TEXT[x.entscheidung] : "–"}</div>
            {x.notiz && <div>Notiz: {x.notiz}</div>}
            {x.kiEinschaetzung && "passt" in x.kiEinschaetzung && (
              <div className={x.kiAbweichung ? "" : "muted"} style={x.kiAbweichung ? { color: "var(--danger)" } : undefined}>
                KI: passt {String(x.kiEinschaetzung.passt)}, Spuren {String(x.kiEinschaetzung.gebrauchsspuren)}{x.kiAbweichung ? " – weicht vom Befund ab" : ""}
              </div>
            )}
            <div>Verbleib: {x.verbleib ? VERBLEIB_TEXT[x.verbleib] : "–"}{x.retSku ? <> · RET-SKU <span className="num" data-testid="fall-retsku">{x.retSku}</span></> : null}</div>
          </section>
          <section className="card card-pad stack small" style={{ gap: 6 }}>
            <h2>Korrigieren</h2>
            <form action={korrekturAction} className="stack" style={{ gap: 6 }}>
              <input type="hidden" name="positionId" value={x.id} />
              <label className="label" htmlFor="befund">Befund</label>
              <select className="select" id="befund" name="befund" defaultValue={x.befund ?? "ok"}>{RETOUREN_BEFUNDE.map((b) => <option key={b} value={b}>{BEFUND_KURZ[b]}</option>)}</select>
              <label className="label" htmlFor="verbleib">Verbleib</label>
              <select className="select" id="verbleib" name="verbleib" defaultValue={x.verbleib ?? ""}><option value="">–</option>{RETOUREN_VERBLEIB.map((v) => <option key={v} value={v}>{VERBLEIB_TEXT[v]}</option>)}</select>
              <button className="btn btn-small" type="submit">Speichern und neu entscheiden</button>
            </form>
            {!x.retSku && x.verbleib && ["fba", "b_ware", "ebay"].includes(x.verbleib) && (
              <form action={retSkuAction}><input type="hidden" name="positionId" value={x.id} /><button className="btn btn-small" type="submit">RET-SKU anlegen</button></form>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
