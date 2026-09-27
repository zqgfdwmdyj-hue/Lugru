"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { runResearch, saveResearchSettings } from "@/lib/research/service";

const lines = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

export async function saveResearch(fd: FormData) {
  const session = await requireSession();
  const topics = [...new Set(lines(fd.get("topics")))].slice(0, 30);
  const feeds = [...new Set(lines(fd.get("feeds")).filter((u) => /^https?:\/\//i.test(u)))].slice(0, 30);
  const days = Math.round(Number(fd.get("intervalDays")));
  await saveResearchSettings(session.tenantId, { topics, feeds, intervalDays: Number.isFinite(days) && days >= 1 && days <= 30 ? days : 3 });
  revalidatePath("/wissen/recherche");
}

export type RunState = { message: string; ok: boolean } | null;

export async function runResearchNow(_prev: RunState, _fd: FormData): Promise<RunState> {
  const session = await requireSession();
  try {
    const r = await runResearch(session.tenantId);
    revalidatePath("/wissen", "layout");
    const msg = r.newItems
      ? `${r.newItems} neue Artikel in ${r.entries} ${r.entries === 1 ? "Eintrag" : "Einträgen"} abgelegt.`
      : "Nichts Neues gefunden – alles schon bekannt.";
    return { ok: r.errors.length === 0, message: r.errors.length ? `${msg} Probleme: ${r.errors.slice(0, 3).join(" | ")}` : msg };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
