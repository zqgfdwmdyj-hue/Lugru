"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireArea } from "@/lib/auth/session";
import { loeschenFreigeben } from "@/lib/belege/ablage";

const PFAD = "/rechnungsstation/ablage";
const zurueck = (m: string): never => redirect(`${PFAD}?meldung=${encodeURIComponent(m)}`);
const ids = (fd: FormData) => fd.getAll("id").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));

/** Dubletten zum Löschen freigeben – gelöscht wird erst beim nächsten Lauf des Agenten (Prüfsumme muss stimmen). */
export async function freigebenAction(fd: FormData) {
  const s = await requireArea("service", "buchhaltung", "geld");
  if (s.role !== "owner") zurueck("Nur der Inhaber gibt Dubletten zum Löschen frei.");
  const n = await loeschenFreigeben(s, fd.get("alle") === "1" ? "alle" : ids(fd));
  revalidatePath(PFAD);
  zurueck(n ? `${n} Dublette${n === 1 ? "" : "n"} zum Löschen freigegeben – der Agent löscht beim nächsten Lauf.` : "Nichts freigegeben.");
}

// ---- B34.2 Google Drive (Rechnungsordner) -----------------------------------------------------------------------

/** Ordner jetzt lesen (sonst stündlich): neue Dateien → Vorschläge. */
export async function driveLesenAction() {
  const s = await requireArea("service", "buchhaltung", "geld");
  let m: string;
  try {
    const { syncDrive } = await import("@/lib/invoices/service");
    const r = await syncDrive(s.tenantId);
    m = `Drive gelesen: ${r.vorschlaege} neue Vorschläge, ${r.created} Rechnungen übernommen (${r.total} PDFs).${r.remaining > 0 ? ` Noch ${r.remaining} offen.` : ""}`;
  } catch (e) {
    m = (e as Error).message;
  }
  revalidatePath(PFAD);
  zurueck(m);
}

/** Schon früher eingelesene Rechnungen, die noch direkt im Ordner liegen, auch vorschlagen. */
export async function driveBestandAction() {
  const s = await requireArea("service", "buchhaltung", "geld");
  let m: string;
  try {
    const { driveAccess } = await import("@/lib/integrations/clients/drive");
    const { getIntegration } = await import("@/lib/integrations/store");
    const a = await driveAccess(await getIntegration(s.tenantId, "google_drive"));
    if (!a) throw new Error("Google Drive ist noch nicht eingerichtet.");
    const { driveBestandVorschlagen } = await import("@/lib/belege/drive-ablage");
    const n = await driveBestandVorschlagen(s.tenantId, await a.list());
    m = `${n} vorhandene Rechnung${n === 1 ? "" : "en"} aus dem Ordner vorgeschlagen.`;
  } catch (e) {
    m = (e as Error).message;
  }
  revalidatePath(PFAD);
  zurueck(m);
}

export async function driveSchreibenAction(fd: FormData) {
  const s = await requireArea("service", "buchhaltung", "geld");
  const { driveSchreibenSetzen } = await import("@/lib/belege/drive-ablage");
  let m: string;
  try {
    const an = fd.get("schreiben") === "1";
    await driveSchreibenSetzen(s, an);
    m = an ? "Umbenennen/Verschieben in Drive freigegeben – ausgeführt wird weiter nur, was du freigibst." : "Schreibrecht aus – Drive wird nur gelesen.";
  } catch (e) {
    m = (e as Error).message;
  }
  revalidatePath(PFAD);
  zurueck(m);
}

/** Freigabe einer Charge (Auswahl oder alle offenen, höchstens 50) → in Drive ausführen. */
export async function driveFreigebenAction(fd: FormData) {
  const s = await requireArea("service", "buchhaltung", "geld");
  const { driveFreigeben } = await import("@/lib/belege/drive-ablage");
  let m: string;
  try {
    m = (await driveFreigeben(s, fd.get("alle") === "1" ? "alle" : ids(fd))).text;
  } catch (e) {
    m = (e as Error).message;
  }
  revalidatePath(PFAD);
  zurueck(m);
}

export async function driveVerwerfenAction(fd: FormData) {
  const s = await requireArea("service", "buchhaltung", "geld");
  const { driveVerwerfen } = await import("@/lib/belege/drive-ablage");
  const n = await driveVerwerfen(s, ids(fd));
  revalidatePath(PFAD);
  zurueck(n ? `${n} Vorschlag verworfen – die Datei bleibt, wo sie ist.` : "Nichts verworfen.");
}

/** Dubletten in den Drive-Papierkorb – nur nach dieser Freigabe, 30 Tage wiederherstellbar. */
export async function drivePapierkorbAction(fd: FormData) {
  const s = await requireArea("service", "buchhaltung", "geld");
  const { driveDublettenPapierkorb } = await import("@/lib/belege/drive-ablage");
  let m: string;
  try {
    const n = await driveDublettenPapierkorb(s, fd.get("alle") === "1" ? "alle" : ids(fd));
    m = n ? `${n} Dublette${n === 1 ? "" : "n"} nach Freigabe in den Drive-Papierkorb verschoben (30 Tage wiederherstellbar).` : "Nichts in den Papierkorb verschoben.";
  } catch (e) {
    m = (e as Error).message;
  }
  revalidatePath(PFAD);
  zurueck(m);
}
