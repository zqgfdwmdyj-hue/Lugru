// Testumgebung (TESTUMGEBUNG=1): eigene Datenbank mit erfundenen Daten. Nichts darf nach außen gehen –
// Mails werden abgefangen, Verbindungen ins Internet gesperrt; Post, DHL, Amazon, eBay, Claude … laufen gegen die
// „Testdienste“ (scripts/testdienste.mjs), die Schreibaktionen nur simulieren und mitschreiben.
// Reine Logik ohne Datenbank – auch in Tests und in instrumentation.ts nutzbar.

type Env = Record<string, string | undefined>;

export function isTestEnv(env: Env = process.env): boolean {
  return env.TESTUMGEBUNG === "1";
}

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const hostOf = (raw: string | undefined): string | null => {
  if (!raw?.trim()) return null;
  try {
    return new URL(raw.trim()).hostname.toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
};

/** Erlaubte Ziele: dieser Rechner, die Testdienste (TESTDIENSTE_URL) und ausdrücklich freigegebene (TEST_ERLAUBT). */
export function allowedHosts(env: Env = process.env): Set<string> {
  const out = new Set(LOCAL);
  const td = hostOf(env.TESTDIENSTE_URL);
  if (td) out.add(td);
  for (const h of (env.TEST_ERLAUBT ?? "").split(/[,\s]+/)) {
    const x = hostOf(h);
    if (x) out.add(x);
  }
  return out;
}

/** Darf diese Adresse im Testbetrieb aufgerufen werden? Außerhalb des Testbetriebs immer. */
export function outboundAllowed(url: string, env: Env = process.env): boolean {
  if (!isTestEnv(env)) return true;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true; // relative Adresse = eigener Server
  }
  return allowedHosts(env).has(host);
}

export class TestEnvBlocked extends Error {
  constructor(public readonly target: string) {
    super(`Testumgebung: Verbindung nach außen gesperrt (${target}) – in der Testumgebung geht nichts an echte Dienste.`);
    this.name = "TestEnvBlocked";
  }
}

/** Gesperrt? (Name statt instanceof – Server-Teile bündeln das Modul getrennt.) */
export function isBlockedError(e: unknown): boolean {
  return e instanceof Error && (e.name === "TestEnvBlocked" || e.message.startsWith("Testumgebung: Verbindung nach außen gesperrt"));
}

/** Für Verbindungen ohne fetch (IMAP, SMTP): wirft im Testbetrieb, wenn der Server nicht erlaubt ist. */
export function assertOutbound(host: string, env: Env = process.env): void {
  if (!isTestEnv(env)) return;
  if (!allowedHosts(env).has(host.toLowerCase())) {
    recordBlocked(host, "Verbindung");
    throw new TestEnvBlocked(host);
  }
}

export type BlockedCall = { at: string; target: string; method: string };
const g = globalThis as unknown as { __testBlocked?: BlockedCall[]; __testGuard?: boolean };

/** Letzte gesperrte Aufrufe (im Speicher des Servers, für die Übersicht „Testumgebung“). */
export function blockedCalls(): BlockedCall[] {
  return [...(g.__testBlocked ?? [])].reverse();
}

function recordBlocked(target: string, method: string) {
  const list = (g.__testBlocked ??= []);
  list.push({ at: new Date().toISOString(), target, method });
  if (list.length > 100) list.splice(0, list.length - 100);
}

/** Beim Serverstart (instrumentation.ts): fetch nur noch zu erlaubten Zielen. */
export function installTestGuard(env: Env = process.env): void {
  if (!isTestEnv(env) || g.__testGuard) return;
  g.__testGuard = true;
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!outboundAllowed(url, env)) {
      let target = url;
      try {
        const u = new URL(url);
        target = `${u.host}${u.pathname}`;
      } catch {
        /* Adresse so lassen */
      }
      const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
      recordBlocked(target, method);
      throw new TestEnvBlocked(target);
    }
    return original(input, init);
  }) as typeof fetch;
  console.log(`[Testumgebung] aktiv – Verbindungen nur zu: ${[...allowedHosts(env)].join(", ")}`);
}
