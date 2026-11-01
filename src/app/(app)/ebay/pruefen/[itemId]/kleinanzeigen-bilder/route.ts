import { getSession } from "@/lib/auth/session";
import { canAccess } from "@/lib/auth/areas";
import { reviewDetail } from "@/lib/ebay-review/service";
import { KA_BILDER_MAX } from "@/lib/kleinanzeigen/logic";
import { zipErstellen } from "@/lib/zip";

// Bilder des eBay-Angebots als ZIP für den Kleinanzeigen-Entwurf (nur Bilder von eBay bzw. aus dem Angebot, höchstens
// 20, je höchstens 8 MB). Nur mit Zugang zum eBay-Bereich.

/** Nur Bilder aus dem Netz laden – keine internen Adressen (Testumgebung: nur die Testdienste). */
function erlaubt(url: string): boolean {
  try {
    const u = new URL(url);
    const test = process.env.TESTDIENSTE_URL ? new URL(process.env.TESTDIENSTE_URL).host : null;
    if (test && u.host === test) return true;
    if (u.protocol !== "https:") return false;
    return !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?|.*\.local$|.*\.internal$)/i.test(u.hostname);
  } catch {
    return false;
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const s = await getSession();
  if (!s || !canAccess(s, "ebay")) return new Response("Kein Zugang", { status: 403 });
  const { itemId } = await params;
  if (!/^\d{6,20}$/.test(itemId)) return new Response("Nicht gefunden", { status: 404 });
  const d = await reviewDetail(s.tenantId, itemId);
  const bilder = (d?.row.facts?.images ?? []).filter(erlaubt).slice(0, KA_BILDER_MAX);
  if (!bilder.length) return new Response("Keine Bilder im Angebot.", { status: 404 });
  const eintraege = [];
  for (const [i, url] of bilder.entries()) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "error" });
      if (!r.ok) continue;
      const typ = r.headers.get("content-type") ?? "";
      if (!/^image\//.test(typ)) continue;
      const daten = new Uint8Array(await r.arrayBuffer());
      if (daten.length > 8 * 1024 * 1024) continue;
      const endung = typ.includes("png") ? "png" : typ.includes("webp") ? "webp" : "jpg";
      eintraege.push({ name: `${String(i + 1).padStart(2, "0")}.${endung}`, daten });
    } catch {
      // Bild nicht erreichbar – überspringen
    }
  }
  if (!eintraege.length) return new Response("Bilder nicht erreichbar.", { status: 502 });
  return new Response(new Uint8Array(zipErstellen(eintraege)), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="kleinanzeigen-${itemId}.zip"`, "Cache-Control": "private, no-store" } });
}
