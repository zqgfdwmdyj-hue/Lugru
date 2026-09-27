import "server-only";
import { getIntegration } from "./store";

type Tester = (values: Record<string, string>, tenantId: string) => Promise<string>;

// Die Tests werden von den einzelnen Clients registriert (siehe clients/*).
const testers = new Map<string, Tester>();

export function registerTester(provider: string, fn: Tester) {
  testers.set(provider, fn);
}

export async function testIntegration(tenantId: string, provider: string): Promise<{ ok: boolean; message: string }> {
  await import("./clients");
  const values = await getIntegration(tenantId, provider);
  if (!values) return { ok: false, message: "Noch keine Zugangsdaten gespeichert." };
  const fn = testers.get(provider);
  if (!fn) return { ok: false, message: "Für diese Anbindung gibt es noch keinen Test." };
  try {
    return { ok: true, message: await fn(values, tenantId) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
