import type { z } from "zod";
import type { AreaKey } from "@/lib/auth/areas";
import type { Session } from "@/lib/auth/session";

// Werkzeuge des KI-Assistenten – gemeinsam für den Claude-Konnektor (claude.ai) und das Fragefeld im
// Seller-System. Jedes Werkzeug nennt den Bereich, den es braucht; ändernde Werkzeuge sind markiert.

export type Channel = "claude" | "app";

export type ToolCtx = {
  session: Session;
  channel: Channel;
  /** Darf ändern (Nur-ansehen-Konten nie, Fragefeld nur wenn erlaubt). */
  canWrite: boolean;
  /** Privatbereich freigegeben (nur über den Claude-Konnektor des Inhabers mit Privat-Freigabe). */
  privat: boolean;
  today: string;
  /** Öffentliche Adresse des Systems (für Links in Antworten). */
  baseUrl: string;
  /** Sprache der Person (Fragefeld antwortet auf Englisch, wenn „en“). */
  sprache?: "de" | "en";
  /** Stufen je Werkzeug aus den Einstellungen (Fragefeld). */
  stufen?: Record<string, "gruen" | "gelb" | "rot">;
};

/**
 * Ergebnis eines Werkzeugs. Ändernde Werkzeuge können betroffene IDs und Daten zum Rückgängigmachen mitgeben
 * (landen im Protokoll, nie in der Antwort an Claude).
 */
export type ToolOut = { text: string; isError?: boolean; ids?: string[]; undo?: unknown };

/**
 * Stufe einer Änderung durch den Assistenten im Seller-System: grün = nach Bestätigung im Chat; gelb = zusätzlich
 * Einzelbestätigung (Außenwirkung, Nachrichten an VA/Kunden); rot = nie durch den Assistenten (nur Link zur Seite).
 */
export type Stufe = "gruen" | "gelb" | "rot";

/** Vorschau vor einer Änderung: was genau, wie viele, Beispiele; Nicht-Passendes getrennt. */
export type Vorschau = { anzahl: number; beispiele: string[]; ausgeschlossen?: { anzahl: number; grund: string; beispiele: string[] } };

export type ToolDef<S extends z.ZodType = z.ZodType> = {
  name: string;
  /** Kurz und deutsch – für Bestätigung, Protokoll und die Freigabe-Seite. */
  title: string;
  /** Wann Claude das Werkzeug nehmen soll. */
  description: string;
  /** Nötiger Bereich (einer davon reicht); null = jede angemeldete Person. */
  area: AreaKey | AreaKey[] | null;
  /** Nur der Inhaber (z. B. Amazon-ToDos). */
  ownerOnly?: boolean;
  write: boolean;
  privat?: boolean;
  input: S;
  run: (ctx: ToolCtx, input: z.infer<S>) => Promise<ToolOut | string>;
  /**
   * Woher kommen die Daten (lesende Werkzeuge)? `jobs` = Namen der Hintergrund-Abrufe (Einstellungen → Abrufe),
   * deren letzter Erfolg als Datenstand angegeben wird; „sellerboard:*“ = alle sellerboard-Abrufe. Ohne Angabe:
   * im Seller-System erfasst, immer aktuell.
   */
  quelle?: { text: string; jobs?: string[]; /** Auch Datei-Importe von Amazon-Berichten zählen als Datenstand. */ importe?: boolean };
  /** Zusammenfassung für Bestätigung und Protokoll, z. B. „Termin 30.10. → 01.11.“. */
  summary?: (input: z.infer<S>) => string;
  /** Stufe (ändernde Werkzeuge, Standard grün) – fest oder je nach Eingabe; überschreibbar in den Einstellungen. */
  stufe?: Stufe | ((input: z.infer<S>) => Stufe);
  /** Rot: wohin der Assistent stattdessen verweist (Seite im Seller-System). */
  seite?: string;
  /** Vorschau ohne zu ändern (nur lesen) – für die Bestätigung im Fragefeld. */
  vorschau?: (ctx: ToolCtx, input: z.infer<S>) => Promise<Vorschau>;
  /** Rückgängig (grüne Aktionen, 7 Tage): bekommt die `undo`-Daten aus dem Ergebnis. */
  undo?: (ctx: ToolCtx, daten: unknown) => Promise<string>;
};

/** Typ-Helfer: Eingabe-Typ aus dem Schema ableiten. */
export const defineTool = <S extends z.ZodType>(t: ToolDef<S>): ToolDef => t as unknown as ToolDef;
