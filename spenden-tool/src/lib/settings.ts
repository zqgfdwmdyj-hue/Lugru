import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

const S = schema.appSettings;

/** Teamweite Einstellungen (siehe Tabelle app_settings). */
export const SETTINGS = {
  /** Collage-Vorlage für neue Verteilungen (Format, Produkte pro Bild, Namen, Kopfzeile). */
  collage: "collage-vorlage",
  /** Account und Hashtags für Social Media. */
  social: "social",
} as const;

export async function getSetting<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(S).where(eq(S.key, key));
  return (row?.value as T) ?? null;
}

export async function setSetting(key: string, value: unknown) {
  await db.insert(S).values({ key, value }).onConflictDoUpdate({ target: S.key, set: { value, updatedAt: new Date() } });
}
