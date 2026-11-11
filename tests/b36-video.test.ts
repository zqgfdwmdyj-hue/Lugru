import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { anzeigeStatus, bildTreffer, claudeNutzung, claudePreis, ERSATZ_BILDIDEE, fortschrittProzent, kostenPosition, kostenSchaetzung, kostenSumme, nachSchritt, freigabeAktiv, figurenAus, MOTIVE_JE_SZENE, slugAus, startAbAus, titelTreffer, TYPISCH, typischFuer, laengeZiel, LAENGE_STANDARD, VIDEO_MODELL_STANDARD, VIDEO_PREISE_STANDARD, workerStand } from "@/lib/video/logic";

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
    expect(s.fehlend).toEqual(["Sprache (ElevenLabs)", "Bilder (gpt-image-1)"]);
    const p = { ...VIDEO_PREISE_STANDARD, elevenlabsJe1000Zeichen: 0.18, bildJeStueck: 0.04 };
    const sonnet = kostenSchaetzung(p, TYPISCH, "claude-sonnet-5-5");
    expect(sonnet.fehlend).toEqual([]);
    // Standardlänge 16–20 Min.: 66k/21k Tokens, 6 Suchen, 17.200 Zeichen, 40 Bilder
    expect(TYPISCH).toEqual({ zeichen: 17_200, bilder: 40, motive: 0, websuchen: 6, eingabeTokens: 66_000, ausgabeTokens: 21_000 });
    expect(sonnet.summe).toBeCloseTo(0.132 + 0.21 + 0.06 + 3.096 + 1.6, 2);
    // Standard ist Opus 5.5 (4 $/20 $ je Mio. Tokens): nur der Claude-Anteil ist teurer
    expect(VIDEO_MODELL_STANDARD).toBe("claude-opus-5-5");
    expect(kostenSchaetzung(p).summe).toBeCloseTo(0.264 + 0.42 + 0.06 + 3.096 + 1.6, 2);
    // Kurzer Kanal (10–12 Min.) wie vorher: ~1.600 Wörter
    expect(typischFuer(10, 12)).toEqual({ zeichen: 10_600, bilder: 25, motive: 0, websuchen: 6, eingabeTokens: 60_000, ausgabeTokens: 15_000 });
    // Whiteboard: statt 40 Bildern bis zu 160 Einzelmotive (ohne Wiederverwendung = Obergrenze), eigener Preis je Motiv
    const wb = typischFuer(16, 20, "whiteboard");
    expect(wb).toMatchObject({ bilder: 0, motive: 40 * MOTIVE_JE_SZENE });
    const mitMotivpreis = kostenSchaetzung({ ...p, motivJeStueck: 0.02 }, wb, "claude-opus-5-5");
    expect(mitMotivpreis.positionen.map((x) => x.art)).toEqual(["Claude (Recherche, Skript, Paket)", "Websuche", "Sprache (ElevenLabs)", "Motive (gpt-image-1, höchstens 160)"]);
    expect(mitMotivpreis.positionen.at(-1)!.betrag).toBeCloseTo(3.2, 2);
    // ohne eigenen Motivpreis gilt der Bildpreis
    expect(kostenSchaetzung(p, wb).positionen.at(-1)!.betrag).toBeCloseTo(6.4, 2);
    expect(kostenPosition("openai", { ...p, motivJeStueck: 0.02 }, { bilder: 1, motiv: true }, new Date(0))[0]).toMatchObject({ art: "Motiv", einheit: "Motive", betrag: 0.02 });
  });
  it("Länge je Kanal: Wörter, Szenen, Sekunden; Grenzen", () => {
    expect(LAENGE_STANDARD).toEqual({ von: 16, bis: 20 });
    expect(laengeZiel()).toEqual({ minuten: [16, 20], sekunden: [960, 1200], woerter: [2300, 2900], szenen: [27, 45], szenenJePunkt: [3, 6] });
    expect(laengeZiel(10, 12)).toMatchObject({ woerter: [1450, 1750], szenen: [17, 27], szenenJePunkt: [2, 4] });
    expect(laengeZiel(12, 14)).toMatchObject({ woerter: [1750, 2050] });
    // bis < von → bis = von; außerhalb 3–60 begrenzt
    expect(laengeZiel(18, 10).minuten).toEqual([18, 18]);
    expect(laengeZiel(1, 200).minuten).toEqual([3, 60]);
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
