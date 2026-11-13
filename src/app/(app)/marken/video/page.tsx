import type { Metadata } from "next";
import Link from "next/link";
import type { SchrittStand, VideoFreigabe, VideoSchritt } from "@/db/tables/video";
import { AutoRefresh } from "@/app/(app)/lieferanten/finden/refresh";
import { ConfirmButton } from "@/components/confirm-button";
import { requireArea } from "@/lib/auth/session";
import { getIntegration } from "@/lib/integrations/store";
import { WB_SZENEN, TEMPO_SEK } from "@/lib/video/logic";
import { anzeigeStatus, BILD_MODELLE, claudePreis, dauerText, FREIGABE_TEXT, fortschrittProzent, freigabeAktiv, kapitelZeile, kostenSchaetzung, laengeZiel, SCHRITT_TEXT, VIDEO_STILE, SCHRITTE, typischFuer, usd, VIDEO_MODELLE, WORKER_VERSION_AKTUELL, workerStand, workerVeraltet, type BildModell } from "@/lib/video/logic";
import { auftraege, kanaele, kostenUebersicht, serverFreiGb, videoEinstellungen, workerListe, workerZuletzt } from "@/lib/video/service";
import { abbrechenAction, ablageAction, auftragAction, driveEinfuegenAction, driveTrennenAction, freigebenAction, hochladenAction, kanalSpeichernAction, loeschenAction, motiveNeuAction, neuAction, preiseAction, referenzAction, referenzLoeschenAction, vidiqAction, wiederholenAction, workerDeaktivierenAction, youtubeEinfuegenAction, youtubeTrennenAction, instagramTrennenAction } from "./actions";
import { WorkerAnlegen } from "./worker-anlegen";
import { StoriesBereich } from "./stories";
import { FREIGABE_MODI, profilMitVorgaben, STORY_ARTEN, tokenStand } from "@/lib/video/story-logic";
import type { StoryInhaltsart } from "@/db/tables/video";

export const metadata: Metadata = { title: "Video – Seller-System" };
export const dynamic = "force-dynamic";

// B36 Video-Pipeline: Kanal wählen, Thema eingeben → der Worker am Arbeits-PC macht Recherche, Skript, Sprache, Bilder,
// Render und Paket. Freigaben (je Kanal einstellbar), Kosten je Video, Upload auf YouTube nur privat.

type Such = { meldung?: string; kanal?: string; neu?: string };
const zeit = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–");
const host = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return u.slice(0, 40);
  }
};
const STAND_FARBE: Record<string, string> = { fertig: "tag-ok", laeuft: "tag-info", fehler: "tag-danger", offen: "" };
const DATEIEN: [string, string][] = [["mp4", "Video (MP4)"], ["thumbnail", "Thumbnail"], ["skript", "Skript"], ["quellen", "Quellen"], ["untertitel", "Untertitel (SRT)"]];

function SchrittChips({ schritte, aktuell, mitUpload }: { schritte: Partial<Record<VideoSchritt, SchrittStand>>; aktuell: VideoSchritt; mitUpload: boolean }) {
  return (
    <div className="row" style={{ gap: 4, flexWrap: "wrap" }} data-testid="vd-schritte">
      {SCHRITTE.filter((x) => x !== "upload" || mitUpload).map((x) => {
        const st = schritte[x];
        const f = st?.fortschritt;
        return (
          <span key={x} className={`tag ${STAND_FARBE[st?.status ?? "offen"] ?? ""}`} style={{ fontWeight: x === aktuell ? 700 : 400 }} data-testid={`vd-schritt-${x}`} data-status={st?.status ?? "offen"} title={st?.fehler ?? undefined}>
            {SCHRITT_TEXT[x]}
            {st?.status === "laeuft" && f ? ` ${f.fertig}/${f.gesamt}` : st?.status === "fertig" ? " ✓" : st?.status === "fehler" ? " ✗" : ""}
          </span>
        );
      })}
    </div>
  );
}

export default async function VideoPage({ searchParams }: { searchParams: Promise<Such> }) {
  const s = await requireArea("marken");
  const sp = await searchParams;
  const inhaber = s.role === "owner" && !s.readOnly;
  const [kanalListe, cfg, kosten, worker, workerAlle, serverFrei, claude, eleven, openai, google] = await Promise.all([
    kanaele(s.tenantId),
    videoEinstellungen(s.tenantId),
    kostenUebersicht(s.tenantId),
    workerZuletzt(s.tenantId),
    workerListe(s.tenantId),
    serverFreiGb(),
    getIntegration(s.tenantId, "anthropic"),
    getIntegration(s.tenantId, "elevenlabs"),
    getIntegration(s.tenantId, "openai"),
    getIntegration(s.tenantId, "google"),
  ]);
  const igApp = await getIntegration(s.tenantId, "instagram");
  const neuerKanal = sp.neu === "1" || kanalListe.length === 0;
  const kanal = neuerKanal ? null : (kanalListe.find((k) => k.id === sp.kanal) ?? kanalListe[0] ?? null);
  const instagram = kanal?.plattform === "instagram";
  const liste = kanal && !instagram ? await auftraege(s.tenantId, kanal.id, 30, "video") : [];
  const ws = worker?.stand ?? workerStand(null);
  const igProfil = profilMitVorgaben(kanal?.instagram);
  const igZugang = tokenStand(kanal?.instagramTokenBis ?? null);
  const laeuftWas = liste.some(({ a }) => a.status === "laeuft" || a.status === "wartet");
  const typisch = typischFuer(kanal?.stil);
  const whiteboard = kanal?.stil === "whiteboard";
  const ziel = laengeZiel();
  const schaetzung = kostenSchaetzung(cfg.preise, typisch, cfg.modell, cfg.bildModell);
  const andereModelle = (Object.keys(VIDEO_MODELLE) as (keyof typeof VIDEO_MODELLE)[]).map((m) => ({ m, summe: kostenSchaetzung(cfg.preise, typisch, m, cfg.bildModell).summe }));
  const fehlend = [!claude?.apiKey && "Claude (KI)", !eleven?.apiKey && "ElevenLabs", !openai?.apiKey && "OpenAI (Bilder)"].filter(Boolean) as string[];

  return (
    <div className="stack" style={{ maxWidth: 1100 }} data-testid="video">
      <AutoRefresh active={laeuftWas} everyMs={8000} />
      <div className="page-head">
        <div><div className="crumb">Marken &amp; Content</div><h1>Video</h1></div>
        <div className="row" style={{ gap: 6 }}><Link className="btn" href="#worker">Worker</Link><Link className="btn" href="#kosten">Kosten</Link></div>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" data-testid="vd-meldung">{sp.meldung}</div>}

      <div className={`notice small ${ws.warnung || !worker ? "notice-warn" : "notice-ok"}`} data-testid="vd-worker-stand" data-online={ws.online ? "1" : "0"}>
        {worker ? ws.text : "Noch kein Worker angelegt – unten unter „Worker“ ein Token erzeugen und am Arbeits-PC eintragen."}
        {worker?.freiGb !== null && worker?.freiGb !== undefined && (
          <span data-testid="vd-worker-platz"> · {worker.freiGb.toLocaleString("de-DE")} GB frei am PC{worker.freiGb < 3 ? " – unter 3 GB: kein Lauf!" : worker.freiGb < 5 ? " – knapp (empfohlen mind. 5 GB)" : ""}</span>
        )}
      </div>
      {worker && worker.zuletztGesehen && workerVeraltet(worker.version) && (
        <div className="notice notice-warn small" data-testid="vd-worker-alt">
          Der Worker am PC ist veraltet ({worker.version ? `v${worker.version}` : "Version unbekannt"}, aktuell v{WORKER_VERSION_AKTUELL}): Er kennt keine Instagram-Stories und zeichnet Whiteboard-Motive noch nicht im Takt der Sprache (B36.10). Bitte den Ordner <code>unter-der-decke</code> neu holen und den Worker neu bauen (README, Abschnitt „Aktualisieren“), dann „Schritt wiederholen“.
        </div>
      )}
      {fehlend.length > 0 && (
        <div className="notice notice-warn small" data-testid="vd-schluessel-fehlen">
          Zugang fehlt: {fehlend.join(", ")} – bitte unter <Link href="/anbindungen">Anbindungen</Link> über das sichere Formular eintragen (nie im Chat).
        </div>
      )}

      <nav className="row" style={{ gap: 6, flexWrap: "wrap" }} aria-label="Kanäle" data-testid="vd-kanaele">
        {kanalListe.map((k) => (
          <Link key={k.id} href={`/marken/video?kanal=${k.id}`} className={`btn btn-sm ${kanal?.id === k.id ? "btn-primary" : ""}`} aria-current={kanal?.id === k.id ? "page" : undefined}>
            {k.name}{!k.aktiv ? " (aus)" : ""}
          </Link>
        ))}
        {!s.readOnly && <Link href="/marken/video?neu=1#kanal" className={`btn btn-sm ${neuerKanal ? "btn-primary" : ""}`} data-testid="vd-kanal-neu">+ Kanal</Link>}
      </nav>

      {kanal && instagram && <StoriesBereich tenantId={s.tenantId} kanal={kanal} nurLesen={s.readOnly} />}

      {kanal && !instagram && (
        <section className="card card-pad stack" style={{ gap: 8 }} id="neu" data-testid="vd-neu">
          <h2 style={{ margin: 0 }}>Neues Video · {kanal.name}</h2>
          <p className="small muted" style={{ margin: 0 }} data-testid="vd-ziel">
            Ziel: {ziel.minuten[0]}–{ziel.minuten[1]} Min. · {ziel.woerter[0].toLocaleString("de-DE")}–{ziel.woerter[1].toLocaleString("de-DE")} Wörter · {whiteboard ? `${WB_SZENEN[0]}–${WB_SZENEN[1]} kurze Szenen (je 1–2 Sätze) · Whiteboard-Collage, Tempo ${kanal.tempo} (${TEMPO_SEK[kanal.tempo]} s je Motiv, bis ${typisch.motive} neue Motive, Wiederverwendung aus der Bibliothek spart)` : `${ziel.szenen[0]}–${ziel.szenen[1]} Szenen/Bilder`}{kanal.zielgruppe ? ` · Zielgruppe: ${kanal.zielgruppe}` : " · Zielgruppe noch nicht eingetragen (Kanalprofil)"}
          </p>
          <form action={auftragAction} className="stack small" style={{ gap: 8 }}>
            <input type="hidden" name="kanalId" value={kanal.id} />
            <label className="stack" style={{ gap: 2 }}>Thema<input className="input" name="thema" required minLength={5} maxLength={300} placeholder="z. B. 5 Gründe, warum …" data-testid="vd-thema" /></label>
            <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <label><input type="radio" name="start" value="sofort" defaultChecked /> sofort</label>
              <label><input type="radio" name="start" value="nacht" data-testid="vd-start-nacht" /> heute Nacht (23 Uhr)</label>
              <label className="row" style={{ gap: 4 }}><input type="radio" name="start" value="zeitpunkt" /> ab <input className="input" type="datetime-local" name="zeitpunkt" style={{ width: 200 }} /></label>
            </div>
            <details data-testid="vd-vorlage-bereich">
              <summary>Englische Vorlage oder eigenes Skript (optional)</summary>
              <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                  <label><input type="radio" name="vorlageArt" value="vorlage" defaultChecked data-testid="vd-vorlage-art-vorlage" /> Vorlage (z. B. englisches Transkript eines erfolgreichen Videos)</label>
                  <label><input type="radio" name="vorlageArt" value="skript" data-testid="vd-vorlage-art-skript" /> Mein Skript (wird möglichst wörtlich übernommen, nie verlängert – über 1.700 Wörter gekürzt)</label>
                </div>
                <textarea className="input" name="vorlage" rows={6} maxLength={40_000} placeholder="Text hier einfügen (höchstens 40.000 Zeichen)" data-testid="vd-vorlage" />
                <span className="muted">Vorlage: Claude übernimmt nur Hook, Aufbau und Spannungsbogen, schreibt eigenen deutschen Text und belegt alle Aussagen mit eigenen Quellen – keine Übersetzung. Mein Skript: wird in Szenen geteilt, Quellen werden gesucht; Länge und Sicherheitsstufe gelten trotzdem.</span>
              </div>
            </details>
            <details>
              <summary>vidIQ (optional)</summary>
              <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                <label className="stack" style={{ gap: 2 }}>Keywords/Ideen aus vidIQ<textarea className="input" name="vidiqKeywords" rows={3} data-testid="vd-vidiq-keywords" /></label>
                <label className="stack" style={{ gap: 2 }}>Titelvorschläge aus vidIQ<textarea className="input" name="vidiqTitel" rows={3} data-testid="vd-vidiq-titel" /></label>
                <span className="muted">Seller-System und Worker fragen vidIQ nicht selbst ab. Claude trägt die Daten auf Anfrage ein (Werkzeug „video_vidiq_eintragen“).</span>
              </div>
            </details>
            <div className="row between" style={{ gap: 8, flexWrap: "wrap" }}>
              <span className="muted" data-testid="vd-schaetzung">Kosten-Schätzung je Video ({VIDEO_MODELLE[cfg.modell].name}): ca. {usd(schaetzung.summe)}{schaetzung.fehlend.length ? ` (ohne ${schaetzung.fehlend.join(", ")} – Preis unten eintragen)` : ""}</span>
              <button className="btn btn-primary" type="submit" disabled={s.readOnly || !kanal.aktiv} data-testid="vd-start">Video starten</button>
            </div>
          </form>
        </section>
      )}

      {kanal && !instagram && (
        <section className="stack" style={{ gap: 10 }} id="auftraege" data-testid="vd-auftraege">
          <h2 style={{ margin: 0 }}>Aufträge</h2>
          {liste.length === 0 && <p className="small muted">Noch keine Videos für diesen Kanal.</p>}
          {liste.map(({ a }) => {
            const offen = a.freigabeOffen as VideoFreigabe | null;
            const stand = a.schritte[a.schritt];
            const hinweise = SCHRITTE.flatMap((x) => (a.schritte[x]?.hinweise ?? []).map((h) => `${SCHRITT_TEXT[x]}: ${h}`));
            const quellenIds = new Set(a.quellen.map((q) => q.id));
            return (
              <article key={a.id} id={`a-${a.id}`} className="card card-pad stack" style={{ gap: 8 }} data-testid="vd-auftrag" data-status={a.status} data-schritt={a.schritt}>
                <div className="between" style={{ gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                  <strong style={{ fontSize: "1.05em" }}>{a.thema}</strong>
                  <span className={`tag ${a.status === "fehler" ? "tag-danger" : a.status === "fertig" ? "tag-ok" : a.status === "freigabe" ? "tag-warn" : "tag-info"}`} data-testid="vd-status">
                    {anzeigeStatus(a.status, ws.online)}{offen ? `: ${FREIGABE_TEXT[offen]}` : ""}
                  </span>
                </div>
                <div className="small muted">
                  angelegt {zeit(a.createdAt)}{a.startAb && a.status === "wartet" ? ` · Start ab ${zeit(a.startAb)}` : ""}{a.woerter ? ` · ${a.woerter} Wörter` : ""}{a.dauerSek ? ` · ${dauerText(a.dauerSek)} Min.` : ""}{a.vorlage ? ` · ${a.vorlageArt === "skript" ? "eigenes Skript" : "mit Vorlage"} (${a.vorlage.length.toLocaleString("de-DE")} Zeichen)` : ""}
                </div>
                <SchrittChips schritte={a.schritte} aktuell={a.schritt} mitUpload={a.hochladen || !!a.youtubeId} />
                <div style={{ height: 6, background: "var(--surface-2, #eee)", borderRadius: 3 }} aria-label="Fortschritt"><div style={{ width: `${fortschrittProzent(a.schritte, a.hochladen)}%`, height: 6, background: "var(--accent, #2563eb)", borderRadius: 3 }} /></div>
                {a.status === "fehler" && (
                  <div className="notice notice-warn small" data-testid="vd-fehler">
                    Fehler in „{SCHRITT_TEXT[a.schritt]}“: {stand?.fehler ?? "unbekannt"}
                    {!s.readOnly && (
                      <form action={wiederholenAction} style={{ display: "inline", marginLeft: 8 }}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="kanal" value={kanal.id} /><button className="btn btn-sm" type="submit" data-testid="vd-wiederholen">Schritt wiederholen</button></form>
                    )}
                  </div>
                )}
                {hinweise.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18, color: "var(--warn-text, #8a5a00)" }} data-testid="vd-hinweise">{hinweise.slice(0, 8).map((h, i) => <li key={i}>{h}</li>)}</ul>}

                {/* Freigabe 1: Gliederung + Quellen */}
                {(offen === "gliederung" || (a.gliederung && !offen)) && a.gliederung && (
                  <details open={offen === "gliederung"} data-testid="vd-gliederung">
                    <summary><strong>Gliederung</strong> ({a.gliederung.punkte.length} Punkte)</summary>
                    <div className="small stack" style={{ gap: 4, marginTop: 6 }}>
                      {a.gliederung.hook && <div><em>Hook:</em> {a.gliederung.hook}</div>}
                      {a.gliederung.angst && <div><em>Fear Activation:</em> {a.gliederung.angst}</div>}
                      <ol style={{ margin: 0, paddingLeft: 18 }}>
                        {a.gliederung.punkte.map((p, i) => <li key={i} data-testid="vd-punkt"><strong>{p.titel}</strong>{p.kern ? ` – ${p.kern}` : ""} <span className="muted">[{(p.quelle_ids ?? []).join(", ") || "ohne Quelle!"}]</span></li>)}
                      </ol>
                      {a.gliederung.fazit && <div><em>Zusammenfassung:</em> {a.gliederung.fazit}</div>}
                      {a.gliederung.cta && <div><em>CTA:</em> {a.gliederung.cta}</div>}
                    </div>
                  </details>
                )}
                {a.quellen.length > 0 && (
                  <details open={offen === "gliederung"} data-testid="vd-quellen">
                    <summary><strong>Quellen</strong> ({a.quellen.length})</summary>
                    <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                      {a.quellen.map((q) => (
                        <li key={q.id} data-testid="vd-quelle">
                          <strong>{q.id}</strong> {q.titel}{q.jahr ? ` (${q.jahr})` : ""}{q.art ? ` · ${q.art}` : ""}{q.autoren ? ` · ${q.autoren}` : ""}
                          {q.url && <> · <a href={q.url} target="_blank" rel="noreferrer noopener">{host(q.url)}</a></>}
                          {q.gefunden === false && <span className="tag tag-warn" style={{ marginLeft: 4 }}>nicht aus Suchtreffer – prüfen</span>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {/* Freigabe 2: Skript */}
                {a.skript && a.skript.length > 0 && (
                  <details open={offen === "skript"} data-testid="vd-skript">
                    <summary><strong>Skript</strong> ({a.skript.length} Szenen, {a.woerter ?? "?"} Wörter, {new Set(a.skript.filter((x) => x.abschnitt.startsWith("punkt-")).map((x) => x.abschnitt)).size} Punkte)</summary>
                    <ol className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                      {a.skript.map((x) => (
                        <li key={x.nr} style={{ marginBottom: 6 }}>
                          <span className="muted">[{x.abschnitt}{x.dauer ? ` · ${dauerText(x.dauer)}` : ""}]</span> {x.text}
                          {x.motive && x.motive.length > 0 && (
                            <div className="muted" data-testid="vd-szene-wb">
                              {x.layout ? `Layout ${x.layout}` : ""}{x.balken ? ` · Balken: „${x.balken}“` : ""}{x.ueberschrift ? ` · Überschrift: „${x.ueberschrift}“` : ""}{x.kernaussage ? ` · Kernaussage: „${x.kernaussage}“` : ""}{x.schrittText ? ` · ${x.schrittText}` : ""}
                              {" · Motive: "}{x.motive.map((m) => `${m.key}${m.wiederverwendet ? " (Bibliothek)" : ""}${m.ersatz ? " (Ersatz)" : ""}`).join(", ")}
                            </div>
                          )}
                          <div className="muted">Bild: {x.bildidee}{x.ersatzbild ? " (Ersatzbild)" : ""}{x.einblendung ? ` · Einblendung: „${x.einblendung}“` : ""}{x.quelle_ids.length ? ` · Quellen: ${x.quelle_ids.map((q) => (quellenIds.has(q) ? q : `${q}?`)).join(", ")}` : ""}</div>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}

                {/* Freigabe Szenen-Übersicht (Whiteboard, B36.9.6): alle Szenen als Raster, einzelne Motive neu erzeugen */}
                {a.dateien.uebersicht && (offen === "szenen" || a.skript?.some((x) => x.motive?.length)) && (
                  <details open={offen === "szenen"} data-testid="vd-szenen">
                    <summary><strong>Szenen-Übersicht</strong> ({a.skript?.length ?? 0} Szenen, {new Set((a.skript ?? []).flatMap((x) => (x.motive ?? []).map((m) => m.key))).size} verschiedene Motive)</summary>
                    <a href={`/api/video/${a.id}/uebersicht`} target="_blank" rel="noreferrer noopener"><img src={`/api/video/${a.id}/uebersicht?v=${a.dateien.uebersicht.groesse}`} alt="Szenen-Übersicht" style={{ width: "100%", maxWidth: 960, borderRadius: 6, border: "1px solid var(--border, #ddd)", marginTop: 6 }} data-testid="vd-uebersicht" /></a>
                    {offen === "szenen" && !s.readOnly && (
                      <form action={motiveNeuAction} className="stack small" style={{ gap: 6, marginTop: 6 }} data-testid="vd-motive-form">
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="kanal" value={kanal.id} />
                        <span className="muted">Motiv antippen, das neu gezeichnet werden soll (gilt in allen Szenen, die es verwenden). Der Rest bleibt, nur das Ausgewählte kostet.</span>
                        <div className="stack" style={{ gap: 4 }}>
                          {(a.skript ?? []).filter((x) => x.motive?.length).map((x) => (
                            <div key={x.nr} className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                              <span className="muted" style={{ minWidth: 70 }}>Szene {x.nr}</span>
                              {x.motive!.map((m) => (
                                <label key={`${x.nr}-${m.key}`} className="tag" title={m.beschreibung}><input type="checkbox" name="motiv" value={m.key} data-testid={`vd-motiv-${m.key}`} /> {m.key}</label>
                              ))}
                            </div>
                          ))}
                        </div>
                        <div><button className="btn btn-sm" type="submit" data-testid="vd-motive-neu">Ausgewählte Motive neu erzeugen</button></div>
                      </form>
                    )}
                  </details>
                )}

                {/* Freigabe 3: Vorschau-Video + Thumbnail + Titel */}
                {(offen === "vorschau" || a.status === "fertig") && a.dateien.mp4 && (
                  <div className="stack" style={{ gap: 6 }} data-testid="vd-vorschau">
                    {a.dateien.mp4.drive && !a.dateien.mp4.key.startsWith(a.id) ? (
                      <>
                        <iframe src={`https://drive.google.com/file/d/${encodeURIComponent(a.dateien.mp4.drive)}/preview`} title="Vorschau-Video in Google Drive" allow="autoplay; fullscreen" style={{ width: "100%", maxWidth: 720, aspectRatio: "16 / 9", border: 0, borderRadius: 8, background: "#000" }} data-testid="vd-drive-player" />
                        <a className="small" href={a.dateien.mp4.link ?? `https://drive.google.com/file/d/${encodeURIComponent(a.dateien.mp4.drive)}/view`} target="_blank" rel="noreferrer noopener" data-testid="vd-drive-link">Video in Google Drive öffnen</a>
                      </>
                    ) : (
                      <video src={`/api/video/${a.id}/mp4`} controls preload="metadata" style={{ width: "100%", maxWidth: 720, borderRadius: 8, background: "#000" }} data-testid="vd-player" />
                    )}
                    {a.dateien.thumbnail && <img src={`/api/video/${a.id}/thumbnail`} alt="Thumbnail" style={{ width: 320, maxWidth: "100%", borderRadius: 6 }} data-testid="vd-thumbnail" />}
                  </div>
                )}
                {a.paket && (
                  <details open={offen === "vorschau"} data-testid="vd-paket">
                    <summary><strong>Titel, Beschreibung, Kapitel, Tags</strong></summary>
                    <div className="small stack" style={{ gap: 6, marginTop: 6 }}>
                      {(a.paket.warnungen ?? []).length > 0 && <div className="notice notice-warn">{a.paket.warnungen!.join(" · ")}</div>}
                      <ol style={{ margin: 0, paddingLeft: 18 }} data-testid="vd-titel">{a.paket.titel.map((t, i) => <li key={i} style={{ fontWeight: i === (a.paket!.titelGewaehlt ?? 0) ? 700 : 400 }}>{t}</li>)}</ol>
                      {a.paket.thumbnailText && <div>Thumbnail-Text: „{a.paket.thumbnailText}“</div>}
                      <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }} data-testid="vd-beschreibung">{a.paket.beschreibung}</pre>
                      {a.paket.kapitel.length > 0 && <div data-testid="vd-kapitel">Kapitel: {a.paket.kapitel.map(kapitelZeile).join(" · ")}</div>}
                      <div data-testid="vd-tags">Tags: {a.paket.tags.join(", ")}</div>
                    </div>
                  </details>
                )}

                {offen && !s.readOnly && (
                  <form action={freigebenAction} className="stack small" style={{ gap: 6, borderTop: "1px solid var(--border, #ddd)", paddingTop: 8 }} data-testid="vd-freigabe-form">
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="kanal" value={kanal.id} />
                    <input type="hidden" name="freigabe" value={offen} />
                    {offen === "vorschau" && a.paket && (
                      <label className="stack" style={{ gap: 2 }}>Titel für YouTube
                        <select className="input" name="titelWahl" defaultValue={String(a.paket.titelGewaehlt ?? 0)}>{a.paket.titel.map((t, i) => <option key={i} value={i}>{t}</option>)}</select>
                      </label>
                    )}
                    {offen !== "vorschau" && <label className="stack" style={{ gap: 2 }}>Anmerkung für den nächsten Schritt (optional)<input className="input" name="hinweis" maxLength={2000} /></label>}
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <button className="btn btn-primary" type="submit" data-testid="vd-freigeben">{FREIGABE_TEXT[offen]} freigeben</button>
                    </div>
                  </form>
                )}
                {(offen === "gliederung" || offen === "skript") && !s.readOnly && (
                  <form action={neuAction} className="row small" style={{ gap: 6, flexWrap: "wrap", alignItems: "end" }}>
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="kanal" value={kanal.id} />
                    <input type="hidden" name="schritt" value={offen === "gliederung" ? "research" : "script"} />
                    <label className="stack" style={{ gap: 2, flex: 1, minWidth: 200 }}>Was soll anders werden?<input className="input" name="hinweis" maxLength={2000} required /></label>
                    <button className="btn btn-sm" type="submit" data-testid="vd-neu-machen">{offen === "gliederung" ? "Neu recherchieren" : "Skript neu schreiben"}</button>
                  </form>
                )}

                <div className="row small" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <span data-testid="vd-kosten">Kosten: Schätzung {usd(a.kostenSchaetzung)} · Ist <strong>{usd(a.kostenIst)}</strong>{a.kostenPositionen.some((k) => k.betrag === null) ? " (ohne Posten ohne Preis)" : ""}</span>
                  {a.youtubeId ? (
                    <span data-testid="vd-youtube">YouTube: <strong>{a.youtubeStatus}</strong> · <a href={`https://studio.youtube.com/video/${a.youtubeId}/edit`} target="_blank" rel="noreferrer noopener">in YouTube Studio öffnen</a></span>
                  ) : (
                    !s.readOnly && a.status !== "abgebrochen" && (
                      <form action={hochladenAction} className="row" style={{ gap: 4 }}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="kanal" value={kanal.id} />
                        <input type="hidden" name="an" value={a.hochladen ? "0" : "1"} />
                        <button className={`btn btn-sm ${a.hochladen ? "btn-primary" : ""}`} type="submit" role="switch" aria-checked={a.hochladen} data-testid="vd-hochladen" data-an={a.hochladen ? "1" : "0"}>Privat hochladen: {a.hochladen ? "an" : "aus"}</button>
                      </form>
                    )
                  )}
                </div>
                <details>
                  <summary className="small">Mehr (Dateien, Kostenposten, vidIQ, Abbrechen)</summary>
                  <div className="stack small" style={{ gap: 8, marginTop: 6 }}>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                      {DATEIEN.filter(([k]) => a.dateien[k]).map(([k, n]) => <a key={k} href={`/api/video/${a.id}/${k}?download=1`} data-testid={`vd-datei-${k}`}>{n} ({Math.max(1, Math.round((a.dateien[k]?.groesse ?? 0) / 1024 / 1024))} MB{a.dateien[k]?.drive ? ", auch in Drive" : ""})</a>)}
                      {!DATEIEN.some(([k]) => a.dateien[k]) && <span className="muted">Noch keine Dateien.</span>}
                    </div>
                    {a.kostenPositionen.length > 0 && (
                      <table className="table" data-testid="vd-kostenposten">
                        <thead><tr><th>Anbieter</th><th>Art</th><th>Menge</th><th>Betrag</th></tr></thead>
                        <tbody>
                          {Object.values(a.kostenPositionen.reduce<Record<string, { anbieter: string; art: string; menge: number; einheit: string; betrag: number | null }>>((acc, k) => {
                            const key = `${k.anbieter}|${k.art}`;
                            const v = (acc[key] ??= { anbieter: k.anbieter, art: k.art, menge: 0, einheit: k.einheit, betrag: 0 });
                            v.menge += k.menge;
                            v.betrag = v.betrag === null || k.betrag === null ? null : v.betrag + k.betrag;
                            return acc;
                          }, {})).map((k) => <tr key={`${k.anbieter}${k.art}`}><td>{k.anbieter}</td><td>{k.art}</td><td>{k.menge.toLocaleString("de-DE")} {k.einheit}</td><td>{k.betrag === null ? "Preis fehlt" : usd(k.betrag)}</td></tr>)}
                        </tbody>
                      </table>
                    )}
                    {!s.readOnly && (
                      <form action={vidiqAction} className="stack" style={{ gap: 4 }}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="kanal" value={kanal.id} />
                        <label className="stack" style={{ gap: 2 }}>Keywords/Ideen aus vidIQ<textarea className="input" name="vidiqKeywords" rows={2} defaultValue={a.vidiqKeywords ?? ""} /></label>
                        <label className="stack" style={{ gap: 2 }}>Titelvorschläge aus vidIQ<textarea className="input" name="vidiqTitel" rows={2} defaultValue={a.vidiqTitel ?? ""} /></label>
                        <div><button className="btn btn-sm" type="submit">vidIQ-Daten speichern</button></div>
                      </form>
                    )}
                    <div className="row" style={{ gap: 6 }}>
                      {!s.readOnly && a.status !== "fertig" && a.status !== "abgebrochen" && (
                        <form action={abbrechenAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="kanal" value={kanal.id} /><ConfirmButton confirm="Auftrag abbrechen? Der Worker hört nach dem laufenden Teilschritt auf." className="btn btn-sm" testid="vd-abbrechen">Abbrechen</ConfirmButton></form>
                      )}
                      {inhaber && (
                        <form action={loeschenAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="kanal" value={kanal.id} /><ConfirmButton confirm="Auftrag mit allen Dateien im Seller-System löschen? (Ein privates YouTube-Video bleibt bestehen.)" className="btn btn-sm">Löschen</ConfirmButton></form>
                      )}
                    </div>
                  </div>
                </details>
              </article>
            );
          })}
        </section>
      )}

      <section className="card card-pad stack" style={{ gap: 8 }} id="kanal" data-testid="vd-kanalprofil">
        <h2 style={{ margin: 0 }}>{kanal ? `Kanalprofil: ${kanal.name}` : "Neuer Kanal"}</h2>
        <form action={kanalSpeichernAction} className="stack small" style={{ gap: 8 }} key={kanal?.id ?? "neu"}>
          {kanal && <input type="hidden" name="kanalId" value={kanal.id} />}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <label className="stack" style={{ gap: 2, flex: 1, minWidth: 180 }}>Name<input className="input" name="name" required defaultValue={kanal?.name ?? ""} data-testid="vd-k-name" /></label>
            <label className="stack" style={{ gap: 2, width: 160 }}>Handle<input className="input" name="handle" defaultValue={kanal?.handle ?? ""} placeholder="@…" /></label>
            <label className="stack" style={{ gap: 2, width: 80 }}>Sprache<input className="input" name="sprache" defaultValue={kanal?.sprache ?? "de"} /></label>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <label className="stack" style={{ gap: 2, width: 220 }}>Plattform
              <select className="input" name="plattform" defaultValue={kanal?.plattform ?? "youtube"} data-testid="vd-k-plattform"><option value="youtube">YouTube (Videos 16:9)</option><option value="instagram">Instagram (Stories 9:16)</option></select>
            </label>
            <label className="stack" style={{ gap: 2, width: 260 }}>Tempo der Zeichen-Animation
              <select className="input" name="tempo" defaultValue={kanal?.tempo ?? "normal"} data-testid="vd-k-tempo"><option value="ruhig">ruhig (2,5 s je Motiv)</option><option value="normal">normal (2,0 s)</option><option value="schnell">schnell (1,5 s)</option></select>
            </label>
          </div>
          <label className="stack" style={{ gap: 2 }}>Themenbereich<input className="input" name="themenbereich" defaultValue={kanal?.themenbereich ?? ""} data-testid="vd-k-thema" /></label>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="stack" style={{ gap: 2, flex: 1, minWidth: 220 }}>Zielgruppe<input className="input" name="zielgruppe" maxLength={300} defaultValue={kanal?.zielgruppe ?? ""} placeholder="z. B. Männer ab 55" data-testid="vd-k-zielgruppe" /></label>
            <span className="small muted" style={{ paddingBottom: 6 }} data-testid="vd-k-laenge">Länge: fest {laengeZiel().woerter[0].toLocaleString("de-DE")}–{laengeZiel().woerter[1].toLocaleString("de-DE")} Wörter (≈ {laengeZiel().minuten[0]}–{laengeZiel().minuten[1]} Min.) für alle Kanäle</span>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <label className="stack" style={{ gap: 2, flex: 1, minWidth: 180 }}>Stimme (ElevenLabs-Voice-ID)<input className="input" name="stimmeId" defaultValue={kanal?.stimmeId ?? ""} data-testid="vd-k-stimme" /></label>
            <label className="stack" style={{ gap: 2, flex: 1, minWidth: 180 }}>Musik (Dateiname im Musikordner des Workers)<input className="input" name="musik" defaultValue={kanal?.musik ?? ""} placeholder="leer = ohne Musik" /></label>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="stack" style={{ gap: 2, minWidth: 220 }}>Stil der Bilder
              <select className="input" name="stil" defaultValue={kanal?.stil ?? "vollbild"} data-testid="vd-k-stil">
                {(Object.keys(VIDEO_STILE) as (keyof typeof VIDEO_STILE)[]).map((k) => <option key={k} value={k}>{VIDEO_STILE[k].name} – {VIDEO_STILE[k].hinweis}</option>)}
              </select>
            </label>
            <label className="stack" style={{ gap: 2, width: 200 }}>Bildqualität (Kosten)
              <select className="input" name="bildQualitaet" defaultValue={kanal?.bildQualitaet ?? "medium"} data-testid="vd-k-qualitaet"><option value="low">niedrig (günstig)</option><option value="medium">mittel</option><option value="high">hoch (teuer)</option></select>
            </label>
          </div>
          <label className="stack" style={{ gap: 2 }}>Bildstil (Beschreibung fürs Bildmodell)<input className="input" name="bildstil" defaultValue={kanal?.bildstil ?? ""} placeholder="z. B. Bunte Cartoon-Clipart, kräftige schwarze Umrisse, flache Farben, Comic-Gesichter" /></label>
          <label className="stack" style={{ gap: 2 }}>Wiederkehrende Figuren (Whiteboard; eine je Zeile „kurzname: Beschreibung“ – einmal gezeichnet, dann immer gleich)
            <textarea className="input" name="figuren" rows={3} maxLength={3000} defaultValue={kanal?.figuren ?? ""} placeholder={"blonder-mann: Mann um die 60, blonde Haare, kariertes Hemd, freundlich\nbrille: Mann mit runder Brille und Glatze, Pullover"} data-testid="vd-k-figuren" />
          </label>
          <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <label>Sicherheitsstufe <select className="input" name="sicherheitsstufe" defaultValue={kanal?.sicherheitsstufe ?? "normal"} data-testid="vd-k-stufe"><option value="normal">normal</option><option value="streng">streng (keine Bett-/Kuss-/Berührungsmotive)</option></select></label>
            <span>Freigaben:</span>
            <label><input type="checkbox" name="f_gliederung" value="1" defaultChecked={kanal?.freigaben.gliederung ?? true} /> Gliederung + Quellen</label>
            <label><input type="checkbox" name="f_skript" value="1" defaultChecked={kanal?.freigaben.skript ?? true} /> Skript</label>
            <label><input type="checkbox" name="f_szenen" value="1" defaultChecked={freigabeAktiv(kanal?.freigaben ?? {}, "szenen")} data-testid="vd-k-f-szenen" /> Szenen-Übersicht (vor dem Render)</label>
            <label><input type="checkbox" name="f_vorschau" value="1" defaultChecked={kanal?.freigaben.vorschau ?? true} /> Vorschau</label>
            {kanal && <label><select className="input" name="aktiv" defaultValue={kanal.aktiv ? "1" : "0"}><option value="1">aktiv</option><option value="0">ausgeschaltet</option></select></label>}
          </div>
          <details open={instagram} data-testid="vd-k-instagram">
            <summary>Instagram-Stories (nur bei Plattform Instagram)</summary>
            <div className="stack" style={{ gap: 8, marginTop: 6 }}>
              <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span>Tage:</span>
                {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((t, i) => <label key={t}><input type="checkbox" name={`ig_tag_${i + 1}`} value="1" defaultChecked={igProfil.tage.includes(i + 1)} data-testid={`vd-ig-tag-${i + 1}`} /> {t}</label>)}
                <label className="row" style={{ gap: 4 }}>Uhrzeit(en)<input className="input" name="ig_uhrzeiten" defaultValue={igProfil.uhrzeiten.join(", ")} style={{ width: 130 }} placeholder="12:00" data-testid="vd-ig-uhrzeiten" /></label>
              </div>
              <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span>Inhaltsarten:</span>
                {(Object.keys(STORY_ARTEN) as StoryInhaltsart[]).map((a) => <label key={a} title={STORY_ARTEN[a].hinweis}><input type="checkbox" name={`ig_art_${a}`} value="1" defaultChecked={igProfil.inhaltsarten.includes(a)} /> {STORY_ARTEN[a].name}</label>)}
              </div>
              <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <label>Freigabe <select className="input" name="ig_freigabe" defaultValue={igProfil.freigabeModus} data-testid="vd-ig-freigabe">{(Object.keys(FREIGABE_MODI) as (keyof typeof FREIGABE_MODI)[]).map((m) => <option key={m} value={m}>{FREIGABE_MODI[m]}</option>)}</select></label>
                <label className="row" style={{ gap: 4 }}>Monatslimit $<input className="input" name="ig_limit" defaultValue={igProfil.monatslimit ?? ""} placeholder="ohne" style={{ width: 80 }} data-testid="vd-ig-limit" /></label>
                <label><input type="checkbox" name="ig_hand" value="1" defaultChecked={igProfil.hand} /> Hand-Animation (Video statt Standbild)</label>
                <label><input type="checkbox" name="ig_werbung" value="1" defaultChecked={igProfil.werbung} /> Werbekennzeichnung bei Preis/Leistung/CTA</label>
              </div>
              <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span>Farben:</span>
                <label className="row" style={{ gap: 4 }}>Grund<input type="color" name="ig_grund" defaultValue={igProfil.farben.grund} /></label>
                <label className="row" style={{ gap: 4 }}>Akzent<input type="color" name="ig_akzent" defaultValue={igProfil.farben.akzent} /></label>
                <label className="row" style={{ gap: 4 }}>Text<input type="color" name="ig_text" defaultValue={igProfil.farben.text} /></label>
                <span className="muted">Schrift: Anton (fest, mit Umlauten)</span>
              </div>
              <label className="stack" style={{ gap: 2 }}>Hinweistext/Link am Story-Ende (z. B. Anfrage über die Website, Impressum-Link)<input className="input" name="ig_hinweis" maxLength={300} defaultValue={igProfil.hinweis ?? ""} data-testid="vd-ig-hinweis" /></label>
              <label className="stack" style={{ gap: 2 }}>Bestätigte Fakten (nur diese Angaben dürfen in Stories stehen – Preise netto je Artikel, Leistungen, Mindestmengen; nichts wird erfunden)
                <textarea className="input" name="ig_fakten" rows={5} maxLength={4000} defaultValue={igProfil.fakten ?? ""} data-testid="vd-ig-fakten" />
              </label>
            </div>
          </details>
          <div><button className="btn btn-primary btn-sm" type="submit" disabled={s.readOnly} data-testid="vd-k-speichern">{kanal ? "Kanalprofil speichern" : "Kanal anlegen"}</button></div>
        </form>
        {kanal && (
          <div className="stack small" style={{ gap: 6, borderTop: "1px solid var(--border, #ddd)", paddingTop: 8 }} data-testid="vd-referenzen">
            <strong>Stil-Referenzbilder ({kanal.referenzen.length}/4)</strong>
            <span className="muted">Bilder aus dem Kanal (z. B. Bildschirmfotos eines Videos im gewünschten Stil). Das Bildmodell bekommt sie bei jedem neuen Motiv als Vorlage – so bleiben Strich, Farben und Figuren gleich. Schrift zeichnet das Bildmodell nie; Texte setzt die Pipeline selbst.</span>
            {kanal.referenzen.length > 0 && (
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {kanal.referenzen.map((r) => (
                  <div key={r.nr} className="stack" style={{ gap: 2, width: 150 }}>
                    <img src={`/api/video/referenz/${kanal.id}/${r.nr}`} alt={r.name} style={{ width: 150, height: 85, objectFit: "cover", borderRadius: 4, border: "1px solid var(--border, #ddd)" }} data-testid="vd-referenz" />
                    {!s.readOnly && <form action={referenzLoeschenAction}><input type="hidden" name="kanalId" value={kanal.id} /><input type="hidden" name="nr" value={r.nr} /><button className="btn btn-sm" type="submit">entfernen</button></form>}
                  </div>
                ))}
              </div>
            )}
            {!s.readOnly && kanal.referenzen.length < 4 && (
              <form action={referenzAction} className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <input type="hidden" name="kanalId" value={kanal.id} />
                <input className="input" type="file" name="bilder" accept="image/png,image/jpeg,image/webp" multiple data-testid="vd-referenz-datei" />
                <button className="btn btn-sm" type="submit" data-testid="vd-referenz-hochladen">Hochladen</button>
              </form>
            )}
          </div>
        )}
        {kanal && instagram && (
          <div className="stack small" style={{ gap: 6, borderTop: "1px solid var(--border, #ddd)", paddingTop: 8 }} data-testid="vd-instagram-zugang">
            <strong>Instagram-Zugang</strong>
            {kanal.instagramToken ? (
              <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span data-testid="vd-ig-verbunden">verbunden{kanal.instagramKonto ? ` mit „${kanal.instagramKonto}“` : ""} seit {zeit(kanal.instagramVerbundenAm)} – gültig bis {zeit(kanal.instagramTokenBis)}{igZugang.stand === "bald" ? " (läuft bald ab – wird automatisch erneuert)" : igZugang.stand === "abgelaufen" ? " – ABGELAUFEN, bitte neu verbinden" : ""}</span>
                {inhaber && <a className="btn btn-sm" href={`/api/oauth/instagram/start?kanal=${kanal.id}`}>Neu verbinden</a>}
                {inhaber && <form action={instagramTrennenAction}><input type="hidden" name="kanalId" value={kanal.id} /><button className="btn btn-sm" type="submit">Trennen</button></form>}
              </div>
            ) : inhaber ? (
              <>
                {!igApp?.appId && <span className="muted">Zuerst unter <Link href="/anbindungen?p=instagram#instagram">Anbindungen → Instagram</Link> die Meta-App eintragen (Business-Konto, App-Prüfung durch Meta kann dauern).</span>}
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}><a className="btn btn-sm" href={`/api/oauth/instagram/start?kanal=${kanal.id}`} data-testid="vd-ig-verbinden">Mit Instagram verbinden</a></div>
                <span className="muted">Ohne Verbindung (Stufe 1) entstehen die Stories trotzdem – nach der Freigabe kommt zur Planzeit eine Erinnerung zum Herunterladen und Posten von Hand.</span>
              </>
            ) : (
              <span className="muted">Nicht verbunden (verbindet der Inhaber).</span>
            )}
          </div>
        )}
        {kanal && !instagram && (
          <div className="stack small" style={{ gap: 6, borderTop: "1px solid var(--border, #ddd)", paddingTop: 8 }} data-testid="vd-youtube-zugang">
            <strong>YouTube-Zugang</strong>
            {kanal.youtubeToken ? (
              <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span data-testid="vd-yt-verbunden">verbunden{kanal.youtubeKanal ? ` mit „${kanal.youtubeKanal}“` : ""} seit {zeit(kanal.youtubeVerbundenAm)} – Uploads immer privat.</span>
                {inhaber && <form action={youtubeTrennenAction}><input type="hidden" name="kanalId" value={kanal.id} /><button className="btn btn-sm" type="submit">Trennen</button></form>}
              </div>
            ) : inhaber ? (
              <>
                {!google?.clientId && <span className="muted">Zuerst unter <Link href="/anbindungen?p=google#google">Anbindungen → Google</Link> die Google-App eintragen und dort „YouTube Data API v3“ aktivieren.</span>}
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <a className="btn btn-sm" href={`/api/oauth/youtube/start?kanal=${kanal.id}`} data-testid="vd-yt-verbinden">Mit YouTube verbinden</a>
                  <a className="btn btn-sm" href={`/api/oauth/youtube/start?kanal=${kanal.id}&modus=einfuegen`}>… ohne https (Adresse einfügen)</a>
                </div>
                <form action={youtubeEinfuegenAction} className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <input type="hidden" name="kanalId" value={kanal.id} />
                  <input className="input" name="adresse" placeholder="http://localhost/?code=…&state=… nach der Anmeldung hier einfügen" style={{ flex: 1, minWidth: 240 }} />
                  <button className="btn btn-sm" type="submit">Übernehmen</button>
                </form>
              </>
            ) : (
              <span className="muted">Nicht verbunden (verbindet der Inhaber).</span>
            )}
            <span className="muted">Sichtbarkeit wird immer „privat“ gesetzt und lässt sich hier nicht ändern. Öffentlich stellst du das Video selbst in YouTube Studio.</span>
          </div>
        )}
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }} id="ablage" data-testid="vd-ablage">
        <h2 style={{ margin: 0 }}>Modell und Ablage</h2>
        <form action={ablageAction} className="stack small" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            {(Object.entries(VIDEO_MODELLE) as [keyof typeof VIDEO_MODELLE, (typeof VIDEO_MODELLE)[keyof typeof VIDEO_MODELLE]][]).map(([m, d]) => (
              <label key={m}><input type="radio" name="modell" value={m} defaultChecked={cfg.modell === m} data-testid={`vd-modell-${m}`} /> {d.name} – {d.hinweis} (ca. {usd(andereModelle.find((x) => x.m === m)?.summe)} je Video)</label>
            ))}
          </div>
          <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }} data-testid="vd-bildmodell">
            <span>Bilder (OpenAI):</span>
            {(Object.entries(BILD_MODELLE) as [BildModell, (typeof BILD_MODELLE)[BildModell]][]).map(([m, d]) => (
              <label key={m}><input type="radio" name="bildModell" value={m} defaultChecked={cfg.bildModell === m} data-testid={`vd-bildmodell-${m}`} /> {d.name} – {d.hinweis}</label>
            ))}
          </div>
          <span className="muted">Ist das gewählte Bildmodell im OpenAI-Konto nicht freigeschaltet oder abgeschaltet, nimmt das System automatisch das nächste dieser Liste (die Kosten zeigen, welches). Prüfen: Anbindungen → OpenAI → „Verbindung testen“.</span>
          <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <span>Fertige Videos ablegen in:</span>
            <label><input type="radio" name="ablage" value="drive" defaultChecked={cfg.ablage === "drive"} disabled={!cfg.drive} data-testid="vd-ablage-drive" /> Google Drive{cfg.drive ? "" : " (erst verbinden)"}</label>
            <label><input type="radio" name="ablage" value="server" defaultChecked={cfg.ablage === "server"} /> Seller-Server</label>
            <button className="btn btn-sm" type="submit" disabled={!inhaber} data-testid="vd-ablage-speichern">Speichern</button>
          </div>
        </form>
        <div className="stack small" style={{ gap: 6 }} data-testid="vd-drive">
          {cfg.drive ? (
            <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span data-testid="vd-drive-verbunden">Google Drive verbunden seit {zeit(cfg.drive.verbundenAm)} – Ordner „Seller-System Videos“ (je Kanal und Video ein Unterordner).</span>
              {inhaber && <form action={driveTrennenAction}><button className="btn btn-sm" type="submit">Trennen</button></form>}
            </div>
          ) : inhaber ? (
            <>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <a className="btn btn-sm" href="/api/oauth/youtube/start?drive=1" data-testid="vd-drive-verbinden">Google Drive verbinden</a>
                <a className="btn btn-sm" href="/api/oauth/youtube/start?drive=1&modus=einfuegen">… ohne https (Adresse einfügen)</a>
              </div>
              <form action={driveEinfuegenAction} className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <input className="input" name="adresse" placeholder="http://localhost/?code=…&state=… nach der Anmeldung hier einfügen" style={{ flex: 1, minWidth: 240 }} />
                <button className="btn btn-sm" type="submit">Übernehmen</button>
              </form>
            </>
          ) : (
            <span className="muted">Nicht verbunden (verbindet der Inhaber).</span>
          )}
          <span className="muted">Mit Drive lädt der Worker MP4, Thumbnail, Skript, Quellen und Untertitel direkt in deinen Drive-Ordner; der Seller-Server behält nur die kleinen Dateien (Thumbnail, Skript, Quellen, Untertitel). Zugriff nur auf selbst angelegte Dateien (drive.file).</span>
        </div>
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }} id="kosten" data-testid="vd-kosten-monat">
        <h2 style={{ margin: 0 }}>Kosten</h2>
        {kosten.jeKanal.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>Diesen Monat noch keine Videos.</p>
        ) : (
          <table className="table small">
            <thead><tr><th>Kanal</th><th>Videos (Monat)</th><th>Kosten (Ist)</th></tr></thead>
            <tbody>
              {kosten.jeKanal.map((k) => <tr key={k.kanal}><td>{k.kanal}</td><td>{k.videos}</td><td>{usd(k.kosten)}</td></tr>)}
              <tr><td><strong>Summe</strong></td><td>{kosten.jeKanal.reduce((n, k) => n + k.videos, 0)}</td><td><strong data-testid="vd-kosten-summe">{usd(kosten.monatSumme)}</strong></td></tr>
            </tbody>
          </table>
        )}
        <p className="small muted" style={{ margin: 0 }}>Gezählt werden die Aufrufe über das Seller-System (Claude-Tokens und Websuchen, ElevenLabs-Zeichen, OpenAI-Bilder) mit den Preisen unten. Die Zeile erscheint auch im Wochenrückblick (Feierabend).</p>
        <form action={preiseAction} className="row small" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }} id="preise" data-testid="vd-preise">
          <label className="stack" style={{ gap: 2 }}>Claude Eingabe $/Mio. Tokens<input className="input" name="claudeEingabeJeMio" defaultValue={cfg.preise.claudeEingabeJeMio ?? ""} placeholder={`Liste ${claudePreis({ ...cfg.preise, claudeEingabeJeMio: null }, cfg.modell).eingabe}`} style={{ width: 90 }} /></label>
          <label className="stack" style={{ gap: 2 }}>Claude Ausgabe $/Mio.<input className="input" name="claudeAusgabeJeMio" defaultValue={cfg.preise.claudeAusgabeJeMio ?? ""} placeholder={`Liste ${claudePreis({ ...cfg.preise, claudeAusgabeJeMio: null }, cfg.modell).ausgabe}`} style={{ width: 90 }} /></label>
          <label className="stack" style={{ gap: 2 }}>Websuche $/1000<input className="input" name="websucheJe1000" defaultValue={cfg.preise.websucheJe1000 ?? ""} style={{ width: 80 }} /></label>
          <label className="stack" style={{ gap: 2 }}>ElevenLabs $/1000 Zeichen<input className="input" name="elevenlabsJe1000Zeichen" defaultValue={cfg.preise.elevenlabsJe1000Zeichen ?? ""} style={{ width: 90 }} data-testid="vd-preis-eleven" /></label>
          <label className="stack" style={{ gap: 2 }}>OpenAI $/Bild<input className="input" name="bildJeStueck" defaultValue={cfg.preise.bildJeStueck ?? ""} style={{ width: 80 }} data-testid="vd-preis-bild" /></label>
          <label className="stack" style={{ gap: 2 }}>$/Motiv (1024²)<input className="input" name="motivJeStueck" defaultValue={cfg.preise.motivJeStueck ?? ""} placeholder="= Bild" style={{ width: 80 }} data-testid="vd-preis-motiv" /></label>
          <label className="stack" style={{ gap: 2 }}>Reserve Server GB<input className="input" name="serverReserveGb" defaultValue={cfg.serverReserveGb} style={{ width: 70 }} /></label>
          <button className="btn btn-sm" type="submit" disabled={!inhaber}>Preise speichern</button>
        </form>
        <p className="small muted" style={{ margin: 0 }}>Claude-Preise leer lassen = Listenpreis des gewählten Modells.</p>
        <p className="small muted" style={{ margin: 0 }} data-testid="vd-server-platz">Seller-Server: {serverFrei === null ? "freier Platz unbekannt" : `${serverFrei.toLocaleString("de-DE")} GB frei`} – {cfg.ablage === "drive" ? "mit Ablage Google Drive kommen nur die kleinen Dateien hierher." : "er speichert die fertigen Dateien (ca. 0,5–1 GB je Video). Ist zu wenig frei, lehnt er den Upload ab und der Auftrag zeigt den Fehler."}</p>
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }} id="worker" data-testid="vd-worker">
        <h2 style={{ margin: 0 }}>Worker (Arbeits-PC)</h2>
        <p className="small muted" style={{ margin: 0 }}>Der Worker holt sich die Aufträge selbst ab (alle ~30 s) – keine offenen Ports am PC. Einrichtung unter Windows: Ordner <code>unter-der-decke/</code> im Repository, Anleitung in dessen README (Docker Desktop oder Python 3.12 + ffmpeg).</p>
        {workerAlle.length > 0 && (
          <table className="table small" data-testid="vd-worker-liste">
            <thead><tr><th>Name</th><th>Token</th><th>Zuletzt gesehen</th><th>System</th><th>Frei</th><th /></tr></thead>
            <tbody>
              {workerAlle.map((w) => (
                <tr key={w.id}>
                  <td>{w.name}</td>
                  <td><code>{w.tokenAnfang}…</code></td>
                  <td>{workerStand(w.zuletztGesehen).text.replace("Worker zuletzt gesehen: ", "")}</td>
                  <td>{[w.info.os, w.info.python && `Python ${w.info.python}`, w.info.ffmpeg?.split(" ").slice(0, 3).join(" "), w.version && `v${w.version}`].filter(Boolean).join(" · ") || "–"}</td>
                  <td>{w.freiGb !== null ? `${w.freiGb.toLocaleString("de-DE")} GB` : "–"}</td>
                  <td>{inhaber && <form action={workerDeaktivierenAction}><input type="hidden" name="id" value={w.id} /><ConfirmButton confirm="Worker deaktivieren? Sein Token gilt dann nicht mehr." className="btn btn-sm">Deaktivieren</ConfirmButton></form>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {inhaber ? <WorkerAnlegen /> : <p className="small muted" style={{ margin: 0 }}>Worker legt der Inhaber an.</p>}
      </section>
    </div>
  );
}
