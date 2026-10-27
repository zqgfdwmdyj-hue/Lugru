"use client";

import { useEffect, useRef, useState } from "react";
import type { EntryStatus } from "@/lib/private/logic";

const LABEL: Record<EntryStatus, string> = { geplant: "Geplant", stattgefunden: "Stattgefunden", ausgefallen: "Ausgefallen" };

/**
 * Status-Auswahl: Geplant · Stattgefunden · Ausgefallen. Liegt der Tag im Formular in der Zukunft, ist
 * „stattgefunden“ gesperrt und „geplant“ vorgewählt – Geplantes zählt in keiner Auswertung.
 */
export function StatusField({ today, initial, dayName = "day" }: { today: string; initial: EntryStatus; dayName?: string }) {
  const ref = useRef<HTMLFieldSetElement>(null);
  const [status, setStatus] = useState<EntryStatus>(initial);
  const [future, setFuture] = useState(false);
  useEffect(() => {
    const input = ref.current?.closest("form")?.querySelector<HTMLInputElement>(`input[name="${dayName}"]`);
    if (!input) return;
    const update = () => {
      const f = input.value > today;
      setFuture(f);
      if (f) setStatus((s) => (s === "stattgefunden" ? "geplant" : s));
    };
    update();
    input.addEventListener("input", update);
    input.addEventListener("change", update);
    return () => {
      input.removeEventListener("input", update);
      input.removeEventListener("change", update);
    };
  }, [today, dayName]);
  return (
    <fieldset ref={ref} className="field" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} data-testid="status-field">
      <legend className="label">Status</legend>
      <div className="pick-chips" role="radiogroup" aria-label="Status">
        {(["geplant", "stattgefunden", "ausgefallen"] as const).map((s) => (
          <label key={s} style={s === "stattgefunden" && future ? { opacity: 0.5 } : undefined}>
            <input type="radio" name="status" value={s} checked={status === s} disabled={s === "stattgefunden" && future} onChange={() => setStatus(s)} />
            <span>{LABEL[s]}</span>
          </label>
        ))}
      </div>
      <span className="small muted">{status === "geplant" ? "Geplant zählt in keiner Auswertung – später bestätigen." : status === "ausgefallen" ? "Bleibt sichtbar, zählt nicht." : "Zählt in den Auswertungen."}</span>
    </fieldset>
  );
}

/** Name der jeweils anderen Person – folgt der Auswahl „person“ im selben Formular. */
export function OtherName({ names, initial }: { names: { a: string; b: string }; initial: "a" | "b" | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [p, setP] = useState<"a" | "b" | null>(initial);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const update = () => {
      const v = form.querySelector<HTMLInputElement>('input[name="person"]:checked')?.value;
      setP(v === "a" || v === "b" ? v : null);
    };
    update();
    form.addEventListener("change", update);
    return () => form.removeEventListener("change", update);
  }, []);
  return <span ref={ref}>{p ? names[p === "a" ? "b" : "a"] : "die andere Person"}</span>;
}
