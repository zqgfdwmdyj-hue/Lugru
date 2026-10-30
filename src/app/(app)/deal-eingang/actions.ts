"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireArea } from "@/lib/auth/session";
import { DealEingangFehler, eingangAnlegen, eingangPruefen, statusSetzen, STATUS_TEXT, tokenAnlegen, tokenWiderrufen, zeileAendern, type EingangDatei } from "@/lib/deal-eingang/service";
import { lesbarerFehler } from "@/lib/fehler-text";
import { parseAmount } from "@/lib/numbers";

const PFAD = "/deal-eingang";
const mit = (pfad: string, meldung: string) => `${pfad}${pfad.includes("?") ? "&" : "?"}meldung=${encodeURIComponent(meldung)}`;

async function schreibend() {
  const s = await requireArea("dealeingang");
  if (s.readOnly) redirect(mit(PFAD, "Nur ansehen – Änderungen sind gesperrt."));
  return s;
}

export async function eingangAction(fd: FormData) {
  const s = await schreibend();
  const dateien: EingangDatei[] = [];
  for (const f of fd.getAll("datei")) if (f instanceof File && f.size) dateien.push({ name: f.name, mime: f.type || "application/octet-stream", bytes: new Uint8Array(await f.arrayBuffer()) });
  let ziel: string;
  try {
    const r = await eingangAnlegen(s.tenantId, s.userId, { weg: "manuell", text: String(fd.get("text") ?? ""), dateien, quelle: String(fd.get("quelle") ?? "") || null });
    if (r.neu) after(() => eingangPruefen(s.tenantId, r.id));
    ziel = mit(`${PFAD}/${r.id}`, r.neu ? "Wird geprüft – die Seite aktualisiert sich gleich." : "Diesen Eingang gibt es schon (letzte 24 Stunden).");
  } catch (e) {
    ziel = mit(PFAD, e instanceof DealEingangFehler ? e.message : `Nicht gespeichert – ${lesbarerFehler(e)}`);
  }
  redirect(ziel);
}

export async function neuPruefenAction(fd: FormData) {
  const s = await schreibend();
  const id = String(fd.get("id"));
  await eingangPruefen(s.tenantId, id);
  revalidatePath(`${PFAD}/${id}`);
  redirect(mit(`${PFAD}/${id}`, "Neu geprüft."));
}

export async function zeileAction(fd: FormData) {
  const s = await schreibend();
  const id = String(fd.get("id"));
  const nr = Number(fd.get("nr"));
  const t = (k: string) => String(fd.get(k) ?? "").trim();
  const zahl = (k: string) => (t(k) ? parseAmount(t(k)) : null);
  try {
    await zeileAendern(s.tenantId, id, nr, { asin: t("asin").toUpperCase() || null, ean: t("ean").replace(/\D/g, "") || null, ek: zahl("ek"), ekNetto: t("netto") !== "brutto", menge: zahl("menge"), packung: zahl("packung") });
  } catch (e) {
    redirect(mit(`${PFAD}/${id}`, `Nicht neu gerechnet – ${lesbarerFehler(e)}`));
  }
  revalidatePath(`${PFAD}/${id}`);
  redirect(mit(`${PFAD}/${id}`, `Zeile ${nr} neu gerechnet.`));
}

export async function statusAction(fd: FormData) {
  const s = await schreibend();
  const id = String(fd.get("id"));
  const status = String(fd.get("status")) as keyof typeof STATUS_TEXT;
  if (!(status in STATUS_TEXT)) redirect(mit(`${PFAD}/${id}`, "Unbekannter Status."));
  const grund = String(fd.get("grund") ?? "");
  if (status === "verworfen" && !grund.trim()) redirect(mit(`${PFAD}/${id}`, "Bitte einen Grund fürs Verwerfen angeben."));
  await statusSetzen(s.tenantId, id, status, grund);
  revalidatePath(PFAD);
  redirect(mit(`${PFAD}/${id}`, `Status: ${STATUS_TEXT[status]}.`));
}

export type TokenState = { token: string; name: string } | { fehler: string } | null;

/** Neuer Geräte-Schlüssel – nur in der Antwort des Formulars sichtbar, nie in der Adresse oder im Protokoll. */
export async function tokenAnlegenAction(_prev: TokenState, fd: FormData): Promise<TokenState> {
  const s = await requireArea("dealeingang");
  if (s.readOnly) return { fehler: "Nur ansehen – keine Schlüssel." };
  const name = String(fd.get("name") ?? "").trim() || "iPhone";
  const r = await tokenAnlegen(s.tenantId, s.userId, name);
  revalidatePath(`${PFAD}/kurzbefehl`);
  return { token: r.token, name };
}

export async function tokenWiderrufenAction(fd: FormData) {
  const s = await schreibend();
  await tokenWiderrufen(s.tenantId, s.userId, String(fd.get("id")));
  redirect(mit(`${PFAD}/kurzbefehl`, "Schlüssel widerrufen – das Gerät kann nichts mehr senden."));
}

/** „In Bestellvorschläge übernehmen“: Einkaufsentwurf mit empfohlener Menge (zählt in der Liquidität als freigegeben). */
export async function bestellvorschlagAction(fd: FormData) {
  const s = await schreibend();
  const id = String(fd.get("id"));
  const nr = Number(fd.get("nr")) || null;
  let m: string;
  try {
    const { inBestellvorschlaege } = await import("@/lib/deal-eingang/ablauf");
    const r = await inBestellvorschlaege(s.tenantId, s.userId, id, nr);
    m = `${r.zeilen} Zeile${r.zeilen === 1 ? "" : "n"} als Einkaufsentwurf angelegt – unter Einkauf prüfen und bestellen.`;
  } catch (e) {
    m = e instanceof DealEingangFehler ? e.message : `Fehler: ${e instanceof Error ? e.message : String(e)}`;
  }
  revalidatePath(PFAD);
  redirect(mit(`${PFAD}/${id}`, m));
}

/** „Als B2B-Deal anlegen“: Entwurf (nicht freigeschaltet) – Preis je Kunde im B2B-Bereich. */
export async function b2bAction(fd: FormData) {
  const s = await schreibend();
  const id = String(fd.get("id"));
  const nr = Number(fd.get("nr")) || null;
  let m: string;
  try {
    const { alsB2bDeal } = await import("@/lib/deal-eingang/ablauf");
    const r = await alsB2bDeal(s.tenantId, s.userId, id, nr);
    m = `B2B-Deal Nr. ${r.nr} als Entwurf angelegt – Preis je Kunde festlegen, dann freischalten.`;
  } catch (e) {
    m = e instanceof DealEingangFehler ? e.message : `Fehler: ${e instanceof Error ? e.message : String(e)}`;
  }
  revalidatePath(PFAD);
  redirect(mit(`${PFAD}/${id}`, m));
}

/** ProfitPath-Kanäle sofort abrufen (sonst jede Minute automatisch). */
export async function profitPathAction() {
  const s = await schreibend();
  let m: string;
  try {
    const { profitPathAbgleich } = await import("@/lib/deal-eingang/profitpath");
    const z = await profitPathAbgleich(s.tenantId);
    m = z ? `ProfitPath: ${z.neu} neu, ${z.updates} Updates, ${z.uebersprungen} übersprungen.` : "ProfitPath ist nicht eingerichtet oder läuft gerade.";
  } catch (e) {
    m = `ProfitPath: ${e instanceof Error ? e.message : String(e)}`;
  }
  revalidatePath(PFAD);
  redirect(mit(PFAD, m));
}
