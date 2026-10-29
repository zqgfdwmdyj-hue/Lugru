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
