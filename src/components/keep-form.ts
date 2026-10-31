"use client";

import { startTransition, useEffect, useRef, type FormEvent } from "react";

/**
 * React setzt ein Formular nach jeder Aktion zurück (`<form action={…}>`). Folgen: Bei einer Fehlermeldung sind
 * alle Eingaben weg, und Auswahlfelder springen sogar nach erfolgreichem Speichern auf den Wert beim Laden der
 * Seite zurück – wer danach noch einmal speichert, schreibt unbemerkt den alten Wert zurück.
 *
 * Mit diesem Haken läuft die Aktion wie gewohnt (Ladezustand, Rückmeldung), die Eingaben bleiben aber stehen.
 * Formulare zum Neu-Anlegen (Notiz, Eintrag, Preis) und Datei-Uploads leeren sich mit `resetOnSuccess` nach
 * erfolgreichem Speichern (eigene Erfolgsprüfung als Funktion möglich); bei einem Fehler bleibt alles stehen –
 * auch die ausgewählte Datei. Scanner-Felder setzen sich bewusst weiter nach jedem Scan zurück.
 * Ohne JavaScript schickt das Formular wie bisher über `action` ab.
 */
export function useKeepForm<S>(state: S, run: (fd: FormData) => void, opts: { resetOnSuccess?: boolean | ((s: S) => boolean) } = {}) {
  const ref = useRef<HTMLFormElement>(null);
  // Zustand beim Absenden – erst ein neuer Zustand ist die Antwort auf genau dieses Absenden (nicht schon das
  // Neuzeichnen mit „wird gespeichert …“).
  const sent = useRef<{ from: S } | null>(null);
  const resetOnSuccess = opts.resetOnSuccess ?? false;
  useEffect(() => {
    if (!sent.current || Object.is(sent.current.from, state)) return;
    sent.current = null;
    const reset = typeof resetOnSuccess === "function" ? resetOnSuccess(state) : resetOnSuccess && succeeded(state);
    if (reset) ref.current?.reset();
  }, [state, resetOnSuccess]);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const submitter = (e.nativeEvent as SubmitEvent).submitter ?? null;
    let fd: FormData;
    try {
      fd = new FormData(form, submitter);
    } catch {
      // ältere Browser: Knopf (name/value) von Hand mitschicken
      fd = new FormData(form);
      const b = submitter as HTMLButtonElement | null;
      if (b?.name) fd.append(b.name, b.value);
    }
    sent.current = { from: state };
    startTransition(() => run(fd));
  };
  return { ref, onSubmit };
}

/** Erfolg erkennen: `ok` (true oder Text) bzw. kein `error`/`fehler`. */
export function succeeded(s: unknown): boolean {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  if ("ok" in o) return Boolean(o.ok);
  if ("error" in o) return !o.error;
  if ("fehler" in o) return !o.fehler;
  return true;
}
