import "server-only";
import { registerTester } from "../test";

// B23: „Verbindung testen“ für die BQool-Anmeldung der Browser-Automatik – anmelden und je Land die Upload-Seite
// aufrufen (ohne Upload). Zwei-Faktor-Anmeldung wird klar gemeldet.
registerTester("bqool_web", async (values, tenantId) => {
  const { bqoolVerbindungTesten } = await import("@/lib/automatik/uebertragen");
  return bqoolVerbindungTesten(tenantId, values);
});
