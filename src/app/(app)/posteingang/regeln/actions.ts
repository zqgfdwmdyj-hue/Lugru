"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { TOPICS } from "@/lib/inbox/classify";

export type RegelState = { ok: boolean; message: string } | null;

const R = schema.mailRegeln;
const leer = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, 120) : null;
};

const Eingabe = z.object({
  absender: z.string().nullable(),
  betreff: z.string().nullable(),
  thema: z.enum(TOPICS).nullable(),
  aktion: z.enum(["archivieren", "aufgabe", "weiterleiten"]),
  zustaendigId: z.string().uuid().nullable(),
});

export async function regelAnlegen(_prev: RegelState, fd: FormData): Promise<RegelState> {
  const session = await requireArea("posteingang");
  const p = Eingabe.safeParse({ absender: leer(fd.get("absender")), betreff: leer(fd.get("betreff")), thema: leer(fd.get("thema")), aktion: fd.get("aktion"), zustaendigId: leer(fd.get("zustaendigId")) });
  if (!p.success) return { ok: false, message: "Bitte Aktion und gültige Angaben wählen." };
  const r = p.data;
  if (!r.absender && !r.betreff && !r.thema) return { ok: false, message: "Bitte mindestens Absender, Betreff oder Thema angeben." };
  if (r.aktion === "weiterleiten" && !r.zustaendigId) return { ok: false, message: "Für „an Zuständigen“ bitte eine Person wählen." };
  if (r.zustaendigId) {
    const [m] = await db.select({ u: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.tenantId, session.tenantId), eq(schema.memberships.userId, r.zustaendigId)));
    if (!m) return { ok: false, message: "Diese Person gehört nicht zur Firma." };
  }
  await db.insert(R).values({ tenantId: session.tenantId, absender: r.absender?.toLowerCase() ?? null, betreff: r.betreff, thema: r.thema, aktion: r.aktion, zustaendigId: r.aktion === "weiterleiten" ? r.zustaendigId : null });
  revalidatePath("/posteingang/regeln");
  return { ok: true, message: "Regel gespeichert – gilt ab der nächsten eingehenden Mail." };
}

export async function regelUmschalten(fd: FormData) {
  const session = await requireArea("posteingang");
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) return;
  const [r] = await db.select({ aktiv: R.aktiv }).from(R).where(and(eq(R.tenantId, session.tenantId), eq(R.id, id.data)));
  if (r) await db.update(R).set({ aktiv: !r.aktiv }).where(and(eq(R.tenantId, session.tenantId), eq(R.id, id.data)));
  revalidatePath("/posteingang/regeln");
}

export async function regelLoeschen(fd: FormData) {
  const session = await requireArea("posteingang");
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (id.success) await db.delete(R).where(and(eq(R.tenantId, session.tenantId), eq(R.id, id.data)));
  revalidatePath("/posteingang/regeln");
}

/** Einstellungen „Posteingang auf null“ (nur Inhaber): automatisch archivieren, Termin-Mails, Vorabend-Erinnerung. */
export async function posteingangEinstellungen(fd: FormData) {
  const session = await requireArea("posteingang");
  if (session.role !== "owner") return;
  const { getSettings } = await import("@/lib/settings");
  const cur = (await getSettings(session.tenantId)).posteingang;
  const um = String(fd.get("vorabendUm") ?? "");
  const vor = Number(fd.get("abfahrtVorher"));
  const neu = {
    autoArchiv: fd.get("autoArchiv") === "on",
    terminMails: fd.get("terminMails") === "on",
    vorabendUm: /^([01]\d|2[0-3]):[0-5]\d$/.test(um) ? um : cur.vorabendUm,
    abfahrtVorher: Number.isFinite(vor) ? Math.max(0, Math.min(240, Math.round(vor))) : cur.abfahrtVorher,
  };
  await db
    .update(schema.tenants)
    .set({ settings: sql`${schema.tenants.settings} || jsonb_build_object('posteingang', ${JSON.stringify(neu)}::jsonb)` })
    .where(eq(schema.tenants.id, session.tenantId));
  revalidatePath("/posteingang/regeln");
}
