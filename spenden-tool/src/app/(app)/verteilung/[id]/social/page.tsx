import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLogin } from "@/lib/auth";
import { eventDateLabel, flyerSections } from "@/lib/layout";
import { loadEvent, loadEventItems, printedInfo } from "@/lib/service";
import { SocialStudio, type SocialData, type SocialItem } from "./social-studio";

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

export default async function SocialPage({ params }: { params: Promise<{ id: string }> }) {
  await requireLogin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const event = await loadEvent(id);
  if (!event) notFound();
  const rows = await loadEventItems(id);
  const items: SocialItem[] = rows
    .filter((r) => r.item.inCollage)
    .map(({ item, product, photo }) => ({ id: item.id, image: product.imageFileId ? `/datei/${product.imageFileId}` : null, name: product.name, variant: product.variant, price: item.price, priceNote: item.priceNote, caption: item.caption, printed: printedInfo(photo) }));
  const sections = flyerSections(rows.filter((r) => r.item.inFlyer).map((r) => ({ ...r.product, price: r.item.price, priceNote: r.item.priceNote, bestBefore: r.item.bestBefore })));
  const [y, m, d] = event.eventDate.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const data: SocialData = {
    title: event.title,
    subtitle: event.subtitle,
    dateLabel: eventDateLabel(event.eventDate),
    weekdayLong: WEEKDAYS[wd],
    weekdayShort: WEEKDAYS[wd].slice(0, 2),
    dateShort: `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.`,
    eventTime: event.eventTime,
    location: event.location,
    fileBase: `spenden-${event.eventDate}`,
  };
  return (
    <>
      <div className="crumb"><Link href={`/verteilung/${id}`}>Zurück zur Verteilung</Link></div>
      <div className="page-head"><div><h1>Social Media</h1><div className="small muted">{eventDateLabel(event.eventDate)} · Bilder, Video und Texte für Instagram & TikTok – automatisch aus der Verteilung</div></div></div>
      {items.length === 0 ? <div className="card card-pad muted">Keine Produkte mit Häkchen „Collage“.</div> : <SocialStudio data={data} items={items} sections={sections} />}
    </>
  );
}
