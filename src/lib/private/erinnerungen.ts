import "server-only";
import { todayIso } from "@/lib/dates";
import { erinnerungHeute, type Jahrestag } from "./familie-termine";
import { inhaberPrivatSitzung } from "./termin-mail-service";
import { loadEntries, privateMembers, updateEntry } from "./service";

// Geburtstage & Jahrestage (Modul 9): Erinnerung 14 Tage vorher (mit Geschenkidee), 3 Tage vorher (Karte/Anruf) und am
// Tag selbst – als Mitteilung nur an Personen mit vollem Privat-Zugang, nie in den Discord-Kanal. Je Stufe einmal.

type Mit = Jahrestag & { erinnert?: string[] };

export async function jahrestagErinnerungen(tenantId: string, heute = todayIso()): Promise<number> {
  const session = await inhaberPrivatSitzung(tenantId);
  if (!session) return 0;
  const liste = await loadEntries<Mit>(session, ["geburtstag"]);
  const empfaenger = (await privateMembers(tenantId)).filter((m) => m.scope === "voll").map((m) => m.userId);
  if (!empfaenger.length) return 0;
  const { melden } = await import("@/lib/push/service");
  let n = 0;
  for (const e of liste) {
    const r = erinnerungHeute(e.data, heute);
    if (!r) continue;
    const key = `${r.tag}:${r.stufe}`;
    if (e.data.erinnert?.includes(key)) continue;
    await melden(tenantId, empfaenger, { titel: r.stufe === 0 ? "Heute" : `In ${r.inTagen} Tagen`, text: r.text, link: "/privat/geburtstage" }, { ohneDiscord: true }).catch(() => null);
    await updateEntry(session, e.id, "geburtstag", { erinnert: [...(e.data.erinnert ?? []), key].slice(-12) });
    n++;
  }
  return n;
}
