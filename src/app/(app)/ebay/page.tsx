import { requireSession } from "@/lib/auth/session";
import { App } from "@/components/ebay/App";
import { initialView } from "@/components/ebay/view";
import "@/components/ebay/ebay.css";

// eBay-Listing-Tool (übernommen aus dem bisherigen LuGru eBay-Tool): suchen → Listing wählen →
// Einkauf und Preis → Vorschau → veröffentlichen. Dazu Artikel, Verlauf, Rechnungen, Einstellungen.

type Params = { ansicht?: string; id?: string; tab?: string; q?: string; ek?: string; vk?: string; quelle?: string; menge?: string };

export default async function EbayPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireSession();
  const sp = await searchParams;
  const view = initialView(sp.ansicht, sp.id, sp.tab);
  // Vorbelegung (z. B. aus Lieferanten-Feed oder Listings): EAN/Titel suchen, EK, VK und Quelle eintragen.
  const cut = (v: string | undefined, n: number) => (v ? v.slice(0, n) : undefined);
  const prefill = sp.q ? { q: sp.q.slice(0, 200), ek: cut(sp.ek, 20), vk: cut(sp.vk, 20), quelle: cut(sp.quelle, 120), menge: cut(sp.menge, 10) } : undefined;
  return (
    <div className="ebt">
      <App key={`${sp.ansicht ?? ""}|${sp.id ?? ""}|${sp.tab ?? ""}|${sp.q ?? ""}`} initial={view} prefill={prefill} />
    </div>
  );
}
