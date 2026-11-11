import "server-only";
import { z } from "zod";
import { anzeigeStatus, FREIGABE_TEXT, fortschrittProzent, SCHRITT_TEXT, VIDEO_MODELLE } from "@/lib/video/logic";
import { auftraege, auftragLesen, kanaele, kostenUebersicht, videoEinstellungen, vidiqEintragen, workerZuletzt } from "@/lib/video/service";
import { defineTool } from "../types";
import { abs, berlinDateTime, json, uuid } from "./common";

// B36 Video-Pipeline: Aufträge lesen (Status je Schritt, Freigaben, Kosten) und vidIQ Stufe 1: Claude trägt
// Keywords/Titelvorschläge aus seiner vidIQ-Anbindung in den Auftrag ein. Seller-System und Worker rufen vidIQ nie selbst auf.

const QUELLE = { text: "Video-Pipeline im Seller-System (Worker am Arbeits-PC meldet Schritte und Kosten über die Anbieter-Brücke)" };

export const videoAuftraegeTool = defineTool({
  name: "video_auftraege",
  title: "Video: Aufträge",
  description:
    "Video-Aufträge der YouTube-Pipeline (neueste zuerst): Kanal, Thema, Status (wartet/läuft/Freigabe/fertig/Fehler; „wartet (Worker aus)“, wenn der Arbeits-PC sich seit 10 Min. nicht gemeldet hat), aktueller Schritt, offene Freigabe, Fortschritt in %, Wörter, Länge, Kosten (Schätzung/Ist in $), YouTube-Status (immer privat), dazu Worker-Stand, Claude-Modell, Ablage (Google Drive/Seller-Server) und Kosten je Kanal im Monat. Filter: kanal (Name), status. Freigeben, „Schritt wiederholen“ und „Privat hochladen“ nur auf der Seite Video.",
  area: "marken",
  write: false,
  quelle: QUELLE,
  input: z.object({
    kanal: z.string().trim().max(80).optional().describe("Kanalname (Teil reicht)"),
    status: z.enum(["wartet", "laeuft", "freigabe", "fertig", "fehler", "abgebrochen"]).optional(),
    limit: z.number().int().min(1).max(50).default(15),
  }),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const [liste, kosten, worker, kl, cfg] = await Promise.all([auftraege(t, null, 100), kostenUebersicht(t), workerZuletzt(t), kanaele(t), videoEinstellungen(t)]);
    const online = worker?.stand.online ?? false;
    const gefiltert = liste.filter(({ a, kanal }) => (!i.kanal || kanal.toLowerCase().includes(i.kanal.toLowerCase())) && (!i.status || a.status === i.status)).slice(0, i.limit);
    return json({
      worker: worker ? { text: worker.stand.text, online, frei_gb: worker.freiGb } : { text: "Noch kein Worker angelegt" },
      einstellungen: { claude_modell: VIDEO_MODELLE[cfg.modell].name, ablage: cfg.ablage === "drive" ? "Google Drive (Ordner „Seller-System Videos“)" : "Seller-Server" },
      kanaele: kl.map((k) => ({ name: k.name, aktiv: k.aktiv, freigaben: Object.entries(k.freigaben).filter(([, v]) => v).map(([f]) => FREIGABE_TEXT[f as keyof typeof FREIGABE_TEXT]), youtube_verbunden: !!k.youtubeToken, zielgruppe: k.zielgruppe ?? undefined, stil: k.stil === "whiteboard" ? "Whiteboard-Collage" : "Vollbild", laenge_min: `${k.laengeMin}–${k.laengeMax}` })),
      auftraege: gefiltert.map(({ a, kanal }) => ({
        id: a.id,
        kanal,
        thema: a.thema,
        status: anzeigeStatus(a.status, online),
        schritt: SCHRITT_TEXT[a.schritt],
        freigabe_offen: a.freigabeOffen ? FREIGABE_TEXT[a.freigabeOffen] : undefined,
        fehler: a.status === "fehler" ? (a.schritte[a.schritt]?.fehler ?? undefined) : undefined,
        fortschritt_prozent: fortschrittProzent(a.schritte, a.hochladen),
        woerter: a.woerter ?? undefined,
        dauer_sek: a.dauerSek ?? undefined,
        quellen: a.quellen.length || undefined,
        kosten_schaetzung_usd: a.kostenSchaetzung,
        kosten_ist_usd: a.kostenIst,
        vorlage: a.vorlage ? (a.vorlageArt === "skript" ? "eigenes Skript" : "Vorlage (Aufbau übernehmen)") : undefined,
        vidiq: a.vidiqKeywords || a.vidiqTitel ? { keywords: a.vidiqKeywords ?? undefined, titel: a.vidiqTitel ?? undefined } : undefined,
        privat_hochladen: a.hochladen,
        youtube: a.youtubeId ? { status: a.youtubeStatus, studio: `https://studio.youtube.com/video/${a.youtubeId}/edit` } : undefined,
        angelegt: berlinDateTime(a.createdAt),
        link: abs(ctx, `/marken/video?kanal=${a.kanalId}#a-${a.id}`),
      })),
      kosten_monat: { je_kanal: kosten.jeKanal, summe_usd: Math.round(kosten.monatSumme * 100) / 100 },
      link: abs(ctx, "/marken/video"),
    });
  },
});

export const videoVidiqEintragenTool = defineTool({
  name: "video_vidiq_eintragen",
  title: "Video: vidIQ-Daten eintragen",
  description:
    "vidIQ Stufe 1: trägt Keywords/Ideen und Titelvorschläge aus deiner vidIQ-Anbindung in einen Video-Auftrag ein (Freitext). Die Pipeline nutzt sie für Gliederung, die 5 Titel, Tags und Kapitel. Nur auf ausdrücklichen Wunsch; id aus video_auftraege. Credits sparsam: nur Keyword-Recherche, Titel- und Thumbnail-Bewertung (je 5 Credits) – keine vidIQ-Sprache, -Musik, -B-Roll oder -Videogenerierung. Wirkt erst für Schritte, die noch nicht gelaufen sind.",
  area: "marken",
  write: true,
  stufe: "gruen",
  input: z.object({
    id: uuid,
    keywords: z.string().trim().max(2000).optional().describe("Keywords/Ideen aus vidIQ (Freitext)"),
    titel: z.string().trim().max(2000).optional().describe("Titelvorschläge aus vidIQ (Freitext, eine Zeile je Titel)"),
  }),
  summary: (i) => `vidIQ-Daten in Video-Auftrag eintragen${i.keywords ? " (Keywords)" : ""}${i.titel ? " (Titel)" : ""}`,
  vorschau: async (ctx, i) => {
    const r = await auftragLesen(ctx.session.tenantId, i.id);
    return r ? { anzahl: 1, beispiele: [`${r.kanal.name}: ${r.a.thema}`] } : { anzahl: 0, beispiele: [] };
  },
  run: async (ctx, i) => {
    if (i.keywords === undefined && i.titel === undefined) return { text: "Bitte keywords und/oder titel angeben.", isError: true };
    const r = await auftragLesen(ctx.session.tenantId, i.id);
    if (!r) return { text: "Auftrag nicht gefunden.", isError: true };
    await vidiqEintragen(ctx.session.tenantId, i.id, { keywords: i.keywords, titel: i.titel });
    const gelaufen = ["research", "package"].filter((s) => r.a.schritte[s as "research"]?.status === "fertig");
    return {
      text: json({ ok: true, thema: r.a.thema, hinweis: gelaufen.length ? `Schon gelaufen: ${gelaufen.map((s) => SCHRITT_TEXT[s as "research"]).join(", ")} – dort wirken die Daten erst nach „Neu recherchieren“.` : undefined, link: abs(ctx, `/marken/video?kanal=${r.a.kanalId}#a-${r.a.id}`) }),
      ids: [i.id],
      undo: { id: i.id, keywords: r.a.vidiqKeywords, titel: r.a.vidiqTitel },
    };
  },
  undo: async (ctx, daten) => {
    const d = daten as { id?: string; keywords?: string | null; titel?: string | null };
    if (!d?.id) return "Nichts zum Rückgängigmachen.";
    await vidiqEintragen(ctx.session.tenantId, d.id, { keywords: d.keywords ?? null, titel: d.titel ?? null });
    return "vidIQ-Daten wiederhergestellt.";
  },
});

export const VIDEO = [videoAuftraegeTool, videoVidiqEintragenTool];
