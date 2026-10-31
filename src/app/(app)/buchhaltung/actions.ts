"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireArea, requireOwner } from "@/lib/auth/session";
import { abgleichLaufen, amexImportieren, belegeAnfordern, belegFirmaSetzen, buchhaltungStatus, buchungAendern, buchungenBestaetigen, buchungStornieren, BuchhaltungFehler, monatFestschreiben, monatOk, sparkasseImportieren, ustBerichtImportieren, zuordnungAblehnen, zuordnungBestaetigen, zuordnungManuell } from "@/lib/buchhaltung/service";
import { importMeldung } from "@/lib/bank/service";
import { parseAmount } from "@/lib/numbers";

// Buchhaltung (Bereich „Geld“): Uploads, Abgleich, Bestätigen, Festschreiben. Alles wird protokolliert.

const ID = /^[0-9a-f-]{36}$/i;
const ziel = (fd: FormData, meldung: string, fehler = false) => {
  const firma = String(fd.get("firma") ?? "");
  const monat = String(fd.get("monat") ?? "");
  const p = new URLSearchParams({ ...(firma ? { firma } : {}), ...(monatOk(monat) ? { monat } : {}), [fehler ? "fehler" : "meldung"]: meldung });
  return `/buchhaltung?${p.toString()}`;
};
async function wer() {
  const s = await requireArea("geld");
  return { tenantId: s.tenantId, userId: s.userId, name: s.name, email: s.email };
}
/** Fehler aus der Buchhaltung als Meldung zurück, alles andere weiterwerfen (redirect wirft selbst). */
async function mit(fd: FormData, fn: () => Promise<string>) {
  let ziel_: string;
  try {
    ziel_ = ziel(fd, await fn());
  } catch (e) {
    if (e instanceof BuchhaltungFehler || (e instanceof Error && /Spalten|Bericht|Datum|PDF|Kontoauszug/.test(e.message))) ziel_ = ziel(fd, e.message, true);
    else throw e;
  }
  revalidatePath("/buchhaltung");
  redirect(ziel_);
}
const datei = async (fd: FormData, feld: string) => {
  const f = fd.get(feld);
  if (!(f instanceof File) || !f.size) return null;
  return { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
};
const firmaAus = (fd: FormData) => String(fd.get("firma") ?? "") || null;
const monatAus = (fd: FormData) => {
  const m = String(fd.get("monat") ?? "");
  if (!monatOk(m)) throw new BuchhaltungFehler("Monat fehlt.");
  return m;
};

export async function sparkasseAction(fd: FormData) {
  const w = await wer();
  await mit(fd, async () => {
    const d = await datei(fd, "datei");
    if (!d) throw new BuchhaltungFehler("Bitte die CSV-Datei der Sparkasse wählen.");
    const saldo = parseAmount(fd.get("saldo"));
    const r = await sparkasseImportieren(w, firmaAus(fd), d, saldo);
    return `Sparkasse: ${importMeldung(r.bank).replace(/\.$/, "")}${r.endsaldo !== null && r.anfangssaldo !== null ? ` · Anfangssaldo ${r.anfangssaldo.toFixed(2).replace(".", ",")} € → Endsaldo ${r.endsaldo.toFixed(2).replace(".", ",")} €` : ""}.`;
  });
}

export async function amexAction(fd: FormData) {
  const w = await wer();
  await mit(fd, async () => {
    const d = await datei(fd, "datei");
    if (!d) throw new BuchhaltungFehler("Bitte die CSV-Datei aus dem Amex-Konto wählen.");
    const r = await amexImportieren(w, firmaAus(fd), d);
    return `Amex: ${r.neu} neue Umsätze${r.doppelt ? `, ${r.doppelt} schon vorhanden` : ""} · Belastungen ${r.belastungen.toFixed(2).replace(".", ",")} €, Gutschriften ${r.gutschriften.toFixed(2).replace(".", ",")} €.`;
  });
}

export async function ustAction(fd: FormData) {
  const w = await wer();
  await mit(fd, async () => {
    const d = await datei(fd, "datei");
    if (!d) throw new BuchhaltungFehler("Bitte den Umsatzsteuerbericht von Amazon wählen.");
    const r = await ustBerichtImportieren(w, firmaAus(fd), d);
    return `Umsatzsteuerbericht ${r.monat}: ${r.auswertung.zeilen.length} Summenzeilen, ${r.auswertung.hinweise.length} Hinweise.`;
  });
}

export async function abgleichAction(fd: FormData) {
  const w = await wer();
  await mit(fd, async () => {
    const r = await abgleichLaufen(w, firmaAus(fd), monatAus(fd));
    const s = await buchhaltungStatus(w.tenantId, monatAus(fd), firmaAus(fd));
    return `Abgleich: ${r.automatisch} automatisch zugeordnet, ${r.vorschlaege} Vorschläge zum Bestätigen, ${r.ohne} ohne Beleg · Abstimmungsgrad ${s.abstimmungsgrad ?? 0} %.`;
  });
}

export async function zuordnungAction(fd: FormData) {
  const w = await wer();
  await mit(fd, async () => {
    const id = String(fd.get("id") ?? "");
    if (!ID.test(id)) throw new BuchhaltungFehler("Zuordnung fehlt.");
    if (fd.get("aktion") === "ablehnen") {
      await zuordnungAblehnen(w, id);
      return "Vorschlag abgelehnt.";
    }
    await zuordnungBestaetigen(w, id);
    return "Zuordnung bestätigt – Buchungsvorschlag angelegt.";
  });
}

export async function manuellAction(fd: FormData) {
  const w = await wer();
  await mit(fd, async () => {
    const umsatz = String(fd.get("umsatz") ?? "");
    const beleg = String(fd.get("beleg") ?? "");
    if (!ID.test(umsatz) || !ID.test(beleg)) throw new BuchhaltungFehler("Bitte einen Beleg wählen.");
    await zuordnungManuell(w, umsatz, beleg);
    return "Zahlung zugeordnet.";
  });
}

export async function belegeAnfordernAction(fd: FormData) {
  const w = await wer();
  await mit(fd, async () => {
    const n = await belegeAnfordern(w, firmaAus(fd), monatAus(fd));
    return n ? `Aufgabe „Belege anfordern“ mit ${n} Zahlungen angelegt.` : "Keine Zahlungen ohne Beleg.";
  });
}

export async function buchungAction(fd: FormData) {
  const w = await wer();
  await mit(fd, async () => {
    const id = String(fd.get("id") ?? "");
    if (!ID.test(id)) throw new BuchhaltungFehler("Buchung fehlt.");
    if (fd.get("aktion") === "storno") {
      await buchungStornieren(w, id);
      return "Storno-Buchung angelegt.";
    }
    await buchungAendern(w, id, { konto: String(fd.get("konto") ?? "").trim(), bu: String(fd.get("bu") ?? "").trim() || null, lernen: fd.get("lernen") === "1" });
    return "Buchung gespeichert.";
  });
}

export async function alleBestaetigenAction(fd: FormData) {
  const w = await wer();
  await mit(fd, async () => `${await buchungenBestaetigen(w, firmaAus(fd), monatAus(fd))} Buchungen bestätigt.`);
}

export async function festschreibenAction(fd: FormData) {
  const w = await wer();
  await mit(fd, async () => `${await monatFestschreiben(w, firmaAus(fd), monatAus(fd))} Buchungen festgeschrieben – Änderungen nur noch per Storno.`);
}

export async function belegFirmaAction(fd: FormData) {
  const w = await wer();
  await mit(fd, async () => {
    const id = String(fd.get("beleg") ?? "");
    if (!ID.test(id)) throw new BuchhaltungFehler("Beleg fehlt.");
    await belegFirmaSetzen(w, id, String(fd.get("neue_firma") ?? ""));
    return "Firma des Belegs geändert.";
  });
}

/** Einstellungen (nur Inhaber): Firmen, DATEV-Berater-/Mandantennummer, Geldkonten. */
export async function einstellungenAction(fd: FormData) {
  const session = await requireOwner();
  const firmen = String(fd.get("firmen") ?? "")
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 5);
  const konto = (k: string) => (/^\d{4,8}$/.test(String(fd.get(k) ?? "").trim()) ? String(fd.get(k)).trim() : undefined);
  const [t] = await db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, session.tenantId));
  const alt = t?.settings ?? {};
  const bh = alt.buchhaltung ?? {};
  const datev = { ...(bh.datev ?? {}) };
  for (const f of firmen.length ? firmen : (bh.firmen ?? [])) {
    const b = String(fd.get(`berater_${f}`) ?? "").trim();
    const m = String(fd.get(`mandant_${f}`) ?? "").trim();
    if (b || m) datev[f] = { beraternummer: /^\d{4,7}$/.test(b) ? b : undefined, mandantennummer: /^\d{1,5}$/.test(m) ? m : undefined };
  }
  await db
    .update(schema.tenants)
    .set({
      settings: {
        ...alt,
        buchhaltung: {
          ...bh,
          ...(firmen.length ? { firmen } : {}),
          datev,
          geldkonten: { ...(bh.geldkonten ?? {}), bank: konto("bank"), kreditkarte: konto("kreditkarte"), transit: konto("transit"), marktplatz: konto("marktplatz") },
          ...(fd.has("ustva") ? { ustva: { rhythmus: (["monatlich", "quartal"].includes(String(fd.get("ustva"))) ? String(fd.get("ustva")) : "aus") as "monatlich" | "quartal" | "aus", dauerfrist: fd.get("dauerfrist") === "on" } } : {}),
        },
      },
    })
    .where(eq(schema.tenants.id, session.tenantId));
  revalidatePath("/buchhaltung");
  redirect(ziel(fd, "Einstellungen gespeichert."));
}
