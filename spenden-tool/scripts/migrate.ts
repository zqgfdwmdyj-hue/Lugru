import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { photoHash } from "../src/lib/image-hash";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });

// Fingerabdrücke für Fotos nachtragen, die vor der Doppelt-Erkennung hochgeladen wurden.
let done = 0;
for (;;) {
  const { rows } = await pool.query<{ id: string; data: Buffer }>("select id, data from files where phash is null limit 50");
  if (rows.length === 0) break;
  for (const r of rows) await pool.query("update files set phash = $2 where id = $1", [r.id, (await photoHash(r.data)) ?? ""]);
  done += rows.length;
}
if (done) console.log(`Foto-Fingerabdrücke nachgetragen: ${done}`);

await pool.end();
console.log("Datenbank ist auf dem neuesten Stand.");
