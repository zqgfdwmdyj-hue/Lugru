"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/session";
import { integrationDef } from "@/lib/integrations/registry";
import { deleteIntegration, saveIntegration } from "@/lib/integrations/store";
import { testIntegration } from "@/lib/integrations/test";
import { deleteConn } from "@/lib/sellerboard/connection";
import { startSellerboardSync } from "@/lib/sellerboard/sync";

export type TestState = { ok: boolean; message: string } | null;

export async function saveIntegrationAction(formData: FormData) {
  const session = await requireOwner();
  const provider = String(formData.get("provider"));
  const def = integrationDef(provider);
  if (!def) return;
  const values: Record<string, string> = {};
  for (const f of def.fields) values[f.key] = String(formData.get(f.key) ?? "");
  await saveIntegration(session.tenantId, provider, values);
  revalidatePath("/anbindungen");
}

export async function deleteIntegrationAction(formData: FormData) {
  const session = await requireOwner();
  await deleteIntegration(session.tenantId, String(formData.get("provider")));
  revalidatePath("/anbindungen");
}

export async function testIntegrationAction(_prev: TestState, formData: FormData): Promise<TestState> {
  const session = await requireOwner();
  return testIntegration(session.tenantId, String(formData.get("provider")));
}

export async function runAllNow(): Promise<void> {
  await requireOwner();
  const { runScheduledJobs } = await import("@/lib/scheduler");
  await runScheduledJobs(true);
  revalidatePath("/", "layout");
}

export async function requestAmazonReport(fd: FormData) {
  const session = await requireOwner();
  const { requestReport, REPORT_TYPES } = await import("@/lib/integrations/clients/amazon");
  const kind = String(fd.get("kind")) as keyof typeof REPORT_TYPES;
  if (!(kind in REPORT_TYPES)) return;
  await requestReport(session.tenantId, kind);
  revalidatePath("/anbindungen");
}

/** Berichte je Land (Buy Box, Listung, Lageralter) sofort anfordern – sonst täglich automatisch. */
export async function requestMarktBerichteNow(fd: FormData) {
  const session = await requireOwner();
  const { amazonLaender, requestMarktBericht } = await import("@/lib/integrations/clients/amazon");
  const { MARKT_BERICHTE } = await import("@/lib/amazon-markt/store");
  type B = keyof typeof MARKT_BERICHTE;
  const wahl = String(fd.get("bericht") ?? "alle");
  const berichte = (wahl === "alle" ? Object.keys(MARKT_BERICHTE) : wahl in MARKT_BERICHTE ? [wahl] : []) as B[];
  const laender = await amazonLaender(session.tenantId);
  // Amazon erlaubt nur wenige Anforderungen kurz hintereinander – höchstens 15 auf einmal.
  const plan = laender.flatMap((land) => berichte.map((b) => ({ land, b }))).slice(0, 15);
  let n = 0;
  let fehler = false;
  for (const x of plan) {
    try {
      await requestMarktBericht(session.tenantId, x.b, x.land);
      n++;
    } catch (e) {
      fehler = true;
      console.error("Bericht je Land", x.b, x.land, e instanceof Error ? e.message : e);
    }
  }
  revalidatePath("/anbindungen");
  redirect(`/anbindungen?amz=${fehler ? "fehler" : "angefordert"}&n=${n}#amazon-berichte`);
}

/** Amazon-Berichte 1–4 sofort anfordern: Kontozustand, gestrandet/gesperrt, Langzeitlager, Inbound-Mängel, USt (laufender Monat). */
export async function requestKontoBerichteNow() {
  const session = await requireOwner();
  const { anforderungFehler, requestKontoBericht, requestReport, REPORT_TYPES } = await import("@/lib/integrations/clients/amazon");
  let n = 0;
  let fehler = false;
  for (const art of ["kontozustand", "ust"] as const) {
    try {
      await requestKontoBericht(session.tenantId, art);
      n++;
    } catch {
      fehler = true;
    }
  }
  for (const kind of ["gestrandet", "gesperrt", "langzeitlager", "inboundMaengel"] as const) {
    try {
      await requestReport(session.tenantId, kind);
      n++;
    } catch (e) {
      fehler = true;
      await anforderungFehler(session.tenantId, REPORT_TYPES[kind], e);
    }
  }
  revalidatePath("/anbindungen");
  redirect(`/anbindungen?amz=${fehler ? "fehler" : "konto"}&n=${n}#amazon-berichte`);
}

/** Fertige Amazon-Reports jetzt abholen (sonst alle 15 Minuten). */
export async function fetchAmazonReportsNow() {
  const session = await requireOwner();
  const { processPendingReports } = await import("@/lib/integrations/clients/amazon");
  const r = await processPendingReports(session.tenantId);
  revalidatePath("/", "layout");
  redirect(`/anbindungen?amz=abgeholt&n=${r.processed}#amazon-berichte`);
}

// ---- sellerboard ------------------------------------------------------------------------------------

export async function sellerboardSyncAction(formData: FormData) {
  const session = await requireOwner();
  startSellerboardSync(session.tenantId, formData.get("scope") === "bestand" ? "bestand" : "alles");
  // kurz warten, damit „Abgleich läuft“ schon angezeigt wird
  await new Promise((r) => setTimeout(r, 400));
  revalidatePath("/anbindungen");
}

export async function sellerboardDisconnectAction() {
  const session = await requireOwner();
  // Nur die Verbindung (Zugang) wird entfernt; übernommene Daten bleiben mit ihrem Stand sichtbar.
  await deleteConn(session.tenantId);
  revalidatePath("/anbindungen");
}

/** ArbitrageOne: alle Exporte jetzt abholen (gleicher Ablauf wie der Nachtlauf, aber ohne Fälligkeit). */
export async function aoJetztAbholenAction(): Promise<void> {
  const session = await requireOwner();
  const { aoAbholen } = await import("@/lib/arbitrageone/abruf");
  const r = await aoAbholen(session.tenantId, { ausloeser: "knopf" });
  revalidatePath("/anbindungen");
  redirect(`/anbindungen?ao=${r.status}#importe-arbitrageone`);
}

/** BQool-Upload von Hand als hochgeladen bestätigen („hat geklappt“) – nur der Inhaber. */
export async function bqoolUploadBestaetigenAction(formData: FormData) {
  const session = await requireOwner();
  const exportId = String(formData.get("exportId") ?? "");
  const land = String(formData.get("land") ?? "");
  const zeit = String(formData.get("zeit") ?? "");
  if (/^[0-9a-f-]{36}$/i.test(exportId) && /^[A-Z]{2}$/.test(land) && zeit.length <= 40) {
    const { bqoolUploadBestaetigen } = await import("@/lib/bqool/export-service");
    await bqoolUploadBestaetigen(session.tenantId, exportId, land, zeit, session.name || session.email);
  }
  revalidatePath("/anbindungen");
  revalidatePath("/repricer/bqool");
  redirect("/anbindungen#importe-exporte");
}

/** B27.1: fehlgeschlagenen Import mit derselben Datei erneut verarbeiten („Erneut verarbeiten“) – nur der Inhaber. */
export async function importErneutAction(formData: FormData) {
  const session = await requireOwner();
  const id = String(formData.get("id") ?? "");
  let meldung = "fehler:Import nicht gefunden.";
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    const { importErneutVerarbeiten } = await import("@/lib/datei-import/service");
    const r = await importErneutVerarbeiten(session.tenantId, id);
    meldung = `${r.ok ? "ok" : "fehler"}:${r.ok ? "Erneut verarbeitet: " : "Erneut verarbeiten fehlgeschlagen: "}${r.text}`;
  }
  revalidatePath("/anbindungen");
  redirect(`/anbindungen?${new URLSearchParams({ erneut: meldung.slice(0, 400) }).toString()}#importe-arbitrageone`);
}
