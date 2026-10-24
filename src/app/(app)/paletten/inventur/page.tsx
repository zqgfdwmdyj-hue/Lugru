import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { PalletTabs } from "../tabs";
import { InventoryForm } from "./inventory-form";

export default async function InventurPage() {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.pallets).where(and(eq(schema.pallets.tenantId, t), isNull(schema.pallets.outAt)));
  const last = (await getSettings(t)).pallets.lastInventory;
  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Lager</div><h1>Paletten-Lager</h1></div>
        <span className="small muted">
          {last ? `Letzte Inventur: ${new Date(last.at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })} – ${last.found} gefunden, ${last.missing} fehlten, ${last.unknown} unbekannt` : "Noch keine Inventur gemacht."}
        </span>
      </div>
      <PalletTabs active="inventur" />
      <section className="card card-pad stack">
        <h2>Inventur – {n} Paletten laut System eingelagert</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Einmal durchs Lager gehen und jede Palette scannen. Danach „Mit Bestand abgleichen“: Du siehst, was fehlt (vielleicht schon abgeholt – dann „Ist raus“) und was gescannt wurde, aber nicht eingelagert ist.
          Die Liste bleibt auch nach Neuladen erhalten.
        </p>
        <InventoryForm />
      </section>
    </>
  );
}
