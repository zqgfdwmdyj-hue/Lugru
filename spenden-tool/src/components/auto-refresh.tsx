"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Lädt die Seite alle paar Sekunden neu, solange im Hintergrund etwas läuft (KI-Recherche). Pausiert, solange in
 * der Produktliste ungespeicherte Eingaben stehen (siehe UnsavedGuard) – sonst könnten Zeilen verschwinden.
 */
export function AutoRefresh({ active, seconds = 4 }: { active: boolean; seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (document.documentElement.dataset.unsaved !== "1") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [active, seconds, router]);
  return null;
}
