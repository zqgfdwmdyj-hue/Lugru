import type { videoKanaele } from "@/db/tables/video";
import { ConfirmButton } from "@/components/confirm-button";
import { usd } from "@/lib/video/logic";
import { auftraege } from "@/lib/video/service";
import { fotos, storyUebersicht } from "@/lib/video/story";
import { FREIGABE_MODI, STORY_ARTEN, STORY_STATUS_TEXT, themenText } from "@/lib/video/story-logic";
import { fotoAction, fotoLoeschenAction, storiesErzeugenAction, storiesPlanenAction, storiesPostenAction, storyAblehnenAction, storyErneutAction, storyFreigebenAction, storyGepostetAction, storyNeuAction, themenAction } from "./actions";

// B37 Instagram-Kanal im Reiter „Video“: Themenliste, Foto-Mediathek, Stories des Tages zur Freigabe (Handy zuerst),
// Posten zur Planzeit (Stufe 2) oder „herunterladen und von Hand posten“ (Stufe 1), Kosten je Story und Monatslimit.

type Kanal = typeof videoKanaele.$inferSelect;
const zeit = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleString("de-DE", { timeZone: "Europe/Berlin", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–");

export async function StoriesBereich({ tenantId, kanal, nurLesen }: { tenantId: string; kanal: Kanal; nurLesen: boolean }) {
  const [ue, liste, fotoListe] = await Promise.all([storyUebersicht(tenantId, kanal), auftraege(tenantId, kanal.id, 40, "story"), fotos(tenantId, kanal.id)]);
  const p = ue.profil;
  const offen = liste.filter(({ a }) => a.status === "freigabe").length;
  return (
    <>
      <section className="card card-pad stack" style={{ gap: 8 }} id="stories" data-testid="st-bereich">
        <div className="between" style={{ gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
          <h2 style={{ margin: 0 }}>Stories · {kanal.name}</h2>
          <span className={`tag ${ue.limitErreicht ? "tag-danger" : "tag-info"}`} data-testid="st-kosten">
            Monat {usd(ue.monatKosten)}{p.monatslimit !== null ? ` von ${usd(p.monatslimit)}` : ""} · je Story ca. {usd(ue.schaetzung.summe)} (mit eigenem Foto {usd(ue.schaetzungFoto.summe)})
          </span>
        </div>
        {ue.limitErreicht && <div className="notice notice-warn small" data-testid="st-limit">Monatslimit erreicht – es werden keine neuen Stories erzeugt. Limit im Kanalprofil erhöhen oder nächsten Monat abwarten.</div>}
        <p className="small muted" style={{ margin: 0 }} data-testid="st-plan">
          Zeitplan: {p.tage.length === 7 ? "täglich" : p.tage.map((t) => ["", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"][t]).join(", ") || "kein Tag"} um {p.uhrzeiten.join(", ")} Uhr · {p.uhrzeiten.length} Story/Tag · Freigabe: {FREIGABE_MODI[p.freigabeModus]} ·{" "}
          {kanal.instagramToken ? `Instagram verbunden${kanal.instagramKonto ? ` (${kanal.instagramKonto})` : ""} – wird automatisch gepostet` : "Instagram nicht verbunden – Stufe 1: herunterladen und von Hand posten"}
          {ue.zugang.stand === "bald" ? ` · Zugang läuft in ${ue.zugang.tage} Tag(en) ab` : ue.zugang.stand === "abgelaufen" ? " · Zugang abgelaufen – neu verbinden!" : ""}
          {offen ? ` · ${offen} warten auf Freigabe` : ""}
        </p>
        <form action={themenAction} className="stack small" style={{ gap: 6 }}>
          <input type="hidden" name="kanalId" value={kanal.id} />
          <label className="stack" style={{ gap: 2 }}>
            Themenliste (eine Zeile je Thema: „art: Thema“ – art = preis, leistung, tipp, einblick, umfrage, cta)
            <textarea className="input" name="themen" rows={6} defaultValue={themenText(p.themen)} placeholder={"preis: Etikett + Prep je Artikel\nleistung: Lagerung ohne Mindestlaufzeit\ntipp: FNSKU richtig aufkleben\neinblick: So sieht ein Prep-Tag aus\ncta: Anfrage stellen"} data-testid="st-themen" />
          </label>
          <span className="muted">Nur Fakten aus dem Kanalprofil („Bestätigte Fakten“) – nichts wird erfunden. Prüfung jeder Story: keine „kostenlose Zählung“, „all-in“ nur mit Aufzählung, keine Aussagen zur Versicherung, Werbekennzeichnung.</span>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-sm" type="submit" disabled={nurLesen} data-testid="st-themen-speichern">Themen speichern</button>
            <button className="btn btn-sm btn-primary" type="submit" formAction={storiesErzeugenAction} disabled={nurLesen || ue.limitErreicht} data-testid="st-erzeugen">Stories aus der Themenliste erzeugen</button>
            <button className="btn btn-sm" type="submit" formAction={storiesPlanenAction} disabled={nurLesen} data-testid="st-planen">Nächste 36 h planen</button>
            <button className="btn btn-sm" type="submit" formAction={storiesPostenAction} disabled={nurLesen} data-testid="st-posten">Fällige jetzt posten</button>
          </div>
        </form>
      </section>

      <section className="card card-pad stack small" style={{ gap: 8 }} id="fotos" data-testid="st-fotos">
        <h3 style={{ margin: 0 }}>Foto-Mediathek (für „Einblick“) · {ue.fotosFrei} ungenutzt</h3>
        <form action={fotoAction} className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input type="hidden" name="kanalId" value={kanal.id} />
          <input type="file" name="fotos" accept="image/jpeg,image/png,image/webp" capture="environment" multiple data-testid="st-foto-datei" />
          <label><input type="checkbox" name="ohnePersonen" value="1" data-testid="st-foto-ohne-personen" /> keine Personen im Bild, eigenes Foto</label>
          <button className="btn btn-sm" type="submit" disabled={nurLesen} data-testid="st-foto-hochladen">Hochladen</button>
        </form>
        {fotoListe.length > 0 && (
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {fotoListe.map((f) => (
              <form key={f.id} action={fotoLoeschenAction} className="stack" style={{ gap: 2, width: 96 }} data-testid="st-foto">
                <input type="hidden" name="id" value={f.id} />
                <input type="hidden" name="kanalId" value={kanal.id} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/video/foto/${f.id}`} alt={f.name} style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 6 }} />
                <span className="muted" style={{ fontSize: 11 }}>{f.genutztAuftrag ? "genutzt" : "frei"}</span>
                {!nurLesen && <button className="btn btn-sm" type="submit">Löschen</button>}
              </form>
            ))}
          </div>
        )}
      </section>

      <section className="stack" style={{ gap: 10 }} data-testid="st-liste">
        <h2 style={{ margin: 0 }}>Stories</h2>
        {liste.length === 0 && <p className="small muted">Noch keine Stories – Themen eintragen und „Stories aus der Themenliste erzeugen“.</p>}
        {liste.map(({ a }) => {
          const st = a.story;
          const datei = a.dateien.story_mp4 ? "story_mp4" : a.dateien.story_png ? "story_png" : null;
          const fehler = a.schritte.story?.status === "fehler" ? a.schritte.story.fehler : null;
          return (
            <article key={a.id} id={`s-${a.id}`} className="card card-pad stack small" style={{ gap: 6 }} data-testid="st-story" data-status={a.status} data-ig={a.igStatus ?? ""}>
              <div className="between" style={{ gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                <strong>{zeit(a.geplantFuer)} · {st ? STORY_ARTEN[st.inhaltsart].name : "Story"}</strong>
                <span className={`tag ${a.status === "fehler" || a.igStatus === "fehler" ? "tag-danger" : a.status === "freigabe" ? "tag-warn" : a.igStatus === "gepostet" ? "tag-ok" : "tag-info"}`} data-testid="st-status">
                  {a.status === "freigabe" ? "wartet auf Freigabe" : a.status === "abgebrochen" ? "abgelehnt" : a.status === "fehler" ? "Fehler" : a.status === "fertig" ? STORY_STATUS_TEXT[a.igStatus ?? ""] ?? "fertig" : a.status === "laeuft" ? "wird erzeugt" : "wartet auf Worker"}
                </span>
              </div>
              <div className="muted">Thema: {a.thema}{st?.fotoId ? " · eigenes Foto" : ""}{st?.werbung ? " · mit „Werbung“" : ""} · Kosten {usd(a.kostenIst)}</div>
              <div className="row" style={{ gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                {datei && (datei === "story_mp4" ? (
                  <video src={`/api/video/${a.id}/story_mp4`} poster={a.dateien.story_vorschau ? `/api/video/${a.id}/story_vorschau` : undefined} controls playsInline muted style={{ width: 160, aspectRatio: "9 / 16", background: "#000", borderRadius: 8 }} data-testid="st-vorschau" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/video/${a.id}/story_png`} alt="Story-Vorschau" style={{ width: 160, aspectRatio: "9 / 16", objectFit: "cover", borderRadius: 8 }} data-testid="st-vorschau" />
                ))}
                <div className="stack" style={{ gap: 4, flex: 1, minWidth: 200 }}>
                  {st?.ueberschrift && <strong data-testid="st-ueberschrift">{st.ueberschrift}</strong>}
                  {st?.text && <span data-testid="st-text">{st.text}</span>}
                  {st?.cta && <span className="muted">{st.cta}</span>}
                  {st?.sticker && <span className="notice small" data-testid="st-sticker">Sticker von Hand in der Instagram-App setzen: {st.sticker.art === "umfrage" ? "Umfrage" : "Frage"} „{st.sticker.frage}“{st.sticker.optionen?.length ? ` (${st.sticker.optionen.join(" / ")})` : ""} – die API kann keine Sticker.</span>}
                  {(st?.regeln ?? []).map((r) => <span key={r} className="notice notice-warn small" data-testid="st-regel">Regel: {r}</span>)}
                  {fehler && <span className="notice notice-warn small" data-testid="st-fehler">{fehler}</span>}
                  {a.igFehler && <span className="notice notice-warn small" data-testid="st-ig-fehler">{a.igFehler}{a.igNaechsterVersuch && a.igStatus === "geplant" ? ` – nächster Versuch ${zeit(a.igNaechsterVersuch)}` : ""}</span>}
                  {a.gepostetAm && <span className="muted">gepostet {zeit(a.gepostetAm)}</span>}
                </div>
              </div>
              {!nurLesen && (
                <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {a.status === "freigabe" && (
                    <form action={storyFreigebenAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="kanalId" value={kanal.id} /><button className="btn btn-sm btn-primary" type="submit" disabled={!!st?.regeln?.length} data-testid="st-freigeben">Freigeben</button></form>
                  )}
                  {(a.status === "freigabe" || a.status === "fehler" || (a.status === "fertig" && a.igStatus !== "gepostet")) && (
                    <form action={storyNeuAction} className="row" style={{ gap: 4, alignItems: "center" }}>
                      <input type="hidden" name="id" value={a.id} /><input type="hidden" name="kanalId" value={kanal.id} />
                      <input className="input" name="hinweis" placeholder="Anmerkung (optional)" style={{ width: 160 }} />
                      <label><input type="checkbox" name="motivNeu" value="1" /> Motiv neu</label>
                      <button className="btn btn-sm" type="submit" data-testid="st-neu">Neu erzeugen</button>
                    </form>
                  )}
                  {a.status !== "abgebrochen" && a.igStatus !== "gepostet" && (
                    <form action={storyAblehnenAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="kanalId" value={kanal.id} /><ConfirmButton className="btn btn-sm" confirm="Story ablehnen? An diesem Termin wird dann nichts gepostet." testid="st-ablehnen">Ablehnen</ConfirmButton></form>
                  )}
                  {datei && a.status === "fertig" && <a className="btn btn-sm" href={`/api/video/${a.id}/${datei}?download=1`} data-testid="st-download">Herunterladen</a>}
                  {a.status === "fertig" && (a.igStatus === "manuell" || a.igStatus === "fehler") && (
                    <form action={storyGepostetAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="kanalId" value={kanal.id} /><button className="btn btn-sm" type="submit" data-testid="st-gepostet">Von Hand gepostet</button></form>
                  )}
                  {a.igStatus === "fehler" && (
                    <form action={storyErneutAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="kanalId" value={kanal.id} /><button className="btn btn-sm" type="submit" data-testid="st-erneut">Erneut posten</button></form>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </section>
    </>
  );
}
