import { redirect } from "next/navigation";
import { portalSitzung } from "@/lib/b2b/portal-auth";
import { AnmeldeFormular } from "../formulare";

export default async function PortalLoginPage() {
  if (await portalSitzung()) redirect("/portal");
  return (
    <>
      <h1 style={{ margin: 0 }}>Kundenportal – Anmelden</h1>
      <div className="small muted">Zugang nur auf Einladung. Passwort vergessen? Bitte melden – Sie bekommen einen neuen Einladungs-Link.</div>
      <AnmeldeFormular />
    </>
  );
}
