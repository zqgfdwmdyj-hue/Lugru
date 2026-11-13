import "server-only";
import { z } from "zod";
import { anzeigeStatus, FREIGABE_TEXT, freigabeAktiv, fortschrittProzent, kostenSchaetzung, laengeZiel, SCHRITT_TEXT, startAbAus, typischFuer, VIDEO_MODELLE, VIDEO_STILE } from "@/lib/video/logic";
import { abbrechen, auftraege, auftragAnlegen, auftragLesen, auftragLoeschen, kanaele, kostenUebersicht, VideoFehler, videoEinstellungen, vidiqEintragen, VORLAGE_MAX, workerZuletzt } from "@/lib/video/service";
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
      kanaele: kl.map((k) => ({ name: k.name, aktiv: k.aktiv, freigaben: Object.entries(k.freigaben).filter(([, v]) => v).map(([f]) => FREIGABE_TEXT[f as keyof typeof FREIGABE_TEXT]), youtube_verbunden: !!k.youtubeToken, zielgruppe: k.zielgruppe ?? undefined, stil: k.stil === "whiteboard" ? "Whiteboard-Collage" : "Vollbild", laenge: `${laengeZiel().woerter[0]}–${laengeZiel().woerter[1]} Wörter (fest)` })),
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

const auftragEingabe = z.object({
  kanal: z.string().trim().min(2).max(80).describe("Kanalname (Teil reicht, muss eindeutig sein)"),
  thema: z.string().trim().min(5).max(300).describe("Thema/Arbeitstitel des Videos"),
  vorlage: z.string().max(VORLAGE_MAX).optional().describe("Optional: englische Vorlage (Transkript/Gliederung eines erfolgreichen Videos) oder eigenes Skript – vollständiger Text"),
  vorlage_art: z.enum(["vorlage", "skript"]).optional().describe("„vorlage“ = nur Muster für Aufbau/Hook/Spannungsbogen, nicht übersetzen (Standard); „skript“ = eigenes Skript, wird möglichst wörtlich übernommen, nie verlängert (über 1.700 Wörter gekürzt)"),
  start: z.string().trim().max(30).optional().describe("„sofort“ (Standard), „nacht“ (heute 23 Uhr) oder Zeitpunkt „JJJJ-MM-TTTHH:MM“ (deutsche Zeit)"),
  vidiq_keywords: z.string().trim().max(2000).optional().describe("Optional: Keywords/Ideen aus vidIQ"),
  vidiq_titel: z.string().trim().max(2000).optional().describe("Optional: Titelvorschläge aus vidIQ"),
  bestaetigt: z.boolean().optional().describe("Erst weglassen: liefert Zusammenfassung mit Kanal, Länge, Stil, Freigaben und Kostenschätzung für die Rückfrage. Erst nach ausdrücklichem Ja mit true erneut aufrufen – dann wird der Auftrag angelegt (er kostet Geld)."),
});

function startWahl(start?: string): { wahl: string; zeitpunkt: string | null } | null {
  const t = (start ?? "sofort").trim().toLowerCase();
  if (!t || t === "sofort" || t === "jetzt") return { wahl: "sofort", zeitpunkt: null };
  if (t === "nacht" || t === "heute nacht") return { wahl: "nacht", zeitpunkt: null };
  return /^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}$/.test(t) ? { wahl: "zeitpunkt", zeitpunkt: start!.trim().replace("t", "T") } : null;
}

async function auftragPlan(tenantId: string, i: z.infer<typeof auftragEingabe>) {
  const kl = (await kanaele(tenantId)).filter((k) => k.aktiv);
  const passend = kl.filter((k) => k.name.toLowerCase() === i.kanal.toLowerCase());
  const treffer = passend.length ? passend : kl.filter((k) => k.name.toLowerCase().includes(i.kanal.toLowerCase()));
  if (treffer.length !== 1) return { fehler: treffer.length ? `Kanal nicht eindeutig: ${treffer.map((k) => k.name).join(", ")}` : `Kanal „${i.kanal}“ nicht gefunden. Aktive Kanäle: ${kl.map((k) => k.name).join(", ") || "keine"}` } as const;
  const k = treffer[0];
  const st = startWahl(i.start);
  if (!st) return { fehler: "start: „sofort“, „nacht“ oder „JJJJ-MM-TTTHH:MM“." } as const;
  const vorlage = i.vorlage?.trim() || null;
  if (vorlage && vorlage.length < 200) return { fehler: "Vorlage/Skript ist sehr kurz – bitte den ganzen Text mitschicken (oder weglassen)." } as const;
  const cfg = await videoEinstellungen(tenantId);
  const ziel = laengeZiel();
  const schaetzung = kostenSchaetzung(cfg.preise, typischFuer(k.stil, k), cfg.modell, cfg.bildModell);
  const worker = await workerZuletzt(tenantId);
  const startAb = startAbAus(st.wahl, st.zeitpunkt);
  const zusammenfassung = [
    `Kanal „${k.name}“ (${VIDEO_STILE[k.stil].name}, ${ziel.minuten[0]}–${ziel.minuten[1]} Min.${k.zielgruppe ? `, Zielgruppe ${k.zielgruppe}` : ""})`,
    `Thema „${i.thema}“`,
    vorlage ? `${i.vorlage_art === "skript" ? "eigenes Skript" : "Vorlage"} (${vorlage.length.toLocaleString("de-DE")} Zeichen)` : null,
    `Start ${st.wahl === "sofort" ? "sofort" : startAb ? berlinDateTime(startAb) : "sofort"}`,
    `Kosten-Schätzung ca. ${schaetzung.summe.toFixed(2).replace(".", ",")} $${schaetzung.fehlend.length ? ` (ohne ${schaetzung.fehlend.join(", ")})` : ""}`,
  ].filter(Boolean).join(" · ");
  const freigaben = (["gliederung", "skript", "szenen", "vorschau"] as const).filter((f) => freigabeAktiv(k.freigaben, f)).map((f) => FREIGABE_TEXT[f]);
  return { k, st, vorlage, zusammenfassung, freigaben, worker: worker?.stand.text ?? "Noch kein Worker angelegt", schaetzung } as const;
}

export const videoAuftragAnlegenTool = defineTool({
  name: "video_auftrag_anlegen",
  title: "Video: neuen Auftrag anlegen",
  description:
    "Legt ein neues Video in der YouTube-Pipeline an – mit Thema und optional englischer Vorlage (nur Muster für Aufbau, nicht übersetzen) oder eigenem Skript (wird möglichst wörtlich übernommen), Startzeit und vidIQ-Daten. Nur auf ausdrücklichen Wunsch. Ablauf: 1) ohne „bestaetigt“ aufrufen → Zusammenfassung (Kanal, Stil, Länge, Zielgruppe, Freigaben, Kostenschätzung, Worker-Stand) zeigen und fragen „Soll ich das Video so anlegen?“; 2) nur nach ausdrücklichem Ja mit bestaetigt=true erneut aufrufen. Der Worker am Arbeits-PC holt den Auftrag ab; Freigaben (Gliederung, Skript, Szenen, Vorschau) laufen wie gewohnt über die Seite Video, der Upload bleibt immer privat.",
  area: "marken",
  write: true,
  stufe: "gelb",
  input: auftragEingabe,
  summary: (i) => `Video anlegen: ${i.kanal} – „${i.thema}“${i.vorlage ? (i.vorlage_art === "skript" ? " (eigenes Skript)" : " (mit Vorlage)") : ""}`,
  vorschau: async (ctx, i) => {
    const p = await auftragPlan(ctx.session.tenantId, i);
    return "fehler" in p ? { anzahl: 0, beispiele: [], ausgeschlossen: { anzahl: 1, grund: p.fehler ?? "", beispiele: [i.thema] } } : { anzahl: 1, beispiele: [p.zusammenfassung, `Freigaben: ${p.freigaben.join(", ") || "keine"}`, p.worker] };
  },
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const p = await auftragPlan(t, i);
    if ("fehler" in p) return { text: json({ angelegt: false, fehler: p.fehler, link: abs(ctx, "/marken/video") }), isError: true };
    // Im Fragefeld bestätigt die Person vorher in der Oberfläche (Vorschau) – dort direkt anlegen.
    if (!i.bestaetigt && ctx.channel !== "app") {
      return json({ angelegt: false, rueckfrage: `Soll ich das Video so anlegen? ${p.zusammenfassung}`, zusammenfassung: p.zusammenfassung, freigaben: p.freigaben, worker: p.worker, naechster_schritt: "Nach ausdrücklichem Ja mit denselben Angaben und bestaetigt=true aufrufen." });
    }
    try {
      const id = await auftragAnlegen(ctx.session, { kanalId: p.k.id, thema: i.thema, startWahl: p.st.wahl, zeitpunkt: p.st.zeitpunkt, vidiqKeywords: i.vidiq_keywords ?? null, vidiqTitel: i.vidiq_titel ?? null, vorlage: p.vorlage, vorlageArt: i.vorlage_art ?? "vorlage" });
      return {
        text: json({ angelegt: true, id, zusammenfassung: p.zusammenfassung, freigaben: p.freigaben, worker: p.worker, hinweis: "Der Worker holt den Auftrag ab. Freigaben und „Privat hochladen“ auf der Seite Video.", link: abs(ctx, `/marken/video?kanal=${p.k.id}#a-${id}`) }),
        ids: [id],
        undo: { id },
      };
    } catch (e) {
      if (e instanceof VideoFehler) return { text: json({ angelegt: false, fehler: e.message }), isError: true };
      throw e;
    }
  },
  undo: async (ctx, daten) => {
    const id = (daten as { id?: string })?.id;
    if (!id) return "Nichts zum Rückgängigmachen.";
    const r = await auftragLesen(ctx.session.tenantId, id);
    if (!r) return "Auftrag gibt es nicht mehr.";
    // Noch nichts gelaufen (keine Kosten) → ganz löschen, sonst abbrechen (Kosten bleiben stehen)
    if (r.a.status === "wartet" && r.a.kostenIst === 0 && ctx.session.role === "owner") {
      await auftragLoeschen(ctx.session, id);
      return `Video „${r.a.thema}“ gelöscht.`;
    }
    if (r.a.status === "fertig" || r.a.status === "abgebrochen") return `Video „${r.a.thema}“ ist schon ${r.a.status} – nichts geändert.`;
    await abbrechen(ctx.session, id);
    return `Video „${r.a.thema}“ abgebrochen (bisherige Kosten bleiben stehen).`;
  },
});

export const VIDEO = [videoAuftraegeTool, videoVidiqEintragenTool, videoAuftragAnlegenTool];
