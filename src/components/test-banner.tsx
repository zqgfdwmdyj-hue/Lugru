import { isTestEnv } from "@/lib/testenv";

/** Unübersehbar oben auf jeder Seite der Testumgebung – damit niemand sie mit dem echten System verwechselt. */
export function TestBanner() {
  if (!isTestEnv()) return null;
  return (
    <div className="test-banner" role="note" data-testid="test-banner">
      🧪 <strong>TESTUMGEBUNG</strong> – erfundene Daten · Mails werden abgefangen · nichts geht an Amazon, eBay, Post, DHL oder andere Dienste
    </div>
  );
}
