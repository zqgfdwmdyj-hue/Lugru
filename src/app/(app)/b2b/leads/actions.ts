"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireArea } from "@/lib/auth/session";
import { AbverkaufFehler, einstellungen, einstellungenSpeichern } from "@/lib/abverkauf/service";
import { LeadMaschineFehler, ausLieferantensuche, chargeVorbereiten, konfliktFreigeben, leadLoeschenKomplett, leadsBewerten } from "@/lib/abverkauf/lead-maschine";
import { CHARGE_MAX } from "@/lib/abverkauf/logic";

// B35 Lead-Maschine: Aktionen der Seite „Leads“. Nichts hier verschickt etwas – Läufe und Chargen erzeugen nur Leads
// bzw. Entwürfe; Freigabe und Versand bleiben unter Abverkauf/Kampagnen.

const PFAD = "/b2b/leads";
const zurueck = (meldung: string, anker = "", pfad = PFAD): never => redirect(`${pfad}?meldung=${encodeURIComponent(meldung)}${anker}`);
const zahl = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return String(v ?? "").trim() !== "" && Number.isFinite(n) ? n : null;
};
const geld = (v: FormDataEntryValue | null) => {
  const n = zahl(v);
  return n !== null && n > 0 ? Math.round(n * 100) / 100 : null;
};
const liste = (v: FormDataEntryValue | null) => [...new Set(String(v ?? "").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean).map((x) => x.slice(0, 80)))].slice(0, 200);
const txt = (fd: FormData, k: string, n = 300) => String(fd.get(k) ?? "").trim().slice(0, n);

async function mitFehler(fn: () => Promise<string>, anker = "", pfad = PFAD) {
  let text: string;
  try {
    text = await fn();
  } catch (e) {
    if (e instanceof AbverkaufFehler || e instanceof LeadMaschineFehler) zurueck(e.message, anker, pfad);
    throw e;
  }
  revalidatePath(PFAD);
  zurueck(text, anker, pfad);
}

export async function neuBewertenAction() {
  const s = await requireArea("b2b");
  await mitFehler(async () => {
    if (s.readOnly) throw new LeadMaschineFehler("Nur ansehen – nichts geändert.");
    const r = await leadsBewerten(s.tenantId);
    return `${r.bewertet} Leads bewertet, ${r.ausgeschlossen} ausgeschlossen (Schutzregeln).`;
  }, "#liste");
}

export async function lieferantensucheAction() {
  const s = await requireArea("b2b");
  await mitFehler(async () => {
    if (s.readOnly) throw new LeadMaschineFehler("Nur ansehen – nichts geändert.");
    const r = await ausLieferantensuche(s);
    return `Aus der Lieferantensuche: ${r.gefunden} gefunden, ${r.neu} neu, ${r.doppelt + r.zusammengefuehrt} zusammengeführt, ${r.gesperrt} auf der Sperrliste.`;
  }, "#liste");
}

export async function chargeAction(fd: FormData) {
  const s = await requireArea("b2b");
  await mitFehler(async () => {
    if (s.role !== "owner") throw new LeadMaschineFehler("Nur der Inhaber bereitet Chargen vor.");
    return (await chargeVorbereiten(s, Math.round(zahl(fd.get("anzahl")) ?? CHARGE_MAX))).text;
  }, "#liste");
}

export async function laufAction(fd: FormData) {
  const s = await requireArea("b2b");
  const quelle = String(fd.get("quelle") ?? "");
  await mitFehler(async () => {
    if (quelle !== "apify" && quelle !== "places" && quelle !== "impressum") throw new LeadMaschineFehler("Unbekannte Quelle.");
    const { quelleJetzt } = await import("@/lib/abverkauf/lead-quellen");
    const r = await quelleJetzt(s, quelle);
    return r.text;
  }, "#quellen");
}

/** Schutzregeln (Mindestabstand, Listen, Umkreis, Löschfrist) – nur Inhaber. */
export async function schutzregelnAction(fd: FormData) {
  const s = await requireArea("b2b");
  await mitFehler(async () => {
    const cfg = await einstellungen(s.tenantId);
    const q = cfg.leadQuellen;
    const monate = Math.round(zahl(fd.get("abstand")) ?? q.mindestabstandMonate);
    const lokal = Math.round(zahl(fd.get("lokal")) ?? q.umkreisLokalKm);
    const lagerKm = Math.round(zahl(fd.get("lagerkm")) ?? q.umkreisLagerKm);
    await einstellungenSpeichern(s, {
      loeschfristTage: Math.min(1095, Math.max(30, Math.round(zahl(fd.get("loeschfrist")) ?? cfg.loeschfristTage))),
      leadQuellen: {
        ...q,
        mindestabstandMonate: Math.min(36, Math.max(1, monate)),
        umkreisLokalKm: Math.min(1000, Math.max(1, lokal)),
        umkreisLagerKm: Math.min(2000, Math.max(1, lagerKm)),
        konfliktbranchen: liste(fd.get("konflikt")),
        grossmarken: liste(fd.get("grossmarken")),
        sperrNamen: liste(fd.get("sperrnamen")),
        lagerbedingungen: liste(fd.get("lagerbedingungen")),
      },
    });
    await leadsBewerten(s.tenantId);
    return "Schutzregeln gespeichert – Leads neu bewertet.";
  }, "#schutzregeln");
}

/** Stufe 2: rechtliche Prüfung, Quellen an/aus mit Budget, Wochen-Charge – nur Inhaber. */
export async function quellenAction(fd: FormData) {
  const s = await requireArea("b2b");
  await mitFehler(async () => {
    const q = (await einstellungen(s.tenantId)).leadQuellen;
    const am = txt(fd, "geprueftAm", 10);
    const geprueftAm = /^\d{4}-\d{2}-\d{2}$/.test(am) ? am : null;
    const eingabe = txt(fd, "apifyEingabe", 4000);
    if (eingabe) {
      try {
        JSON.parse(eingabe);
      } catch {
        throw new LeadMaschineFehler("Apify-Eingabe ist kein gültiges JSON.");
      }
    }
    await einstellungenSpeichern(s, {
      leadQuellen: {
        ...q,
        rechtlichGeprueftAm: geprueftAm,
        rechtlichGeprueftVon: geprueftAm ? txt(fd, "geprueftVon", 120) : "",
        wochenCharge: { aktiv: fd.get("woche") === "on", anzahl: Math.min(CHARGE_MAX, Math.max(1, Math.round(zahl(fd.get("wocheAnzahl")) ?? 20))) },
        apify: { aktiv: fd.get("apify") === "on", budgetLauf: geld(fd.get("apifyLauf")), budgetMonat: geld(fd.get("apifyMonat")), actorId: txt(fd, "apifyActor", 120), eingabe, maxItems: Math.min(5000, Math.max(1, Math.round(zahl(fd.get("apifyMax")) ?? 200))) },
        places: { aktiv: fd.get("places") === "on", budgetLauf: geld(fd.get("placesLauf")), budgetMonat: geld(fd.get("placesMonat")), suchen: txt(fd, "placesSuchen", 2000), preisJeAbruf: geld(fd.get("placesPreis")) },
        impressum: { ...q.impressum, aktiv: fd.get("impressum") === "on", maxJeLauf: Math.min(200, Math.max(1, Math.round(zahl(fd.get("impressumMax")) ?? 20))) },
      },
    });
    return geprueftAm ? "Quellen gespeichert." : "Quellen gespeichert – Stufe 2 bleibt gesperrt, bis das Datum der rechtlichen Prüfung eingetragen ist.";
  }, "#quellen");
}

export async function konfliktAction(fd: FormData) {
  const s = await requireArea("b2b");
  const id = String(fd.get("id") ?? "");
  await mitFehler(async () => {
    const an = fd.get("an") === "1";
    await konfliktFreigeben(s, id, an);
    return an ? "Konfliktbranche für diesen Lead freigegeben." : "Freigabe zurückgenommen.";
  }, "", `${PFAD}/${id}`);
}

export async function loeschenAction(fd: FormData) {
  const s = await requireArea("b2b");
  const id = String(fd.get("id") ?? "");
  await mitFehler(async () => {
    const r = await leadLoeschenKomplett(s, id);
    return `Lead „${r.firma}“ vollständig gelöscht${r.gesperrt ? " – bleibt auf der Sperrliste (nur Prüfsumme)" : ""}.`;
  }, "#liste");
}

/** Widerspruch / nie wieder anschreiben: Sperrliste (bleibt auch nach dem Löschen). */
export async function sperrenAction(fd: FormData) {
  const s = await requireArea("b2b");
  const id = String(fd.get("id") ?? "");
  await mitFehler(async () => {
    if (s.readOnly) throw new LeadMaschineFehler("Nur ansehen – nichts geändert.");
    const { leadSperren } = await import("@/lib/abverkauf/service");
    await leadSperren(s.tenantId, id, "von Hand gesperrt (Widerspruch)");
    return "Lead gesperrt – kommt in keine Charge mehr.";
  }, "", `${PFAD}/${id}`);
}
