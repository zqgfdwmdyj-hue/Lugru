import type { Metadata } from "next";
import Link from "next/link";
import { TestBanner } from "@/components/test-banner";
import { portalSitzung } from "@/lib/b2b/portal-auth";
import { getSettings } from "@/lib/settings";
import { abmeldenAction } from "./actions";

// Kundenportal für B2B-Deals: eigene Anmeldung, eigene Kopfzeile – nichts aus dem Seller-System (keine Seitenleiste,
// keine Suche, kein Fragefeld).

export const metadata: Metadata = { title: "Kundenportal", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const s = await portalSitzung();
  const firma = s ? (await getSettings(s.tenantId)).b2b.firma : null;
  return (
    <>
      <TestBanner />
      <header style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "10px 16px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <b style={{ marginRight: "auto" }}>{firma?.handelsname || firma?.name || "Kundenportal"}</b>
          {s && (
            <nav style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }} className="small" data-testid="portal-nav">
              <Link href="/portal">Deals</Link>
              <Link href="/portal/reservierungen">Meine Reservierungen</Link>
              <Link href="/portal/konto">Mein Konto</Link>
              <span className="muted">{s.firma}</span>
              <form action={abmeldenAction}><button className="btn btn-small" type="submit">Abmelden</button></form>
            </nav>
          )}
        </div>
      </header>
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "16px 16px 48px", display: "grid", gap: 14 }}>{children}</main>
    </>
  );
}
