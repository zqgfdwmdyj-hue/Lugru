// B12: Privat-Einträge der übrigen Arten per Claude anlegen (privat_eintrag_anlegen) – nur mit Privat-Freigabe und
// Schreibrecht; ohne Freigabe kein Werkzeug. Erfundene Texte.
import { expect, marke, mcpVerbinden, sql, test } from "./helfer";

test.describe("Privat-Einträge per Claude", () => {
  test("Danke, Stimmung, Date-Idee, Aufgabe, Gespräch, Zuwendung, Tagebuch anlegen; ohne Freigabe nicht sichtbar", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const m = marke();
    const ohne = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
    expect(await ohne.tools()).not.toContain("privat_eintrag_anlegen");

    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true, privat: true });
    expect(await mcp.tools()).toContain("privat_eintrag_anlegen");
    const anlegen = async (args: Record<string, unknown>) => {
      const out = await mcp.call("privat_eintrag_anlegen", args);
      try {
        return JSON.parse(out) as { ok: boolean; id?: string; meldung: string };
      } catch {
        return { ok: false, meldung: out };
      }
    };
    expect((await anlegen({ art: "danke", text: `Danke fürs Kochen ${m}` })).ok).toBe(true);
    expect((await anlegen({ art: "stimmung", wert: 4, text: `gut ${m}` })).ok).toBe(true);
    expect((await anlegen({ art: "dateidee", text: `Picknick am See ${m}` })).ok).toBe(true);
    expect((await anlegen({ art: "aufgabe", text: `Geschenk besorgen ${m}`, person: "beide" })).ok).toBe(true);
    expect((await anlegen({ art: "gespraech", text: `Urlaubsplanung ${m}` })).ok).toBe(true);
    expect((await anlegen({ art: "zuwendung", variante: "massage", person: "a", wert: 20, text: `Testmassage ${m}` })).ok).toBe(true);
    expect((await anlegen({ art: "tagebuch", text: `Testtag ${m}`, wert: 3 })).ok).toBe(true);
    // Falsche Eingabe: Stimmung ohne Wert → klare Meldung, nichts gespeichert
    const fehl = await anlegen({ art: "stimmung" });
    expect(fehl.ok).toBe(false);
    expect(fehl.meldung).toContain("1 bis 5");

    // Gespeichert (verschlüsselt) – über privat_eintraege lesbar
    const l1 = JSON.parse(await mcp.call("privat_eintraege", { arten: ["danke", "dateidee", "aufgabe", "gespraech"], limit: 200 }));
    const l2 = JSON.parse(await mcp.call("privat_eintraege", { arten: ["zuwendung", "tagebuch", "stimmung"], limit: 200 }));
    const texte = JSON.stringify([...l1.eintraege, ...l2.eintraege]);
    for (const t of [`Danke fürs Kochen ${m}`, `Picknick am See ${m}`, `Geschenk besorgen ${m}`, `Urlaubsplanung ${m}`, `Testmassage ${m}`, `Testtag ${m}`]) expect(texte).toContain(t);
    // Nicht im Klartext in der Datenbank
    const [roh] = await sql<{ c: string }>("select count(*) c from private_entries where data::text like $1", [`%${m}%`]);
    expect(roh.c).toBe("0");
  });
});
