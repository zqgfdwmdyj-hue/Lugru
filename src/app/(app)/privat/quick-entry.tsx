"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { quickAddAction, type FormState } from "./actions";

type Kind = "kinder" | "ausschlafen" | "auszeit" | "paarzeit" | "intim";
const LABEL: Record<Kind, string> = { kinder: "Kinderzeit", ausschlafen: "Ausschlafen", auszeit: "Auszeit", paarzeit: "Paarzeit", intim: "Nähe" };
const WHO: Partial<Record<Kind, string>> = { kinder: "Wer war mit den Kindern allein?", ausschlafen: "Wer hat ausgeschlafen?", auszeit: "Wer hatte Auszeit?" };

/**
 * Schnell eintragen: Art wählen → Person → Zeitpunkt/Dauer → speichern. Alles Weitere eingeklappt.
 * `kinds`: was diese Person eintragen darf (Umfang „familie“ ohne Paar-Einträge).
 */
export function QuickEntry({ kinds, partners, me, today, yesterday, wakeTime }: { kinds: Kind[]; partners: { a: string; b: string }; me: "a" | "b"; today: string; yesterday: string; wakeTime: string }) {
  const [state, dispatch, pending] = useActionState<FormState, FormData>(quickAddAction, null);
  const [kind, setKind] = useState<Kind>(kinds[0]);
  const [person, setPerson] = useState<"a" | "b">(me);
  const [day, setDay] = useState(today);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state?.ok || !form.current) return;
    // Zeit- und Zusatzfelder leeren; Art, Person und Tag bleiben für den nächsten Eintrag.
    form.current.querySelectorAll<HTMLInputElement>("input[data-clear]").forEach((i) => {
      if (i.type === "checkbox" || i.type === "radio") i.checked = false;
      else i.value = "";
    });
  }, [state]);
  const other = person === "a" ? partners.b : partners.a;
  const timed = kind !== "intim";

  return (
    <form ref={form} action={dispatch} className="stack quick-entry" style={{ gap: 12 }} data-testid="quick-entry">
      <div className="field">
        <span className="label">1. Was?</span>
        <div className="pick-chips" role="radiogroup" aria-label="Art des Eintrags">
          {kinds.map((k) => (
            <label key={k}>
              <input type="radio" name="type" value={k} checked={kind === k} onChange={() => setKind(k)} />
              <span>{LABEL[k]}</span>
            </label>
          ))}
        </div>
      </div>
      {WHO[kind] && (
        <div className="field">
          <span className="label">2. {WHO[kind]}</span>
          <div className="pick-chips" role="radiogroup" aria-label={WHO[kind]}>
            {(["a", "b"] as const).map((p) => (
              <label key={p}>
                <input type="radio" name="person" value={p} checked={person === p} onChange={() => setPerson(p)} />
                <span>{partners[p]}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="field">
        <span className="label">{WHO[kind] ? "3." : "2."} Wann{timed ? " und wie lange" : ""}?</span>
        <div className="quick-when">
          <div className="pick-chips">
            <label><input type="radio" name="dayPick" checked={day === today} onChange={() => setDay(today)} /><span>heute</span></label>
            <label><input type="radio" name="dayPick" checked={day === yesterday} onChange={() => setDay(yesterday)} /><span>gestern</span></label>
          </div>
          <input className="input" type="date" name="day" value={day} max={today} onChange={(e) => setDay(e.target.value)} aria-label="Tag" style={{ maxWidth: 170 }} />
        </div>
        {timed ? (
          <div className="priv-grid" style={{ marginTop: 6 }}>
            <div className="field"><label className="label small" htmlFor="q-from">{kind === "ausschlafen" ? "sonst auf um" : "von"}</label><input className="input" id="q-from" name="from" type="time" data-clear={kind === "ausschlafen" ? undefined : true} defaultValue={kind === "ausschlafen" ? wakeTime : undefined} key={`from-${kind}`} /></div>
            <div className="field"><label className="label small" htmlFor="q-to">{kind === "ausschlafen" ? "aufgestanden um" : "bis"}</label><input className="input" id="q-to" name="to" type="time" data-clear /></div>
            <div className="field"><label className="label small" htmlFor="q-hours">oder Stunden</label><input className="input" id="q-hours" name="hours" inputMode="decimal" placeholder="z. B. 2,5" data-clear /></div>
          </div>
        ) : (
          <div className="priv-grid" style={{ marginTop: 6 }}>
            <div className="field"><label className="label small" htmlFor="q-time">Uhrzeit (optional)</label><input className="input" id="q-time" name="time" type="time" data-clear /></div>
          </div>
        )}
      </div>
      <details>
        <summary className="small" style={{ cursor: "pointer" }}>Mehr Angaben (optional)</summary>
        <div className="stack" style={{ gap: 10, marginTop: 8 }}>
          {kind === "kinder" && (
            <>
              <input className="input" name="what" placeholder="Was habt ihr gemacht?" autoComplete="off" data-clear />
              <label className="check small"><input type="checkbox" name="linkAuszeit" data-clear /> Währenddessen hatte {other} Auszeit – auch dort eintragen (ein Vorgang, zählt je Sicht einmal)</label>
            </>
          )}
          {kind === "auszeit" && (
            <>
              <input className="input" name="note" placeholder="z. B. Sport, Freunde" autoComplete="off" data-clear />
              <label className="check small"><input type="checkbox" name="linkKinder" data-clear /> Währenddessen war {other} allein mit den Kindern – auch als Kinderzeit eintragen</label>
            </>
          )}
          {kind === "ausschlafen" && <input className="input" name="note" placeholder="Notiz" autoComplete="off" data-clear />}
          {kind === "paarzeit" && (
            <>
              <input className="input" name="what" placeholder="Was habt ihr gemacht?" autoComplete="off" data-clear />
              <input className="input" name="sitter" placeholder="Wer hat auf die Kinder aufgepasst?" autoComplete="off" data-clear />
            </>
          )}
          {kind === "intim" && <input className="input" name="note" placeholder="Notiz" autoComplete="off" data-clear />}
        </div>
      </details>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" type="submit" disabled={pending} style={{ minHeight: 44, minWidth: 140 }}>{pending ? "Speichere …" : `${LABEL[kind]} speichern`}</button>
        {state && (
          <span className="small" role="status" style={{ color: state.ok ? "var(--ok)" : "var(--danger)" }} data-testid="quick-entry-result">
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
