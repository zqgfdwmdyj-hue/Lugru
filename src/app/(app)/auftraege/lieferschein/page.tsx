import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { getIntegration } from "@/lib/integrations/store";
import { imCreds } from "@/lib/integrations/clients/deutschepost";
import { getSettings } from "@/lib/settings";
import { SlipForm } from "./slip-form";
import { readOrders } from "@/lib/shipping/slip-service";
import { weightOverview } from "@/lib/shipping/weights-service";

// Amazon-Lieferschein hochladen oder offene Aufträge (eBay …) übernehmen → je Bestellung automatisch
// Warensendung (1 Stück) oder DHL (ab 2 Stück) → alle Labels in einem Schritt, ein PDF zum Drucken.
export default async function LieferscheinPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const session = await requireArea("wawi");
  const sp = await searchParams;
  // Auswahl aus der Auftragsliste („Labels automatisch“).
  const ids = (sp.ids ?? "").split(",").filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  const initial = ids.length ? { rows: await readOrders(session.tenantId, ids) } : null;
  const weights = await weightOverview(session.tenantId);
  const [settings, post, dhl] = await Promise.all([getSettings(session.tenantId), getIntegration(session.tenantId, "deutschepost"), getIntegration(session.tenantId, "dhl")]);
  const shipperOk = Boolean(settings.shipper.name1 && settings.shipper.street && settings.shipper.zip && settings.shipper.city);
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/auftraege">Aufträge & Versand</Link></div><h1>Labels: Warensendung & DHL</h1></div>
        <form action="/auftraege" className="orders-search" data-testid="slip-search" style={{ maxWidth: 420 }}>
          <label htmlFor="slq" className="sr-only">Auftrag suchen</label>
          <input id="slq" name="q" type="search" className="input" placeholder="Schon erledigt? Name suchen" />
          <button className="btn" type="submit">Suchen</button>
        </form>
      </div>
      {!shipperOk && <div className="notice notice-warn small">Absenderadresse fehlt – <Link href="/einstellungen">Einstellungen → Versand</Link>.</div>}
      <SlipForm postReady={Boolean(imCreds(post))} dhlReady={Boolean(dhl?.apiKey && dhl.username && dhl.password)} postPrice={settings.post.price} sandbox={settings.dhl.sandbox} initial={initial} weights={weights} />
    </>
  );
}
