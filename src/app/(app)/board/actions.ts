"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireArea } from "@/lib/auth/session";
import { LEAD_COLUMNS, TASK_COLUMNS, type LeadColumnKey, type TaskColumnKey } from "@/lib/board/logic";
import { addTask, feedFromLead, moveLead, moveTask } from "@/lib/board/service";

const uuid = z.string().uuid();

export async function moveLeadAction(id: string, to: string) {
  const session = await requireArea("lieferanten");
  const col = z.enum(LEAD_COLUMNS.map((c) => c.key) as [LeadColumnKey, ...LeadColumnKey[]]).parse(to);
  await moveLead(session.tenantId, uuid.parse(id), col);
}

export async function moveTaskAction(id: string, to: string) {
  const session = await requireArea("start");
  const col = z.enum(TASK_COLUMNS.map((c) => c.key) as [TaskColumnKey, ...TaskColumnKey[]]).parse(to);
  await moveTask(session.tenantId, uuid.parse(id), col);
}

export async function addTaskAction(fd: FormData) {
  const session = await requireArea("start");
  const title = String(fd.get("title") ?? "").trim();
  const due = String(fd.get("due") ?? "").trim();
  if (title) await addTask(session.tenantId, session.userId, title, /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null);
  redirect(`/board?b=todos${fd.get("alle") === "1" ? "&alle=1" : ""}`);
}

/** „Preisliste erhalten“: Lieferant + Feed anlegen und dorthin zum Hochladen. */
export async function feedFromLeadAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const feedId = await feedFromLead(session.tenantId, uuid.parse(fd.get("id")));
  redirect(`/lieferanten/${feedId}`);
}
