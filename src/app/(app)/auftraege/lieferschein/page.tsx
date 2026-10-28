import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { getIntegration } from "@/lib/integrations/store";
import { imCreds } from "@/lib/integrations/clients/deutschepost";
import { getSettings } from "@/lib/settings";
import { SlipForm } from "./slip-form";

// Amazon-Lieferschein hochladen → je Bestellung automatisch Warensendung (1 Stück) oder DHL (ab 2 Stück) →
// alle Labels in einem Schritt, ein PDF zum Drucken.
export default async function LieferscheinPage() {
  const session = await requireArea("wawi");
  const [settings, post, dhl] = await Promise.all([getSettings(session.tenantId), getIntegration(session.tenantId, "deutschepost"), getIntegration(session.tenantId, "dhl")]);
  const shipperOk = Boolean(settings.shipper.name1 && settings.shipper.street && settings.shipper.zip && settings.shipper.city);
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/auftraege">Aufträge & Versand</Link></div><h1>Lieferschein → Labels</h1></div>
      </div>
      {!shipperOk && <div className="notice notice-warn small">Absenderadresse fehlt – <Link href="/einstellungen">Einstellungen → Versand</Link>.</div>}
      <SlipForm postReady={Boolean(imCreds(post))} dhlReady={Boolean(dhl?.apiKey && dhl.username && dhl.password)} postPrice={settings.post.price} sandbox={settings.dhl.sandbox} />
    </>
  );
}
