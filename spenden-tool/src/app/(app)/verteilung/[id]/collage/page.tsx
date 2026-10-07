import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLogin } from "@/lib/auth";
import { collageSettings, eventDateLabel } from "@/lib/layout";
import { loadEvent, loadEventItems, printedInfo } from "@/lib/service";
import { printedPlan } from "@/lib/printed-price";
import { CollageEditor, type CollageTile } from "./collage-editor";

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
      image: product.imageFileId ? `/datei/${product.imageFileId}` : null,
      name: [product.name, product.variant].filter(Boolean).join(" "),
      price: item.price,
      priceNote: item.priceNote,
      caption: item.caption,
      printed: printedInfo(photo),
    }));
  // Preis im Foto weicht ab, aber die Stelle ist unbekannt – dann stünden zwei Preise auf der Kachel.
  const clash = tiles.filter((t) => t.printed && t.image && printedPlan(t.printed, t.price) === "normal");
  return (
    <>
      <div className="crumb"><Link href={`/verteilung/${id}`}>Zurück zur Verteilung</Link></div>
      <div className="page-head"><div><h1>Collage</h1><div className="small muted">{eventDateLabel(event.eventDate)} · {tiles.length} Produkte</div></div></div>
      {clash.length > 0 && (
        <div className="notice notice-warn">
          Auf {clash.length === 1 ? "einem Foto" : `${clash.length} Fotos`} steht schon ein anderer Preis, dessen Stelle nicht erkannt wurde – dort stehen jetzt zwei Preise: {clash.map((t) => `${t.name} (Foto: ${t.printed!.text})`).join(", ")}.
          {" "}Preis in der Verteilung angleichen oder das Foto ersetzen.
        </div>
      )}
      {tiles.length === 0
        ? <div className="card card-pad muted">Keine Produkte für die Collage ausgewählt.</div>
        : <CollageEditor eventId={id} tiles={tiles} initial={collageSettings(event.collage)} header={{ title: event.title, date: `${eventDateLabel(event.eventDate)}${event.eventTime ? ` · ${event.eventTime}` : ""}` }} fileBase={`spenden-${event.eventDate}`} />}
    </>
  );
}
