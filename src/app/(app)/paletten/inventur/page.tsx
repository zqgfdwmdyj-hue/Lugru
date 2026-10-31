import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { InventoryForm } from "./inventory-form";

export default async function InventurPage() {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.pallets).where(and(eq(schema.pallets.tenantId, t), isNull(schema.pallets.outAt), isNull(schema.pallets.cancelledAt)));
  const last = (await getSettings(t)).pallets.lastInventory;
  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Lager</div><h1>Paletten-Lager</h1></div>
        <span className="small muted">
          {last ? `Letzte Inventur: ${new Date(last.at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })} – ${last.found} gefunden, ${last.missing} fehlten, ${last.unknown} unbekannt${last.duplicates ? `, ${last.duplicates} doppelt gescannt` : ""}${last.confirmed !== undefined ? " (alle Abweichungen entschieden)" : ""}` : "Noch keine Inventur gemacht."}
        </span>
      </div>
      <section className="card card-pad stack">
        <h2>Inventur – {n} Paletten laut System eingelagert</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Einmal durchs Lager gehen und jede Palette scannen. Danach „Mit Bestand abgleichen“: erwartet, gefunden, fehlend, unbekannt und doppelt gescannt.
          Jede Abweichung einzeln entscheiden (ist raus / doch da / klären bzw. einlagern / ignorieren), dann „Inventur abschließen“ – alles steht im Verlauf der Paletten. Die Liste bleibt auch nach Neuladen erhalten.
        </p>
        <InventoryForm expected={n} />
      </section>
    </>
  );
}
