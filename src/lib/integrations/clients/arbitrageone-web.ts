import "server-only";
import { registerTester } from "../test";

// ArbitrageOne: „Verbindung testen“ – anmelden und auf der Export-Seite jede Karte suchen (nichts herunterladen).
registerTester("arbitrageone_web", async (values, tenantId) => {
  const { aoVerbindungTesten } = await import("@/lib/arbitrageone/abruf");
  return aoVerbindungTesten(tenantId, values);
});
