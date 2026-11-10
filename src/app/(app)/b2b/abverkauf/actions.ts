"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireArea } from "@/lib/auth/session";
import { AbverkaufFehler, chargeVerschickt, einstellungenSpeichern, entwuerfeErstellen, freigeben, leadAendern, leadLoeschen, leadSperren, leadsImportieren, preislisteErzeugen, anschreibenAendern } from "@/lib/abverkauf/service";

const PFAD = "/b2b/abverkauf";
const zurueck = (meldung: string, anker = ""): never => redirect(`${PFAD}?meldung=${encodeURIComponent(meldung)}${anker}`);
const zahl = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

async function mitFehler(fn: () => Promise<string>, anker = "") {
  let text: string;
  try {
    text = await fn();
  } catch (e) {
    if (e instanceof AbverkaufFehler) zurueck(e.message, anker);
    throw e;
  }
  revalidatePath(PFAD);
  zurueck(text, anker);
}

export async function einstellungenAction(fd: FormData) {
  const s = await requireArea("b2b");
  await mitFehler(async () => {
    await einstellungenSpeichern(s, {
      rechtlichGeprueft: fd.get("rechtlichGeprueft") === "on",
      tageslimit: Math.min(200, Math.max(1, Math.round(zahl(fd.get("tageslimit")) || 20))),
      aufschlagProzent: Math.min(200, Math.max(0, zahl(fd.get("aufschlag")) || 0)),
      loeschfristTage: Math.min(1095, Math.max(30, Math.round(zahl(fd.get("loeschfrist")) || 180))),
      kriterien: { reichweiteTage: Math.max(1, Math.round(zahl(fd.get("reichweite")) || 90)), lagerTage: Math.max(1, Math.round(zahl(fd.get("lagertage")) || 60)), kapital: Math.max(0, zahl(fd.get("kapital")) || 300) },
    });
    return "Einstellungen gespeichert.";
  }, "#einstellungen");
}

export async function preislisteAction(fd: FormData) {
  const s = await requireArea("b2b");
  const skus = fd.getAll("sku").map(String);
  const mengen: Record<string, number> = {};
  for (const sku of skus) mengen[sku] = Math.round(zahl(fd.get(`menge_${sku}`)));
  let id: string;
  try {
    id = await preislisteErzeugen(s, { skus, aufschlagProzent: zahl(fd.get("aufschlag")), mengen });
  } catch (e) {
    if (e instanceof AbverkaufFehler) zurueck(e.message, "#preisliste");
    throw e;
  }
  revalidatePath(PFAD);
  redirect(`${PFAD}?meldung=${encodeURIComponent(`Preisliste erzeugt (${skus.length} Positionen) – PDF und Excel stehen bereit.`)}&pl=${id!}#preisliste`);
}

export async function leadsImportAction(fd: FormData) {
  const s = await requireArea("b2b");
  const f = fd.get("datei");
  if (!(f instanceof File) || !f.size) zurueck("Bitte eine CSV- oder Excel-Datei wählen.", "#leads");
  const datei = f as File;
  await mitFehler(async () => {
    const r = await leadsImportieren(s, { name: datei.name, bytes: new Uint8Array(await datei.arrayBuffer()), quelle: String(fd.get("quelle") ?? ""), quelleDatum: String(fd.get("datum") ?? "") });
    return `${r.neu} Leads neu, ${r.doppelt} schon vorhanden, ${r.gesperrt} auf der Sperrliste${r.ohneMail ? `, ${r.ohneMail} E-Mail(s) verworfen (Quelle nicht Impressum)` : ""}${r.verworfen.length ? ` · ${r.verworfen.length} Zeilen verworfen: ${r.verworfen.slice(0, 3).join("; ")}` : ""}.`;
  }, "#leads");
}

export async function leadAction(fd: FormData) {
  const s = await requireArea("b2b");
  const id = String(fd.get("id") ?? "");
  const was = String(fd.get("was") ?? "");
  await mitFehler(async () => {
    if (was === "sperren") {
      await leadSperren(s.tenantId, id, "von Hand gesperrt (Widerspruch)");
      return "Lead gesperrt – auf der Sperrliste, wird nicht mehr angeschrieben.";
    }
    if (was === "loeschen") {
      await leadLoeschen(s, id);
      return "Lead gelöscht.";
    }
    const kw = fd.get("kontaktweg");
    await leadAendern(s, id, { kontaktweg: kw === "email" ? "email" : kw === "brief" ? "brief" : undefined, einwilligung: fd.has("einwilligung") ? String(fd.get("einwilligung") ?? "") : undefined, bestandskunde: fd.has("bestandskunde_da") ? fd.get("bestandskunde") === "on" : undefined });
    return "Lead gespeichert.";
  }, "#leads");
}

export async function entwuerfeAction(fd: FormData) {
  const s = await requireArea("b2b");
  const ids = fd.getAll("lead").map(String);
  await mitFehler(async () => (await entwuerfeErstellen(s, ids, String(fd.get("preisliste") ?? "") || null)).text, "#anschreiben");
}

export async function freigebenAction(fd: FormData) {
  const s = await requireArea("b2b");
  const ids = fd.getAll("anschreiben").map(String);
  await mitFehler(async () => (await freigeben(s, ids)).text, "#anschreiben");
}

export async function anschreibenAction(fd: FormData) {
  const s = await requireArea("b2b");
  const id = String(fd.get("id") ?? "");
  const u = fd.get("umsatz");
  const m = fd.get("marge");
  await mitFehler(async () => {
    await anschreibenAendern(s, id, { betreff: String(fd.get("betreff") ?? "") || undefined, text: String(fd.get("text") ?? "") || undefined, umsatz: u === null ? undefined : String(u).trim() ? zahl(u) : null, marge: m === null ? undefined : String(m).trim() ? zahl(m) : null });
    return "Gespeichert.";
  }, "#anschreiben");
}

export async function verschicktAction(fd: FormData) {
  const s = await requireArea("b2b");
  await mitFehler(async () => {
    await chargeVerschickt(s, String(fd.get("charge") ?? ""));
    return "Briefe der Charge als verschickt markiert.";
  }, "#erfolg");
}

// ---- B34.3.6 AdelPrep-Beilage, B34.3a Briefversand, B34.3b Lager ---------------------------------------------------

const txt = (fd: FormData, k: string, n = 300) => String(fd.get(k) ?? "").trim().slice(0, n);
const geld = (v: FormDataEntryValue | null) => (String(v ?? "").trim() === "" ? null : Number.isFinite(zahl(v)) && zahl(v) >= 0 ? Math.round(zahl(v) * 100) / 100 : null);

export async function adelprepAction(fd: FormData) {
  const s = await requireArea("b2b");
  await mitFehler(async () => {
    await einstellungenSpeichern(s, {
      adelprep: {
        firma: txt(fd, "firma", 120), strasse: txt(fd, "strasse", 120), plz: txt(fd, "plz", 10), ort: txt(fd, "ort", 80), email: txt(fd, "email", 120), telefon: txt(fd, "telefon", 40), web: txt(fd, "web", 120),
        impressum: txt(fd, "impressum", 1500), datenschutz: txt(fd, "datenschutz", 3000), text: txt(fd, "text", 3000), standardBeilegen: fd.get("standard") === "on",
        bestaetigt: { flaeche: fd.get("b_flaeche") === "on", zaehlung: fd.get("b_zaehlung") === "on", nda: fd.get("b_nda") === "on", gefahrgut: fd.get("b_gefahrgut") === "on" },
      },
    });
    return "Beilage (AdelPrep) gespeichert.";
  }, "#beilage");
}

export async function briefversandAction(fd: FormData) {
  const s = await requireArea("b2b");
  await mitFehler(async () => {
    const anbieter = (["ebrief", "letterxpress", "epost"] as const).find((a) => a === fd.get("anbieter")) ?? "ebrief";
    const alt = (await (await import("@/lib/abverkauf/service")).einstellungen(s.tenantId)).briefversand;
    const av = fd.get("av") === "on";
    await einstellungenSpeichern(s, {
      briefversand: {
        anbieter,
        live: fd.get("live") === "on",
        avVertrag: av,
        avDatum: av ? (txt(fd, "avdatum", 10) || alt.avDatum || new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date())) : null,
        tageslimit: Math.min(500, Math.max(1, Math.round(zahl(fd.get("tageslimit")) || 20))),
        budget: geld(fd.get("budget")),
        farbe: fd.get("farbe") === "on",
        duplex: fd.get("duplex") === "on",
        preise: {
          ebrief: { grund: geld(fd.get("p_ebrief_grund")), jeWeitereSeite: geld(fd.get("p_ebrief_seite")) },
          letterxpress: { grund: geld(fd.get("p_letterxpress_grund")), jeWeitereSeite: geld(fd.get("p_letterxpress_seite")) },
          epost: { grund: geld(fd.get("p_epost_grund")), jeWeitereSeite: geld(fd.get("p_epost_seite")) },
        },
      },
    });
    return fd.get("live") === "on" && !av ? "Gespeichert – Live-Versand bleibt gesperrt, bis der AV-Vertrag bestätigt ist." : "Briefversand gespeichert.";
  }, "#briefversand");
}

export async function lagerAction(fd: FormData) {
  const s = await requireArea("b2b");
  await mitFehler(async () => {
    const k = (v: FormDataEntryValue | null, max: number) => {
      const n = zahl(v);
      return String(v ?? "").trim() && Number.isFinite(n) && Math.abs(n) <= max ? n : null;
    };
    await einstellungenSpeichern(s, { lager: { name: txt(fd, "name", 80), lat: k(fd.get("lat"), 90), lng: k(fd.get("lng"), 180), preisJePaletteMonat: geld(fd.get("preis")) } });
    return "Lager-Standort gespeichert.";
  }, "#lager");
}

export async function leadAdelprepAction(fd: FormData) {
  const s = await requireArea("b2b");
  await mitFehler(async () => {
    await leadAendern(s, String(fd.get("id") ?? ""), { adelprep: fd.get("adelprep") === "1" });
    return fd.get("adelprep") === "1" ? "Lead: Zielgruppe AdelPrep." : "Lead: nicht Zielgruppe AdelPrep.";
  }, "#leads");
}

export async function beilageAction(fd: FormData) {
  const s = await requireArea("b2b");
  await mitFehler(async () => {
    await anschreibenAendern(s, String(fd.get("id") ?? ""), { adelprepBeilage: fd.get("beilage") === "1" });
    return fd.get("beilage") === "1" ? "Beilage für diesen Brief zugewählt." : "Beilage für diesen Brief abgewählt.";
  }, "#anschreiben");
}
