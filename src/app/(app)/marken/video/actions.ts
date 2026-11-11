"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { VideoFreigabe } from "@/db/tables/video";
import { requireArea } from "@/lib/auth/session";
import { istVideoModell, type VideoPreise } from "@/lib/video/logic";

// B36 Seite „Video“: Kanäle, neues Video, Freigaben, „Schritt wiederholen“, „Privat hochladen“, Worker-Token, Preise.
// Zugangsdaten (Claude, ElevenLabs, OpenAI, Google-App) nur unter Anbindungen – nie hier, nie im Chat.

const PFAD = "/marken/video";
const zurueck = (meldung: string, kanal?: string | null, anker = ""): never => redirect(`${PFAD}?${kanal ? `kanal=${kanal}&` : ""}meldung=${encodeURIComponent(meldung)}${anker}`);
const txt = (fd: FormData, k: string, n = 500) => String(fd.get(k) ?? "").trim().slice(0, n);
const id = (fd: FormData, k = "id") => {
  const v = txt(fd, k, 40);
  return /^[0-9a-f-]{36}$/.test(v) ? v : "";
};

async function mitFehler(fn: () => Promise<string>, kanal?: string | null, anker = "") {
  const { VideoFehler } = await import("@/lib/video/service");
  let text: string;
  try {
    text = await fn();
  } catch (e) {
    if (e instanceof VideoFehler) zurueck(e.message, kanal, anker);
    throw e;
  }
  revalidatePath(PFAD);
  zurueck(text, kanal, anker);
}

export async function kanalSpeichernAction(fd: FormData) {
  const s = await requireArea("marken");
  const kanalId = id(fd, "kanalId") || null;
  const { kanalSpeichern, VideoFehler } = await import("@/lib/video/service");
  let gespeichert: string;
  try {
    gespeichert = await kanalSpeichern(s, kanalId, {
      name: txt(fd, "name", 80),
      handle: txt(fd, "handle", 80) || null,
      sprache: txt(fd, "sprache", 10) || "de",
      themenbereich: txt(fd, "themenbereich") || null,
      zielgruppe: txt(fd, "zielgruppe", 300) || null,
      laengeMin: Number(txt(fd, "laengeMin", 3)) || null,
      laengeMax: Number(txt(fd, "laengeMax", 3)) || null,
      stimmeId: txt(fd, "stimmeId", 80) || null,
      bildstil: txt(fd, "bildstil") || null,
      sicherheitsstufe: fd.get("sicherheitsstufe") === "streng" ? "streng" : "normal",
      musik: txt(fd, "musik", 120) || null,
      freigaben: { gliederung: fd.get("f_gliederung") === "1", skript: fd.get("f_skript") === "1", szenen: fd.get("f_szenen") === "1", vorschau: fd.get("f_vorschau") === "1" },
      stil: txt(fd, "stil", 20) || "vollbild",
      figuren: txt(fd, "figuren", 3000) || null,
      bildQualitaet: txt(fd, "bildQualitaet", 10) || "medium",
      aktiv: fd.get("aktiv") !== "0",
    });
  } catch (e) {
    if (e instanceof VideoFehler) zurueck(e.message, kanalId, "#kanal");
    throw e;
  }
  revalidatePath(PFAD);
  zurueck(kanalId ? "Kanalprofil gespeichert." : "Kanal angelegt.", gespeichert, "#kanal");
}

export async function youtubeTrennenAction(fd: FormData) {
  const s = await requireArea("marken");
  const kanalId = id(fd, "kanalId");
  await mitFehler(async () => {
    const { kanalYoutubeSetzen, VideoFehler } = await import("@/lib/video/service");
    if (s.role !== "owner" || s.readOnly) throw new VideoFehler("Nur der Inhaber trennt YouTube.");
    await kanalYoutubeSetzen(s.tenantId, kanalId, null, null);
    return "YouTube getrennt.";
  }, kanalId, "#kanal");
}

export async function youtubeEinfuegenAction(fd: FormData) {
  const s = await requireArea("marken");
  const kanalId = id(fd, "kanalId");
  await mitFehler(async () => {
    const { VideoFehler } = await import("@/lib/video/service");
    if (s.role !== "owner" || s.readOnly) throw new VideoFehler("Nur der Inhaber verbindet YouTube.");
    const { youtubeEinfuegen } = await import("@/lib/video/youtube-verbinden");
    const name = await youtubeEinfuegen(s.tenantId, kanalId, txt(fd, "adresse", 4000));
    return `YouTube verbunden${name ? ` (${name})` : ""} – Uploads immer privat.`;
  }, kanalId, "#kanal");
}

export async function auftragAction(fd: FormData) {
  const s = await requireArea("marken");
  const kanalId = id(fd, "kanalId");
  await mitFehler(async () => {
    const { auftragAnlegen } = await import("@/lib/video/service");
    await auftragAnlegen(s, { kanalId, thema: txt(fd, "thema", 300), startWahl: txt(fd, "start", 20), zeitpunkt: txt(fd, "zeitpunkt", 30) || null, vidiqKeywords: txt(fd, "vidiqKeywords", 2000) || null, vidiqTitel: txt(fd, "vidiqTitel", 2000) || null, vorlage: txt(fd, "vorlage", 40_001) || null, vorlageArt: fd.get("vorlageArt") === "skript" ? "skript" : "vorlage" });
    return fd.get("start") === "sofort" || !fd.get("start") ? "Video angelegt – der Worker holt den Auftrag ab." : "Video angelegt – Start zum gewählten Zeitpunkt.";
  }, kanalId, "#auftraege");
}

export async function freigebenAction(fd: FormData) {
  const s = await requireArea("marken");
  const f = txt(fd, "freigabe", 20) as VideoFreigabe;
  await mitFehler(async () => {
    const { freigeben, VideoFehler } = await import("@/lib/video/service");
    if (!["gliederung", "skript", "szenen", "vorschau"].includes(f)) throw new VideoFehler("Unbekannte Freigabe.");
    const tw = txt(fd, "titelWahl", 3);
    return freigeben(s, id(fd), f, { hinweis: txt(fd, "hinweis", 2000) || null, titelWahl: tw === "" ? null : Number(tw) });
  }, txt(fd, "kanal", 40) || null, `#a-${id(fd)}`);
}

export async function neuAction(fd: FormData) {
  const s = await requireArea("marken");
  await mitFehler(async () => {
    const { neuMachen } = await import("@/lib/video/service");
    const schritt = fd.get("schritt") === "script" ? "script" : "research";
    await neuMachen(s, id(fd), schritt, txt(fd, "hinweis", 2000) || null);
    return schritt === "script" ? "Skript wird neu geschrieben (mit deiner Anmerkung)." : "Recherche läuft neu (mit deiner Anmerkung).";
  }, txt(fd, "kanal", 40) || null, `#a-${id(fd)}`);
}

export async function wiederholenAction(fd: FormData) {
  const s = await requireArea("marken");
  await mitFehler(async () => {
    const { schrittWiederholen } = await import("@/lib/video/service");
    await schrittWiederholen(s, id(fd));
    return "Schritt wird wiederholt – bereits bezahlte Sprache/Bilder werden weiterverwendet.";
  }, txt(fd, "kanal", 40) || null, `#a-${id(fd)}`);
}

export async function abbrechenAction(fd: FormData) {
  const s = await requireArea("marken");
  await mitFehler(async () => {
    const { abbrechen } = await import("@/lib/video/service");
    await abbrechen(s, id(fd));
    return "Auftrag abgebrochen.";
  }, txt(fd, "kanal", 40) || null, `#a-${id(fd)}`);
}

export async function hochladenAction(fd: FormData) {
  const s = await requireArea("marken");
  await mitFehler(async () => {
    const { hochladenSchalten } = await import("@/lib/video/service");
    return hochladenSchalten(s, id(fd), fd.get("an") === "1");
  }, txt(fd, "kanal", 40) || null, `#a-${id(fd)}`);
}

export async function vidiqAction(fd: FormData) {
  const s = await requireArea("marken");
  await mitFehler(async () => {
    const { vidiqEintragen, VideoFehler } = await import("@/lib/video/service");
    if (s.readOnly) throw new VideoFehler("Nur ansehen – nichts geändert.");
    await vidiqEintragen(s.tenantId, id(fd), { keywords: txt(fd, "vidiqKeywords", 2000) || null, titel: txt(fd, "vidiqTitel", 2000) || null });
    return "vidIQ-Daten gespeichert – sie fließen in Gliederung, Titel, Tags und Kapitel ein.";
  }, txt(fd, "kanal", 40) || null, `#a-${id(fd)}`);
}

export async function loeschenAction(fd: FormData) {
  const s = await requireArea("marken");
  await mitFehler(async () => {
    const { auftragLoeschen } = await import("@/lib/video/service");
    await auftragLoeschen(s, id(fd));
    return "Auftrag mit allen Dateien gelöscht.";
  }, txt(fd, "kanal", 40) || null, "#auftraege");
}

export async function workerDeaktivierenAction(fd: FormData) {
  const s = await requireArea("marken");
  await mitFehler(async () => {
    const { workerDeaktivieren } = await import("@/lib/video/service");
    await workerDeaktivieren(s, id(fd));
    return "Worker deaktiviert – sein Token gilt nicht mehr.";
  }, null, "#worker");
}

export type WorkerStand = { token?: string; name?: string; fehler?: string } | null;

/** Worker anlegen: Token erscheint genau einmal (nicht in Adresse oder Protokoll). */
export async function workerAnlegenAction(_vorher: WorkerStand, fd: FormData): Promise<WorkerStand> {
  const s = await requireArea("marken");
  const { workerAnlegen, VideoFehler } = await import("@/lib/video/service");
  try {
    const name = txt(fd, "name", 80) || "Arbeits-PC";
    const r = await workerAnlegen(s, name);
    revalidatePath(PFAD);
    return { token: r.token, name };
  } catch (e) {
    if (e instanceof VideoFehler) return { fehler: e.message };
    throw e;
  }
}

export async function preiseAction(fd: FormData) {
  const s = await requireArea("marken");
  const zahl = (k: string) => {
    const v = txt(fd, k, 20).replace(",", ".");
    const n = Number(v);
    return v !== "" && Number.isFinite(n) && n >= 0 ? n : null;
  };
  await mitFehler(async () => {
    const { videoEinstellungenSpeichern } = await import("@/lib/video/service");
    const preise: VideoPreise = { claudeEingabeJeMio: zahl("claudeEingabeJeMio"), claudeAusgabeJeMio: zahl("claudeAusgabeJeMio"), websucheJe1000: zahl("websucheJe1000"), elevenlabsJe1000Zeichen: zahl("elevenlabsJe1000Zeichen"), bildJeStueck: zahl("bildJeStueck"), motivJeStueck: zahl("motivJeStueck") };
    await videoEinstellungenSpeichern(s, { preise, serverReserveGb: zahl("serverReserveGb") ?? 2 });
    return "Preise gespeichert – gelten für neue Schätzungen und Kosten ab jetzt.";
  }, null, "#preise");
}

/** Claude-Modell und Ablage (Google Drive / Seller-Server) – nur Inhaber. */
export async function ablageAction(fd: FormData) {
  const s = await requireArea("marken");
  await mitFehler(async () => {
    const { videoEinstellungen, videoEinstellungenSpeichern, VideoFehler } = await import("@/lib/video/service");
    const modell = txt(fd, "modell", 40);
    if (!istVideoModell(modell)) throw new VideoFehler("Unbekanntes Modell.");
    const ablage = fd.get("ablage") === "drive" ? "drive" : "server";
    const cfg = await videoEinstellungen(s.tenantId);
    if (ablage === "drive" && !cfg.drive) throw new VideoFehler("Zuerst „Google Drive verbinden“.");
    await videoEinstellungenSpeichern(s, { modell, ablage });
    return `Gespeichert: ${modell === "claude-opus-5-5" ? "Claude Opus 5.5" : "Claude Sonnet 5.5"}, Ablage ${ablage === "drive" ? "Google Drive" : "Seller-Server"} – gilt für neue Schritte.`;
  }, null, "#ablage");
}

export async function driveTrennenAction() {
  const s = await requireArea("marken");
  await mitFehler(async () => {
    const { videoDriveSetzen, VideoFehler } = await import("@/lib/video/service");
    if (s.role !== "owner" || s.readOnly) throw new VideoFehler("Nur der Inhaber.");
    await videoDriveSetzen(s.tenantId, null);
    return "Google Drive getrennt – neue Videos landen auf dem Seller-Server. Dateien in Drive bleiben dort.";
  }, null, "#ablage");
}

export async function driveEinfuegenAction(fd: FormData) {
  const s = await requireArea("marken");
  await mitFehler(async () => {
    const { VideoFehler } = await import("@/lib/video/service");
    if (s.role !== "owner" || s.readOnly) throw new VideoFehler("Nur der Inhaber verbindet Google Drive.");
    const { videoDriveEinfuegen } = await import("@/lib/video/youtube-verbinden");
    await videoDriveEinfuegen(s.tenantId, txt(fd, "adresse", 4000));
    return "Google Drive verbunden – fertige Videos landen im Ordner „Seller-System Videos“.";
  }, null, "#ablage");
}

/** B36.9: Stil-Referenzbilder je Kanal (bis 4). */
export async function referenzAction(fd: FormData) {
  const s = await requireArea("marken");
  const kanalId = id(fd, "kanalId");
  await mitFehler(async () => {
    const { referenzenHinzufuegen } = await import("@/lib/video/service");
    const dateien = fd.getAll("bilder").filter((x): x is File => typeof x !== "string");
    const n = await referenzenHinzufuegen(s, kanalId, dateien);
    return `${n} Referenzbild${n === 1 ? "" : "er"} gespeichert.`;
  }, kanalId, "#kanal");
}

export async function referenzLoeschenAction(fd: FormData) {
  const s = await requireArea("marken");
  const kanalId = id(fd, "kanalId");
  await mitFehler(async () => {
    const { referenzEntfernen } = await import("@/lib/video/service");
    await referenzEntfernen(s, kanalId, Number(txt(fd, "nr", 4)));
    return "Referenzbild entfernt.";
  }, kanalId, "#kanal");
}

/** B36.9.6: In der Szenen-Übersicht ausgewählte Motive neu erzeugen lassen. */
export async function motiveNeuAction(fd: FormData) {
  const s = await requireArea("marken");
  await mitFehler(async () => {
    const { motiveNeu } = await import("@/lib/video/service");
    return motiveNeu(s, id(fd), fd.getAll("motiv").map((x) => String(x).slice(0, 60)));
  }, txt(fd, "kanal", 40) || null, `#a-${id(fd)}`);
}
