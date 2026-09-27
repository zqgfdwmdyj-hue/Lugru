import { requireSession } from "@/lib/auth/session";
import { App } from "@/components/ebay/App";
import { initialView } from "@/components/ebay/view";
import "@/components/ebay/ebay.css";

// eBay-Listing-Tool (übernommen aus dem bisherigen LuGru eBay-Tool): suchen → Listing wählen →
// Einkauf und Preis → Vorschau → veröffentlichen. Dazu Artikel, Verlauf, Rechnungen, Einstellungen.

export default async function EbayPage({ searchParams }: { searchParams: Promise<{ ansicht?: string; id?: string; tab?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  const view = initialView(sp.ansicht, sp.id, sp.tab);
  return (
    <div className="ebt">
      <App key={`${sp.ansicht ?? ""}|${sp.id ?? ""}|${sp.tab ?? ""}`} initial={view} />
    </div>
  );
}
