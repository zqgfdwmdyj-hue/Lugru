import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLogin } from "@/lib/auth";
import { collageSettings, eventDateLabel, type TileStyle, tileStyle } from "@/lib/layout";
import { loadEvent, loadEventItems, printedInfo } from "@/lib/service";
import { differsFromPhoto } from "@/lib/printed-price";
import { CollageEditor, type CollageTile } from "./collage-editor";

const storedStyle = (raw: unknown): TileStyle => {
  const t = tileStyle(raw);
  return t.custom ? { pos: t.pos, color: t.color } : {};
};

export default async function CollagePage({ params }: { params: Promise<{ id: string }> }) {
  await requireLogin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const event = await loadEvent(id);
  if (!event) notFound();
  const rows = await loadEventItems(id);
  const tiles: CollageTile[] = rows
    .filter((r) => r.item.inCollage)
    .map(({ item, product, photo }) => ({
      id: item.id,
      productId: product.id,
      style: storedStyle(product.collageStyle),
      image: product.imageFileId ? `/datei/${product.imageFileId}` : null,
      name: [product.name, product.variant].filter(Boolean).join(" "),
      price: item.price,
      priceNote: item.priceNote,
      caption: item.caption,
      printed: printedInfo(photo),
    }));
  // Eingetragener Preis weicht vom Preis im Foto ab – die Collage zeigt das Foto unverändert, also den alten Preis.
  const clash = tiles.filter((t) => t.image && differsFromPhoto(t.printed, t.price));
  return (
    <>
      <div className="crumb"><Link href={`/verteilung/${id}`}>Zurück zur Verteilung</Link></div>
      <div className="page-head"><div><h1>Collage</h1><div className="small muted">{eventDateLabel(event.eventDate)} · {tiles.length} Produkte</div></div></div>
      {clash.length > 0 && (
        <div className="notice notice-warn">
          Bei {clash.length === 1 ? "einem Produkt" : `${clash.length} Produkten`} steht im Foto ein anderer Preis als eingetragen. Die Collage zeigt das Foto unverändert, also den Preis aus dem Foto: {clash.map((t) => `${t.name} (Foto: ${t.printed!.text})`).join(", ")}.
          {" "}Auf der Verteilungsseite „Preise vom Foto übernehmen“ – oder ein Foto ohne Preis hochladen.
        </div>
      )}
      {tiles.length === 0
        ? <div className="card card-pad muted">Keine Produkte für die Collage ausgewählt.</div>
        : <CollageEditor eventId={id} tiles={tiles} initial={collageSettings(event.collage)} header={{ title: event.title, date: `${eventDateLabel(event.eventDate)}${event.eventTime ? ` · ${event.eventTime}` : ""}` }} fileBase={`spenden-${event.eventDate}`} />}
    </>
  );
}
