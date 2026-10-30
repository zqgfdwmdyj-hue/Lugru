"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/session";
import { externSetzen, regelSetzen, vorschlagAblehnen, vorschlagAnnehmen, zustaendigkeitenAnwenden } from "@/lib/delegieren/service";

// Delegieren (nur Inhaber): Regeln, externe Zuständige, Vorschläge annehmen/ablehnen.

const ID = /^[0-9a-f-]{36}$/i;
const zurueck = (m: string) => {
  revalidatePath("/delegation");
  revalidatePath("/");
  redirect(`/delegation?meldung=${encodeURIComponent(m)}`);
};

export async function vorschlagAction(fd: FormData) {
  const s = await requireOwner();
  const id = String(fd.get("id") ?? "");
  const typ = String(fd.get("typ") ?? "");
  if (!ID.test(id)) zurueck("Aufgabe fehlt.");
  const was = String(fd.get("was") ?? "");
  if (was === "selbst") {
    await vorschlagAblehnen(s.tenantId, id);
    zurueck("Bleibt bei dir.");
  }
  const ok = await vorschlagAnnehmen(s.tenantId, id, typ, was === "immer");
  zurueck(ok ? (was === "immer" ? "Abgegeben – Aufgaben dieser Art gehen künftig automatisch an diese Person." : "Abgegeben.") : "Regel nicht gefunden.");
}

export async function regelAction(fd: FormData) {
  const s = await requireOwner();
  const vorlage = String(fd.get("vorlage") ?? "");
  const eigen = String(fd.get("typ") ?? "").trim();
  const typ = eigen || vorlage;
  const person = String(fd.get("person") ?? "") || null;
  const ok = await regelSetzen(s.tenantId, typ, fd.get("loeschen") === "1" ? null : person);
  if (ok) await zustaendigkeitenAnwenden(s.tenantId);
  zurueck(ok ? (fd.get("loeschen") === "1" ? "Regel entfernt." : "Regel gespeichert – beim ersten Mal fragt das System nach.") : "Aufgabentyp als kategorie:…, schluessel:… oder titel:… angeben und eine Person wählen.");
}

export async function externAction(fd: FormData) {
  const s = await requireOwner();
  await externSetzen(s.tenantId, String(fd.get("extern") ?? "").split(/[,;\n]+/));
  zurueck("Externe Zuständige gespeichert.");
}
