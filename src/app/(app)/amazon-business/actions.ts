"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea, requireOwner } from "@/lib/auth/session";
import { LAENDER } from "@/lib/amazon-markt/logic";
import { leseBusinessReport } from "@/lib/amazon-business/logic";
import { staffelFreigeben, staffelKandidaten, staffelSpeichern, staffelUebertragen, staffelVerwerfen } from "@/lib/amazon-business/service";
import { speichereB2bPeriode } from "@/lib/amazon-business/store";
import { parseAmount, parseDate } from "@/lib/numbers";
import { readTable } from "@/lib/tabular";

const LAND = z.enum(LAENDER as [string, ...string[]]);
const ziel = (land: string, m: string) => `/amazon-business?land=${land}&meldung=${encodeURIComponent(m)}`;

/** Geschäftsbericht (CSV) mit B2B-Spalten hochladen – Zeitraum aus dem Formular. */
export async function berichtHochladenAction(fd: FormData) {
  const session = await requireArea("amazon");
  const land = LAND.parse(fd.get("land"));
  const von = parseDate(String(fd.get("von") ?? ""));
  const bis = parseDate(String(fd.get("bis") ?? ""));
  const datei = fd.get("datei");
  if (!von || !bis || von > bis) redirect(ziel(land, "Zeitraum „von“/„bis“ angeben (TT.MM.JJJJ)."));
  if (!(datei instanceof File) || datei.size === 0) redirect(ziel(land, "Bitte die CSV-Datei auswählen."));
  if (datei.size > 20 * 1024 * 1024) redirect(ziel(land, "Datei zu groß (höchstens 20 MB)."));
  const t = readTable(new Uint8Array(await datei.arrayBuffer()));
  const r = leseBusinessReport(t.headers, t.rows);
  if (r.fehler) redirect(ziel(land, r.fehler));
  const n = await speichereB2bPeriode(session.tenantId, land, von, bis, r.zeilen, "upload");
  revalidatePath("/amazon-business");
  redirect(ziel(land, `${n} ASINs für ${land} eingelesen.`));
}

/** Ausgewählte Vorschläge übernehmen (Status „Vorschlag“) – Preise werden neu gerechnet, nicht aus dem Formular übernommen. */
export async function staffelUebernehmenAction(fd: FormData) {
  const session = await requireArea("amazon");
  const land = LAND.parse(fd.get("land"));
  const skus = fd.getAll("sku").map(String).filter(Boolean);
  const k = await staffelKandidaten(session.tenantId, land);
  let n = 0;
  for (const x of k.filter((c) => skus.includes(c.sku))) {
    if (!x.vorschlag || x.vorschlag.fehler || !x.preis) continue;
    const bp = parseAmount(fd.get(`bp_${x.sku}`));
    await staffelSpeichern(session.tenantId, land, { sku: x.sku, asin: x.asin, titel: x.titel, businessPreis: bp && bp > 0 && x.vorschlag.mindestPreis !== null && bp >= x.vorschlag.mindestPreis ? bp : x.preis, stufen: x.vorschlag.stufen, mindestPreis: x.vorschlag.mindestPreis });
    n++;
  }
  revalidatePath("/amazon-business");
  redirect(ziel(land, n ? `${n} Staffelpreise als Vorschlag gespeichert – zur Freigabe.` : "Nichts ausgewählt (oder EK fehlt)."));
}

/** Freigabe: nur der Inhaber. Erst danach gibt es Upload-Datei und Übertragung. */
export async function staffelFreigebenAction(fd: FormData) {
  const session = await requireOwner();
  const land = LAND.parse(fd.get("land"));
  const skus = fd.getAll("sku").map(String).filter(Boolean);
  const [u] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, session.userId));
  const n = await staffelFreigeben(session.tenantId, land, skus, u?.name ?? "Inhaber");
  revalidatePath("/amazon-business");
  redirect(ziel(land, `${n} freigegeben.`));
}

export async function staffelVerwerfenAction(fd: FormData) {
  const session = await requireArea("amazon");
  const land = LAND.parse(fd.get("land"));
  await staffelVerwerfen(session.tenantId, land, z.string().min(1).max(200).parse(fd.get("verwerfen")));
  revalidatePath("/amazon-business");
  redirect(ziel(land, "Vorschlag verworfen."));
}

/** Über die Schnittstelle setzen – nur freigegebene, nur Inhaber, nur mit Bestätigungshaken. */
export async function staffelUebertragenAction(fd: FormData) {
  const session = await requireOwner();
  const land = LAND.parse(fd.get("land"));
  if (fd.get("bestaetigt") !== "on") redirect(ziel(land, "Bitte bestätigen, dass die freigegebenen Preise an Amazon übertragen werden sollen."));
  const skus = fd.getAll("sku").map(String).filter(Boolean);
  let r: { ok: number; fehler: number };
  try {
    r = await staffelUebertragen(session.tenantId, land, skus);
  } catch (e) {
    redirect(ziel(land, `Übertragung nicht möglich: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300)));
  }
  revalidatePath("/amazon-business");
  redirect(ziel(land, `${r.ok} übertragen${r.fehler ? `, ${r.fehler} mit Fehler (siehe Liste)` : ""}.`));
}
