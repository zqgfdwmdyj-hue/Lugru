// B21 mit dem Discord-Nachbau: Transkript in den Call-Kanal hochladen → über die Live-Verbindung (Gateway,
// MESSAGE_CREATE) sofort im Call-Archiv, Wissen und Aufgaben da, Meldung an den Inhaber; bearbeitete Nachricht
// (MESSAGE_UPDATE) ersetzt denselben Eintrag; zu große Datei → Aufgabe mit Link zur Nachricht; Anbindungen, `calls`
// und `anbindungen_status` zeigen „live“ und den Zeitpunkt. Nur erfundene Inhalte.
import { TD } from "./env";
import { anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const td = async <T,>(pfad: string, body?: unknown): Promise<T> => (await (await fetch(`${TD}${pfad}`, body === undefined ? undefined : { method: "POST", body: JSON.stringify(body) })).json()) as T;

const VTT = (m: string) =>
  [
    "WEBVTT",
    "",
    "00:00:01.000 --> 00:00:04.000",
    "<v Consultant>Hallo Ludwig, schön dass es klappt.",
    "",
    "00:00:05.000 --> 00:00:09.000",
    "<v Ludwig>Hallo! Wie besprochen habe ich die Markenliste vorbereitet.",
    "",
    "00:00:10.000 --> 00:00:14.000",
    "<v Consultant>Schick mir bis Freitag die Liste der zehn Marken für den Audit.",
    "",
    "00:00:15.000 --> 00:00:19.000",
    `<v Ludwig>Mache ich. Gilt der Mindestrabatt auch für Bundles? (Testlauf ${m})`,
    "",
    "00:00:20.000 --> 00:00:24.000",
    "<v Consultant>Das kläre ich intern. Black-Week-Deals nur mit Gewinn.",
  ].join("\n");

test.describe("B21 – Call-Transkripte live aus Discord", () => {
  test("Upload → Archiv, Wissen, Aufgaben, Meldung; Bearbeiten ersetzt; zu groß → Aufgabe; Anzeige live", async ({ page, browser, baseURL }) => {
    test.setTimeout(150_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const kanal = `82${String(Date.now()).slice(-16).padStart(16, "0")}`;
    const [alt] = await sql<{ kanal: string }>("select config->>'kanalId' as kanal from integrations where tenant_id = $1 and provider = 'discord_calls'", [T]);
    // Call-Kanal auf einen Kanal des Nachbaus umstellen (gleicher Bot – die Live-Verbindung bleibt bestehen)
    await sql("update integrations set config = config || jsonb_build_object('kanalId', $2::text) where tenant_id = $1 and provider = 'discord_calls'", [T, kanal]);
    try {
      // Live-Verbindung steht, angemeldet mit „Message Content“
      await expect.poll(async () => (await td<{ verbunden: number }>("/__discord-gateway")).verbunden, { timeout: 30_000 }).toBeGreaterThan(0);
      const g = await td<{ identify: { intents: number }[] }>("/__discord-gateway");
      expect(g.identify.at(-1)!.intents & (1 << 15)).toBeTruthy();

      const meldungen = async () => (await sql<{ n: number }>("select count(*)::int as n from meldungen where tenant_id = $1 and titel = 'Call vom 30.10.2026 ausgewertet'", [T]))[0].n;
      const vorher = await meldungen();
      const t0 = Date.now();
      const msg = await td<{ id: string }>("/__discord-va/nachricht", { kanal, text: `Consultant-Call 30.10.2026 ${m}`, anhang: { name: `call-${m}.vtt`, inhalt: VTT(m) } });

      // Innerhalb weniger Sekunden (Ziel ≤ 5 Min.): Call im Archiv und ausgewertet
      const call = async () => (await sql<{ id: string; titel: string; datum: string; auswertung: string; wissen_am: Date | null; inhalt_kennung: string }>("select id, titel, datum::text as datum, auswertung, wissen_am, inhalt_kennung from calls where tenant_id = $1 and quelle_ref = $2", [T, `discord:${msg.id}`]))[0];
      await expect.poll(async () => (await call())?.auswertung ?? null, { timeout: 60_000 }).toBe("fertig");
      const c = (await call())!;
      expect(c.titel).toContain(m);
      expect(c.datum).toBe("2026-10-30");
      expect(Date.now() - t0).toBeLessThan(5 * 60_000);
      await expect.poll(async () => (await call())?.wissen_am ?? null, { timeout: 30_000 }).not.toBeNull();
      const [{ w }] = await sql<{ w: number }>("select count(*)::int as w from knowledge_entries where tenant_id = $1 and call_id = $2", [T, c.id]);
      expect(w).toBeGreaterThan(0);
      const [{ a }] = await sql<{ a: number }>("select count(*)::int as a from call_punkte where tenant_id = $1 and call_id = $2 and art = 'aufgabe'", [T, c.id]);
      expect(a).toBeGreaterThan(0);
      await expect.poll(meldungen, { timeout: 30_000 }).toBeGreaterThan(vorher);

      // Bearbeitet (Anhang ersetzt) → derselbe Eintrag mit neuem Inhalt, nicht doppelt
      await td("/__discord-va/bearbeiten", { nachricht: msg.id, anhang: { name: `call-${m}-v2.txt`, inhalt: `Consultant: Neue Fassung ${m}. Schick mir bis Freitag die Liste der zehn Marken für den Audit.\nLudwig: Mache ich, Black-Week-Deals nur mit Gewinn.\nConsultant: Das kläre ich intern.` } });
      await expect.poll(async () => (await call())?.inhalt_kennung, { timeout: 60_000 }).not.toBe(c.inhalt_kennung);
      const [{ n }] = await sql<{ n: number }>("select count(*)::int as n from calls where tenant_id = $1 and titel like $2", [T, `%${m}%`]);
      expect(n).toBe(1);

      // Zu große Datei → Aufgabe mit Link zur Nachricht, nichts still verworfen
      const gross = await td<{ id: string }>("/__discord-va/nachricht", { kanal, text: `Call ${m} (groß)`, anhang: { name: `gross-${m}.pdf`, inhalt: "x", groesse: 30 * 1024 * 1024 } });
      await expect.poll(async () => (await sql<{ notes: string }>("select notes from tasks where tenant_id = $1 and system_key = $2", [T, `call-discord:${gross.id}`]))[0]?.notes ?? "", { timeout: 30_000 }).toContain("zu groß");
      const [aufgabe] = await sql<{ title: string; notes: string }>("select title, notes from tasks where tenant_id = $1 and system_key = $2", [T, `call-discord:${gross.id}`]);
      expect(aufgabe.title).toBe("Call-Transkript aus Discord nicht verarbeitet");
      expect(aufgabe.notes).toContain(`https://discord.com/channels/500000000000000001/${kanal}/${gross.id}`);

      // Anbindungen: Auslöser live, zuletzt empfangen, letzter/nächster Lauf
      await anmelden(page, "inhaber");
      await page.goto("/anbindungen");
      await expect(page.getByTestId("discord-live-status")).toContainText("Auslöser: live (Discord) – verbunden seit");
      await expect(page.getByTestId("discord-zuletzt-empfangen")).not.toHaveText("noch nichts");
      const zeile = page.getByTestId("abrufe-discord").getByTestId("abruf-zeile").filter({ hasText: "Call-Archiv (Discord live)" });
      await expect(zeile).toContainText("Auslöser: live (Discord)");
      await expect(zeile).toContainText("sofort bei Eingang");

      // Werkzeuge: calls und anbindungen_status nennen „live“ und den Zeitpunkt
      const mcp = await mcpVerbinden(browser, baseURL!, "inhaber");
      const calls = JSON.parse(await mcp.call("calls", {})) as { discord: { ausloeser: string; zuletzt_empfangen: string | null; letzter_lauf: string | null }; calls: { titel: string }[] };
      expect(calls.discord.ausloeser).toContain("live");
      expect(calls.discord.zuletzt_empfangen).not.toBeNull();
      expect(calls.discord.letzter_lauf).not.toBeNull();
      expect(calls.calls.some((x) => x.titel.includes(m))).toBe(true);
      const st = JSON.parse(await mcp.call("anbindungen_status", {})) as { discord_call_kanal: { ausloeser: string; zuletzt_empfangen: string }; abrufe: { abruf: string; ausloeser: string; naechster_lauf: string }[] };
      expect(st.discord_call_kanal.ausloeser).toBe("live (Discord)");
      expect(st.discord_call_kanal.zuletzt_empfangen).not.toBe("noch nichts");
      expect(st.abrufe.find((x) => x.abruf === "Call-Archiv (Discord live)")).toMatchObject({ naechster_lauf: "sofort bei Eingang" });
    } finally {
      await sql("update integrations set config = config || jsonb_build_object('kanalId', $2::text) where tenant_id = $1 and provider = 'discord_calls'", [T, alt?.kanal ?? "123456789012345678"]);
    }
  });
});
