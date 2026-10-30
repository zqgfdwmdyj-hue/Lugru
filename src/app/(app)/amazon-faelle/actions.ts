"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/session";
import { BEREICHE, PHASEN, type Bereich, type Phase } from "@/lib/amazon-faelle/logic";
import { einordnungKorrigieren, faelleAbgleich, fallAnVa, FallFehler, fallStatusSetzen, SETZBARE_PHASEN } from "@/lib/amazon-faelle/service";

const PFAD = "/amazon-faelle";
const uuid = z.string().uuid();
const mit = (pfad: string, m: string) => `${pfad}${pfad.includes("?") ? "&" : "?"}meldung=${encodeURIComponent(m)}`;

/** Amazon-Mails jetzt einordnen (sonst nach jedem Postfach-Abruf). */
export async function abgleichAction() {
  const s = await requireOwner();
  const r = await faelleAbgleich(s.tenantId, { sinceDays: 60 });
  revalidatePath(PFAD);
  redirect(mit(PFAD, `${r.geprueft} Amazon-Mails geprüft: ${r.neu} neue Vorgänge, ${r.zugeordnet} zu bestehenden zugeordnet${r.unsicher ? `, ${r.unsicher} bitte prüfen` : ""}${r.gemeldet ? `, ${r.gemeldet} an Ludwig gemeldet` : ""}.`));
}

export async function statusAction(fd: FormData) {
  const s = await requireOwner();
  const id = uuid.parse(fd.get("id"));
  const roh = String(fd.get("phase") ?? "");
  const phase = (SETZBARE_PHASEN as readonly string[]).includes(roh) ? (roh as (typeof SETZBARE_PHASEN)[number]) : null;
  let m = "Gespeichert.";
  try {
    await fallStatusSetzen(s.tenantId, id, { phase, erledigt: fd.get("erledigt") === "1", fallnummer: String(fd.get("fallnummer") ?? "") || null, notiz: String(fd.get("notiz") ?? "") || null }, s.name ?? "Ludwig");
  } catch (e) {
    m = e instanceof FallFehler ? e.message : `Fehler: ${e instanceof Error ? e.message : String(e)}`;
  }
  revalidatePath(PFAD);
  redirect(mit(`${PFAD}/${id}`, m));
}

export async function einordnungAction(fd: FormData) {
  const s = await requireOwner();
  const id = uuid.parse(fd.get("id"));
  const bereich = z.enum(BEREICHE).parse(fd.get("bereich")) as Bereich;
  const phase = z.enum(PHASEN).parse(fd.get("phase")) as Phase;
  await einordnungKorrigieren(s.tenantId, id, bereich, phase);
  revalidatePath(PFAD);
  redirect(mit(`${PFAD}/${id}`, "Einordnung übernommen – gleiche Betreffs werden künftig so eingeordnet."));
}

export async function anVaAction(fd: FormData) {
  const s = await requireOwner();
  const id = uuid.parse(fd.get("id"));
  const r = await fallAnVa(s.tenantId, id, s.userId);
  revalidatePath(PFAD);
  redirect(mit(`${PFAD}/${id}`, r.ok ? "An die VA übergeben – Discord-Thread mit Text, Checkliste und Belegen." : r.fehler));
}
