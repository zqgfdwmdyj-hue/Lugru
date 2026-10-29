import { einladungGueltig } from "@/lib/b2b/portal-auth";
import { EinladungFormular } from "../../formulare";

export default async function EinladungPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const z = await einladungGueltig(token);
  if (!z) {
    return (
      <>
        <h1 style={{ margin: 0 }}>Einladung</h1>
        <div className="notice notice-warn" data-testid="einladung-ungueltig">Dieser Link ist abgelaufen oder wurde schon benutzt. Bitte einen neuen Einladungs-Link anfordern.</div>
      </>
    );
  }
  return (
    <>
      <h1 style={{ margin: 0 }}>Willkommen, {z.firma}</h1>
      <div className="small muted">Bitte ein Passwort für das Kundenportal festlegen. Danach sind Sie angemeldet.</div>
      <EinladungFormular token={token} />
    </>
  );
}
