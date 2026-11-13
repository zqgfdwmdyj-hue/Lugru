// Bauauftrag B36 Video-Pipeline – Abnahme B36.7 (1–8) mit dem echten Python-Worker (unter-der-decke/worker.py) gegen
// das Seller-System und die Nachbauten (Claude, ElevenLabs, OpenAI-Bilder, YouTube). Kanal, Stimme, Token und alle
// Daten sind erfunden; kein echter Kanal, kein echter Schlüssel.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { E2E_ENV, E2E_PORT, TD } from "./env";
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

function versiegeln(plain: string) {
  const key = createHash("sha256").update(`integrations:${E2E_ENV.APP_SECRET}`).digest();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
type VideoNb = { modellFehler: string[]; eleven: { hash: string; zeichen: number; stimme: string; zeiten?: boolean }[]; bilder: { prompt: string; abgelehnt: boolean; model: string; size: string; quality: string }[]; youtube: { id: string; titel: string; sichtbarkeit: string; beschreibung: string; tags: string[]; thumbnail: boolean }[] };
/** Einfarbiges PNG (erfundenes Testfoto) – ohne Bildbibliothek. */
function pngFarbe(w: number, h: number, rgb: [number, number, number]): Buffer {
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) {
      c ^= x;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const block = (typ: string, daten: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(daten.length);
    const td = Buffer.concat([Buffer.from(typ), daten]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const kopf = Buffer.alloc(13);
  kopf.writeUInt32BE(w, 0);
  kopf.writeUInt32BE(h, 4);
  kopf.set([8, 2, 0, 0, 0], 8);
  const zeile = Buffer.concat([Buffer.from([0]), ...Array.from({ length: w }, () => Buffer.from(rgb))]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), block("IHDR", kopf), block("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => zeile)))), block("IEND", Buffer.alloc(0))]);
}

/** Wartet, bis die Story mit diesem Thema im Fehler steht (z. B. Monatslimit). */
async function warteStoriesFehler<S extends { thema: string; status: string }>(liste: () => Promise<S[]>, thema: string, ms = 60_000): Promise<S> {
  for (const bis = Date.now() + ms; ; ) {
    const s = (await liste()).find((x) => x.thema === thema);
    if (s?.status === "fehler") return s;
    if (Date.now() > bis) throw new Error(`Zeitüberschreitung: ${thema} (${s?.status})`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

const nachbau = () => fetch(`${TD}/__video`).then((r) => r.json() as Promise<VideoNb & { claude: string[] }>);
const stoeren = (schluessel: string, art: string, anzahl: number) => fetch(`${TD}/__video`, { method: "POST", body: JSON.stringify({ stoerung: { schluessel, art, anzahl } }) });
type Auftrag = { id: string; status: string; schritt: string; freigabe_offen: string | null; schritte: Record<string, { status: string; fortschritt?: { fertig: number; gesamt: number } | null; fehler?: string | null }>; woerter: number | null; dauer_sek: number | null; skript: { abschnitt: string; quelle_ids: string[]; ersatzbild?: boolean; text: string }[] | null; quellen: { id: string }[]; paket: { titel: string[]; beschreibung: string; kapitel: { start: number; titel: string }[]; tags: string[] } | null; dateien: Record<string, { groesse: number }>; kosten_ist: number; kosten_positionen: { anbieter: string; betrag: number | null }[]; youtube_id: string | null; youtube_status: string | null; aufraeumen: boolean };

const PY = process.env.VIDEO_WORKER_PYTHON || "python3";
const THEMA = "Kein Sex mehr in der Beziehung? 5 Gründe, über die keiner spricht";

test.describe("B36 Video-Pipeline", () => {
  const m = marke();
  const KANAL = `Testkanal Decke ${m}`;
  const arbeit = mkdtempSync(path.join(tmpdir(), "video-worker-"));
  let T = "";
  let worker: ChildProcess | null = null;
  let token = "";
  let googleNeu = false;
  let igNeu = false;
  const logDatei = path.join(process.cwd(), "test-results", "b36-worker.log");
  let log = "";

  const workerStarten = () => {
    worker = spawn(PY, [path.join(process.cwd(), "unter-der-decke", "worker.py")], {
      env: { ...process.env, SELLER_URL: `http://localhost:${E2E_PORT}`, WORKER_TOKEN: token, ARBEITSORDNER: path.join(arbeit, "projekte"), MUSIKORDNER: path.join(arbeit, "musik"), VIDEO_POLL_S: "1", VIDEO_FPS: "2", MIN_FREI_GB: "0.1", WARN_FREI_GB: "0.1", PYTHONUNBUFFERED: "1", WIEDERHOLEN_FAKTOR: "0.01" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    worker.stdout?.on("data", (d) => (log += d));
    worker.stderr?.on("data", (d) => (log += d));
  };
  const workerStoppen = async () => {
    if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
    const w = worker;
    w.kill("SIGKILL");
    await new Promise((r) => w.once("exit", r));
  };
  const auftrag = async (): Promise<Auftrag> => (await sql<Auftrag>("select id, status, schritt, freigabe_offen, schritte, woerter, dauer_sek, skript, quellen, paket, dateien, kosten_ist::float as kosten_ist, kosten_positionen, youtube_id, youtube_status, aufraeumen from video_auftraege a where tenant_id = $1 and kanal_id = (select id from video_kanaele where tenant_id = $1 and name = $2) order by created_at desc limit 1", [T, KANAL]))[0];
  const warteAuf = async (was: string, pruefen: (a: Auftrag) => boolean, ms = 240_000) => {
    const bis = Date.now() + ms;
    for (;;) {
      const a = await auftrag();
      if (a && pruefen(a)) return a;
      if (a?.status === "fehler") throw new Error(`Auftrag im Fehler (${a.schritt}): ${a.schritte[a.schritt]?.fehler}\n--- Worker ---\n${log.slice(-3000)}`);
      if (Date.now() > bis) throw new Error(`Zeitüberschreitung: ${was} (Stand ${a?.status}/${a?.schritt})\n--- Worker ---\n${log.slice(-3000)}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  };

  test.afterAll(async () => {
    await workerStoppen();
    mkdirSync(path.dirname(logDatei), { recursive: true });
    writeFileSync(logDatei, log);
    if (T) {
      const namen = [KANAL, `Testkanal Drive ${m}`, `Testkanal Whiteboard ${m}`, `Testkanal Chat ${m}`, `Testkanal Instagram ${m}`];
      const ids = await sql<{ id: string }>("select a.id from video_auftraege a join video_kanaele k on k.id = a.kanal_id where a.tenant_id = $1 and k.name = any($2)", [T, namen]);
      for (const { id } of ids) rmSync(path.join(E2E_ENV.MEDIA_DIR, "video", T, id), { recursive: true, force: true });
      const kanaeleIds = await sql<{ id: string }>("select id from video_kanaele where tenant_id = $1 and name = any($2)", [T, namen]);
      for (const { id } of kanaeleIds) rmSync(path.join(E2E_ENV.MEDIA_DIR, "video", T, `kanal-${id}`), { recursive: true, force: true });
      await sql("delete from video_kanaele where tenant_id = $1 and name = any($2)", [T, namen]);
      await sql("delete from video_worker where tenant_id = $1 and name = $2", [T, `Test-PC ${m}`]);
      await sql(`delete from integrations where tenant_id = $1 and provider in ('elevenlabs', 'openai'${googleNeu ? ", 'google'" : ""}${igNeu ? ", 'instagram'" : ""})`, [T]);
      await sql("update tenants set settings = settings - 'video' where id = $1", [T]);
    }
    rmSync(arbeit, { recursive: true, force: true });
  });

  test("Abnahme B36.7 1–8: Gliederung → Skript → Abbruch/Neustart → MP4 → privat hochladen, Kosten, Worker aus, Ersatzbild", async ({ page }) => {
    test.setTimeout(600_000);
    [{ id: T }] = await sql<{ id: string }>("select tenant_id as id from lots where sku = 'TEST-SOCKEN' limit 1");
    // Zugänge wie über das sichere Formular (verschlüsselt), nur Testwerte. Claude-Schlüssel liegt aus den Testdaten vor.
    await sql("delete from integrations where tenant_id = $1 and provider in ('elevenlabs', 'openai')", [T]);
    await sql("insert into integrations (tenant_id, provider, label, config, secret_encrypted) values ($1, 'elevenlabs', 'Test', '{}'::jsonb, $2), ($1, 'openai', 'Test', '{}'::jsonb, $3)", [T, versiegeln(JSON.stringify({ apiKey: "test-elevenlabs-schluessel" })), versiegeln(JSON.stringify({ apiKey: "test-openai-schluessel" }))]);
    if (!(await sql("select 1 from integrations where tenant_id = $1 and provider = 'google'", [T])).length) {
      googleNeu = true;
      await sql("insert into integrations (tenant_id, provider, label, config, secret_encrypted) values ($1, 'google', 'Test', $2::jsonb, $3)", [T, JSON.stringify({ clientId: "test-google-client.apps.example.invalid" }), versiegeln(JSON.stringify({ clientSecret: "test-google-secret" }))]);
    }
    await sql("update tenants set settings = settings || jsonb_build_object('video', $2::jsonb) where id = $1", [T, JSON.stringify({ preise: { claudeEingabeJeMio: 2, claudeAusgabeJeMio: 10, websucheJe1000: 10, elevenlabsJe1000Zeichen: 0.18, bildJeStueck: 0.04 }, serverReserveGb: 0.1 })]);
    await fetch(`${TD}/__video`, { method: "POST", body: JSON.stringify({ zuruecksetzen: true, verzoegerungMs: 150 }) });

    await anmelden(page, "inhaber");
    // Kanal anlegen (Profil im Seller-System; Sicherheitsstufe streng, alle drei Freigaben)
    await page.goto("/marken/video?neu=1");
    await page.getByTestId("vd-k-name").fill(KANAL);
    await page.getByTestId("vd-k-thema").fill("Beziehung, Nähe, Alltag (Testkanal)");
    await page.getByTestId("vd-k-zielgruppe").fill("Männer ab 55");
    await expect(page.getByTestId("vd-k-laenge")).toContainText("fest 1.500–1.700 Wörter (≈ 10–12 Min.)"); // fest für alle Kanäle
    await page.getByTestId("vd-k-stimme").fill("testStimme01");
    await page.getByTestId("vd-k-stufe").selectOption("streng");
    await Promise.all([aktion(page), page.getByTestId("vd-k-speichern").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("Kanal angelegt");
    await expect(page.getByTestId("vd-kanaele")).toContainText(KANAL);

    // Worker anlegen: Token nur einmal sichtbar
    await page.getByTestId("vw-name").fill(`Test-PC ${m}`);
    await Promise.all([aktion(page), page.getByTestId("vw-anlegen-los").click()]);
    token = (await page.getByTestId("vw-token").innerText()).trim();
    expect(token).toMatch(/^vw_[A-Za-z0-9_-]{40,}$/);
    expect((await sql<{ token_hash: string }>("select token_hash from video_worker where tenant_id = $1 and name = $2", [T, `Test-PC ${m}`]))[0].token_hash).not.toContain(token.slice(3));

    // Neues Video (mit vidIQ-Keywords) – Worker noch aus → „wartet“ + Warnung (Abnahme 7)
    await page.goto("/marken/video");
    await page.getByRole("link", { name: KANAL }).click();
    await expect(page.getByTestId("vd-ziel")).toContainText("10–12 Min. · 1.500–1.700 Wörter");
    await expect(page.getByTestId("vd-ziel")).toContainText("Zielgruppe: Männer ab 55");
    await page.getByTestId("vd-thema").fill(THEMA);
    await page.getByTestId("vd-neu").locator("summary", { hasText: "vidIQ" }).click();
    await page.getByTestId("vd-vidiq-keywords").fill("beziehung ohne nähe, paar alltag stress");
    await expect(page.getByTestId("vd-schaetzung")).toContainText("$");
    await Promise.all([aktion(page), page.getByTestId("vd-start").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("Video angelegt");
    const karte = page.getByTestId("vd-auftrag").first();
    await expect(karte).toHaveAttribute("data-status", "wartet");
    await expect(page.getByTestId("vd-worker-stand")).toHaveAttribute("data-online", "0");
    await expect(page.getByTestId("vd-worker-stand")).toHaveClass(/notice-warn/);

    // Robustheit (Nachtrag 12.11.): Störungen im Nachbau – Quellen „Punkt 2“ einmal 529, Skript-Hook einmal Abbruch mitten
    // im Stream (der Fehler aus dem Betrieb), „Punkt 3“ bricht 5-mal ab (alle Versuche), ElevenLabs zweimal Abbruch
    await stoeren("research:punkt-2", "529", 1);
    await stoeren("script:hook", "abbruch", 1);
    await stoeren("script:punkt-3", "abbruch", 5);
    await stoeren("eleven", "abbruch", 2);

    // Abnahme 1: Worker starten → Gliederung mit Quellen erscheint zur Freigabe
    workerStarten();
    await warteAuf("Freigabe Gliederung", (a) => a.freigabe_offen === "gliederung");
    await page.reload();
    await expect(page.getByTestId("vd-worker-stand")).toHaveAttribute("data-online", "1");
    await expect(page.getByTestId("vd-worker-alt")).toHaveCount(0); // aktueller Worker: kein Hinweis „veraltet“
    await expect(karte.getByTestId("vd-status")).toContainText("Gliederung + Quellen");
    await expect(karte.getByTestId("vd-punkt")).toHaveCount(5);
    await expect(karte.getByTestId("vd-quelle")).toHaveCount(6);
    const ki = (await (await fetch(`${TD}/__ki`)).json()) as { text: string; tools: string[] }[];
    const recherche = ki.filter((k) => k.text.startsWith("[video:research:gliederung]")).at(-1)!;
    expect(recherche.tools).toContain("web_search");
    // Recherche abschnittsweise: Gliederung + je Punkt ein eigener Aufruf mit Websuche; „Punkt 2“ nach 529 wiederholt
    expect(ki.filter((k) => /^\[video:research:punkt-\d\]/.test(k.text) && k.tools.includes("web_search")).length).toBeGreaterThanOrEqual(5);
    expect((await nachbau()).claude.filter((x) => x === "research:punkt-2")).toHaveLength(2);
    expect(recherche.text).toContain("beziehung ohne nähe"); // vidIQ fließt in die Recherche
    expect(recherche.text).toContain("Zielgruppe: Männer ab 55"); // Zielgruppe aus dem Kanalprofil
    expect(recherche.text).toContain("(10–12 Minuten)");
    await Promise.all([aktion(page), karte.getByTestId("vd-freigeben").click()]);

    // Skript abschnittsweise: „Punkt 3“ scheitert 5-mal → Schritt-Fehler mit Abschnittsname; fertige Abschnitte liegen als
    // Dateien im Projektordner; der Hook wurde nach einem Abbruch mitten im Stream automatisch neu geholt
    let a = await auftrag();
    for (const bis = Date.now() + 120_000; a.status !== "fehler" && Date.now() < bis; a = await auftrag()) await new Promise((r) => setTimeout(r, 250));
    expect(a.status, log.slice(-2000)).toBe("fehler");
    expect(a.schritt).toBe("script");
    expect(a.schritte.script?.fehler).toContain("Skript – Punkt 3: nach 5 Versuchen nicht geklappt");
    let abschnitte = (await nachbau()).claude;
    const anzahl = (k: string) => abschnitte.filter((x) => x === k).length;
    expect([anzahl("script:hook"), anzahl("script:angst"), anzahl("script:punkt-1"), anzahl("script:punkt-3"), anzahl("script:punkt-4")]).toEqual([2, 1, 1, 5, 0]);
    expect(log).toContain("Skript – Hook:");
    expect(log).toContain("neuer Versuch in 2 s");
    const slug1 = (await sql<{ slug: string }>("select slug from video_kanaele where tenant_id = $1 and name = $2", [T, KANAL]))[0].slug;
    const skriptOrdner = path.join(arbeit, "projekte", slug1, a.id, "skript");
    expect(readdirSync(skriptOrdner).flatMap((h) => readdirSync(path.join(skriptOrdner, h))).sort()).toEqual(["angst.json", "hook.json", "punkt-1.json", "punkt-2.json"]);
    await page.reload();
    await expect(karte.getByTestId("vd-fehler")).toContainText("Skript – Punkt 3");
    // „Schritt wiederholen“: nur der fehlende Abschnitt und die danach werden geholt
    await Promise.all([aktion(page), karte.getByTestId("vd-wiederholen").click()]);

    // Abnahme 2: Skript mit 5–7 Punkten, Länge fest 1.500–1.700 Wörter, alle Studien in der Quellenliste
    a = await warteAuf("Freigabe Skript", (x) => x.freigabe_offen === "skript");
    abschnitte = (await nachbau()).claude;
    expect([anzahl("script:hook"), anzahl("script:angst"), anzahl("script:punkt-1"), anzahl("script:punkt-3"), anzahl("script:punkt-4"), anzahl("script:cta")]).toEqual([2, 1, 1, 6, 1, 1]);
    expect(a.woerter).toBeGreaterThanOrEqual(1500);
    expect(a.woerter).toBeLessThanOrEqual(1700);
    const skriptPrompt = ((await (await fetch(`${TD}/__ki`)).json()) as { text: string }[]).filter((k) => k.text.startsWith("[video:script:punkt-1]")).at(-1)!;
    expect(skriptPrompt.text).toContain("insgesamt 1.500–1.700 Wörter");
    expect(skriptPrompt.text).toContain("Schreibe jetzt NUR den Abschnitt „Punkt 1“");
    const punkte = new Set(a.skript!.filter((s) => s.abschnitt.startsWith("punkt-")).map((s) => s.abschnitt));
    expect(punkte.size).toBeGreaterThanOrEqual(5);
    expect(punkte.size).toBeLessThanOrEqual(7);
    const ids = new Set(a.quellen.map((q) => q.id));
    for (const s of a.skript!) for (const q of s.quelle_ids) expect(ids.has(q), q).toBe(true);
    for (const s of a.skript!.filter((x) => x.abschnitt.startsWith("punkt-"))) expect(s.quelle_ids.length).toBeGreaterThan(0);
    const szenen = a.skript!.length;
    await page.reload();
    await expect(karte.getByTestId("vd-skript")).toContainText(`${a.woerter} Wörter`);
    await Promise.all([aktion(page), karte.getByTestId("vd-freigeben").click()]);

    // Abnahme 4: mitten in „Sprache“ abbrechen (Prozess hart beenden) …
    await warteAuf("Sprache läuft", (x) => (x.schritte.voice?.fortschritt?.fertig ?? 0) >= 5, 120_000);
    await workerStoppen();
    const vorNeustart = (await nachbau()).eleven.length;
    expect(vorNeustart).toBeLessThan(szenen);
    // Abnahme 7: Worker seit 11 Min. still → „wartet (Worker aus)“ + Warnung
    await sql("update video_worker set zuletzt_gesehen = now() - interval '11 minutes' where tenant_id = $1 and name = $2", [T, `Test-PC ${m}`]);
    await page.reload();
    await expect(page.getByTestId("vd-worker-stand")).toContainText("seit 11 Min. keine Meldung");
    await expect(page.getByTestId("vd-worker-stand")).toHaveClass(/notice-warn/);
    await expect(karte.getByTestId("vd-status")).toContainText("wartet (Worker aus)");
    // Meldet ein Worker eine alte Version (vor den Abschnitten/Wiederholungen), steht oben ein Hinweis
    await sql("update video_worker set version = '1.0.0' where tenant_id = $1 and name = $2", [T, `Test-PC ${m}`]);
    await page.reload();
    await expect(page.getByTestId("vd-worker-alt")).toContainText("veraltet (v1.0.0, aktuell v1.2.0)");
    // … Neustart setzt fort, ohne bezahlte Sprache/Bilder neu zu erzeugen
    workerStarten();
    a = await warteAuf("Freigabe Vorschau", (x) => x.freigabe_offen === "vorschau", 420_000);
    const nb = await nachbau();
    const verschieden = new Set(nb.eleven.map((e) => e.hash));
    expect(verschieden.size).toBe(szenen);
    expect(nb.eleven.length).toBeLessThanOrEqual(szenen + 1); // höchstens die eine Szene, die beim Abbruch unterwegs war
    expect(nb.eleven.every((e) => e.stimme === "testStimme01")).toBe(true);
    expect(log).toContain("Sprache – Szene"); // ElevenLabs-Abbruch → neuer Versuch, ohne doppelte Kosten

    // Abnahme 8: OpenAI 1536×1024 medium, Modell aus den Einstellungen (Standard GPT Image 2.5 Flare – gpt-image-1 ist
    // abgeschaltet, der Nachbau lehnt es ab); Ablehnung → Ersatzbild; strenger Filter vor dem Aufruf
    expect(nb.bilder.every((b) => b.model === "gpt-image-2.5-flare" && b.size === "1536x1024" && b.quality === "medium")).toBe(true);
    expect(nb.modellFehler).toEqual([]);
    expect(nb.bilder.filter((b) => b.abgelehnt)).toHaveLength(1);
    expect(nb.bilder.length).toBe(szenen + 1);
    expect(nb.bilder.some((b) => /\bbett\b/i.test(b.prompt))).toBe(false);
    expect(a.skript!.filter((s) => s.ersatzbild).length).toBeGreaterThanOrEqual(2); // abgelehnt + Filter „Bett“

    // Abnahme 3: MP4 ≈ 10–12 Min. (Nachbau spricht 156 Wörter/Min.), 1920×1080, Untertitel; Thumbnail 1280×720; 5 Titel, Beschreibung mit Kapiteln, Tags
    for (const art of ["mp4", "thumbnail", "skript", "quellen", "untertitel"]) expect(a.dateien[art]?.groesse, art).toBeGreaterThan(0);
    const ordner = path.join(E2E_ENV.MEDIA_DIR, "video", T, a.id);
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", path.join(ordner, "video.mp4")]).toString()) as { streams: { width: number; height: number }[]; format: { duration: string } };
    expect([probe.streams[0].width, probe.streams[0].height]).toEqual([1920, 1080]);
    expect(Number(probe.format.duration)).toBeGreaterThanOrEqual(570);
    expect(Number(probe.format.duration)).toBeLessThanOrEqual(720);
    const thumb = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "json", path.join(ordner, "thumbnail.png")]).toString()) as { streams: { width: number; height: number }[] };
    expect([thumb.streams[0].width, thumb.streams[0].height]).toEqual([1280, 720]);
    const srt = readFileSync(path.join(ordner, "untertitel.srt"), "utf8");
    expect(srt.match(/-->/g)!.length).toBeGreaterThan(100);
    expect(a.paket!.titel).toHaveLength(5);
    expect(a.paket!.beschreibung).toContain("Kapitel:\n0:00 Intro");
    expect(a.paket!.beschreibung).toContain("Quellen:");
    expect(a.paket!.kapitel.length).toBeGreaterThanOrEqual(3);
    expect(a.paket!.tags.length).toBeGreaterThanOrEqual(10);
    await page.reload();
    await expect(karte.getByTestId("vd-player")).toBeVisible();
    await expect(karte.getByTestId("vd-thumbnail")).toBeVisible();
    await expect(karte.getByTestId("vd-titel").locator("li")).toHaveCount(5);
    await expect(karte.getByTestId("vd-kapitel")).toContainText("0:00 Intro");
    const kopf = await page.request.get(`/api/video/${a.id}/mp4`, { headers: { Range: "bytes=0-99" } });
    expect(kopf.status()).toBe(206);

    // Abnahme 5: YouTube verbinden, „Privat hochladen“ an, Vorschau freigeben → privates Video
    await page.getByTestId("vd-yt-verbinden").click();
    await expect(page.getByTestId("vd-meldung")).toContainText("YouTube verbunden (Testkanal (Nachbau))");
    await expect(page.getByTestId("vd-yt-verbunden")).toBeVisible();
    const tok = await sql<{ youtube_token: string }>("select youtube_token from video_kanaele where tenant_id = $1 and name = $2", [T, KANAL]);
    expect(tok[0].youtube_token).not.toContain("yt-refresh-test"); // verschlüsselt gespeichert
    await Promise.all([aktion(page), karte.getByTestId("vd-hochladen").click()]);
    await expect(karte.getByTestId("vd-hochladen")).toHaveAttribute("data-an", "1");
    await karte.locator("select[name=titelWahl]").selectOption("1");
    await Promise.all([aktion(page), karte.getByTestId("vd-freigeben").click()]);
    a = await warteAuf("Upload fertig", (x) => x.status === "fertig" && !!x.youtube_id, 120_000);
    expect(a.youtube_status).toBe("privat");
    const yt = (await nachbau()).youtube;
    expect(yt).toHaveLength(1);
    expect(yt[0].sichtbarkeit).toBe("private");
    expect(yt[0].titel).toBe(a.paket!.titel[1]);
    expect(yt[0].thumbnail).toBe(true);
    expect(yt[0].beschreibung).toContain("Kapitel:");
    await page.reload();
    await expect(karte.getByTestId("vd-youtube")).toContainText("privat");

    // Abnahme 6: Kosten je Video in der Liste (Schätzung + Ist), Summe je Monat/Kanal, Wochenrückblick
    expect(a.kosten_ist).toBeGreaterThan(0);
    const anbieter = new Set(a.kosten_positionen.map((k) => k.anbieter));
    expect([...anbieter].sort()).toEqual(["Claude", "ElevenLabs", "OpenAI"]);
    await expect(karte.getByTestId("vd-kosten")).toContainText("Ist");
    await expect(karte.getByTestId("vd-kosten")).not.toContainText("Ist –");
    await expect(page.getByTestId("vd-kosten-monat")).toContainText(KANAL);
    await page.goto("/kalender/feierabend?rueckblick=1");
    await expect(page.getByTestId("fa-video")).toContainText("Video:");

    // B36.6: nach „fertig“ räumt der Worker seinen Projektordner auf (Dateien sind im Seller-System gesichert)
    const projekt = path.join(arbeit, "projekte", (await sql<{ slug: string }>("select slug from video_kanaele where tenant_id = $1 and name = $2", [T, KANAL]))[0].slug, a.id);
    await expect.poll(() => existsSync(projekt), { timeout: 20_000 }).toBe(false);

    // Abnahme 7 (Rest) + B36.6: Seller-System rechnet nicht (kein ffmpeg im Seller-Server-Code); unter 3 GB frei startet kein Lauf
    await workerStoppen();
    await sql("update video_worker set frei_gb = 2.0 where tenant_id = $1 and name = $2", [T, `Test-PC ${m}`]);
    await page.goto("/marken/video");
    await page.getByRole("link", { name: KANAL }).click();
    await expect(page.getByTestId("vd-worker-platz")).toContainText("unter 3 GB: kein Lauf");
    await page.getByTestId("vd-thema").fill("Zweites Testthema für den Platz-Schutz");
    await Promise.all([aktion(page), page.getByTestId("vd-start").click()]);
    const r = await fetch(`http://localhost:${E2E_PORT}/api/video-worker/auftrag`, { headers: { Authorization: `Bearer ${token}` } });
    const j = (await r.json()) as { auftrag: unknown; grund?: string };
    expect(j.auftrag).toBeNull();
    expect(j.grund).toContain("Zu wenig freier Speicher");
    // Ohne gültiges Token: nichts
    expect((await fetch(`http://localhost:${E2E_PORT}/api/video-worker/auftrag`, { headers: { Authorization: "Bearer vw_falsch-falsch-falsch-falsch-falsch" } })).status).toBe(401);
  });

  test("B36.6 Ablage Google Drive: Worker lädt direkt nach Drive, Seller-Server nur kleine Dateien; Upload holt das Video aus Drive; Opus als Standard", async ({ page }) => {
    test.setTimeout(300_000);
    if (!T) [{ id: T }] = await sql<{ id: string }>("select tenant_id as id from lots where sku = 'TEST-SOCKEN' limit 1");
    const KANAL2 = `Testkanal Drive ${m}`;
    const THEMA2 = "Mit 60, 70 oder 80: Warum manche Männer lange können und andere nicht";
    const VORLAGE = "HOOK: What if I told you that age is not the main reason? (Test template, invented.) Today we look at five reasons why some men stay fit into their eighties and others do not. " + "Reason one: sleep and recovery matter more than most people think. ".repeat(6);
    await fetch(`${TD}/__video`, { method: "POST", body: JSON.stringify({ zuruecksetzen: true, verzoegerungMs: 0 }) });
    await anmelden(page, "inhaber");
    await page.goto("/marken/video");
    // Modell: Standard Opus 5.5 (Schätzung nennt es)
    await expect(page.getByTestId("vd-modell-claude-opus-5-5")).toBeChecked();
    // Google Drive verbinden (Nachbau-Anmeldung) → Ablage „Google Drive“
    await page.getByTestId("vd-drive-verbinden").click();
    await expect(page.getByTestId("vd-meldung")).toContainText("Google Drive verbunden");
    await expect(page.getByTestId("vd-drive-verbunden")).toBeVisible();
    await expect(page.getByTestId("vd-ablage-drive")).toBeChecked();
    // Bildmodell: Standard GPT Image 2.5 Flare; hier Sunburst wählen und speichern – die Brücke setzt es bei jedem Bild
    await expect(page.getByTestId("vd-bildmodell-gpt-image-2.5-flare")).toBeChecked();
    await page.getByTestId("vd-bildmodell-gpt-image-2.5-sunburst").check();
    await Promise.all([aktion(page), page.getByTestId("vd-ablage-speichern").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("Bilder GPT Image 2.5 Sunburst");
    await expect(page.getByTestId("vd-bildmodell-gpt-image-2.5-sunburst")).toBeChecked();
    // Kanal ohne Freigaben, mit YouTube
    await page.goto("/marken/video?neu=1");
    await page.getByTestId("vd-k-name").fill(KANAL2);
    await page.getByTestId("vd-k-stimme").fill("testStimme02");
    await page.getByTestId("vd-k-zielgruppe").fill("Männer ab 55");
    for (const f of ["f_gliederung", "f_skript", "f_vorschau"]) await page.locator(`input[name=${f}]`).uncheck();
    await Promise.all([aktion(page), page.getByTestId("vd-k-speichern").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("Kanal angelegt");
    await page.getByTestId("vd-yt-verbinden").click();
    await expect(page.getByTestId("vd-meldung")).toContainText("YouTube verbunden");
    if (!token) {
      await page.getByTestId("vw-name").fill(`Test-PC ${m}`);
      await Promise.all([aktion(page), page.getByTestId("vw-anlegen-los").click()]);
      token = (await page.getByTestId("vw-token").innerText()).trim();
    }
    await expect(page.getByTestId("vd-ziel")).toContainText("10–12 Min. · 1.500–1.700 Wörter");
    await page.getByTestId("vd-thema").fill(THEMA2);
    // Englische Vorlage (erfundener Text): nur Muster für den Aufbau
    await page.getByTestId("vd-vorlage-bereich").locator("summary").click();
    await page.getByTestId("vd-vorlage").fill(VORLAGE);
    await expect(page.getByTestId("vd-schaetzung")).toContainText("Claude Opus 5.5");
    await Promise.all([aktion(page), page.getByTestId("vd-start").click()]);
    await sql("update video_worker set frei_gb = null where tenant_id = $1 and name = $2", [T, `Test-PC ${m}`]);
    // Rest aus dem ersten Test (Platz-Schutz-Auftrag) nicht mitlaufen lassen
    await sql("update video_auftraege set status = 'abgebrochen' where tenant_id = $1 and status = 'wartet' and kanal_id in (select id from video_kanaele where tenant_id = $1 and name = $2)", [T, KANAL]);
    workerStarten();
    const auftrag2 = async () => (await sql<Auftrag>("select id, status, schritt, freigabe_offen, schritte, woerter, dauer_sek, skript, quellen, paket, dateien, kosten_ist::float as kosten_ist, kosten_positionen, youtube_id, youtube_status, aufraeumen from video_auftraege where tenant_id = $1 and kanal_id = (select id from video_kanaele where tenant_id = $1 and name = $2) order by created_at desc limit 1", [T, KANAL2]))[0];
    let a = await auftrag2();
    for (const bis = Date.now() + 240_000; !(a.status === "fertig" || a.status === "fehler") && Date.now() < bis; a = await auftrag2()) await new Promise((r) => setTimeout(r, 300));
    expect(a.status, `${a.schritte[a.schritt]?.fehler ?? ""}\n${log.slice(-2000)}`).toBe("fertig");
    // Länge (fest) und Vorlage kamen im Prompt an; Skript in der Spanne
    expect(a.woerter).toBeGreaterThanOrEqual(1500);
    expect(a.woerter).toBeLessThanOrEqual(1700);
    const prompts = ((await (await fetch(`${TD}/__ki`)).json()) as { text: string }[]).filter((k) => k.text.includes(THEMA2));
    const rp = prompts.find((k) => k.text.startsWith("[video:research:gliederung]"))!;
    expect(rp.text).toContain("(10–12 Minuten)");
    expect(rp.text).toContain("Nicht übersetzen");
    expect(rp.text).toContain("five reasons why some men");
    expect(prompts.find((k) => k.text.startsWith("[video:script:hook]"))!.text).toContain("insgesamt 1.500–1.700 Wörter");
    expect(prompts.find((k) => k.text.startsWith("[video:script:hook]"))!.text).toContain("five reasons why some men"); // Vorlage in jedem Abschnitt
    // Claude lief mit Opus 5.5 (Kosten je Modell gebucht)
    expect(a.kosten_positionen.some((k) => k.anbieter === "Claude" && /Opus 5\.5/.test((k as unknown as { art: string }).art))).toBe(true);
    // Bilder mit dem gewählten Modell (Worker schickt eine Vorgabe, die Brücke setzt die Einstellung)
    const nbDrive = await nachbau();
    expect(nbDrive.bilder.length).toBeGreaterThan(5);
    expect(nbDrive.bilder.every((b) => b.model === "gpt-image-2.5-sunburst")).toBe(true);
    expect(a.kosten_positionen.some((k) => (k as unknown as { art: string }).art === "Bild (GPT Image 2.5 Sunburst)")).toBe(true);
    // MP4 nur in Drive, kleine Dateien zusätzlich im Seller-System
    const dateien = a.dateien as unknown as Record<string, { key: string; drive?: string; groesse: number }>;
    expect(dateien.mp4.drive).toBeTruthy();
    expect(dateien.mp4.key.startsWith("drive:")).toBe(true);
    const ordner = path.join(E2E_ENV.MEDIA_DIR, "video", T, a.id);
    expect(existsSync(path.join(ordner, "video.mp4"))).toBe(false);
    for (const art of ["thumbnail", "skript", "quellen", "untertitel"]) expect(dateien[art].drive, art).toBeTruthy();
    expect(existsSync(path.join(ordner, "thumbnail.png"))).toBe(true);
    const drv = (await (await fetch(`${TD}/__drive`)).json()) as { id: string; name: string; pfad: string; groesse: number }[];
    const mp4 = drv.find((d) => d.id === dateien.mp4.drive)!;
    expect(mp4.name).toBe("video.mp4");
    expect(mp4.pfad).toBe(`Seller-System Videos/${KANAL2}/${new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date())} ${THEMA2}`);
    expect(mp4.groesse).toBe(dateien.mp4.groesse);
    // Seite: Vorschau aus Drive, Link öffnet Drive
    await page.goto(`/marken/video?kanal=${(await sql<{ id: string }>("select id from video_kanaele where tenant_id = $1 and name = $2", [T, KANAL2]))[0].id}`);
    const karte = page.getByTestId("vd-auftrag").first();
    await expect(karte.getByTestId("vd-drive-link")).toHaveAttribute("href", new RegExp(dateien.mp4.drive!));
    await expect(karte.getByTestId("vd-drive-player")).toBeVisible();
    const weiter = await page.request.get(`/api/video/${a.id}/mp4`, { maxRedirects: 0 });
    expect(weiter.status()).toBe(302);
    expect(weiter.headers().location).toContain(`/file/d/${dateien.mp4.drive}/`);
    // Worker räumt auf (Projekt am PC weg) – danach „Privat hochladen“: Video kommt aus Drive, Upload privat
    const slug = (await sql<{ slug: string }>("select slug from video_kanaele where tenant_id = $1 and name = $2", [T, KANAL2]))[0].slug;
    await expect.poll(() => existsSync(path.join(arbeit, "projekte", slug, a.id)), { timeout: 20_000 }).toBe(false);
    await Promise.all([aktion(page), karte.getByTestId("vd-hochladen").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("Upload gestartet");
    for (const bis = Date.now() + 120_000; !(a.youtube_id || a.status === "fehler") && Date.now() < bis; a = await auftrag2()) await new Promise((r) => setTimeout(r, 300));
    expect(a.youtube_status, log.slice(-2000)).toBe("privat");
    const yt = (await nachbau()).youtube.at(-1)!;
    expect(yt.sichtbarkeit).toBe("private");
    expect((yt as unknown as { groesse: number }).groesse).toBe(dateien.mp4.groesse);
    await workerStoppen();
  });
  test("B36.9/B36.10 Whiteboard-Collage: kurze Szenen im Takt (Wortzeiten, Tempo, ≤3 s Stillstand), Motive einzeln mit Referenzbild, Bibliothek, Szenen-Übersicht mit „neu erzeugen“, Aufdeck-Render mit Zoom ohne eingebrannte Untertitel, YouTube-Untertitel", async ({ page }) => {
    test.setTimeout(600_000);
    if (!T) [{ id: T }] = await sql<{ id: string }>("select tenant_id as id from lots where sku = 'TEST-SOCKEN' limit 1");
    const KANAL3 = `Testkanal Whiteboard ${m}`;
    const THEMA3 = "Testthema Whiteboard für die Abnahme";
    // Zugänge wie über das sichere Formular (nur Testwerte), Ablage Seller-Server, Preis je Motiv
    if (!(await sql("select 1 from integrations where tenant_id = $1 and provider = 'elevenlabs'", [T])).length) {
      await sql("insert into integrations (tenant_id, provider, label, config, secret_encrypted) values ($1, 'elevenlabs', 'Test', '{}'::jsonb, $2), ($1, 'openai', 'Test', '{}'::jsonb, $3)", [T, versiegeln(JSON.stringify({ apiKey: "test-elevenlabs-schluessel" })), versiegeln(JSON.stringify({ apiKey: "test-openai-schluessel" }))]);
    }
    if (!(await sql("select 1 from integrations where tenant_id = $1 and provider = 'google'", [T])).length) {
      googleNeu = true;
      await sql("insert into integrations (tenant_id, provider, label, config, secret_encrypted) values ($1, 'google', 'Test', $2::jsonb, $3)", [T, JSON.stringify({ clientId: "test-google-client.apps.example.invalid" }), versiegeln(JSON.stringify({ clientSecret: "test-google-secret" }))]);
    }
    // Gewählt: Sunburst – im Nachbau-Konto „nicht vorhanden“ → die Brücke weicht auf das nächste Modell (Flare) aus
    await sql("update tenants set settings = settings || jsonb_build_object('video', coalesce(settings->'video', '{}'::jsonb) || $2::jsonb) where id = $1", [T, JSON.stringify({ ablage: "server", bildModell: "gpt-image-2.5-sunburst", preise: { claudeEingabeJeMio: 2, claudeAusgabeJeMio: 10, websucheJe1000: 10, elevenlabsJe1000Zeichen: 0.18, bildJeStueck: 0.04, motivJeStueck: 0.02 }, serverReserveGb: 0.1 })]);
    await fetch(`${TD}/__video`, { method: "POST", body: JSON.stringify({ zuruecksetzen: true, verzoegerungMs: 0, bildModelleGesperrt: ["gpt-image-2.5-sunburst"] }) });
    await anmelden(page, "inhaber");

    // Kanal im Stil Whiteboard: feste Figur, nur Freigabe „Szenen-Übersicht“, Qualität niedrig (Nachbau: eine Szene je Abschnitt)
    await page.goto("/marken/video?neu=1");
    await page.getByTestId("vd-k-name").fill(KANAL3);
    await page.getByTestId("vd-k-stimme").fill("testStimme03");
    await page.getByTestId("vd-k-stil").selectOption("whiteboard");
    await page.getByTestId("vd-k-qualitaet").selectOption("low");
    await page.getByTestId("vd-k-tempo").selectOption("schnell"); // B36.10: 1,5 s je Motiv
    await page.getByTestId("vd-k-figuren").fill("testmann: Mann um die 60 mit Hut (erfunden)");
    for (const f of ["f_gliederung", "f_skript", "f_vorschau"]) await page.locator(`input[name=${f}]`).uncheck();
    await page.getByTestId("vd-k-f-szenen").check();
    await Promise.all([aktion(page), page.getByTestId("vd-k-speichern").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("Kanal angelegt");
    // Stil-Referenzbild hochladen (erfundenes 1×1-PNG)
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await page.getByTestId("vd-referenz-datei").setInputFiles({ name: "referenz-test.png", mimeType: "image/png", buffer: png });
    await Promise.all([aktion(page), page.getByTestId("vd-referenz-hochladen").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("1 Referenzbild gespeichert");
    await expect(page.getByTestId("vd-referenz")).toHaveCount(1);
    await page.getByTestId("vd-yt-verbinden").click();
    await expect(page.getByTestId("vd-meldung")).toContainText("YouTube verbunden");
    if (!token) {
      await page.getByTestId("vw-name").fill(`Test-PC ${m}`);
      await Promise.all([aktion(page), page.getByTestId("vw-anlegen-los").click()]);
      token = (await page.getByTestId("vw-token").innerText()).trim();
    }
    await expect(page.getByTestId("vd-ziel")).toContainText("Whiteboard-Collage");
    await page.getByTestId("vd-thema").fill(THEMA3);
    await Promise.all([aktion(page), page.getByTestId("vd-start").click()]);
    await sql("update video_worker set frei_gb = null where tenant_id = $1 and name = $2", [T, `Test-PC ${m}`]);
    await sql("update video_auftraege set status = 'abgebrochen' where tenant_id = $1 and status = 'wartet' and kanal_id in (select id from video_kanaele where tenant_id = $1 and name <> $2)", [T, KANAL3]);
    await workerStoppen();
    workerStarten();
    const auftrag3 = async () => (await sql<Auftrag & { kanal_id: string }>("select id, kanal_id, status, schritt, freigabe_offen, schritte, woerter, dauer_sek, skript, quellen, paket, dateien, kosten_ist::float as kosten_ist, kosten_positionen, youtube_id, youtube_status, aufraeumen from video_auftraege where tenant_id = $1 and kanal_id = (select id from video_kanaele where tenant_id = $1 and name = $2) order by created_at desc limit 1", [T, KANAL3]))[0];
    const warte3 = async (was: string, ok: (a: Awaited<ReturnType<typeof auftrag3>>) => boolean | Promise<boolean>, ms = 240_000) => {
      for (const bis = Date.now() + ms; ; ) {
        const a = await auftrag3();
        if (a && (await ok(a))) return a;
        if (a?.status === "fehler") throw new Error(`Fehler (${a.schritt}): ${a.schritte[a.schritt]?.fehler}\n${log.slice(-3000)}`);
        if (Date.now() > bis) throw new Error(`Zeitüberschreitung: ${was} (${a?.status}/${a?.schritt})\n${log.slice(-3000)}`);
        await new Promise((r) => setTimeout(r, 300));
      }
    };
    type Szene = { nr: number; text: string; layout: string; motive: { key: string; beschreibung: string; ersatz?: boolean; wort?: string | null }[]; dauer: number; balken: string | null; ueberschrift: string | null; takt?: { ereignisse: number; maxPause: number; mittel: number; hervorhebungen: number; drawS: number } | null };
    let a = await warte3("Szenen-Übersicht", (x) => x.freigabe_offen === "szenen");
    const szenen = a.skript as unknown as Szene[];
    const keys = szenen.flatMap((x) => x.motive.map((mm) => mm.key));
    // B36.10 Tempo: mindestens 55 kurze Szenen (1–2 Sätze), Schlüsselwort je Motiv, Sprache mit Wortzeiten
    expect(szenen.length).toBeGreaterThanOrEqual(55);
    expect(szenen.every((x) => x.text.split(/\s+/).length <= 32)).toBe(true);
    const motive = szenen.flatMap((x) => x.motive);
    expect(motive.filter((mm) => mm.wort && szenen.some((x) => x.text.includes(mm.wort!))).length).toBeGreaterThan(motive.length * 0.8);
    expect((await nachbau()).eleven.length).toBe(szenen.length);
    expect((await nachbau()).eleven.every((e) => e.zeiten)).toBe(true);
    // Takt-Prüfung vor dem Render: keine Szene mit mehr als 3 s ohne neue Aktion, Ø höchstens alle 3 s eine Aktion,
    // Zeichenzeit je Motiv aus dem Kanalprofil („schnell“ = 1,5 s)
    for (const x of szenen) {
      expect(x.takt, `Takt Szene ${x.nr}`).toBeTruthy();
      expect(x.takt!.maxPause, `Stillstand Szene ${x.nr}`).toBeLessThanOrEqual(3);
      expect(x.takt!.drawS).toBe(1.5);
    }
    const ereignisse = szenen.reduce((n, x) => n + x.takt!.ereignisse, 0);
    const sekunden = szenen.reduce((n, x) => n + x.dauer, 0);
    expect(sekunden / ereignisse).toBeLessThanOrEqual(3);
    expect(szenen.some((x) => x.takt!.hervorhebungen > 0)).toBe(true); // Lücken mit Unterstreichen/Einkreisen/Pfeil gefüllt
    const hinweiseVisuals = (a.schritte as Record<string, { hinweise?: string[] | null }>).visuals?.hinweise ?? [];
    console.log(`B36.10 ${hinweiseVisuals.find((h) => h.startsWith("Takt:"))} – Hervorhebungen gesamt ${szenen.reduce((n, x) => n + x.takt!.hervorhebungen, 0)}, Video ${Math.round(sekunden)} s`);
    expect(hinweiseVisuals.join(" ")).toMatch(new RegExp(`Takt: ${szenen.length} Szenen, Ø alle \\d+(,\\d)? s eine neue Aktion`));
    // Prompt fürs Skript: Whiteboard-Regeln + feste Figur
    const ki = (await (await fetch(`${TD}/__ki`)).json()) as { text: string }[];
    const skriptPrompt = ki.filter((k) => k.text.startsWith("[video:script:") && k.text.includes(THEMA3)).at(-1)!;
    expect(skriptPrompt.text).toContain("STIL WHITEBOARD-COLLAGE");
    expect(skriptPrompt.text).toContain("testmann: Mann um die 60 mit Hut (erfunden)");
    // Motive einzeln: 1024×1024, transparent, Qualität niedrig, mit dem Referenzbild (edits); jede Motiv-Art nur einmal bezahlt
    let nb = await nachbau();
    expect(nb.bilder.length).toBeGreaterThan(5);
    for (const b of nb.bilder as unknown as { size: string; background: string; edits: boolean; referenzen: number; quality: string; model: string }[]) expect([b.size, b.background, b.edits, b.referenzen, b.quality, b.model]).toEqual(["1024x1024", "transparent", true, 1, "low", "gpt-image-2.5-flare"]);
    // Ausweichen: das fehlende Modell nur einmal versucht (danach gemerkt), nicht bei jedem Motiv
    expect(nb.modellFehler).toEqual(["gpt-image-2.5-sunburst"]);
    const prompts = nb.bilder.map((b) => b.prompt);
    expect(prompts.filter((p) => p.includes("hält einen schwarzen Filzstift"))).toHaveLength(1); // Hand einmal je Kanal
    expect(prompts.some((p) => p.includes("Mann um die 60 mit Hut"))).toBe(true); // feste Figur aus dem Profil
    expect(prompts.every((p) => p.includes("Keine Schrift"))).toBe(true); // Texte setzt die Pipeline selbst
    expect(nb.bilder.filter((b) => b.abgelehnt)).toHaveLength(1);
    expect(keys).toContain("ersatz"); // abgelehntes Motiv → Ersatzmotiv
    expect(nb.bilder.length).toBe(new Set(keys).size + 2); // je Schlüssel einmal + Hand + die Ablehnung
    expect(keys.length).toBeGreaterThan(new Set(keys).size); // Motive kommen mehrfach vor (Wiederverwendung)
    // Seite: Übersicht + Motive zum Neu-Erzeugen
    await page.goto(`/marken/video?kanal=${a.kanal_id}`);
    const karte = page.getByTestId("vd-auftrag").first();
    await expect(karte.getByTestId("vd-status")).toContainText("Szenen-Übersicht");
    await expect(karte.getByTestId("vd-uebersicht")).toBeVisible();
    expect((await page.request.get(`/api/video/${a.id}/uebersicht`)).headers()["content-type"]).toBe("image/jpeg");
    const neu = szenen[0].motive.find((mm) => mm.key !== "ersatz" && mm.key !== "testmann")!.key;
    await karte.getByTestId(`vd-motiv-${neu}`).first().check();
    await Promise.all([aktion(page), karte.getByTestId("vd-motive-neu").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("neu erzeugt");
    const vorher = nb.bilder.length;
    a = await warte3("Übersicht nach Neu-Erzeugen", async (x) => x.freigabe_offen === "szenen" && (await nachbau()).bilder.length > vorher);
    nb = await nachbau();
    expect(nb.bilder.length).toBe(vorher + 1); // nur das ausgewählte Motiv kostet erneut
    expect(nb.bilder.at(-1)!.prompt).toContain(`Cartoon ${neu}`);
    // Freigeben → Render (Aufdeck-Animation) → Paket → fertig
    await page.reload();
    await Promise.all([aktion(page), karte.getByTestId("vd-freigeben").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("Szenen freigegeben");
    a = await warte3("fertig", (x) => x.status === "fertig");
    const mp4 = path.join(E2E_ENV.MEDIA_DIR, "video", T, a.id, "video.mp4");
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=width,height", "-of", "json", mp4]).toString()) as { format: { duration: string }; streams: { width?: number; height?: number }[] };
    expect(probe.streams.find((x) => x.width)).toMatchObject({ width: 1920, height: 1080 });
    expect(Number(probe.format.duration)).toBeGreaterThanOrEqual(570);
    expect(Number(probe.format.duration)).toBeLessThanOrEqual(720);
    const bild = (t: number) => {
      const roh = execFileSync("ffmpeg", ["-v", "error", "-ss", t.toFixed(2), "-i", mp4, "-frames:v", "1", "-vf", "scale=192:108", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:"]);
      const px = (x: number, y: number) => [roh[(y * 192 + x) * 3], roh[(y * 192 + x) * 3 + 1], roh[(y * 192 + x) * 3 + 2]];
      let weiss = 0;
      for (let i = 0; i < roh.length; i += 3) if (roh[i] > 235 && roh[i + 1] > 235 && roh[i + 2] > 235) weiss++;
      return { px, weiss: weiss / (roh.length / 3) };
    };
    const d1 = (a.skript as unknown as Szene[])[0].dauer;
    const d2 = (a.skript as unknown as Szene[])[1].dauer;
    expect(bild(0).weiss).toBeGreaterThan(0.99); // leeres Whiteboard, bevor gezeichnet wird (erstes Bild; ffmpeg liefert bei -ss das nächste Bild ab t)
    const ende1 = bild(d1 - 1);
    expect(ende1.weiss).toBeGreaterThan(0.4);
    expect(ende1.weiss).toBeLessThan(0.97); // Überschrift + Motive gezeichnet, Hintergrund weiß
    for (let y = 96; y <= 104; y++) for (let x = 0; x < 192; x += 4) expect(Math.min(...ende1.px(x, y))).toBeGreaterThan(200); // keine eingebrannten Untertitel unten
    const ende2 = bild(d1 + d2 - 1);
    const [r, g, b] = ende2.px(20, 8);
    expect(r > 170 && g < 90 && b < 90, `roter Balken oben (${r},${g},${b})`).toBe(true);
    // Thumbnail aus der ersten Szene, Kosten je Motiv
    expect(a.dateien.thumbnail).toBeTruthy();
    expect(a.kosten_positionen.some((k) => (k as unknown as { art: string }).art === "Motiv (GPT Image 2.5 Flare)" && k.betrag === 0.02)).toBe(true);
    // „Privat hochladen“: Video privat, Untertitel als YouTube-Untertitel (Spur Deutsch)
    await page.reload();
    await Promise.all([aktion(page), karte.getByTestId("vd-hochladen").click()]);
    a = await warte3("hochgeladen", (x) => !!x.youtube_status);
    expect(a.youtube_status).toBe("privat");
    const ut = (await (await fetch(`${TD}/__video/untertitel`)).json()) as { videoId: string; sprache: string; zeilen: number; entwurf: boolean }[];
    expect(ut).toHaveLength(1);
    expect(ut[0]).toMatchObject({ videoId: a.youtube_id, sprache: "de", entwurf: false });
    expect(ut[0].zeilen).toBeGreaterThan(20);
    await workerStoppen();
  });

  test("B36.10 „Im neuen Takt neu machen“: fertiges Whiteboard-Video ab dem Skript neu – gleicher Text, Recherche bleibt, Sprache mit Wortzeiten neu, Motive aus der Bibliothek, YouTube-Upload zurückgesetzt", async ({ page }) => {
    test.setTimeout(420_000);
    if (!T) [{ id: T }] = await sql<{ id: string }>("select tenant_id as id from lots where sku = 'TEST-SOCKEN' limit 1");
    const KANAL3 = `Testkanal Whiteboard ${m}`;
    type Alt = { id: string; kanal_id: string; status: string; youtube_id: string | null; skript: { text: string; motive: { key: string }[] }[] | null; kosten_ist: number };
    const lies = async () => (await sql<Alt & { schritt: string; freigabe_offen: string | null; hochladen: boolean; vorlage_art: string | null; freigegeben: Record<string, string>; dateien: Record<string, unknown>; schritte: Record<string, { status: string; fehler?: string | null }> }>("select a.id, a.kanal_id, a.status, a.schritt, a.freigabe_offen, a.hochladen, a.vorlage_art, a.freigegeben, a.youtube_id, a.skript, a.dateien, a.schritte, a.kosten_ist::float as kosten_ist from video_auftraege a join video_kanaele k on k.id = a.kanal_id where a.tenant_id = $1 and k.name = $2 order by a.created_at desc limit 1", [T, KANAL3]))[0];
    const vorher = await lies();
    test.skip(!vorher || vorher.status !== "fertig" || !vorher.youtube_id, "braucht das fertige, hochgeladene Whiteboard-Video aus dem Test davor");
    const nb0 = await nachbau();
    const forschung0 = nb0.claude.filter((c) => c.startsWith("research")).length;
    const bilder0 = nb0.bilder.filter((b) => !b.abgelehnt).length;
    const eleven0 = nb0.eleven.length;
    page.on("dialog", (d) => d.accept());
    await anmelden(page, "inhaber");
    await page.goto(`/marken/video?kanal=${vorher.kanal_id}`);
    const karte = page.locator(`#a-${vorher.id}`);
    const bereich = karte.getByTestId("vd-takt-neu");
    if (!(await bereich.evaluate((d) => (d as HTMLDetailsElement).open))) await bereich.locator("summary").click();
    await expect(karte.getByTestId("vd-takt-kosten")).toContainText("Sprache mit Wortzeiten");
    await expect(karte.getByTestId("vd-takt-kosten")).toContainText("aus der Bibliothek");
    await karte.getByTestId("vd-takt-gleich").check();
    await Promise.all([aktion(page), karte.getByTestId("vd-takt-los").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("Wird im neuen Takt neu gemacht – gleicher Text, in kurze Szenen geteilt. Recherche bleibt");
    await expect(page.getByTestId("vd-meldung")).toContainText("bisherige YouTube-Video bleibt privat");
    let a = await lies();
    expect([a.status, a.schritt, a.youtube_id, a.hochladen, a.vorlage_art]).toEqual(["wartet", "script", null, false, "skript"]);
    expect(Object.keys(a.freigegeben)).toEqual(["gliederung"]);
    // Worker: Skript ab dem eigenen (alten) Text in kurzen Szenen, Sprache neu mit Wortzeiten, Motive aus der Bibliothek
    if (!token) throw new Error("kein Worker-Token aus den Tests davor");
    await sql("update video_worker set frei_gb = null where tenant_id = $1 and name = $2", [T, `Test-PC ${m}`]);
    await sql("update video_auftraege set status = 'abgebrochen' where tenant_id = $1 and status in ('wartet', 'laeuft') and id <> $2", [T, vorher.id]);
    await workerStoppen();
    workerStarten();
    for (const bis = Date.now() + 300_000; (a = await lies()).freigabe_offen !== "szenen"; ) {
      if (a.status === "fehler") throw new Error(`Fehler (${a.schritt}): ${a.schritte[a.schritt]?.fehler}\n${log.slice(-3000)}`);
      if (Date.now() > bis) throw new Error(`Zeitüberschreitung bis zur Szenen-Übersicht (${a.status}/${a.schritt})\n${log.slice(-3000)}`);
      await new Promise((r) => setTimeout(r, 300));
    }
    const ki = (await (await fetch(`${TD}/__ki`)).json()) as { text: string }[];
    const skriptPrompts = ki.filter((k) => k.text.startsWith("[video:script:") && k.text.includes("Eigenes Skript von Ludwig"));
    expect(skriptPrompts.length).toBeGreaterThanOrEqual(9); // je Abschnitt ein Aufruf mit dem alten Text
    expect(skriptPrompts[0].text).toContain(vorher.skript![0].text.slice(0, 60));
    const nb = await nachbau();
    expect(nb.claude.filter((c) => c.startsWith("research")).length).toBe(forschung0); // keine neue Recherche/Websuche
    expect(a.skript!.length).toBeGreaterThanOrEqual(55);
    expect(nb.eleven.length - eleven0).toBe(a.skript!.length); // Sprache je neue Szene genau einmal
    expect(nb.eleven.slice(eleven0).every((e) => e.zeiten)).toBe(true);
    expect(nb.bilder.filter((b) => !b.abgelehnt).length).toBe(bilder0); // alle Motive aus der Bibliothek, kein neues bezahlt
    await page.goto(`/marken/video?kanal=${vorher.kanal_id}`);
    await Promise.all([aktion(page), karte.getByTestId("vd-freigeben").click()]);
    for (const bis = Date.now() + 300_000; (a = await lies()).status !== "fertig"; ) {
      if (a.status === "fehler") throw new Error(`Fehler (${a.schritt}): ${a.schritte[a.schritt]?.fehler}\n${log.slice(-3000)}`);
      if (Date.now() > bis) throw new Error(`Zeitüberschreitung bis fertig (${a.status}/${a.schritt})\n${log.slice(-3000)}`);
      await new Promise((r) => setTimeout(r, 300));
    }
    expect(a.youtube_id).toBeNull(); // „Privat hochladen“ wieder von Hand
    expect(a.dateien.mp4).toBeTruthy();
    expect(a.kosten_ist).toBeGreaterThan(vorher.kosten_ist); // nur Skript, Paket und Sprache dazu
    console.log(`B36.10 neu im Takt: ${vorher.skript!.length} → ${a.skript!.length} Szenen, Kosten ${vorher.kosten_ist.toFixed(2)} $ → ${a.kosten_ist.toFixed(2)} $, neue Bilder 0`);
    await workerStoppen();
  });

  test("B37 Instagram-Stories – Abnahme 1–6: Kanal mit Zeitplan, 5 Stories im Hochformat am Handy, Regeln wie B34.3, Neu erzeugen/Ablehnen ohne Doppelkosten, Posten zur Planzeit mit Fehler- und Ablauf-Meldung, Kosten und Monatslimit", async ({ page, browser }) => {
    test.setTimeout(420_000);
    if (!T) [{ id: T }] = await sql<{ id: string }>("select tenant_id as id from lots where sku = 'TEST-SOCKEN' limit 1");
    const KANAL5 = `Testkanal Instagram ${m}`;
    // Zugänge wie über das sichere Formular (nur Testwerte): Bilder (Motive) und die Meta-App für Instagram
    if (!(await sql("select 1 from integrations where tenant_id = $1 and provider = 'openai'", [T])).length) {
      await sql("insert into integrations (tenant_id, provider, label, config, secret_encrypted) values ($1, 'elevenlabs', 'Test', '{}'::jsonb, $2), ($1, 'openai', 'Test', '{}'::jsonb, $3)", [T, versiegeln(JSON.stringify({ apiKey: "test-elevenlabs-schluessel" })), versiegeln(JSON.stringify({ apiKey: "test-openai-schluessel" }))]);
    }
    if (!(await sql("select 1 from integrations where tenant_id = $1 and provider = 'instagram'", [T])).length) {
      igNeu = true;
      await sql("insert into integrations (tenant_id, provider, label, config, secret_encrypted) values ($1, 'instagram', 'Test', $2::jsonb, $3)", [T, JSON.stringify({ appId: "test-ig-app" }), versiegeln(JSON.stringify({ appSecret: "test-ig-secret" }))]);
    }
    await sql("update tenants set settings = settings || jsonb_build_object('video', coalesce(settings->'video', '{}'::jsonb) || $2::jsonb) where id = $1", [T, JSON.stringify({ ablage: "server", preise: { claudeEingabeJeMio: 2, claudeAusgabeJeMio: 10, websucheJe1000: 10, elevenlabsJe1000Zeichen: 0.18, bildJeStueck: 0.04, motivJeStueck: 0.02 }, serverReserveGb: 0.1 })]);
    await fetch(`${TD}/__video`, { method: "POST", body: JSON.stringify({ zuruecksetzen: true, verzoegerungMs: 0, bildModelleGesperrt: [] }) });
    await fetch(`${TD}/__instagram`, { method: "POST", body: JSON.stringify({ zuruecksetzen: true }) });
    page.on("dialog", (d) => d.accept());
    await anmelden(page, "inhaber");

    // 1. Kanal (Plattform Instagram): täglich 12:00, 1 Story/Tag, Freigabe „jedes Mal“, Monatslimit, bestätigte Fakten
    await page.goto("/marken/video?neu=1");
    await page.getByTestId("vd-k-name").fill(KANAL5);
    await page.getByTestId("vd-k-plattform").selectOption("instagram");
    await page.getByTestId("vd-k-instagram").locator("summary").first().click();
    await page.getByTestId("vd-ig-uhrzeiten").fill("12:00");
    await page.getByTestId("vd-ig-freigabe").selectOption("jedes_mal");
    await page.getByTestId("vd-ig-limit").fill("5");
    await page.getByTestId("vd-ig-hinweis").fill("Anfrage über example.com");
    await page.getByTestId("vd-ig-fakten").fill("Prep ab 0,59 € netto je Artikel\nLagerung auf Paletten, nur für Händler (B2B)");
    await Promise.all([aktion(page), page.getByTestId("vd-k-speichern").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("Kanal angelegt");
    const [{ id: kanalId }] = await sql<{ id: string }>("select id from video_kanaele where tenant_id = $1 and name = $2", [T, KANAL5]);
    await expect(page.getByTestId("st-plan")).toContainText("täglich um 12:00 Uhr · 1 Story/Tag · Freigabe: Vorschau jedes Mal");
    await expect(page.getByTestId("st-plan")).toContainText("Instagram nicht verbunden");
    await expect(page.getByTestId("vd-auftrag")).toHaveCount(0); // keine YouTube-Aufträge im Instagram-Kanal

    // 2. Themenliste (5 Themen) + eigenes Lager-Foto (ohne Personen) → 5 Stories auf die nächsten Planzeiten
    await page.getByTestId("st-themen").fill("preis: Prep-Preis je Artikel\nleistung: Lagerung auf Paletten\ntipp: FNSKU richtig kleben\neinblick: Blick ins Lager\ncta: Platz frei für neue Kunden");
    await Promise.all([aktion(page), page.getByTestId("st-themen-speichern").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("5 Themen gespeichert");
    await page.getByTestId("st-foto-datei").setInputFiles({ name: "lager-test.png", mimeType: "image/png", buffer: pngFarbe(64, 64, [60, 110, 160]) });
    await Promise.all([aktion(page), page.getByTestId("st-foto-hochladen").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("keine Personen"); // ohne Bestätigung kein Foto
    await page.getByTestId("st-foto-datei").setInputFiles({ name: "lager-test.png", mimeType: "image/png", buffer: pngFarbe(64, 64, [60, 110, 160]) });
    await page.getByTestId("st-foto-ohne-personen").check();
    await Promise.all([aktion(page), page.getByTestId("st-foto-hochladen").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("1 Foto(s) gespeichert");
    await Promise.all([aktion(page), page.getByTestId("st-erzeugen").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("5 Stories angelegt");
    // dazu eine Story, bei der Claude gegen die Regeln schreibt (Nachbau: „TESTREGEL“ → „kostenlose Zählung“)
    await sql(`insert into video_auftraege (tenant_id, kanal_id, art, thema, story, geplant_fuer, schritt, schritte, kosten_schaetzung) values ($1, $2, 'story', 'TESTREGEL Zählung erklären', '{"inhaltsart":"tipp","werbung":false}'::jsonb, now() + interval '40 days', 'story', '{"story":{"status":"offen"}}'::jsonb, 0.02)`, [T, kanalId]);
    type Story = { id: string; status: string; thema: string; story: { inhaltsart: string; ueberschrift?: string; text?: string; cta?: string; werbung?: boolean; regeln?: string[] | null; motivKey?: string; fotoId?: string | null; format?: string; dauerSek?: number | null; sticker?: unknown } | null; dateien: Record<string, { groesse: number }>; ig_status: string | null; ig_versuche: number; ig_fehler: string | null; kosten_ist: number; schritte: Record<string, { status: string; fehler?: string | null }> };
    const stories = async () => sql<Story>("select id, status, thema, story, dateien, ig_status, ig_versuche, ig_fehler, kosten_ist::float as kosten_ist, schritte from video_auftraege where tenant_id = $1 and kanal_id = $2 and art = 'story' order by geplant_fuer", [T, kanalId]);
    const warteStories = async (was: string, ok: (l: Story[]) => boolean, ms = 180_000) => {
      for (const bis = Date.now() + ms; ; ) {
        const l = await stories();
        if (ok(l)) return l;
        const f = l.find((x) => x.status === "fehler");
        if (f) throw new Error(`Story im Fehler: ${f.schritte.story?.fehler}\n${log.slice(-3000)}`);
        if (Date.now() > bis) throw new Error(`Zeitüberschreitung: ${was} (${l.map((x) => x.status).join(", ")})\n${log.slice(-3000)}`);
        await new Promise((r) => setTimeout(r, 300));
      }
    };
    if (!token) {
      await page.getByTestId("vw-name").fill(`Test-PC ${m}`);
      await Promise.all([aktion(page), page.getByTestId("vw-anlegen-los").click()]);
      token = (await page.getByTestId("vw-token").innerText()).trim();
    }
    await sql("update video_worker set frei_gb = null where tenant_id = $1 and name = $2", [T, `Test-PC ${m}`]);
    await sql("update video_auftraege set status = 'abgebrochen' where tenant_id = $1 and status in ('wartet', 'laeuft') and kanal_id <> $2", [T, kanalId]);
    await workerStoppen();
    workerStarten();
    let l = await warteStories("6 Stories zur Freigabe", (x) => x.length === 6 && x.every((y) => y.status === "freigabe"));
    const nach = (art: string) => l.find((x) => x.story?.inhaltsart === art && !x.thema.startsWith("TESTREGEL"))!;
    // Hochformat 1080×1920 (Hand-Animation → MP4 ohne Ton, 5–15 s), Vorschau-Bild, Einblick mit eigenem Foto
    for (const x of l) {
      expect(x.story?.format).toBe("mp4");
      expect(x.dateien.story_mp4 && x.dateien.story_vorschau).toBeTruthy();
      const mp4 = path.join(E2E_ENV.MEDIA_DIR, "video", T, x.id, "story.mp4");
      const pr = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", mp4]).toString()) as { streams: { width: number; height: number }[]; format: { duration: string } };
      expect([pr.streams[0].width, pr.streams[0].height]).toEqual([1080, 1920]);
      expect(Number(pr.format.duration)).toBeGreaterThanOrEqual(5);
      expect(Number(pr.format.duration)).toBeLessThanOrEqual(15.5);
    }
    expect(nach("einblick").story?.fotoId).toBeTruthy();
    expect(nach("einblick").story?.motivKey).toMatch(/^foto-/);
    let nb = await nachbau();
    expect(nb.bilder.some((b) => /Lagerregal/.test(b.prompt))).toBe(false); // Foto statt Bildanbieter
    const bilderVorher = nb.bilder.length;
    // Handy-Vorschau: alle Stories mit Bild/Video, ohne seitliches Scrollen
    const handy = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const hp = await handy.newPage();
    await anmelden(hp, "inhaber");
    await hp.goto(`/marken/video?kanal=${kanalId}#stories`);
    await expect(hp.getByTestId("st-story")).toHaveCount(6);
    await expect(hp.getByTestId("st-vorschau")).toHaveCount(6);
    expect(await hp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await handy.close();

    // 3. Regeln (B34.3): keine „kostenlose Zählung“, kein „Komplettpreis“/„all-in“ ohne Aufzählung, keine Versicherung;
    //    Preis nur aus den bestätigten Fakten, „Werbung“ bei Preis/Leistung/CTA; Regelverstoß sperrt die Freigabe
    const ki = (await (await fetch(`${TD}/__ki`)).json()) as { text: string }[];
    const preisPrompt = ki.find((k) => k.text.startsWith("[video:story:preis]"))!;
    expect(preisPrompt.text).toContain("Prep ab 0,59 € netto je Artikel");
    expect(preisPrompt.text).toContain("Nie „kostenlose Zählung“");
    for (const x of l.filter((y) => !y.thema.startsWith("TESTREGEL"))) {
      const text = [x.story?.ueberschrift, x.story?.text, x.story?.cta].join(" ");
      expect(text).not.toMatch(/kostenlos|gratis|komplettpreis|alles inklusive|versicher/i);
      if (/all[\s-]?in/i.test(text)) expect(text).toMatch(/Enthalten:/);
      expect(x.story?.regeln ?? []).toEqual([]);
      expect(x.story?.werbung).toBe(["preis", "leistung", "cta"].includes(x.story!.inhaltsart));
    }
    expect(nach("preis").story?.text).toContain("0,59 € netto je Artikel. Enthalten:");
    const regel = l.find((x) => x.thema.startsWith("TESTREGEL"))!;
    expect(regel.story?.regeln?.join(" ")).toMatch(/kostenlose\/inklusive Zählung/);
    expect(ki.filter((k) => k.text.startsWith("[video:story:tipp]") && k.text.includes("TESTREGEL")).length).toBe(2); // eine Korrektur-Runde
    await page.goto(`/marken/video?kanal=${kanalId}`);
    const karte = (id: string) => page.locator(`#s-${id}`);
    await expect(karte(regel.id).getByTestId("st-regel").first()).toContainText("Zählung");
    await expect(karte(regel.id).getByTestId("st-freigeben")).toBeDisabled();
    await expect(page.getByTestId("st-kosten")).toContainText("je Story ca.");

    // 4. Neu erzeugen: neuer Text, Motiv bleibt (kein zweites Bild); „Motiv neu“ genau ein Bild mehr; Ablehnen
    const tipp = nach("tipp");
    const storyAufrufe = () => fetch(`${TD}/__video`).then((r) => r.json()).then((v: { claude: string[] }) => v.claude.filter((c) => c.startsWith("story:")).length);
    const aufrufeVorher = await storyAufrufe();
    await Promise.all([aktion(page), karte(tipp.id).getByTestId("st-neu").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("das Motiv bleibt");
    l = await warteStories("Tipp neu", (x) => x.find((y) => y.id === tipp.id)!.status === "freigabe" && x.find((y) => y.id === tipp.id)!.story?.ueberschrift !== tipp.story?.ueberschrift);
    expect(l.find((y) => y.id === tipp.id)!.story?.ueberschrift).toBe("Kleiner Prep-Tipp");
    expect(l.find((y) => y.id === tipp.id)!.story?.motivKey).toBe(tipp.story?.motivKey);
    expect((await nachbau()).bilder.length).toBe(bilderVorher); // Motiv nicht doppelt bezahlt
    expect(await storyAufrufe()).toBe(aufrufeVorher + 1);
    const leistung = nach("leistung");
    await page.reload();
    await karte(leistung.id).locator("input[name=motivNeu]").check();
    await Promise.all([aktion(page), karte(leistung.id).getByTestId("st-neu").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("mit neuem Motiv");
    l = await warteStories("Leistung mit neuem Motiv", (x) => x.find((y) => y.id === leistung.id)!.status === "freigabe" && x.find((y) => y.id === leistung.id)!.story?.ueberschrift !== leistung.story?.ueberschrift);
    expect((await nachbau()).bilder.length).toBe(bilderVorher + 1);
    const cta = nach("cta");
    await page.reload();
    await Promise.all([aktion(page), karte(cta.id).getByTestId("st-ablehnen").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("Story abgelehnt");
    expect((await stories()).find((y) => y.id === cta.id)!.status).toBe("abgebrochen");

    // 5. Stufe 1 → Stufe 2: Freigeben (nicht verbunden = „von Hand posten“), dann Instagram verbinden → geplant;
    //    zur Planzeit posten über die API (Datei über den befristeten Link), Fehler mit Wiederholung, Ablauf gemeldet
    const preis = nach("preis");
    await Promise.all([aktion(page), karte(preis.id).getByTestId("st-freigeben").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("Erinnerung");
    expect((await stories()).find((y) => y.id === preis.id)!.ig_status).toBe("manuell");
    await page.getByTestId("vd-ig-verbinden").click();
    await expect(page.getByTestId("vd-meldung")).toContainText("Instagram verbunden (testkonto_ig)");
    expect((await (await fetch(`${TD}/__instagram`)).json()).anmeldungen[0].scope).toBe("instagram_business_basic,instagram_business_content_publish");
    expect((await stories()).find((y) => y.id === preis.id)!.ig_status).toBe("geplant");
    const ungepostet = await (await fetch(`${TD}/__instagram`)).json();
    expect(ungepostet.posts).toHaveLength(0); // vor der Planzeit wird nichts gepostet
    await sql("update video_auftraege set geplant_fuer = now() - interval '1 minute' where id = $1", [preis.id]);
    await page.goto(`/marken/video?kanal=${kanalId}`);
    await Promise.all([aktion(page), page.getByTestId("st-posten").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("Gepostet: 1");
    let ig = (await (await fetch(`${TD}/__instagram`)).json()) as { posts: { typ: string; video: boolean }[]; container: { quelle: string; status: number; typ: string }[] };
    expect(ig.posts).toHaveLength(1);
    expect(ig.posts[0]).toMatchObject({ video: true, typ: "video/mp4" });
    expect(ig.container[0].quelle).toContain(`/api/public/story/${preis.id}/`);
    expect((await stories()).find((y) => y.id === preis.id)!.ig_status).toBe("gepostet");
    await expect(karte(preis.id)).toHaveAttribute("data-ig", "gepostet");
    // befristeter Link: falsche Signatur oder fremde Datei → nicht abrufbar
    expect((await fetch(ig.container[0].quelle.replace(/\/[^/]+\/story\.mp4$/, `/${Date.now() + 3_600_000}.falsch/story.mp4`))).status).toBe(404);
    // Fehler beim Posten: 3 Wiederholungen (5/15/45 Min.), danach „nicht gepostet“ + Meldung – kein stilles Scheitern
    const einblick = nach("einblick");
    await Promise.all([aktion(page), karte(einblick.id).getByTestId("st-freigeben").click()]);
    await sql("update video_auftraege set geplant_fuer = now() - interval '1 minute' where id = $1", [einblick.id]);
    await fetch(`${TD}/__instagram`, { method: "POST", body: JSON.stringify({ fehler: 10 }) });
    for (let v = 1; v <= 4; v++) {
      await sql("update video_auftraege set ig_naechster_versuch = now() - interval '1 second' where id = $1 and ig_naechster_versuch is not null", [einblick.id]);
      await page.goto(`/marken/video?kanal=${kanalId}`);
      await Promise.all([aktion(page), page.getByTestId("st-posten").click()]);
      const e = (await stories()).find((y) => y.id === einblick.id)!;
      expect(e.ig_versuche).toBe(v);
      expect(e.ig_status).toBe(v < 4 ? "geplant" : "fehler");
      expect(e.ig_fehler).toContain("unexpected error");
    }
    await expect(karte(einblick.id).getByTestId("st-ig-fehler")).toContainText("unexpected error");
    const meldungen = async () => sql<{ titel: string; text: string }>("select titel, text from meldungen where tenant_id = $1 and titel like $2 order by created_at", [T, `%(${KANAL5})%`]);
    expect((await meldungen()).some((x) => x.titel.startsWith("Story nicht gepostet") && x.text.includes("Nach 4 Versuchen"))).toBe(true);
    // abgelaufener Zugang: sofort gemeldet (keine Wiederholung), nach neuer Verbindung „Erneut posten“
    await fetch(`${TD}/__instagram`, { method: "POST", body: JSON.stringify({ fehler: 0, abgelaufen: true }) });
    const tipp2 = l.find((y) => y.id === tipp.id)!;
    await page.reload();
    await Promise.all([aktion(page), karte(tipp2.id).getByTestId("st-freigeben").click()]);
    await sql("update video_auftraege set geplant_fuer = now() - interval '1 minute' where id = $1", [tipp2.id]);
    await page.goto(`/marken/video?kanal=${kanalId}`);
    await Promise.all([aktion(page), page.getByTestId("st-posten").click()]);
    const t2 = (await stories()).find((y) => y.id === tipp2.id)!;
    expect([t2.ig_status, t2.ig_versuche]).toEqual(["fehler", 1]);
    expect(t2.ig_fehler).toContain("abgelaufen");
    expect((await meldungen()).some((x) => x.titel.startsWith("Story nicht gepostet") && x.text.includes("abgelaufen"))).toBe(true);
    await fetch(`${TD}/__instagram`, { method: "POST", body: JSON.stringify({ abgelaufen: false }) });
    await page.reload();
    await Promise.all([aktion(page), karte(einblick.id).getByTestId("st-erneut").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("erneut gepostet");
    await Promise.all([aktion(page), page.getByTestId("st-posten").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("Gepostet: 1");
    ig = await (await fetch(`${TD}/__instagram`)).json();
    expect(ig.posts).toHaveLength(2);

    // 6. Kosten je Story (Ist) und Monatslimit: über dem Limit keine neuen Stories, wartende bekommen einen Hinweis
    l = await stories();
    expect(l.filter((x) => x.status !== "abgebrochen").every((x) => x.kosten_ist > 0)).toBe(true);
    const monat = l.reduce((n, x) => n + x.kosten_ist, 0);
    await expect(page.getByTestId("st-kosten")).toContainText("von 5,00 $");
    await sql("update video_kanaele set instagram = instagram || '{\"monatslimit\": 0.01}'::jsonb where id = $1", [kanalId]);
    await page.reload();
    await expect(page.getByTestId("st-limit")).toContainText("Monatslimit erreicht");
    await expect(page.getByTestId("st-erzeugen")).toBeDisabled();
    await Promise.all([aktion(page), page.getByTestId("st-planen").click()]);
    await expect(page.getByTestId("vd-meldung")).toContainText("Monatslimit erreicht");
    await sql(`insert into video_auftraege (tenant_id, kanal_id, art, thema, story, geplant_fuer, schritt, schritte, kosten_schaetzung) values ($1, $2, 'story', 'Tipp über dem Limit', '{"inhaltsart":"tipp","werbung":false}'::jsonb, now() + interval '41 days', 'story', '{"story":{"status":"offen"}}'::jsonb, 0.02)`, [T, kanalId]);
    const ueber = await warteStoriesFehler(stories, "Tipp über dem Limit");
    expect(ueber.schritte.story?.fehler).toContain(`Monatslimit erreicht (${monat.toFixed(2)} $ von 0.01 $)`);
    expect((await nachbau()).bilder.length).toBe(bilderVorher + 1); // nichts mehr erzeugt
    await workerStoppen();
  });

  test("OpenAI: „Verbindung testen“ zeigt Schlüssel und benutztes Bildmodell; falscher Schlüssel → klare Meldung ohne Schlüsselteile (Test und Brücke)", async ({ page }) => {
    if (!T) [{ id: T }] = await sql<{ id: string }>("select tenant_id as id from lots where sku = 'TEST-SOCKEN' limit 1");
    const schluessel = async (k: string) => {
      await sql("delete from integrations where tenant_id = $1 and provider = 'openai'", [T]);
      await sql("insert into integrations (tenant_id, provider, label, config, secret_encrypted) values ($1, 'openai', 'Test', '{}'::jsonb, $2)", [T, versiegeln(JSON.stringify({ apiKey: k }))]);
    };
    await schluessel("test-openai-schluessel");
    await sql("update tenants set settings = settings || jsonb_build_object('video', coalesce(settings->'video', '{}'::jsonb) || $2::jsonb) where id = $1", [T, JSON.stringify({ bildModell: "gpt-image-2.5-sunburst" })]);
    await fetch(`${TD}/__video`, { method: "POST", body: JSON.stringify({ zuruecksetzen: true, bildModelleGesperrt: ["gpt-image-2.5-sunburst"] }) });
    await anmelden(page, "inhaber");
    const testen = async () => {
      await page.goto("/anbindungen?p=openai#openai");
      const karte = page.locator("#openai");
      await karte.getByRole("button", { name: "Verbindung testen" }).click();
      return karte;
    };
    // Gültig: gewähltes Modell fehlt im Konto → Test nennt das tatsächlich benutzte
    let karte = await testen();
    await expect(karte).toContainText("Schlüssel gültig. Bildmodell für Videos: gpt-image-2.5-flare (gewählt ist gpt-image-2.5-sunburst");
    // Falscher Schlüssel (wie ein eingefügter Pfad): Test und Brücke melden „neu eintragen“, nie Teile des Schlüssels
    const falsch = ".\\.venv\\Scripts\\falsch-eingefuegt";
    await schluessel(falsch);
    karte = await testen();
    await expect(karte).toContainText("Schlüssel abgelehnt (HTTP 401)");
    await expect(karte).not.toContainText(".venv");
    if (!token) {
      await page.goto("/marken/video");
      await page.getByTestId("vw-name").fill(`Test-PC ${m}`);
      await Promise.all([aktion(page), page.getByTestId("vw-anlegen-los").click()]);
      token = (await page.getByTestId("vw-token").innerText()).trim();
    }
    const [auftrag] = await sql<{ id: string }>("select id from video_auftraege where tenant_id = $1 and status <> 'abgebrochen' order by created_at desc limit 1", [T]);
    test.skip(!auftrag, "kein Auftrag aus den Abnahmen vorhanden");
    const r = await page.request.post("/api/video-worker/anbieter/openai/v1/images/generations", { headers: { authorization: `Bearer ${token}`, "x-auftrag": auftrag.id, "content-type": "application/json" }, data: { model: "gpt-image-1", prompt: "Testbild (erfunden)", size: "1536x1024", quality: "medium", n: 1 } });
    expect(r.status()).toBe(401);
    const text = await r.text();
    expect(text).toContain("OpenAI-Schlüssel abgelehnt (HTTP 401) – unter Anbindungen → OpenAI (Bilder für Videos) den API-Key neu eintragen");
    expect(text).not.toContain("venv");
    expect(text).not.toContain("Incorrect API key");
    // Wieder gültig, alle Modelle frei: Brücke ersetzt das abgeschaltete gpt-image-1 durch Flare
    await schluessel("test-openai-schluessel");
    await sql("update tenants set settings = settings || jsonb_build_object('video', coalesce(settings->'video', '{}'::jsonb) || $2::jsonb) where id = $1", [T, JSON.stringify({ bildModell: "gpt-image-2.5-flare" })]);
    await fetch(`${TD}/__video`, { method: "POST", body: JSON.stringify({ zuruecksetzen: true }) });
    const ok = await page.request.post("/api/video-worker/anbieter/openai/v1/images/generations", { headers: { authorization: `Bearer ${token}`, "x-auftrag": auftrag.id, "content-type": "application/json" }, data: { model: "gpt-image-1", prompt: "Testbild (erfunden)", size: "1536x1024", quality: "medium", n: 1 } });
    expect(ok.status()).toBe(200);
    expect((await nachbau()).bilder.at(-1)!.model).toBe("gpt-image-2.5-flare");
  });

  test("Werkzeug video_auftrag_anlegen: Claude legt aus dem Chat ein Video an – erst Rückfrage mit Zusammenfassung, nach Ja angelegt (eigenes Skript, Startzeit); ohne Änderungsrecht nicht sichtbar", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    if (!T) [{ id: T }] = await sql<{ id: string }>("select tenant_id as id from lots where sku = 'TEST-SOCKEN' limit 1");
    const KANAL4 = `Testkanal Chat ${m}`;
    const [{ id: kanalId }] = await sql<{ id: string }>("insert into video_kanaele (tenant_id, slug, name, zielgruppe, laenge_min, laenge_max, stil, freigaben) values ($1, $2, $3, 'Testpublikum 55+', 16, 20, 'whiteboard', $4::jsonb) returning id", [T, `testkanal-chat-${m}`.toLowerCase(), KANAL4, JSON.stringify({ gliederung: true, skript: true, szenen: true, vorschau: true })]);
    const anzahl = async () => (await sql("select 1 from video_auftraege where tenant_id = $1 and kanal_id = $2", [T, kanalId])).length;

    // Ohne Änderungsrecht: Werkzeug nicht in der Liste (lesen geht)
    const lesen = await mcpVerbinden(browser, baseURL!, "inhaber");
    const nurLesen = await lesen.tools();
    expect(nurLesen).toContain("video_auftraege");
    expect(nurLesen).not.toContain("video_auftrag_anlegen");

    const c = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
    expect(await c.tools()).toContain("video_auftrag_anlegen");
    const skript = "Hello and welcome. Today we talk about something most men never discuss openly. ".repeat(4) + "This is a fictional test script for the video pipeline. It only exists for automated checks and contains no real content.";
    const wunsch = { kanal: `Chat ${m}`, thema: "Testthema: Warum manche länger durchhalten (erfunden)", vorlage: skript, vorlage_art: "skript", start: "2030-01-01T06:30" };

    // 1) ohne Bestätigung: nur Rückfrage mit Kanal, Stil, Länge, Zielgruppe, Kosten und Freigaben – nichts angelegt
    const r1 = JSON.parse(await c.call("video_auftrag_anlegen", wunsch));
    expect(r1.angelegt).toBe(false);
    expect(r1.rueckfrage).toContain("Soll ich das Video so anlegen?");
    expect(r1.zusammenfassung).toContain(`Kanal „${KANAL4}“ (Whiteboard-Collage, 10–12 Min., Zielgruppe Testpublikum 55+)`);
    expect(r1.zusammenfassung).toContain(`eigenes Skript (${skript.length.toLocaleString("de-DE")} Zeichen)`);
    expect(r1.zusammenfassung).toContain("Start 01.01.2030, 06:30");
    expect(r1.zusammenfassung).toMatch(/Kosten-Schätzung ca\. \d+,\d\d \$/);
    expect(r1.freigaben).toEqual(["Gliederung + Quellen", "Skript", "Szenen-Übersicht (Motive)", "Vorschau-Video + Thumbnail + Titel"]);
    expect(await anzahl()).toBe(0);

    // Fehler werden klar gemeldet (Kanal unbekannt, Vorlage zu kurz, Startzeit falsch)
    expect(await c.call("video_auftrag_anlegen", { ...wunsch, kanal: "Gibt es nicht 4711" })).toContain("nicht gefunden");
    expect(await c.call("video_auftrag_anlegen", { ...wunsch, vorlage: "zu kurz" })).toContain("sehr kurz");
    expect(await c.call("video_auftrag_anlegen", { ...wunsch, start: "morgen früh" })).toContain("JJJJ-MM-TTTHH:MM");
    expect(await anzahl()).toBe(0);

    // 2) nach „Ja“: Auftrag angelegt – Thema, eigenes Skript, Startzeit, wartet auf den Worker
    const r2 = JSON.parse(await c.call("video_auftrag_anlegen", { ...wunsch, bestaetigt: true }));
    expect(r2.angelegt).toBe(true);
    expect(r2.link).toContain(`/marken/video?kanal=${kanalId}#a-${r2.id}`);
    const [a] = await sql<{ thema: string; vorlage: string; vorlage_art: string; start_ab: Date; status: string }>("select thema, vorlage, vorlage_art, start_ab, status from video_auftraege where tenant_id = $1 and id = $2", [T, r2.id]);
    expect(a).toMatchObject({ thema: wunsch.thema, vorlage: skript, vorlage_art: "skript", status: "wartet" });
    expect(new Date(a.start_ab).toISOString()).toBe("2030-01-01T05:30:00.000Z");
    expect(await anzahl()).toBe(1);

    // Protokoll: ändernde Aktion mit Stufe gelb und Datensatz
    const [log] = await sql<{ stufe: string; ids: string[]; summary: string }>("select stufe, ids, summary from assistant_log where tenant_id = $1 and tool = 'video_auftrag_anlegen' and ok order by created_at desc limit 1", [T]);
    expect(log.stufe).toBe("gelb");
    expect(log.ids).toEqual([r2.id]);
    expect(log.summary).not.toContain(wunsch.thema); // Protokolltext liegt verschlüsselt in der Datenbank

    // Lesewerkzeug zeigt den neuen Auftrag mit Vorlage-Art
    expect(await c.call("video_auftraege", { kanal: KANAL4 })).toContain(wunsch.thema);
  });
});
