"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { MELDE_ARTEN, RUHE_STANDARD, RUHE_ZEIT, type MeldePrefs } from "@/lib/push/logic";

// Einstellungen → Benachrichtigungen: je Person (die eigenen) – Arten an/aus und Ruhezeit.

const ziel = (m: string) => `/einstellungen/benachrichtigungen?meldung=${encodeURIComponent(m)}`;

export async function benachrichtigungenSpeichern(fd: FormData) {
  const s = await requireSession();
  if (s.readOnly) redirect(ziel("Nur ansehen – nichts gespeichert."));
  const aus = MELDE_ARTEN.filter((a) => fd.get(`art_${a.key}`) !== "on").map((a) => a.key as string);
  const ohneRuhe = fd.get("ohneRuhe") === "on";
  const von = String(fd.get("ruheVon") ?? "");
  const bis = String(fd.get("ruheBis") ?? "");
  const p: MeldePrefs = {
    aus,
    ruheVon: ohneRuhe ? "00:00" : RUHE_ZEIT.test(von) ? von : RUHE_STANDARD.von,
    ruheBis: ohneRuhe ? "00:00" : RUHE_ZEIT.test(bis) ? bis : RUHE_STANDARD.bis,
  };
  // Nur der eigene Eintrag unter benachrichtigungen.personen[userId] – andere Personen bleiben unberührt.
  await db
    .update(schema.tenants)
    .set({
      settings: sql`jsonb_set(jsonb_set(coalesce(${schema.tenants.settings}, '{}'::jsonb), '{benachrichtigungen}', coalesce(${schema.tenants.settings}->'benachrichtigungen', '{}'::jsonb) || jsonb_build_object('personen', coalesce(${schema.tenants.settings}->'benachrichtigungen'->'personen', '{}'::jsonb))), ${`{benachrichtigungen,personen,${s.userId}}`}::text[], ${JSON.stringify(p)}::jsonb)`,
    })
    .where(eq(schema.tenants.id, s.tenantId));
  revalidatePath("/einstellungen/benachrichtigungen");
  redirect(ziel("Gespeichert."));
}

export async function aboEntfernen(fd: FormData) {
  const s = await requireSession();
  const id = String(fd.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(id) || s.readOnly) redirect(ziel("Nichts geändert."));
  const P = schema.pushAbos;
  const { and } = await import("drizzle-orm");
  await db.delete(P).where(and(eq(P.tenantId, s.tenantId), eq(P.userId, s.userId), eq(P.id, id)));
  revalidatePath("/einstellungen/benachrichtigungen");
  redirect(ziel("Gerät entfernt – dort bei Bedarf neu einschalten."));
}

/** Zurückgehaltenes (Ruhezeit) jetzt ausliefern – mit Morgenbericht, nur für mich. */
export async function jetztAusliefern() {
  const s = await requireSession();
  if (s.readOnly) redirect(ziel("Nur ansehen – nichts gesendet."));
  const { morgenAuslieferung } = await import("@/lib/push/service");
  const r = await morgenAuslieferung(s.tenantId, new Date(), { nurUserId: s.userId, sofort: true });
  revalidatePath("/einstellungen/benachrichtigungen");
  redirect(ziel(r.personen ? `Ausgeliefert: Morgenbericht${r.nachgereicht ? ` + ${r.nachgereicht} zurückgehaltene Meldung${r.nachgereicht === 1 ? "" : "en"}` : ""}.` : "Kein Gerät mit Push – nichts ausgeliefert."));
}
