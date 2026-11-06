import type { Metadata } from "next";
import { requireArea } from "@/lib/auth/session";
import { eingangsOrdner } from "@/lib/rechnungsstation/service";
import { RechnungsStation } from "./station";

export const metadata: Metadata = { title: "Rechnungsstation – Seller-System" };

// Buchhaltung → Rechnungsstation (Vollbild an der Werkbank, iPad oder Monitor): Blatt auflegen → Kamera erkennt,
// fotografiert, entzerrt → KI liest → Kachel am Rand. VA darf sie bedienen (Bereich Service), ebenso Buchhaltung/Geld.
export default async function RechnungsstationPage() {
  const s = await requireArea("service", "buchhaltung", "geld");
  return <RechnungsStation nurAnsehen={s.readOnly} ordner={Boolean(eingangsOrdner())} />;
}
