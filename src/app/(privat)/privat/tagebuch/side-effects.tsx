"use client";

import { useState } from "react";

/**
 * Nebenwirkungen heute: „Keine“ und einzelne Nebenwirkungen schließen sich aus. „Keine“ anhaken leert die
 * Auswahl und „Sonstiges“; eine Nebenwirkung anhaken oder Sonstiges eintragen nimmt „Keine“ zurück.
 * Der Server prüft dasselbe noch einmal.
 */
export function SideEffectsPicker({ options, values = [], none = false, other = "" }: { options: readonly string[]; values?: string[]; none?: boolean; other?: string }) {
  const [noEffects, setNoEffects] = useState(none && !values.length && !other);
  const [picked, setPicked] = useState<Set<string>>(new Set(values.filter((v) => options.includes(v))));
  const [otherText, setOtherText] = useState(other);
  const pick = (o: string, on: boolean) => {
    setPicked((s) => {
      const n = new Set(s);
      if (on) n.add(o);
      else n.delete(o);
      return n;
    });
    if (on) setNoEffects(false);
  };
  return (
    <>
      <label className="small" style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
        <input
          type="checkbox"
          name="noSideEffects"
          checked={noEffects}
          onChange={(e) => {
            setNoEffects(e.target.checked);
            if (e.target.checked) {
              setPicked(new Set());
              setOtherText("");
            }
          }}
          data-testid="no-side-effects"
        />{" "}
        Keine Nebenwirkungen heute
      </label>
      <div className="pick-chips" data-testid="side-effects">
        {options.map((o) => (
          <label key={o}>
            <input type="checkbox" name="sideEffects" value={o} checked={picked.has(o)} onChange={(e) => pick(o, e.target.checked)} />
            <span>{o}</span>
          </label>
        ))}
      </div>
      <input
        className="input"
        name="otherEffect"
        placeholder="Sonstiges (optional)"
        style={{ marginTop: 6 }}
        value={otherText}
        onChange={(e) => {
          setOtherText(e.target.value);
          if (e.target.value.trim()) setNoEffects(false);
        }}
        data-testid="other-effect"
      />
    </>
  );
}
