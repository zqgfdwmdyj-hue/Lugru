import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { encryptLegacyPii } from "./encrypt-pii";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
const done = Object.entries(await encryptLegacyPii(pool)).filter(([, n]) => n > 0);
if (done.length) console.log(`Empfängerdaten verschlüsselt: ${done.map(([t, n]) => `${t} ${n}`).join(", ")}`);
await pool.end();
console.log("Datenbank ist auf dem neuesten Stand.");
