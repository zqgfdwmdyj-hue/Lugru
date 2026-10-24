import { describe, expect, it } from "vitest";
import { needsCheck, packOf, packSource, sizeConflict, wizardStatus, type WizardInput } from "@/lib/temu/wizard";

// Temu-Assistent: Zustände und fehlende Angaben. Fiktive Angebote.

const base: WizardInput = { title: "Thermoskanne 1 l", image: "https://i.example/a.jpg", price: 24.9, variations: 0, condition: "NEW", pack: {}, temu: null, job: null };
const full = { weightG: 500, lengthCm: 30, widthCm: 20, heightCm: 10 };

describe("Zustand", () => {
  it("Entwurf, wenn alles da ist; unvollständig mit Liste, was fehlt", () => {
    expect(wizardStatus(base, 15.27, full).status).toBe("entwurf");
    const r = wizardStatus({ ...base, image: null, condition: "USED" }, 0, { weightG: 500 });
    expect(r.status).toBe("unvollstaendig");
    expect(r.missing).toEqual(["Bild", "Preis", "Paketmaße", "nur Neuware"]);
  });
  it("http-Bilder nur mit Freigabe (Testumgebung)", () => {
    const c = { ...base, image: "http://localhost/img.png" };
    expect(wizardStatus(c, 10, full).missing).toEqual(["Bild nicht öffentlich (https)"]);
    expect(wizardStatus(c, 10, full, { allowHttp: true }).status).toBe("entwurf");
  });
  it("Warteschlange, Temu-Stände, Fehler", () => {
    expect(wizardStatus({ ...base, job: { status: "wartet", message: null } }, 10, full).status).toBe("in-arbeit");
    expect(wizardStatus({ ...base, job: { status: "fehler", message: "Gebraucht" } }, 10, full)).toEqual({ status: "fehlgeschlagen", missing: [], reason: "Gebraucht" });
    expect(wizardStatus({ ...base, temu: { status: "ACTIVE", error: null } }, 10, full).status).toBe("veroeffentlicht");
    expect(wizardStatus({ ...base, temu: { status: "INCOMPLETE", error: "Temu: unvollständig" } }, 10, full).status).toBe("unvollstaendig");
    expect(wizardStatus({ ...base, temu: { status: null, error: null } }, 10, full).status).toBe("in-arbeit");
  });
});

describe("Paket", () => {
  it("Zeile vor Angebot vor Standard", () => {
    expect(packOf({ weightG: 900 }, { weightG: 700, lengthCm: 40 }, full)).toEqual({ weightG: 900, lengthCm: 40, widthCm: 20, heightCm: 10 });
  });
});

describe("Prüfrunde 2: vollständig ≠ geprüft", () => {
  const base = { title: "Kochmesser 20 cm Edelstahl", image: "https://i.ebayimg.com/x.jpg", price: 30, variations: 0, condition: "NEW", pack: {}, temu: null, job: null };
  const std = { weightG: 300, lengthCm: 10, widthCm: 10, heightCm: 5 };
  it("Standardpaket allein ist „prüfen“, nicht „bereit“", () => {
    const src = packSource({}, {});
    expect(src).toBe("standard");
    const check = needsCheck({ title: "Tasse" }, std, src, false);
    expect(wizardStatus({ ...base, title: "Tasse" }, 25, std, { check }).status).toBe("pruefen");
    expect(wizardStatus({ ...base, title: "Tasse" }, 25, std, { check: needsCheck({ title: "Tasse" }, std, src, true) }).status).toBe("entwurf");
  });
  it("Titel nennt 20 cm, Paket 10 cm → Warnung, auch mit Artikeldaten", () => {
    expect(sizeConflict("Kochmesser 20 cm Edelstahl", std)).toBe(20);
    expect(sizeConflict("Kochmesser 20cm", { ...std, lengthCm: 25 })).toBeNull();
    expect(sizeConflict("Tasse 0,3 l", std)).toBeNull();
    const check = needsCheck(base, std, "artikel", false);
    expect(check[0]).toMatch(/Paket kleiner als im Titel genannt \(20 cm\)/);
    expect(wizardStatus(base, 25, std, { check }).status).toBe("pruefen");
  });
  it("Quelle: Zeile vor Artikel vor Standard", () => {
    expect(packSource({ weightG: 1, lengthCm: 1, widthCm: 1, heightCm: 1 }, {})).toBe("zeile");
    expect(packSource({ weightG: 1 }, { lengthCm: 2, widthCm: 2, heightCm: 2 })).toBe("artikel");
    expect(packSource({ weightG: 1 }, { lengthCm: 2 })).toBe("standard");
  });
});
