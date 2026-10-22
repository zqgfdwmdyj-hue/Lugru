import "server-only";
import { registerTester } from "../test";
import { ebayAppTokenFuer } from "@/lib/lugru-deals/ebay-token";
import { MIN_SCHLUESSEL } from "@/lib/lugru-deals/schluessel";

registerTester("lugru_deals", async (v, tenantId) => {
  if ((v.schluessel ?? "").length < MIN_SCHLUESSEL) {
    throw new Error(`Der Verbindungsschlüssel braucht mindestens ${MIN_SCHLUESSEL} Zeichen.`);
  }
  const { env } = await ebayAppTokenFuer(tenantId);
  return `eBay-Token erhalten (${env === "production" ? "Produktion" : "Sandbox"}) – Lugru Deals kann sich jetzt verbinden.`;
});
