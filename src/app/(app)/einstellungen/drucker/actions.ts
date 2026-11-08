"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/session";

// Einstellungen → Drucker (nur Inhaber): Agent anlegen (Token einmal anzeigen), widerrufen, Shelly/Ordner/Leerlauf.

const PFAD = "/einstellungen/drucker";

export type AnlegenStand = { token?: string; name?: string; deaktiviert?: number; fehler?: string } | null;

export async function agentAnlegenAction(_vorher: AnlegenStand, fd: FormData): Promise<AnlegenStand> {
  const s = await requireOwner();
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return { fehler: "Bitte einen Namen eingeben (z. B. „Arbeits-PC Lager“)." };
  const { agentAnlegen } = await import("@/lib/druck/service");
  const r = await agentAnlegen(s.tenantId, s.userId, name, { andereDeaktivieren: fd.get("umzug") === "1" });
  revalidatePath(PFAD);
  return { token: r.token, name, deaktiviert: r.deaktiviert };
}

export async function agentWiderrufenAction(fd: FormData) {
  const s = await requireOwner();
  const { agentWiderrufen } = await import("@/lib/druck/service");
  await agentWiderrufen(s.tenantId, String(fd.get("id") ?? ""), "widerrufen");
  revalidatePath(PFAD);
  redirect(`${PFAD}?meldung=${encodeURIComponent("Agent widerrufen – er bekommt ab sofort „abgemeldet“.")}`);
}

const ipOk = (t: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(t) || /^[a-z0-9][a-z0-9.-]{0,62}$/i.test(t);

export async function agentEinstellungenAction(fd: FormData) {
  const s = await requireOwner();
  const id = String(fd.get("id") ?? "");
  const shelly: Record<string, { typ: "gen1" | "gen2"; ip: string }> = {};
  for (const m of ["QL-800", "QL-1100"]) {
    const ip = String(fd.get(`shelly_ip_${m}`) ?? "").trim();
    if (!ip) continue;
    if (!ipOk(ip)) redirect(`${PFAD}?meldung=${encodeURIComponent(`Shelly ${m}: IP-Adresse ungültig.`)}`);
    shelly[m] = { typ: fd.get(`shelly_typ_${m}`) === "gen2" ? "gen2" : "gen1", ip };
  }
  const pfad = String(fd.get("ordner") ?? "").trim().slice(0, 300);
  const intervall = Math.min(3600, Math.max(15, Number(fd.get("intervall")) || 60));
  const leerlauf = Math.min(240, Math.max(1, Number(fd.get("leerlauf")) || 10));
  const { agentEinstellungenSetzen } = await import("@/lib/druck/service");
  await agentEinstellungenSetzen(s.tenantId, id, { shelly, ordner: pfad ? { pfad, intervallSek: intervall } : null, leerlaufAusMin: leerlauf });
  revalidatePath(PFAD);
  redirect(`${PFAD}?meldung=${encodeURIComponent("Gespeichert – der Agent übernimmt es beim nächsten Heartbeat (≤ 30 s).")}`);
}
