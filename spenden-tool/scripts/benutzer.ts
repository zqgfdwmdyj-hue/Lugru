// Notfall-Zugang auf dem Server: Zugang anlegen oder Passwort zurücksetzen, z. B. wenn der Admin sein Passwort
// vergessen hat.
//   docker compose exec app npx tsx scripts/benutzer.ts <anmeldename> <neues-passwort> [--admin]
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { users } from "../src/db/schema";
import { hashPassword, MIN_PASSWORD, normalizeLogin } from "../src/lib/password";

const [rawLogin, password, ...flags] = process.argv.slice(2);
const login = normalizeLogin(rawLogin ?? "");
if (!login || !password) {
  console.error("Aufruf: npx tsx scripts/benutzer.ts <anmeldename> <neues-passwort> [--admin]");
  process.exit(1);
}
if (password.length < MIN_PASSWORD) {
  console.error(`Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`);
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);
const admin = flags.includes("--admin");
const passwordHash = await hashPassword(password);
const [existing] = await db.select().from(users).where(eq(users.login, login));
if (existing) {
  await db.update(users).set({ passwordHash, active: true, ...(admin ? { isAdmin: true } : {}) }).where(eq(users.id, existing.id));
  console.log(`Passwort für „${login}“ neu gesetzt${admin ? " (Admin)" : ""}, Zugang ist aktiv.`);
} else {
  await db.insert(users).values({ name: rawLogin, login, passwordHash, isAdmin: admin });
  console.log(`Zugang „${login}“ angelegt${admin ? " (Admin)" : ""}.`);
}
await pool.end();
