"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Status = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * Automatisches Speichern für die Produktliste: Geänderte Zeilen werden gespeichert, sobald man die Zeile verlässt
 * oder kurz nichts tippt – jeweils nur diese Zeilen. Unten zeigt eine Leiste den Stand; beim Verlassen der Seite mit
 * noch nicht gespeicherten Eingaben wird nachgefragt.
 */
export function UnsavedGuard({ formId, eventId, save }: { formId: string; eventId: string; save: (fd: FormData) => Promise<void> }) {
  const [status, setStatus] = useState<Status>("idle");
  const dirtyRows = useRef(new Set<HTMLElement>());
  const busy = useRef(false);
  const again = useRef(false);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (idle.current) clearTimeout(idle.current);
    if (busy.current) {
      again.current = true;
      return;
    }
    const rows = [...dirtyRows.current].filter((r) => r.isConnected);
    dirtyRows.current.clear();
    if (rows.length === 0) return;
    const fd = new FormData();
    fd.set("eventId", eventId);
    fd.set("op", "auto");
    for (const row of rows) {
      for (const el of row.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[name], select[name], textarea[name]")) {
        if (el.name === "sel") continue;
        if (el instanceof HTMLInputElement && (el.type === "file" || ((el.type === "checkbox" || el.type === "radio") && !el.checked))) continue;
        fd.append(el.name, el.value);
      }
    }
    busy.current = true;
    setStatus("saving");
    try {
      await save(fd);
      setStatus(dirtyRows.current.size ? "dirty" : "saved");
    } catch {
      // Beim nächsten Versuch dieselben Zeilen erneut schicken.
      for (const r of rows) dirtyRows.current.add(r);
      setStatus("error");
    } finally {
      busy.current = false;
      if (again.current) {
        again.current = false;
        void flush();
      }
    }
  }, [eventId, save]);

  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const mark = (e: Event) => {
      const t = e.target as HTMLInputElement | null;
      // Datei-Felder (MHD-Foto) speichern sich selbst; die Auswahl-Häkchen sind keine Eingabe.
      if (!t || t.type === "file" || t.name === "sel" || !t.name) return;
      const row = t.closest<HTMLElement>("[data-row]");
      if (!row) return;
      dirtyRows.current.add(row);
      setStatus("dirty");
      // Nach kurzer Tipp-Pause speichern, auch wenn die Zeile noch nicht verlassen wurde.
      if (idle.current) clearTimeout(idle.current);
      idle.current = setTimeout(() => void flush(), 4000);
    };
    // Zeile verlassen → gleich speichern
    const leave = (e: FocusEvent) => {
      const row = (e.target as Element | null)?.closest?.<HTMLElement>("[data-row]");
      const next = e.relatedTarget as Node | null;
      if (row && dirtyRows.current.has(row) && !(next && row.contains(next))) setTimeout(() => void flush(), 300);
    };
    // Normales Absenden (Speichern-Knopf, Pfeile, ✕ …) speichert ohnehin alles.
    const submitted = () => {
      dirtyRows.current.clear();
      if (idle.current) clearTimeout(idle.current);
      setStatus("saving");
      // Nach dem Absenden lädt die Seite neu; dann gilt wieder „gespeichert“.
      setTimeout(() => setStatus((s) => (s === "saving" ? "saved" : s)), 1200);
    };
    form.addEventListener("input", mark);
    form.addEventListener("change", mark);
    form.addEventListener("focusout", leave);
    form.addEventListener("submit", submitted);
    return () => {
      form.removeEventListener("input", mark);
      form.removeEventListener("change", mark);
      form.removeEventListener("focusout", leave);
      form.removeEventListener("submit", submitted);
    };
  }, [formId, flush]);

  // Andere Aktionen (z. B. Foto drehen) speichern vorher, was noch offen ist.
  useEffect(() => {
    const w = window as unknown as { __spendenFlush?: () => Promise<void> };
    w.__spendenFlush = flush;
    return () => {
      delete w.__spendenFlush;
    };
  }, [flush]);

  // Beim Wechsel in eine andere App / Sperren des Handys sofort speichern.
  useEffect(() => {
    const hide = () => document.visibilityState === "hidden" && void flush();
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [flush]);

  // Erfolgsmeldung nach kurzer Zeit ausblenden.
  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2500);
    return () => clearTimeout(t);
  }, [status]);

  const pending = status === "dirty" || status === "saving" || status === "error";
  useEffect(() => {
    // Für AutoRefresh: nicht neu laden, solange etwas ungespeichert ist.
    if (pending) document.documentElement.dataset.unsaved = "1";
    else delete document.documentElement.dataset.unsaved;
    return () => {
      delete document.documentElement.dataset.unsaved;
    };
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    // Links innerhalb der App laufen ohne Neuladen – dort vorher speichern bzw. nachfragen.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      if (a.href.split("#")[0] === location.href.split("#")[0]) return;
      if (!confirm("Einige Eingaben sind noch nicht gespeichert. Seite trotzdem verlassen?")) {
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
  }, [pending]);

  // Immer sichtbar (unten angeheftet): Stand und Speichern-Knopf – auch mitten in einer langen Liste.
  return (
    <div className={`save-bar save-${status}`} role="status" aria-live="polite">
      <span className="save-state">
        {status === "idle" && "✓ Alles gespeichert"}
        {status === "dirty" && "● Ungespeicherte Änderungen – werden gleich gespeichert"}
        {status === "saving" && "Wird gespeichert …"}
        {status === "saved" && "✓ Gespeichert"}
        {status === "error" && "⚠ Nicht gespeichert – Verbindung prüfen und erneut speichern"}
      </span>
      <button className="btn btn-primary btn-small" type="submit" form={formId} name="op" value="save" disabled={status === "saving"}>
        Speichern
      </button>
    </div>
  );
}
