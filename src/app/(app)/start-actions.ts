"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { updatePrefs } from "@/lib/auth/prefs";

/** Kalender auf der Startseite ein- oder ausblenden (z. B. private Kalender) – gilt nur für mich. */
export async function toggleCalendarAction(fd: FormData) {
  const session = await requireSession();
  const name = z.string().trim().min(1).max(200).parse(fd.get("calendar"));
  await updatePrefs(session, (p) => {
    const set = new Set(p.hiddenCalendars ?? []);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    return { ...p, hiddenCalendars: [...set] };
  });
  revalidatePath("/");
}
