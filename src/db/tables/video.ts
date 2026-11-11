import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, users } from "./core";

/**
 * B36 Video-Pipeline (YouTube): Das Seller-System steuert nur (Kanäle, Aufträge, Freigaben, Kosten, Dateien); Recherche,
 * Skript, Sprache, Bilder, Render und Upload macht der Worker (Python + ffmpeg) auf dem Arbeits-PC. Er holt sich die
 * Aufträge selbst ab (Token, Abfrage alle ~30 s) – keine offenen Ports am PC. Upload auf YouTube immer privat.
 */

export type VideoSchritt = "research" | "script" | "voice" | "visuals" | "render" | "package" | "upload";
export type VideoFreigabe = "gliederung" | "skript" | "vorschau";
export type SchrittStand = { status: "offen" | "laeuft" | "fertig" | "fehler"; fortschritt?: { fertig: number; gesamt: number } | null; fehler?: string | null; hinweise?: string[] | null; am?: string };
/** gefunden: URL stammt direkt aus den Suchtreffern der Recherche. */
export type VideoQuelle = { id: string; titel: string; url: string | null; jahr: number | null; art: string | null; autoren?: string | null; gefunden?: boolean };
export type VideoGliederung = { hook?: string | null; angst?: string | null; punkte: { titel: string; kern?: string; quelle_ids?: string[] }[]; fazit?: string | null; cta?: string | null };
export type VideoSzene = { nr: number; abschnitt: string; text: string; bildidee: string; einblendung: string | null; quelle_ids: string[]; dauer?: number | null; ersatzbild?: boolean };
export type VideoPaket = { titel: string[]; titelGewaehlt?: number | null; beschreibung: string; kapitel: { start: number; titel: string }[]; tags: string[]; thumbnailText: string | null; warnungen?: string[] };
export type VideoKosten = { anbieter: string; art: string; menge: number; einheit: string; betrag: number | null; am: string };
/** drive: Datei-ID in Google Drive (Ablage „Drive“) – dann liegt die Datei nicht auf dem Seller-Server. */
export type VideoDatei = { key: string; name: string; typ: string; groesse: number; drive?: string | null; link?: string | null };

export const videoKanaele = pgTable(
  "video_kanaele",
  {
    id: id(),
    tenantId: tenantId(),
    /** Kurzname für Ordner/Dateien im Worker (a–z, 0–9, -). */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    handle: text("handle"),
    sprache: text("sprache").notNull().default("de"),
    themenbereich: text("themenbereich"),
    /** Zielgruppe (z. B. Altersgruppe) – Ansprache, Beispiele und Studien werden darauf ausgerichtet. */
    zielgruppe: text("zielgruppe"),
    /** Ziel-Videolänge in Minuten (von–bis); daraus Wörter, Szenen und Render-Prüfung. */
    laengeMin: integer("laenge_min").notNull().default(16),
    laengeMax: integer("laenge_max").notNull().default(20),
    /** ElevenLabs-Voice-ID. */
    stimmeId: text("stimme_id"),
    bildstil: text("bildstil"),
    sicherheitsstufe: text("sicherheitsstufe", { enum: ["normal", "streng"] }).notNull().default("normal"),
    /** Dateiname einer Hintergrundmusik im Ordner „musik“ des Workers (leer = ohne Musik). */
    musik: text("musik"),
    /** Welche Freigabe-Punkte aktiv sind. */
    freigaben: jsonb("freigaben").$type<Record<VideoFreigabe, boolean>>().notNull().default({ gliederung: true, skript: true, vorschau: true }),
    /** YouTube-Zugang je Kanal: Refresh-Token verschlüsselt (pii); Kanalname zur Anzeige. */
    youtubeToken: text("youtube_token"),
    youtubeKanal: text("youtube_kanal"),
    youtubeVerbundenAm: timestamp("youtube_verbunden_am", { withTimezone: true }),
    aktiv: boolean("aktiv").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("video_kanaele_slug").on(t.tenantId, t.slug)],
);

export const videoAuftraege = pgTable(
  "video_auftraege",
  {
    id: id(),
    tenantId: tenantId(),
    kanalId: uuid("kanal_id").notNull().references(() => videoKanaele.id, { onDelete: "cascade" }),
    thema: text("thema").notNull(),
    /** vidIQ Stufe 1: von Claude/von Hand eingetragen, genutzt in Gliederung, Titeln, Tags, Kapiteln. */
    vidiqKeywords: text("vidiq_keywords"),
    vidiqTitel: text("vidiq_titel"),
    /** Optional: englische Vorlage (Transkript/Gliederung eines erfolgreichen Videos – nur Muster für Aufbau, nicht
     *  übersetzen) oder eigenes Skript (wird möglichst wörtlich übernommen). */
    vorlage: text("vorlage"),
    vorlageArt: text("vorlage_art", { enum: ["vorlage", "skript"] }),
    /** Anmerkung zur Gliederung/zum Skript (bei Freigabe oder „neu“). */
    hinweis: text("hinweis"),
    /** Frühester Start (z. B. „heute Nacht“). */
    startAb: timestamp("start_ab", { withTimezone: true }),
    status: text("status", { enum: ["wartet", "laeuft", "freigabe", "fertig", "fehler", "abgebrochen"] }).notNull().default("wartet"),
    /** Nächster bzw. laufender Schritt. */
    schritt: text("schritt").$type<VideoSchritt>().notNull().default("research"),
    schritte: jsonb("schritte").$type<Partial<Record<VideoSchritt, SchrittStand>>>().notNull().default({}),
    freigabeOffen: text("freigabe_offen").$type<VideoFreigabe | null>(),
    freigegeben: jsonb("freigegeben").$type<Partial<Record<VideoFreigabe, string>>>().notNull().default({}),
    gliederung: jsonb("gliederung").$type<VideoGliederung | null>(),
    quellen: jsonb("quellen").$type<VideoQuelle[]>().notNull().default([]),
    skript: jsonb("skript").$type<VideoSzene[] | null>(),
    paket: jsonb("paket").$type<VideoPaket | null>(),
    woerter: integer("woerter"),
    dauerSek: integer("dauer_sek"),
    kostenSchaetzung: numeric("kosten_schaetzung", { precision: 10, scale: 2, mode: "number" }),
    kostenIst: numeric("kosten_ist", { precision: 10, scale: 4, mode: "number" }).notNull().default(0),
    kostenPositionen: jsonb("kosten_positionen").$type<VideoKosten[]>().notNull().default([]),
    dateien: jsonb("dateien").$type<Partial<Record<string, VideoDatei>>>().notNull().default({}),
    /** Schalter „Privat hochladen“: nur dann lädt der Worker hoch – immer privat. */
    hochladen: boolean("hochladen").notNull().default(false),
    youtubeId: text("youtube_id"),
    youtubeStatus: text("youtube_status"),
    /** „Schritt wiederholen“: Worker führt diesen Schritt erneut aus (bezahlte Dateien bleiben). */
    wiederholen: text("wiederholen").$type<VideoSchritt | null>(),
    workerId: uuid("worker_id"),
    zuletztVomWorker: timestamp("zuletzt_vom_worker", { withTimezone: true }),
    /** Arbeitsdateien am PC dürfen gelöscht werden (Dateien im Seller-System gesichert bzw. abgebrochen). */
    aufraeumen: boolean("aufraeumen").notNull().default(false),
    erstelltVon: uuid("erstellt_von").references(() => users.id, { onDelete: "set null" }),
    fertigAm: timestamp("fertig_am", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("video_auftraege_status").on(t.tenantId, t.status), index("video_auftraege_kanal").on(t.tenantId, t.kanalId)],
);

/** Worker am Arbeits-PC: Token (nur Prüfsumme), zuletzt gesehen, freie Platte, Version. */
export const videoWorker = pgTable(
  "video_worker",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenAnfang: text("token_anfang").notNull(),
    angelegtVon: uuid("angelegt_von").references(() => users.id, { onDelete: "set null" }),
    deaktiviertAm: timestamp("deaktiviert_am", { withTimezone: true }),
    zuletztGesehen: timestamp("zuletzt_gesehen", { withTimezone: true }),
    version: text("version"),
    freiGb: numeric("frei_gb", { precision: 8, scale: 1, mode: "number" }),
    info: jsonb("info").$type<{ os?: string; python?: string; ffmpeg?: string; laeuft?: string | null }>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("video_worker_token").on(t.tokenHash)],
);
