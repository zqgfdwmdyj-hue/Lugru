// Bauauftrag B36 Video-Pipeline – Abnahme B36.7 (1–8) mit dem echten Python-Worker (unter-der-decke/worker.py) gegen
// das Seller-System und die Nachbauten (Claude, ElevenLabs, OpenAI-Bilder, YouTube). Kanal, Stimme, Token und alle
// Daten sind erfunden; kein echter Kanal, kein echter Schlüssel.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { E2E_ENV, E2E_PORT, TD } from "./env";
import { aktion, anmelden, expect, marke, sql, test } from "./helfer";

function versiegeln(plain: string) {
  const key = createHash("sha256").update(`integrations:${E2E_ENV.APP_SECRET}`).digest();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
type VideoNb = { eleven: { hash: string; zeichen: number; stimme: string }[]; bilder: { prompt: string; abgelehnt: boolean; model: string; size: string; quality: string }[]; youtube: { id: string; titel: string; sichtbarkeit: string; beschreibung: string; tags: string[]; thumbnail: boolean }[] };
const nachbau = () => fetch(`${TD}/__video`).then((r) => r.json() as Promise<VideoNb>);
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
  const logDatei = path.join(process.cwd(), "test-results", "b36-worker.log");
  let log = "";

  const workerStarten = () => {
    worker = spawn(PY, [path.join(process.cwd(), "unter-der-decke", "worker.py")], {
      env: { ...process.env, SELLER_URL: `http://localhost:${E2E_PORT}`, WORKER_TOKEN: token, ARBEITSORDNER: path.join(arbeit, "projekte"), MUSIKORDNER: path.join(arbeit, "musik"), VIDEO_POLL_S: "1", VIDEO_FPS: "2", MIN_FREI_GB: "0.1", WARN_FREI_GB: "0.1", PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    worker.stdout?.on("data", (d) => (log += d));
    worker.stderr?.on("data", (d) => (log += d));
  };
  const workerStoppen = async () => {
    if (!worker || worker.exitCode !== null) return;
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
      const ids = await sql<{ id: string }>("select a.id from video_auftraege a join video_kanaele k on k.id = a.kanal_id where a.tenant_id = $1 and k.name = $2", [T, KANAL]);
      for (const { id } of ids) rmSync(path.join(E2E_ENV.MEDIA_DIR, "video", T, id), { recursive: true, force: true });
      await sql("delete from video_kanaele where tenant_id = $1 and name = $2", [T, KANAL]);
      await sql("delete from video_worker where tenant_id = $1 and name = $2", [T, `Test-PC ${m}`]);
      await sql(`delete from integrations where tenant_id = $1 and provider in ('elevenlabs', 'openai'${googleNeu ? ", 'google'" : ""})`, [T]);
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

    // Abnahme 1: Worker starten → Gliederung mit Quellen erscheint zur Freigabe
    workerStarten();
    await warteAuf("Freigabe Gliederung", (a) => a.freigabe_offen === "gliederung");
    await page.reload();
    await expect(page.getByTestId("vd-worker-stand")).toHaveAttribute("data-online", "1");
    await expect(karte.getByTestId("vd-status")).toContainText("Gliederung + Quellen");
    await expect(karte.getByTestId("vd-punkt")).toHaveCount(5);
    await expect(karte.getByTestId("vd-quelle")).toHaveCount(6);
    const ki = (await (await fetch(`${TD}/__ki`)).json()) as { text: string; tools: string[] }[];
    const recherche = ki.filter((k) => k.text.startsWith("[video:research]")).at(-1)!;
    expect(recherche.tools).toContain("web_search");
    expect(recherche.text).toContain("beziehung ohne nähe"); // vidIQ fließt in die Recherche
    await Promise.all([aktion(page), karte.getByTestId("vd-freigeben").click()]);

    // Abnahme 2: Skript mit 5–7 Punkten, 1.500–1.700 Wörtern, alle Studien in der Quellenliste
    let a = await warteAuf("Freigabe Skript", (x) => x.freigabe_offen === "skript");
    expect(a.woerter).toBeGreaterThanOrEqual(1500);
    expect(a.woerter).toBeLessThanOrEqual(1700);
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
    // … Neustart setzt fort, ohne bezahlte Sprache/Bilder neu zu erzeugen
    workerStarten();
    a = await warteAuf("Freigabe Vorschau", (x) => x.freigabe_offen === "vorschau", 420_000);
    const nb = await nachbau();
    const verschieden = new Set(nb.eleven.map((e) => e.hash));
    expect(verschieden.size).toBe(szenen);
    expect(nb.eleven.length).toBeLessThanOrEqual(szenen + 1); // höchstens die eine Szene, die beim Abbruch unterwegs war
    expect(nb.eleven.every((e) => e.stimme === "testStimme01")).toBe(true);

    // Abnahme 8: OpenAI gpt-image-1 1536×1024 medium; Ablehnung → Ersatzbild; strenger Filter vor dem Aufruf
    expect(nb.bilder.every((b) => b.model === "gpt-image-1" && b.size === "1536x1024" && b.quality === "medium")).toBe(true);
    expect(nb.bilder.filter((b) => b.abgelehnt)).toHaveLength(1);
    expect(nb.bilder.length).toBe(szenen + 1);
    expect(nb.bilder.some((b) => /\bbett\b/i.test(b.prompt))).toBe(false);
    expect(a.skript!.filter((s) => s.ersatzbild).length).toBeGreaterThanOrEqual(2); // abgelehnt + Filter „Bett“

    // Abnahme 3: MP4 10–12 Min., 1920×1080, Untertitel; Thumbnail 1280×720; 5 Titel, Beschreibung mit Kapiteln, Tags
    for (const art of ["mp4", "thumbnail", "skript", "quellen", "untertitel"]) expect(a.dateien[art]?.groesse, art).toBeGreaterThan(0);
    const ordner = path.join(E2E_ENV.MEDIA_DIR, "video", T, a.id);
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", path.join(ordner, "video.mp4")]).toString()) as { streams: { width: number; height: number }[]; format: { duration: string } };
    expect([probe.streams[0].width, probe.streams[0].height]).toEqual([1920, 1080]);
    expect(Number(probe.format.duration)).toBeGreaterThanOrEqual(600);
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
});
