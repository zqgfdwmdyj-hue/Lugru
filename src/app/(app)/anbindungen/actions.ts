"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/session";
import { integrationDef } from "@/lib/integrations/registry";
import { deleteIntegration, saveIntegration } from "@/lib/integrations/store";
import { testIntegration } from "@/lib/integrations/test";

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
