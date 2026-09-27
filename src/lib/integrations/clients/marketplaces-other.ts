import "server-only";
import { registerTester } from "../test";

// TikTok Shop und Temu: Zugänge für deutsche Händler sind noch uneinheitlich.
// Bis die Schnittstellen freigeschaltet sind, laufen Aufträge über die CSV-Vorlage.
for (const provider of ["tiktok", "temu"]) {
  registerTester(provider, async () => {
    throw new Error("Die Schnittstelle ist vorbereitet, aber noch nicht aktiv. Aufträge bis dahin per CSV-Vorlage importieren.");
  });
}
