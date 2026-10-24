import { notFound } from "next/navigation";
import { requireArea } from "@/lib/auth/session";
import { productDetail } from "@/lib/products/service";
import { ProductHub, type Tab } from "../ui";

export const metadata = { title: "Produkt" };

export default async function ProduktPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; von?: string; sku?: string; zeitraum?: string }> }) {
  const session = await requireArea("wawi");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const d = await productDetail(session.tenantId, { productId: id });
  if (!d) notFound();
  return <ProductHub session={session} d={d} base={`/produkte/${id}`} tab={(sp.tab ?? "stammdaten") as Tab} von={sp.von} highlight={sp.sku} zeitraum={sp.zeitraum} />;
}
