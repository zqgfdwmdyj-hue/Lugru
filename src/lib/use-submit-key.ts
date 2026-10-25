"use client";

import { useCallback, useMemo, useRef } from "react";

// Gegenstück zu `onceOnly` (src/lib/once.ts): Doppeltipp bzw. zweimal dieselbe Eingabe, bevor die Antwort da ist,
// bekommt denselben Einmal-Schlüssel – der Server bucht dann nur einmal. Nach jeder Antwort gibt es einen neuen
// Schlüssel, damit bewusst wiederholte gleiche Eingaben (z. B. nächste Palette, gleicher Kunde) gebucht werden.

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

function fingerprint(fd: FormData): string {
  const parts: string[] = [];
  for (const [k, v] of fd.entries()) {
    if (k === "submitKey") continue;
    parts.push(`${k}=${typeof v === "string" ? v : `${v.name}:${v.size}`}`);
  }
  return parts.join("&");
}

export function useSubmitKey() {
  const last = useRef<{ fp: string; key: string; at: number; done: boolean } | null>(null);
  /** Setzt `submitKey` im FormData (vor dem Absenden aufrufen). */
  const stamp = useCallback((fd: FormData) => {
    const fp = fingerprint(fd);
    const l = last.current;
    const key = l && !l.done && l.fp === fp && Date.now() - l.at < 30_000 ? l.key : newKey();
    last.current = { fp, key, at: Date.now(), done: false };
    fd.set("submitKey", key);
    return fd;
  }, []);
  /** Nach einer Antwort aufrufen: die nächste Eingabe bekommt einen neuen Schlüssel. */
  const settled = useCallback(() => {
    if (last.current) last.current.done = true;
  }, []);
  return useMemo(() => ({ stamp, settled }), [stamp, settled]);
}
