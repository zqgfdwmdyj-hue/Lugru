"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/session";
import { isRunning, runAmazonTodos, setTodoNote, setTodoStatus } from "@/lib/amazon-todos/service";

export type TodoState = { ok: boolean; message: string } | null;
const uuid = z.string().uuid();

export async function setStatusAction(fd: FormData) {
  const session = await requireOwner();
  const status = z.enum(["open", "done", "ignored"]).parse(fd.get("status"));
  await setTodoStatus(session.tenantId, uuid.parse(fd.get("id")), status, session.name ?? session.email);
  revalidatePath("/", "layout");
}

export async function saveNoteAction(fd: FormData) {
  const session = await requireOwner();
  await setTodoNote(session.tenantId, uuid.parse(fd.get("id")), String(fd.get("note") ?? ""));
  revalidatePath("/amazon-todos");
}

export async function refreshAction(_prev: TodoState): Promise<TodoState> {
  const session = await requireOwner();
  if (isRunning(session.tenantId)) return { ok: true, message: "Läuft bereits – gleich neu laden." };
  try {
    const r = await runAmazonTodos(session.tenantId, { sinceDays: 14, max: 60 });
    revalidatePath("/", "layout");
    const parts = [`${r.checked} Amazon-Mails geprüft`, `${r.created} neue Aufgaben`, `${r.irrelevant} unwichtig`, `${r.filtered} vom Grobfilter aussortiert`];
    if (r.closedAuto) parts.push(`${r.closedAuto} automatisch erledigt`);
    if (!r.ai) parts.push("ohne KI eingestuft (kein Claude-Schlüssel unter Anbindungen)");
    if (r.errors.length) parts.push(`Fehler: ${r.errors[0]}`);
    return { ok: r.errors.length === 0, message: `${parts.join(" · ")}. Postfächer vorher unter Posteingang abrufen, falls neue Mails fehlen.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
