"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { VideoFreigabe } from "@/db/tables/video";
import { requireArea } from "@/lib/auth/session";
import type { InstagramProfil, StoryInhaltsart } from "@/db/tables/video";
import { BILD_MODELLE, istBildModell, istVideoModell, type VideoPreise } from "@/lib/video/logic";
import { STORY_ARTEN, uhrzeitenAus } from "@/lib/video/story-logic";

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
      stimmeId: txt(fd, "stimmeId", 80) || null,
      bildstil: txt(fd, "bildstil") || null,
      sicherheitsstufe: fd.get("sicherheitsstufe") === "streng" ? "streng" : "normal",
      musik: txt(fd, "musik", 120) || null,
      freigaben: { gliederung: fd.get("f_gliederung") === "1", skript: fd.get("f_skript") === "1", szenen: fd.get("f_szenen") === "1", vorschau: fd.get("f_vorschau") === "1" },
      stil: txt(fd, "stil", 20) || "vollbild",
      figuren: txt(fd, "figuren", 3000) || null,
      bildQualitaet: txt(fd, "bildQualitaet", 10) || "medium",
      aktiv: fd.get("aktiv") !== "0",
      plattform: txt(fd, "plattform", 20) || "youtube",
      tempo: txt(fd, "tempo", 10) || "normal",
      sprechtempo: txt(fd, "sprechtempo", 10) || null,
      motivStil: txt(fd, "motivStil", 10) || "strich",
      bildSek: txt(fd, "bildSek", 10) || null,
      stockClips: fd.get("stockClips") === "on",
      instagram: fd.get("plattform") === "instagram" ? instagramAus(fd) : null,
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

/** B36.10: fertiges Whiteboard-Video im neuen Takt neu (Recherche bleibt; gleicher Text oder neu geschrieben). */
export async function taktNeuAction(fd: FormData) {
  const s = await requireArea("marken");
  await mitFehler(async () => {
    const { imTaktNeu } = await import("@/lib/video/service");
    return imTaktNeu(s, id(fd), { gleicherText: fd.get("text") !== "neu", hinweis: txt(fd, "hinweis", 2000) || null });
  }, txt(fd, "kanal", 40) || null, `#a-${id(fd)}`);
}

export async function probeAction(fd: FormData) {
  const s = await requireArea("marken");
  await mitFehler(async () => {
    const { probeAnfordern } = await import("@/lib/video/service");
    return probeAnfordern(s, id(fd), Number(txt(fd, "szene", 5)) || 1);
  }, txt(fd, "kanal", 40) || null, `#a-${id(fd)}`);
}

export async function neuVertonenAction(fd: FormData) {
  const s = await requireArea("marken");
  await mitFehler(async () => {
    const { neuVertonen } = await import("@/lib/video/service");
    return neuVertonen(s, id(fd));
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
    const bm = fd.get("bildModell");
    const bildModell = bm === null ? cfg.bildModell : String(bm);
    if (!istBildModell(bildModell)) throw new VideoFehler("Unbekanntes Bildmodell.");
    if (ablage === "drive" && !cfg.drive) throw new VideoFehler("Zuerst „Google Drive verbinden“.");
    await videoEinstellungenSpeichern(s, { modell, bildModell, ablage });
    return `Gespeichert: ${modell === "claude-opus-5-5" ? "Claude Opus 5.5" : "Claude Sonnet 5.5"}, Bilder ${BILD_MODELLE[bildModell].name}, Ablage ${ablage === "drive" ? "Google Drive" : "Seller-Server"} – gilt für neue Schritte.`;
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


// ---- B37 Instagram-Stories ------------------------------------------------------------------------------------------

const farbe = (fd: FormData, k: string, standard: string) => (/^#[0-9a-f]{6}$/i.test(txt(fd, k, 7)) ? txt(fd, k, 7) : standard);

/** Instagram-Felder des Kanalprofils (Zeitplan, Inhaltsarten, Gestaltung, Freigabe, Limit, Fakten). */
function instagramAus(fd: FormData): InstagramProfil {
  const limit = txt(fd, "ig_limit", 12).replace(",", ".");
  return {
    tage: [1, 2, 3, 4, 5, 6, 7].filter((t) => fd.get(`ig_tag_${t}`) === "1"),
    uhrzeiten: uhrzeitenAus(txt(fd, "ig_uhrzeiten", 100)),
    inhaltsarten: (Object.keys(STORY_ARTEN) as StoryInhaltsart[]).filter((a) => fd.get(`ig_art_${a}`) === "1"),
    farben: { grund: farbe(fd, "ig_grund", "#ffffff"), akzent: farbe(fd, "ig_akzent", "#d62828"), text: farbe(fd, "ig_text", "#181818") },
    hand: fd.get("ig_hand") === "1",
    hinweis: txt(fd, "ig_hinweis", 300) || null,
    werbung: fd.get("ig_werbung") === "1",
    freigabeModus: fd.get("ig_freigabe") === "stichprobe" ? "stichprobe" : fd.get("ig_freigabe") === "automatisch" ? "automatisch" : "jedes_mal",
    monatslimit: limit && Number.isFinite(Number(limit)) && Number(limit) >= 0 ? Math.round(Number(limit) * 100) / 100 : null,
    fakten: txt(fd, "ig_fakten", 4000) || null,
  };
}

const story = () => import("@/lib/video/story");

export async function themenAction(fd: FormData) {
  const s = await requireArea("marken");
  const kanal = id(fd, "kanalId");
  await mitFehler(async () => `${await (await story()).themenSpeichern(s, kanal, txt(fd, "themen", 20_000))} Themen gespeichert.`, kanal, "#stories");
}

export async function storiesErzeugenAction(fd: FormData) {
  const s = await requireArea("marken");
  const kanal = id(fd, "kanalId");
  await mitFehler(async () => {
    const r = await (await story()).storiesAusThemen(s, kanal);
    return r.limit ? `${r.neu} Stories angelegt – dann Monatslimit erreicht, Erzeugung gestoppt.` : `${r.neu} Stories angelegt – der Worker erzeugt sie, danach erscheinen sie hier zur Freigabe.`;
  }, kanal, "#stories");
}

export async function storiesPlanenAction(fd: FormData) {
  const s = await requireArea("marken");
  const kanal = id(fd, "kanalId");
  await mitFehler(async () => {
    if (s.readOnly) return "Nur ansehen – nichts geändert.";
    const r = await (await story()).storiesPlanen(s.tenantId, { kanalId: kanal });
    return r.limit.length ? `Monatslimit erreicht – keine neuen Stories (${r.neu} angelegt).` : r.neu ? `${r.neu} Stories für die nächsten 36 Stunden angelegt.` : "Für die nächsten 36 Stunden ist schon alles geplant.";
  }, kanal, "#stories");
}

export async function fotoAction(fd: FormData) {
  const s = await requireArea("marken");
  const kanal = id(fd, "kanalId");
  const dateien = fd.getAll("fotos").filter((x): x is File => typeof x !== "string");
  await mitFehler(async () => `${await (await story()).fotosHochladen(s, kanal, dateien, fd.get("ohnePersonen") === "1")} Foto(s) gespeichert.`, kanal, "#fotos");
}

export async function fotoLoeschenAction(fd: FormData) {
  const s = await requireArea("marken");
  await mitFehler(async () => {
    await (await story()).fotoLoeschen(s, id(fd));
    return "Foto gelöscht.";
  }, id(fd, "kanalId"), "#fotos");
}

export async function storyFreigebenAction(fd: FormData) {
  const s = await requireArea("marken");
  await mitFehler(async () => (await story()).storyFreigeben(s, id(fd)), id(fd, "kanalId"), `#s-${id(fd)}`);
}

export async function storyAblehnenAction(fd: FormData) {
  const s = await requireArea("marken");
  await mitFehler(async () => (await story()).storyAblehnen(s, id(fd)), id(fd, "kanalId"), `#s-${id(fd)}`);
}

export async function storyNeuAction(fd: FormData) {
  const s = await requireArea("marken");
  await mitFehler(async () => (await story()).storyNeu(s, id(fd), { motivNeu: fd.get("motivNeu") === "1", hinweis: txt(fd, "hinweis", 1000) || null }), id(fd, "kanalId"), `#s-${id(fd)}`);
}

export async function storyGepostetAction(fd: FormData) {
  const s = await requireArea("marken");
  await mitFehler(async () => (await story()).storyManuellGepostet(s, id(fd)), id(fd, "kanalId"), `#s-${id(fd)}`);
}

export async function storyErneutAction(fd: FormData) {
  const s = await requireArea("marken");
  await mitFehler(async () => (await story()).storyErneutPosten(s, id(fd)), id(fd, "kanalId"), `#s-${id(fd)}`);
}

/** „Fällige jetzt posten“: Planzeit erreicht + freigegeben → posten (sonst alle 5 Min. automatisch). */
export async function storiesPostenAction(fd: FormData) {
  const s = await requireArea("marken");
  const kanal = id(fd, "kanalId");
  await mitFehler(async () => {
    if (s.readOnly) return "Nur ansehen – nichts geändert.";
    const r = await (await story()).storiesPosten(s.tenantId);
    return `Gepostet: ${r.gepostet}, nicht gepostet: ${r.fehler}, Erinnerungen: ${r.erinnert}.`;
  }, kanal, "#stories");
}

export async function instagramTrennenAction(fd: FormData) {
  const s = await requireArea("marken");
  const kanal = id(fd, "kanalId");
  await mitFehler(async () => {
    if (s.role !== "owner" || s.readOnly) return "Nur der Inhaber.";
    await (await story()).kanalInstagramSetzen(s.tenantId, kanal, null);
    return "Instagram getrennt – Stories werden ab jetzt von Hand gepostet.";
  }, kanal, "#kanal");
}
