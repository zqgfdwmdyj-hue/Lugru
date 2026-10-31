import { notFound, redirect } from "next/navigation";
import { requireArea } from "@/lib/auth/session";
import { productDetail } from "@/lib/products/service";
import { ProductHub, type Tab } from "../../ui";

export const metadata = { title: "Produkt" };

/** Einzelne SKU: gehört sie zu einem Produkt, weiter zur Produktseite (SKU hervorgehoben); sonst eigene Ansicht. */
export default async function SkuPage({ params, searchParams }: { params: Promise<{ sku: string }>; searchParams: Promise<{ tab?: string; von?: string; zeitraum?: string }> }) {
  const session = await requireArea("wawi");
  const raw = (await params).sku;
  let sku = raw;
  try {
    sku = decodeURIComponent(raw);
  } catch {
    // schon dekodiert (enthält z. B. ein einzelnes „%“)
  }
  sku = sku.trim();
  if (!sku || sku.length > 200) notFound();
  const sp = await searchParams;
  const d = await productDetail(session.tenantId, { sku });
  if (!d) notFound();
  if (d.group.productId) {
    const u = new URLSearchParams({ sku });
    if (sp.tab) u.set("tab", sp.tab);
    if (sp.von) u.set("von", sp.von);
    redirect(`/produkte/${d.group.productId}?${u}`);
  }
  return <ProductHub session={session} d={d} base={`/produkte/sku/${encodeURIComponent(sku)}`} tab={(sp.tab ?? "stammdaten") as Tab} von={sp.von} highlight={sku} zeitraum={sp.zeitraum} />;
}
