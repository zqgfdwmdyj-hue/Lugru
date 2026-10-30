import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

// Tesla Fleet API (Modul 12): Tesla prüft bei der App-Registrierung den öffentlichen Schlüssel unter dieser Adresse.
// Öffentlich ohne Anmeldung – es wird nur der öffentliche Teil ausgeliefert (Anbindungen → Tesla, Feld
// „Öffentlicher Schlüssel“). Ohne Firmen-Sitzung: es gilt die erste Tesla-Anbindung (ein System = eine Firma).

export const dynamic = "force-dynamic";

export async function GET() {
  const I = schema.integrations;
  const [r] = await db.select({ config: I.config }).from(I).where(eq(I.provider, "tesla")).orderBy(asc(I.createdAt)).limit(1);
  const pem = String((r?.config as { publicKey?: unknown } | undefined)?.publicKey ?? "").trim();
  // Nur einen öffentlichen Schlüssel ausliefern – nie etwas, das wie ein privater Schlüssel aussieht.
  if (!/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----$/.test(pem) || /PRIVATE/i.test(pem)) return new Response("nicht eingerichtet", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(`${pem}\n`, { headers: { "Content-Type": "application/x-pem-file", "Cache-Control": "public, max-age=3600" } });
}
