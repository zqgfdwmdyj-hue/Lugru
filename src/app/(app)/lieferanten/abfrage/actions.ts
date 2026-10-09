"use server";

import { redirect } from "next/navigation";
import { requireArea } from "@/lib/auth/session";
import { refreshMarket } from "@/lib/suppliers/feed-service";
import { normEan } from "@/lib/suppliers/prices";

/** Amazon-Daten für diese EAN sofort holen (1 Keepa-Token). */
export async function keepaNowAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const ean = normEan(String(fd.get("ean") ?? ""));
  const back = String(fd.get("back") ?? "/lieferanten/abfrage");
  if (ean) await refreshMarket(session.tenantId, { eans: [ean] }).catch(() => undefined);
  redirect(back.startsWith("/lieferanten/") ? back : "/lieferanten/abfrage");
}
