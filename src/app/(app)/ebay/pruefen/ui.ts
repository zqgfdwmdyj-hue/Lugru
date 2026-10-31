import { issueKind, type Issue, type Level } from "@/lib/ebay-review/logic";

export const euro = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${n.toFixed(2).replace(".", ",")} €`);
/** Farbe der Punktzahl: ab 85 gut, ab 60 mittel, darunter schwach. */
export const scoreClass = (s: number | null) => (s === null ? "tag-neutral" : s >= 85 ? "tag-ok" : s >= 60 ? "tag-warn" : "tag-danger");
export const LEVEL_TAG: Record<Level, string> = { wichtig: "tag-danger", empfohlen: "tag-warn", tipp: "tag-info" };

/** Farbe eines Hinweises: Fehler und Pflichtangaben rot, Empfehlungen nach Priorität (nie rot). */
export const issueTag = (i: Pick<Issue, "key" | "level">) => (issueKind(i.key) !== "empfehlung" ? "tag-danger" : i.level === "wichtig" ? "tag-warn" : i.level === "empfohlen" ? "tag-neutral" : "tag-info");
