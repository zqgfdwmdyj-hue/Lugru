import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error – Programm des Druckagenten (JavaScript ohne Typen, läuft ohne Abhängigkeiten auf dem Arbeits-PC)
import { Agent, configLesen, modellAusName, neuer, shellyUrl, statusLesen, VERSION, windowsZustand } from "../druckagent/lugru-druckagent.mjs";

// Druckagent-Programm gegen nachgebaute Gegenstellen: Seller-System (HTTP), Drucker (TCP 9100), Shelly-Steckdose.
// Nur erfundene Werte.

const TOKEN = `da_${"T".repeat(43)}`;

function status(o: { modell?: number; f1?: number; f2?: number; breite?: number; art?: number; typ?: number } = {}) {
  const b = new Uint8Array(32);
  b[0] = 0x80;
  b[4] = o.modell ?? 0x38;
  b[8] = o.f1 ?? 0;
  b[9] = o.f2 ?? 0;
  b[10] = o.breite ?? 62;
  b[11] = o.art ?? 0x0b;
  b[17] = 29;
  b[18] = o.typ ?? 0;
  return b;
}

describe("Brother-Status, Windows-Zustand, Hilfsfunktionen", () => {
  it("Statusbytes → Zustand", () => {
    expect(statusLesen(status())).toMatchObject({ modell: "QL-800", zustand: "bereit", medienBreite: 62, medienArt: "etikett", fehler: [] });
    expect(statusLesen(status({ f1: 0x02 }))).toMatchObject({ zustand: "papier_leer", fehler: ["Etikettenrolle leer"] });
    expect(statusLesen(status({ f1: 0x01 }))).toMatchObject({ zustand: "papier_leer" });
    expect(statusLesen(status({ f2: 0x10 }))).toMatchObject({ zustand: "deckel_offen", fehler: ["Deckel offen"] });
    expect(statusLesen(status({ f1: 0x04 }))).toMatchObject({ zustand: "fehler" });
    expect(statusLesen(status({ modell: 0x43, breite: 102 }))).toMatchObject({ modell: "QL-1100", medienBreite: 102 });
    expect(statusLesen(new Uint8Array(10))).toBeNull();
  });
  it("Windows (WMI) → Zustand", () => {
    expect(windowsZustand({ DetectedErrorState: 4 })).toEqual({ zustand: "papier_leer", fehler: ["Etikettenrolle leer"] });
    expect(windowsZustand({ DetectedErrorState: 7 })).toMatchObject({ zustand: "deckel_offen" });
    expect(windowsZustand({ WorkOffline: true })).toMatchObject({ zustand: "aus" });
    expect(windowsZustand({ DetectedErrorState: 2, PrinterStatus: 3 })).toEqual({ zustand: "bereit", fehler: [] });
  });
  it("Shelly Gen1/Gen2, Versionen, Modellnamen", () => {
    expect(shellyUrl({ ip: "192.0.2.10" }, true)).toBe("http://192.0.2.10/relay/0?turn=on");
    expect(shellyUrl({ ip: "192.0.2.10", typ: "gen2" }, false)).toBe("http://192.0.2.10/rpc/Switch.Set?id=0&on=false");
    expect(shellyUrl({}, true)).toBeNull();
    expect(neuer("1.0.1", "1.0.0")).toBe(true);
    expect(neuer("1.0.0", "1.0.0")).toBe(false);
    expect(neuer("0.9.9", "1.0.0")).toBe(false);
    expect(modellAusName("Brother QL-1100")).toBe("QL-1100");
    expect(modellAusName("Brother QL-820NWB Treiber")).toBe("QL-820NWB");
  });
  it("Konfiguration: server + Gerätetoken Pflicht", async () => {
    const o = await mkdtemp(path.join(tmpdir(), "da-cfg-"));
    const d = path.join(o, "config.json");
    await writeFile(d, JSON.stringify({ server: "https://seller.example.com", token: TOKEN }));
    expect(configLesen(d).server).toBe("https://seller.example.com");
    await writeFile(d, JSON.stringify({ server: "seller.example.com", token: TOKEN }));
    expect(() => configLesen(d)).toThrow(/server/);
    await writeFile(d, JSON.stringify({ server: "https://seller.example.com", token: "mk_falsch" }));
    expect(() => configLesen(d)).toThrow(/Gerätetoken/);
    await rm(o, { recursive: true, force: true });
  });
});

describe("Agent gegen nachgebautes Seller-System, Drucker und Shelly", () => {
  const daten = Buffer.from([0x1b, 0x40, 1, 2, 3, 0x1a]);
  const sha = createHash("sha256").update(daten).digest("hex");
  let server: http.Server, drucker: net.Server, shelly: http.Server;
  let basis = "", druckerPort = 0, shellyPort = 0;
  const empfangen: Buffer[] = [];
  const meldungen: { id: string; status: string; meldung: string | null }[] = [];
  const shellyAufrufe: string[] = [];
  const heartbeats: Record<string, unknown>[] = [];
  const uploads: string[] = [];
  let warteschlange: Record<string, unknown>[] = [];
  let widerrufen = false;
  let einstellungen: Record<string, unknown> = {};

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.headers.authorization !== `Bearer ${TOKEN}` || widerrufen) {
        res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ abgemeldet: true }));
        return;
      }
      const teile: Buffer[] = [];
      req.on("data", (c) => teile.push(c));
      req.on("end", () => {
        const body = Buffer.concat(teile);
        const u = new URL(req.url!, "http://x");
        if (u.pathname === "/api/druckagent/heartbeat") {
          heartbeats.push(JSON.parse(body.toString()));
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, einstellungen }));
        } else if (u.pathname === "/api/druckagent/auftrag") {
          const a = warteschlange.shift();
          if (!a) res.writeHead(204).end();
          else res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ auftrag: a }));
        } else if (/\/daten$/.test(u.pathname)) {
          res.writeHead(200, { "content-type": "application/octet-stream" }).end(daten);
        } else if (u.pathname.startsWith("/api/druckagent/auftrag/")) {
          const j = JSON.parse(body.toString());
          meldungen.push({ id: u.pathname.split("/")[4], status: j.status, meldung: j.meldung });
          res.writeHead(200, { "content-type": "application/json" }).end("{}");
        } else if (u.pathname === "/api/druckagent/upload") {
          uploads.push(decodeURIComponent(String(req.headers["x-dateiname"])));
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
        } else if (u.pathname === "/api/druckagent/version") {
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ version: VERSION, sha256: "x" }));
        } else res.writeHead(404).end();
      });
    });
    drucker = net.createServer((s) => {
      const teile: Buffer[] = [];
      s.on("data", (c: Buffer) => teile.push(c));
      s.on("end", () => teile.length && empfangen.push(Buffer.concat(teile)));
    });
    shelly = http.createServer((req, res) => {
      shellyAufrufe.push(req.url!);
      res.writeHead(200, { "content-type": "application/json" }).end('{"was_on":false}');
    });
    await Promise.all([new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok)), new Promise<void>((ok) => drucker.listen(0, "127.0.0.1", ok)), new Promise<void>((ok) => shelly.listen(0, "127.0.0.1", ok))]);
    basis = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
    druckerPort = (drucker.address() as net.AddressInfo).port;
    shellyPort = (shelly.address() as net.AddressInfo).port;
  });
  afterAll(async () => {
    await Promise.all([server, drucker, shelly].map((s) => new Promise((ok) => s.close(ok))));
  });

  const neuerAgent = (extra: Record<string, unknown> = {}) => {
    const log: string[] = [];
    const a = new Agent({ server: basis, token: TOKEN, drucker: [{ name: "Brother QL-800", modell: "QL-800", anschluss: `tcp:127.0.0.1:${druckerPort}` }], ...extra }, { log: (t: string) => log.push(t), ordner: tmpdir() });
    return { a, log };
  };

  it("Heartbeat: Gerät, Betriebssystem, Version, letzter Start, Druckerliste mit Zustand", async () => {
    const { a } = neuerAgent();
    await a.heartbeat();
    const hb = heartbeats.at(-1)!;
    expect(hb).toMatchObject({ version: VERSION, drucker: [{ name: "Brother QL-800", modell: "QL-800", zustand: "bereit" }] });
    expect(typeof hb.geraet).toBe("string");
    expect(typeof hb.os).toBe("string");
    expect(new Date(String(hb.systemStart)).getTime()).toBeLessThan(Date.now());
  });

  it("Auftrag abholen → Druckdaten (Prüfsumme) → an den Drucker → „gedruckt“", async () => {
    const { a } = neuerAgent();
    await a.heartbeat();
    warteschlange = [{ id: "j1", titel: "FNSKU-Etikett", drucker: "QL-800", anzahl: 3, sha256: sha }];
    const auftrag = await a.abholen();
    expect(auftrag.id).toBe("j1");
    await a.auftragAusfuehren(auftrag);
    await new Promise((ok) => setTimeout(ok, 100));
    expect(empfangen.at(-1)).toEqual(daten);
    expect(meldungen.at(-1)).toMatchObject({ id: "j1", status: "gedruckt" });
    expect(a.letzterDruck).not.toBeNull();
    expect(await a.abholen()).toBeNull(); // 204 = nichts zu tun
  });

  it("Falsche Prüfsumme → Fehler, nichts gedruckt", async () => {
    const { a } = neuerAgent();
    await a.heartbeat();
    const vorher = empfangen.length;
    await a.auftragAusfuehren({ id: "j2", drucker: "QL-800", sha256: "0".repeat(64) });
    expect(empfangen.length).toBe(vorher);
    expect(meldungen.at(-1)).toMatchObject({ id: "j2", status: "fehler", meldung: "Druckdaten beschädigt (Prüfsumme)" });
  });

  it("Drucker nicht erreichbar → Auftrag bleibt „wartet“ (nicht verloren)", async () => {
    const { a } = neuerAgent({ drucker: [{ name: "Brother QL-1100", modell: "QL-1100", anschluss: "tcp:127.0.0.1:1" }] });
    await a.heartbeat();
    expect(heartbeats.at(-1)).toMatchObject({ drucker: [{ modell: "QL-1100", zustand: "aus", fehler: ["Netzwerkdrucker nicht erreichbar"] }] });
    await a.auftragAusfuehren({ id: "j3", drucker: "QL-1100", sha256: sha });
    expect(meldungen.at(-1)).toMatchObject({ id: "j3", status: "wartet" });
    await a.auftragAusfuehren({ id: "j4", drucker: "QL-800", sha256: sha });
    expect(meldungen.at(-1)).toMatchObject({ id: "j4", status: "wartet", meldung: "Drucker QL-800 am Agenten nicht gefunden" });
  }, 15_000);

  it("Shelly: vor dem Druck einschalten, nach Leerlauf wieder aus; nicht erreichbar → „wartet“ mit Meldung", async () => {
    einstellungen = { shelly: { "QL-800": { ip: `127.0.0.1:${shellyPort}`, typ: "gen2" } }, leerlaufAusMin: 0.001 };
    const { a } = neuerAgent();
    await a.heartbeat(); // Einstellungen (Shelly-IP) kommen mit der Antwort, der nächste Heartbeat meldet „Shelly: ja“
    await a.heartbeat();
    expect(heartbeats.at(-1)).toMatchObject({ drucker: [{ shelly: true }] });
    await a.auftragAusfuehren({ id: "j5", drucker: "QL-800", sha256: sha });
    expect(shellyAufrufe[0]).toBe("/rpc/Switch.Set?id=0&on=true");
    expect(meldungen.at(-1)).toMatchObject({ id: "j5", status: "gedruckt" });
    await new Promise((ok) => setTimeout(ok, 300));
    expect(shellyAufrufe.at(-1)).toBe("/rpc/Switch.Set?id=0&on=false"); // Leerlauf (hier 0,06 s statt 10 Min.)

    einstellungen = { shelly: { "QL-800": { ip: "127.0.0.1:1", typ: "gen1" } } };
    await a.heartbeat();
    await a.auftragAusfuehren({ id: "j6", drucker: "QL-800", sha256: sha });
    expect(meldungen.at(-1)).toMatchObject({ id: "j6", status: "wartet", meldung: "Shelly nicht erreichbar" });
    for (const t of a.leerlauf.values()) clearTimeout(t);
    einstellungen = {};
  }, 15_000);

  it("Überwachter Ordner: PDF hochladen und nach „verarbeitet“ verschieben", async () => {
    const o = await mkdtemp(path.join(tmpdir(), "da-ordner-"));
    await writeFile(path.join(o, "Rechnung-Test.pdf"), "%PDF-1.4 test");
    await writeFile(path.join(o, "notiz.txt"), "bleibt");
    await writeFile(path.join(o, "frisch.pdf"), "%PDF-1.4 wird noch geschrieben");
    const alt = new Date(Date.now() - 60_000);
    await utimes(path.join(o, "Rechnung-Test.pdf"), alt, alt);
    einstellungen = { ordner: { pfad: o } };
    const { a } = neuerAgent();
    await a.heartbeat();
    await a.ordnerPruefen();
    expect(uploads).toEqual(["Rechnung-Test.pdf"]);
    expect((await readdir(o)).sort()).toEqual(["frisch.pdf", "notiz.txt", "verarbeitet"]);
    expect((await readdir(path.join(o, "verarbeitet")))[0]).toMatch(/^\d{4}-\d{2}-\d{2}_Rechnung-Test\.pdf$/);
    einstellungen = {};
    await rm(o, { recursive: true, force: true });
  });

  it("Update-Prüfung: gleiche Version → nichts installieren", async () => {
    const { a } = neuerAgent();
    expect(await a.updatePruefen()).toBe(false);
  });

  it("Dauerbetrieb: Schleife holt wartende Aufträge, druckt, meldet; Stoppen beendet sauber", async () => {
    const { a } = neuerAgent();
    const lauf = a.start();
    warteschlange = [{ id: "j7", titel: "Dauerbetrieb", drucker: "QL-800", anzahl: 1, sha256: sha }];
    await expect.poll(() => meldungen.find((x) => x.id === "j7")?.status, { timeout: 15_000 }).toBe("gedruckt");
    a.stoppen();
    await lauf; // lange Abfrage wird abgebrochen
  }, 20_000);

  it("Token widerrufen → Agent „abgemeldet“", async () => {
    const { a } = neuerAgent();
    widerrufen = true;
    await expect(a.heartbeat()).rejects.toThrow(/abgemeldet/);
    expect(a.abgemeldet).toBe(true);
    widerrufen = false;
  });
});
