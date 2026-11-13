import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, users } from "./core";

/**
 * B36 Video-Pipeline (YouTube): Das Seller-System steuert nur (Kanäle, Aufträge, Freigaben, Kosten, Dateien); Recherche,
 * Skript, Sprache, Bilder, Render und Upload macht der Worker (Python + ffmpeg) auf dem Arbeits-PC. Er holt sich die
 * Aufträge selbst ab (Token, Abfrage alle ~30 s) – keine offenen Ports am PC. Upload auf YouTube immer privat.
 */

export type VideoSchritt = "research" | "script" | "voice" | "visuals" | "render" | "package" | "upload" | "story";
export type VideoFreigabe = "gliederung" | "skript" | "szenen" | "vorschau" | "story";
export type SchrittStand = { status: "offen" | "laeuft" | "fertig" | "fehler"; fortschritt?: { fertig: number; gesamt: number } | null; fehler?: string | null; hinweise?: string[] | null; am?: string };
/** gefunden: URL stammt direkt aus den Suchtreffern der Recherche. */
export type VideoQuelle = { id: string; titel: string; url: string | null; jahr: number | null; art: string | null; autoren?: string | null; gefunden?: boolean };
export type VideoGliederung = { hook?: string | null; angst?: string | null; punkte: { titel: string; kern?: string; quelle_ids?: string[] }[]; fazit?: string | null; cta?: string | null };
/** Whiteboard-Collage (B36.9): Motiv mit Bibliotheks-Schlüssel (wiederverwendbar) und Beschreibung fürs Bildmodell. */
export type VideoMotiv = { key: string; beschreibung: string; ersatz?: boolean; wiederverwendet?: boolean; wort?: string | null };
/** B36.10: Takt einer Whiteboard-Szene (Zeitplan vor dem Render): Ereignisse, längste Pause, Ø-Abstand, Zeichenzeit. */
export type VideoTakt = { ereignisse: number; maxPause: number; mittel: number; hervorhebungen: number; drawS: number };
export type VideoSzene = {
  nr: number; abschnitt: string; text: string; bildidee: string; einblendung: string | null; quelle_ids: string[]; dauer?: number | null; ersatzbild?: boolean;
  // nur Stil „whiteboard“: Texte setzt die Pipeline selbst (Schrift fest), Motive kommen einzeln vom Bildmodell
  layout?: string | null; ueberschrift?: string | null; balken?: string | null; kernaussage?: string | null; schrittText?: string | null; liste?: string[] | null; motive?: VideoMotiv[] | null;
  takt?: VideoTakt | null;
};
/** B37 Instagram-Kanal: Zeitplan, Inhaltsarten, Gestaltung, Freigabe-Modus, Monatslimit, bestätigte Fakten, Themenliste.
 *  Fakten und Hinweistext pflegt Ludwig im Kanalprofil – keine Firmendaten oder Preise im Code. */
export type StoryInhaltsart = "preis" | "leistung" | "tipp" | "einblick" | "umfrage" | "cta";
export type StoryThema = { id: string; text: string; art: StoryInhaltsart; genutztAm?: string | null };
export type InstagramProfil = {
  tage?: number[]; uhrzeiten?: string[]; inhaltsarten?: StoryInhaltsart[];
  farben?: { grund: string; akzent: string; text: string }; hand?: boolean; hinweis?: string | null; werbung?: boolean;
  freigabeModus?: "jedes_mal" | "stichprobe" | "automatisch"; monatslimit?: number | null; fakten?: string | null; themen?: StoryThema[];
};
/** B37 Story (Auftrag art = „story“): Inhalt, Sticker-Vorschlag (nur von Hand in der App), Werbekennzeichnung, Foto/Motiv. */
export type VideoStory = {
  inhaltsart: StoryInhaltsart; themaId?: string | null; ueberschrift?: string | null; text?: string | null; cta?: string | null;
  sticker?: { art: "umfrage" | "frage"; frage: string; optionen?: string[] } | null; werbung?: boolean; fotoId?: string | null; motivKey?: string | null;
  format?: "mp4" | "png" | null; dauerSek?: number | null; regeln?: string[] | null; motivNeu?: boolean;
};
/** Stil-Referenzbild eines Kanals (Seite Video → Kanalprofil), wird dem Bildmodell als Vorlage mitgegeben. */
export type VideoReferenz = { nr: number; name: string; typ: string; groesse: number; hash: string };
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
    /** Bildstil der Pipeline: „vollbild“ (ein Symbolbild je Szene, Untertitel eingebrannt) oder „whiteboard“ (B36.9:
     *  Collage aus 3–5 Motiven, Hand zeichnet mit, Texte in fester Schrift, Untertitel als YouTube-Untertitel). */
    stil: text("stil", { enum: ["vollbild", "whiteboard"] }).notNull().default("vollbild"),
    /** B37: YouTube-Kanal (Videos) oder Instagram-Kanal (Stories im Hochformat). */
    plattform: text("plattform", { enum: ["youtube", "instagram"] }).notNull().default("youtube"),
    /** B36.10 Tempo der Zeichen-Animation je Motiv: ruhig 2,5 s · normal 2,0 s · schnell 1,5 s. */
    tempo: text("tempo", { enum: ["ruhig", "normal", "schnell"] }).notNull().default("normal"),
    /** B37 Instagram: Zeitplan, Inhaltsarten, Farben, Freigabe-Modus, Monatslimit, Fakten, Themenliste. */
    instagram: jsonb("instagram").$type<InstagramProfil>().notNull().default({}),
    /** Wiederkehrende Figuren, eine je Zeile „kurzname: Beschreibung“ (einmal festgelegt, immer gleich gezeichnet). */
    figuren: text("figuren"),
    /** Qualität beim Bildmodell (OpenAI GPT Image): low/medium/high – bestimmt die Kosten je Bild/Motiv. */
    bildQualitaet: text("bild_qualitaet", { enum: ["low", "medium", "high"] }).notNull().default("medium"),
    referenzen: jsonb("referenzen").$type<VideoReferenz[]>().notNull().default([]),
    /** Dateiname einer Hintergrundmusik im Ordner „musik“ des Workers (leer = ohne Musik). */
    musik: text("musik"),
    /** Welche Freigabe-Punkte aktiv sind. */
    freigaben: jsonb("freigaben").$type<Partial<Record<VideoFreigabe, boolean>>>().notNull().default({ gliederung: true, skript: true, vorschau: true }),
    /** YouTube-Zugang je Kanal: Refresh-Token verschlüsselt (pii); Kanalname zur Anzeige. */
    youtubeToken: text("youtube_token"),
    youtubeKanal: text("youtube_kanal"),
    youtubeVerbundenAm: timestamp("youtube_verbunden_am", { withTimezone: true }),
    /** B37 Instagram-Zugang (Instagram-Login, Business-Konto): Langzeit-Token verschlüsselt, läuft nach ~60 Tagen ab. */
    instagramToken: text("instagram_token"),
    instagramUserId: text("instagram_user_id"),
    instagramKonto: text("instagram_konto"),
    instagramTokenBis: timestamp("instagram_token_bis", { withTimezone: true }),
    instagramVerbundenAm: timestamp("instagram_verbunden_am", { withTimezone: true }),
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
    /** B37: „video“ (YouTube, 7 Schritte) oder „story“ (Instagram, ein Schritt „story“, dann Freigabe und Posten). */
    art: text("art", { enum: ["video", "story"] }).notNull().default("video"),
    thema: text("thema").notNull(),
    /** B37 Story: geplanter Post-Zeitpunkt (Zeitplan des Kanals) und Inhalt. */
    geplantFuer: timestamp("geplant_fuer", { withTimezone: true }),
    story: jsonb("story").$type<VideoStory | null>(),
    /** B37 Posten: geplant (wartet auf Zeitpunkt) · manuell (Stufe 1: von Hand posten) · gepostet · fehler. */
    igStatus: text("ig_status", { enum: ["geplant", "manuell", "gepostet", "fehler"] }),
    igMediaId: text("ig_media_id"),
    igVersuche: integer("ig_versuche").notNull().default(0),
    igFehler: text("ig_fehler"),
    igNaechsterVersuch: timestamp("ig_naechster_versuch", { withTimezone: true }),
    gepostetAm: timestamp("gepostet_am", { withTimezone: true }),
    /** vidIQ Stufe 1: von Claude/von Hand eingetragen, genutzt in Gliederung, Titeln, Tags, Kapiteln. */
    vidiqKeywords: text("vidiq_keywords"),
    vidiqTitel: text("vidiq_titel"),
    /** Optional: englische Vorlage (Transkript/Gliederung eines erfolgreichen Videos – nur Muster für Aufbau, nicht
     *  übersetzen) oder eigenes Skript (wird möglichst wörtlich übernommen). */
    vorlage: text("vorlage"),
    vorlageArt: text("vorlage_art", { enum: ["vorlage", "skript"] }),
    /** Szenen-Übersicht: diese Motive (Bibliotheks-Schlüssel) beim nächsten Lauf neu erzeugen. */
    neuMotive: jsonb("neu_motive").$type<string[]>().notNull().default([]),
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
  (t) => [index("video_auftraege_status").on(t.tenantId, t.status), index("video_auftraege_kanal").on(t.tenantId, t.kanalId), index("video_auftraege_geplant").on(t.tenantId, t.art, t.geplantFuer)],
);

/** B37 Foto-Mediathek je Instagram-Kanal: eigene Lager-Fotos (ohne Personen, von Ludwig bestätigt) für „Einblick“-Stories. */
export const videoFotos = pgTable(
  "video_fotos",
  {
    id: id(),
    tenantId: tenantId(),
    kanalId: uuid("kanal_id").notNull().references(() => videoKanaele.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    typ: text("typ").notNull(),
    groesse: integer("groesse").notNull(),
    hash: text("hash").notNull(),
    /** Beim Hochladen bestätigt: keine Personen im Bild, eigenes Foto. */
    ohnePersonen: boolean("ohne_personen").notNull().default(false),
    genutztAuftrag: uuid("genutzt_auftrag"),
    genutztAm: timestamp("genutzt_am", { withTimezone: true }),
    hochgeladenVon: uuid("hochgeladen_von").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("video_fotos_kanal").on(t.tenantId, t.kanalId)],
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
