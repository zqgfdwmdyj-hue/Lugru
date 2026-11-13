import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { anzeigeStatus, BILD_MODELL_STANDARD, bildModellFehlt, bildModellReihenfolge, bildTreffer, schluesselAbgelehnt, claudeNutzung, claudePreis, ERSATZ_BILDIDEE, fortschrittProzent, kostenPosition, kostenSchaetzung, kostenSumme, nachSchritt, freigabeAktiv, figurenAus, MOTIVE_JE_SZENE, NEUE_MOTIVE_JE_SZENE, slugAus, startAbAus, titelTreffer, TYPISCH, typischFuer, laengeZiel, SKRIPT_WOERTER, VIDEO_MODELL_STANDARD, WORKER_AB_TAKT, WORKER_AB_CLIPS, clipMeldungAus, schlagwoerterAus, WORKER_VERSION_AKTUELL, workerVeraltet, VIDEO_PREISE_STANDARD, workerStand } from "@/lib/video/logic";

// B36 Video-Pipeline: Schrittfolge mit Freigaben, Upload nur mit Schalter, Worker-Stand, Start „heute Nacht“, Kosten aus
// Claude-Antworten (JSON und Stream), Filter (gleiche Liste wie der Python-Worker).

const alle = { gliederung: true, skript: true, vorschau: true };

describe("Schrittfolge und Freigaben (B36.3)", () => {
  it("nach research/script/package wartet der Auftrag auf die jeweilige Freigabe", () => {
    expect(nachSchritt("research", { freigaben: alle, freigegeben: {}, hochladen: false })).toEqual({ status: "freigabe", schritt: "script", freigabeOffen: "gliederung" });
    expect(nachSchritt("script", { freigaben: alle, freigegeben: { gliederung: "x" }, hochladen: false })).toEqual({ status: "freigabe", schritt: "voice", freigabeOffen: "skript" });
    expect(nachSchritt("package", { freigaben: alle, freigegeben: { gliederung: "x", skript: "x" }, hochladen: true })).toEqual({ status: "freigabe", schritt: "upload", freigabeOffen: "vorschau" });
  });
  it("abgeschaltete Freigaben werden übersprungen; Upload nur mit „Privat hochladen“", () => {
    const ohne = { gliederung: false, skript: false, vorschau: false };
    expect(nachSchritt("research", { freigaben: ohne, freigegeben: {}, hochladen: false })).toEqual({ status: "laeuft", schritt: "script", freigabeOffen: null });
    expect(nachSchritt("package", { freigaben: ohne, freigegeben: {}, hochladen: false })).toEqual({ status: "fertig", schritt: "upload", freigabeOffen: null });
    expect(nachSchritt("package", { freigaben: ohne, freigegeben: {}, hochladen: true })).toEqual({ status: "laeuft", schritt: "upload", freigabeOffen: null });
    expect(nachSchritt("upload", { freigaben: ohne, freigegeben: {}, hochladen: true }).status).toBe("fertig");
    expect(nachSchritt("voice", { freigaben: alle, freigegeben: {}, hochladen: false })).toEqual({ status: "laeuft", schritt: "visuals", freigabeOffen: null });
  });
  it("B36.9: Szenen-Übersicht nach den Bildern, vor dem Render – nur wenn im Kanal eingeschaltet", () => {
    // ohne Eintrag (alte Kanäle): aus → Bilder gehen direkt in den Render
    expect(freigabeAktiv({}, "szenen")).toBe(false);
    expect(freigabeAktiv({}, "gliederung")).toBe(true);
    expect(nachSchritt("visuals", { freigaben: alle, freigegeben: {}, hochladen: false })).toEqual({ status: "laeuft", schritt: "render", freigabeOffen: null });
    const mitSzenen = { ...alle, szenen: true };
    expect(nachSchritt("visuals", { freigaben: mitSzenen, freigegeben: {}, hochladen: false })).toEqual({ status: "freigabe", schritt: "render", freigabeOffen: "szenen" });
    expect(nachSchritt("visuals", { freigaben: mitSzenen, freigegeben: { szenen: "x" }, hochladen: false })).toEqual({ status: "laeuft", schritt: "render", freigabeOffen: null });
  });
  it("B36.9: Figuren aus dem Kanalprofil („kurzname: Beschreibung“)", () => {
    expect(figurenAus("Blonder Mann: Mann um die 60, blond\nbrille: Mann mit runder Brille\nohne Doppelpunkt\nx: zu")).toEqual([
      { key: "blonder-mann", beschreibung: "Mann um die 60, blond" },
      { key: "brille", beschreibung: "Mann mit runder Brille" },
    ]);
    expect(figurenAus(null)).toEqual([]);
  });
  it("Fortschritt in Prozent (ohne Upload, wenn der Schalter aus ist)", () => {
    expect(fortschrittProzent({ research: { status: "fertig" }, script: { status: "fertig" }, voice: { status: "laeuft", fortschritt: { fertig: 13, gesamt: 26 } } }, false)).toBe(Math.round((2.5 / 6) * 100));
    expect(fortschrittProzent({}, true)).toBe(0);
  });
});

describe("Worker-Stand (B36.2/B36.7)", () => {
  const jetzt = new Date("2026-11-11T12:00:00Z");
  it("online bis 10 Min., danach Warnung und „wartet (Worker aus)“", () => {
    expect(workerStand(new Date("2026-11-11T11:55:00Z"), jetzt)).toMatchObject({ online: true, warnung: false });
    const aus = workerStand(new Date("2026-11-11T11:49:00Z"), jetzt);
    expect(aus).toMatchObject({ online: false, warnung: true, minuten: 11 });
    expect(aus.text).toContain("seit 11 Min. keine Meldung");
    expect(workerStand(null, jetzt)).toMatchObject({ online: false, warnung: true });
    expect(anzeigeStatus("laeuft", false)).toBe("wartet (Worker aus)");
    expect(anzeigeStatus("laeuft", true)).toBe("läuft");
    expect(anzeigeStatus("freigabe", false)).toBe("Freigabe nötig");
  });
});

describe("Start „heute Nacht“", () => {
  it("23:00 Berlin (Winterzeit = 22:00 UTC); nach 23 Uhr sofort", () => {
    expect(startAbAus("nacht", null, new Date("2026-11-11T10:00:00Z"))?.toISOString()).toBe("2026-11-11T22:00:00.000Z");
    expect(startAbAus("nacht", null, new Date("2026-11-11T22:30:00Z"))).toBeNull();
    expect(startAbAus("zeitpunkt", "2026-11-12T06:30", new Date("2026-11-11T10:00:00Z"))?.toISOString()).toBe("2026-11-12T05:30:00.000Z");
    expect(startAbAus("sofort", null)).toBeNull();
  });
});

describe("Kosten (B36.3)", () => {
  it("Schätzung nennt fehlende Preise; mit Preisen alle Posten", () => {
    const s = kostenSchaetzung(VIDEO_PREISE_STANDARD);
    expect(s.fehlend).toEqual(["Sprache (ElevenLabs)", "Bilder (GPT Image 2.5 Flare)"]);
    const p = { ...VIDEO_PREISE_STANDARD, elevenlabsJe1000Zeichen: 0.18, bildJeStueck: 0.04 };
    const sonnet = kostenSchaetzung(p, TYPISCH, "claude-sonnet-5-5");
    expect(sonnet.fehlend).toEqual([]);
    // Fest 1.500–1.700 Wörter, abschnittsweise: 118k/19k Tokens (inkl. Bildplan), 12 Suchen, 10.600 Zeichen,
    // B36.11: alle 6 s ein Bild über ~640 s Sprechzeit = 107 Bilder (vorher 25 Standbilder)
    expect(TYPISCH).toEqual({ zeichen: 10_600, bilder: 107, motive: 0, websuchen: 12, eingabeTokens: 118_000, ausgabeTokens: 19_000 });
    expect(sonnet.summe).toBeCloseTo(0.236 + 0.19 + 0.12 + 1.908 + 4.28, 2);
    // Standard ist Opus 5.5 (4 $/20 $ je Mio. Tokens): nur der Claude-Anteil ist teurer
    expect(VIDEO_MODELL_STANDARD).toBe("claude-opus-5-5");
    expect(kostenSchaetzung(p).summe).toBeCloseTo(0.472 + 0.38 + 0.12 + 1.908 + 4.28, 2);
    // mit Stock-Clips ~40 % weniger Bilder, mit Bildwechsel alle 8 s entsprechend weniger
    expect(typischFuer("vollbild", { stockClips: true }).bilder).toBe(64);
    expect(typischFuer("vollbild", { bildSek: 8 }).bilder).toBe(80);
    // Whiteboard: statt 25 Bildern Einzelmotive (neue je Video, Rest aus der Bibliothek), eigener Preis je Motiv
    const wb = typischFuer("whiteboard");
    // B36.10: 55–80 kurze Szenen, Motive kehren wieder – im Schnitt 1,5 neue (bezahlte) Motive je Szene
    expect(wb).toMatchObject({ bilder: 0, motive: Math.round(67.5 * NEUE_MOTIVE_JE_SZENE) });
    expect(wb.motive).toBeLessThan(67.5 * MOTIVE_JE_SZENE);
    const mitMotivpreis = kostenSchaetzung({ ...p, motivJeStueck: 0.02 }, wb, "claude-opus-5-5");
    expect(mitMotivpreis.positionen.map((x) => x.art)).toEqual(["Claude (Recherche, Skript, Paket)", "Websuche", "Sprache (ElevenLabs)", "Motive (GPT Image 2.5 Flare, ca. 101 neue)"]);
    expect(mitMotivpreis.positionen.at(-1)!.betrag).toBeCloseTo(2.02, 2);
    // ohne eigenen Motivpreis gilt der Bildpreis
    expect(kostenSchaetzung(p, wb).positionen.at(-1)!.betrag).toBeCloseTo(4.04, 2);
    expect(kostenPosition("openai", { ...p, motivJeStueck: 0.02 }, { bilder: 1, motiv: true }, new Date(0))[0]).toMatchObject({ art: "Motiv", einheit: "Motive", betrag: 0.02 });
    // Die Brücke nennt das tatsächlich benutzte Bildmodell
    expect(kostenPosition("openai", p, { bilder: 1, bildModell: "gpt-image-2" }, new Date(0))[0]).toMatchObject({ art: "Bild (GPT Image 2)", betrag: 0.04 });
    expect(kostenSchaetzung(p, TYPISCH, "claude-opus-5-5", "gpt-image-2.5-sunburst").positionen.at(-1)!.art).toBe("Bilder (GPT Image 2.5 Sunburst)");
  });
  it("Bildmodell (13.11.): gpt-image-1 abgeschaltet → Standard GPT Image 2.5 Flare; bei „Modell fehlt“ das nächste, Inhalts-Ablehnung zählt nicht", () => {
    expect(BILD_MODELL_STANDARD).toBe("gpt-image-2.5-flare");
    expect(bildModellReihenfolge("gpt-image-2.5-flare")).toEqual(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2"]);
    expect(bildModellReihenfolge("gpt-image-2")).toEqual(["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);
    // unbekannt/alt (z. B. gpt-image-1 aus alten Einstellungen) → Standard
    expect(bildModellReihenfolge("gpt-image-1")[0]).toBe("gpt-image-2.5-flare");
    // zuletzt funktionierendes zuerst
    expect(bildModellReihenfolge("gpt-image-2.5-sunburst", "gpt-image-2.5-flare")).toEqual(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2"]);
    // Antworten wie von OpenAI
    expect(bildModellFehlt(400, '{"error":{"message":"The model \'gpt-image-1\' does not exist","type":"invalid_request_error"}}')).toBe(true);
    expect(bildModellFehlt(404, '{"error":{"message":"The model `gpt-image-2` does not exist or you do not have access to it.","code":"model_not_found"}}')).toBe(true);
    expect(bildModellFehlt(403, '{"error":{"message":"Your organization must be verified to use the model `gpt-image-2.5-flare`."}}')).toBe(true);
    expect(bildModellFehlt(400, '{"error":{"message":"Your request was rejected as a result of our safety system.","code":"moderation_blocked"}}')).toBe(false);
    expect(bildModellFehlt(400, '{"error":{"message":"Invalid size 999x999."}}')).toBe(false);
    expect(bildModellFehlt(429, '{"error":{"message":"Rate limit for model gpt-image-2 not available"}}')).toBe(false);
    expect(bildModellFehlt(401, "model does not exist")).toBe(false);
  });
  it("Abgelehnter Schlüssel: klare Meldung mit Ort, ohne Schlüsselteile", () => {
    expect(schluesselAbgelehnt("openai")).toBe("OpenAI-Schlüssel abgelehnt (HTTP 401) – unter Anbindungen → OpenAI (Bilder für Videos) den API-Key neu eintragen und „Verbindung testen“.");
    expect(schluesselAbgelehnt("elevenlabs")).toContain("Anbindungen → ElevenLabs (Sprache für Videos)");
    expect(schluesselAbgelehnt("anthropic")).toContain("Claude-Schlüssel abgelehnt (HTTP 401)");
  });
  it("Worker-Version: ältere Worker werden als veraltet erkannt", () => {
    expect(WORKER_VERSION_AKTUELL).toBe("1.5.0");
    expect(workerVeraltet("1.0.0")).toBe(true);
    expect(workerVeraltet(null)).toBe(true);
    expect(workerVeraltet("1.1.2")).toBe(true);
    expect(workerVeraltet("1.2.0")).toBe(true); // 1.2.1: mehr Platz für Claude
    expect(workerVeraltet("1.2.1")).toBe(true); // 1.3.0: echtes Zeichnen, Probeszene
    expect(workerVeraltet("1.3.0")).toBe(true); // 1.4.0: Vollbild in Bewegung (Bildwechsel, Kamerafahrt, Pexels)
    expect(workerVeraltet("1.4.0")).toBe(true); // 1.4.1: Clips von Pixabay (Pexels vergibt keine Schlüssel)
    expect(workerVeraltet("1.4.1")).toBe(true); // 1.5.0: eigene Clip-Bibliothek (Ordner clips)
    expect(workerVeraltet("1.5.0")).toBe(false);
    expect(workerVeraltet("1.4.1", WORKER_AB_CLIPS)).toBe(true);
    expect(workerVeraltet("2.0")).toBe(false);
    // Stories und „Im neuen Takt“ gehen schon ab 1.2.0
    expect(workerVeraltet("1.2.0", WORKER_AB_TAKT)).toBe(false);
    expect(workerVeraltet("1.1.2", WORKER_AB_TAKT)).toBe(true);
  });
  it("Länge fest für alle Kanäle: 1.500–1.700 Wörter ≈ 10–12 Min., 15–34 Szenen", () => {
    expect(SKRIPT_WOERTER).toEqual([1500, 1700]);
    expect(laengeZiel()).toEqual({ minuten: [10, 12], sekunden: [621, 703], woerter: [1500, 1700], szenen: [15, 34], szenenJePunkt: [2, 4] });
  });
  it("Nutzung aus JSON- und Stream-Antworten (inkl. Websuchen), Posten und Summe", () => {
    expect(claudeNutzung(JSON.stringify({ usage: { input_tokens: 1000, cache_read_input_tokens: 500, output_tokens: 200, server_tool_use: { web_search_requests: 3 } } }))).toEqual({ eingabe: 1500, ausgabe: 200, websuchen: 3 });
    const sse = ['event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":9000,"output_tokens":1}}}', 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}', 'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":2500,"server_tool_use":{"web_search_requests":4}}}'].join("\n\n");
    const n = claudeNutzung(sse);
    expect(n).toEqual({ eingabe: 9000, ausgabe: 2500, websuchen: 4 });
    const pos = kostenPosition("anthropic", VIDEO_PREISE_STANDARD, { eingabe: n.eingabe, ausgabe: n.ausgabe, websuchen: n.websuchen, modell: "claude-sonnet-5-5" });
    expect(pos.map((p) => p.art)).toEqual(["Tokens (Claude Sonnet 5.5)", "Websuche"]);
    expect(kostenSumme(pos)).toBeCloseTo(0.018 + 0.025 + 0.04, 4);
    const opus = kostenPosition("anthropic", VIDEO_PREISE_STANDARD, { eingabe: n.eingabe, ausgabe: n.ausgabe, modell: "claude-opus-5-5" });
    expect(kostenSumme(opus)).toBeCloseTo(0.036 + 0.05, 4);
    // eingetragener Preis gilt vor dem Listenpreis; unbekanntes Modell → Opus-Preis (lieber zu hoch)
    expect(claudePreis({ ...VIDEO_PREISE_STANDARD, claudeEingabeJeMio: 3 }, "claude-sonnet-5-5")).toEqual({ eingabe: 3, ausgabe: 10 });
    expect(claudePreis(VIDEO_PREISE_STANDARD, "claude-irgendwas")).toEqual({ eingabe: 4, ausgabe: 20 });
    expect(kostenPosition("elevenlabs", VIDEO_PREISE_STANDARD, { zeichen: 1000 })[0].betrag).toBeNull();
    expect(kostenPosition("openai", { ...VIDEO_PREISE_STANDARD, bildJeStueck: 0.04 }, { bilder: 2 })[0].betrag).toBe(0.08);
  });
});

describe("Filter (B36.6) – dieselbe Liste wie der Worker", () => {
  it("„Sex“ als Thema erlaubt, explizite Begriffe nicht; streng sperrt Bett/Kuss/Berührung", () => {
    expect(titelTreffer("Kein Sex mehr in der Beziehung? 5 Gründe, über die keiner spricht")).toBeNull();
    expect(titelTreffer("Nackt-Yoga im Test")).toBe("nackt");
    expect(bildTreffer("Leeres Bett im Morgenlicht", false)).toBeNull();
    expect(bildTreffer("Leeres Bett im Morgenlicht", true)).toBe("bett");
    expect(bildTreffer("Paar beim Kuss", true)).toBe("kuss");
    expect(bildTreffer("Frau in Unterwäsche", false)).toBe("unterwaesche");
    expect(bildTreffer(ERSATZ_BILDIDEE, true)).toBeNull();
  });
  it("filter.json wird vom Python-Worker mitbenutzt (eine Quelle)", () => {
    const py = readFileSync("unter-der-decke/udd/filter.py", "utf8");
    expect(py).toContain('"filter.json"');
    expect(py).toContain('_FILTER["bild_streng"]');
  });
  it("Kanal-Kurzname ohne Umlaute/Sonderzeichen", () => {
    expect(slugAus("Testkanal Über Nacht!")).toBe("testkanal-ueber-nacht");
    expect(slugAus("***")).toBe("kanal");
  });
});

describe("Seller-System rechnet nicht (B36.2/Abnahme 7)", () => {
  it("kein ffmpeg/Python/Kindprozess im Video-Code des Seller-Systems", () => {
    const dateien = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? dateien(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of [...dateien("src/lib/video"), ...dateien("src/app/api/video-worker"), ...dateien("src/app/api/video")]) {
      const t = readFileSync(f, "utf8");
      expect(t, f).not.toMatch(/child_process|spawn\(|execFile|fluent-ffmpeg/);
    }
  });
});

describe("B36.10 „Im neuen Takt neu machen“ – Kostenschätzung", () => {
  it("geht bei fertig, Fehler, wartender Freigabe und abgebrochen – nicht während ein Schritt läuft oder wartet", async () => {
    const { taktNeuMoeglich } = await import("@/lib/video/logic");
    expect(["fertig", "fehler", "freigabe", "abgebrochen"].every(taktNeuMoeglich)).toBe(true);
    expect(["wartet", "laeuft"].some(taktNeuMoeglich)).toBe(false);
  });
  it("ohne Recherche/Websuche: Claude für Skript+Paket, Sprache für alle Zeichen, nur neue Motive (Rest aus der Bibliothek)", async () => {
    const { taktNeuSchaetzung, VIDEO_PREISE_STANDARD } = await import("@/lib/video/logic");
    const p = { ...VIDEO_PREISE_STANDARD, claudeEingabeJeMio: 4, claudeAusgabeJeMio: 20, elevenlabsJe1000Zeichen: 0.18, motivJeStueck: 0.02 };
    const s = taktNeuSchaetzung(p, "claude-opus-5-5", 10_000, 60);
    expect(s.positionen.map((x) => x.art)).toEqual(["Claude (Skript in kurzen Szenen, Paket)", "Sprache mit Wortzeiten (10.000 Zeichen)", "neue Motive (ca. 41, 60 aus der Bibliothek)"]);
    expect(s.positionen.map((x) => Math.round((x.betrag ?? 0) * 100) / 100)).toEqual([0.4, 1.8, 0.82]);
    expect(s.summe).toBe(3.02);
    expect(s.positionen.some((x) => /Websuche|Recherche/.test(x.art))).toBe(false);
    // große Bibliothek: mindestens 10 neue Motive eingeplant; fehlender Sprachpreis wird genannt
    expect(taktNeuSchaetzung({ ...p, elevenlabsJe1000Zeichen: null }, null, 10_000, 500)).toMatchObject({ neueMotive: 10, fehlend: ["Sprache mit Wortzeiten"] });
  });
});

describe("Anbieter-Störung: automatisch später neu", () => {
  it("erkennt vorübergehende Störungen (nach 5 Versuchen, HTTP 429/5xx), nicht abgelehnte Schlüssel", async () => {
    const { anbieterStoerung } = await import("@/lib/video/logic");
    expect(anbieterStoerung("Skript – Punkt 5: nach 5 Versuchen nicht geklappt (HTTP 503: credential validation failed)")).toBe(true);
    expect(anbieterStoerung("ElevenLabs (Szene 4): HTTP 529: overloaded")).toBe(true);
    expect(anbieterStoerung("Bildanbieter: HTTP 429: rate limit")).toBe(true);
    expect(anbieterStoerung("OpenAI-Schlüssel abgelehnt (HTTP 401) – unter Anbindungen → OpenAI neu eintragen")).toBe(false);
    expect(anbieterStoerung("Im Kanalprofil fehlt die Stimme (ElevenLabs-Voice-ID).")).toBe(false);
    expect(anbieterStoerung(null)).toBe(false);
  });
  it("nach 10, 30, 60 Minuten – danach bleibt der Fehler stehen", async () => {
    const { autoNeuUm } = await import("@/lib/video/logic");
    const t = new Date("2026-11-13T10:00:00Z");
    const f = "Skript – Punkt 5: nach 5 Versuchen nicht geklappt (HTTP 503: credential validation failed)";
    expect([0, 1, 2].map((n) => (autoNeuUm(f, n, t)!.getTime() - t.getTime()) / 60_000)).toEqual([10, 30, 60]);
    expect(autoNeuUm(f, 3, t)).toBeNull();
    expect(autoNeuUm("Kein Skript", 0, t)).toBeNull();
  });
});

describe("Brücke: Platz für Claude-Antworten", () => {
  it("hebt max_tokens auf mindestens 16.000 (Denken zählt mit), größere Werte bleiben", async () => {
    const { claudeMitPlatz, CLAUDE_PLATZ_MIN } = await import("@/lib/video/logic");
    expect(CLAUDE_PLATZ_MIN).toBe(16000);
    expect(claudeMitPlatz({ model: "claude-opus-5-5", max_tokens: 3000, messages: [] })).toEqual({ model: "claude-opus-5-5", max_tokens: 16000, messages: [] });
    expect(claudeMitPlatz({ max_tokens: 1200 })?.max_tokens).toBe(16000);
    expect(claudeMitPlatz({ max_tokens: 16000 })).toBeNull();
    expect(claudeMitPlatz({ max_tokens: 32000 })).toBeNull();
    expect(claudeMitPlatz({ messages: [] })).toBeNull();
  });
});

describe("Sprechtempo, Wörter/Min, Probeszene (13.11.)", () => {
  it("Sprechtempo 0,7–1,2, Standard 1,1; Komma oder Punkt", async () => {
    const { sprechtempoAus, SPRECHTEMPO } = await import("@/lib/video/logic");
    expect(SPRECHTEMPO.standard).toBe(1.1);
    expect([sprechtempoAus("1,15"), sprechtempoAus(1.5), sprechtempoAus("0.5"), sprechtempoAus(""), sprechtempoAus(null)]).toEqual([1.15, 1.2, 0.7, 1.1, 1.1]);
  });
  it("Wörter/Min aus Skript und Dauer: erstes Video 1.122 Wörter in 704 s ≈ 96 → Warnung unter 135", async () => {
    const { woerterProMinute, WPM } = await import("@/lib/video/logic");
    const skript = Array.from({ length: 11 }, (_, i) => ({ text: Array.from({ length: i === 0 ? 122 : 100 }, () => "wort").join(" ") }));
    const wpm = woerterProMinute(skript, 704)!;
    expect(wpm).toBe(96);
    expect(wpm < WPM.warnung).toBe(true);
    expect(woerterProMinute(skript, 450)).toBe(150);
    expect(woerterProMinute([], 100)).toBeNull();
    expect(woerterProMinute(skript, 0)).toBeNull();
  });
  it("Brücke: voice_settings mit den gespeicherten Einstellungen der Stimme ergänzen, speed begrenzt", async () => {
    const { stimmeMitTempo } = await import("@/lib/video/logic");
    const gespeichert = { stability: 0.42, similarity_boost: 0.8, style: 0.1, use_speaker_boost: true, speed: 1, fremd: "x" };
    expect(stimmeMitTempo({ text: "Hallo", voice_settings: { speed: 1.1 } }, gespeichert)).toEqual({ text: "Hallo", voice_settings: { stability: 0.42, similarity_boost: 0.8, style: 0.1, use_speaker_boost: true, speed: 1.1 } });
    expect(stimmeMitTempo({ text: "Hallo", voice_settings: { speed: 2 } }, null)).toEqual({ text: "Hallo", voice_settings: { speed: 1.2 } });
    expect(stimmeMitTempo({ text: "Hallo" }, gespeichert)).toBeNull();
  });
  it("Probeszene: Whiteboard mit Motiven bzw. Vollbild mit Skript, sobald kein Schritt läuft; ca. 20 s ab der gewählten Szene", async () => {
    const { probeMoeglich, probeSzenen, WORKER_AB_PROBE, workerVeraltet } = await import("@/lib/video/logic");
    const skript = Array.from({ length: 10 }, (_, i) => ({ text: Array.from({ length: 20 }, () => "wort").join(" "), motive: i === 0 ? [] : [{ key: "m" }] }));
    expect(probeMoeglich({ art: "video", status: "fertig", skript }, "whiteboard")).toBe(true);
    expect(probeMoeglich({ art: "video", status: "laeuft", skript }, "whiteboard")).toBe(false);
    expect(probeMoeglich({ art: "video", status: "fertig", skript }, "vollbild")).toBe(true); // B36.11: auch Vollbild
    expect(probeMoeglich({ art: "video", status: "fertig", skript: [] }, "vollbild")).toBe(false);
    expect(probeMoeglich({ art: "story", status: "fertig", skript }, "vollbild")).toBe(false);
    expect(probeMoeglich({ art: "video", status: "fertig", skript: [{ text: "x", motive: [] }] }, "whiteboard")).toBe(false);
    expect(probeSzenen(skript, 3)).toEqual([3, 4, 5]); // 3 × (8 s + 0,3 s) ≥ 19 s
    expect(probeSzenen(skript, 10)).toEqual([10]);
    expect(probeSzenen(Array.from({ length: 9 }, () => ({ text: "kurz" })), 1)).toHaveLength(5); // höchstens 5 Szenen
    expect(workerVeraltet("1.2.1", WORKER_AB_PROBE)).toBe(true);
  });
});

describe("B36.11 Pixabay als Clip-Quelle (Pexels vergibt keine Schlüssel)", () => {
  it("Treffer im Pexels-Format: ID mit Vorsilbe, Filmer, nur https-Dateien, leere Größen fallen weg", async () => {
    const { pixabayAlsVideos, pixabaySchluesselAbgelehnt } = await import("@/lib/video/logic");
    const v = pixabayAlsVideos([
      { id: 125, pageURL: "https://pixabay.com/videos/id-125/", duration: 12, user: "Testfilmer", videos: { large: { url: "https://cdn.pixabay.com/video/test/large.mp4", width: 3840, height: 2160 }, medium: { url: "https://cdn.pixabay.com/video/test/medium.mp4", width: 1920, height: 1080 }, small: { url: "", width: 0, height: 0 }, tiny: { url: "http://unsicher.example.invalid/t.mp4", width: 640, height: 360 } } },
      { id: 7, duration: 5, user: "Ohne Dateien", videos: { large: { url: "" } } },
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ id: "pixabay-125", quelle: "pixabay", duration: 12, url: "https://pixabay.com/videos/id-125/", user: { name: "Testfilmer" } });
    expect(v[0].video_files.map((f) => f.width)).toEqual([3840, 1920]);
    expect(pixabayAlsVideos(undefined)).toEqual([]);
    expect(pixabaySchluesselAbgelehnt(400, "[ERROR 400] Invalid or missing API key")).toBe(true);
    expect(pixabaySchluesselAbgelehnt(400, "[ERROR 400] per_page is out of valid range")).toBe(false);
    expect(pixabaySchluesselAbgelehnt(429, "")).toBe(false);
  });
});

describe("B36.11 Vollbild in Bewegung (13.11.)", () => {
  it("Bildwechsel alle N s: Anzahl Bilder, Grenzen 4–10 s, Clips sparen Bilder, Worker-Version je Stil", async () => {
    const { bilderVollbild, bildSekAus, BILD_SEK, workerAbProbe, WORKER_AB_BEWEGT, WORKER_AB_PROBE, probeMoeglich } = await import("@/lib/video/logic");
    expect(BILD_SEK.standard).toBe(6);
    expect(bilderVollbild(600)).toBe(100); // 10 Min. → alle 6 s ein Bild
    expect(bilderVollbild(600, 5)).toBe(120);
    expect(bilderVollbild(600, 6, true)).toBe(60); // ~40 % werden kostenlose Stock-Clips (Pixabay/Pexels)
    expect(bildSekAus("7,5")).toBe(7.5);
    expect(bildSekAus(2)).toBe(4);
    expect(bildSekAus(30)).toBe(10);
    expect(bildSekAus("abc")).toBe(6);
    expect(workerAbProbe("whiteboard")).toBe(WORKER_AB_PROBE);
    expect(workerAbProbe("vollbild")).toBe(WORKER_AB_BEWEGT);
    expect(probeMoeglich({ art: "video", status: "freigabe", skript: [{ text: "Ein Satz." }] }, "vollbild")).toBe(true);
  });
});

describe("B36.12 Eigene Clip-Bibliothek – Meldung vom Worker", () => {
  const gut = { id: "0123456789abcdef0123", pfad: "uhren/pexels-max-muster-4711.mp4", kanal: "testkanal", dauer: 8.04, breite: 1920, hoehe: 1080, beschreibung: " Uhr am Handgelenk ", schlagwoerter: ["Uhr", "watch", ""], einstellung: "detail", brauchbar: true, grund: "", abschnitt: { start: 1.234, dauer: 6.8 }, quelle: "pexels", filmer: "Max Muster", benutzt: 2, zuletzt: 1_763_000_000 };
  it("prüft und kürzt die Angaben", () => {
    const c = clipMeldungAus(gut)!;
    expect(c).toMatchObject({ clipId: gut.id, pfad: gut.pfad, kanalSlug: "testkanal", dauer: 8, breite: 1920, beschreibung: "Uhr am Handgelenk", schlagwoerter: ["uhr", "watch"], brauchbar: true, grund: null, abschnitt: { start: 1.2, dauer: 6.8 }, quelle: "pexels", filmer: "Max Muster", benutzt: 2 });
    expect(c.zuletztBenutzt?.getTime()).toBe(1_763_000_000_000);
    expect(clipMeldungAus({ ...gut, pfad: "C:\\video\\clips\\a.mp4" })?.pfad).toBe("C:/video/clips/a.mp4");
  });
  it("lehnt Ungültiges ab (ID, Pfad mit ..), unbekannte Quelle = eigen, brauchbar nur bei false aus", () => {
    expect(clipMeldungAus({ ...gut, id: "xyz" })).toBeNull();
    expect(clipMeldungAus({ ...gut, pfad: "../geheim.mp4" })).toBeNull();
    expect(clipMeldungAus({ ...gut, pfad: "" })).toBeNull();
    expect(clipMeldungAus(null)).toBeNull();
    expect(clipMeldungAus({ ...gut, quelle: "youtube" })?.quelle).toBe("eigen");
    expect(clipMeldungAus({ ...gut, brauchbar: undefined })?.brauchbar).toBe(true);
    expect(clipMeldungAus({ ...gut, brauchbar: false, grund: "Wasserzeichen" })).toMatchObject({ brauchbar: false, grund: "Wasserzeichen" });
    expect(clipMeldungAus({ ...gut, kanal: "" })?.kanalSlug).toBeNull();
    expect(clipMeldungAus({ ...gut, abschnitt: { start: 1, dauer: 0 } })?.abschnitt).toBeNull();
    expect(clipMeldungAus({ ...gut, schlagwoerter: Array.from({ length: 40 }, (_, i) => `w${i}`) })?.schlagwoerter).toHaveLength(25);
  });
  it("Schlagwörter aus dem Eingabefeld: klein, ohne Doppelte", () => {
    expect(schlagwoerterAus("Rolex, Zifferblatt; rolex\nNahaufnahme, ")).toEqual(["rolex", "zifferblatt", "nahaufnahme"]);
    expect(schlagwoerterAus("  ")).toEqual([]);
  });
});
