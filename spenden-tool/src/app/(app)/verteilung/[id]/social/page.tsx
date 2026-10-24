import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLogin } from "@/lib/auth";
import { eventDateLabel } from "@/lib/layout";
import { loadEventView } from "@/lib/event-view";
import { readUnreadPhotos } from "@/lib/photo-price";
import { AutoRefresh } from "@/components/auto-refresh";
import { eventFlyerSections } from "@/lib/service";
import { exportWarnings } from "@/lib/export-check";
import { getSetting, SETTINGS } from "@/lib/settings";
import { isSocialFormat } from "@/lib/social";
import { publicText } from "@/lib/price-logic";
import { SocialStudio, type SocialData, type SocialItem } from "./social-studio";

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

export default async function SocialPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ format?: string }> }) {
  await requireLogin();
  const { id } = await params;
  const sp = await searchParams;
  const view = await loadEventView(id);
  if (!view) notFound();
  const { event, rows } = view;
  const shown = rows.filter((r) => r.item.inCollage);
  // Noch nicht geprüfte Fotos jetzt lesen lassen, damit kein eingebrannter Preis doppelt erscheint.
  const reading = await readUnreadPhotos(id, shown.filter((r) => r.state.unread).map((r) => r.product.id));
  const items: SocialItem[] = shown.map(({ item, product, state }) => ({
    id: item.id,
    image: product.imageFileId ? `/datei/${product.imageFileId}` : null,
    name: publicText(product.name),
    variant: product.variant ? publicText(product.variant) || null : null,
    price: item.price,
    priceNote: item.priceNote,
    unit: item.unit,
    unitCount: item.unitCount,
    caption: item.caption,
    printed: state.printed,
    plan: state.plan,
  }));
  const sections = eventFlyerSections(rows);
  const social = (await getSetting<{ handle?: string; tags?: string }>(SETTINGS.social)) ?? {};
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
    <div className="stack">
      <div><h2>Social Media</h2><div className="small muted">{items.length} Produkte mit Häkchen „Collage“ · <Link href={`/verteilung/${id}/ausgabe`}>andere Ausgabe wählen</Link></div></div>
      <AutoRefresh active={reading > 0} />
      {reading > 0 && <div className="notice notice-info">📷 {reading} Foto(s) werden gerade auf eingebrannte Preise geprüft – die Vorschau aktualisiert sich gleich.</div>}
      {items.length === 0
        ? <div className="card card-pad muted">Keine Produkte mit Häkchen „Collage“.</div>
        : <SocialStudio eventId={id} data={data} items={items} sections={sections} format={isSocialFormat(sp.format) ? sp.format : "story"} highlightIds={event.highlights ?? []} settings={{ handle: social.handle ?? "", tags: social.tags ?? "" }} warnings={exportWarnings(shown)} />}
    </div>
  );
}
