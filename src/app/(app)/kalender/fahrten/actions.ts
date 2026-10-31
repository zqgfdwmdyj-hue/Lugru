"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { fahrtBestaetigen, fahrtenAbrufen, wocheBestaetigen } from "@/lib/mobil/fahrten";

async function inhaber() {
  const s = await requireSession();
  if (s.role !== "owner" || s.readOnly) redirect("/kalender");
  return s;
}
const ziel = (woche: string, m: string) => `/kalender/fahrten?woche=${woche}&meldung=${encodeURIComponent(m)}`;

export async function fahrtAction(fd: FormData) {
  const s = await inhaber();
  const art = fd.get("art") === "privat" ? "privat" : "geschaeftlich";
  await fahrtBestaetigen(s.tenantId, String(fd.get("id")), art, String(fd.get("zweck") ?? ""));
  redirect(ziel(String(fd.get("woche") ?? ""), "Fahrt bestätigt."));
}

export async function wocheAction(fd: FormData) {
  const s = await inhaber();
  const woche = String(fd.get("woche") ?? "");
  const von = new Date(`${woche}T00:00:00Z`);
  const n = await wocheBestaetigen(s.tenantId, von, new Date(von.getTime() + 7 * 86_400_000));
  redirect(ziel(woche, `${n} Fahrten wie vorgeschlagen bestätigt.`));
}

export async function abrufenAction(fd: FormData) {
  const s = await inhaber();
  const n = await fahrtenAbrufen(s.tenantId).catch(() => 0);
  redirect(ziel(String(fd.get("woche") ?? ""), `${n} neue Fahrten geholt.`));
}
