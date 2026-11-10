"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireArea } from "@/lib/auth/session";
import { AbverkaufFehler } from "@/lib/abverkauf/service";

// B34.3a Briefversand je Charge: Testbrief, Freigabe mit bestätigter Kostensumme, Status abrufen, stornieren.

const zurueck = (charge: string, m: string): never => redirect(`/b2b/abverkauf/versand/${encodeURIComponent(charge)}?meldung=${encodeURIComponent(m)}`);

async function lauf(charge: string, fn: () => Promise<string>) {
  let m: string;
  try {
    m = await fn();
  } catch (e) {
    if (e instanceof AbverkaufFehler || e instanceof Error) m = e.message;
    else throw e;
  }
  revalidatePath(`/b2b/abverkauf/versand/${charge}`);
  revalidatePath("/b2b/abverkauf");
  zurueck(charge, m);
}

export async function testbriefAction(fd: FormData) {
  const s = await requireArea("b2b");
  const charge = String(fd.get("charge") ?? "");
  const { testbriefSenden } = await import("@/lib/abverkauf/versand");
  await lauf(charge, () => testbriefSenden(s, charge));
}

export async function versendenAction(fd: FormData) {
  const s = await requireArea("b2b");
  const charge = String(fd.get("charge") ?? "");
  if (fd.get("bestaetigt") !== "on") zurueck(charge, "Bitte Kostenvorschau prüfen und bestätigen – ohne Freigabe wird nichts verschickt.");
  const summe = Number(String(fd.get("summe") ?? "").replace(",", "."));
  const { chargeVersenden } = await import("@/lib/abverkauf/versand");
  await lauf(charge, () => chargeVersenden(s, charge, summe));
}

export async function statusAction(fd: FormData) {
  const s = await requireArea("b2b");
  const charge = String(fd.get("charge") ?? "");
  const { briefStatusAbrufen } = await import("@/lib/abverkauf/versand");
  await lauf(charge, async () => `${await briefStatusAbrufen(s.tenantId)} Status aktualisiert.`);
}

export async function stornoAction(fd: FormData) {
  const s = await requireArea("b2b");
  const charge = String(fd.get("charge") ?? "");
  const { briefStornieren } = await import("@/lib/abverkauf/versand");
  await lauf(charge, () => briefStornieren(s, String(fd.get("id") ?? "")));
}
