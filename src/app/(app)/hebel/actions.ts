"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/auth/session";
import { dismissHebel, refreshHebelTasks, undismissAll } from "@/lib/hebel/service";

const KEY = z.string().regex(/^[a-z_]+:(amazon|ebay):.{1,200}$/);

/** Hebel ausblenden (erledigt / später) – kommt nach 30 Tagen wieder, falls er dann noch zutrifft. */
export async function dismissHebelAction(fd: FormData) {
  const session = await requireArea("geld");
  const key = KEY.parse(fd.get("key"));
  const days = z.coerce.number().int().min(1).max(365).catch(30).parse(fd.get("days"));
  await dismissHebel(session.tenantId, key, days);
  await refreshHebelTasks(session.tenantId);
  revalidatePath("/hebel");
  revalidatePath("/");
}

export async function undismissAllAction() {
  const session = await requireArea("geld");
  await undismissAll(session.tenantId);
  await refreshHebelTasks(session.tenantId, { reopen: true });
  revalidatePath("/hebel");
  revalidatePath("/");
}
