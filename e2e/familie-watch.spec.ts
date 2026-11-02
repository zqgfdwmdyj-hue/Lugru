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
});
