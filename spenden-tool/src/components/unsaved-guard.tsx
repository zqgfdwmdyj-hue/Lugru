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
  const dirtyRows = useRef(new Set<HTMLTableRowElement>());
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
      // Datei-Felder (MHD-Foto) speichern sich selbst.
      if (!t || t.type === "file") return;
      const row = t.closest("tr");
      if (!row) return;
      dirtyRows.current.add(row);
      setStatus("dirty");
      // Nach kurzer Tipp-Pause speichern, auch wenn die Zeile noch nicht verlassen wurde.
      if (idle.current) clearTimeout(idle.current);
      idle.current = setTimeout(() => void flush(), 4000);
    };
    // Zeile verlassen → gleich speichern
    const leave = (e: FocusEvent) => {
      const row = (e.target as Element | null)?.closest?.("tr");
      const next = e.relatedTarget as Node | null;
      if (row && dirtyRows.current.has(row as HTMLTableRowElement) && !(next && row.contains(next))) setTimeout(() => void flush(), 300);
    };
    // Normales Absenden (Speichern-Knopf, Pfeile, ✕ …) speichert ohnehin alles.
    const submitted = () => {
      dirtyRows.current.clear();
      if (idle.current) clearTimeout(idle.current);
      setStatus("idle");
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

  if (status === "idle") return null;
  return (
    <div className={`unsaved-bar${status === "saved" ? " unsaved-bar-ok" : ""}`} role="status">
      <span>
        {status === "dirty" && "Änderungen werden gleich gespeichert …"}
        {status === "saving" && "Speichert …"}
        {status === "saved" && "✓ Automatisch gespeichert"}
        {status === "error" && "Nicht gespeichert – Verbindung? Bitte erneut versuchen."}
      </span>
      {status !== "saved" && (
        <button className="btn btn-primary" type="button" onClick={() => void flush()} disabled={status === "saving"}>
          Jetzt speichern
        </button>
      )}
    </div>
  );
}
