import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { type AiMode, defaultAiMode, isAiMode } from "@/lib/ai-modes";

const S = schema.appSettings;

/** Teamweite Einstellungen (siehe Tabelle app_settings). */
export const SETTINGS = {
  /** Collage-Vorlage für neue Verteilungen (Format, Produkte pro Bild, Namen, Kopfzeile). */
  collage: "collage-vorlage",
  /** Account und Hashtags für Social Media. */
  social: "social",
  /** KI nach dem Hochladen automatisch: „aus“ oder eine Stufe (siehe lib/ai-modes.ts). */
  autoAi: "ki-automatisch",
} as const;

export async function getSetting<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(S).where(eq(S.key, key));
  return (row?.value as T) ?? null;
}

export async function setSetting(key: string, value: unknown) {
  await db.insert(S).values({ key, value }).onConflictDoUpdate({ target: S.key, set: { value, updatedAt: new Date() } });
}

/**
 * Stufe für die automatische KI-Erkennung nach dem Hochladen – null = aus. Ohne Einstellung: an, mit der
 * Standard-Stufe (erkennt Name, Kategorie, Größe und sucht einen Vergleichspreis).
 */
export async function autoAiMode(): Promise<AiMode | null> {
  const v = await getSetting<string>(SETTINGS.autoAi);
  if (v === "aus") return null;
  return isAiMode(v) ? v : defaultAiMode();
}
