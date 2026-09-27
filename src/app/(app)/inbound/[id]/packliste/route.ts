import { getSession } from "@/lib/auth/session";
import { loadShipment } from "@/lib/inbound/service";

const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

// Packliste: je Artikel die Menge und die Aufteilung auf Kartons (+ Kartonmaße).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });
  const { id } = await params;
  const view = /^[0-9a-f-]{36}$/i.test(id) ? await loadShipment(session.tenantId, id) : null;
  if (!view) return new Response("Nicht gefunden", { status: 404 });
  const boxes = view.boxes;
  const header = ["SKU", "FNSKU", "ASIN", "Titel", "Menge", ...boxes.map((b) => `Karton ${b.number}`)];
  const lines = view.items.map(({ item }) => [
    item.sku, item.fnsku, item.asin, item.title, item.scannedQuantity,
    ...boxes.map((b) => view.boxItems.find((bi) => bi.boxId === b.id && bi.itemId === item.id)?.quantity ?? 0),
  ]);
  const dims = [
    ["Kartongewicht (kg)", "", "", "", "", ...boxes.map((b) => b.weightKg ?? "")],
    ["Kartonlänge (cm)", "", "", "", "", ...boxes.map((b) => b.lengthCm ?? "")],
    ["Kartonbreite (cm)", "", "", "", "", ...boxes.map((b) => b.widthCm ?? "")],
    ["Kartonhöhe (cm)", "", "", "", "", ...boxes.map((b) => b.heightCm ?? "")],
  ];
  const csv = "﻿" + [header, ...lines, [], ...dims].map((r) => r.map(q).join(";")).join("\r\n");
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="Packliste_${view.shipment.name.replace(/[^\w.-]+/g, "_")}.csv"` },
  });
}
