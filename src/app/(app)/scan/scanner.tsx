"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { aktionAction, belegAction, nachreichenAction, scanAction, type OfflineScan, type ScanErgebnis, type ScanState } from "./actions";

// Scan-Modus (B34.1): Hochformat am Handy. Laden (Regalpreis brutto, Fotos Preisschild/Kassenbon) oder Online
// (Link/ASIN, geteilt aus der Shop-App, „Kauf vorbereiten“). Großes Ziffernfeld, brutto/netto und Rückvergütung
// gemerkt, Ergebnis mit Ampel + Vorlesen, Aktionen je Scan. Ohne Netz: Scan gemerkt, bei Netz nachgeprüft (mit Push).

export type Vorgabe = {
  modus: "laden" | "online" | null;
  code: string;
  preis: string;
  shop: string;
  auto: boolean;
  offen: { id: string; code: string; preis: number; modus: string; shop: string | null; r: Record<string, unknown> } | null;
};
type Summe = { scans: number; gruen: number; gelb: number; rot: number; offen: number; geplant: number; geplantStueck: number; positionen: number };
export type HeuteDaten = {
  summe: Summe;
  budget: { rest: number | null; ampel: "gruen" | "gelb" | "rot" | null; text: string; jeTag: number; gekauftHeute: number };
  kapital: { gruen: number; gelb: number; rot: number; gesamt: number; rotAnteil: number } | null;
  zeilen: { id: string; code: string; asin: string | null; titel: string | null; ampel: string | null; preis: number; netto: boolean; rueckverguetung: number; gewinnStueck: number | null; roi: number | null; roiPa: number | null; aktion: string | null; listeMenge: number | null; listeOrt: string | null; offline: boolean; fehler: string | null; modus: string; belege: number; uhr: string }[];
};

const KEY_EINST = "scan-einstellungen";
const KEY_QUEUE = "scan-warteschlange";
type Einst = { modus: "laden" | "online"; netto: boolean; rv: string; vorlesen: boolean; ort: string };
const STANDARD: Einst = { modus: "laden", netto: false, rv: "", vorlesen: true, ort: "" };
function lesen<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? ({ ...d, ...JSON.parse(v) } as T) : d;
  } catch {
    return d;
  }
}
function schreiben(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}
const queueLesen = (): OfflineScan[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY_QUEUE) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const sprechen = (t: string) => {
  try {
    const u = new SpeechSynthesisUtterance(t);
    u.lang = "de-DE";
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch {}
};
const eur = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${n.toFixed(2).replace(".", ",")} €`);
const FARBE: Record<string, string> = { gruen: "var(--ok)", gelb: "var(--warn)", rot: "var(--danger)" };
const TEXT: Record<string, string> = { gruen: "GRÜN", gelb: "GELB", rot: "ROT" };
const PUNKT: Record<string, string> = { gruen: "🟢", gelb: "🟡", rot: "🔴" };
const AKTION: Record<string, string> = { einkaufsliste: "Einkaufsliste", deal: "Deal gespeichert", verworfen: "verworfen", kauf_vorbereitet: "Kauf vorbereitet", gekauft: "gekauft" };
const TASTEN = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "⌫"];

export function Scanner({ vorgabe, heute }: { vorgabe: Vorgabe; heute: HeuteDaten }) {
  const router = useRouter();
  const [einst, setEinst] = useState<Einst>(STANDARD);
  const [geladen, setGeladen] = useState(false);
  const [code, setCode] = useState(vorgabe.code || vorgabe.offen?.code || "");
  const [preis, setPreis] = useState(vorgabe.preis);
  const [menge, setMenge] = useState("");
  const [shop, setShop] = useState(vorgabe.shop || vorgabe.offen?.shop || "");
  const [state, setState] = useState<ScanState>(vorgabe.offen ? { ok: true, id: vorgabe.offen.id, code: vorgabe.offen.code, preis: vorgabe.offen.preis, modus: vorgabe.offen.modus === "online" ? "online" : "laden", shop: vorgabe.offen.shop, r: vorgabe.offen.r as unknown as ScanErgebnis } : null);
  const [pending, start] = useTransition();
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);
  const [queue, setQueue] = useState<OfflineScan[]>([]);
  const [kamera, setKamera] = useState(false);
  const [liste, setListe] = useState({ menge: "", preis: "", ort: "" });
  const video = useRef<HTMLVideoElement>(null);
  const autoLief = useRef(false);

  const set = useCallback((p: Partial<Einst>) => {
    setEinst((alt) => {
      const neu = { ...alt, ...p };
      schreiben(KEY_EINST, neu);
      return neu;
    });
  }, []);

  // Gemerkte Einstellungen (brutto/netto, Rückvergütung, Modus, Vorlesen, letzter Ort) und Warteschlange laden.
  useEffect(() => {
    const e = lesen(KEY_EINST, STANDARD);
    setEinst(vorgabe.modus ? { ...e, modus: vorgabe.modus } : e);
    setQueue(queueLesen());
    setGeladen(true);
  }, [vorgabe.modus]);

  const pruefen = useCallback(
    (o: { code: string; preis: string; menge: string; shop: string; e: Einst }) => {
      setMeldung(null);
      const fd = new FormData();
      fd.set("code", o.code.trim());
      fd.set("preis", o.preis);
      fd.set("menge", o.menge);
      fd.set("modus", o.e.modus);
      fd.set("shop", o.e.modus === "online" ? o.shop : "");
      fd.set("netto", o.e.netto ? "1" : "");
      fd.set("rueckverguetung", o.e.rv);
      const merken = () => {
        const neu = [...queueLesen(), { code: o.code.trim(), preis: o.preis, netto: o.e.netto, rueckverguetung: o.e.rv, menge: o.menge, modus: o.e.modus, shop: o.shop, zeit: Date.now() }].slice(-30);
        schreiben(KEY_QUEUE, neu);
        setQueue(neu);
        setMeldung({ ok: false, text: "Kein Netz – Scan gemerkt. Wird geprüft, sobald wieder Netz da ist (mit Push)." });
      };
      if (typeof navigator !== "undefined" && navigator.onLine === false) return merken();
      start(async () => {
        try {
          const r = await scanAction(null, fd);
          setState(r);
          if (r?.ok) {
            setListe({ menge: String(r.r.empfohlene_menge ?? (o.menge || "")), preis: r.r.ek_effektiv ? String(r.r.ek_effektiv).replace(".", ",") : "", ort: o.e.modus === "laden" ? o.e.ort : "" });
            if (o.e.vorlesen) sprechen(r.r.vorlesen);
          }
        } catch {
          // Netz weg während der Anfrage (Funkloch im Laden) → merken statt verlieren.
          merken();
        }
      });
    },
    [],
  );

  // Geteilt aus der Shop-/Amazon-App: einmal automatisch prüfen.
  useEffect(() => {
    if (!geladen || autoLief.current || !vorgabe.auto || !vorgabe.code) return;
    autoLief.current = true;
    pruefen({ code: vorgabe.code, preis: vorgabe.preis, menge: "", shop: vorgabe.shop, e: { ...einst, modus: vorgabe.modus ?? einst.modus } });
  }, [geladen, vorgabe, einst, pruefen]);

  // Netz wieder da (bzw. Seite geöffnet mit gemerkten Scans): nachreichen, Push je Scan kommt vom Server.
  const nachreichen = useCallback(() => {
    const q = queueLesen();
    if (!q.length || navigator.onLine === false) return;
    start(async () => {
      try {
        const r = await nachreichenAction(q);
        schreiben(KEY_QUEUE, []);
        setQueue([]);
        setMeldung({ ok: r.fehler.length === 0, text: `Offline-Scans nachgeprüft: ${r.geprueft} geprüft${r.offen ? `, ${r.offen} noch offen` : ""}${r.fehler.length ? ` · ${r.fehler.join(" · ")}` : ""}.` });
        router.refresh();
      } catch {
        // weiter kein Netz – beim nächsten „online“ erneut
      }
    });
  }, [router]);
  useEffect(() => {
    if (!geladen) return;
    nachreichen();
    window.addEventListener("online", nachreichen);
    return () => window.removeEventListener("online", nachreichen);
  }, [geladen, nachreichen]);

  // Kamera: BarcodeDetector (Chrome/Android, neuere iOS), sonst ZXing (läuft in jedem Browser mit Kamera).
  useEffect(() => {
    if (!kamera) return;
    let stop = false;
    let stream: MediaStream | null = null;
    let zxingStop: (() => void) | null = null;
    const treffer = (wert: string) => {
      setCode(wert);
      setKamera(false);
      try {
        navigator.vibrate?.(80);
      } catch {}
    };
    const BD = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    (async () => {
      if (!video.current) return;
      if (BD) {
        const det = new BD({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        video.current.srcObject = stream;
        await video.current.play();
        while (!stop) {
          const r = await det.detect(video.current).catch(() => []);
          if (r[0]?.rawValue) return treffer(r[0].rawValue);
          await new Promise((x) => setTimeout(x, 200));
        }
        return;
      }
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      const ctl = await reader.decodeFromConstraints({ video: { facingMode: "environment" } }, video.current, (res, _err, c) => {
        if (res && !stop) {
          c.stop();
          treffer(res.getText());
        }
      });
      zxingStop = () => ctl.stop();
      if (stop) ctl.stop();
    })().catch(() => {
      setKamera(false);
      setMeldung({ ok: false, text: "Kamera nicht verfügbar – bitte eingeben oder Handscanner nutzen." });
    });
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
      zxingStop?.();
    };
  }, [kamera]);

  const taste = (t: string) => {
    setPreis((p) => {
      if (t === "⌫") return p.slice(0, -1);
      if (t === ",") return p.includes(",") ? p : `${p || "0"},`;
      if (/,\d{2}$/.test(p) || p.replace(",", "").length >= 7) return p;
      return p === "0" ? t : p + t;
    });
  };

  const aktion = (a: "einkaufsliste" | "deal" | "verworfen" | "kauf_vorbereitet" | "gekauft", id: string) => {
    const neuerTab = a === "kauf_vorbereitet" ? window.open("about:blank", "_blank") : null;
    start(async () => {
      try {
        const r = await aktionAction(id, a, { menge: Number(liste.menge) || null, preis: liste.preis || null, ort: liste.ort || null });
        setMeldung({ ok: r.ok, text: r.text });
        if (r.ok && a === "einkaufsliste" && liste.ort) set({ ort: liste.ort });
        if (r.ok && "url" in r && r.url) {
          if (neuerTab) neuerTab.location.href = r.url;
          else window.location.href = r.url;
        } else neuerTab?.close();
        if (r.ok && (a === "verworfen" || a === "einkaufsliste")) {
          setState(null);
          setCode("");
          setPreis("");
          setMenge("");
        }
        router.refresh();
      } catch {
        neuerTab?.close();
        setMeldung({ ok: false, text: "Kein Netz – bitte gleich noch einmal tippen." });
      }
    });
  };

  const foto = (art: "preisschild" | "kassenbon", id: string, f: File | undefined) => {
    if (!f) return;
    const fd = new FormData();
    fd.set("id", id);
    fd.set("art", art);
    fd.set("datei", f);
    start(async () => {
      try {
        setMeldung(await belegAction(fd));
        router.refresh();
      } catch {
        setMeldung({ ok: false, text: "Foto nicht hochgeladen – kein Netz?" });
      }
    });
  };

  const r = state?.ok ? state.r : null;
  const online = einst.modus === "online";

  return (
    <div className="stack" style={{ gap: 12, maxWidth: 560 }} data-testid="scan-modus" data-modus={einst.modus}>
      <div className="row" style={{ gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
        <div className="row" role="tablist" aria-label="Modus" style={{ gap: 4 }}>
          {(["laden", "online"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={einst.modus === m} className={`btn ${einst.modus === m ? "btn-primary" : ""}`} onClick={() => set({ modus: m })} data-testid={`modus-${m}`}>
              {m === "laden" ? "🏬 Laden" : "🌐 Online"}
            </button>
          ))}
        </div>
        <label className="small"><input type="checkbox" checked={einst.vorlesen} onChange={(e) => set({ vorlesen: e.target.checked })} data-testid="vorlesen" /> 🔊 Vorlesen</label>
      </div>

      {queue.length > 0 && (
        <div className="notice notice-warn row" style={{ justifyContent: "space-between", gap: 8 }} data-testid="scan-warteschlange">
          <span>{queue.length} Scan{queue.length === 1 ? "" : "s"} ohne Netz gemerkt.</span>
          <button type="button" className="btn btn-small" onClick={nachreichen} disabled={pending}>Jetzt prüfen</button>
        </div>
      )}

      <form
        className="card card-pad stack"
        style={{ gap: 10 }}
        data-testid="scan-form"
        onSubmit={(e) => {
          e.preventDefault();
          pruefen({ code, preis, menge, shop, e: einst });
        }}
      >
        <div className="row" style={{ gap: 8 }}>
          <input className="input" name="code" value={code} onChange={(e) => setCode(e.target.value)} inputMode={online ? "url" : "numeric"} placeholder={online ? "ASIN oder Amazon-Link" : "EAN scannen / eingeben"} aria-label="EAN, ASIN oder Link" style={{ flexGrow: 1, minWidth: 0, fontSize: 20 }} autoComplete="off" />
          <button type="button" className="btn" onClick={() => setKamera((k) => !k)} aria-label="Kamera">📷</button>
        </div>
        {kamera && <video ref={video} playsInline muted style={{ width: "100%", maxHeight: 260, background: "#000", borderRadius: 8 }} />}
        {online && <input className="input" name="shop" value={shop} onChange={(e) => setShop(e.target.value)} inputMode="url" placeholder="Shop-Link (aus der Shop-App teilen)" aria-label="Shop-Link" autoComplete="off" />}

        <div className="row" style={{ gap: 8, alignItems: "stretch" }}>
          <input className="input" name="preis" value={preis} onChange={(e) => setPreis(e.target.value.replace(/[^\d,.]/g, ""))} inputMode="none" placeholder={online ? "Preis € (leer = Amazon-Preis)" : "Regalpreis €"} aria-label="Preis" style={{ flexGrow: 1, minWidth: 0, fontSize: 30, fontWeight: 700, textAlign: "right" }} data-testid="scan-preis" />
          <div className="stack" style={{ gap: 4 }}>
            <button type="button" className={`btn btn-small ${!einst.netto ? "btn-primary" : ""}`} onClick={() => set({ netto: false })} aria-pressed={!einst.netto} data-testid="brutto">brutto</button>
            <button type="button" className={`btn btn-small ${einst.netto ? "btn-primary" : ""}`} onClick={() => set({ netto: true })} aria-pressed={einst.netto} data-testid="netto">netto</button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }} aria-label="Ziffernfeld">
          {TASTEN.map((t) => (
            <button key={t} type="button" className="btn" style={{ fontSize: 26, minHeight: 56 }} onClick={() => taste(t)} aria-label={t === "⌫" ? "löschen" : t}>{t}</button>
          ))}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <label className="small stack" style={{ gap: 2, flex: "1 1 120px" }}>Rückvergütung %
            <input className="input" name="rueckverguetung" value={einst.rv} onChange={(e) => set({ rv: e.target.value.replace(/[^\d,.]/g, "").slice(0, 5) })} inputMode="decimal" placeholder="0" data-testid="scan-rv" />
          </label>
          <label className="small stack" style={{ gap: 2, flex: "1 1 100px" }}>Menge (optional)
            <input className="input" name="menge" value={menge} onChange={(e) => setMenge(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="–" />
          </label>
        </div>
        <button className="btn btn-primary" type="submit" disabled={pending || !code.trim()} style={{ fontSize: 20, minHeight: 52 }} data-testid="scan-pruefen">{pending ? "Prüfe …" : "Prüfen"}</button>
      </form>

      {meldung && <div className={`notice ${meldung.ok ? "notice-ok" : "notice-warn"}`} role="status" data-testid="scan-meldung">{meldung.text}</div>}
      {state && !state.ok && <div className="notice notice-warn" role="status" data-testid="scan-fehler">{state.fehler}</div>}

      {state?.ok && r && (
        <section className="card card-pad stack" style={{ gap: 6, borderLeft: `8px solid ${FARBE[r.ampel]}` }} data-testid="scan-ergebnis" data-ampel={r.ampel} data-id={state.id}>
          <div style={{ fontSize: 34, fontWeight: 800, color: FARBE[r.ampel] }}>{TEXT[r.ampel]}{r.land ? ` · ${r.land}` : ""}</div>
          <div style={{ fontSize: 20 }} data-testid="scan-zahlen">
            {r.gewinn_stueck !== null ? `${eur(r.gewinn_stueck)} / Stück` : "–"}
            {r.roi !== null ? ` · ROI ${Math.round(r.roi)} %` : ""}
            {r.roi_pa !== null && r.roi_pa !== undefined ? ` · p. a. ${r.roi_pa} %` : ""}
          </div>
          <div className="small">
            {r.empfohlene_menge ? <strong>nimm {r.empfohlene_menge}</strong> : "Menge: keine Empfehlung"}
            {r.umschlag ? ` · Umschlag ${r.umschlag}` : ""}
            {r.rueckverguetung ? <span data-testid="scan-ek"> · EK nach {String(r.rueckverguetung).replace(".", ",")} % Rückvergütung {eur(r.ek_effektiv)}</span> : null}
          </div>
          <div className="small muted">
            {r.titel ?? r.asin} · {r.angebote ?? "?"} Angebote{r.amazon_anteil !== null ? ` · Amazon ${Math.round(r.amazon_anteil)} %` : ""}
          </div>
          {(r.eigener_bestand || r.kapital_ampel) && (
            <div className="small" data-testid="scan-bestand">
              {r.eigener_bestand ? `Eigener Bestand ${r.eigener_bestand.bestand}${r.eigener_bestand.unterwegs ? ` (+${r.eigener_bestand.unterwegs} unterwegs)` : ""}. ` : ""}
              {r.kapital_ampel?.text ? <span style={{ color: FARBE[r.kapital_ampel.ampel] }}>{r.kapital_ampel.text}</span> : null}
            </div>
          )}
          <div data-testid="scan-begruendung"><strong>{r.begruendung_kurz ?? r.begruendung}</strong></div>
          {r.hinweise.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{r.hinweise.map((h, i) => <li key={i}>{h}</li>)}</ul>}
          <div><button type="button" className="btn btn-small" onClick={() => sprechen(r.vorlesen)}>🔊 Vorlesen</button> <span className="small muted" data-testid="scan-vorlesen">{r.vorlesen}</span></div>

          <div className="stack" style={{ gap: 6, borderTop: "1px solid var(--line)", paddingTop: 8, marginTop: 4 }} data-testid="scan-aktionen">
            <div className="row" style={{ gap: 6 }}>
              <input className="input" value={liste.menge} onChange={(e) => setListe({ ...liste, menge: e.target.value.replace(/\D/g, "") })} inputMode="numeric" placeholder="Menge" aria-label="Menge für die Liste" style={{ width: 80 }} />
              <input className="input" value={liste.preis} onChange={(e) => setListe({ ...liste, preis: e.target.value })} inputMode="decimal" placeholder="Preis €" aria-label="Preis für die Liste" style={{ width: 100 }} />
              <input className="input" value={liste.ort} onChange={(e) => setListe({ ...liste, ort: e.target.value })} placeholder={online ? "Shop" : "Laden / Filiale"} aria-label="Shop oder Ort" style={{ flexGrow: 1, minWidth: 0 }} />
            </div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-primary" disabled={pending} onClick={() => aktion("einkaufsliste", state.id)} data-testid="aktion-einkaufsliste">🛒 In Einkaufsliste</button>
              <button type="button" className="btn" disabled={pending} onClick={() => aktion("deal", state.id)} data-testid="aktion-deal">💾 Als Deal speichern</button>
              {online && <button type="button" className="btn" disabled={pending} onClick={() => aktion("kauf_vorbereitet", state.id)} data-testid="aktion-kauf">🛍 Kauf vorbereiten</button>}
              <button type="button" className="btn" disabled={pending} onClick={() => aktion("verworfen", state.id)} data-testid="aktion-verwerfen">✕ Verwerfen</button>
            </div>
            {!online && (
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <label className="btn btn-small">📷 Preisschild<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => foto("preisschild", state.id, e.target.files?.[0])} data-testid="foto-preisschild" /></label>
                <label className="btn btn-small">🧾 Kassenbon<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => foto("kassenbon", state.id, e.target.files?.[0])} data-testid="foto-kassenbon" /></label>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="card card-pad small stack" style={{ gap: 6 }} data-testid="scan-heute">
        <div className="between"><strong>Heute gescannt ({heute.summe.scans})</strong><span>{PUNKT.gruen} {heute.summe.gruen} · {PUNKT.gelb} {heute.summe.gelb} · {PUNKT.rot} {heute.summe.rot}{heute.summe.offen ? ` · ⏳ ${heute.summe.offen}` : ""}</span></div>
        <div data-testid="scan-summe">
          Geplant: <strong>{eur(heute.summe.geplant)}</strong> ({heute.summe.geplantStueck} Stück, {heute.summe.positionen} Positionen)
          {" · "}
          <span style={{ color: heute.budget.ampel ? FARBE[heute.budget.ampel] : undefined }}>{heute.budget.text}</span>
        </div>
        {heute.kapital && (
          <div className="muted" data-testid="scan-kapital">
            Kapital im Bestand {eur(heute.kapital.gesamt)} – davon {heute.kapital.rotAnteil} % mit Kapital-Ampel rot{heute.kapital.rotAnteil >= 30 ? " → erst abverkaufen, dann nachkaufen" : ""}.
          </div>
        )}
        {heute.zeilen.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
            {heute.zeilen.map((z) => (
              <li key={z.id} className="row" style={{ gap: 6, padding: "4px 0", borderTop: "1px solid var(--line)", alignItems: "baseline" }} data-testid="scan-zeile" data-id={z.id} data-ampel={z.ampel ?? ""} data-aktion={z.aktion ?? ""}>
                <span>{z.ampel ? PUNKT[z.ampel] : "⏳"}</span>
                <span style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{z.titel ?? z.asin ?? z.code}</span>
                <span>{eur(z.preis)}{z.netto ? " n" : ""}</span>
                <span className="muted">{z.uhr}{z.offline ? " · offline" : ""}{z.aktion ? ` · ${AKTION[z.aktion] ?? z.aktion}${z.listeMenge ? ` ${z.listeMenge}×` : ""}` : ""}{z.belege ? ` · 📎${z.belege}` : ""}{z.fehler && !z.ampel ? " · Prüfung offen" : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
