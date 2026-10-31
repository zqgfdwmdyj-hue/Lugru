"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { mobilTokenAnlegen, mobilTokenWiderrufen } from "@/lib/mobil/token";
import { bestaetigen, erfassen, verwerfen } from "@/lib/schnell/service";

const PFAD = "/schnell";
const mit = (m: string) => `${PFAD}?meldung=${encodeURIComponent(m)}`;

export type SchluesselState = { token: string; name: string } | { fehler: string } | null;

/** Neuer Handy-Schlüssel – nur in der Antwort sichtbar, nie in Adresse oder Protokoll. */
export async function mobilTokenAction(_prev: SchluesselState, fd: FormData): Promise<SchluesselState> {
  const s = await requireSession();
  if (s.readOnly) return { fehler: "Nur ansehen – keine Schlüssel." };
  const name = String(fd.get("name") ?? "").trim() || "iPhone";
  const r = await mobilTokenAnlegen(s.tenantId, s.userId, name);
  revalidatePath(PFAD);
  return { token: r.token, name };
}

export async function mobilTokenWiderrufenAction(fd: FormData) {
  const s = await requireSession();
  await mobilTokenWiderrufen(s.tenantId, s.userId, String(fd.get("id")));
  redirect(mit("Schlüssel widerrufen – das Gerät kann nichts mehr senden."));
}

export type ErfassenState = { ok: boolean; message: string } | null;

/** Dasselbe wie per Sprache – zum Ausprobieren direkt auf der Seite. */
export async function erfassenAction(_prev: ErfassenState, fd: FormData): Promise<ErfassenState> {
  const s = await requireSession();
  const text = String(fd.get("text") ?? "").trim();
  if (text.length < 3) return { ok: false, message: "Bitte etwas eingeben." };
  const r = await erfassen(s, text);
  revalidatePath(PFAD);
  return { ok: true, message: r.antwort };
}

const Wahl = z.object({ id: z.string().uuid(), art: z.enum(["aufgabe", "privat_aufgabe", "termin", "privat_termin", "notiz", "einkauf"]), titel: z.string().max(200).optional(), tag: z.string().optional(), uhrzeit: z.string().optional() });

export async function bestaetigenAction(fd: FormData) {
  const s = await requireSession();
  const p = Wahl.safeParse({ id: fd.get("id"), art: fd.get("art"), titel: fd.get("titel") ?? undefined, tag: fd.get("tag") || undefined, uhrzeit: fd.get("uhrzeit") || undefined });
  if (!p.success) redirect(mit("Bitte eine Art wählen."));
  const r = await bestaetigen(s, p.data.id, { art: p.data.art, titel: p.data.titel, tag: p.data.tag ?? null, uhrzeit: p.data.uhrzeit ?? null });
  redirect(mit(r.message));
}

export async function verwerfenAction(fd: FormData) {
  const s = await requireSession();
  await verwerfen(s, String(fd.get("id")));
  redirect(mit("Verworfen."));
}
