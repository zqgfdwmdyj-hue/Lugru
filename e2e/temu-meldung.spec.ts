// Wunsch 14.11.: Temu-Aufträge wie bei eBay automatisch als versendet melden – auch Briefsendungen. Temu verlangt
// immer eine Sendungsnummer: bei der Warensendung (Internetmarke) geht die Frankier-ID mit, ohne ID (CSV-Weg) wird
// sie nachgetragen. Fehlgeschlagene Meldungen zählen Versuche (automatisch alle 30 Min., höchstens 6×). Steht die
// Bestellung bei Temu schon auf „Versandt“, ist die Meldung erledigt. Temu läuft gegen den Testnachbau, alles erfunden.
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { E2E_ENV, TD } from "./env";
import { aktion, anmelden, expect, marke, sql, test } from "./helfer";

function versiegeln(plain: string) {
  const key = createHash("sha256").update(`integrations:${E2E_ENV.APP_SECRET}`).digest();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
type TemuNb = { status: Record<string, number>; versand: { sn: string; carrierId: number | null; trackingNumber: string }[] };
const temu = (b: unknown) => fetch(`${TD}/__temu`, { method: "POST", body: JSON.stringify(b) });
const temuStand = () => fetch(`${TD}/__temu`).then((r) => r.json() as Promise<TemuNb>);

test.describe("Temu – Versand melden mit Sendungsnummer bzw. Frankier-ID", () => {
  test("Warensendung mit Frankier-ID automatisch; ohne ID nachtragen; Störung → Versuch gezählt, erneut gemeldet; bei Temu schon versandt → erledigt", async ({ page }) => {
    test.setTimeout(120_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const hatte = (await sql("select 1 from integrations where tenant_id = $1 and provider = 'temu'", [T])).length > 0;
    if (!hatte) await sql("insert into integrations (tenant_id, provider, label, config, secret_encrypted) values ($1, 'temu', 'Test', $2::jsonb, $3)", [T, JSON.stringify({ region: "eu" }), versiegeln(JSON.stringify({ appKey: "test-temu-app", appSecret: "test-temu-secret", accessToken: "test-temu-token" }))]);
    const sn = (k: number) => `PO-TEST-${m}-${k}`;
    await temu({ zuruecksetzen: true, bestellungen: [sn(1), sn(2), sn(3)], status: { [sn(4)]: 4 } });
    const auftrag = async (k: number, status: string, carrier: string, tracking: string | null, fehler: string | null = null) =>
      (
        await sql<{ id: string }>(
          "insert into orders (tenant_id, channel, external_id, order_date, fulfillment, status, shipped_at, buyer_name, total, tracking_number, carrier, tracking_upload_error, ship_to) values ($1, 'temu', $2, now() - interval '1 day', 'FBM', $3, case when $3 = 'shipped' then now() - interval '2 hours' end, 'Testkundin (erfunden)', 12.9, $4, $5, $6, $7::jsonb) returning id",
          [T, sn(k), status, tracking, carrier, fehler, JSON.stringify({ name1: "Testkundin (erfunden)", street: "Musterweg", houseNo: "1", zip: "12345", city: "Musterstadt", country: "DE" })],
        )
      )[0].id;
    // 1: Warensendung über die Internetmarke gekauft → Frankier-ID liegt am Paket
    const a1 = await auftrag(1, "label_created", "Deutsche Post", null);
    await sql("insert into parcels (tenant_id, order_id, carrier, product, weight_kg, tracking_number, status) values ($1, $2, 'Deutsche Post', 'Warensendung 1', 0.3, $3, 'created')", [T, a1, `A0TEST${m}01`]);
    // 2: Warensendung per CSV-Datei → keine Frankier-ID im System
    const a2 = await auftrag(2, "label_created", "Deutsche Post", null);
    // 3: DHL mit Sendungsnummer, Temu einmal gestört
    const a3 = await auftrag(3, "label_created", "DHL", `00340434TEST${m}3`);
    // 4: schon versendet, Meldung offen – bei Temu inzwischen im Seller Center nachgetragen (Status „Versandt“)
    const a4 = await auftrag(4, "shipped", "DHL", `00340434TEST${m}4`, "Temu: Testfehler von gestern");
    const lies = async (id: string) => (await sql<{ status: string; tracking_number: string | null; carrier: string | null; tracking_uploaded_at: Date | null; tracking_upload_error: string | null; tracking_upload_versuche: number }>("select status, tracking_number, carrier, tracking_uploaded_at, tracking_upload_error, tracking_upload_versuche from orders where id = $1", [id]))[0];
    const versendet = async (id: string) => {
      await page.goto(`/auftraege/${id}`);
      await Promise.all([aktion(page), page.getByRole("button", { name: "Als versendet markieren & melden" }).click()]);
    };
    try {
      await anmelden(page, "inhaber");

      // 1: automatisch mit Frankier-ID als Sendungsnummer, Versanddienstleister „Deutsche Post“
      await versendet(a1);
      await expect.poll(async () => (await lies(a1)).tracking_uploaded_at !== null).toBe(true);
      expect((await temuStand()).versand.find((v) => v.sn === sn(1))).toEqual({ sn: sn(1), carrierId: 22, trackingNumber: `A0TEST${m}01` });
      await page.reload();
      await expect(page.getByTestId("meldung-status")).toContainText("An Temu gemeldet");

      // 2: ohne Frankier-ID → klare Meldung + Feld; Nummer unter dem Matrixcode nachtragen → gemeldet
      await versendet(a2);
      await expect.poll(async () => (await lies(a2)).tracking_upload_error ?? "").toContain("Temu verlangt eine Sendungsnummer");
      await page.reload();
      await expect(page.getByTestId("meldung-fehler")).toContainText("Nummer unter dem Matrixcode");
      await expect(page.getByTestId("meldung-versuche")).toContainText("1× versucht");
      await expect(page.getByTestId("meldung-nachtragen")).toContainText("Frankier-ID");
      await page.getByTestId("meldung-nummer").fill(`A0 TEST ${m} 02`);
      await Promise.all([aktion(page), page.getByTestId("meldung-nachtragen-los").click()]);
      await expect.poll(async () => (await lies(a2)).tracking_uploaded_at !== null).toBe(true);
      expect(await lies(a2)).toMatchObject({ tracking_number: `A0TEST${m}02`, carrier: "Deutsche Post", tracking_upload_error: null, tracking_upload_versuche: 0 });
      expect((await temuStand()).versand.filter((v) => v.sn === sn(2)).map((v) => v.trackingNumber)).toEqual([`A0TEST${m}02`]); // ohne Nummer gar nicht erst an Temu

      // 3: Temu gestört → Meldung offen, 1 Versuch (wird automatisch wiederholt); „Erneut melden“ → gemeldet
      await temu({ stoerung: 1 });
      await versendet(a3);
      await expect.poll(async () => (await lies(a3)).tracking_upload_versuche).toBe(1);
      await page.reload();
      await expect(page.getByTestId("meldung-fehler")).toContainText("vorübergehend nicht erreichbar");
      await expect(page.getByTestId("meldung-versuche")).toContainText("wird alle 30 Min. automatisch wiederholt");
      await page.goto("/auftraege?ansicht=fehler");
      await expect(page.locator("tr").filter({ hasText: sn(3) })).toContainText("Meldung offen · 1× versucht");
      await page.goto(`/auftraege/${a3}`);
      await Promise.all([aktion(page), page.getByRole("button", { name: "Erneut melden" }).click()]);
      await expect.poll(async () => (await lies(a3)).tracking_uploaded_at !== null).toBe(true);
      expect((await temuStand()).versand.filter((v) => v.sn === sn(3)).map((v) => [v.carrierId, v.trackingNumber])).toEqual([[11, `00340434TEST${m}3`], [11, `00340434TEST${m}3`]]);
      expect((await lies(a3)).tracking_upload_versuche).toBe(0);

      // 4: bei Temu schon „Versandt“ → keine zweite Meldung, offene Meldung erledigt
      await page.goto(`/auftraege/${a4}`);
      await Promise.all([aktion(page), page.getByRole("button", { name: "Erneut melden" }).click()]);
      await expect.poll(async () => (await lies(a4)).tracking_uploaded_at !== null).toBe(true);
      expect((await lies(a4)).tracking_upload_error).toBeNull();
      expect((await temuStand()).versand.some((v) => v.sn === sn(4))).toBe(false);
    } finally {
      await sql("delete from parcels where tenant_id = $1 and order_id = any($2::uuid[])", [T, [a1, a2, a3, a4]]);
      await sql("delete from orders where tenant_id = $1 and external_id like $2", [T, `PO-TEST-${m}-%`]);
      if (!hatte) await sql("delete from integrations where tenant_id = $1 and provider = 'temu'", [T]);
      await temu({ zuruecksetzen: true });
    }
  });
});
