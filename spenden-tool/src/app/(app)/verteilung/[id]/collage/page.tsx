import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLogin } from "@/lib/auth";
import { cleanTileStyle, collageSettings, eventDateLabel } from "@/lib/layout";
import { loadEventView } from "@/lib/event-view";
import type { CollageSettings } from "@/db/schema";
import { exportWarnings } from "@/lib/export-check";
import { CollageEditor, type CollageTile } from "./collage-editor";

/** Vorlagen aus der Ausgabe-Übersicht („WhatsApp“, „Story“, „A4“) – setzen nur das Format beim Öffnen. */
const PRESETS: Record<string, Partial<CollageSettings>> = {
  whatsapp: { format: "4:5" },
  story: { format: "9:16" },
  a4: { format: "a4", header: true },
};

export default async function CollagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ vorlage?: string }> }) {
  await requireLogin();
  const { id } = await params;
  const sp = await searchParams;
  const view = await loadEventView(id);
  if (!view) notFound();
  const { event, rows } = view;
  const shown = rows.filter((r) => r.item.inCollage);
  const tiles: CollageTile[] = shown.map(({ item, product, state }) => ({
    id: item.id,
    productId: product.id,
    style: cleanTileStyle(product.collageStyle),
    image: product.imageFileId ? `/datei/${product.imageFileId}` : null,
    name: [product.name, product.variant].filter(Boolean).join(" "),
    price: item.price,
    priceNote: item.priceNote,
    unit: item.unit,
    unitCount: item.unitCount,
    caption: item.caption,
    packNote: item.packNote,
    packPrice: item.packPrice,
    printed: state.printed,
    plan: state.plan,
  }));
  const warnings = exportWarnings(shown);
  const preset = PRESETS[sp.vorlage ?? ""];
  return (
    <div className="stack">
      <div className="between" style={{ flexWrap: "wrap" }}>
        <div><h2>Collage</h2><div className="small muted">{tiles.length} Produkte mit Häkchen „Collage“ · <Link href={`/verteilung/${id}/ausgabe`}>andere Ausgabe wählen</Link></div></div>
      </div>
      {warnings.length > 0 && (
        <div className="notice notice-warn">
          <strong>Vor dem Export:</strong> {warnings.join(" · ")} – <Link href={`/verteilung/${id}/pruefen`}>prüfen</Link>
        </div>
      )}
      {tiles.length === 0
        ? <div className="card card-pad muted">Keine Produkte für die Collage ausgewählt.</div>
        : <CollageEditor eventId={id} tiles={tiles} warnings={warnings} initial={collageSettings({ ...event.collage, ...preset })} header={{ title: event.title, date: `${eventDateLabel(event.eventDate)}${event.eventTime ? ` · ${event.eventTime}` : ""}` }} fileBase={`spenden-${event.eventDate}`} />}
    </div>
  );
}
