"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { abmelden, anmelden, passwortAendern, passwortSetzen, requirePortal } from "@/lib/b2b/portal-auth";
import { reservieren, stornieren } from "@/lib/b2b/reservierung";

// Server Actions des Kundenportals. Jede Aktion holt die Portal-Sitzung selbst (requirePortal) und arbeitet nur mit
// tenantId und kundeId dieser Sitzung – nie mit Angaben aus dem Formular.

export type PortalStand = { ok: boolean; text: string } | null;
const uuid = z.string().uuid();

export async function anmeldenAction(_prev: PortalStand, fd: FormData): Promise<PortalStand> {
  const email = String(fd.get("email") ?? "").trim().slice(0, 200);
  const passwort = String(fd.get("passwort") ?? "").slice(0, 200);
  if (!email || !passwort) return { ok: false, text: "Bitte E-Mail und Passwort eingeben." };
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "?";
  const r = await anmelden(email, passwort, ip);
  if (!r.ok) return { ok: false, text: r.fehler };
  redirect("/portal");
}

export async function einladungAction(_prev: PortalStand, fd: FormData): Promise<PortalStand> {
  const token = String(fd.get("token") ?? "");
  const pw = String(fd.get("passwort") ?? "");
  if (pw !== String(fd.get("passwort2") ?? "")) return { ok: false, text: "Die Passwörter stimmen nicht überein." };
  const r = await passwortSetzen(token, pw);
  if (!r.ok) return { ok: false, text: r.fehler };
  redirect("/portal?willkommen=1");
}

export async function abmeldenAction() {
  await abmelden();
  redirect("/portal/login");
}

export async function reservierenAction(_prev: PortalStand, fd: FormData): Promise<PortalStand> {
  const s = await requirePortal();
  const dealId = uuid.safeParse(fd.get("dealId"));
  if (!dealId.success) return { ok: false, text: "Ungültig." };
  const menge = Number(String(fd.get("menge") ?? "").trim());
  const r = await reservieren({ tenantId: s.tenantId, kundeId: s.kundeId, dealId: dealId.data, menge, bedingungen: fd.get("bedingungen") === "on" });
  revalidatePath(`/portal/deals/${dealId.data}`);
  revalidatePath("/portal");
  return r.ok ? { ok: true, text: `Reserviert: ${r.menge} Stück. Die Vorkasse-Rechnung kommt per Mail, sobald der Deal bestellt wird.` } : { ok: false, text: r.fehler };
}

export async function stornierenAction(fd: FormData) {
  const s = await requirePortal();
  const dealId = uuid.parse(fd.get("dealId"));
  const r = await stornieren({ tenantId: s.tenantId, kundeId: s.kundeId, dealId });
  revalidatePath(`/portal/deals/${dealId}`);
  redirect(`/portal/deals/${dealId}?meldung=${encodeURIComponent(r.ok ? "Reservierung storniert." : r.fehler)}`);
}

export async function aboAction(fd: FormData) {
  const s = await requirePortal();
  const liste = (k: string) => String(fd.get(k) ?? "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 50).map((x) => x.slice(0, 80));
  const abo = fd.get("aus") === "on" ? { alle: false, marken: [], kategorien: [] } : fd.get("alle") === "on" ? { alle: true } : { alle: false, marken: liste("marken"), kategorien: liste("kategorien") };
  await db.update(schema.b2bKunden).set({ abo, updatedAt: new Date() }).where(and(eq(schema.b2bKunden.tenantId, s.tenantId), eq(schema.b2bKunden.id, s.kundeId)));
  redirect("/portal/konto?meldung=abo");
}

export async function passwortAendernAction(_prev: PortalStand, fd: FormData): Promise<PortalStand> {
  const s = await requirePortal();
  const r = await passwortAendern(s, String(fd.get("alt") ?? ""), String(fd.get("neu") ?? ""));
  return r.ok ? { ok: true, text: "Passwort geändert – andere Geräte wurden abgemeldet." } : { ok: false, text: r.fehler };
}
