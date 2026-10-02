"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Lädt die Seite alle paar Sekunden neu, solange im Hintergrund etwas läuft (KI-Recherche). */
export function AutoRefresh({ active, seconds = 4 }: { active: boolean; seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [active, seconds, router]);
  return null;
}
