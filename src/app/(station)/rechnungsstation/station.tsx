"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AUSLOESER_START, ausloeserSchritt, bewegung, blattFinden, eckenSkalieren, entzerren, graustufen, zielGroesse, type AusloeserZustand, type Punkt } from "@/lib/rechnungsstation/logic";
import { ton } from "../remissionen/station/sprache";

// Rechnungsstation: Livebild, Blatt liegt still und Ränder sind erkannt → automatisch auslösen, entzerren, hochladen,
// Ton „ok“ → nächstes Blatt. Kein Klick je Beleg. Fußtaster/Handzeichen optional: Leertaste, Enter, Bild↓ oder → löst
// von Hand aus. Kacheln am Rand zeigen je Beleg Lieferant, Betrag, Datum und die Ampel.

type Kachel = { id: string; ampel: "gruen" | "gelb" | "rot" | null; lieferant: string | null; betrag: number | null; datum: string | null; nummer: string | null; seiten: number; gruende: string[]; zuordnung: string | null; status: string };
type Stand = { stapel: { id: string; name: string; beendet: boolean }; belege: Kachel[]; summe: { n: number; summe: number; unklar: number; gelb: number }; zugeordnet: number };
type Upload = { bild: Blob; original: Blob | null; aufgenommen: number };

const W = 160, H = 120;
const eur = (n: number | null) => (n === null ? "–" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
const FARBE: Record<string, string> = { gruen: "#16a34a", gelb: "#d97706", rot: "#dc2626" };

declare global {
  interface Window {
    /** Für die automatischen Prüfungen: Blatt (Bilddatei) direkt einspeisen bzw. ein Analysebild prüfen. */
    __rechnungsstation?: { blatt: (b64: string, typ: string, aufgenommen?: number) => Promise<void>; analyse: (rgba: number[], w: number, h: number, jetzt: number) => { blatt: boolean; ausloesen: boolean }; offen: () => number };
  }
}

export function RechnungsStation({ nurAnsehen, ordner }: { nurAnsehen: boolean; ordner: boolean }) {
  const [stand, setStand] = useState<Stand | null>(null);
  const [kamera, setKamera] = useState<"aus" | "an" | "fehler">("aus");
  const [info, setInfo] = useState("Station starten: einmal tippen – danach Blätter einfach nacheinander auflegen.");
  const [erkennung, setErkennung] = useState<"leer" | "blatt" | "still" | "aufgenommen">("leer");
  const [ecken, setEcken] = useState<Punkt[] | null>(null);
  const [auto, setAuto] = useState(true);
  const [offen, setOffen] = useState(0);
  const [blitz, setBlitz] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const kleinRef = useRef<HTMLCanvasElement | null>(null);
  const vorherRef = useRef<Uint8Array | null>(null);
  const letztesRef = useRef<Uint8Array | null>(null);
  const zustandRef = useRef<AusloeserZustand>(AUSLOESER_START);
  const eckenRef = useRef<Punkt[] | null>(null);
  const schlangeRef = useRef<Upload[]>([]);
  const laeuftRef = useRef(false);
  const stapelRef = useRef<string | null>(null);
  const autoRef = useRef(true);

  useEffect(() => {
    autoRef.current = auto;
  }, [auto]);

  const laden = useCallback(async () => {
    const id = stapelRef.current;
    if (!id) return;
    const r = await fetch(`/api/rechnungsstation?stapel=${id}`, { cache: "no-store" }).catch(() => null);
    if (r?.ok) setStand((await r.json()) as Stand);
  }, []);

  // ---- Hochladen der Reihe nach (bei Netzfehler erneut) ------------------------------------------------
  const abarbeiten = useCallback(async () => {
    if (laeuftRef.current) return;
    laeuftRef.current = true;
    try {
      while (schlangeRef.current.length && stapelRef.current) {
        const u = schlangeRef.current[0];
        const fd = new FormData();
        fd.set("stapel", stapelRef.current);
        fd.set("bild", u.bild, u.bild.type === "image/png" ? "blatt.png" : "blatt.jpg");
        if (u.original) fd.set("original", u.original, "original.jpg");
        fd.set("aufgenommen", String(u.aufgenommen));
        const r = await fetch("/api/rechnungsstation", { method: "POST", body: fd }).catch(() => null);
        if (!r) {
          setInfo("Netz weg – das Blatt wird gleich erneut gesendet.");
          await new Promise((res) => setTimeout(res, 3000));
          continue;
        }
        const j = (await r.json().catch(() => ({}))) as { fehler?: string; duplikat?: boolean };
        schlangeRef.current.shift();
        setOffen(schlangeRef.current.length);
        if (!r.ok) {
          ton("fehler");
          setInfo(j.fehler ?? "Fehler beim Speichern – bitte noch einmal auflegen.");
        } else {
          ton(j.duplikat ? "warnung" : "ok");
          setInfo(j.duplikat ? "Dieses Bild war schon da – nächstes Blatt." : "Erfasst – nächstes Blatt.");
        }
        void laden();
      }
    } finally {
      laeuftRef.current = false;
    }
  }, [laden]);

  const einreihen = useCallback((u: Upload) => {
    schlangeRef.current.push(u);
    setOffen(schlangeRef.current.length);
    void abarbeiten();
  }, [abarbeiten]);

  // ---- Aufnahme: volles Bild, entzerren, als JPEG ---------------------------------------------------------
  const aufnehmen = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return setInfo("Kamera nicht bereit.");
    const voll = document.createElement("canvas");
    voll.width = v.videoWidth;
    voll.height = v.videoHeight;
    const ctx = voll.getContext("2d")!;
    ctx.drawImage(v, 0, 0);
    setBlitz(true);
    setTimeout(() => setBlitz(false), 120);
    setErkennung("aufgenommen");
    const original = await new Promise<Blob | null>((r) => voll.toBlob(r, "image/jpeg", 0.92));
    let bild: Blob | null = original;
    const e = eckenRef.current;
    if (e) {
      try {
        const f = voll.width / W;
        const q = eckenSkalieren(e, f);
        const ziel = zielGroesse(q, 2200);
        const daten = ctx.getImageData(0, 0, voll.width, voll.height);
        const px = entzerren({ daten: daten.data, w: voll.width, h: voll.height }, q, ziel);
        const c = document.createElement("canvas");
        c.width = ziel.w;
        c.height = ziel.h;
        c.getContext("2d")!.putImageData(new ImageData(px, ziel.w, ziel.h), 0, 0);
        bild = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.88));
      } catch {
        bild = original;
      }
    }
    if (!bild) return setInfo("Foto fehlgeschlagen.");
    einreihen({ bild, original: e ? original : null, aufgenommen: Date.now() });
  }, [einreihen]);

  // ---- Bildanalyse: Blatt, Bewegung, Auslöser ----------------------------------------------------------
  const analyse = useCallback((rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, jetzt: number) => {
    const g = graustufen(rgba, w, h);
    const b = blattFinden(g, w, h);
    const bew = vorherRef.current ? bewegung(g, vorherRef.current) : 255;
    vorherRef.current = g;
    const abstand = letztesRef.current ? bewegung(g, letztesRef.current) : null;
    const r = ausloeserSchritt(zustandRef.current, { bewegung: bew, blatt: Boolean(b), abstandZumLetzten: abstand }, jetzt);
    zustandRef.current = r.zustand;
    eckenRef.current = b?.ecken ?? null;
    if (r.ausloesen) letztesRef.current = g;
    return { blatt: Boolean(b), ausloesen: r.ausloesen, ecken: b?.ecken ?? null, still: r.zustand.stillSeit !== null };
  }, []);

  useEffect(() => {
    if (kamera !== "an") return;
    const t = setInterval(() => {
      const v = videoRef.current;
      if (!v || !v.videoWidth || document.hidden) return;
      kleinRef.current ??= Object.assign(document.createElement("canvas"), { width: W, height: H });
      const ctx = kleinRef.current.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(v, 0, 0, W, H);
      const r = analyse(ctx.getImageData(0, 0, W, H).data, W, H, Date.now());
      setEcken(r.ecken);
      setErkennung((alt) => (alt === "aufgenommen" && r.blatt && !r.ausloesen && zustandRef.current.bereit === false ? alt : r.blatt ? (r.still ? "still" : "blatt") : "leer"));
      if (r.ausloesen && autoRef.current && !nurAnsehen) void aufnehmen();
    }, 200);
    return () => clearInterval(t);
  }, [kamera, analyse, aufnehmen, nurAnsehen]);

  // Stand regelmäßig laden (Kacheln werden gelb/grün/rot, sobald die KI gelesen hat)
  useEffect(() => {
    if (!stand) return;
    const t = setInterval(() => void laden(), 2000);
    return () => clearInterval(t);
  }, [stand, laden]);

  // Fußtaster / Tastatur: Leertaste, Enter, Bild↓, → = von Hand auslösen
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (!stapelRef.current || nurAnsehen || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if ([" ", "Enter", "PageDown", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        void aufnehmen();
      }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [aufnehmen, nurAnsehen]);

  // Prüf-Hilfe (automatische Prüfungen): Blatt direkt einspeisen, Analyse eines Bildes
  useEffect(() => {
    window.__rechnungsstation = {
      blatt: async (b64, typ, aufgenommen) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        einreihen({ bild: new Blob([bytes], { type: typ }), original: null, aufgenommen: aufgenommen ?? Date.now() });
        while (schlangeRef.current.length || laeuftRef.current) await new Promise((r) => setTimeout(r, 30));
      },
      analyse: (rgba, w, h, jetzt) => {
        const r = analyse(Uint8ClampedArray.from(rgba), w, h, jetzt);
        return { blatt: r.blatt, ausloesen: r.ausloesen };
      },
      offen: () => schlangeRef.current.length,
    };
    return () => {
      delete window.__rechnungsstation;
    };
  }, [einreihen, analyse]);

  const starten = useCallback(async (neu = false) => {
    const r = await fetch(`/api/rechnungsstation?aktion=start${neu ? "&neu=1" : ""}`, { method: "POST" }).catch(() => null);
    if (!r?.ok) return setInfo("Station konnte nicht starten – bitte neu laden.");
    const st = (await r.json()) as Stand;
    stapelRef.current = st.stapel.id;
    setStand(st);
    setInfo("Blatt auf die Ablage legen – die Kamera löst aus, sobald es still liegt.");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setKamera("an");
    } catch {
      setKamera("fehler");
      setInfo("Keine Kamera – Belege können trotzdem über den Scanner-Ordner oder „PDF-Stapel hochladen“ (Prüfliste) kommen.");
    }
  }, []);

  const beenden = useCallback(async () => {
    const id = stapelRef.current;
    if (!id) return;
    setInfo("Stapel wird abgeschlossen …");
    while (schlangeRef.current.length || laeuftRef.current) await new Promise((r) => setTimeout(r, 100));
    const r = await fetch(`/api/rechnungsstation?aktion=ende&stapel=${id}`, { method: "POST" }).catch(() => null);
    if (r?.ok) {
      const st = (await r.json()) as Stand;
      setStand(st);
      setInfo(`Stapel fertig: ${st.summe.n} Belege, ${eur(st.summe.summe)}, ${st.summe.unklar} unklar – Aufgabe „Rechnungsstapel prüfen“ angelegt.`);
      ton("ok");
    }
  }, []);

  const s = stand?.summe;
  return (
    <div style={{ height: "100dvh", background: "#0b0f14", color: "#f1f5f9", display: "flex", fontFamily: "system-ui, sans-serif", overflow: "hidden" }} data-testid="rechnungsstation">
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", flexWrap: "wrap" }}>
          <Link href="/" style={{ color: "#94a3b8" }}>← Seller-System</Link>
          <strong style={{ fontSize: 18 }}>Rechnungsstation</strong>
          {stand && <span style={{ color: "#94a3b8" }} data-testid="station-stapel">{stand.stapel.name}</span>}
          <span style={{ flexGrow: 1 }} />
          {s && (
            <span data-testid="station-summe">
              {s.n} Belege · {eur(s.summe)} · <span style={{ color: s.unklar ? FARBE.rot : "#94a3b8" }}>{s.unklar} unklar</span> · {stand!.zugeordnet} zugeordnet
            </span>
          )}
          <Link href={stand ? `/rechnungsstation/pruefen?stapel=${stand.stapel.id}` : "/rechnungsstation/pruefen"} style={{ color: "#93c5fd" }} data-testid="station-pruefliste">Prüfliste</Link>
        </div>
        <div style={{ position: "relative", flexGrow: 1, background: "#000", overflow: "hidden" }}>
          <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          {ecken && (
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
              <polygon points={ecken.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={erkennung === "still" ? "#22c55e" : "#facc15"} strokeWidth={0.8} />
            </svg>
          )}
          {blitz && <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,.5)" }} />}
          {!stand && (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
              {nurAnsehen ? (
                <div>Nur ansehen – mit diesem Zugang wird nichts erfasst.</div>
              ) : (
                <button type="button" onClick={() => void starten()} className="btn btn-primary" style={{ fontSize: 22, padding: "16px 28px" }} data-testid="station-starten">Station starten</button>
              )}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", flexWrap: "wrap" }}>
          <span role="status" data-testid="station-info" style={{ flexGrow: 1 }}>{info}</span>
          <span style={{ color: "#94a3b8" }} data-testid="station-erkennung">{erkennung === "leer" ? "Ablage leer" : erkennung === "blatt" ? "Blatt erkannt – stillhalten" : erkennung === "still" ? "liegt still …" : "aufgenommen"}</span>
          {offen > 0 && <span data-testid="station-offen">{offen} wird gesendet</span>}
          {stand && !nurAnsehen && (
            <>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> automatisch</label>
              <button type="button" className="btn" onClick={() => void aufnehmen()} disabled={kamera !== "an"}>Jetzt aufnehmen</button>
              <button type="button" className="btn btn-primary" onClick={() => void beenden()} data-testid="station-fertig">Stapel fertig</button>
              {stand.stapel.beendet && <button type="button" className="btn" onClick={() => void starten(true)}>Neuer Stapel</button>}
            </>
          )}
        </div>
        {ordner && <div style={{ padding: "0 12px 8px", color: "#94a3b8", fontSize: 13 }}>Einzugsscanner: PDF-Stapel einfach in den Scanner-Ordner legen – sie werden automatisch getrennt und erfasst.</div>}
      </div>
      <aside style={{ width: 300, overflowY: "auto", borderLeft: "1px solid #1e293b", padding: 8, display: "flex", flexDirection: "column", gap: 6 }} data-testid="station-kacheln">
        {stand?.belege.map((b) => (
          <div key={b.id} data-testid="station-kachel" data-ampel={b.ampel ?? "liest"} style={{ border: `2px solid ${b.ampel ? FARBE[b.ampel] : "#475569"}`, borderRadius: 8, padding: "6px 8px", background: "#111827" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
              <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.ampel === null ? "liest …" : (b.lieferant ?? "?")}</strong>
              <span>{eur(b.betrag)}</span>
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              {b.datum ? b.datum.split("-").reverse().join(".") : "–"}{b.nummer ? ` · ${b.nummer}` : ""}{b.seiten > 1 ? ` · ${b.seiten} Seiten` : ""} · {b.status}
            </div>
            {b.zuordnung && <div style={{ fontSize: 12, color: "#86efac" }}>→ {b.zuordnung}</div>}
            {b.gruende.length > 0 && <div style={{ fontSize: 12, color: b.ampel === "rot" ? "#fca5a5" : "#fcd34d" }}>{b.gruende.join(", ")}</div>}
          </div>
        ))}
      </aside>
    </div>
  );
}
