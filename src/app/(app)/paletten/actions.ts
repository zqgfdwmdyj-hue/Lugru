"use server";

import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { placeAll, type Placement } from "@/lib/pallets/placement";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea, requireOwner } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { parseAmount } from "@/lib/numbers";
import { storeFile } from "@/lib/orders/service";
import { changeRates, chargeableFrom, prevMonth, customerKey, inventoryCompare, nextPalletCodes, normalizeLocation, parseLocations, parseServices, ratesDiffer, storedDays, type RateVersion } from "@/lib/pallets/billing";
import { MONTH_RE, activePickupsFor, dropOrphanPhotoFiles, loadMonthBill, logPalletEvent, palletContext, sendStatement } from "@/lib/pallets/service";
import { listOutgoing } from "@/lib/invoices/outgoing";
import { onceOnly, submitKeyOf } from "@/lib/once";

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
export type ScanState = { ok: boolean; message: string; codes?: string[]; found?: FoundPallet; warn?: string; at?: number } | null;

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
  const [open] = await db.select().from(P).where(and(eq(P.tenantId, tenantId), isNull(P.outAt), isNull(P.cancelledAt), sql`lower(${P.code}) = lower(${code})`));
  return open ?? null;
}

const dmyOf = (iso: string) => iso.split("-").reverse().join(".");

/** Verständliche Meldung, wenn eine Nummer nicht eingelagert ist: schon ausgelagert, storniert oder unbekannt. */
async function notOpenMessage(tenantId: string, code: string): Promise<string> {
  const [last] = await db.select().from(P).where(and(eq(P.tenantId, tenantId), sql`lower(${P.code}) = lower(${code})`)).orderBy(desc(P.inAt), desc(P.createdAt)).limit(1);
  if (!last) return `Palette „${code}“ ist unbekannt – unter dieser Nummer wurde nie etwas eingelagert. Nummer prüfen oder einlagern.`;
  if (last.cancelledAt) return `Palette „${last.code}“ wurde storniert (Fehlbuchung${last.cancelReason ? `: ${last.cancelReason}` : ""}) – nicht eingelagert.`;
  const [pu] = await db.select({ pickedBy: schema.palletPickups.pickedBy }).from(schema.palletPickups).where(and(eq(schema.palletPickups.tenantId, tenantId), isNull(schema.palletPickups.cancelledAt), sql`${schema.palletPickups.palletIds} @> ${JSON.stringify([last.id])}::jsonb`)).limit(1);
  return `Palette „${last.code}“ ist schon ausgelagert – am ${dmyOf(last.outAt!)}${pu ? `, abgeholt von ${pu.pickedBy}` : ""}${last.customer ? ` (${last.customer})` : ""}.`;
}

/** Name für den Verlauf. */
const who = (session: { name?: string | null; email: string }) => session.name || session.email;

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
    if (!open) return { ok: false, message: await notOpenMessage(t, code), at: Date.now() };
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
    if (!open) return { ok: false, message: await notOpenMessage(t, code), at: Date.now() };
    const outAt = day < open.inAt ? open.inAt : day;
    await db.update(P).set({ outAt, updatedAt: new Date() }).where(and(eq(P.id, open.id), eq(P.tenantId, t)));
    await logPalletEvent(t, [open.id], "aus", `Ausgelagert (Scan)${open.location ? ` von ${open.location}` : ""}`, { day: outAt, userName: who(session) });
    revalidatePath("/paletten");
    return { ok: true, message: `Palette ${open.code} ausgelagert${open.customer ? ` (${open.customer})` : ""}${open.location ? ` – Stellplatz ${open.location} ist frei` : ""}.`, codes: [open.code], at: Date.now() };
  }

  // Doppeltipp / zweimal dieselbe Eingabe: nur einmal einlagern (die zweite Anfrage bekommt dieselbe Antwort).
  return onceOnly(t, submitKeyOf(fd), () => storeIn(session, fd, code, day), { ok: false, message: "Wird gerade gebucht – bitte einen Moment warten und nicht erneut tippen.", at: Date.now() });
}

async function storeIn(session: Awaited<ReturnType<typeof requireArea>>, fd: FormData, code: string, day: string): Promise<NonNullable<ScanState>> {
  const t = session.tenantId;
  const customer = await canonicalCustomer(t, text(fd, "customer", 120));
  const note = text(fd, "note", 300);
  const location = normalizeLocation(fd.get("location"));
  const contents = text(fd, "contents", 300);
  const weightKg = amount(fd, "weightKg");
  const count = Math.min(100, Math.max(1, Math.round(Number(fd.get("count")) || 1)));
  const openRows = await db.select({ code: P.code, location: P.location }).from(P).where(and(eq(P.tenantId, t), isNull(P.outAt), isNull(P.cancelledAt)));
  const isOpen = (c: string) => openRows.some((r) => r.code.toLowerCase() === c.toLowerCase());

  let codes: string[];
  const notes: string[] = [];
  if (code) {
    // Mehrere Paletten mit eigener Nummer: jede bekommt eine eigene Kennung (LS-4711-1, LS-4711-2 …).
    codes = count > 1 ? Array.from({ length: count }, (_, i) => `${code}-${i + 1}`) : [code];
    const clash = codes.filter(isOpen);
    if (clash.length) return { ok: false, message: `${clash.length === 1 ? `Palette „${clash[0]}“ ist` : `Paletten ${clash.join(", ")} sind`} schon eingelagert. Zum Auslagern oben „Auslagern“ wählen.`, at: Date.now() };
    const earlier = await db.select({ code: P.code, outAt: P.outAt }).from(P).where(and(eq(P.tenantId, t), isNotNull(P.outAt), isNull(P.cancelledAt), inArray(sql`lower(${P.code})`, codes.map((c) => c.toLowerCase())))).orderBy(desc(P.outAt)).limit(3);
    if (earlier.length) notes.push(`Nummer ${earlier[0].code} war schon einmal eingelagert (ausgelagert am ${dmyOf(earlier[0].outAt!)}) – das hier ist eine neue Palette mit eigenem Verlauf.`);
  } else {
    const all = (await db.select({ code: P.code }).from(P).where(eq(P.tenantId, t))).map((r) => r.code);
    codes = nextPalletCodes(all, count);
  }
  const plan = (await palletContext(t)).settings.locations ?? [];
  if (location && plan.length && !plan.includes(location)) notes.push(`Stellplatz ${location} steht nicht im Lagerplan.`);
  // Mehrere Paletten + ein Platz: vorher entschieden (alle dorthin, verteilen oder ohne Platz) – nie stillschweigend.
  const placementIn = String(fd.get("placement") ?? "");
  const placement: Placement | null = placementIn === "alle" || placementIn === "verteilen" || placementIn === "ohne" ? placementIn : null;
  if (codes.length > 1 && location && !placement) return { ok: false, message: `Bitte wählen, wohin die ${codes.length} Paletten kommen: alle auf ${location}, auf freie Plätze verteilen oder ohne Stellplatz.`, at: Date.now() };
  const placed = placeAll(codes.length, location, placement, plan, openRows.map((r) => r.location).filter((l): l is string => Boolean(l)));
  if (placed.short) notes.push(`Für ${placed.short} Palette${placed.short === 1 ? "" : "n"} war kein freier Platz mehr – ohne Stellplatz eingelagert.`);
  let photoIds: string[];
  try {
    photoIds = await storePhotos(t, fd);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  let inserted: { id: string }[];
  try {
    inserted = await db
      .insert(P)
      .values(codes.map((c, i) => ({ tenantId: t, code: c, customer, note, location: placed.locations[i], contents, weightKg, inAt: day })))
      .returning({ id: P.id });
  } catch (e) {
    // Zwei Geräte gleichzeitig mit derselben Nummer: die Datenbank lässt nur eine offene Palette je Nummer zu.
    if ((e as { code?: string; cause?: { code?: string } }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505") {
      return { ok: false, message: `${codes.length === 1 ? `Palette „${codes[0]}“ ist` : `Eine der Paletten ${codes.join(", ")} ist`} gerade eben schon eingelagert worden (anderes Gerät). Nichts doppelt gebucht.`, at: Date.now() };
    }
    throw e;
  }
  if (photoIds.length) await db.insert(PH).values(inserted.flatMap((p) => photoIds.map((fileId) => ({ tenantId: t, palletId: p.id, fileId }))));
  const usedPlaces = [...new Set(placed.locations.filter((l): l is string => Boolean(l)))];
  const busyAt = usedPlaces.map((loc) => ({ loc, codes: openRows.filter((r) => r.location === loc).map((r) => r.code) })).filter((b) => b.codes.length);
  if (busyAt.length) notes.unshift(busyAt.map((b) => `Achtung: Auf ${b.loc} steht schon ${b.codes.join(", ")}.`).join(" "));
  if (placement === "alle" && codes.length > 1 && location) notes.push(`${codes.length} Paletten bewusst auf einen Platz (${location}).`);
  for (const [i, row] of inserted.entries()) {
    const loc = placed.locations[i];
    await logPalletEvent(t, [row.id], "ein", `Eingelagert${customer ? ` für ${customer}` : ""}${loc ? ` auf ${loc}` : " ohne Stellplatz"}${codes.length > 1 ? ` (eine von ${codes.length}: ${codes[0]} bis ${codes[codes.length - 1]})` : ""}`, { day, userName: who(session) });
  }
  revalidatePath("/paletten");
  const when = day.split("-").reverse().join(".");
  return {
    ok: true,
    message:
      (codes.length === 1 ? `Palette ${codes[0]} eingelagert – Timer läuft ab ${when}.` : `${codes.length} Paletten eingelagert, jede mit eigener Nummer: ${codes.join(", ")}.`) +
      (usedPlaces.length === 1 ? ` Stellplatz ${usedPlaces[0]}.` : usedPlaces.length > 1 ? ` Stellplätze: ${codes.map((c, i) => `${c} → ${placed.locations[i] ?? "ohne"}`).join(", ")}.` : "") +
      (photoIds.length ? ` ${photoIds.length} Foto${photoIds.length === 1 ? "" : "s"} gespeichert.` : ""),
    warn: notes.length ? notes.join(" ") : undefined,
    codes,
    at: Date.now(),
  };
}

/** Knopf in der Liste: Palette ist weg. */
export async function checkOutPallet(fd: FormData) {
  const session = await requireArea("paletten");
  const id = z.string().uuid().parse(fd.get("id"));
  const [p] = await db.select().from(P).where(and(eq(P.id, id), eq(P.tenantId, session.tenantId)));
  if (!p || p.outAt) return;
  const day = readDate(fd.get("date"));
  const reason = text(fd, "reason", 200);
  await db.update(P).set({ outAt: day < p.inAt ? p.inAt : day, updatedAt: new Date() }).where(and(eq(P.id, id), eq(P.tenantId, session.tenantId)));
  await logPalletEvent(session.tenantId, [id], "aus", reason ?? "Ausgelagert („Ist raus“)", { day: day < p.inAt ? p.inAt : day, userName: who(session) });
  revalidatePath("/paletten", "layout");
}

/** Auslagern rückgängig (versehentlich gescannt). */
export async function undoCheckOut(fd: FormData) {
  const session = await requireArea("paletten");
  const id = z.string().uuid().parse(fd.get("id"));
  const [p] = await db.select().from(P).where(and(eq(P.id, id), eq(P.tenantId, session.tenantId)));
  if (!p || !p.outAt || p.cancelledAt) return;
  // Teil eines Abholscheins: nur die ganze Abholung zurücknehmen (sonst widerspricht der Schein dem Bestand).
  if ((await activePickupsFor(session.tenantId, [id])).size) return;
  const [clash] = await db.select({ id: P.id }).from(P).where(and(eq(P.tenantId, session.tenantId), isNull(P.outAt), eq(P.code, p.code)));
  if (clash) return; // Nummer ist inzwischen wieder belegt
  await db.update(P).set({ outAt: null, updatedAt: new Date() }).where(and(eq(P.id, id), eq(P.tenantId, session.tenantId)));
  await logPalletEvent(session.tenantId, [id], "zurueck", `Auslagerung vom ${dmyOf(p.outAt)} zurückgenommen${text(fd, "reason", 200) ? `: ${text(fd, "reason", 200)}` : " (versehentlich ausgelagert)"}`, { userName: who(session) });
  revalidatePath("/paletten", "layout");
}

/** Daten korrigieren (Kunde, Stellplatz, Inhalt, Gewicht, Notiz, Ein-/Auslagerungstag). */
export async function updatePallet(fd: FormData) {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const id = z.string().uuid().parse(fd.get("id"));
  const inAt = isoDate.parse(fd.get("inAt"));
  const [before] = await db.select().from(P).where(and(eq(P.id, id), eq(P.tenantId, t)));
  if (!before || before.cancelledAt) return;
  // Abgeholt (Abholschein mit Unterschrift): Auslagerungstag = Abholtag, hier nicht änderbar.
  if ((await activePickupsFor(t, [id])).size) fd.delete("outAt");
  const outRaw = String(fd.get("outAt") ?? "").trim();
  const outAt = outRaw ? isoDate.parse(outRaw) : null;
  if (outAt && outAt < inAt) return;
  if (fd.has("outAt") === false && before.outAt && before.outAt < inAt) return;
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
  // Was hat sich geändert? Alles in den Verlauf – nichts wird still überschrieben.
  const [after] = await db.select().from(P).where(and(eq(P.id, id), eq(P.tenantId, t)));
  const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "–" : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? dmyOf(String(v)) : String(v));
  const fields: [keyof typeof before, string][] = [["customer", "Kunde"], ["location", "Stellplatz"], ["contents", "Inhalt"], ["weightKg", "Gewicht"], ["note", "Notiz"], ["inAt", "Eingelagert"], ["outAt", "Ausgelagert"]];
  const changes = fields.filter(([k]) => String(before[k] ?? "") !== String(after?.[k] ?? "")).map(([k, label]) => `${label} ${fmt(before[k])} → ${fmt(after?.[k])}`);
  if (changes.length) {
    const onlyPlace = changes.length === 1 && changes[0].startsWith("Stellplatz");
    await logPalletEvent(t, [id], onlyPlace ? "umlagern" : "korrektur", `${onlyPlace ? "Umgelagert" : "Korrigiert"}: ${changes.join(" · ")}${text(fd, "reason", 200) ? ` (Grund: ${text(fd, "reason", 200)})` : ""}`, { userName: who(session) });
  }
  revalidatePath("/paletten", "layout");
  revalidatePath(`/paletten/${id}`);
}

/**
 * Fehlbuchung stornieren statt löschen: die Palette bleibt mit Verlauf und Fotos erhalten, zählt aber
 * in Bestand und Abrechnung nicht mehr; die Nummer wird frei. Grund ist Pflicht.
 */
export async function cancelPallet(fd: FormData) {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const id = z.string().uuid().parse(fd.get("id"));
  const reason = text(fd, "reason", 200) ?? "Fehlbuchung";
  const [p] = await db.select().from(P).where(and(eq(P.id, id), eq(P.tenantId, t)));
  if (!p || p.cancelledAt) return;
  if ((await activePickupsFor(t, [id])).size) return; // erst die Abholung zurücknehmen
  await db.update(P).set({ cancelledAt: new Date(), cancelReason: reason, outAt: p.outAt ?? p.inAt, updatedAt: new Date() }).where(and(eq(P.id, id), eq(P.tenantId, t)));
  await logPalletEvent(t, [id], "storno", `Storniert: ${reason}`, { userName: who(session) });
  revalidatePath("/paletten", "layout");
  if (fd.get("back") === "1") redirect(`/paletten/${id}`);
}

/** Storno zurücknehmen (z. B. versehentlich storniert). */
export async function undoCancelPallet(fd: FormData) {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const id = z.string().uuid().parse(fd.get("id"));
  const [p] = await db.select().from(P).where(and(eq(P.id, id), eq(P.tenantId, t)));
  if (!p?.cancelledAt) return;
  await db.update(P).set({ cancelledAt: null, cancelReason: null, updatedAt: new Date() }).where(and(eq(P.id, id), eq(P.tenantId, t)));
  await logPalletEvent(t, [id], "korrektur", "Storno zurückgenommen", { userName: who(session) });
  revalidatePath("/paletten", "layout");
}

/** Früher: ganz löschen. Jetzt nur noch Storno – der Verlauf bleibt. (Alter Formular-Name bleibt gültig.) */
export async function deletePallet(fd: FormData) {
  if (!fd.get("reason")) fd.set("reason", "Fehlbuchung");
  return cancelPallet(fd);
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
    await logPalletEvent(t, [palletId], "foto", `${ids.length} Foto${ids.length === 1 ? "" : "s"} hinzugefügt`, { userName: who(session) });
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
  // Doppeltipp: dieselbe Leistung nur einmal buchen.
  return onceOnly(session.tenantId, submitKeyOf(fd), () => insertCharge(session, fd), { ok: false, message: "Wird gerade gespeichert – bitte nicht erneut tippen." });
}

async function insertCharge(session: Awaited<ReturnType<typeof requireArea>>, fd: FormData): Promise<NonNullable<ChargeState>> {
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
  if (palletId) await logPalletEvent(t, [palletId], "leistung", `Leistung: ${description} (${String(quantity).replace(".", ",")} × ${unitPrice.toFixed(2).replace(".", ",")} €)`, { day, userName: who(session) });
  revalidatePath("/paletten", "layout");
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

// ---- Abgerechnet → in Rechnung gestellt → bezahlt --------------------------------------------------

const ST = schema.palletStatements;

async function statementRow(tenantId: string, customer: string, month: string) {
  const [row] = await db.select().from(ST).where(and(eq(ST.tenantId, tenantId), eq(ST.month, month), sql`lower(${ST.customer}) = ${customerKey(customer)}`));
  return row ?? null;
}

/**
 * Als „in Rechnung gestellt“ markieren – mit Rechnungsnummer und dem Betrag von jetzt. Ein zweites Mal geht
 * nicht (doppelte Rechnung); ändert sich die Abrechnung danach, zeigt die Abrechnung eine Warnung.
 */
export async function markInvoicedAction(_prev: SendState, fd: FormData): Promise<SendState> {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const month = String(fd.get("month") ?? "");
  const customer = String(fd.get("customer") ?? "").trim();
  const invoiceNo = text(fd, "invoiceNo", 60);
  if (!MONTH_RE.test(month) || !customer) return { ok: false, message: "Monat oder Kunde fehlt." };
  if (!invoiceNo) return { ok: false, message: "Bitte die Rechnungsnummer angeben." };
  const cur = await statementRow(t, customer, month);
  if (cur?.invoicedAt) return { ok: false, message: `Schon in Rechnung gestellt (Nr. ${cur.invoiceNo ?? "?"}, ${cur.invoicedAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}) – keine zweite Rechnung.` };
  const dup = await db.select({ month: ST.month, customer: ST.customer }).from(ST).where(and(eq(ST.tenantId, t), sql`lower(${ST.invoiceNo}) = lower(${invoiceNo})`)).limit(1);
  if (dup.length) return { ok: false, message: `Rechnungsnummer ${invoiceNo} ist schon bei ${dup[0].customer} (${dup[0].month}) eingetragen.` };
  const bill = await loadMonthBill(t, month);
  const group = bill.groups.find((g) => customerKey(g.customer) === customerKey(customer));
  if (!group || group.total <= 0) return { ok: false, message: `Für „${customer}“ ist im Monat nichts abzurechnen.` };
  const known = (await listOutgoing(t, { q: invoiceNo, limit: 5 })).find((r) => r.number.toLowerCase() === invoiceNo.toLowerCase());
  const patch = { invoicedAt: new Date(), invoiceNo, invoicedTotal: group.total };
  if (cur) await db.update(ST).set(patch).where(eq(ST.id, cur.id));
  else await db.insert(ST).values({ tenantId: t, customer: group.customer, month, ...patch });
  revalidatePath("/paletten", "layout");
  return { ok: true, message: `In Rechnung gestellt: Nr. ${invoiceNo} (${group.total.toFixed(2).replace(".", ",")} € netto)${known ? " – Ausgangsrechnung im System gefunden und verknüpft" : ""}.` };
}

export async function markPaidAction(fd: FormData) {
  const session = await requireArea("paletten");
  const month = String(fd.get("month") ?? "");
  const customer = String(fd.get("customer") ?? "").trim();
  const cur = await statementRow(session.tenantId, customer, month);
  if (!cur?.invoicedAt) return;
  await db.update(ST).set({ paidAt: fd.get("undo") ? null : new Date() }).where(eq(ST.id, cur.id));
  revalidatePath("/paletten", "layout");
}

/** Rechnungsvermerk zurücknehmen (z. B. falsche Nummer) – nur Inhaber. */
export async function undoInvoicedAction(fd: FormData) {
  const session = await requireOwner();
  const month = String(fd.get("month") ?? "");
  const customer = String(fd.get("customer") ?? "").trim();
  const cur = await statementRow(session.tenantId, customer, month);
  if (!cur) return;
  await db.update(ST).set({ invoicedAt: null, invoiceNo: null, invoicedTotal: null, paidAt: null }).where(eq(ST.id, cur.id));
  revalidatePath("/paletten", "layout");
}

// ---- Konditionen (nur Inhaber) ---------------------------------------------------------------------

/** Einstellungen der Paletten zusammenführen (nicht ersetzen – sonst gehen Inventur-Stand und Lagerplan verloren). */
async function mergePalletSettings(tenantId: string, patch: Record<string, unknown>) {
  await db
    .update(schema.tenants)
    .set({ settings: sql`${schema.tenants.settings} || jsonb_build_object('pallets', coalesce(${schema.tenants.settings}->'pallets', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)` })
    .where(eq(schema.tenants.id, tenantId));
}
const thisMonth = () => todayIso().slice(0, 7);
const validFromOf = (fd: FormData) => {
  const v = String(fd.get("validFrom") ?? "").trim();
  return MONTH_RE.test(v) ? v : thisMonth();
};

export type SaveState = { ok: boolean; message: string } | null;

/**
 * Standard-Konditionen, Gebühren, Erinnerungen und Leistungen. Preisänderungen gelten ab dem gewählten Monat;
 * frühere Monate rechnen mit den damaligen Konditionen weiter (Verlauf).
 */
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
  const cur = (await palletContext(session.tenantId)).settings;
  const next = { pricePerMonth, freeDays, mode: mode.data, inFee: amount(fd, "inFee") ?? 0, outFee: amount(fd, "outFee") ?? 0 };
  let rateHistory = cur.rateHistory ?? [];
  let note = "";
  if (ratesDiffer(cur, next)) {
    const from = validFromOf(fd);
    const r = changeRates({ pricePerMonth: cur.pricePerMonth, freeDays: cur.freeDays, mode: cur.mode, inFee: cur.inFee ?? 0, outFee: cur.outFee ?? 0 }, rateHistory, from);
    if ("error" in r) return { ok: false, message: r.error };
    rateHistory = r.history;
    note = ` Neue Konditionen gelten ab ${from.slice(5, 7)}/${from.slice(0, 4)} – frühere Monate bleiben wie abgerechnet.`;
  }
  const pricesAre = fd.get("pricesAre") === "brutto" ? "brutto" : "netto";
  await mergePalletSettings(session.tenantId, {
    ...next,
    rateHistory,
    pricesAre,
    capacity,
    longStayDays,
    remindFreeEnd: fd.get("remindFreeEnd") === "on",
    services: parseServices(String(fd.get("services") ?? "")),
    // Lagerplan nur, wenn das Feld mitkommt (er wird jetzt im Lagerplan eingerichtet).
    ...(fd.has("locations") ? { locationsSpec: String(fd.get("locations") ?? "").slice(0, 4000), locations: parseLocations(String(fd.get("locations") ?? "")) } : {}),
  });
  revalidatePath("/paletten", "layout");
  return { ok: true, message: `Gespeichert.${note}` };
}

/** Lagerplan (Stellplätze) direkt im Lagerbereich einrichten. */
export async function saveLocationsAction(_prev: SaveState, fd: FormData): Promise<SaveState> {
  const session = await requireOwner();
  const spec = String(fd.get("locations") ?? "").slice(0, 4000);
  const locations = parseLocations(spec);
  const capacity = Math.max(0, Math.min(100000, Math.round(Number(fd.get("capacity")) || 0)));
  const open = await db.select({ location: P.location }).from(P).where(and(eq(P.tenantId, session.tenantId), isNull(P.outAt), isNull(P.cancelledAt), isNotNull(P.location)));
  const lost = [...new Set(open.map((o) => o.location!))].filter((l) => !locations.includes(l));
  await mergePalletSettings(session.tenantId, { locationsSpec: spec, locations, ...(fd.has("capacity") ? { capacity } : {}) });
  revalidatePath("/paletten", "layout");
  return { ok: true, message: `${locations.length} Stellplätze gespeichert.${lost.length ? ` Belegte Plätze nicht mehr im Plan: ${lost.slice(0, 8).join(", ")} – Paletten bleiben, erscheinen unter „ohne Platz im Plan“.` : ""}` };
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
  const existing = id.success
    ? (await db.select().from(PC).where(and(eq(PC.id, id.data), eq(PC.tenantId, t))))[0]
    : (await db.select().from(PC).where(and(eq(PC.tenantId, t), sql`lower(${PC.name}) = ${customerKey(name)}`)))[0];
  const priceFields = {
    pricePerMonth: amount(fd, "pricePerMonth"),
    freeDays,
    mode: modeRaw === "monat" || modeRaw === "anteilig" ? (modeRaw as "monat" | "anteilig") : null,
    inFee: amount(fd, "inFee"),
    outFee: amount(fd, "outFee"),
  };
  let rateHistory: RateVersion[] = existing?.rateHistory ?? [];
  let note = "";
  if (existing && ratesDiffer(existing, priceFields)) {
    const from = validFromOf(fd);
    const r = changeRates({ pricePerMonth: existing.pricePerMonth, freeDays: existing.freeDays, mode: existing.mode, inFee: existing.inFee, outFee: existing.outFee }, rateHistory, from);
    if ("error" in r) return { ok: false, message: r.error };
    rateHistory = r.history;
    note = ` Neue Konditionen ab ${from.slice(5, 7)}/${from.slice(0, 4)}, frühere Monate unverändert.`;
  } else if (!existing && ratesDiffer({}, priceFields)) {
    // Neuer Kunde mit eigenen Preisen: frühere Monate liefen zum Standard – das bleibt so.
    const from = validFromOf(fd);
    rateHistory = [{ until: prevMonth(from), pricePerMonth: null, freeDays: null, mode: null, inFee: null, outFee: null }];
  }
  const values = {
    name: id.success ? undefined : await canonicalCustomer(t, name),
    email,
    ...priceFields,
    rateHistory,
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
  return { ok: true, message: `${name}: gespeichert.${note}${fd.get("monthlyMail") === "on" && !email ? " Automatisch senden geht erst mit E-Mail-Adresse." : ""}` };
}

/** Eigene Konditionen entfernen – der Kunde rechnet dann wieder zum Standard ab. */
export async function deletePalletCustomer(fd: FormData) {
  const session = await requireOwner();
  const id = z.string().uuid().parse(fd.get("id"));
  await db.delete(PC).where(and(eq(PC.id, id), eq(PC.tenantId, session.tenantId)));
  revalidatePath("/paletten", "layout");
}


// ---- Inventur ---------------------------------------------------------------------------------------

type InvPallet = { id: string; code: string; location: string | null; customer: string | null };
export type InventoryState = {
  ok: boolean;
  message: string;
  expected?: number;
  found?: InvPallet[];
  missing?: InvPallet[];
  unknown?: string[];
  duplicates?: { code: string; times: number }[];
} | null;

/** Gescannte Nummern mit dem Bestand abgleichen: erwartet, gefunden, fehlt, unbekannt, doppelt gescannt. */
export async function inventoryAction(_prev: InventoryState, fd: FormData): Promise<InventoryState> {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  let codes: string[] = [];
  try {
    codes = (JSON.parse(String(fd.get("codes") ?? "[]")) as unknown[]).map((c) => String(c).trim().slice(0, 80)).filter(Boolean).slice(0, 5000);
  } catch {
    return { ok: false, message: "Liste nicht lesbar." };
  }
  if (!codes.length) return { ok: false, message: "Noch nichts gescannt." };
  const open = await db.select({ id: P.id, code: P.code, location: P.location, customer: P.customer }).from(P).where(and(eq(P.tenantId, t), isNull(P.outAt), isNull(P.cancelledAt))).orderBy(P.location, P.code);
  const r = inventoryCompare(codes, open);
  const counts = new Map<string, { code: string; times: number }>();
  for (const c of codes) {
    const k = c.toLowerCase();
    counts.set(k, { code: counts.get(k)?.code ?? c, times: (counts.get(k)?.times ?? 0) + 1 });
  }
  const duplicates = [...counts.values()].filter((x) => x.times > 1);
  const clean = !r.missing.length && !r.unknown.length;
  return {
    ok: true,
    message: clean
      ? `Alles stimmt: ${r.found.length} von ${open.length} erwarteten Paletten gefunden.${duplicates.length ? ` ${duplicates.length} doppelt gescannt (zählt einmal).` : ""}`
      : `Erwartet ${open.length} · gefunden ${r.found.length} · fehlen ${r.missing.length} · unbekannt ${r.unknown.length}${duplicates.length ? ` · doppelt gescannt ${duplicates.length}` : ""}`,
    expected: open.length,
    found: r.found,
    missing: r.missing,
    unknown: r.unknown,
    duplicates,
  };
}

/**
 * Inventur abschließen, nachdem jede Abweichung einzeln entschieden ist: fehlende Paletten „ist raus“
 * (wird ausgelagert) oder „doch da“ / „klären“; unbekannte „einlagern“ (separat) oder „ignorieren“.
 * Alles landet im Verlauf; der Stand wird gespeichert.
 */
export async function finishInventoryAction(_prev: InventoryState, fd: FormData): Promise<InventoryState> {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  let input: { codes: string[]; decisions: Record<string, "raus" | "da" | "klaeren" | "ignorieren" | "einlagern"> };
  try {
    input = JSON.parse(String(fd.get("payload") ?? "{}"));
  } catch {
    return { ok: false, message: "Daten nicht lesbar." };
  }
  const codes = (input.codes ?? []).map((c) => String(c).trim().slice(0, 80)).filter(Boolean).slice(0, 5000);
  const open = await db.select({ id: P.id, code: P.code, location: P.location, customer: P.customer }).from(P).where(and(eq(P.tenantId, t), isNull(P.outAt), isNull(P.cancelledAt)));
  const r = inventoryCompare(codes, open);
  const d = input.decisions ?? {};
  const undecided = [...r.missing.map((p) => p.code), ...r.unknown].filter((c) => !d[c.toLowerCase()]);
  if (undecided.length) return { ok: false, message: `Noch nicht entschieden: ${undecided.slice(0, 8).join(", ")}${undecided.length > 8 ? " …" : ""}` };
  const today = todayIso();
  const by = who(session);
  await logPalletEvent(t, r.found.map((p) => p.id), "inventur", "Inventur: gesehen", { day: today, userName: by });
  const out = r.missing.filter((p) => d[p.code.toLowerCase()] === "raus");
  if (out.length) {
    await db.update(P).set({ outAt: sql`greatest(${P.inAt}, ${today}::date)`, updatedAt: new Date() }).where(and(eq(P.tenantId, t), isNull(P.outAt), inArray(P.id, out.map((p) => p.id))));
    await logPalletEvent(t, out.map((p) => p.id), "aus", "Inventur: nicht gefunden – als ausgelagert bestätigt", { day: today, userName: by });
  }
  const there = r.missing.filter((p) => d[p.code.toLowerCase()] === "da");
  await logPalletEvent(t, there.map((p) => p.id), "inventur", "Inventur: nicht gescannt, aber nachgesehen – ist da", { day: today, userName: by });
  const unclear = r.missing.filter((p) => d[p.code.toLowerCase()] === "klaeren");
  await logPalletEvent(t, unclear.map((p) => p.id), "inventur", "Inventur: nicht gefunden – wird geklärt", { day: today, userName: by });
  const counts = new Map<string, number>();
  for (const c of codes) counts.set(c.toLowerCase(), (counts.get(c.toLowerCase()) ?? 0) + 1);
  const lastInventory = { at: new Date().toISOString(), scanned: r.scanned, found: r.found.length, missing: r.missing.length, unknown: r.unknown.length, duplicates: [...counts.values()].filter((n) => n > 1).length, confirmed: r.missing.length + r.unknown.length };
  await mergeInventory(t, lastInventory);
  revalidatePath("/paletten", "layout");
  return {
    ok: true,
    message: `Inventur abgeschlossen: ${r.found.length} gesehen${out.length ? `, ${out.length} als ausgelagert gebucht` : ""}${there.length ? `, ${there.length} doch da` : ""}${unclear.length ? `, ${unclear.length} zu klären` : ""}${r.unknown.length ? `, ${r.unknown.length} unbekannte entschieden` : ""}.`,
  };
}

async function mergeInventory(tenantId: string, lastInventory: Record<string, unknown>) {
  await db
    .update(schema.tenants)
    .set({ settings: sql`${schema.tenants.settings} || jsonb_build_object('pallets', coalesce(${schema.tenants.settings}->'pallets', '{}'::jsonb) || ${JSON.stringify({ lastInventory })}::jsonb)` })
    .where(eq(schema.tenants.id, tenantId));
}

// ---- Sammel-Abholung mit Unterschrift ----------------------------------------------------------------

export type PickupState = { ok: boolean; message: string; id?: string } | null;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** Mehrere Paletten auf einmal auslagern, Abholer unterschreibt auf dem Handy → Abholschein. */
export async function pickupAction(_prev: PickupState, fd: FormData): Promise<PickupState> {
  const session = await requireArea("paletten");
  // Doppeltipp: ein Abholschein, und die zweite Anfrage zeigt dieselbe Bestätigung (statt „nicht mehr eingelagert“).
  return onceOnly(session.tenantId, submitKeyOf(fd), () => bookPickup(session, fd), { ok: false, message: "Abholung wird gerade gebucht – bitte nicht erneut tippen." });
}

class PickupConflict extends Error {}

async function bookPickup(session: Awaited<ReturnType<typeof requireArea>>, fd: FormData): Promise<NonNullable<PickupState>> {
  const t = session.tenantId;
  const ids = [...new Set(fd.getAll("ids").map(String))].filter((v) => z.string().uuid().safeParse(v).success).slice(0, 500);
  if (!ids.length) return { ok: false, message: "Bitte mindestens eine Palette auswählen oder scannen." };
  const pickedBy = text(fd, "pickedBy", 120);
  if (!pickedBy) return { ok: false, message: "Bitte den Namen des Abholers eintragen." };
  const sig = String(fd.get("signature") ?? "");
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(sig);
  const png = m ? Buffer.from(m[1], "base64") : null;
  if (!png || png.length < 200 || !png.subarray(0, 4).equals(PNG_MAGIC)) return { ok: false, message: "Bitte unterschreiben lassen." };
  if (png.length > 600_000) return { ok: false, message: "Unterschrift zu groß – bitte nochmal." };
  const day = readDate(fd.get("date"));
  const rows = await db.select().from(P).where(and(eq(P.tenantId, t), isNull(P.outAt), isNull(P.cancelledAt), inArray(P.id, ids)));
  if (!rows.length) return { ok: false, message: "Die ausgewählten Paletten sind nicht (mehr) eingelagert." };
  if (rows.length < ids.length) return { ok: false, message: `${ids.length - rows.length} der ausgewählten Paletten sind nicht mehr eingelagert – bitte Auswahl prüfen (Seite neu laden).` };
  // Die Unterschrift gehört zu genau der Auswahl, die beim Unterschreiben zu sehen war.
  if (fd.has("signedCodes")) {
    const signed = String(fd.get("signedCodes") ?? "").split(",").map((c) => c.trim().toLowerCase()).filter(Boolean).sort().join(",");
    const actual = rows.map((r) => r.code.toLowerCase()).sort().join(",");
    if (signed !== actual) return { ok: false, message: "Die Unterschrift passt nicht zur Auswahl (Paletten wurden geändert) – bitte neu unterschreiben." };
  }
  const fileId = await storeFile(t, `unterschrift-${day}.png`, "image/png", png);
  const customers = [...new Set(rows.map((r) => r.customer?.trim()).filter(Boolean))];
  // Auslagern und Abholschein gemeinsam: Hat ein anderes Gerät inzwischen eine dieser Paletten ausgelagert,
  // wird nichts gebucht (kein zweiter Schein, keine halbe Abholung).
  let pickup: { id: string };
  try {
    pickup = await db.transaction(async (tx) => {
      const moved = await tx
        .update(P)
        .set({ outAt: sql`greatest(${P.inAt}, ${day}::date)`, updatedAt: new Date() })
        .where(and(eq(P.tenantId, t), isNull(P.outAt), isNull(P.cancelledAt), inArray(P.id, rows.map((r) => r.id))))
        .returning({ id: P.id });
      if (moved.length !== rows.length) throw new PickupConflict();
      const [pu] = await tx
        .insert(schema.palletPickups)
        .values({
          tenantId: t,
          customer: customers.length === 1 ? customers[0]! : customers.length ? customers.join(", ") : null,
          day,
          pickedBy,
          plate: text(fd, "plate", 30),
          note: text(fd, "note", 300),
          palletIds: rows.map((r) => r.id),
          codes: rows.map((r) => r.code).sort((a, b) => a.localeCompare(b, "de", { numeric: true })),
          signatureFileId: fileId,
        })
        .returning({ id: schema.palletPickups.id });
      return pu;
    });
  } catch (e) {
    if (!(e instanceof PickupConflict)) throw e;
    await db.delete(schema.files).where(and(eq(schema.files.id, fileId), eq(schema.files.tenantId, t)));
    return { ok: false, message: "Ein Teil dieser Paletten wurde gerade auf einem anderen Gerät ausgelagert – nichts gebucht. Bitte Seite neu laden und Auswahl prüfen." };
  }
  await logPalletEvent(t, rows.map((r) => r.id), "abholung", `Abgeholt von ${pickedBy}${text(fd, "plate", 30) ? ` (${text(fd, "plate", 30)})` : ""} – Abholschein mit Unterschrift, ${rows.length} Palette${rows.length === 1 ? "" : "n"}`, { day, userName: who(session) });
  revalidatePath("/paletten", "layout");
  return { ok: true, message: `${rows.length} Palette${rows.length === 1 ? "" : "n"} ausgelagert – Abholschein ist fertig.`, id: pickup.id };
}

/**
 * Abholung zurücknehmen (versehentlich gebucht): die Paletten sind wieder im Lager, der Abholschein bleibt
 * als „storniert“ erhalten, alles steht im Verlauf. Nummern, die inzwischen neu belegt sind, bleiben draußen.
 */
export async function cancelPickupAction(fd: FormData) {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const id = z.string().uuid().parse(fd.get("id"));
  const reason = text(fd, "reason", 200) ?? "versehentlich gebucht";
  const PU = schema.palletPickups;
  const [pu] = await db.select().from(PU).where(and(eq(PU.id, id), eq(PU.tenantId, t)));
  if (!pu || pu.cancelledAt) return;
  const rows = await db.select().from(P).where(and(eq(P.tenantId, t), inArray(P.id, pu.palletIds), isNull(P.cancelledAt)));
  const back: string[] = [];
  for (const r of rows) {
    if (!r.outAt) continue;
    const [clash] = await db.select({ id: P.id }).from(P).where(and(eq(P.tenantId, t), isNull(P.outAt), eq(P.code, r.code)));
    if (clash) continue;
    await db.update(P).set({ outAt: null, updatedAt: new Date() }).where(eq(P.id, r.id));
    back.push(r.id);
  }
  await db.update(PU).set({ cancelledAt: new Date(), cancelReason: reason }).where(eq(PU.id, id));
  await logPalletEvent(t, back, "zurueck", `Abholung vom ${dmyOf(pu.day)} (${pu.pickedBy}) zurückgenommen: ${reason}`, { userName: who(session) });
  revalidatePath("/paletten", "layout");
}
