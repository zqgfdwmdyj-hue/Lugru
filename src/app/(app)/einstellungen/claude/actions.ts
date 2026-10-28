"use server";

import { revalidatePath } from "next/cache";
import { sql, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { revokeGrant } from "@/lib/assistant/oauth-service";

export type ClaudeState = { ok: boolean; message: string } | null;

/** Eine Claude-Verbindung trennen – Zugangs- und Erneuerungs-Token gelten sofort nicht mehr. */
export async function revokeGrantAction(fd: FormData) {
  const session = await requireOwner();
  await revokeGrant(session.tenantId, String(fd.get("id") ?? ""));
  revalidatePath("/einstellungen/claude");
}

const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

/** Fragefeld im Seller-System: an/aus, Modell, Änderungen erlauben. */
export async function saveAssistantSettings(_prev: ClaudeState, fd: FormData): Promise<ClaudeState> {
  const session = await requireOwner();
  const model = String(fd.get("model") ?? "");
  if (!MODELS.includes(model)) return { ok: false, message: "Bitte ein Modell wählen." };
  const patch = { enabled: fd.get("enabled") === "on", allowWrite: fd.get("allowWrite") === "on", model };
  await db
    .update(schema.tenants)
    .set({ settings: sql`${schema.tenants.settings} || jsonb_build_object('assistant', coalesce(${schema.tenants.settings}->'assistant', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)` })
    .where(eq(schema.tenants.id, session.tenantId));
  revalidatePath("/", "layout");
  return { ok: true, message: "Gespeichert." };
}
