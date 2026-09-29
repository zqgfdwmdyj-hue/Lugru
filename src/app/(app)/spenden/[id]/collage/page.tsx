import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { collageSettings, eventDateLabel } from "@/lib/donations/layout";
import { loadEvent, loadEventItems } from "@/lib/donations/service";
import { CollageEditor, type CollageTile } from "./collage-editor";

export default async function CollagePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const event = await loadEvent(session.tenantId, id);
  if (!event) notFound();
  const rows = await loadEventItems(session.tenantId, id);
  const tiles: CollageTile[] = rows
    .filter((r) => r.item.inCollage)
    .map(({ item, product }) => ({
      id: item.id,
      image: product.imageFileId ? `/datei/${product.imageFileId}` : null,
      name: [product.name, product.variant].filter(Boolean).join(" "),
      price: item.price,
      priceNote: item.priceNote,
      caption: item.caption,
    }));
  return (
    <>
      <div className="crumb"><Link href={`/spenden/${id}`}>Zurück zur Verteilung</Link></div>
      <div className="page-head"><div><h1>Collage</h1><div className="small muted">{eventDateLabel(event.eventDate)} · {tiles.length} Produkte</div></div></div>
      {tiles.length === 0
        ? <div className="card card-pad muted">Keine Produkte für die Collage ausgewählt.</div>
        : <CollageEditor eventId={id} tiles={tiles} initial={collageSettings(event.collage)} header={{ title: event.title, date: `${eventDateLabel(event.eventDate)}${event.eventTime ? ` · ${event.eventTime}` : ""}` }} fileBase={`spenden-${event.eventDate}`} />}
    </>
  );
}
