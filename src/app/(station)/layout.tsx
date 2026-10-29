import { requireSession } from "@/lib/auth/session";
import { TestBanner } from "@/components/test-banner";

// Vollbild-Seiten ohne Seitenleiste (Retouren-Station am festen Arbeitsplatz).
export default async function StationLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return (
    <>
      <TestBanner />
      {children}
    </>
  );
}
