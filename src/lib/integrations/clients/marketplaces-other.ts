import "server-only";
import { registerTester } from "../test";

// TikTok Shop: Zugänge für deutsche Händler sind noch uneinheitlich.
// Bis die Schnittstelle freigeschaltet ist, laufen Aufträge über die CSV-Vorlage.
registerTester("tiktok", async () => {
  throw new Error("Die Schnittstelle ist vorbereitet, aber noch nicht aktiv. Aufträge bis dahin per CSV-Vorlage importieren.");
});
