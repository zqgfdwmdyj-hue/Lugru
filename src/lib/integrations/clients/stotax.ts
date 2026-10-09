import "server-only";
import { senderMailboxes } from "@/lib/mail/accounts";
import { MAIL2SELECT } from "@/lib/invoices/stotax";
import { registerTester } from "../test";

// Stotax Select: Belege per Mail2Select. Der Test schickt bewusst nichts – jede Mail würde
// in Stotax einen Beleg anlegen.
registerTester("stotax", async (v, tenantId) => {
  const address = (v.address ?? "").trim();
  if (!MAIL2SELECT.test(address)) throw new Error("Die Adresse muss auf @mail2select.de enden (in Stotax Select unter Mail2Select festgelegt).");
  const { boxes, defaultId } = await senderMailboxes(tenantId);
  const box = boxes.find((b) => b.id === defaultId);
  if (!box) throw new Error("Kein Absender-Postfach verbunden – bitte unter Posteingang ein Postfach verbinden.");
  return `Bereit: Rechnungen gehen als PDF an ${address} (Absender ${box.address}${v.auto === "nein" ? ", nur per Knopf" : ", automatisch"}).`;
});
