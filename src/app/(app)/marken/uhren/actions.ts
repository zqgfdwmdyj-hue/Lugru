"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { todayIso } from "@/lib/dates";
import { TAX_MODES } from "@/lib/watches/calc";
import { lessonByKey, scoreQuiz } from "@/lib/watches/lessons";
import { CONDITIONS, DEAL_STATUSES, defaultChecklist, normRef, parseCosts, parseEuro, parsePct, PRICE_KINDS, SETS } from "@/lib/watches/logic";
import { coachDeal, getDeal, requireFlip, saveQuiz, setLessonDone } from "@/lib/watches/service";

export type FlipState = { ok: boolean; message: string } | null;
export type QuizState = { correct: number; total: number; passed: boolean; picked: (number | null)[] } | null;

const uuid = z.string().uuid();
const D = schema.watchDeals;
const P = schema.watchPrices;
const str = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max) || null;
const day = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};
const url = (fd: FormData) => {
  const v = str(fd, "url", 500);
  return v && /^https?:\/\//i.test(v) ? v : null;
};
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const BASE = "/marken/uhren";

/** Deal anlegen oder ändern. Neue Deals bekommen die passende Ankauf-Prüfliste (gebraucht bzw. neu). */
export async function saveDealAction(_prev: FlipState, fd: FormData): Promise<FlipState> {
  const { session, brandId } = await requireFlip();
  const t = session.tenantId;
  const id = fd.get("id") ? uuid.safeParse(fd.get("id")) : null;
  if (id && !id.success) return { ok: false, message: "Deal nicht gefunden." };
  const cur = id?.success ? await getDeal(t, id.data) : null;
  if (id && !cur) return { ok: false, message: "Deal nicht gefunden." };

  const maker = str(fd, "maker", 80);
  if (!maker) return { ok: false, message: "Bitte die Uhrenmarke angeben (z. B. Omega, Seiko)." };
  const condition = z.enum(CONDITIONS).catch("gebraucht").parse(fd.get("condition"));
  const status = z.enum(DEAL_STATUSES).catch(cur?.status ?? "beobachtet").parse(fd.get("status"));
  const taxMode = z.enum(TAX_MODES).catch(cur?.taxMode ?? "privat").parse(fd.get("taxMode"));
  const watchSet = z.enum(SETS).catch("ohne").parse(fd.get("watchSet"));
  const money = (k: string) => {
    const raw = String(fd.get(k) ?? "").trim();
    if (!raw) return { v: null as number | null, bad: false };
    const v = parseEuro(raw);
    return { v, bad: v === null };
  };
  const fields = { askPrice: money("askPrice"), buyPrice: money("buyPrice"), targetSell: money("targetSell"), sellPrice: money("sellPrice"), feeFixed: money("feeFixed"), shipping: money("shipping") };
  const badField = Object.entries(fields).find(([, x]) => x.bad)?.[0];
  if (badField) return { ok: false, message: `Bitte einen gültigen Betrag eintragen (${{ askPrice: "Angebotspreis", buyPrice: "Ankauf", targetSell: "Ziel-Verkauf", sellPrice: "Verkauf", feeFixed: "Gebühr fest", shipping: "Versand" }[badField]}), z. B. 4.250 oder 4250,50.` };
  const feePctRaw = String(fd.get("feePct") ?? "").trim();
  const feePct = feePctRaw ? parsePct(feePctRaw) : 0;
  if (feePct === null) return { ok: false, message: "Gebühr in % bitte als Zahl zwischen 0 und 100 (z. B. 6,5)." };
  const costs = parseCosts(String(fd.get("costs") ?? ""));
  if (costs.bad.length) return { ok: false, message: `Nebenkosten: „${costs.bad[0]}“ – bitte je Zeile „Bezeichnung: Betrag“ (z. B. Revision: 350).` };
  const yearRaw = String(fd.get("year") ?? "").trim();
  const year = yearRaw ? Number(yearRaw) : null;
  if (year !== null && (!Number.isInteger(year) || year < 1850 || year > 2100)) return { ok: false, message: "Baujahr bitte vierstellig (z. B. 2019)." };

  let buyDate = day(fd, "buyDate");
  let sellDate = day(fd, "sellDate");
  const buyPrice = fields.buyPrice.v;
  const sellPrice = fields.sellPrice.v;
  if (["gekauft", "inserat", "verkauft"].includes(status) && buyPrice === null) return { ok: false, message: "Bitte den Ankaufspreis eintragen – sonst lässt sich nichts rechnen." };
  if (status === "verkauft" && sellPrice === null) return { ok: false, message: "Bitte den Verkaufspreis eintragen." };
  if (["gekauft", "inserat", "verkauft"].includes(status) && !buyDate) buyDate = todayIso();
  if (status === "verkauft" && !sellDate) sellDate = todayIso();
  if (buyDate && sellDate && sellDate < buyDate) return { ok: false, message: "Der Verkauf liegt vor dem Ankauf – bitte die Daten prüfen." };

  const values = {
    practice: fd.get("practice") === "on",
    condition,
    maker,
    model: str(fd, "model", 120),
    reference: str(fd, "reference", 60),
    year,
    watchSet,
    status,
    taxMode,
    source: str(fd, "source", 80),
    url: url(fd),
    askPrice: fields.askPrice.v,
    buyPrice,
    buyDate,
    costs: costs.items,
    targetSell: fields.targetSell.v,
    sellPrice,
    sellDate,
    channel: str(fd, "channel", 80),
    feePct,
    feeFixed: fields.feeFixed.v ?? 0,
    shipping: fields.shipping.v ?? 0,
    notes: str(fd, "notes", 4000),
    lessons: str(fd, "lessons", 4000),
    rejectReason: str(fd, "rejectReason", 500),
    updatedAt: new Date(),
  };

  if (cur) {
    // Zustand gewechselt und Prüfliste noch unberührt: passende Liste nehmen.
    const fresh = cur.condition !== condition && !cur.checklist.some((c) => c.done);
    await db.update(D).set({ ...values, ...(fresh ? { checklist: defaultChecklist(condition) } : {}) }).where(and(eq(D.tenantId, t), eq(D.id, cur.id)));
    revalidatePath(BASE, "layout");
    return { ok: true, message: "Gespeichert." };
  }
  const [row] = await db.insert(D).values({ ...values, tenantId: t, brandId, checklist: defaultChecklist(condition), createdBy: session.userId }).returning({ id: D.id });
  revalidatePath(BASE, "layout");
  redirect(`${BASE}/deals/${row.id}?neu=1`);
}

/** Aus dem Rechner: Zahlen als neuen Deal übernehmen. */
export async function dealFromCalcAction(fd: FormData) {
  const { session, brandId } = await requireFlip();
  const condition = z.enum(CONDITIONS).catch("gebraucht").parse(fd.get("condition"));
  const taxMode = z.enum(TAX_MODES).catch("privat").parse(fd.get("taxMode"));
  const cost = parseEuro(String(fd.get("costs") ?? "")) ?? 0;
  const [row] = await db
    .insert(D)
    .values({
      tenantId: session.tenantId,
      brandId,
      practice: fd.get("practice") === "on",
      condition,
      maker: str(fd, "maker", 80) ?? "Unbekannt",
      model: str(fd, "model", 120),
      reference: str(fd, "reference", 60),
      taxMode,
      askPrice: parseEuro(String(fd.get("buy") ?? "")),
      targetSell: parseEuro(String(fd.get("sell") ?? "")),
      costs: cost ? [{ label: "Nebenkosten (Rechner)", amount: cost }] : [],
      feePct: parsePct(String(fd.get("feePct") ?? "")) ?? 0,
      feeFixed: parseEuro(String(fd.get("feeFixed") ?? "")) ?? 0,
      shipping: parseEuro(String(fd.get("shipping") ?? "")) ?? 0,
      checklist: defaultChecklist(condition),
      createdBy: session.userId,
    })
    .returning({ id: D.id });
  revalidatePath(BASE, "layout");
  redirect(`${BASE}/deals/${row.id}?neu=1`);
}

export async function toggleCheckAction(fd: FormData) {
  const { session } = await requireFlip();
  const id = uuid.parse(fd.get("id"));
  const i = Number(fd.get("i"));
  const d = await getDeal(session.tenantId, id);
  if (!d || !Number.isInteger(i) || !d.checklist[i]) return;
  const checklist = d.checklist.map((c, n) => (n === i ? { ...c, done: !c.done } : c));
  await db.update(D).set({ checklist, updatedAt: new Date() }).where(and(eq(D.tenantId, session.tenantId), eq(D.id, id)));
  revalidatePath(`${BASE}/deals/${id}`);
}

export async function addCheckAction(fd: FormData) {
  const { session } = await requireFlip();
  const id = uuid.parse(fd.get("id"));
  const text = str(fd, "text", 160);
  const d = await getDeal(session.tenantId, id);
  if (!d || !text || d.checklist.length >= 40) return;
  await db.update(D).set({ checklist: [...d.checklist, { text, done: false }], updatedAt: new Date() }).where(and(eq(D.tenantId, session.tenantId), eq(D.id, id)));
  revalidatePath(`${BASE}/deals/${id}`);
}

export async function deleteDealAction(fd: FormData) {
  const { session } = await requireFlip();
  const id = uuid.parse(fd.get("id"));
  await db.delete(D).where(and(eq(D.tenantId, session.tenantId), eq(D.id, id)));
  revalidatePath(BASE, "layout");
  redirect(`${BASE}/deals`);
}

export async function coachAction(_prev: FlipState, fd: FormData): Promise<FlipState> {
  const { session } = await requireFlip();
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { ok: false, message: "Deal nicht gefunden." };
  try {
    await coachDeal(session.tenantId, id.data);
    revalidatePath(`${BASE}/deals/${id.data}`);
    return { ok: true, message: "Einschätzung ist da (unten)." };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

// ---- Marktpreise -------------------------------------------------------------------------------------

export async function addPriceAction(_prev: FlipState, fd: FormData): Promise<FlipState> {
  const { session, brandId } = await requireFlip();
  const reference = str(fd, "reference", 60);
  if (!reference || !normRef(reference)) return { ok: false, message: "Bitte die Referenznummer angeben." };
  const price = parseEuro(String(fd.get("price") ?? ""));
  if (price === null || price <= 0) return { ok: false, message: "Bitte einen gültigen Preis eintragen (z. B. 4.250)." };
  const kind = z.enum(PRICE_KINDS).safeParse(fd.get("kind"));
  if (!kind.success) return { ok: false, message: "Bitte wählen: verkauft, angeboten oder Händler-Ankauf." };
  const d = day(fd, "day") ?? todayIso();
  if (d > todayIso()) return { ok: false, message: "Das Datum liegt in der Zukunft." };
  await db.insert(P).values({
    tenantId: session.tenantId,
    brandId,
    reference,
    refKey: normRef(reference),
    label: str(fd, "label", 120),
    kind: kind.data,
    price,
    day: d,
    condition: z.enum(CONDITIONS).catch("gebraucht").parse(fd.get("condition")),
    fullSet: fd.get("fullSet") === "on",
    source: str(fd, "source", 80),
    url: url(fd),
    note: str(fd, "note", 300),
    createdBy: session.userId,
  });
  revalidatePath(BASE, "layout");
  return { ok: true, message: `Notiert: ${reference} · ${price.toLocaleString("de-DE")} € (${kind.data}).` };
}

export async function deletePriceAction(fd: FormData) {
  const { session } = await requireFlip();
  const id = uuid.parse(fd.get("id"));
  await db.delete(P).where(and(eq(P.tenantId, session.tenantId), eq(P.id, id)));
  revalidatePath(BASE, "layout");
}

// ---- Lernen ------------------------------------------------------------------------------------------

export async function quizAction(_prev: QuizState, fd: FormData): Promise<QuizState> {
  const { session } = await requireFlip();
  const lesson = lessonByKey(String(fd.get("lesson") ?? ""));
  if (!lesson) return null;
  const picked = lesson.quiz.map((_, i) => {
    const v = fd.get(`q${i}`);
    return v === null ? null : Number(v);
  });
  const s = scoreQuiz(lesson, picked);
  await saveQuiz(session.tenantId, session.userId, lesson.key, s.correct, s.total);
  revalidatePath(BASE, "layout");
  return { ...s, picked };
}

export async function lessonDoneAction(fd: FormData) {
  const { session } = await requireFlip();
  const lesson = lessonByKey(String(fd.get("lesson") ?? ""));
  if (!lesson) return;
  await setLessonDone(session.tenantId, session.userId, lesson.key, fd.get("done") === "1");
  revalidatePath(BASE, "layout");
}
