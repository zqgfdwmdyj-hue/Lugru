import type { Level } from "@/lib/ebay-review/logic";

export const euro = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${n.toFixed(2).replace(".", ",")} €`);
/** Farbe der Punktzahl: ab 85 gut, ab 60 mittel, darunter schwach. */
export const scoreClass = (s: number | null) => (s === null ? "tag-neutral" : s >= 85 ? "tag-ok" : s >= 60 ? "tag-warn" : "tag-danger");
export const LEVEL_TAG: Record<Level, string> = { wichtig: "tag-danger", empfohlen: "tag-warn", tipp: "tag-info" };
