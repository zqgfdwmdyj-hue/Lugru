"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { safeHref, updatePrefs } from "@/lib/auth/prefs";
import { MAX_FAVORITEN } from "@/lib/nav";

/**
 * Aktuelle Seite als Favorit merken oder wieder entfernen – gilt nur für mich, höchstens 8 (ganz oben in der
 * Seitenleiste). Privat nie (Bezeichnung wäre sichtbar).
 */
export async function toggleFavoriteAction(fd: FormData) {
  const session = await requireSession();
  const href = safeHref(String(fd.get("href") ?? ""));
  if (!href || href === "/privat" || href.startsWith("/privat/") || href.startsWith("/privat?")) return;
  const label = z.string().trim().max(80).catch("").parse(fd.get("label")) || href;
  await updatePrefs(session, (p) => {
    const list = p.favorites ?? [];
    const exists = list.some((f) => f.href === href);
    if (exists) return { ...p, favorites: list.filter((f) => f.href !== href) };
    // Voll: nichts ändern (der Stern ist dann gesperrt) – keine Favoriten still verdrängen.
    if (list.length >= MAX_FAVORITEN) return p;
    return { ...p, favorites: [...list, { href, label }] };
  });
  revalidatePath("/", "layout");
}

/** Favoriten neu ordnen (Ziehen in der Seitenleiste) – nur vorhandene, unbekannte Adressen werden ignoriert. */
export async function favoritenSortierenAction(hrefs: string[]) {
  const session = await requireSession();
  const reihe = z.array(z.string().max(500)).max(50).catch([]).parse(hrefs);
  await updatePrefs(session, (p) => {
    const list = p.favorites ?? [];
    const pos = (h: string) => {
      const i = reihe.indexOf(h);
      return i < 0 ? reihe.length + list.findIndex((f) => f.href === h) : i;
    };
    return { ...p, favorites: [...list].sort((a, b) => pos(a.href) - pos(b.href)) };
  });
  revalidatePath("/", "layout");
}
