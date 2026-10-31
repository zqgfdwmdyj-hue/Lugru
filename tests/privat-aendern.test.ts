import { describe, expect, it } from "vitest";
import { eintragPatch } from "@/lib/private/aendern-logic";

// privat_eintrag_aendern (B16) – welche Angabe in welches Feld geht. Erfundene Inhalte.

const heute = "2026-10-31";

describe("Beobachtung ändern", () => {
  const alt = { day: "2026-10-28", aboutUserId: "u-1", text: "Abendessen | Problematik: laut geworden | Gewünschte Veränderung: [?]" };
  it("einzelnes Feld ersetzen, übrige aus dem Text übernehmen, Text neu bilden", () => {
    const r = eintragPatch("beobachtung", alt, { veraenderung: "kurz rausgehen" }, heute);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.daten).toMatchObject({ situation: "Abendessen", problematik: "laut geworden", veraenderung: "kurz rausgehen", text: "Abendessen | Problematik: laut geworden | Gewünschte Veränderung: kurz rausgehen", aboutUserId: "u-1", day: "2026-10-28" });
    expect(r.felder).toEqual(["veraenderung"]);
  });
  it("leeres Feld entfernt es; leere Situation ist nicht erlaubt", () => {
    const r = eintragPatch("beobachtung", { ...alt, situation: "Abendessen", problematik: "laut", veraenderung: "Pause" }, { problematik: "" }, heute);
    expect(r.ok && r.daten.problematik).toBe(undefined);
    expect(r.ok && r.daten.text).toBe("Abendessen | Gewünschte Veränderung: Pause");
    expect(eintragPatch("beobachtung", alt, { situation: " " }, heute)).toMatchObject({ ok: false });
  });
  it("neuer Freitext ersetzt die drei Felder; beides zugleich geht nicht", () => {
    const r = eintragPatch("beobachtung", { ...alt, situation: "x", problematik: "y" }, { text: "Ganz neu" }, heute);
    expect(r.ok && r.daten).toEqual({ day: "2026-10-28", aboutUserId: "u-1", text: "Ganz neu" });
    expect(eintragPatch("beobachtung", alt, { text: "a", situation: "b" }, heute)).toMatchObject({ ok: false });
    expect(eintragPatch("beobachtung", alt, { text: "" }, heute)).toMatchObject({ ok: false });
  });
  it("Tag: gültig und nicht in der Zukunft", () => {
    expect(eintragPatch("beobachtung", alt, { tag: "2026-10-29" }, heute)).toMatchObject({ ok: true, daten: { day: "2026-10-29" } });
    expect(eintragPatch("beobachtung", alt, { tag: "2026-11-02" }, heute)).toMatchObject({ ok: false });
    expect(eintragPatch("beobachtung", alt, { tag: "31.10.2026" }, heute)).toMatchObject({ ok: false });
  });
});

describe("übrige Arten", () => {
  it("Werte je Art: Stimmung/Tagebuch/Nähe 1–5, Zuwendung Minuten", () => {
    expect(eintragPatch("stimmung", { day: "2026-10-30", person: "a", value: 2 }, { wert: 4 }, heute)).toMatchObject({ ok: true, daten: { value: 4 } });
    expect(eintragPatch("stimmung", { day: "2026-10-30", person: "a", value: 2 }, { wert: 7 }, heute)).toMatchObject({ ok: false });
    expect(eintragPatch("tagebuch", { day: "2026-10-30", mood: 3 }, { wert: 5, text: "ruhiger Tag" }, heute)).toMatchObject({ ok: true, daten: { mood: 5, note: "ruhiger Tag" } });
    expect(eintragPatch("zuwendung", { day: "2026-10-30", kind: "massage", giver: "a", receiver: "b", status: "stattgefunden", minutes: 10 }, { wert: 0 }, heute)).toMatchObject({ ok: true });
    expect(eintragPatch("danke", { day: "2026-10-30", from: "b", text: "x" }, { wert: 3 }, heute)).toMatchObject({ ok: false });
  });
  it("Texte je Art und Pflichttexte", () => {
    expect(eintragPatch("gespraech", { day: "2026-10-29", topic: "alt" }, { text: "Wochenende", vereinbart: "Samstag frei" }, heute)).toMatchObject({ ok: true, daten: { topic: "Wochenende", agreed: "Samstag frei" } });
    expect(eintragPatch("gespraech", { day: "2026-10-29", topic: "alt" }, { text: "" }, heute)).toMatchObject({ ok: true });
    expect(eintragPatch("danke", { day: "2026-10-29", from: "a", text: "alt" }, { text: "" }, heute)).toMatchObject({ ok: false });
    expect(eintragPatch("aufgabe", { title: "Brief", source: "paar", forWhom: "a", repeat: "einmal" }, { text: "Brief schreiben", tag: "2026-11-05" }, heute)).toMatchObject({ ok: true, daten: { title: "Brief schreiben", due: "2026-11-05" } });
  });
  it("erledigt: einmalige Aufgabe mit Datum, wiederkehrende nicht; Date-Idee", () => {
    expect(eintragPatch("aufgabe", { title: "Brief", source: "paar", forWhom: "a", repeat: "einmal" }, { erledigt: true }, heute)).toMatchObject({ ok: true, daten: { done: true, doneAt: heute } });
    const zurueck = eintragPatch("aufgabe", { title: "Brief", source: "paar", forWhom: "a", repeat: "einmal", done: true, doneAt: "2026-10-30" }, { erledigt: false }, heute);
    expect(zurueck.ok && zurueck.daten.doneAt).toBe(undefined);
    expect(eintragPatch("aufgabe", { title: "Ich-Botschaften", source: "paar", forWhom: "beide", repeat: "taeglich" }, { erledigt: true }, heute)).toMatchObject({ ok: false });
    expect(eintragPatch("dateidee", { text: "Picknick" }, { erledigt: true }, heute)).toMatchObject({ ok: true, daten: { done: true } });
    expect(eintragPatch("dateidee", { text: "Picknick" }, { tag: "2026-10-30" }, heute)).toMatchObject({ ok: false });
  });
  it("ohne Angabe nichts zu ändern; drei Felder nur bei Beobachtungen", () => {
    expect(eintragPatch("danke", { day: "2026-10-29", from: "a", text: "x" }, {}, heute)).toMatchObject({ ok: false });
    expect(eintragPatch("danke", { day: "2026-10-29", from: "a", text: "x" }, { situation: "y" }, heute)).toMatchObject({ ok: false });
  });
});
