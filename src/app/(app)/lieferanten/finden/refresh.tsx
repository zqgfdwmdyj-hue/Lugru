"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Lädt die Seite neu, solange im Hintergrund noch etwas läuft (Markenlisten, Websuche, Entwürfe). */
export function AutoRefresh({ active, everyMs = 4000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return null;
}

/** Alle Kästchen einer Liste an-/abwählen. */
export function SelectAll({ name = "ids" }: { name?: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Alle auswählen"
      onChange={(e) => {
        const form = e.currentTarget.form;
        form?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`).forEach((c) => {
          if (!c.disabled) c.checked = e.currentTarget.checked;
        });
      }}
    />
  );
}
