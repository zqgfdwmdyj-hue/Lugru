"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireArea } from "@/lib/auth/session";
import type { Zielgruppe } from "@/lib/abverkauf/kampagne-logic";
import { AbverkaufFehler } from "@/lib/abverkauf/service";

// B34.3b Kampagnen: anlegen, Einstellungen/Filter, Produkte (MHD/Charge), Entwürfe für Leads im Filter.

const BASIS = "/b2b/abverkauf/kampagnen";
const zahl = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").trim().replace(",", "."));
  return String(v ?? "").trim() && Number.isFinite(n) ? n : null;
};

async function lauf(ziel: string, fn: () => Promise<string>, anker = "") {
  let m: string;
  try {
    m = await fn();
  } catch (e) {
    if (e instanceof AbverkaufFehler) m = e.message;
    else throw e;
  }
  revalidatePath(ziel);
  redirect(`${ziel}?meldung=${encodeURIComponent(m)}${anker}`);
}

export async function kampagneNeuAction(fd: FormData) {
  const s = await requireArea("b2b");
  const { kampagneAnlegen } = await import("@/lib/abverkauf/kampagnen");
  const zg = (["amazon_haendler", "friseure", "spielwaren", "adelprep_lager", "sonstige"] as const).find((x) => x === fd.get("zielgruppe")) ?? "sonstige";
  let id = "";
  try {
    id = await kampagneAnlegen(s, { name: String(fd.get("name") ?? ""), zielgruppe: zg as Zielgruppe, nachfass: fd.get("nachfass") === "on" });
  } catch (e) {
    if (e instanceof AbverkaufFehler) redirect(`${BASIS}?meldung=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath(BASIS);
  redirect(`${BASIS}/${id}?meldung=${encodeURIComponent("Kampagne angelegt – Produkte wählen, Filter prüfen, Entwürfe erstellen.")}`);
}

export async function kampagneSpeichernAction(fd: FormData) {
  const s = await requireArea("b2b");
  const id = String(fd.get("id") ?? "");
  const { kampagneSpeichern } = await import("@/lib/abverkauf/kampagnen");
  await lauf(`${BASIS}/${id}`, async () => {
    await kampagneSpeichern(s, id, {
      name: String(fd.get("name") ?? ""),
      brieftext: String(fd.get("brieftext") ?? ""),
      aufschlagProzent: zahl(fd.get("aufschlag")) ?? undefined,
      mindestRestlaufzeitMonate: zahl(fd.get("mhdMonate")) ?? undefined,
      nachfassTage: fd.get("nachfass") === "on" ? (zahl(fd.get("nachfassTage")) ?? 21) : null,
      filter: { branche: String(fd.get("branche") ?? "").trim() || null, plz: String(fd.get("plz") ?? "").trim() || null, umkreisKm: zahl(fd.get("umkreis")), groesse: String(fd.get("groesse") ?? "").trim() || null, status: fd.getAll("status").map(String).filter(Boolean), nurAdelprep: fd.get("nurAdelprep") === "on" },
    });
    return "Kampagne gespeichert.";
  }, "#einstellungen");
}

export async function positionenAction(fd: FormData) {
  const s = await requireArea("b2b");
  const id = String(fd.get("id") ?? "");
  const { positionenSetzen } = await import("@/lib/abverkauf/kampagnen");
  const skus = fd.getAll("sku").map(String);
  await lauf(`${BASIS}/${id}`, async () => {
    const r = await positionenSetzen(s, id, skus.map((sku) => ({ sku, menge: zahl(fd.get(`menge_${sku}`)) ?? 0, mindestmenge: zahl(fd.get(`mindest_${sku}`)) ?? 1, mhd: String(fd.get(`mhd_${sku}`) ?? "") || null, charge: String(fd.get(`charge_${sku}`) ?? "") || null })));
    return `${r.angeboten} Positionen angeboten${r.nicht ? `, ${r.nicht} nicht angeboten (MHD/Charge/Einstand)` : ""}.`;
  }, "#produkte");
}

export async function punkteAction(fd: FormData) {
  const s = await requireArea("b2b");
  const id = String(fd.get("id") ?? "");
  const { kampagneSpeichern } = await import("@/lib/abverkauf/kampagnen");
  const { OFFENE_PUNKTE_LAGER } = await import("@/lib/abverkauf/kampagne-logic");
  await lauf(`${BASIS}/${id}`, async () => {
    await kampagneSpeichern(s, id, { offenePunkte: Object.fromEntries(OFFENE_PUNKTE_LAGER.map((p, i) => [p, fd.get(`p${i}`) === "on"])) });
    return "Offene Punkte gespeichert.";
  }, "#lager");
}

export async function kampagneEntwuerfeAction(fd: FormData) {
  const s = await requireArea("b2b");
  const id = String(fd.get("id") ?? "");
  const { kampagneEntwuerfe } = await import("@/lib/abverkauf/kampagnen");
  await lauf(`${BASIS}/${id}`, async () => (await kampagneEntwuerfe(s, id, fd.getAll("lead").map(String))).text + " Freigabe und Versand unter Abverkauf → Anschreiben.", "#leads");
}
