// Farbe und Symbol je Privat-Art – gleich in Kalender, Eintragen, Startseite und Rückblick. Die Bedeutung
// steht immer zusätzlich als Text daneben (nie nur über die Farbe).

import type { EntryStatus } from "./logic";
import type { CalKind } from "./kalender";

export const KIND_STYLE: Record<CalKind, { color: string; icon: string }> = {
  termin: { color: "#475569", icon: "📌" },
  kinder: { color: "#2563eb", icon: "🧒" },
  auszeit: { color: "#0f9f76", icon: "🌿" },
  ausschlafen: { color: "#ca8a04", icon: "😴" },
  paarzeit: { color: "#7c3aed", icon: "🥂" },
  naehe: { color: "#e11d48", icon: "❤️" },
  streicheln: { color: "#ec4899", icon: "🤲" },
  massage: { color: "#db2777", icon: "💆" },
  periode: { color: "#8e1652", icon: "🩸" },
  extern: { color: "#6e6e73", icon: "📅" },
};

/** Symbol zum Status: geplant ○, stattgefunden ✓, ausgefallen ✕. */
export const STATUS_ICON: Record<EntryStatus, string> = { geplant: "○", stattgefunden: "✓", ausgefallen: "✕" };
