import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { workerPruefen } from "@/lib/video/api";
import { createZip } from "@/lib/ebay/export/zip";

// Worker-Paket zum Aktualisieren am PC (unter-der-decke/update-worker.ps1): der Ordner „unter-der-decke“ in der Version
// dieses Seller-Systems als ZIP – ohne Arbeitsordner, Tests und Zwischenstände. Nur mit gültigem Worker-Token.

export const dynamic = "force-dynamic";

const AUSLASSEN = new Set(["arbeit", "tests", "__pycache__", ".venv", ".pytest_cache", ".git"]);

async function dateien(ordner: string, basis = ""): Promise<{ name: string; data: Uint8Array }[]> {
  const out: { name: string; data: Uint8Array }[] = [];
  for (const e of await readdir(path.join(ordner, basis), { withFileTypes: true })) {
    if (AUSLASSEN.has(e.name) || e.name.endsWith(".pyc")) continue;
    const rel = basis ? `${basis}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await dateien(ordner, rel)));
    else if (e.isFile()) out.push({ name: rel, data: new Uint8Array(await readFile(path.join(ordner, rel))) });
  }
  return out;
}

export async function GET(request: Request) {
  const p = await workerPruefen(request);
  if (!p.ok) return p.antwort;
  const ordner = path.join(process.cwd(), "unter-der-decke");
  let liste: { name: string; data: Uint8Array }[];
  try {
    liste = await dateien(ordner);
  } catch {
    return Response.json({ ok: false, fehler: "Worker-Ordner auf dem Server nicht gefunden" }, { status: 500 });
  }
  const version = /VERSION\s*=\s*"([^"]+)"/.exec(new TextDecoder().decode(liste.find((d) => d.name === "udd/__init__.py")?.data ?? new Uint8Array()))?.[1] ?? "unbekannt";
  const zip = createZip(liste);
  return new Response(new Uint8Array(zip), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="video-worker-${version}.zip"`, "X-Worker-Version": version, "Cache-Control": "no-store" },
  });
}
