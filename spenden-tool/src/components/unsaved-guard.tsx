"use client";

import { useEffect, useState } from "react";

/**
 * Schützt eine lange Eingabeliste vor Datenverlust: Sobald etwas geändert wurde, erscheint unten eine Leiste
 * „Speichern“, und beim Verlassen der Seite (Link, Zurück, Tab schließen) wird nachgefragt.
 */
export function UnsavedGuard({ formId }: { formId: string }) {
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const mark = (e: Event) => {
      // Datei-Felder (MHD-Foto) speichern sich selbst.
      if ((e.target as HTMLInputElement | null)?.type !== "file") setDirty(true);
    };
    const clear = () => setDirty(false);
    form.addEventListener("input", mark);
    form.addEventListener("change", mark);
    form.addEventListener("submit", clear);
    return () => {
      form.removeEventListener("input", mark);
      form.removeEventListener("change", mark);
      form.removeEventListener("submit", clear);
    };
  }, [formId]);

  useEffect(() => {
    // Für AutoRefresh: nicht neu laden, solange etwas ungespeichert ist.
    if (dirty) document.documentElement.dataset.unsaved = "1";
    else delete document.documentElement.dataset.unsaved;
    return () => {
      delete document.documentElement.dataset.unsaved;
    };
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    // Links innerhalb der App laufen ohne Neuladen – dort selbst nachfragen.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      if (a.href.split("#")[0] === location.href.split("#")[0]) return;
      if (!confirm("Es gibt ungespeicherte Änderungen in der Produktliste. Seite trotzdem verlassen?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, formId]);

  if (!dirty) return null;
  return (
    <div className="unsaved-bar" role="status">
      <span>Ungespeicherte Änderungen</span>
      <button
        className="btn btn-primary"
        type="button"
        onClick={() => {
          // Über den Speichern-Knopf im Formular absenden, damit dieselbe Aktion läuft.
          const form = document.getElementById(formId) as HTMLFormElement | null;
          form?.requestSubmit(form.querySelector<HTMLButtonElement>('button[name="op"][value="save"]') ?? undefined);
        }}
      >
        Speichern
      </button>
    </div>
  );
}
