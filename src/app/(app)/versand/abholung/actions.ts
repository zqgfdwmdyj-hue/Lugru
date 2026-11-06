"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireArea } from "@/lib/auth/session";
import { abholungBuchen, abholungStornieren, abholVorschlag } from "@/lib/abholung/service";
import { DIENST_NAME, datumText } from "@/lib/abholung/logic";

// Versand → Abholung: buchen und stornieren für Inhaber und alle mit „Service“ (auch die VA). Abholorte (Stammdaten)
// und Zugangsdaten nur der Inhaber – unter Einstellungen → Abholung bzw. Anbindungen.

const ziel = (p: Record<string, string>) => `/versand/abholung?${new URLSearchParams(p).toString()}`;
const zahl = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim().replace(",", ".");
  return s === "" ? null : Number(s);
};

export async function abholungBuchenAction(fd: FormData) {
  const s = await requireArea("service");
  if (s.readOnly) redirect(ziel({ fehler: "Nur ansehen – mit diesem Zugang wird nichts gebucht." }));
  const dienst = fd.get("dienst") === "ups" ? "ups" : "dhl";
  const pakete = zahl(fd.get("pakete"));
  if (pakete === null || !Number.isInteger(pakete)) redirect(ziel({ dienst, fehler: "Anzahl Pakete bitte als ganze Zahl." }));
  const r = await abholungBuchen(
    s.tenantId,
    { userId: s.userId, name: s.name || s.email },
    {
      dienst,
      datum: String(fd.get("datum") ?? "").trim() || null,
      von: String(fd.get("von") ?? "").trim() || null,
      bis: String(fd.get("bis") ?? "").trim() || null,
      pakete: pakete!,
      paletten: zahl(fd.get("paletten")) ?? 0,
      gewichtKg: zahl(fd.get("gewicht")),
      hinweis: String(fd.get("hinweis") ?? "").trim().slice(0, 200) || null,
      ort: String(fd.get("ort") ?? "").trim() || null,
    },
    fd.get("quelle") === "vorschlag" ? "vorschlag" : "seite",
  );
  revalidatePath("/versand/abholung");
  if (!r.ok) redirect(ziel({ dienst, fehler: r.text }));
  redirect(ziel({ dienst, meldung: [r.text, ...r.hinweise].join(" ") }));
}

export async function abholungStornierenAction(fd: FormData) {
  const s = await requireArea("service");
  if (s.readOnly) redirect(ziel({ fehler: "Nur ansehen – mit diesem Zugang wird nichts storniert." }));
  const id = String(fd.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(id)) redirect(ziel({ fehler: "Abholung nicht gefunden." }));
  const r = await abholungStornieren(s.tenantId, { userId: s.userId, name: s.name || s.email }, id);
  revalidatePath("/versand/abholung");
  redirect(ziel(r.ok ? { meldung: r.text } : { fehler: r.text }));
}

/** Vorschlag sofort prüfen (sonst abends automatisch) – legt höchstens die Aufgabe an, bucht nie. */
export async function abholVorschlagPruefenAction() {
  const s = await requireArea("service");
  if (s.readOnly) redirect(ziel({ fehler: "Nur ansehen." }));
  const r = await abholVorschlag(s.tenantId);
  revalidatePath("/versand/abholung");
  redirect(ziel({ meldung: r.length ? r.map((x) => `Vorschlag: ${x.labels} ${DIENST_NAME[x.dienst]}-Labels, für ${datumText(x.tag)} nichts gebucht – Aufgabe „Abholung buchen?“ ${x.neu ? "angelegt (mit Push)" : "aktualisiert"}.`).join(" ") : "Kein Vorschlag nötig: nicht mehr Labels als eingestellt oder Abholung schon gebucht." }));
}
