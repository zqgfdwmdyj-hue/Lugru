import "server-only";
import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { assertOutbound } from "@/lib/testenv";
import { registerTester } from "../test";

// B34.3a Briefversand über einen Anbieter – austauschbar: senden(pdf, adresse, optionen) → id, status(id),
// stornieren(id), preisSchaetzen(seiten, optionen). Zugangsdaten verschlüsselt unter Anbindungen. Testmodus = Sandbox
// des Anbieters (LetterXpress „test“: nur Warenkorb, nichts gedruckt; eBrief: Auftrag angelegt, aber nicht gestartet).
// Nichts wird automatisch verschickt – aufgerufen wird nur aus der Freigabe heraus.

export type BriefAnbieterName = "ebrief" | "letterxpress" | "epost";
export type BriefAdresse = { name: string; strasse: string; plz: string; ort: string; land: string };
export type BriefOptionen = { modus: "test" | "live"; farbe: boolean; duplex: boolean; dateiname: string; seiten: number };
export type BriefStatus = "uebergeben" | "angenommen" | "gedruckt" | "zugestellt" | "fehler" | "storniert";
export type GesendetErgebnis = { id: string; kostenNetto: number | null; status: BriefStatus; text: string };
export type StatusErgebnis = { status: BriefStatus; text: string; kostenNetto?: number | null };

export interface BriefAnbieter {
  readonly name: BriefAnbieterName;
  senden(pdf: Uint8Array, adresse: BriefAdresse, o: BriefOptionen): Promise<GesendetErgebnis>;
  status(id: string, modus: "test" | "live"): Promise<StatusErgebnis>;
  stornieren(id: string, modus: "test" | "live"): Promise<boolean>;
  preisSchaetzen(seiten: number, o: Pick<BriefOptionen, "farbe" | "duplex"> & { international?: boolean }): Promise<number | null>;
}

export const ANBIETER_NAME: Record<BriefAnbieterName, string> = { ebrief: "eBrief", letterxpress: "LetterXpress", epost: "Deutsche Post E-POST" };

/** JSON-Anfrage auch mit Body bei GET (LetterXpress erwartet die Anmeldung im Body) – über node:http(s). */
function jsonAnfrage(url: string, method: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: unknown }> {
  const u = new URL(url);
  assertOutbound(u.hostname);
  const daten = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const mod = u.protocol === "http:" ? http : https;
  return new Promise((resolve, reject) => {
    const req = mod.request(u, { method, headers: { Accept: "application/json", ...(daten ? { "Content-Type": "application/json", "Content-Length": String(daten.length) } : {}), ...headers }, timeout: 60_000 }, (res) => {
      const teile: Buffer[] = [];
      res.on("data", (c: Buffer) => teile.push(c));
      res.on("end", () => {
        const text = Buffer.concat(teile).toString("utf8");
        let json: unknown = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = { message: text.slice(0, 300) };
        }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on("timeout", () => req.destroy(new Error("Zeitüberschreitung beim Briefdienst")));
    req.on("error", reject);
    if (daten) req.write(daten);
    req.end();
  });
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

// ---- LetterXpress (API v3) ------------------------------------------------------------------------------------------

type LxpAntwort = { status?: number; message?: string; data?: Record<string, unknown> & { id?: number | string; status?: string; price?: number; balance?: number; items?: { amount?: number | string; status?: string; tracking_status?: string; tracking_code?: string }[] } };

export class LetterXpress implements BriefAnbieter {
  readonly name = "letterxpress" as const;
  constructor(private readonly zugang: { username: string; apiKey: string }) {}
  private basis = () => (process.env.LETTERXPRESS_BASE_URL || "https://api.letterxpress.de/v3").replace(/\/$/, "");
  private auth = (modus: "test" | "live") => ({ username: this.zugang.username, apikey: this.zugang.apiKey, mode: modus });
  private async aufruf(method: string, pfad: string, body: Record<string, unknown>): Promise<LxpAntwort> {
    const r = await jsonAnfrage(`${this.basis()}${pfad}`, method, body);
    const j = (r.json ?? {}) as LxpAntwort;
    if (r.status === 401 || r.status === 403) throw new Error("LetterXpress: Anmeldung abgelehnt – Benutzername/API-Schlüssel prüfen (Anbindungen).");
    if (r.status >= 400) throw new Error(`LetterXpress: ${j.message ?? `Fehler ${r.status}`}`);
    return j;
  }
  private spez(o: Pick<BriefOptionen, "farbe" | "duplex">, international: boolean) {
    return { color: o.farbe ? "4" : "1", mode: o.duplex ? "duplex" : "simplex", shipping: international ? "international" : "national" };
  }
  async senden(pdf: Uint8Array, adresse: BriefAdresse, o: BriefOptionen): Promise<GesendetErgebnis> {
    const b64 = Buffer.from(pdf).toString("base64");
    const j = await this.aufruf("POST", "/printjobs", { auth: this.auth(o.modus), letter: { base64_file: b64, base64_file_checksum: createHash("md5").update(b64).digest("hex"), filename_original: o.dateiname.slice(0, 100), specification: this.spez(o, (adresse.land || "DE").toUpperCase() !== "DE") } });
    const id = j.data?.id;
    if (id === undefined || id === null) throw new Error("LetterXpress: keine Auftragsnummer erhalten.");
    const kosten = (j.data?.items ?? []).reduce<number | null>((n, it) => (num(it.amount) === null ? n : (n ?? 0) + num(it.amount)!), null);
    return { id: String(id), kostenNetto: kosten === null ? null : Math.round(kosten * 100) / 100, status: "angenommen", text: o.modus === "test" ? "im Testmodus angenommen (Warenkorb, nichts gedruckt)" : `angenommen (${j.data?.status ?? "queue"})` };
  }
  async status(id: string, modus: "test" | "live"): Promise<StatusErgebnis> {
    const j = await this.aufruf("GET", `/printjobs/${encodeURIComponent(id)}`, { auth: this.auth(modus) });
    const d = j.data ?? {};
    const it = d.items?.[0];
    const kostenNetto = (d.items ?? []).reduce<number | null>((n, x) => (num(x.amount) === null ? n : (n ?? 0) + num(x.amount)!), null);
    const t = String(it?.tracking_status ?? "");
    if (/zugestellt/i.test(t)) return { status: "zugestellt", text: t.slice(0, 200), kostenNetto };
    if (d.status === "canceled") return { status: "storniert", text: "storniert", kostenNetto };
    if (d.status === "done" || it?.status === "sent") return { status: "gedruckt", text: `gedruckt und an die Post übergeben${it?.tracking_code ? ` (${it.tracking_code})` : ""}`, kostenNetto };
    if (d.status === "draft") return { status: "angenommen", text: "Testmodus: im Warenkorb, wird nicht gedruckt", kostenNetto };
    if (d.status === "hold") return { status: "angenommen", text: "angehalten (Freigabe im LetterXpress-Konto nötig)", kostenNetto };
    return { status: "angenommen", text: `in der Warteschlange (${d.status ?? "queue"})`, kostenNetto };
  }
  async stornieren(id: string, modus: "test" | "live"): Promise<boolean> {
    await this.aufruf("DELETE", `/printjobs/${encodeURIComponent(id)}`, { auth: this.auth(modus) });
    return true;
  }
  async preisSchaetzen(seiten: number, o: Pick<BriefOptionen, "farbe" | "duplex"> & { international?: boolean }): Promise<number | null> {
    const j = await this.aufruf("GET", "/price", { auth: this.auth("test"), letter: { specification: { pages: seiten, ...this.spez(o, !!o.international) } } });
    return num(j.data?.price);
  }
  async guthaben(): Promise<number | null> {
    const j = await this.aufruf("GET", "/balance", { auth: this.auth("live") });
    return num(j.data?.balance);
  }
}

// ---- eBrief (REST-API) -----------------------------------------------------------------------------------------------

type EbriefErgebnis<T> = { ResultCode?: string; ErrorMessage?: string | null; Result?: T };
type EbriefJob = { Id?: number | string; JobStatus?: string; PriceNetto?: number; Documents?: { DocumentStatus?: string; LastEvent?: string; PriceNetto?: number; ShipmentNumber?: string }[] };
const tokens = new Map<string, { token: string; bis: number }>();

export class Ebrief implements BriefAnbieter {
  readonly name = "ebrief" as const;
  constructor(private readonly zugang: { username: string; password: string }) {}
  private basis = () => (process.env.EBRIEF_BASE_URL || "https://api.ebrief.de").replace(/\/$/, "");
  private async token(): Promise<string> {
    const key = `${this.basis()}|${this.zugang.username}`;
    const t = tokens.get(key);
    if (t && t.bis > Date.now()) return t.token;
    const r = await jsonAnfrage(`${this.basis()}/oauth2/token/generateBearerToken`, "GET", undefined, { Authorization: `Basic ${Buffer.from(`${this.zugang.username}:${this.zugang.password}`).toString("base64")}` });
    const j = (r.json ?? {}) as { GenerateBearerTokenResult?: string };
    if (r.status >= 400 || !j.GenerateBearerTokenResult) throw new Error("eBrief: Anmeldung abgelehnt – Benutzername/Passwort prüfen (Anbindungen).");
    // Token gilt 7 Tage – nach 6 Tagen neu holen.
    tokens.set(key, { token: j.GenerateBearerTokenResult, bis: Date.now() + 6 * 86_400_000 });
    return j.GenerateBearerTokenResult;
  }
  private async aufruf<T>(method: string, pfad: string, body?: unknown): Promise<T | undefined> {
    const r = await jsonAnfrage(`${this.basis()}${pfad}`, method, body, { Authorization: `Bearer ${await this.token()}` });
    const j = (r.json ?? {}) as EbriefErgebnis<T>;
    if (r.status >= 400 || (j.ResultCode && j.ResultCode !== "Ok")) throw new Error(`eBrief: ${j.ErrorMessage ?? j.ResultCode ?? `Fehler ${r.status}`}`);
    return j.Result;
  }
  async senden(pdf: Uint8Array, adresse: BriefAdresse, o: BriefOptionen): Promise<GesendetErgebnis> {
    const m = /^(.*?)\s+(\d+\s*[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?)$/.exec(adresse.strasse.trim());
    const r = await this.aufruf<{ Jobs?: EbriefJob[] }>("POST", "/Jobs/singleFiles", {
      Document: { FileName: o.dateiname.slice(0, 100), FileContent: Buffer.from(pdf).toString("base64") },
      AddressInformation: { Street: m?.[1] ?? adresse.strasse, HouseNumber: m?.[2] ?? "", Zip: adresse.plz, City: adresse.ort, Country: (adresse.land || "DE").toUpperCase() },
      Attributes: { IsColor: o.farbe, IsDuplex: o.duplex },
    });
    const job = r?.Jobs?.[0];
    if (job?.Id === undefined) throw new Error("eBrief: keine Auftragsnummer erhalten.");
    // Live: Verarbeitung starten. Testmodus: Auftrag bleibt angelegt, aber nicht gestartet – nichts wird gedruckt.
    if (o.modus === "live") await this.aufruf("PUT", `/Jobs/${encodeURIComponent(String(job.Id))}`, { IsRollback: false });
    return { id: String(job.Id), kostenNetto: num(job.PriceNetto ?? job.Documents?.[0]?.PriceNetto), status: "angenommen", text: o.modus === "test" ? "im Testmodus angelegt (nicht gestartet, nichts gedruckt)" : "angenommen, Verarbeitung gestartet" };
  }
  async status(id: string): Promise<StatusErgebnis> {
    const r = await this.aufruf<{ Jobs?: EbriefJob[] }>("GET", `/Jobs/${encodeURIComponent(id)}`);
    const job = r?.Jobs?.[0];
    const doc = job?.Documents?.[0];
    const s = `${job?.JobStatus ?? ""} ${doc?.DocumentStatus ?? ""} ${doc?.LastEvent ?? ""}`;
    const kostenNetto = num(job?.PriceNetto ?? doc?.PriceNetto);
    if (/error|fehler|reject|abgelehnt/i.test(s)) return { status: "fehler", text: s.trim().slice(0, 200), kostenNetto };
    if (/deliver|zugestellt/i.test(s)) return { status: "zugestellt", text: s.trim().slice(0, 200), kostenNetto };
    if (/cancel|delet|storn/i.test(s)) return { status: "storniert", text: s.trim().slice(0, 200), kostenNetto };
    if (/print|druck|sent|versand|distribut|shipped|handed/i.test(s)) return { status: "gedruckt", text: s.trim().slice(0, 200), kostenNetto };
    return { status: "angenommen", text: s.trim().slice(0, 200) || "angenommen", kostenNetto };
  }
  async stornieren(id: string): Promise<boolean> {
    await this.aufruf("DELETE", `/Jobs/${encodeURIComponent(id)}`);
    return true;
  }
  async preisSchaetzen(seiten: number, o: Pick<BriefOptionen, "farbe" | "duplex"> & { international?: boolean }): Promise<number | null> {
    const r = await this.aufruf<{ TotalSumNetto?: number }>("POST", "/Prices", { Amount: 1, Attributes: { Pages: seiten, IsDuplex: o.duplex, IsColor: o.farbe, IsTracking: false, Region: o.international ? "International" : "National" } });
    return num(r?.TotalSumNetto);
  }
}

// ---- Deutsche Post E-POST (vorbereitet) ------------------------------------------------------------------------------

export class EPost implements BriefAnbieter {
  readonly name = "epost" as const;
  private nicht(): never {
    throw new Error("E-POST ist noch nicht angebunden – bitte eBrief/LetterXpress oder das Sammel-PDF nutzen.");
  }
  async senden(): Promise<GesendetErgebnis> {
    return this.nicht();
  }
  async status(): Promise<StatusErgebnis> {
    return this.nicht();
  }
  async stornieren(): Promise<boolean> {
    return this.nicht();
  }
  async preisSchaetzen(): Promise<number | null> {
    return null;
  }
}

export function briefAnbieter(name: BriefAnbieterName, cfg: Record<string, string> | null): BriefAnbieter | null {
  if (name === "epost") return new EPost();
  if (!cfg) return null;
  if (name === "letterxpress" && cfg.username && cfg.apiKey) return new LetterXpress({ username: cfg.username, apiKey: cfg.apiKey });
  if (name === "ebrief" && cfg.username && cfg.password) return new Ebrief({ username: cfg.username, password: cfg.password });
  return null;
}

registerTester("letterxpress", async (v) => {
  const a = briefAnbieter("letterxpress", v) as LetterXpress | null;
  if (!a) throw new Error("Benutzername und API-Schlüssel fehlen.");
  const g = await a.guthaben();
  const p = await a.preisSchaetzen(1, { farbe: false, duplex: false });
  return `Verbunden – Guthaben ${g === null ? "?" : `${g.toFixed(2).replace(".", ",")} €`}, Preis 1 Seite s/w national laut Anbieter ${p === null ? "?" : `${p.toFixed(2).replace(".", ",")} €`}. Preise für die Kostenvorschau trotzdem unter Abverkauf → Einstellungen eintragen.`;
});

registerTester("ebrief", async (v) => {
  const a = briefAnbieter("ebrief", v);
  if (!a) throw new Error("Benutzername und Passwort fehlen.");
  const p = await a.preisSchaetzen(1, { farbe: false, duplex: false });
  return `Verbunden – Preis 1 Seite s/w national laut Anbieter ${p === null ? "?" : `${p.toFixed(2).replace(".", ",")} € netto`}.`;
});
