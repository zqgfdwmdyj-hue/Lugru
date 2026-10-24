// Prüft vor dem Hochladen, dass keine Lücken oder Entwurfshinweise online gehen.
// Aufruf: npm run pruefen  (Exit-Code 1, solange etwas fehlt)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const wurzel = new URL("../public/", import.meta.url).pathname;
const muster = [/bitte eintragen/i, /Entwurf zur Prüfung/i, /class="fehlt"/];
const funde = [];
function durchsuche(ordner) {
  for (const name of readdirSync(ordner)) {
    const pfad = join(ordner, name);
    if (statSync(pfad).isDirectory()) { durchsuche(pfad); continue; }
    if (!/\.(html|txt|js)$/.test(name)) continue;
    readFileSync(pfad, "utf8").split("\n").forEach((zeile, i) => {
      if (muster.some((m) => m.test(zeile))) funde.push(`${pfad.slice(wurzel.length)}:${i + 1}: ${zeile.trim().replace(/<[^>]+>/g, "").slice(0, 120)}`);
    });
  }
}
durchsuche(wurzel);
if (funde.length) {
  console.error(`Noch nicht fertig – ${funde.length} Stelle(n) fehlen:\n` + funde.map((f) => "  " + f).join("\n"));
  process.exit(1);
}
console.log("Alles ausgefüllt – die Seite kann hochgeladen werden.");
