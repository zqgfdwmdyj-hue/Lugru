// Farbe und Symbol je Privat-Art (Farbabstand CIEDE2000 ≥ 22 zwischen allen Arten, z. B. Streicheln rosa ≠ Massage
// apricot) – gleich in Kalender, Eintragen, Startseite und Rückblick. Die Bedeutung
// steht immer zusätzlich als Text daneben (nie nur über die Farbe).

import type { EntryStatus } from "./logic";
import type { CalKind } from "./kalender";

export const KIND_STYLE: Record<CalKind, { color: string; icon: string }> = {
  termin: { color: "#78716c", icon: "📌" },
  kinder: { color: "#0284c7", icon: "🧒" },
  auszeit: { color: "#059669", icon: "🌿" },
  ausschlafen: { color: "#854d0e", icon: "😴" },
  paarzeit: { color: "#7c3aed", icon: "🥂" },
  naehe: { color: "#dc2626", icon: "❤️" },
  streicheln: { color: "#ec4899", icon: "🤲" },
  massage: { color: "#d97706", icon: "💆" },
  periode: { color: "#9d174d", icon: "🩸" },
  extern: { color: "#6e6e73", icon: "📅" },
};

/** Symbol zum Status: geplant ○, stattgefunden ✓, ausgefallen ✕. */
export const STATUS_ICON: Record<EntryStatus, string> = { geplant: "○", stattgefunden: "✓", ausgefallen: "✕" };
