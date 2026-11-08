#!/usr/bin/env node
// lugru-druckagent – holt Druckaufträge beim Seller-System ab und druckt auf Brother QL (USB, Windows-Spooler „RAW“ oder Netz).
// Eine Datei, nur Node-Bordmittel (Node ≥ 18). Läuft als Windows-Dienst (WinSW) oder Linux-Dienst (systemd/Docker).
// Verbindung nur nach außen: langes Abfragen („Long-Polling“, 25 s) statt WebSocket, sonst alle 10 s; kein offener Port.
// Gerätetoken und Shelly-IPs stehen nur hier in der config.json bzw. im Seller-System unter Einstellungen → Drucker.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const VERSION = "1.0.0";
const HEARTBEAT_MS = 30_000;
const FALLBACK_MS = 10_000;
const LANGPOLL_S = 25;
const BEREIT_NORMAL_S = 20;
const BEREIT_MAX_S = 30;

// ---- Brother-Status (32 Byte, Antwort auf ESC i S) ----------------------------------------------------------------------

export const MODELLE = { 0x38: "QL-800", 0x39: "QL-810W", 0x41: "QL-820NWB", 0x43: "QL-1100", 0x44: "QL-1110NWB", 0x45: "QL-1115NWB" };

/** Statusbytes auswerten → Zustand für das Seller-System (bereit, papier_leer, deckel_offen, fehler, aus). */
export function statusLesen(b) {
  if (!b || b.length < 32 || b[0] !== 0x80) return null;
  const f1 = b[8];
  const f2 = b[9];
  const fehler = [];
  if (f1 & 0x01) fehler.push("kein Etikett eingelegt");
  if (f1 & 0x02) fehler.push("Etikettenrolle leer");
  if (f1 & 0x04) fehler.push("Schneidmesser blockiert");
  if (f1 & 0x20) fehler.push("Drucker ausgeschaltet");
  if (f2 & 0x01) fehler.push("falsches Etikett");
  if (f2 & 0x04) fehler.push("Übertragungsfehler");
  if (f2 & 0x10) fehler.push("Deckel offen");
  if (f2 & 0x40) fehler.push("Etikett wird nicht eingezogen");
  if (f2 & 0x80) fehler.push("Systemfehler");
  const zustand = f1 & 0x20 || b[18] === 0x04 ? "aus" : f2 & 0x10 ? "deckel_offen" : f1 & 0x03 ? "papier_leer" : fehler.length ? "fehler" : "bereit";
  return { modell: MODELLE[b[4]] ?? `Brother 0x${b[4].toString(16)}`, medienBreite: b[10] || null, medienLaenge: b[17] || null, medienArt: b[11] === 0x0a ? "endlos" : b[11] === 0x0b ? "etikett" : null, zustand, fehler };
}

const STATUS_ANFRAGE = Buffer.concat([Buffer.alloc(200, 0), Buffer.from([0x1b, 0x40, 0x1b, 0x69, 0x53])]);

// ---- Windows: Drucker über den Spooler („RAW“) und WMI-Status ------------------------------------------------------------

const RAW_PS1 = `param([string]$Drucker, [string]$Datei)
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class LugruRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] public static extern int StartDocPrinter(IntPtr h, int l, DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
  public static void Senden(string drucker, byte[] daten) {
    IntPtr h; if (!OpenPrinter(drucker, out h, IntPtr.Zero)) throw new Exception("Drucker nicht gefunden: " + drucker);
    try { var di = new DOCINFO(); di.pDocName = "lugru-druckagent"; di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) throw new Exception("StartDocPrinter " + Marshal.GetLastWin32Error());
      StartPagePrinter(h); int w; if (!WritePrinter(h, daten, daten.Length, out w) || w != daten.Length) throw new Exception("WritePrinter " + Marshal.GetLastWin32Error());
      EndPagePrinter(h); EndDocPrinter(h); } finally { ClosePrinter(h); }
  }
}
"@
[LugruRaw]::Senden($Drucker, [System.IO.File]::ReadAllBytes($Datei))
`;

/** WMI-Zustand eines Windows-Druckers → Zustand (DetectedErrorState/PrinterStatus laut Win32_Printer). */
export function windowsZustand(p) {
  const e = Number(p.DetectedErrorState ?? 0);
  if (p.WorkOffline || e === 9 || Number(p.PrinterStatus) === 7) return { zustand: "aus", fehler: ["offline"] };
  if (e === 4) return { zustand: "papier_leer", fehler: ["Etikettenrolle leer"] };
  if (e === 7) return { zustand: "deckel_offen", fehler: ["Deckel offen"] };
  if (e === 8) return { zustand: "fehler", fehler: ["Papierstau"] };
  return { zustand: "bereit", fehler: [] };
}

function ps(befehl, args = [], ms = 30_000) {
  return new Promise((ok, nein) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", ...(args.length ? args : ["-Command", befehl])], { timeout: ms, windowsHide: true, maxBuffer: 4 << 20 }, (err, out, errOut) => (err ? nein(new Error(String(errOut || err.message).trim().slice(0, 300))) : ok(String(out)))));
}

async function windowsDrucker() {
  const out = await ps("Get-CimInstance Win32_Printer | Where-Object { $_.Name -match 'QL' -or $_.DriverName -match 'Brother QL' } | Select-Object Name,DriverName,PortName,PrinterStatus,DetectedErrorState,WorkOffline | ConvertTo-Json -Compress");
  const roh = out.trim() ? JSON.parse(out) : [];
  return (Array.isArray(roh) ? roh : [roh]).map((p) => ({ name: p.Name, modell: modellAusName(`${p.Name} ${p.DriverName ?? ""}`), anschluss: `windows:${p.Name}`, ...windowsZustand(p) }));
}

// ---- Linux: /dev/usb/lp* direkt (Status lesen + Rasterdaten schreiben) -------------------------------------------------

async function linuxStatus(geraet, ms = 3000) {
  const fd = await fsp.open(geraet, "r+");
  try {
    await fd.write(STATUS_ANFRAGE);
    const buf = Buffer.alloc(32);
    const lesen = fd.read(buf, 0, 32, null).then((r) => (r.bytesRead >= 32 ? buf : null));
    return await Promise.race([lesen, new Promise((ok) => setTimeout(() => ok(null), ms))]);
  } finally {
    await fd.close().catch(() => undefined);
  }
}

async function linuxDrucker() {
  const geraete = (await fsp.readdir("/dev/usb").catch(() => [])).filter((d) => /^lp\d+$/.test(d)).map((d) => `/dev/usb/${d}`);
  const liste = [];
  for (const g of geraete) {
    const st = statusLesen(await linuxStatus(g).catch(() => null));
    const seriennummer = await fsp.readFile(`/sys/class/usbmisc/${path.basename(g)}/device/../serial`, "utf8").then((s) => s.trim()).catch(() => null);
    liste.push({ name: st?.modell ?? path.basename(g), modell: st?.modell ?? null, anschluss: `usb:${g}`, seriennummer, medienBreite: st?.medienBreite ?? null, zustand: st?.zustand ?? "unbekannt", fehler: st?.fehler ?? [] });
  }
  return liste;
}

export function modellAusName(t) {
  const m = /QL-?\s?(\d{3,4})([A-Z]*)/i.exec(String(t));
  return m ? `QL-${m[1]}${m[2].toUpperCase()}` : null;
}

// ---- Druckerliste, Senden ----------------------------------------------------------------------------------------------

/** Konfigurierte Drucker (config.json) mit gefundenen zusammenführen; konfigurierte gehen vor. */
export async function druckerFinden(cfg, plattform = process.platform) {
  const gefunden = plattform === "win32" ? await windowsDrucker().catch(() => []) : plattform === "linux" ? await linuxDrucker().catch(() => []) : [];
  const liste = [];
  for (const k of cfg.drucker ?? []) {
    const g = gefunden.find((x) => (k.anschluss && x.anschluss === k.anschluss) || (k.modell && x.modell === k.modell));
    let zustand = g?.zustand ?? (k.anschluss?.startsWith("tcp:") ? "unbekannt" : "aus");
    let fehler = g?.fehler ?? [];
    if (k.anschluss?.startsWith("tcp:")) ({ zustand, fehler } = await tcpErreichbar(k.anschluss).then((ok) => (ok ? { zustand: "bereit", fehler: [] } : { zustand: "aus", fehler: ["Netzwerkdrucker nicht erreichbar"] })));
    liste.push({ ...g, ...k, name: k.name ?? g?.name ?? k.modell, zustand, fehler });
  }
  for (const g of gefunden) if (!liste.some((x) => x.anschluss === g.anschluss || (x.modell && x.modell === g.modell))) liste.push(g);
  return liste;
}

function tcpErreichbar(anschluss, ms = 2000) {
  const [, host, port] = anschluss.split(":");
  return new Promise((ok) => {
    const s = net.connect({ host, port: Number(port || 9100) });
    const fertig = (v) => (s.destroy(), ok(v));
    s.setTimeout(ms, () => fertig(false));
    s.on("connect", () => fertig(true));
    s.on("error", () => fertig(false));
  });
}

async function senden(drucker, daten, arbeitsordner) {
  const a = drucker.anschluss ?? "";
  if (a.startsWith("usb:")) return fsp.writeFile(a.slice(4), daten);
  if (a.startsWith("tcp:")) {
    const [, host, port] = a.split(":");
    return new Promise((ok, nein) => {
      const s = net.connect({ host, port: Number(port || 9100) }, () => s.end(daten));
      s.setTimeout(30_000, () => (s.destroy(), nein(new Error("Zeitüberschreitung Netzwerkdrucker"))));
      s.on("close", (err) => (err ? nein(new Error("Verbindung abgebrochen")) : ok()));
      s.on("error", nein);
    });
  }
  if (a.startsWith("windows:")) {
    const skript = path.join(arbeitsordner, "raw-drucken.ps1");
    if (!fs.existsSync(skript)) await fsp.writeFile(skript, RAW_PS1, "utf8");
    const datei = path.join(os.tmpdir(), `lugru-${Date.now()}.bin`);
    await fsp.writeFile(datei, daten);
    try {
      await ps("", ["-File", skript, "-Drucker", a.slice(8), "-Datei", datei], 60_000);
    } finally {
      await fsp.unlink(datei).catch(() => undefined);
    }
    return;
  }
  throw new Error(`Anschluss unbekannt: ${a || "–"} (usb:/dev/usb/lp0, windows:Druckername oder tcp:IP:9100)`);
}

// ---- Shelly-Steckdose (Gen1 /relay/0, Gen2 /rpc/Switch.Set) -------------------------------------------------------------

export function shellyUrl(s, an) {
  if (!s?.ip) return null;
  return s.typ === "gen2" ? `http://${s.ip}/rpc/Switch.Set?id=0&on=${an ? "true" : "false"}` : `http://${s.ip}/relay/0?turn=${an ? "on" : "off"}`;
}

async function shellySchalten(s, an) {
  const url = shellyUrl(s, an);
  if (!url) return;
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!r || !r.ok) throw new Error("Shelly nicht erreichbar");
}

// ---- Seller-System ------------------------------------------------------------------------------------------------------

export class Agent {
  constructor(cfg, o = {}) {
    this.cfg = cfg;
    this.ordner = o.ordner ?? process.cwd();
    this.log = o.log ?? ((t) => console.log(`${new Date().toISOString()} ${t}`));
    this.fetch = o.fetch ?? fetch;
    this.drucker = [];
    this.letzterDruck = null;
    this.einstellungen = {};
    this.abgemeldet = false;
    this.leerlauf = new Map();
    this.laeuft = false;
    this.updateProtokoll = [];
  }
  url(p) {
    return `${String(this.cfg.server).replace(/\/$/, "")}${p}`;
  }
  async anfrage(p, init = {}) {
    const r = await this.fetch(this.url(p), { ...init, headers: { authorization: `Bearer ${this.cfg.token}`, "x-agent-version": VERSION, ...(init.headers ?? {}) } });
    if (r.status === 401 || r.status === 403) {
      this.abgemeldet = true;
      throw new Error("abgemeldet (Token widerrufen oder Agent deaktiviert)");
    }
    return r;
  }
  shellyFuer(d) {
    return d.shelly ?? this.einstellungen?.shelly?.[d.modell ?? d.name] ?? null;
  }
  async heartbeat() {
    this.drucker = await druckerFinden(this.cfg);
    const body = { geraet: os.hostname(), os: `${os.type()} ${os.release()} (${process.platform})`, version: VERSION, systemStart: new Date(Date.now() - os.uptime() * 1000).toISOString(), letzterDruck: this.letzterDruck, drucker: this.drucker.map((d) => ({ name: d.name, modell: d.modell, seriennummer: d.seriennummer ?? null, medienBreite: d.medienBreite ?? null, zustand: d.zustand, fehler: d.fehler ?? [], shelly: !!this.shellyFuer(d), autoAusAus: d.autoAusAus ?? null })), medien: this.cfg.medien ?? [], updates: this.updateProtokoll.splice(0) };
    const r = await this.anfrage("/api/druckagent/heartbeat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    this.einstellungen = j.einstellungen ?? {};
    return j;
  }
  async statusMelden(id, status, meldung = null) {
    await this.anfrage(`/api/druckagent/auftrag/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, meldung }) }).catch((e) => this.log(`Status ${id}: ${e.message}`));
  }
  /** Drucker einschalten (Shelly) und bis zu 30 s warten, bis er „bereit“ meldet. */
  async bereitMachen(d) {
    const s = this.shellyFuer(d);
    if (s) {
      clearTimeout(this.leerlauf.get(d.name));
      await shellySchalten(s, true);
    }
    const start = Date.now();
    for (;;) {
      const neu = (await druckerFinden(this.cfg)).find((x) => x.name === d.name || (d.modell && x.modell === d.modell));
      if (neu?.zustand === "bereit") return neu;
      if (neu && (neu.zustand === "papier_leer" || neu.zustand === "deckel_offen")) throw Object.assign(new Error(neu.fehler.join(", ") || neu.zustand), { wartet: true });
      if (!s && Date.now() - start > 4000) throw Object.assign(new Error(neu ? `Drucker ${neu.zustand}` : "Drucker nicht gefunden"), { wartet: true });
      if (Date.now() - start > BEREIT_MAX_S * 1000) throw Object.assign(new Error("Drucker startet nicht (Auto Power On aktiv? Deckel zu?)"), { wartet: true });
      await new Promise((ok) => setTimeout(ok, Date.now() - start > BEREIT_NORMAL_S * 1000 ? 3000 : 2000));
    }
  }
  leerlaufStarten(d) {
    const s = this.shellyFuer(d);
    if (!s) return;
    clearTimeout(this.leerlauf.get(d.name));
    const min = Number(this.einstellungen?.leerlaufAusMin ?? this.cfg.leerlaufAusMin ?? 10);
    this.leerlauf.set(d.name, setTimeout(() => !this.laeuft && shellySchalten(s, false).then(() => this.log(`${d.name}: Steckdose aus (Leerlauf ${min} Min.)`)).catch(() => undefined), min * 60_000));
  }
  async auftragAusfuehren(a) {
    const d = this.drucker.find((x) => x.modell === a.drucker || x.name === a.drucker) ?? this.drucker.find((x) => x.modell?.startsWith(String(a.drucker).slice(0, 6)));
    if (!d) return this.statusMelden(a.id, "wartet", `Drucker ${a.drucker} am Agenten nicht gefunden`);
    this.laeuft = true;
    try {
      const bereit = await this.bereitMachen(d);
      const r = await this.anfrage(`/api/druckagent/auftrag/${a.id}/daten`);
      if (!r.ok) throw new Error(`Druckdaten nicht abrufbar (${r.status})`);
      const daten = Buffer.from(await r.arrayBuffer());
      if (a.sha256 && createHash("sha256").update(daten).digest("hex") !== a.sha256) throw new Error("Druckdaten beschädigt (Prüfsumme)");
      await senden(bereit, daten, this.ordner);
      this.letzterDruck = new Date().toISOString();
      this.log(`gedruckt: ${a.titel ?? a.id} (${a.anzahl ?? 1}×) auf ${bereit.name}`);
      await this.statusMelden(a.id, "gedruckt");
    } catch (e) {
      this.log(`Auftrag ${a.id}: ${e.message}`);
      await this.statusMelden(a.id, e.wartet || /Shelly/.test(e.message) ? "wartet" : "fehler", e.message);
    } finally {
      this.laeuft = false;
      this.leerlaufStarten(d);
    }
  }
  async abholen() {
    const r = await this.anfrage(`/api/druckagent/auftrag?warten=${LANGPOLL_S}`);
    if (r.status === 204) return null;
    if (!r.ok) throw new Error(`Abfrage ${r.status}`);
    const j = await r.json();
    return j.auftrag ?? null;
  }
  async ordnerPruefen() {
    const o = this.einstellungen?.ordner ?? this.cfg.ordner;
    if (!o?.pfad) return;
    const dateien = await fsp.readdir(o.pfad).catch(() => []);
    for (const n of dateien.filter((x) => /\.pdf$/i.test(x))) {
      const p = path.join(o.pfad, n);
      const st = await fsp.stat(p).catch(() => null);
      if (!st?.isFile() || Date.now() - st.mtimeMs < 5000) continue; // Scanner schreibt noch
      const r = await this.anfrage("/api/druckagent/upload", { method: "POST", headers: { "content-type": "application/pdf", "x-dateiname": encodeURIComponent(n) }, body: await fsp.readFile(p) }).catch((e) => (this.log(`Upload ${n}: ${e.message}`), null));
      if (!r?.ok) continue;
      const ziel = path.join(o.pfad, "verarbeitet");
      await fsp.mkdir(ziel, { recursive: true });
      await fsp.rename(p, path.join(ziel, `${new Date().toISOString().slice(0, 10)}_${n}`)).catch(() => undefined);
      this.log(`hochgeladen: ${n}`);
    }
  }
  async updatePruefen() {
    const r = await this.anfrage("/api/druckagent/version").catch(() => null);
    const j = r?.ok ? await r.json() : null;
    if (!j?.version || !neuer(j.version, VERSION)) return false;
    const d = await this.anfrage("/api/druckagent/download?datei=lugru-druckagent.mjs");
    const text = Buffer.from(await d.arrayBuffer());
    if (j.sha256 && createHash("sha256").update(text).digest("hex") !== j.sha256) {
      this.updateProtokoll.push({ am: new Date().toISOString(), von: VERSION, nach: j.version, ergebnis: "Prüfsumme falsch – nicht installiert" });
      return false;
    }
    const selbst = fileURLToPath(import.meta.url);
    await fsp.writeFile(`${selbst}.neu`, text);
    await fsp.rename(`${selbst}.neu`, selbst);
    this.updateProtokoll.push({ am: new Date().toISOString(), von: VERSION, nach: j.version, ergebnis: "installiert – Neustart" });
    await this.heartbeat().catch(() => undefined);
    return true;
  }
  async start() {
    this.log(`lugru-druckagent ${VERSION} startet (${os.hostname()}, ${process.platform})`);
    let naechsterHb = 0;
    let naechsterOrdner = 0;
    let naechstesUpdate = Date.now() + 60_000;
    // Nach Stromausfall/Neustart: Shelly-Drucker, die an sind, gehen nach der Leerlaufzeit wieder aus.
    const hb = async () => {
      try {
        const j = await this.heartbeat();
        if (j.abgemeldet) this.abgemeldet = true;
      } catch (e) {
        this.log(`Heartbeat: ${e.message}`);
      }
    };
    await hb();
    for (const d of this.drucker) this.leerlaufStarten(d);
    for (;;) {
      if (Date.now() >= naechsterHb) {
        await hb();
        naechsterHb = Date.now() + (this.abgemeldet ? 10 * 60_000 : HEARTBEAT_MS);
      }
      if (this.abgemeldet) {
        await new Promise((ok) => setTimeout(ok, 60_000));
        continue;
      }
      if (Date.now() >= naechsterOrdner) {
        await this.ordnerPruefen().catch((e) => this.log(`Ordner: ${e.message}`));
        naechsterOrdner = Date.now() + Number(this.einstellungen?.ordner?.intervallSek ?? this.cfg.ordner?.intervallSek ?? 60) * 1000;
      }
      if (Date.now() >= naechstesUpdate) {
        naechstesUpdate = Date.now() + 24 * 3600_000;
        if (await this.updatePruefen().catch(() => false)) process.exit(3); // Dienst startet mit der neuen Version neu
      }
      try {
        const a = await this.abholen();
        if (a) await this.auftragAusfuehren(a);
      } catch (e) {
        this.log(`Abfrage: ${e.message} – nächster Versuch in 10 s`);
        await new Promise((ok) => setTimeout(ok, FALLBACK_MS));
      }
    }
  }
}

export function neuer(a, b) {
  const x = String(a).split(".").map(Number);
  const y = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

export function configLesen(datei) {
  const cfg = JSON.parse(fs.readFileSync(datei, "utf8"));
  if (!cfg.server || !/^https?:\/\//.test(cfg.server)) throw new Error("config.json: „server“ fehlt (z. B. https://seller.example.com)");
  if (!cfg.token || !/^da_[A-Za-z0-9_-]{20,}$/.test(cfg.token)) throw new Error("config.json: „token“ fehlt oder ist kein Gerätetoken (beginnt mit da_)");
  return cfg;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ordner = path.dirname(fileURLToPath(import.meta.url));
  const datei = process.env.LUGRU_DRUCKAGENT_CONFIG || path.join(ordner, "config.json");
  let cfg;
  try {
    cfg = configLesen(datei);
  } catch (e) {
    console.error(`Konfiguration: ${e.message}`);
    process.exit(2);
  }
  if (process.argv.includes("--drucker")) {
    druckerFinden(cfg).then((l) => (console.log(JSON.stringify(l, null, 2)), process.exit(0)));
  } else {
    new Agent(cfg, { ordner }).start().catch((e) => {
      console.error(e);
      process.exit(1);
    });
  }
}
