import "server-only";
import { registerTester } from "../test";

// Asana (B14) – NUR LESEN: Projekte, Aufgaben (Fälle) und Kommentare, die Ludwig im Asana des Anwalts sehen darf.
// Persönlicher Zugangstoken nur auf dem Server. ASANA_BASE_URL → Testdienste.

export type AsanaCfg = { token?: string; projekte?: string };
const BASIS = () => (process.env.ASANA_BASE_URL || "https://app.asana.com").replace(/\/$/, "");

async function lies<T>(c: AsanaCfg, pfad: string): Promise<T> {
  if (!c.token) throw new Error("Asana nicht eingerichtet (Token fehlt).");
  const r = await fetch(`${BASIS()}/api/1.0${pfad}`, { headers: { Authorization: `Bearer ${c.token}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (r.status === 401) throw new Error("Asana: Token ungültig oder abgelaufen.");
  if (!r.ok) throw new Error(`Asana ${r.status}`);
  return ((await r.json()) as { data: T }).data;
}

export type AsanaProjekt = { gid: string; name: string };
export type AsanaAufgabe = { gid: string; name: string; notes: string; completed: boolean; due_on: string | null; modified_at: string; permalink_url: string; memberships: { project?: { gid: string }; section?: { name: string } }[] };
export type AsanaKommentar = { gid: string; text: string; created_at: string; type: string; created_by?: { name?: string } };

/** Projekte: eingetragene gids, sonst alle sichtbaren Projekte aller Workspaces. */
export async function asanaProjekte(c: AsanaCfg): Promise<AsanaProjekt[]> {
  const gids = (c.projekte ?? "").split(/[,\s]+/).filter((x) => /^\d+$/.test(x));
  if (gids.length) return Promise.all(gids.map((g) => lies<AsanaProjekt>(c, `/projects/${g}?opt_fields=name`)));
  const ws = await lies<{ gid: string }[]>(c, "/workspaces");
  const out: AsanaProjekt[] = [];
  for (const w of ws.slice(0, 5)) out.push(...(await lies<AsanaProjekt[]>(c, `/projects?workspace=${w.gid}&archived=false&opt_fields=name`)));
  return out.slice(0, 50);
}

export const asanaAufgaben = (c: AsanaCfg, projekt: string) => lies<AsanaAufgabe[]>(c, `/projects/${projekt}/tasks?opt_fields=name,notes,completed,due_on,modified_at,permalink_url,memberships.project.gid,memberships.section.name&limit=100`);
export const asanaKommentare = async (c: AsanaCfg, aufgabe: string) => (await lies<AsanaKommentar[]>(c, `/tasks/${aufgabe}/stories?opt_fields=text,created_at,type,created_by.name&limit=100`)).filter((s) => s.type === "comment");

registerTester("asana", async (v) => {
  const p = await asanaProjekte(v as AsanaCfg);
  return `Verbunden: ${p.length} Projekt${p.length === 1 ? "" : "e"} sichtbar (nur lesen).`;
});
