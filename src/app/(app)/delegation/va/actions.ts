"use server";

import { and, eq } from "drizzle-orm";
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
    const z = await vaAbgleich(s.tenantId, new Date(), { manuell: true });
    m = !z
      ? "Abgleich läuft gerade oder der VA-Kanal ist nicht eingerichtet."
      : `Abgeglichen: ${z.nachrichten} neue Nachrichten, ${z.erledigt} erledigt, ${z.rueckfragen} Rückfragen, ${z.auto} automatisch beantwortet${z.erinnerungen ? `, ${z.erinnerungen} Erinnerungen` : ""}${z.anVa ? `, ${z.anVa} automatisch an die VA` : ""}${z.verpasst ? `, ${z.verpasst} Fristen verpasst` : ""}${z.fehler.length ? ` – Fehler: ${z.fehler[0]}` : ""}.`;
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

// ---- VA-Automatik (B18) ----------------------------------------------------------------------------------

const MODI = ["aus", "vorschlag", "automatisch"] as const;

export async function automatikEinstellungenAction(fd: FormData) {
  const s = await requireOwner();
  const { VA_KATEGORIEN, feiertageAusText } = await import("@/lib/va/automatik-logic");
  const modus = String(fd.get("modus") ?? "");
  if (!(MODI as readonly string[]).includes(modus)) zurueck("Modus wählen.");
  const uhrzeit = String(fd.get("uhrzeit") ?? "");
  if (!UHR.test(uhrzeit)) zurueck("Uhrzeit als HH:MM angeben (z. B. 09:00).");
  const schwelle = Number(String(fd.get("schwelle") ?? "").replace(",", "."));
  const maxThreadsTag = Number(fd.get("maxThreadsTag"));
  if (!Number.isFinite(schwelle) || schwelle < 0 || schwelle > 1_000_000) zurueck("Schwelle in € (0 = keine).");
  if (!Number.isInteger(maxThreadsTag) || maxThreadsTag < 1 || maxThreadsTag > 500) zurueck("Höchstens 1–500 neue Threads am Tag.");
  const erinnerungTage = [...new Set(String(fd.get("erinnerungTage") ?? "").split(/[^\d]+/).filter(Boolean).map(Number).filter((n) => n >= 0 && n <= 90))].sort((a, b) => b - a).slice(0, 6);
  const arbeitstage = fd.getAll("arbeitstag").map(Number).filter((n) => n >= 1 && n <= 7);
  const regeln: Record<string, "va" | "ludwig" | "nie"> = {};
  for (const k of VA_KATEGORIEN) {
    const v = String(fd.get(`regel_${k}`) ?? "");
    if (v === "va" || v === "ludwig" || v === "nie") regeln[k] = v;
  }
  const [t] = await db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, s.tenantId));
  const alt = t?.settings ?? {};
  const vorher = alt.va?.automatik ?? {};
  // „seit“: ab dem Umschalten auf „automatisch“ – ältere Ansprüche gehen nicht von selbst an die VA.
  const seit = modus === "automatisch" ? (vorher.modus === "automatisch" && vorher.seit ? vorher.seit : new Date().toISOString()) : null;
  await db
    .update(schema.tenants)
    .set({
      settings: {
        ...alt,
        va: {
          ...(alt.va ?? {}),
          automatik: { ...vorher, modus: modus as (typeof MODI)[number], seit, schwelle, maxThreadsTag, uhrzeit, erinnerungTage, arbeitstage, feiertage: feiertageAusText(String(fd.get("feiertage") ?? "")), tagesuebersicht: fd.get("tagesuebersicht") === "on", regeln },
        },
      },
    })
    .where(eq(schema.tenants.id, s.tenantId));
  zurueck(modus === "automatisch" && vorher.modus !== "automatisch" ? "Automatik ist an – neue Ansprüche und Fälle gehen ab jetzt nach den Regeln an die VA." : "Automatik gespeichert.");
}

/** Einzelne Entscheidung von Hand an die VA geben („erst Ludwig“ bzw. Vorschlag). */
export async function automatikAnVaAction(fd: FormData) {
  const s = await requireOwner();
  const id = String(fd.get("id") ?? "");
  if (!ID.test(id)) zurueck("Eintrag fehlt.");
  const [e] = await db.select().from(schema.vaAutomatik).where(and(eq(schema.vaAutomatik.tenantId, s.tenantId), eq(schema.vaAutomatik.id, id)));
  if (!e) zurueck("Eintrag nicht gefunden.");
  let m: string;
  if (e!.typ === "anspruch") {
    const { anspruchAnVa } = await import("@/lib/va/automatik");
    const r = await anspruchAnVa(s.tenantId, e!.bezugId, { userId: s.userId }).catch((x) => ({ ok: false as const, fehler: x instanceof Error ? x.message : String(x) }));
    m = r.ok ? "Anspruch ist bei der VA (eigener Thread)." : r.fehler;
  } else {
    const { fallAnVa } = await import("@/lib/amazon-faelle/service");
    const r = await fallAnVa(s.tenantId, e!.bezugId, s.userId).catch((x) => ({ ok: false as const, fehler: x instanceof Error ? x.message : String(x) }));
    m = r.ok ? "Fall ist bei der VA (Thread mit Paket)." : r.fehler;
  }
  revalidatePath("/");
  zurueck(m);
}
