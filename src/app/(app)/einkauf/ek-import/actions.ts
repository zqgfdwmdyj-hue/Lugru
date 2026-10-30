"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireArea } from "@/lib/auth/session";
import { EkImportFehler, ekImportUebernehmen, ekImportVerwerfen, ekImportVorschau } from "@/lib/ek-import/service";
import { lesbarerFehler } from "@/lib/fehler-text";

const PFAD = "/einkauf/ek-import";
const ziel = (id: string | null, meldung: string) => `${PFAD}?${id ? `id=${id}&` : ""}meldung=${encodeURIComponent(meldung)}`;

async function schreibend() {
  const s = await requireArea("wawi");
  if (s.readOnly) redirect(ziel(null, "Nur ansehen – Änderungen sind gesperrt."));
  return s;
}

export async function vorschauAction(fd: FormData) {
  const s = await schreibend();
  const f = fd.get("datei");
  if (!(f instanceof File) || !f.size) redirect(ziel(null, "Bitte die EK-Liste (ArbitrageOne-Export für sellerboard) wählen."));
  let url: string;
  try {
    const r = await ekImportVorschau(s.tenantId, s.userId, f.name, new Uint8Array(await f.arrayBuffer()));
    url = ziel(r.id, `Vorschau: ${r.zeilen} SKUs – ${r.anzahl.geaendert} geändert, ${r.anzahl.neu} neu, ${r.anzahl.gleich} unverändert, ${r.anzahl.unbekannt} unbekannt. Noch nichts übernommen.`);
  } catch (e) {
    url = ziel(null, e instanceof EkImportFehler ? e.message : `Datei nicht lesbar – ${lesbarerFehler(e)}`);
  }
  redirect(url);
}

export async function uebernehmenAction(fd: FormData) {
  const s = await schreibend();
  const id = String(fd.get("id") ?? "");
  let url: string;
  try {
    const st = await ekImportUebernehmen(s.tenantId, s.userId, id);
    url = ziel(id, `Übernommen: ${st.rows} Chargen (${st.created} neu, ${st.updated} aktualisiert). Jetzt die sellerboard-Importdatei herunterladen bzw. übertragen.`);
  } catch (e) {
    url = ziel(id, e instanceof EkImportFehler ? e.message : `Übernehmen fehlgeschlagen – ${lesbarerFehler(e)}`);
  }
  revalidatePath("/", "layout");
  redirect(url);
}

export async function verwerfenAction(fd: FormData) {
  const s = await schreibend();
  await ekImportVerwerfen(s.tenantId, String(fd.get("id") ?? ""));
  redirect(ziel(null, "Vorschau verworfen – nichts übernommen."));
}
