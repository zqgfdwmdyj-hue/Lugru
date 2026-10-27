import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLogin } from "@/lib/auth";
import { eventDateLabel } from "@/lib/layout";
import { loadEventView } from "@/lib/event-view";
import { aiConfigured, failStaleChecks } from "@/lib/price-research";
import { failStalePhotoPrices } from "@/lib/photo-price";
import { formatEuro } from "@/lib/numbers";
import { AutoRefresh } from "@/components/auto-refresh";
import { EventTabs } from "./event-tabs";

export default async function VerteilungLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  await requireLogin();
  const { id } = await params;
  // Hängengebliebene KI-Aufträge (z. B. nach einem Server-Update) freigeben, damit die Seite nicht ewig „sucht“.
  if (aiConfigured()) await Promise.all([failStaleChecks(), failStalePhotoPrices()]);
  const view = await loadEventView(id);
  if (!view) notFound();
  const { event, rows, busy } = view;
  const open = rows.filter((r) => r.issues.length > 0).length;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const past = event.eventDate <= today;
  const value = rows.reduce((s, r) => s + (r.item.price ?? 0) * (r.item.quantity ?? 0), 0);
  return (
    <>
      <AutoRefresh active={busy} />
      <div className="crumb"><Link href="/">Verteilungen</Link></div>
      <div className="event-head">
        <h1>{eventDateLabel(event.eventDate)}{event.eventTime ? ` · ${event.eventTime}` : ""}</h1>
        <div className="small muted">{event.title}{event.location ? ` · ${event.location}` : ""} · {rows.length} Produkte{value ? ` · Warenwert ${formatEuro(value)}` : ""}</div>
      </div>
      <EventTabs id={id} open={open} past={past} results={rows.filter((r) => !r.item.outcome).length} />
      {children}
    </>
  );
}
