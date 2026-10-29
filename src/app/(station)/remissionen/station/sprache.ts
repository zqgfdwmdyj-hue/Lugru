"use client";

// Sprache an der Station: Erkennung hinter einer eigenen Schnittstelle (SpeechInput), damit später eine
// Server-Transkription eingesetzt werden kann, falls die Browser-Erkennung im Lager zu unzuverlässig ist.
// Dazu Sprachausgabe (de-DE) und kurze Töne.

export type SpeechStatus = "aus" | "hoert" | "fehler" | "nicht_verfuegbar";

export interface SpeechInput {
  readonly verfuegbar: boolean;
  start(onText: (text: string, final: boolean) => void, onStatus: (s: SpeechStatus, info?: string) => void): void;
  stop(): void;
  /** Während eigener Ansagen nichts auswerten (sonst hört die Station sich selbst). */
  pause(ms: number): void;
}

type Rec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

/** Web Speech API in Chrome (webkitSpeechRecognition), dauerhaft an, startet nach Pausen selbst neu. */
export class WebSpeechInput implements SpeechInput {
  private rec: Rec | null = null;
  private aktiv = false;
  private stummBis = 0;
  readonly verfuegbar: boolean;

  constructor() {
    const w = typeof window !== "undefined" ? (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }) : {};
    this.verfuegbar = Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
  }

  start(onText: (text: string, final: boolean) => void, onStatus: (s: SpeechStatus, info?: string) => void) {
    if (!this.verfuegbar) return onStatus("nicht_verfuegbar");
    const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const R = (w.SpeechRecognition || w.webkitSpeechRecognition)!;
    this.aktiv = true;
    const neu = () => {
      const r = new R();
      r.lang = "de-DE";
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;
      r.onresult = (e) => {
        if (Date.now() < this.stummBis) return;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          onText(res[0].transcript, res.isFinal);
        }
      };
      r.onerror = (e) => {
        if (e.error === "no-speech" || e.error === "aborted") return;
        onStatus("fehler", e.error === "not-allowed" ? "Mikrofon nicht erlaubt" : e.error === "network" ? "Spracherkennung ohne Netz" : e.error);
      };
      // Chrome beendet die Erkennung nach Stille oder Netzfehlern – solange die Station läuft, neu starten.
      r.onend = () => {
        if (this.aktiv) setTimeout(() => this.aktiv && this.rec === r && tryStart(), 300);
        else onStatus("aus");
      };
      this.rec = r;
      return r;
    };
    const tryStart = () => {
      try {
        neu().start();
        onStatus("hoert");
      } catch {
        setTimeout(() => this.aktiv && tryStart(), 1000);
      }
    };
    tryStart();
  }

  stop() {
    this.aktiv = false;
    try {
      this.rec?.abort();
    } catch {
      /* schon gestoppt */
    }
    this.rec = null;
  }

  pause(ms: number) {
    this.stummBis = Math.max(this.stummBis, Date.now() + ms);
  }
}

let stimme: SpeechSynthesisVoice | null = null;

/** Kurze Ansage auf Deutsch. Liefert die Dauer-Schätzung (ms), damit die Erkennung so lange pausiert. */
export function sprechen(text: string, eingabe?: SpeechInput | null): number {
  if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) return 0;
  const s = window.speechSynthesis;
  if (!stimme) stimme = s.getVoices().find((v) => v.lang?.toLowerCase().startsWith("de")) ?? null;
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "de-DE";
  if (stimme) u.voice = stimme;
  u.rate = 1.1;
  const dauer = 600 + text.length * 70;
  eingabe?.pause(dauer);
  u.onend = () => eingabe?.pause(300);
  s.speak(u);
  return dauer;
}

let audio: AudioContext | null = null;

/** Ton: ok = kurz hoch, warnung = mittel doppelt, fehler = tief. */
export function ton(art: "ok" | "warnung" | "fehler") {
  try {
    audio ??= new AudioContext();
    const plan: [number, number][] = art === "ok" ? [[880, 0.08]] : art === "warnung" ? [[660, 0.1], [660, 0.1]] : [[220, 0.25]];
    let t = audio.currentTime;
    for (const [f, d] of plan) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + d);
      t += d + 0.06;
    }
  } catch {
    /* ohne Audio weiter */
  }
}
