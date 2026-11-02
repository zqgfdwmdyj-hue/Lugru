// Familienkalender „Betrifft“ (ich / Familie / Partnerin) und Apple-Watch-Seite mit einem Kurzbefehl für alles
// (watch/frage). Erfundene Daten: Partner „Ina“ (Inhaberin, a) und „Tom“ (b) aus den Testdaten.
import { createHash } from "node:crypto";
import { anmelden, expect, marke, sql, test } from "./helfer";

const berlin = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
/** Ein Donnerstag weit weg von anderen Prüfungen. */
const DONNERSTAG = (() => {
  let d = plus(berlin(new Date()), 61);
  while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 4) d = plus(d, 1);
  return d;
})();
type Watch = { ok: boolean; zeige: string; zeilen: string[]; befehl: string | null; antwort: string };

test.describe("Familienkalender und Apple Watch", () => {
  test("Familienkalender: Termin nur für Tom blockt Inas Tagesplan nicht; „Familie“ blockt wieder; Name im Titel wird erkannt", async ({ page }) => {
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const termin = async (uid: string, titel: string, von: string, bis: string) =>
      (
        await sql<{ id: string }>(
          "insert into calendar_events (tenant_id, calendar_name, uid, title, starts_at, ends_at, all_day, day, location) values ($1, 'Familie (privat)', $2, $3, ($4::date + $5::time) at time zone 'Europe/Berlin', ($4::date + $6::time) at time zone 'Europe/Berlin', false, $4::date, 'Testweg 1, 80331 München') returning id",
          [T, uid, titel, DONNERSTAG, von, bis],
        )
      )[0].id;
    const elternabend = await termin(`fk-eltern-${m}`, `Elternabend ${m}`, "10:00", "11:00");
    await termin(`fk-tom-${m}`, `Tom Zahnarzt ${m}`, "14:00", "15:00");
    await anmelden(page, "inhaber");

    // Tagesplan: „Tom Zahnarzt“ (Name im Titel) blockt nicht; der Elternabend (Familie) schon – samt Fahrzeit
    await page.goto(`/kalender/tagesplan?tag=${DONNERSTAG}`);
    const belegt = page.getByTestId("tagesplan-sperren");
    await expect(belegt).toContainText("10:00");
    await expect(belegt).not.toContainText("14:00–15:00");

    // Im Privatkalender: Termin öffnen → „Betrifft“ auf Tom stellen
    await page.goto(`/privat/eintragen?vom=${elternabend}`);
    await expect(page.getByTestId("betrifft-aktuell")).toHaveText("Familie / beide");
    await Promise.all([page.waitForURL(/betrifft=ok/), page.getByTestId("betrifft-b").click()]);
    await expect(page.getByTestId("betrifft-aktuell")).toHaveText("Tom");
    expect((await sql<{ betrifft: string }>("select betrifft from kalender_betrifft where tenant_id = $1 and uid = $2", [T, `fk-eltern-${m}`]))[0].betrifft).toBe("b");

    // Jetzt blockt auch der Elternabend Inas Tag nicht mehr; im Kalender steht „nur Tom“
    await page.goto(`/kalender/tagesplan?tag=${DONNERSTAG}`);
    await expect(page.getByTestId("tagesplan-sperren")).not.toContainText("10:00–11:00");
    await page.goto(`/privat/kalender?tag=${DONNERSTAG}&ansicht=tag`);
    await expect(page.getByTestId("pk-betrifft").first()).toContainText("nur Tom");

    // Zurück auf „Familie“ → blockt wieder
    await page.goto(`/privat/eintragen?vom=${elternabend}`);
    await Promise.all([page.waitForURL(/betrifft=ok/), page.getByTestId("betrifft-familie").click()]);
    await page.goto(`/kalender/tagesplan?tag=${DONNERSTAG}`);
    await expect(page.getByTestId("tagesplan-sperren")).toContainText("10:00");
  });

  test("Familientermine direkt im Tagesplan und Kalender zuordnen: „nur Tom“ macht Platz, zurückholen geht; To-do-Termine blocken nicht", async ({ page }) => {
    const m = marke();
    const TAG = plus(DONNERSTAG, 7);
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const termin = (uid: string, titel: string, von: string, bis: string) =>
      sql("insert into calendar_events (tenant_id, calendar_name, uid, title, starts_at, ends_at, all_day, day) values ($1, 'Familie (privat)', $2, $3, ($4::date + $5::time) at time zone 'Europe/Berlin', ($4::date + $6::time) at time zone 'Europe/Berlin', false, $4::date)", [T, uid, titel, TAG, von, bis]);
    await termin(`fk2-fortbildung-${m}`, `Fortbildung Arbeit ${m}`, "09:00", "13:00");
    await termin(`fk2-todo-${m}`, `To do Ina: Geschenk kaufen ${m}`, "15:00", "16:00");
    const zuordnung = async () => (await sql<{ betrifft: string }>("select betrifft from kalender_betrifft where tenant_id = $1 and uid = $2", [T, `fk2-fortbildung-${m}`]))[0]?.betrifft ?? null;
    const kapazitaet = async () => {
      const t = (await page.getByTestId("tagesplan-kapazitaet").textContent()) ?? "";
      const k = /Kapazität (\d+)(?::(\d+))? Std\./.exec(t);
      return k ? Number(k[1]) * 60 + Number(k[2] ?? 0) : 0;
    };
    await anmelden(page, "inhaber");

    // Ohne private Details: „Privat belegt“ mit „wen betrifft es?“; der To-do-Termin blockt nicht (wird Aufgabe)
    await page.goto(`/kalender/tagesplan?tag=${TAG}`);
    const belegt = page.getByTestId("tagesplan-sperren");
    await expect(belegt).toContainText("09:00–13:00");
    await expect(belegt).not.toContainText("15:00–16:00");
    await expect(page.getByText(/Kalender-To-do.*zählt als Aufgabe/)).toBeVisible();
    await page.getByTestId("tagesplan-zuordnen").first().click();
    await expect(page).toHaveURL(/privat=1/);

    // Mit Details: Titel + Knöpfe; „nur Tom“ → blockt nicht mehr, steht unter „Blockt nicht“, mehr Kapazität
    const fortbildung = page.getByTestId("tagesplan-familientermin").filter({ hasText: `Fortbildung Arbeit ${m}` });
    await expect(fortbildung.getByTestId("betrifft-schnell-familie")).toHaveAttribute("aria-pressed", "true");
    const vorher = await kapazitaet();
    await Promise.all([page.waitForURL(/meldung=/), fortbildung.getByTestId("betrifft-schnell-b").click()]);
    await expect(page.getByRole("status")).toContainText("betrifft jetzt nur Tom");
    await expect(page).toHaveURL(/privat=1/);
    expect(await zuordnung()).toBe("b");
    await expect(page.getByTestId("tagesplan-sperren")).not.toContainText(`Fortbildung Arbeit ${m}`);
    const anderer = page.getByTestId("tagesplan-anderer-termin").filter({ hasText: `Fortbildung Arbeit ${m}` });
    await expect(anderer).toBeVisible();
    expect(await kapazitaet()).toBeGreaterThan(vorher);

    // Zurückholen: „Ina (ich)“ → blockt wieder; ↺ löscht die Zuordnung (wieder automatisch)
    await Promise.all([page.waitForURL(/meldung=/), anderer.getByTestId("betrifft-schnell-a").click()]);
    expect(await zuordnung()).toBe("a");
    await expect(fortbildung).toBeVisible();
    expect(await kapazitaet()).toBe(vorher);
    await Promise.all([page.waitForURL(/meldung=/), fortbildung.getByTestId("betrifft-schnell-automatisch").click()]);
    expect(await zuordnung()).toBeNull();

    // Kalender-Tagesliste: gleiche Knöpfe; „nur Tom“ wird blass mit Hinweis
    await page.goto(`/kalender?monat=${TAG.slice(0, 7)}&tag=${TAG}`);
    const zeile = page.getByTestId("cal-daylist").getByTestId("cal-familientermin").filter({ hasText: `Fortbildung Arbeit ${m}` });
    await Promise.all([page.waitForURL(/meldung=/), zeile.getByTestId("betrifft-schnell-b").click()]);
    await expect(page).toHaveURL(new RegExp(`tag=${TAG}`));
    await expect(page.getByTestId("kalender-meldung")).toContainText("nur Tom");
    await expect(zeile).toContainText("blockt deine Zeit nicht");
    expect(await zuordnung()).toBe("b");
  });

  test("Apple Watch: Seite mit Anleitung und Ausprobieren; ein Kurzbefehl für alles (watch/frage)", async ({ page }) => {
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const [{ id: INH }] = await sql<{ id: string }>("select id from users where email = 'inhaber'");
    const token = `mk_fw${m}${"y".repeat(24)}`;
    await sql("insert into api_tokens (tenant_id, user_id, name, zweck, token_hash, anfang) values ($1, $2, $3, 'mobil', $4, $5)", [T, INH, `Watch ${m}`, createHash("sha256").update(token).digest("hex"), token.slice(0, 7)]);
    await anmelden(page, "inhaber");

    // Auffindbar: Handy & Tesla → Apple Watch; Anleitung mit Adresse; Schlüssel erkannt
    await page.goto("/einstellungen/handy");
    await page.getByTestId("handy-watch").click();
    await expect(page).toHaveURL(/\/einstellungen\/watch/);
    await expect(page.getByTestId("watch-url")).toContainText("/api/mobil/watch/frage");
    await expect(page.getByTestId("watch-schluessel-ok")).toBeVisible();

    // Ausprobieren: lesender Befehl zeigt die Uhr-Antwort; ändernder wird nur erkannt
    await page.getByTestId("watch-probe-text").fill("Was ist dringend?");
    await page.getByTestId("watch-probe-los").click();
    await expect(page.getByTestId("watch-befehl")).toContainText("Was ist dringend");
    await expect(page.getByTestId("watch-antwort")).toBeVisible();
    await page.goto(`/einstellungen/watch?probe=${encodeURIComponent("Erledigt")}`);
    await expect(page.getByTestId("watch-befehl")).toContainText("Erledigt");
    await expect(page.getByTestId("watch-befehl")).toContainText("nicht ausgeführt");

    // Endpunkt: freier Satz → passender Befehl; ändernd nur per POST; unklar → Hilfe; ohne Schlüssel 401
    const frage = async (text: string, methode: "get" | "post" = "post") => {
      const res = methode === "post" ? await page.request.post("/api/mobil/watch/frage", { data: { text }, headers: { Authorization: `Bearer ${token}` } }) : await page.request.get(`/api/mobil/watch/frage?text=${encodeURIComponent(text)}`, { headers: { Authorization: `Bearer ${token}` } });
      return { status: res.status(), r: (await res.json()) as Watch };
    };
    const st = await frage("Wie läuft's?");
    expect(st.status).toBe(200);
    expect(st.r.befehl).toBe("stand");
    expect(st.r.zeige.split("\n").length).toBeLessThanOrEqual(3);
    expect((await frage("Was ist dringend", "get")).r.befehl).toBe("dringend");
    expect((await frage(`Notiz Testnotiz ${m}`, "get")).status).toBe(405);
    const notiz = await frage(`Notiz Testnotiz Watch ${m}`);
    expect(notiz.r).toMatchObject({ ok: true, befehl: "notiz" });
    await expect.poll(async () => (await sql<{ n: number }>("select count(*)::int as n from tasks where tenant_id = $1 and title like $2", [T, `%Testnotiz Watch ${m}%`]))[0].n).toBe(1);
    const unklar = await frage("Blumen");
    expect(unklar.status).toBe(422);
    expect(unklar.r.zeige).toContain("Wie läuft's");
    expect((await page.request.post("/api/mobil/watch/frage", { data: { text: "Wie läuft's" }, headers: { Authorization: "Bearer mk_falsch_00000000000000000000" } })).status()).toBe(401);
  });

  test("Familienkalender: „To do Ina: …“ wird beim Abgleich zur wichtigen Aufgabe von Ina – einmal, erledigt bleibt erledigt", async ({ page }) => {
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const [{ id: INH }] = await sql<{ id: string }>("select id from users where email = 'inhaber'");
    const morgen = plus(berlin(new Date()), 1);
    await sql(
      "insert into calendar_events (tenant_id, calendar_name, uid, title, starts_at, ends_at, all_day, day) values ($1, 'Familie (privat)', $2, $3, ($4::date + time '08:30') at time zone 'Europe/Berlin', ($4::date + time '09:00') at time zone 'Europe/Berlin', false, $4::date)",
      [T, `fk-todo-${m}`, `To do Ina : Sachen Tafel herrichten ${m}`, morgen],
    );
    const aufgabe = async () => (await sql<{ title: string; priority: string; status: string; assignee_id: string | null; due_date: string; notes: string }>("select title, priority, status, assignee_id, due_date::text, notes from tasks where tenant_id = $1 and system_key like $2", [T, `kalender-todo:fk-todo-${m}|%`]));
    await anmelden(page, "inhaber");
    // Jede Änderung an Aufgaben stößt den Kalender-Abgleich an (wie im Betrieb zusätzlich alle 14 Min.)
    const abgleich = async (titel: string) => {
      await page.goto("/");
      await page.getByTestId("add-task-toggle").first().click();
      await page.locator("form.add-task-form #title").first().fill(titel);
      await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator("form.add-task-form button[type=submit]").first().click()]);
    };
    await abgleich(`Anstoß ${m}`);
    await expect.poll(async () => (await aufgabe()).length, { timeout: 20_000 }).toBe(1);
    const [a] = await aufgabe();
    expect(a).toMatchObject({ title: `Sachen Tafel herrichten ${m}`, priority: "critical", status: "open", assignee_id: INH });
    expect(a.notes).toContain("Familie (privat)");
    // Zweiter Abgleich: keine zweite Aufgabe; erledigt bleibt erledigt
    await sql("update tasks set status = 'done', completed_at = now() where tenant_id = $1 and system_key like $2", [T, `kalender-todo:fk-todo-${m}|%`]);
    await abgleich(`Anstoß 2 ${m}`);
    await page.waitForTimeout(2000);
    const nachher = await aufgabe();
    expect(nachher).toHaveLength(1);
    expect(nachher[0].status).toBe("done");
  });
});
