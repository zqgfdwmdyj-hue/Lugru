// Übernimmt die Daten des bisherigen LuGru eBay-Tools (data/lugru.db) in den eBay-Bereich.
//   npm run ebay:import -- --datei /pfad/zu/lugru.db [--email du@firma.de]
// Ohne --email wird die Firma des einzigen Inhabers genommen.
// Vorher das bisherige Tool beenden – dann ist die Datei in sich stimmig, und es vergibt
// keine Rechnungsnummern mehr.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db";
import { importLugruDb } from "../src/lib/ebay/import";

const { values } = parseArgs({ options: { datei: { type: "string" }, email: { type: "string" } } });
if (!values.datei) {
  console.error("Aufruf: npm run ebay:import -- --datei /pfad/zu/lugru.db [--email du@firma.de]");
  process.exit(1);
}

const owners = await db
  .select({ tenantId: schema.memberships.tenantId, email: schema.users.email })
  .from(schema.memberships)
  .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
  .where(eq(schema.memberships.role, "owner"));
const match = values.email ? owners.filter((o) => o.email.toLowerCase() === values.email!.toLowerCase()) : owners;
const tenants = [...new Set(match.map((o) => o.tenantId))];
if (tenants.length !== 1) {
  console.error(values.email ? `Kein Inhaber mit ${values.email} gefunden.` : "Mehrere Firmen vorhanden – bitte --email des Inhabers angeben.");
  process.exit(1);
}

try {
  const r = await importLugruDb(tenants[0], new Uint8Array(readFileSync(values.datei)));
  console.log(`Übernommen: ${r.listings} Angebote, ${r.invoices} Rechnungen${r.lastInvoiceNumber ? ` (zuletzt ${r.lastInvoiceNumber})` : ""}, ${r.settings} Einstellungen, ${r.tokens} Tokens, ${r.idealoPrices} idealo-Preise.`);
  if (r.automationWasOn) console.log("Hinweis: Die Rechnungs-Automatik war eingeschaltet – hier ist sie vorerst aus. Einschalten unter eBay → eBay-Einstellungen → Rechnungen.");
  process.exit(0);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
