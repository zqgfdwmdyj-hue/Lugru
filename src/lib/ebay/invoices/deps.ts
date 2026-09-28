import "server-only";
import { sendMail, senderMailboxes } from "@/lib/mail/accounts";
import type { Db } from "../db/db";
import { baseInvoiceDeps } from "../routes/invoices";
import type { InvoiceDeps } from "./service";
import { getInvoiceSettings } from "./store";

/** Rechnungsversand über die Postfächer des Hauptsystems – kein eigener SMTP-Zugang mehr im eBay-Tool. */
export function invoiceDeps(db: Db, tenantId: string): InvoiceDeps {
  return {
    ...baseInvoiceDeps(db),
    mailer: async () => {
      const s = await getInvoiceSettings(db);
      return async (mail) => {
        await sendMail(
          tenantId,
          {
            to: mail.to,
            subject: mail.subject,
            text: mail.text,
            replyTo: s.email || undefined,
            attachments: mail.attachment ? [{ filename: mail.attachment.filename, content: Buffer.from(mail.attachment.content), contentType: "application/pdf" }] : undefined,
          },
          { mailboxId: s.senderMailboxId, fromName: s.companyName || undefined },
        );
      };
    },
    senders: async () => {
      const { boxes, defaultId } = await senderMailboxes(tenantId);
      return boxes.map((b) => ({ id: b.id, address: b.address, isDefault: b.id === defaultId }));
    },
  };
}
