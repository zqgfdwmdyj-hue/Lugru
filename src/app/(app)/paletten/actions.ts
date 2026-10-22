"use server";

import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea, requireOwner } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { parseAmount } from "@/lib/numbers";
import { storeFile } from "@/lib/orders/service";
import { chargeableFrom, customerKey, nextPalletCodes, normalizeLocation, parseServices, storedDays } from "@/lib/pallets/billing";
import { MONTH_RE, dropOrphanPhotoFiles, palletContext, sendStatement } from "@/lib/pallets/service";

const P = schema.pallets;
const PH = schema.palletPhotos;
const PC = schema.palletCustomers;
const CH = schema.palletCharges;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export type FoundPallet = {
  id: string;
  code: string;
  customer: string | null;
  location: string | null;
  contents: string | null;
  weightKg: number | null;
  inAt: string;
  days: number;
  chargeableFrom: string;
  photos: number;
};
export type ScanState = { ok: boolean; message: string; codes?: string[]; found?: FoundPallet; warn?: string } | null;

function readDate(v: FormDataEntryValue | null): string {
  const s = String(v ?? "").trim();
  const today = todayIso();
  // Kein Datum in der Zukunft – sonst stimmt die Abrechnung nicht.
  return isoDate.safeParse(s).success && s <= today ? s : today;
}
const text = (fd: FormData, key: string, max: number) => String(fd.get(key) ?? "").trim().slice(0, max) || null;
const amount = (fd: FormData, key: string) => {
  const v = parseAmount(fd.get(key));
  return v === null || !Number.isFinite(v) || v < 0 ? null : Math.round(v * 100) / 100;
};

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTOS = 8;

/** Hochgeladene Fotos prüfen und speichern – gibt die Datei-IDs zurück. */
async function storePhotos(tenantId: string, fd: FormData): Promise<string[]> {
  const files = fd.getAll("photos").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && f.size > 0);
  if (files.length > MAX_PHOTOS) throw new Error(`Höchstens ${MAX_PHOTOS} Fotos auf einmal.`);
  const ids: string[] = [];
  for (const f of files) {
    if (!PHOTO_TYPES.has(f.type)) throw new Error(`„${f.name}“: bitte ein Foto (JPG, PNG oder WebP).`);
    if (f.size > 8 * 1024 * 1024) throw new Error(`„${f.name}“ ist größer als 8 MB.`);
    // Dateiname nur mit einfachen Zeichen – er landet später im Download-Header.
    const name = (f.name || "palette.jpg").normalize("NFKD").replace(/[^\w.-]+/g, "_").slice(-120) || "palette.jpg";
    ids.push(await storeFile(tenantId, name, f.type, Buffer.from(await f.arrayBuffer())));
  }
  return ids;
}

/** Gleicher Kunde = gleiche Schreibweise (sonst zerfällt die Abrechnung in „Müller“ und „müller“). */
async function canonicalCustomer(tenantId: string, name: string | null): Promise<string | null> {
  if (!name) return null;
  const key = customerKey(name);
  const [known] = await db.select({ name: PC.name }).from(PC).where(and(eq(PC.tenantId, tenantId), sql`lower(${PC.name}) = ${key}`));
  if (known) return known.name;
  const [used] = await db.select({ name: P.customer }).from(P).where(and(eq(P.tenantId, tenantId), sql`lower(trim(${P.customer})) = ${key}`)).limit(1);
  return used?.name?.trim() || name;
}

async function findOpen(tenantId: string, code: string) {
  const [open] = await db.select().from(P).where(and(eq(P.tenantId, tenantId), isNull(P.outAt), sql`lower(${P.code}) = lower(${code})`));
  return open ?? null;
}

/**
 * Scan-Feld: Einlagern (neue Palette, Timer startet), Auslagern (Timer stoppt) oder Suchen
 * (wo steht sie, was ist drauf). Leere Nummer beim Einlagern = automatisch P-0001, P-0002 …
 */
export async function scanPallet(_prev: ScanState, fd: FormData): Promise<ScanState> {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const mode = z.enum(["ein", "aus", "suchen"]).parse(fd.get("mode"));
  const code = String(fd.get("code") ?? "").trim().slice(0, 80);
  const day = readDate(fd.get("date"));

  if (mode === "suchen") {
    if (!code) return { ok: false, message: "Bitte Palettennummer scannen oder eingeben." };
    const open = await findOpen(t, code);
    if (!open) return { ok: false, message: `Palette „${code}“ ist nicht eingelagert.` };
    const ctx = await palletContext(t);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(PH).where(and(eq(PH.tenantId, t), eq(PH.palletId, open.id)));
    return {
      ok: true,
      message: `${open.code}${open.location ? ` steht auf ${open.location}` : " – kein Stellplatz eingetragen"}.`,
      found: {
        id: open.id,
        code: open.code,
        customer: open.customer,
        location: open.location,
        contents: open.contents,
        weightKg: open.weightKg,
        inAt: open.inAt,
        days: storedDays(open, todayIso()),
        chargeableFrom: chargeableFrom(open.inAt, ctx.ratesOf(open.customer).freeDays),
        photos: n,
      },
    };
  }

  if (mode === "aus") {
    if (!code) return { ok: false, message: "Bitte Palettennummer scannen oder eingeben." };
    const open = await findOpen(t, code);
    if (!open) return { ok: false, message: `Palette „${code}“ ist nicht eingelagert.` };
    const outAt = day < open.inAt ? open.inAt : day;
    await db.update(P).set({ outAt, updatedAt: new Date() }).where(and(eq(P.id, open.id), eq(P.tenantId, t)));
    revalidatePath("/paletten");
    return { ok: true, message: `Palette ${open.code} ausgelagert${open.customer ? ` (${open.customer})` : ""}${open.location ? ` – Stellplatz ${open.location} ist frei` : ""}.`, codes: [open.code] };
  }

  const customer = await canonicalCustomer(t, text(fd, "customer", 120));
  const note = text(fd, "note", 300);
  const location = normalizeLocation(fd.get("location"));
  const contents = text(fd, "contents", 300);
  const weightKg = amount(fd, "weightKg");
  const count = Math.min(100, Math.max(1, Math.round(Number(fd.get("count")) || 1)));
  const openRows = await db.select({ code: P.code, location: P.location }).from(P).where(and(eq(P.tenantId, t), isNull(P.outAt)));

  let codes: string[];
  if (code) {
    if (count > 1) return { ok: false, message: "Mehrere Paletten auf einmal nur ohne Nummer (dann werden Nummern vergeben)." };
    if (openRows.some((r) => r.code.toLowerCase() === code.toLowerCase())) return { ok: false, message: `Palette „${code}“ ist schon eingelagert. Zum Auslagern oben „Auslagern“ wählen.` };
    codes = [code];
  } else {
    const all = (await db.select({ code: P.code }).from(P).where(eq(P.tenantId, t))).map((r) => r.code);
    codes = nextPalletCodes(all, count);
  }
  let photoIds: string[];
  try {
    photoIds = await storePhotos(t, fd);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  const inserted = await db
    .insert(P)
    .values(codes.map((c) => ({ tenantId: t, code: c, customer, note, location, contents, weightKg, inAt: day })))
    .returning({ id: P.id });
  if (photoIds.length) await db.insert(PH).values(inserted.flatMap((p) => photoIds.map((fileId) => ({ tenantId: t, palletId: p.id, fileId }))));
  const busy = location ? openRows.filter((r) => r.location === location).map((r) => r.code) : [];
  revalidatePath("/paletten");
  const when = day.split("-").reverse().join(".");
  return {
    ok: true,
    message:
      (codes.length === 1 ? `Palette ${codes[0]} eingelagert – Timer läuft ab ${when}.` : `${codes.length} Paletten eingelagert: ${codes[0]} bis ${codes[codes.length - 1]}.`) +
      (location ? ` Stellplatz ${location}.` : "") +
      (photoIds.length ? ` ${photoIds.length} Foto${photoIds.length === 1 ? "" : "s"} gespeichert.` : ""),
    warn: busy.length ? `Achtung: Auf ${location} steht schon ${busy.join(", ")}.` : undefined,
    codes,
  };
}

/** Knopf in der Liste: Palette ist weg. */
export async function checkOutPallet(fd: FormData) {
  const session = await requireArea("paletten");
  const id = z.string().uuid().parse(fd.get("id"));
  const [p] = await db.select().from(P).where(and(eq(P.id, id), eq(P.tenantId, session.tenantId)));
  if (!p || p.outAt) return;
  const day = readDate(fd.get("date"));
  await db.update(P).set({ outAt: day < p.inAt ? p.inAt : day, updatedAt: new Date() }).where(and(eq(P.id, id), eq(P.tenantId, session.tenantId)));
  revalidatePath("/paletten");
}

/** Auslagern rückgängig (versehentlich gescannt). */
export async function undoCheckOut(fd: FormData) {
  const session = await requireArea("paletten");
  const id = z.string().uuid().parse(fd.get("id"));
  const [p] = await db.select().from(P).where(and(eq(P.id, id), eq(P.tenantId, session.tenantId)));
  if (!p || !p.outAt) return;
  const [clash] = await db.select({ id: P.id }).from(P).where(and(eq(P.tenantId, session.tenantId), isNull(P.outAt), eq(P.code, p.code)));
  if (clash) return; // Nummer ist inzwischen wieder belegt
  await db.update(P).set({ outAt: null, updatedAt: new Date() }).where(and(eq(P.id, id), eq(P.tenantId, session.tenantId)));
  revalidatePath("/paletten");
}

/** Daten korrigieren (Kunde, Stellplatz, Inhalt, Gewicht, Notiz, Ein-/Auslagerungstag). */
export async function updatePallet(fd: FormData) {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const id = z.string().uuid().parse(fd.get("id"));
  const inAt = isoDate.parse(fd.get("inAt"));
  const outRaw = String(fd.get("outAt") ?? "").trim();
  const outAt = outRaw ? isoDate.parse(outRaw) : null;
  if (outAt && outAt < inAt) return;
  if (outAt === null && fd.has("outAt")) {
    // Wieder „im Lager“ nur, wenn die Nummer nicht inzwischen neu belegt ist.
    const [p] = await db.select({ code: P.code }).from(P).where(and(eq(P.id, id), eq(P.tenantId, t)));
    const [clash] = p ? await db.select({ id: P.id }).from(P).where(and(eq(P.tenantId, t), isNull(P.outAt), eq(P.code, p.code), ne(P.id, id))) : [];
    if (clash) return;
  }
  await db
    .update(P)
    .set({
      inAt,
      ...(fd.has("outAt") ? { outAt } : {}),
      customer: await canonicalCustomer(t, text(fd, "customer", 120)),
      note: text(fd, "note", 300),
      ...(fd.has("location") ? { location: normalizeLocation(fd.get("location")) } : {}),
      ...(fd.has("contents") ? { contents: text(fd, "contents", 300) } : {}),
      ...(fd.has("weightKg") ? { weightKg: amount(fd, "weightKg") } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(P.id, id), eq(P.tenantId, t)));
  revalidatePath("/paletten");
  revalidatePath(`/paletten/${id}`);
}

export async function deletePallet(fd: FormData) {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const id = z.string().uuid().parse(fd.get("id"));
  const files = await db.select({ fileId: PH.fileId }).from(PH).where(and(eq(PH.tenantId, t), eq(PH.palletId, id)));
  await db.delete(P).where(and(eq(P.id, id), eq(P.tenantId, t)));
  await dropOrphanPhotoFiles(t, files.map((f) => f.fileId));
  revalidatePath("/paletten");
  if (fd.get("back") === "1") redirect("/paletten#ausgelagert");
}

// ---- Fotos ----------------------------------------------------------------------------------------

export type PhotoState = { ok: boolean; message: string } | null;

export async function addPalletPhotos(_prev: PhotoState, fd: FormData): Promise<PhotoState> {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const palletId = z.string().uuid().parse(fd.get("palletId"));
  const [p] = await db.select({ id: P.id }).from(P).where(and(eq(P.id, palletId), eq(P.tenantId, t)));
  if (!p) return { ok: false, message: "Palette nicht gefunden." };
  try {
    const ids = await storePhotos(t, fd);
    if (!ids.length) return { ok: false, message: "Kein Foto ausgewählt." };
    await db.insert(PH).values(ids.map((fileId) => ({ tenantId: t, palletId, fileId })));
    revalidatePath(`/paletten/${palletId}`);
    revalidatePath("/paletten");
    return { ok: true, message: `${ids.length} Foto${ids.length === 1 ? "" : "s"} gespeichert.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function deletePalletPhoto(fd: FormData) {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const palletId = z.string().uuid().parse(fd.get("palletId"));
  const fileId = z.string().uuid().parse(fd.get("fileId"));
  await db.delete(PH).where(and(eq(PH.tenantId, t), eq(PH.palletId, palletId), eq(PH.fileId, fileId)));
  await dropOrphanPhotoFiles(t, [fileId]);
  revalidatePath(`/paletten/${palletId}`);
}

// ---- Zusatzleistungen -----------------------------------------------------------------------------

export type ChargeState = { ok: boolean; message: string } | null;

export async function addCharge(_prev: ChargeState, fd: FormData): Promise<ChargeState> {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const description = text(fd, "description", 120);
  if (!description) return { ok: false, message: "Bitte Leistung angeben (z. B. Folieren)." };
  const quantity = parseAmount(fd.get("quantity")) ?? 1;
  const unitPrice = parseAmount(fd.get("unitPrice"));
  if (!(quantity > 0) || quantity > 10000) return { ok: false, message: "Menge bitte größer als 0." };
  if (unitPrice === null || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 100000) return { ok: false, message: "Bitte Preis je Einheit angeben." };
  let palletId: string | null = null;
  let customer = text(fd, "customer", 120);
  const palletRef = text(fd, "pallet", 80);
  if (palletRef) {
    const byId = z.string().uuid().safeParse(palletRef);
    const [p] = await db
      .select({ id: P.id, customer: P.customer })
      .from(P)
      .where(and(eq(P.tenantId, t), byId.success ? eq(P.id, byId.data) : sql`lower(${P.code}) = lower(${palletRef})`))
      .orderBy(sql`${P.outAt} is null desc`, sql`${P.inAt} desc`)
      .limit(1);
    if (!p) return { ok: false, message: `Palette „${palletRef}“ nicht gefunden.` };
    palletId = p.id;
    customer = customer ?? p.customer;
  }
  customer = await canonicalCustomer(t, customer);
  if (!customer) return { ok: false, message: "Bitte Kunde angeben." };
  const day = readDate(fd.get("day"));
  await db.insert(CH).values({ tenantId: t, palletId, customer, day, description, quantity: Math.round(quantity * 100) / 100, unitPrice: Math.round(unitPrice * 100) / 100 });
  revalidatePath("/paletten");
  if (palletId) revalidatePath(`/paletten/${palletId}`);
  const sum = (quantity * unitPrice).toFixed(2).replace(".", ",");
  return { ok: true, message: `${description} für ${customer} erfasst (${sum} €).` };
}

export async function deleteCharge(fd: FormData) {
  const session = await requireArea("paletten");
  const id = z.string().uuid().parse(fd.get("id"));
  await db.delete(CH).where(and(eq(CH.id, id), eq(CH.tenantId, session.tenantId)));
  revalidatePath("/paletten", "layout");
}

// ---- Monatsaufstellung per Mail -------------------------------------------------------------------

export type SendState = { ok: boolean; message: string } | null;

export async function sendStatementAction(_prev: SendState, fd: FormData): Promise<SendState> {
  const session = await requireArea("paletten");
  const month = String(fd.get("month") ?? "");
  const customer = String(fd.get("customer") ?? "").trim();
  if (!MONTH_RE.test(month) || !customer) return { ok: false, message: "Monat oder Kunde fehlt." };
  const res = await sendStatement(session.tenantId, customer, month, { today: todayIso() });
  revalidatePath("/paletten");
  return res;
}

// ---- Konditionen (nur Inhaber) ---------------------------------------------------------------------

export type SaveState = { ok: boolean; message: string } | null;

/** Standard-Konditionen, Gebühren, Stellplätze, Erinnerungen und Leistungen. */
export async function savePalletRates(_prev: SaveState, fd: FormData): Promise<SaveState> {
  const session = await requireOwner();
  const pricePerMonth = amount(fd, "pricePerMonth");
  const freeDays = Math.round(Number(fd.get("freeDays")));
  const mode = z.enum(["monat", "anteilig"]).safeParse(fd.get("mode"));
  if (pricePerMonth === null || pricePerMonth > 10000) return { ok: false, message: "Preis je Stellplatz bitte als Zahl." };
  if (!Number.isFinite(freeDays) || freeDays < 0 || freeDays > 365) return { ok: false, message: "Kostenfreie Tage: 0 bis 365." };
  if (!mode.success) return { ok: false, message: "Bitte Abrechnungsart wählen." };
  const capacity = Math.max(0, Math.min(100000, Math.round(Number(fd.get("capacity")) || 0)));
  const longStayDays = Math.max(0, Math.min(3650, Math.round(Number(fd.get("longStayDays")) || 0)));
  const pallets = {
    pricePerMonth,
    freeDays,
    mode: mode.data,
    inFee: amount(fd, "inFee") ?? 0,
    outFee: amount(fd, "outFee") ?? 0,
    capacity,
    longStayDays,
    remindFreeEnd: fd.get("remindFreeEnd") === "on",
    services: parseServices(String(fd.get("services") ?? "")),
  };
  await db
    .update(schema.tenants)
    .set({ settings: sql`${schema.tenants.settings} || ${JSON.stringify({ pallets })}::jsonb` })
    .where(eq(schema.tenants.id, session.tenantId));
  revalidatePath("/paletten", "layout");
  return { ok: true, message: "Gespeichert." };
}

/** Kunde mit eigenen Konditionen und E-Mail anlegen oder ändern. Leere Felder = Standard. */
export async function savePalletCustomer(_prev: SaveState, fd: FormData): Promise<SaveState> {
  const session = await requireOwner();
  const t = session.tenantId;
  const id = z.string().uuid().safeParse(fd.get("id"));
  const name = text(fd, "name", 120);
  if (!name) return { ok: false, message: "Bitte Kundennamen angeben." };
  const email = text(fd, "email", 200);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: "E-Mail-Adresse prüfen." };
  const freeRaw = String(fd.get("freeDays") ?? "").trim();
  const freeDays = freeRaw === "" ? null : Math.round(Number(freeRaw));
  if (freeDays !== null && (!Number.isFinite(freeDays) || freeDays < 0 || freeDays > 365)) return { ok: false, message: "Kostenfreie Tage: 0 bis 365." };
  const modeRaw = String(fd.get("mode") ?? "");
  const values = {
    name: id.success ? undefined : await canonicalCustomer(t, name),
    email,
    pricePerMonth: amount(fd, "pricePerMonth"),
    freeDays,
    mode: modeRaw === "monat" || modeRaw === "anteilig" ? (modeRaw as "monat" | "anteilig") : null,
    inFee: amount(fd, "inFee"),
    outFee: amount(fd, "outFee"),
    monthlyMail: fd.get("monthlyMail") === "on" && Boolean(email),
    updatedAt: new Date(),
  };
  if (id.success) {
    const { name: _n, ...rest } = values;
    await db.update(PC).set(rest).where(and(eq(PC.id, id.data), eq(PC.tenantId, t)));
  } else {
    const [dup] = await db.select({ id: PC.id }).from(PC).where(and(eq(PC.tenantId, t), sql`lower(${PC.name}) = ${customerKey(name)}`));
    if (dup) await db.update(PC).set({ ...values, name: undefined }).where(eq(PC.id, dup.id));
    else await db.insert(PC).values({ ...values, name: values.name ?? name, tenantId: t });
  }
  revalidatePath("/paletten", "layout");
  return { ok: true, message: `${name}: gespeichert.${fd.get("monthlyMail") === "on" && !email ? " Automatisch senden geht erst mit E-Mail-Adresse." : ""}` };
}

/** Eigene Konditionen entfernen – der Kunde rechnet dann wieder zum Standard ab. */
export async function deletePalletCustomer(fd: FormData) {
  const session = await requireOwner();
  const id = z.string().uuid().parse(fd.get("id"));
  await db.delete(PC).where(and(eq(PC.id, id), eq(PC.tenantId, session.tenantId)));
  revalidatePath("/paletten", "layout");
}

