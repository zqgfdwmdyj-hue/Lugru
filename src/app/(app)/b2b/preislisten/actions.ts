"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { importTable } from "@/lib/suppliers/feed-service";
import { readTable } from "@/lib/tabular";
import { spaltenZuordnen } from "@/lib/b2b/preislisten-mail";
import { scanNachladen } from "@/lib/b2b/scanner";

const F = schema.supplierFeeds;
const uuid = z.string().uuid();
const meldung = (s: string) => `meldung=${encodeURIComponent(s)}`;

/** Preisliste hochladen: Spalten per Regeln, sonst KI; danach Marktdaten je Land im Hintergrund. */
export async function preislisteHochladenAction(fd: FormData) {
  const session = await requireArea("b2b");
  const t = session.tenantId;
  const datei = fd.get("datei");
  if (!(datei instanceof File) || datei.size === 0) redirect(`/b2b/preislisten?${meldung("Bitte eine CSV- oder Excel-Datei wählen.")}`);
  if (datei.size > 15_000_000) redirect(`/b2b/preislisten?${meldung("Datei ist zu groß (max. 15 MB).")}`);
  const supplierId = uuid.safeParse(fd.get("supplierId"));
  if (!supplierId.success) redirect(`/b2b/preislisten?${meldung("Bitte den Lieferanten wählen.")}`);
  const [sup] = await db.select({ id: schema.suppliers.id, name: schema.suppliers.name, code: schema.suppliers.code }).from(schema.suppliers).where(and(eq(schema.suppliers.tenantId, t), eq(schema.suppliers.id, supplierId.data!)));
  if (!sup) redirect("/b2b/preislisten");
  let table;
  try {
    table = readTable(new Uint8Array(await datei.arrayBuffer()));
  } catch {
    redirect(`/b2b/preislisten?${meldung("Datei nicht lesbar – bitte CSV oder Excel.")}`);
  }
  const name = String(fd.get("name") ?? "").trim().slice(0, 120) || `${sup!.name ?? sup!.code} – Preisliste`;
  let [feed] = await db.select().from(F).where(and(eq(F.tenantId, t), eq(F.supplierId, sup!.id), eq(F.name, name)));
  if (!feed) [feed] = await db.insert(F).values({ tenantId: t, name, supplierId: sup!.id, pricesGross: fd.get("brutto") === "on" }).returning();
  const z1 = await spaltenZuordnen(t, table!, feed.mapping);
  const r = await importTable(t, feed, table!, { mapping: z1.mapping, full: fd.get("voll") === "on" });
  if (!r.ok) redirect(`/lieferanten/${feed.id}?${meldung(`${r.message} (Spalten: ${r.headers.join(", ")})`)}`);
  after(() => scanNachladen(t, feed.id, 80).catch((e) => console.error("B2B-Scan", e instanceof Error ? e.message : e)));
  revalidatePath("/b2b/preislisten");
  redirect(`/b2b/preislisten/${feed.id}?${meldung(`${r.message}${z1.ki ? " Spalten per KI erkannt – bitte Stichprobe prüfen." : ""} Marktdaten je Land werden geladen.`)}`);
}

export async function nachladenAction(fd: FormData) {
  const session = await requireArea("b2b");
  const id = uuid.parse(fd.get("feedId"));
  const n = await scanNachladen(session.tenantId, id, 80);
  revalidatePath(`/b2b/preislisten/${id}`);
  redirect(`/b2b/preislisten/${id}?${meldung(n ? `${n} Marktdaten nachgeladen.` : "Nichts nachzuladen (oder Keepa nicht verfügbar).")}`);
}
