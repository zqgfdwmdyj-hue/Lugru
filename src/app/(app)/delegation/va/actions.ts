"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { antwortAnVa, antwortVorschau, anVaGeben, vaAbgleich } from "@/lib/va/service";
import { glossarAusText } from "@/lib/va/sprache";

// VA über Discord (nur Inhaber): abgleichen, Aufgabe an die VA geben, antworten, Einstellungen.

const ID = /^[0-9a-f-]{36}$/i;
const zurueck = (m: string) => {
  revalidatePath("/delegation/va");
  redirect(`/delegation/va?meldung=${encodeURIComponent(m)}`);
};

export async function abgleichAction() {
  const s = await requireOwner();
  let m: string;
  try {
    const z = await vaAbgleich(s.tenantId);
    m = !z
      ? "Abgleich läuft gerade oder der VA-Kanal ist nicht eingerichtet."
      : `Abgeglichen: ${z.nachrichten} neue Nachrichten, ${z.erledigt} erledigt, ${z.rueckfragen} Rückfragen, ${z.auto} automatisch beantwortet${z.erinnerungen ? `, ${z.erinnerungen} Erinnerungen` : ""}${z.fehler.length ? ` – Fehler: ${z.fehler[0]}` : ""}.`;
  } catch (e) {
    m = `Abgleich fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`;
  }
  zurueck(m);
}

export async function anVaAction(fd: FormData) {
  const s = await requireOwner();
  const id = String(fd.get("id") ?? "");
  if (!ID.test(id)) zurueck("Bitte eine Aufgabe wählen.");
  const r = await anVaGeben(s.tenantId, id, String(fd.get("notiz") ?? "").trim().slice(0, 1500) || null).catch((e) => ({ ok: false as const, fehler: e instanceof Error ? e.message : String(e) }));
  revalidatePath("/");
  zurueck(r.ok ? (r.neu ? "An die VA gegeben – Thread im VA-Kanal angelegt." : "An die VA gegeben – im bestehenden Thread erneut gemeldet.") : r.fehler);
}

export async function antwortAction(fd: FormData) {
  const s = await requireOwner();
  const id = String(fd.get("nachricht") ?? "");
  const text = String(fd.get("text") ?? "").trim();
  if (!ID.test(id) || !text) zurueck("Antwort fehlt.");
  const englisch = String(fd.get("englisch") ?? "").trim() || null;
  const r = await antwortAnVa(s.tenantId, { nachrichtId: id }, text, s.name, { englisch }).catch((e) => ({ ok: false as const, fehler: e instanceof Error ? e.message : String(e) }));
  revalidatePath("/");
  zurueck(r.ok ? "Antwort ist im Thread der VA." : r.fehler);
}

const UHR = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function einstellungenAction(fd: FormData) {
  const s = await requireOwner();
  const zeitzone = String(fd.get("zeitzone") ?? "").trim();
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: zeitzone });
  } catch {
    zurueck(`Unbekannte Zeitzone „${zeitzone}“ – z. B. Europe/Berlin oder Asia/Manila.`);
  }
  const ruheVon = String(fd.get("ruheVon") ?? "");
  const ruheBis = String(fd.get("ruheBis") ?? "");
  if (!UHR.test(ruheVon) || !UHR.test(ruheBis)) zurueck("Ruhezeit als HH:MM angeben.");
  const [t] = await db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, s.tenantId));
  const alt = t?.settings ?? {};
  await db
    .update(schema.tenants)
    .set({
      settings: {
        ...alt,
        va: {
          ...(alt.va ?? {}),
          zeitzone,
          ruheVon,
          ruheBis,
          erinnerungUeberfaellig: fd.get("erinnerungUeberfaellig") === "on",
          darfEinkaufsrechnungen: fd.get("darfEinkaufsrechnungen") === "on",
          ...(fd.has("sprache") ? { sprache: fd.get("sprache") === "de" ? ("de" as const) : ("en" as const), antwortVorschau: fd.get("antwortVorschau") === "on" } : {}),
          ...(fd.has("glossar") ? { glossar: glossarAusText(String(fd.get("glossar") ?? "").slice(0, 5000)) } : {}),
        },
      },
    })
    .where(eq(schema.tenants.id, s.tenantId));
  zurueck("Einstellungen gespeichert.");
}

/** Englische Fassung einer Antwort zeigen (bearbeitbar, bevor sie gesendet wird). */
export async function vorschauAction(text: string): Promise<{ text: string; hinweis: string }> {
  const s = await requireOwner();
  const t = text.trim().slice(0, 3800);
  if (!t) return { text: "", hinweis: "Erst die Antwort auf Deutsch schreiben." };
  const v = await antwortVorschau(s.tenantId, t);
  if (v.sprache === "de") return { text: t, hinweis: "Die VA ist auf Deutsch eingestellt – wird so gesendet." };
  return { text: v.text, hinweis: v.uebersetzt ? "Automatisch übersetzt – bei Bedarf anpassen." : "Übersetzung nicht möglich (KI-Schlüssel fehlt?) – bitte selbst auf Englisch schreiben." };
}
