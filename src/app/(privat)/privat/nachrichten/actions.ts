"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { entwurfNeu, entwurfSpeichern, nachrichtEinordnen, nachrichtErledigt, nachrichtSenden, nachrichtSpaeter, terminAktion } from "@/lib/inbox/persoenlich";
import { requirePrivate, updateEntry } from "@/lib/private/service";

// Persönliche Mails (B32): nur der Inhaber selbst – Einträge der Art „nachricht“ sieht und ändert nur er.

const uuid = z.string().uuid();
const zurueck = (id: string, m: string) => redirect(`/privat/nachrichten/${id}?meldung=${encodeURIComponent(m)}`);

async function inhaber() {
  const session = await requirePrivate({ full: true });
  if (session.role !== "owner") redirect("/privat?nurinhaber=1");
  return session;
}

/** Senden / Speichern / Später / Erledigt / Entwurf neu (Sie/Du). Senden immer nur auf diesen Klick. */
export async function nachrichtAktion(fd: FormData) {
  const session = await inhaber();
  const id = uuid.parse(fd.get("id"));
  const op = z.enum(["senden", "speichern", "spaeter", "erledigt", "neu", "du", "sie"]).parse(fd.get("op"));
  const text = String(fd.get("text") ?? "").slice(0, 20_000);
  revalidatePath("/privat/nachrichten");
  if (op === "senden") {
    const r = await nachrichtSenden(session, id, text);
    if (!r.ok) {
      await entwurfSpeichern(session, id, text);
      zurueck(id, `Nicht gesendet: ${r.meldung} Der Entwurf ist gespeichert.`);
    }
    redirect(`/privat/nachrichten?meldung=${encodeURIComponent(`Antwort gesendet${r.ok ? ` (von ${r.von})` : ""}.`)}`);
  }
  if (op === "speichern") {
    await entwurfSpeichern(session, id, text);
    zurueck(id, "Entwurf gespeichert.");
  }
  if (op === "spaeter") {
    await entwurfSpeichern(session, id, text);
    await nachrichtSpaeter(session, id);
    redirect(`/privat/nachrichten?meldung=${encodeURIComponent("Später – Erinnerung in 3 Stunden.")}`);
  }
  if (op === "erledigt") {
    await nachrichtErledigt(session, id);
    redirect(`/privat/nachrichten?meldung=${encodeURIComponent("Ohne Antwort erledigt.")}`);
  }
  await entwurfNeu(session, id, op === "du" || op === "sie" ? op : undefined);
  zurueck(id, op === "neu" ? "Entwurf neu erstellt." : `Entwurf in der ${op === "du" ? "Du" : "Sie"}-Form – für diesen Kontakt gemerkt.`);
}

/** „persönlich?“ einordnen – gilt dauerhaft für diesen Absender. */
export async function einordnenAction(fd: FormData) {
  const session = await inhaber();
  const id = uuid.parse(fd.get("id"));
  const art = z.enum(["persoenlich", "geschaeftlich", "ignorieren"]).parse(fd.get("art"));
  const r = await nachrichtEinordnen(session, id, art);
  revalidatePath("/privat/nachrichten");
  if (art === "persoenlich") zurueck(id, "Als persönlich gemerkt – Mails dieses Absenders landen immer hier.");
  redirect(`/privat/nachrichten?meldung=${encodeURIComponent(art === "geschaeftlich" ? `In den Posteingang verschoben${r.posteingang ? ` (${r.posteingang} Mail${r.posteingang === 1 ? "" : "s"})` : ""} – künftig geschäftlich.` : "Absender wird künftig ignoriert.")}`);
}

/** Termin: Absage rückgängig, Verschiebung übernehmen, eintragen, absagen – nie automatisch. */
export async function terminAktionAction(fd: FormData) {
  const session = await inhaber();
  const id = uuid.parse(fd.get("id"));
  const aktion = z.enum(["rueckgaengig", "verschieben", "eintragen", "absagen"]).parse(fd.get("aktion"));
  const r = await terminAktion(session, id, aktion);
  revalidatePath("/privat/nachrichten");
  zurueck(id, r.meldung);
}

/** Ausgehende persönliche Mail: Nachfassen in n Tagen (Erinnerung per Push, falls keine Antwort kommt). */
export async function privatNachfassenAction(fd: FormData) {
  const session = await inhaber();
  const id = uuid.parse(fd.get("id"));
  const tage = Number(fd.get("tage"));
  const am = Number.isFinite(tage) && tage > 0 ? new Date(Date.now() + Math.min(60, Math.round(tage)) * 86_400_000).toISOString().slice(0, 10) : null;
  await updateEntry(session, id, "nachricht", { nachfassenAm: am });
  revalidatePath("/privat/nachrichten");
  zurueck(id, am ? `Nachfassen am ${am.split("-").reverse().join(".")}, falls keine Antwort kommt.` : "Nachfassen aus.");
}

/** Einstellungen persönliche Mails (nur Inhaber): an/aus, Discord-DM, freie Termine im Entwurf, KI-Entwurf. */
export async function persoenlichEinstellungenAction(fd: FormData) {
  const session = await inhaber();
  const { getSettings } = await import("@/lib/settings");
  const cur = (await getSettings(session.tenantId)).posteingang;
  const dmId = String(fd.get("discordDmId") ?? "").trim();
  const persoenlich = {
    aktiv: fd.get("aktiv") === "on",
    discordDm: fd.get("discordDm") === "on",
    discordDmId: /^\d{15,22}$/.test(dmId) ? dmId : dmId ? (cur.persoenlich.discordDmId ?? "") : "",
    slots: fd.get("slots") === "on",
    kiEntwurf: fd.get("kiEntwurf") === "on",
  };
  await db
    .update(schema.tenants)
    .set({ settings: sql`${schema.tenants.settings} || jsonb_build_object('posteingang', ${JSON.stringify({ ...cur, persoenlich })}::jsonb)` })
    .where(eq(schema.tenants.id, session.tenantId));
  revalidatePath("/privat/nachrichten");
  redirect(`/privat/nachrichten?meldung=${encodeURIComponent(dmId && !/^\d{15,22}$/.test(dmId) ? "Gespeichert – die Discord-ID muss eine Zahl (15–22 Stellen) sein." : "Einstellungen gespeichert.")}`);
}
