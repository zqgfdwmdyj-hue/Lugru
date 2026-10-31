"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { parseAmount, parseDate } from "@/lib/numbers";

export async function addCashItem(fd: FormData) {
  const session = await requireArea("geld");
  const amount = parseAmount(fd.get("amount"));
  const date = parseDate(String(fd.get("date") ?? ""));
  const description = String(fd.get("description") ?? "").trim();
  if (amount === null || !date || !description) return;
  const sign = fd.get("direction") === "in" ? 1 : -1;
  await db.insert(schema.cashItems).values({
    tenantId: session.tenantId,
    date,
    amount: Math.abs(amount) * sign,
    description,
    category: String(fd.get("category") ?? "sonstiges"),
    recurrence: z.enum(["none", "weekly", "monthly"]).catch("none").parse(fd.get("recurrence")),
    endDate: parseDate(String(fd.get("endDate") ?? "")),
  });
  revalidatePath("/cashflow");
}

export async function deleteCashItem(fd: FormData) {
  const session = await requireArea("geld");
  await db.delete(schema.cashItems).where(and(eq(schema.cashItems.id, z.string().uuid().parse(fd.get("id"))), eq(schema.cashItems.tenantId, session.tenantId)));
  revalidatePath("/cashflow");
}

export async function saveStartBalance(fd: FormData) {
  const session = await requireArea("geld");
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, session.tenantId));
  const v = parseAmount(fd.get("balance"));
  await db
    .update(schema.tenants)
    .set({ settings: { ...t.settings, cash: { startBalance: v ?? undefined, asOf: new Date().toISOString().slice(0, 10) } } })
    .where(eq(schema.tenants.id, session.tenantId));
  revalidatePath("/cashflow");
}

// ---- Liquidität: Kontoauszug, Einstellungen, wiederkehrende Abbuchungen ignorieren ----------------------

const meldung = (s: string) => `/cashflow?meldung=${encodeURIComponent(s)}`;

/** Kontoauszug (Sparkasse CSV-CAMT oder CAMT.053) – optional mit Kontostand laut Bank zum letzten Buchungstag. */
export async function kontoauszugAction(fd: FormData) {
  const session = await requireArea("geld");
  const datei = fd.get("datei");
  if (!(datei instanceof File) || datei.size === 0) redirect(meldung("Bitte eine Datei wählen (CSV, CAMT/XML oder PDF)."));
  if (datei.size > 10_000_000) redirect(meldung("Datei zu groß (max. 10 MB)."));
  const { importMeldung, kontoauszugImportieren } = await import("@/lib/bank/service");
  let text: string;
  try {
    const r = await kontoauszugImportieren(session.tenantId, "geschaeft", null, new Uint8Array(await datei.arrayBuffer()), { saldoBank: parseAmount(fd.get("saldo")) });
    text = importMeldung(r);
  } catch (e) {
    text = e instanceof Error ? e.message : "Datei nicht lesbar.";
  }
  revalidatePath("/cashflow");
  redirect(meldung(text));
}

export async function liquiEinstellungenAction(fd: FormData) {
  const session = await requireArea("geld");
  const { leseMonate } = await import("@/lib/money/liquiditaet");
  const steuern: { name: string; betrag: number; monate: number[]; tag: number }[] = [];
  for (let i = 0; i < 8; i++) {
    const name = String(fd.get(`st_name_${i}`) ?? "").trim().slice(0, 60);
    const betrag = parseAmount(fd.get(`st_betrag_${i}`));
    if (!name || !betrag) continue;
    steuern.push({ name, betrag: Math.abs(betrag), monate: leseMonate(String(fd.get(`st_monate_${i}`) ?? "alle")), tag: Math.min(28, Math.max(1, Math.round(parseAmount(fd.get(`st_tag_${i}`)) ?? 10))) });
  }
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, session.tenantId));
  const alt = t.settings.liquiditaet ?? {};
  const kTag = parseAmount(fd.get("kk_tag"));
  const kBetrag = parseAmount(fd.get("kk_betrag"));
  await db
    .update(schema.tenants)
    .set({
      settings: {
        ...t.settings,
        liquiditaet: {
          ...alt,
          reserve: Math.max(0, parseAmount(fd.get("reserve")) ?? 0),
          steuern,
          kreditkarte: { tag: kTag ? Math.min(28, Math.max(1, Math.round(kTag))) : undefined, betrag: kBetrag ? Math.abs(kBetrag) : undefined },
          bestellvorschlaege: fd.get("bestellvorschlaege") === "on",
          vorschlaegeEinrechnen: fd.get("vorschlaege_einrechnen") === "on",
          zahlungszielStandard: Math.max(0, Math.round(parseAmount(fd.get("zahlungsziel")) ?? 0)),
        },
      },
    })
    .where(eq(schema.tenants.id, session.tenantId));
  revalidatePath("/cashflow");
  redirect(meldung("Einstellungen gespeichert."));
}

/** Erkannte wiederkehrende Abbuchung ausblenden bzw. wieder einrechnen (z. B. wenn schon als Plan-Posten erfasst). */
export async function ignorierenAction(fd: FormData) {
  const session = await requireArea("geld");
  const gruppe = z.string().regex(/^[0-9a-f]{32}$/).parse(fd.get("gruppe"));
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, session.tenantId));
  const alt = t.settings.liquiditaet ?? {};
  const set = new Set(alt.ignoriert ?? []);
  if (set.has(gruppe)) set.delete(gruppe);
  else set.add(gruppe);
  await db.update(schema.tenants).set({ settings: { ...t.settings, liquiditaet: { ...alt, ignoriert: [...set] } } }).where(eq(schema.tenants.id, session.tenantId));
  revalidatePath("/cashflow");
}
