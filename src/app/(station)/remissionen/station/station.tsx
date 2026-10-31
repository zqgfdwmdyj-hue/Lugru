"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BEFUND_KURZ, ENTSCHEIDUNG_TEXT, erkenneBefehl, erkenneCode, HILFE_TEXT, VERBLEIB_TEXT, type Befehl } from "@/lib/retouren-station/logic";
import type { StationStand } from "@/lib/retouren-station/service";
import { sprechen, ton, WebSpeechInput, type SpeechInput, type SpeechStatus } from "./sprache";
import { Schlange, type Auftrag } from "./warteschlange";

// Retouren-Station: Vollbild mit Livebild, Steuerung per Sprache (Knöpfe nur als Notlösung), Ansage nach jedem
// Schritt. Fotos und Befehle gehen der Reihe nach an den Server; ohne Netz warten sie im Browser.

type FotoArt = "etikett" | "lieferschein" | "produkt_lpn" | "inhalt";
type Antwort = { ansage: string; ton: "ok" | "warnung" | "fehler"; stand: StationStand };

const eur = (n: number | null) => (n === null ? "–" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
const SCAN_PAUSE_MS = 60;

declare global {
  interface Window {
    /** Für die automatischen Prüfungen: gesprochenen Satz einspeisen und gesprochene Ansagen mitlesen. */
    __station?: { sage: (text: string) => void; ansagen: string[]; scanne: (code: string) => void };
  }
}

type BarcodeDetectorT = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

export function Station({ initial }: { initial: StationStand }) {
  const [stand, setStand] = useState<StationStand>(initial);
  const [gestartet, setGestartet] = useState(false);
  const [kamera, setKamera] = useState<"aus" | "an" | "fehler">("aus");
  const [kameraInfo, setKameraInfo] = useState("");
  const [sprache, setSprache] = useState<SpeechStatus>("aus");
  const [spracheInfo, setSpracheInfo] = useState("");
  const [gehoert, setGehoert] = useState("");
  const [ansage, setAnsage] = useState("Station starten: einmal auf „Station starten“ tippen – danach alles per Sprache.");
  const [offen, setOffen] = useState({ n: 0, netzWeg: false });
  const [videoOffen, setVideoOffen] = useState(0);
  const [aufnahme, setAufnahme] = useState(false);
  const [blitz, setBlitz] = useState(false);
  const [tippen, setTippen] = useState("");
  // B19.8: eigenes LPN-Feld (LPN, FNSKU, ASIN oder EAN von Hand) – gleicher Weg wie der Handscanner.
  const [lpn, setLpn] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const eingabeRef = useRef<SpeechInput | null>(null);
  const schlangeRef = useRef<Schlange | null>(null);
  const videoSchlangeRef = useRef<Schlange | null>(null);
  const recorderRef = useRef<{ rec: MediaRecorder; pruefung: string; teil: number } | null>(null);
  const standRef = useRef(stand);
  const letzteAnsage = useRef("");
  const letzteFotoArt = useRef<FotoArt | null>(null);
  const scanRef = useRef<{ code: string; at: number } | null>(null);
  const gewarnt = useRef(new Set<string>());
  const detectorRef = useRef<BarcodeDetectorT | null>(null);
  const abbrechenAt = useRef(0);

  useEffect(() => {
    standRef.current = stand;
  }, [stand]);

  const sagen = useCallback((text: string, art: "ok" | "warnung" | "fehler" = "ok") => {
    if (!text) return;
    letzteAnsage.current = text;
    setAnsage(text);
    ton(art);
    window.__station?.ansagen.push(text);
    setTimeout(() => sprechen(text, eingabeRef.current), art === "ok" ? 150 : 350);
  }, []);

  // ---- Video je Paket --------------------------------------------------------------------------------
  const videoStopp = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.rec.state !== "inactive") r.rec.stop();
    recorderRef.current = null;
    setAufnahme(false);
  }, []);

  const videoStart = useCallback((pruefung: string) => {
    if (!streamRef.current || typeof MediaRecorder === "undefined") return;
    if (recorderRef.current?.pruefung === pruefung) return;
    videoStopp();
    const typ = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
    // Nur Bild, kein Ton – Gespräche im Raum gehören nicht ins Beweisvideo.
    const nurBild = new MediaStream(streamRef.current.getVideoTracks());
    const rec = new MediaRecorder(nurBild, { mimeType: typ, videoBitsPerSecond: 1_500_000 });
    const r = { rec, pruefung, teil: 0 };
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      r.teil++;
      void videoSchlangeRef.current?.hinzu({ typ: "video", pruefung, teil: r.teil, daten: e.data });
    };
    rec.start(10_000);
    recorderRef.current = r;
    setAufnahme(true);
  }, [videoStopp]);

  // ---- Antworten vom Server --------------------------------------------------------------------------
  const verarbeiten = useCallback(
    (a: Auftrag, r: unknown, fehler: string | null) => {
      if (a.typ === "video") return;
      if (fehler) return sagen(fehler, "fehler");
      const x = r as Antwort;
      const vorher = standRef.current.pruefung?.id;
      // KI-Warnung schon in dieser Ansage? Dann nicht noch einmal extra warnen.
      for (const p of x.stand.pruefung?.positionen ?? []) if (p.kiWarnung && x.ansage?.includes(p.kiWarnung)) gewarnt.current.add(`${p.id}:${p.kiWarnung}`);
      setStand(x.stand);
      if (x.ansage) sagen(x.ansage, x.ton);
      else if (a.typ === "befehl" && (a.body.befehl as { befehl: string }).befehl === "wiederholen") sagen(letzteAnsage.current);
      const p = x.stand.pruefung;
      if (p?.status === "offen" && p.id !== vorher) videoStart(p.id);
      if (!p || p.status !== "offen") videoStopp();
    },
    [sagen, videoStart, videoStopp],
  );

  // ---- Foto ------------------------------------------------------------------------------------------
  const fotoMachen = useCallback(
    async (art: FotoArt, o: { ersetzen?: boolean; neu?: boolean } = {}) => {
      const v = videoRef.current;
      if (!v || !v.videoWidth) return sagen("Kamera nicht bereit.", "fehler");
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext("2d")!.drawImage(v, 0, 0);
      setBlitz(true);
      setTimeout(() => setBlitz(false), 150);
      ton("ok");
      const voll = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.9));
      // Verkleinert für die KI (lange Kante ~1600 px)
      const f = Math.min(1, 1600 / Math.max(c.width, c.height));
      const k = document.createElement("canvas");
      k.width = Math.round(c.width * f);
      k.height = Math.round(c.height * f);
      k.getContext("2d")!.drawImage(c, 0, 0, k.width, k.height);
      const klein = await new Promise<Blob | null>((r) => k.toBlob(r, "image/jpeg", 0.85));
      if (!voll) return sagen("Foto fehlgeschlagen.", "fehler");
      let code: string | null = null;
      if (art === "produkt_lpn") {
        // Handscanner der letzten 20 s gilt; sonst Barcode im Foto suchen (Chrome: BarcodeDetector).
        if (scanRef.current && Date.now() - scanRef.current.at < 20_000) code = scanRef.current.code;
        if (!code && detectorRef.current) {
          const found = await detectorRef.current.detect(c).catch(() => []);
          code = found.map((b) => erkenneCode(b.rawValue)).find((x) => x?.art === "lpn")?.wert ?? found.map((b) => erkenneCode(b.rawValue)).find(Boolean)?.wert ?? null;
        }
        scanRef.current = null;
      }
      letzteFotoArt.current = art;
      await schlangeRef.current?.hinzu({ typ: "foto", art, voll, klein, code, ersetzen: Boolean(o.ersetzen), neu: Boolean(o.neu) });
    },
    [sagen],
  );

  // ---- Befehle ---------------------------------------------------------------------------------------
  const senden = useCallback(async (b: Record<string, unknown>) => {
    await schlangeRef.current?.hinzu({ typ: "befehl", body: { pruefung: null, befehl: b } });
  }, []);

  const ausfuehren = useCallback(
    async (b: Befehl) => {
      switch (b.befehl) {
        case "etikett":
          return fotoMachen("etikett");
        case "lieferschein":
          return fotoMachen("lieferschein");
        case "produkt":
        case "naechstes":
          return fotoMachen("produkt_lpn", { neu: true });
        case "foto":
          return fotoMachen("inhalt");
        case "nochmal":
          return letzteFotoArt.current ? fotoMachen(letzteFotoArt.current, { ersetzen: true }) : sagen("Noch kein Foto.", "warnung");
        case "wiederholen":
          return sagen(letzteAnsage.current || "Noch nichts gesagt.");
        case "hilfe":
          return sagen(HILFE_TEXT);
        case "fertig":
          videoStopp();
          return senden(b);
        case "abbrechen":
          // Zweimal hintereinander = Paket abbrechen (schützt vor Versehen)
          if (Date.now() - abbrechenAt.current > 8000) {
            abbrechenAt.current = Date.now();
            return sagen("Paket abbrechen? Zum Bestätigen noch einmal Abbrechen sagen.", "warnung");
          }
          abbrechenAt.current = 0;
          return senden(b);
        default:
          return senden(b);
      }
    },
    [fotoMachen, sagen, senden, videoStopp],
  );

  const gesprochen = useCallback(
    (text: string) => {
      setGehoert(text);
      const b = erkenneBefehl(text, { aktivierungswort: standRef.current.einstellungen.aktivierungswort });
      if (!b) {
        // Längere Sätze sind eher Gespräch im Raum – dann still bleiben.
        if (text.trim().split(/\s+/).length <= 4 && !standRef.current.einstellungen.aktivierungswort) sagen("Nicht verstanden.", "fehler");
        return;
      }
      void ausfuehren(b);
    },
    [ausfuehren, sagen],
  );

  /** Handscanner (Tastatur-Eingabe) oder Barcode: LPN/FNSKU → Produkt-Schritt mit diesem Code. */
  const gescannt = useCallback(
    (roh: string) => {
      const c = erkenneCode(roh);
      if (!c) return sagen("Code nicht erkannt.", "fehler");
      scanRef.current = { code: c.wert, at: Date.now() };
      ton("ok");
      if (videoRef.current?.videoWidth) void fotoMachen("produkt_lpn", { neu: true });
      else void senden({ befehl: "code", wert: c.wert });
    },
    [fotoMachen, sagen, senden],
  );

  // ---- Start -----------------------------------------------------------------------------------------
  const starten = useCallback(async () => {
    setGestartet(true);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 3840 }, height: { ideal: 2160 }, facingMode: "environment" }, audio: false });
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play().catch(() => undefined);
      }
      const t = s.getVideoTracks()[0]?.getSettings();
      setKamera("an");
      setKameraInfo(t?.width ? `${t.width}×${t.height}` : "");
      const p = standRef.current.pruefung;
      if (p?.status === "offen") videoStart(p.id);
    } catch (e) {
      setKamera("fehler");
      setKameraInfo(e instanceof Error ? e.message : "Kamera nicht verfügbar");
    }
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorT }).BarcodeDetector;
    if (BD) {
      try {
        detectorRef.current = new BD({ formats: ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "qr_code", "data_matrix"] });
      } catch {
        detectorRef.current = null;
      }
    }
    const e = new WebSpeechInput();
    eingabeRef.current = e;
    e.start(
      (text, final) => {
        if (final) gesprochen(text);
        else setGehoert(`${text} …`);
      },
      (st, info) => {
        setSprache(st);
        setSpracheInfo(info ?? "");
      },
    );
    sagen(standRef.current.pruefung?.status === "offen" ? "Station bereit. Paket läuft weiter." : "Station bereit. Sage Neues Paket.");
  }, [gesprochen, sagen, videoStart]);

  // Warteschlangen + Prüf-Haken + Handscanner
  useEffect(() => {
    const q = new Schlange("auftraege", verarbeiten, (n, netzWeg) => setOffen({ n, netzWeg }));
    const vq = new Schlange("video", verarbeiten, (n) => setVideoOffen(n));
    schlangeRef.current = q;
    videoSchlangeRef.current = vq;
    void q.wiederaufnehmen();
    void vq.wiederaufnehmen();
    window.__station = { sage: (t) => gesprochen(t), ansagen: [], scanne: (c) => gescannt(c) };
    // Handscanner tippt sehr schnell und schließt mit Enter ab.
    let puffer = "";
    let zuletzt = 0;
    const onKey = (ev: KeyboardEvent) => {
      const ziel = ev.target as HTMLElement | null;
      if (ziel && (ziel.tagName === "INPUT" || ziel.tagName === "TEXTAREA")) return;
      const jetzt = Date.now();
      if (jetzt - zuletzt > SCAN_PAUSE_MS) puffer = "";
      zuletzt = jetzt;
      if (ev.key === "Enter") {
        if (puffer.length >= 8) gescannt(puffer);
        puffer = "";
      } else if (ev.key.length === 1) puffer += ev.key;
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      eingabeRef.current?.stop();
    };
  }, [verarbeiten, gesprochen, gescannt]);

  // KI-Abgleich läuft im Hintergrund – Ergebnis abholen und bei Abweichung warnen.
  const laeuft = stand.pruefung?.positionen.some((p) => p.ki && "status" in p.ki && p.ki.status === "laeuft");
  useEffect(() => {
    for (const p of stand.pruefung?.positionen ?? []) {
      if (p.kiWarnung && !gewarnt.current.has(`${p.id}:${p.kiWarnung}`)) {
        gewarnt.current.add(`${p.id}:${p.kiWarnung}`);
        sagen(`Artikel ${p.nr}: ${p.kiWarnung}`, "warnung");
      }
    }
  }, [stand, sagen]);
  useEffect(() => {
    if (!laeuft) return;
    const id = setInterval(async () => {
      const r = await fetch(`/remissionen/station/api${stand.pruefung ? `?pruefung=${stand.pruefung.id}` : ""}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (r) setStand(r as StationStand);
    }, 3000);
    return () => clearInterval(id);
  }, [laeuft, stand.pruefung]);

  const vollbild = () => document.documentElement.requestFullscreen?.().catch(() => undefined);

  // ---- Anzeige ---------------------------------------------------------------------------------------
  const p = stand.pruefung?.status === "offen" ? stand.pruefung : null;
  const pos = p?.positionen ?? [];
  const akt = pos.at(-1) ?? null;
  const hat = (art: string) => Boolean(p?.medien.some((m) => m.art === art));
  const naechster = !p ? "„Neues Paket“" : !hat("etikett") ? "„Etikett“" : !hat("lieferschein") ? "„Lieferschein“" : !akt ? "„Produkt“" : !akt.befund ? (akt.fotos < 2 ? "„Foto“ (Inhalt), dann Zustand" : "Zustand: „OK“, „leer“, „benutzt“ …") : "„Nächstes Produkt“ oder „Fertig“";
  const aw = stand.einstellungen.aktivierungswort;

  return (
    <div className="station" data-testid="station">
      <header className="station-kopf">
        <strong>Retouren-Station</strong>
        <span className={`station-chip ${kamera === "an" ? "gut" : kamera === "fehler" ? "schlecht" : ""}`} data-testid="station-kamera">Kamera {kamera === "an" ? `an ${kameraInfo}` : kamera === "fehler" ? `– ${kameraInfo}` : "aus"}</span>
        <span className={`station-chip ${sprache === "hoert" ? "gut" : sprache === "fehler" || sprache === "nicht_verfuegbar" ? "schlecht" : ""}`} data-testid="station-sprache">
          Sprache {sprache === "hoert" ? "hört zu" : sprache === "nicht_verfuegbar" ? "nicht verfügbar (Chrome nötig)" : sprache === "fehler" ? `– ${spracheInfo}` : "aus"}
          {aw ? ` · Aktivierungswort „${aw}“` : ""}
        </span>
        {aufnahme && <span className="station-chip rec">● Video</span>}
        <span className={`station-chip ${stand.kiAktiv ? "gut" : "schlecht"}`}>{stand.kiAktiv ? "KI an" : "KI aus – kein Schlüssel"}</span>
        <span className="station-chip" title="Letzter Import des Kundenretouren-Berichts">Kundenretouren: {stand.datenstand.kundenretouren ?? "keine Daten"}</span>
        {(offen.n > 0 || videoOffen > 0) && (
          <span className={`station-chip ${offen.netzWeg ? "schlecht" : ""}`} data-testid="station-warteschlange">
            {offen.netzWeg ? "Netz weg – " : ""}
            {offen.n} wartet{videoOffen ? `, Video ${videoOffen}` : ""}
          </span>
        )}
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn btn-small" type="button" onClick={vollbild}>Vollbild</button>
          <Link className="btn btn-small" href="/remissionen/pruefungen">Fälle & Prüfungen</Link>
        </span>
      </header>

      <div className="station-raster">
        <section className="station-bild">
          <video ref={videoRef} muted playsInline data-testid="station-video" />
          {blitz && <div className="station-blitz" />}
          {!gestartet && (
            <div className="station-start">
              <button className="btn btn-primary station-startknopf" type="button" onClick={starten} data-testid="station-start">Station starten</button>
              <div>Kamera und Mikrofon werden angefragt. Danach alles per Sprache.</div>
            </div>
          )}
          <div className="station-ansage" role="status" aria-live="polite" data-testid="station-ansage">{ansage}</div>
          {gehoert && <div className="station-gehoert" data-testid="station-gehoert">„{gehoert}“</div>}
        </section>

        <aside className="station-daten">
          <div className="station-block">
            <div className="station-label">Nächster Schritt</div>
            <div className="station-gross" data-testid="station-naechster">{naechster}</div>
          </div>
          {p ? (
            <div className="station-block" data-testid="station-paket">
              <div className="station-label">Paket</div>
              <div>Remission: <b data-testid="station-remission">{p.remissionId ?? "–"}</b>{p.zuordnung ? <span className="muted"> ({p.zuordnung})</span> : null}</div>
              <div>Sendung: {p.versender ?? "–"} {p.sendungsnummer ?? ""}</div>
              {p.erwartet && <div>Erwartet: {p.erwartet.map((e) => `${e.titel ?? e.fnsku ?? e.sku} × ${e.menge}`).join(", ")}</div>}
              {p.abweichungen.length > 0 && <div className="station-warn" data-testid="station-abweichungen">{p.abweichungen.join(" · ")}</div>}
              {p.notiz && <div className="muted">Notiz: {p.notiz}</div>}
            </div>
          ) : (
            stand.pruefung?.zusammenfassung && (
              <div className="station-block">
                <div className="station-label">Letztes Paket</div>
                <div data-testid="station-zusammenfassung">{stand.pruefung.zusammenfassung}</div>
              </div>
            )
          )}
          {stand.remissionenAuswahl && (
            <div className="station-block" data-testid="station-remissionen">
              <div className="station-label">Offene Remissionen – „Remission 1“ … sagen</div>
              {stand.remissionenAuswahl.length === 0 && <div className="muted">Keine offenen Remissionen in den Daten.</div>}
              <ol className="station-liste">
                {stand.remissionenAuswahl.map((r) => <li key={r.id}>{r.id} · {r.datum ?? "–"} · {r.positionen} Pos.{r.versender ? ` · ${r.versender}` : ""}</li>)}
              </ol>
            </div>
          )}
          {akt && (
            <div className="station-block station-artikel" data-testid="station-artikel">
              <div className="station-label">Artikel {akt.nr}{pos.length > 1 ? ` von ${pos.length}` : ""}</div>
              <div className="station-gross">{akt.titel ?? (akt.zuordnung === "unbekannt" ? "nicht erkannt" : "–")}</div>
              <div>LPN: <b data-testid="station-lpn">{akt.lpn ?? "–"}</b>{akt.fnsku ? ` · FNSKU ${akt.fnsku}` : ""}{akt.asin ? ` · ${akt.asin}` : ""}</div>
              {akt.bestellnummer && <div>Bestellung {akt.bestellnummer} · Rückgabe {akt.rueckgabeDatum?.split("-").reverse().join(".") ?? "–"}</div>}
              {akt.grund && <div>Grund: {akt.grund}{akt.amazonZustand ? ` · Amazon: ${akt.amazonZustand}` : ""}</div>}
              {akt.kundenkommentar && <div className="muted">Kunde: „{akt.kundenkommentar}“</div>}
              <div>Erstattet: <b data-testid="station-erstattet">{eur(akt.erstattet)}</b>{(akt.amazonGezahlt ?? 0) > 0 ? ` · Amazon gezahlt ${eur(akt.amazonGezahlt)}` : ""}</div>
              <div>Befund: <b data-testid="station-befund">{akt.befund ? BEFUND_KURZ[akt.befund] : "–"}</b>{akt.entscheidung ? <> · <span data-testid="station-entscheidung">{ENTSCHEIDUNG_TEXT[akt.entscheidung as keyof typeof ENTSCHEIDUNG_TEXT] ?? akt.entscheidung}</span></> : null}</div>
              {(akt.verbleib || akt.verbleibVorschlag) && <div>Verbleib: {VERBLEIB_TEXT[(akt.verbleib ?? akt.verbleibVorschlag)!]}{akt.verbleib ? "" : " (Vorschlag)"}</div>}
              {akt.ki && "status" in akt.ki && akt.ki.status === "laeuft" && <div className="muted">KI prüft die Fotos …</div>}
              {akt.ki && "passt" in akt.ki && (
                <div className="muted" data-testid="station-ki">KI: passt {akt.ki.passt}, Spuren {akt.ki.gebrauchsspuren}, vollständig {akt.ki.vollstaendig}{akt.ki.begruendung ? ` – ${akt.ki.begruendung}` : ""}</div>
              )}
              {akt.kiWarnung && <div className="station-warn" data-testid="station-kiwarnung">{akt.kiWarnung}</div>}
              {akt.notiz && <div className="muted">Notiz: {akt.notiz}</div>}
              <div className="muted">{akt.fotos} Foto{akt.fotos === 1 ? "" : "s"}</div>
            </div>
          )}
          {pos.length > 1 && (
            <div className="station-block">
              <div className="station-label">Im Paket</div>
              <ol className="station-liste">
                {pos.map((x) => <li key={x.id}>{(x.titel ?? x.lpn ?? "?").split(" ").slice(0, 4).join(" ")} – {x.befund ? BEFUND_KURZ[x.befund] : "offen"}</li>)}
              </ol>
            </div>
          )}
        </aside>
      </div>

      <footer className="station-fuss">
        <span className="station-label">Notfall-Knöpfe</span>
        {(
          [
            ["Neues Paket", "Neues Paket"],
            ["Etikett", "Etikett"],
            ["Lieferschein", "Lieferschein"],
            ["Produkt", "Produkt"],
            ["Foto", "Foto"],
            ["OK", "Zustand OK"],
            ["leer", "leer"],
            ["benutzt", "benutzt"],
            ["beschädigt", "beschädigt"],
            ["falsches Produkt", "falsches Produkt"],
            ["unvollständig", "unvollständig"],
            ["Fertig", "Fertig"],
          ] as const
        ).map(([l, t]) => (
          <button key={l} className="btn btn-small" type="button" disabled={!gestartet} onClick={() => gesprochen(t)}>{l}</button>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (tippen.trim()) gesprochen(tippen.trim());
            setTippen("");
          }}
          style={{ display: "flex", gap: 6 }}
        >
          <label className="sr-only" htmlFor="station-tippen">Befehl tippen</label>
          <input id="station-tippen" className="input" value={tippen} onChange={(e) => setTippen(e.target.value)} placeholder="Befehl tippen, z. B. Notiz …" style={{ width: 220 }} disabled={!gestartet} />
        </form>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (lpn.trim()) gescannt(lpn.trim());
            setLpn("");
          }}
          style={{ display: "flex", gap: 6 }}
          data-testid="station-lpn-form"
        >
          <label className="sr-only" htmlFor="station-lpn-eingabe">LPN eingeben</label>
          <input id="station-lpn-eingabe" className="input" value={lpn} onChange={(e) => setLpn(e.target.value)} placeholder="LPN / FNSKU / EAN" style={{ width: 170 }} disabled={!gestartet} autoComplete="off" inputMode="text" data-testid="station-lpn-eingabe" />
          <button className="btn btn-small" type="submit" disabled={!gestartet || !lpn.trim()}>LPN übernehmen</button>
        </form>
      </footer>
    </div>
  );
}
