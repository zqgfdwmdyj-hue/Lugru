import { z } from "zod";
import { RETOUREN_BEFUNDE, RETOUREN_VERBLEIB } from "@/db/schema";
import { befehl, stationStand } from "@/lib/retouren-station/service";
import { stationZugang } from "@/lib/retouren-station/zugang";

// Retouren-Station: Stand abholen (GET) und Befehle ohne Foto ausführen (POST, JSON).

const id = z.string().uuid().nullable().optional();
const Eingabe = z.object({
  pruefung: id,
  befehl: z.discriminatedUnion("befehl", [
    z.object({ befehl: z.enum(["neues_paket", "fertig", "loeschen", "abbrechen", "wiederholen", "hilfe"]) }),
    z.object({ befehl: z.literal("zustand"), befund: z.enum(RETOUREN_BEFUNDE) }),
    z.object({ befehl: z.literal("notiz"), text: z.string().trim().min(1).max(1000) }),
    z.object({ befehl: z.literal("code"), wert: z.string().trim().min(3).max(60) }),
    z.object({ befehl: z.literal("remission"), wert: z.string().trim().max(40).nullable() }),
    z.object({ befehl: z.literal("verbleib"), verbleib: z.enum(RETOUREN_VERBLEIB) }),
  ]),
});

export async function GET(req: Request) {
  const z0 = await stationZugang(false);
  if ("antwort" in z0) return z0.antwort;
  const url = new URL(req.url);
  const p = id.safeParse(url.searchParams.get("pruefung"));
  return Response.json(await stationStand(z0.session, p.success ? p.data : null, { remissionenAuswahl: url.searchParams.get("remissionen") === "1" }));
}

export async function POST(req: Request) {
  const z0 = await stationZugang(true);
  if ("antwort" in z0) return z0.antwort;
  const e = Eingabe.safeParse(await req.json().catch(() => null));
  if (!e.success) return Response.json({ fehler: "Ungültiger Befehl." }, { status: 400 });
  return Response.json(await befehl(z0.session, e.data.pruefung ?? null, e.data.befehl));
}
