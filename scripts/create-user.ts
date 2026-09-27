// Legt einen Benutzer an – und bei Bedarf die Firma (Mandant) dazu.
//   npm run user:create -- --email du@firma.de --name "Dein Name" --firma "Deine Firma" [--passwort ...]
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { STARTER_KNOWLEDGE } from "./starter-content";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    firma: { type: "string" },
    passwort: { type: "string" },
    rolle: { type: "string", default: "owner" },
  },
});
if (!values.email || !values.firma) {
  console.error('Aufruf: npm run user:create -- --email du@firma.de --firma "Deine Firma" [--name "Name"] [--passwort ...]');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });
const password = values.passwort ?? randomBytes(9).toString("base64url");
const role = values.rolle === "staff" ? "staff" : "owner";

await db.transaction(async (tx) => {
  let [tenant] = await tx.select().from(schema.tenants).where(eq(schema.tenants.name, values.firma!));
  const newTenant = !tenant;
  if (!tenant) {
    [tenant] = await tx.insert(schema.tenants).values({ name: values.firma!, settings: { vatRate: 0.19, importReminderDays: 7 } }).returning();
    await tx.insert(schema.knowledgeEntries).values(STARTER_KNOWLEDGE.map((k) => ({ ...k, tenantId: tenant.id })));
  }

  let [user] = await tx.select().from(schema.users).where(eq(sql`lower(${schema.users.email})`, values.email!.toLowerCase()));
  const hash = await bcrypt.hash(password, 12);
  if (user) {
    await tx.update(schema.users).set({ passwordHash: hash, name: values.name ?? user.name }).where(eq(schema.users.id, user.id));
  } else {
    [user] = await tx.insert(schema.users).values({ email: values.email!, name: values.name ?? null, passwordHash: hash }).returning();
  }
  await tx.insert(schema.memberships).values({ tenantId: tenant.id, userId: user.id, role }).onConflictDoNothing();

  if (newTenant) {
    await tx.insert(schema.tasks).values([
      { tenantId: tenant.id, title: "Wissensdatenbank mit eigenen Abläufen füllen", category: "eigene", link: "/wissen" },
    ]);
  }
  console.log(`${newTenant ? "Firma angelegt" : "Firma vorhanden"}: ${tenant.name}`);
  console.log(`Benutzer: ${user.email} (${role})`);
  if (!values.passwort) console.log(`Passwort: ${password}`);
});
await pool.end();
