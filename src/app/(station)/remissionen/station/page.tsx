import type { Metadata } from "next";
import { requireArea } from "@/lib/auth/session";
import { stationStand } from "@/lib/retouren-station/service";
import { Station } from "./station";

export const metadata: Metadata = { title: "Retouren-Station – Seller-System" };

export default async function RetourenStationPage() {
  const session = await requireArea("amazon");
  return <Station initial={await stationStand(session, null)} />;
}
