import { ORDER_TEMPLATE_HEADERS } from "@/lib/orders/csv";

export async function GET() {
  const example = ["ebay", "12-34567-89012", "27.09.2026", "Max Mustermann", "", "Musterstraße", "12", "12345", "Musterstadt", "DE", "max@example.com", "", "SKU-123", "Beispielartikel", "1", "19,99", "29.09.2026"];
  const csv = "﻿" + [ORDER_TEMPLATE_HEADERS.join(";"), example.join(";")].join("\r\n") + "\r\n";
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="Auftraege_Vorlage.csv"' } });
}
