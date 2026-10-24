"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { safeHref, updatePrefs } from "@/lib/auth/prefs";

const MAX_FAVORITES = 12;

/** Aktuelle Seite als Favorit merken oder wieder entfernen – gilt nur für mich. Privat nie (Bezeichnung wäre sichtbar). */
export async function toggleFavoriteAction(fd: FormData) {
  const session = await requireSession();
  const href = safeHref(String(fd.get("href") ?? ""));
  if (!href || href === "/privat" || href.startsWith("/privat/") || href.startsWith("/privat?")) return;
  const label = z.string().trim().max(80).catch("").parse(fd.get("label")) || href;
  await updatePrefs(session, (p) => {
    const list = p.favorites ?? [];
    const exists = list.some((f) => f.href === href);
    return { ...p, favorites: exists ? list.filter((f) => f.href !== href) : [...list, { href, label }].slice(-MAX_FAVORITES) };
  });
  revalidatePath("/", "layout");
}
