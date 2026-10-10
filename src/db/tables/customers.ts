import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, updatedAt } from "./core";
import { encryptedText } from "./encrypted";

/** Firmenkunden für B2B-Rechnungen – beim Rechnungschreiben gespeichert und wieder vorgeschlagen. */
export const customers = pgTable(
  "customers",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    contact: encryptedText("contact"),
    street: encryptedText("street").notNull(),
    zip: text("zip").notNull(),
    city: text("city").notNull(),
    country: text("country").notNull().default("DE"),
    vatId: text("vat_id"),
    email: encryptedText("email"),
    customerNumber: text("customer_number"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("customers_name_uq").on(t.tenantId, t.name)],
);
