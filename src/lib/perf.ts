// Messung der Server-Auslastung: Wie lange mussten Seitenaufrufe auf den Server warten (Event-Loop-
// Verzögerung) – und welcher Hintergrund-Abruf lief gerade? Nur im Speicher dieses Prozesses, die letzten
// 60 Minuten. So lässt sich „das Tool ist langsam“ einer Ursache zuordnen.

import { monitorEventLoopDelay } from "node:perf_hooks";

type IntervalHistogram = ReturnType<typeof monitorEventLoopDelay>;

type Minute = { at: number; maxMs: number; p99Ms: number; jobs: string[] };

const g = globalThis as unknown as { __perf?: { h: IntervalHistogram; minutes: Minute[]; running: Map<string, number>; seen: Set<string>; timer: NodeJS.Timeout } };

/** Einmal je Prozess starten (instrumentation.ts). */
export function startPerfMonitor() {
  if (g.__perf) return;
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();
  const state = { h, minutes: [] as Minute[], running: new Map<string, number>(), seen: new Set<string>(), timer: undefined as unknown as NodeJS.Timeout };
  state.timer = setInterval(() => {
    const ms = (ns: number) => Math.round(ns / 1e6);
    state.minutes.push({ at: Date.now(), maxMs: ms(h.max), p99Ms: ms(h.percentile(99)), jobs: [...new Set([...state.seen, ...state.running.keys()])] });
    if (state.minutes.length > 60) state.minutes.shift();
    state.seen.clear();
    h.reset();
  }, 60_000);
  state.timer.unref?.();
  g.__perf = state;
}

/** Hintergrund-Abruf beginnt/endet – für die Zuordnung „was lief, als es hakte“. */
export function jobStarted(name: string) {
  g.__perf?.running.set(name, Date.now());
  g.__perf?.seen.add(name);
}
export function jobEnded(name: string) {
  g.__perf?.running.delete(name);
}

export type PerfSnapshot = { minutes: Minute[]; worst: Minute | null; slowMinutes: number; running: string[] } | null;

/** Letzte Stunde: Minuten mit spürbarer Verzögerung (> 250 ms) und die schlimmste Minute. */
export function perfSnapshot(): PerfSnapshot {
  const p = g.__perf;
  if (!p) return null;
  const worst = p.minutes.reduce<Minute | null>((w, m) => (!w || m.maxMs > w.maxMs ? m : w), null);
  return { minutes: p.minutes, worst, slowMinutes: p.minutes.filter((m) => m.maxMs > 250).length, running: [...p.running.keys()] };
}

/** Rein: „spürbar“ ab 250 ms, „deutlich“ ab 1 s Wartezeit. */
export function lagLevel(ms: number): "ok" | "spuerbar" | "deutlich" {
  return ms >= 1000 ? "deutlich" : ms > 250 ? "spuerbar" : "ok";
}
