"use client";

import { startTransition, useEffect, useRef, type FormEvent } from "react";

/**
 * React setzt ein Formular nach jeder Aktion zurück (`<form action={…}>`). Folgen: Bei einer Fehlermeldung sind
 * alle Eingaben weg, und Auswahlfelder springen sogar nach erfolgreichem Speichern auf den Wert beim Laden der
 * Seite zurück – wer danach noch einmal speichert, schreibt unbemerkt den alten Wert zurück.
 *
 * Mit diesem Haken läuft die Aktion wie gewohnt (Ladezustand, Rückmeldung), die Eingaben bleiben aber stehen.
 * Formulare zum Neu-Anlegen (Notiz, Eintrag, Preis) leeren sich mit `resetOnSuccess` nach erfolgreichem Speichern.
 * Ohne JavaScript schickt das Formular wie bisher über `action` ab.
 */
export function useKeepForm<S>(state: S, run: (fd: FormData) => void, opts: { resetOnSuccess?: boolean } = {}) {
  const ref = useRef<HTMLFormElement>(null);
  const sent = useRef(false);
  const resetOnSuccess = Boolean(opts.resetOnSuccess);
  useEffect(() => {
    if (!sent.current) return;
    sent.current = false;
    if (resetOnSuccess && succeeded(state)) ref.current?.reset();
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
    sent.current = true;
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
