import { describe, expect, it } from "vitest";
import { packOf, wizardStatus, type WizardInput } from "@/lib/temu/wizard";

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
