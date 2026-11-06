import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { askClaude, modelFor } from "@/lib/ai/claude";
import type { Session } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { openPii, sealPii } from "@/lib/pii";
import { addEntry, loadEntries, loadEntry, updateEntry, type Entry } from "@/lib/private/service";
import { inhaberPrivatSitzung } from "@/lib/private/termin-mail-service";
import { getSettings } from "@/lib/settings";
import {
  adresseAus,
  anredeAus,
  antwortBetreff,
  betreffKern,
  entwurfLesen,
  entwurfPrompt,
  entwurfVorlage,
  freieSlots,
  istMassenmail,
  nameTeile,
  persoenlichEinstufen,
  terminBezug,
  terminFinden,
  zusammenfassungVorlage,
  type Einstufung,
  type MassenKopf,
  type TerminBezug,
} from "./persoenlich-logic";

// B32 Persönliche Mails: Mails von Personen, Praxen, Dienstleistern landen nur im Privatbereich des Inhabers
// (Art „nachricht“, verschlüsselt, nur für ihn sichtbar) – nie im geschäftlichen Posteingang, nie bei der VA, nie in
// Discord-Kanälen (höchstens als Direktnachricht an den Inhaber). Antworten werden vorbereitet, gesendet wird nur
// auf seinen Klick.

export type VerlaufEintrag = { richtung: "ein" | "aus"; key: string; am: string; text: string; von: string; betreff: string; extern?: boolean };
export type NachrichtStatus = "offen" | "unsicher" | "beantwortet" | "beantwortet_extern" | "erledigt" | "ausgehend";
export type NachrichtEintrag = {
  status: NachrichtStatus;
  /** Adresse der Gegenseite (klein). */
  von: string;
  name: string | null;
  betreff: string;
  postfachId: string | null;
  postfach: string | null;
  verlauf: VerlaufEintrag[];
  zusammenfassung: string;
  entwurf: string;
  entwurfQuelle: "ki" | "vorlage" | "";
  anrede: "du" | "sie";
  termin: TerminBezug | null;
  terminId: string | null;
  /** Automatisch geändert (Absage → ausgefallen) – mit vorherigem Status für „Rückgängig“. */
  terminGeaendert: { vorher: string; titel: string; tag: string } | null;
  /** Vom Inhaber ausgeführte Termin-Aktion (eingetragen, verschoben, rückgängig …). */
  terminErledigt?: string | null;
  einstufung?: { punkte: number; gruende: string[] } | null;
  beantwortetAm?: string | null;
  beantwortetVon?: string | null;
  spaeterBis?: string | null;
  erinnertAm?: string | null;
  nachfassenAm?: string | null;
  ignoriert?: boolean;
  zuletztAm: string;
};

export type EingangMail = {
  messageKey: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  text: string;
  receivedAt: Date;
  antwortAuf?: string[];
  kopf?: MassenKopf;
};

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 40);
const klein = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

// --- Kontakte (Festlegung je Absender, Anrede) ---------------------------------------------------------------

export type Kontakt = { id: string; adresse: string; name: string | null; art: "persoenlich" | "geschaeftlich" | "ignorieren" | null; anrede: "du" | "sie" | null; bezug: string | null };

export async function kontaktLesen(tenantId: string, adresse: string): Promise<Kontakt | null> {
  const K = schema.mailKontakte;
  const [r] = await db.select().from(K).where(and(eq(K.tenantId, tenantId), eq(K.adresseHash, hash(klein(adresse)))));
  if (!r) return null;
  return { id: r.id, adresse: openPii(r.adresse), name: r.name ? openPii(r.name) : null, art: (r.art as Kontakt["art"]) ?? null, anrede: (r.anrede as Kontakt["anrede"]) ?? null, bezug: r.bezug };
}

/** Kontakt anlegen oder ändern (nur übergebene Felder). Adresse und Name verschlüsselt. */
export async function kontaktSetzen(tenantId: string, adresse: string, patch: { name?: string | null; art?: Kontakt["art"]; anrede?: Kontakt["anrede"]; bezug?: string | null }, userId?: string | null): Promise<string> {
  const K = schema.mailKontakte;
  const a = klein(adresse);
  const werte = {
    ...(patch.name !== undefined ? { name: patch.name ? sealPii(patch.name.slice(0, 200)) : null } : {}),
    ...(patch.art !== undefined ? { art: patch.art, festgelegtVon: userId ?? null } : {}),
    ...(patch.anrede !== undefined ? { anrede: patch.anrede } : {}),
    ...(patch.bezug !== undefined ? { bezug: patch.bezug } : {}),
  };
  const [r] = await db
    .insert(K)
    .values({ tenantId, adresseHash: hash(a), adresse: sealPii(a), ...werte })
    .onConflictDoUpdate({ target: [K.tenantId, K.adresseHash], set: { ...werte, updatedAt: new Date() } })
    .returning({ id: K.id });
  return r.id;
}

/** Eigene Adressen (alle verbundenen Postfächer) – Mails von dort sind ausgehend. */
export async function eigeneAdressen(tenantId: string): Promise<Map<string, { id: string; fromName: string | null }>> {
  const M = schema.mailboxes;
  const rows = await db.select({ id: M.id, address: M.address, fromName: M.fromName, provider: M.provider }).from(M).where(eq(M.tenantId, tenantId));
  return new Map(rows.filter((r) => r.provider !== "upload" && r.address.includes("@")).map((r) => [klein(r.address), { id: r.id, fromName: r.fromName }]));
}

// --- Erkennen ------------------------------------------------------------------------------------------------

/**
 * Ist die Mail persönlich? „persoenlich“ / „unsicher“ (persönlich?) / „ignorieren“ (Absender so festgelegt) / null
 * (geschäftlich oder Massenmail – weiter wie bisher). Festlegung je Absender geht vor; Newsletter, Werbung und
 * Systemmails (Listen-Kopf, noreply, Abmelde-Link) sind nie persönlich.
 */
export async function persoenlichPruefen(tenantId: string, m: EingangMail, ownerName: string | null): Promise<{ stufe: "persoenlich" | "unsicher" | "ignorieren"; einstufung: Einstufung | null } | null> {
  const k = await kontaktLesen(tenantId, m.fromAddress);
  if (k?.art === "ignorieren") return { stufe: "ignorieren", einstufung: null };
  if (k?.art === "geschaeftlich") return null;
  if (k?.art === "persoenlich") return { stufe: "persoenlich", einstufung: null };
  if (istMassenmail(m.kopf ?? {}, m.fromAddress, m.text)) return null;
  const e = persoenlichEinstufen({ adresse: m.fromAddress, name: m.fromName, betreff: m.subject, text: m.text, inhaber: nameTeile(ownerName) });
  if (e.stufe === "nein") return null;
  return { stufe: e.stufe, einstufung: e };
}

// --- Erfassen ------------------------------------------------------------------------------------------------

type TerminDaten = { day: string; time?: string; to?: string; title?: string; notes?: string; with?: string; status?: string };

const KEY_MAX = 40;

/** Passenden Verlauf finden: In-Reply-To/References, sonst gleicher Absender + gleicher Betreff (30 Tage). */
function threadFinden(liste: Entry<NachrichtEintrag>[], m: { adresse: string; betreff: string; antwortAuf: string[] }) {
  const refs = new Set(m.antwortAuf);
  const perRef = liste.find((e) => e.data.verlauf?.some((v) => refs.has(v.key)));
  if (perRef) return perRef;
  const kern = betreffKern(m.betreff);
  const grenze = Date.now() - 30 * 86_400_000;
  return liste
    .filter((e) => e.data.von === m.adresse && kern && betreffKern(e.data.betreff) === kern && Date.parse(e.data.zuletztAm) >= grenze && !e.data.ignoriert)
    .sort((a, b) => b.data.zuletztAm.localeCompare(a.data.zuletztAm))[0];
}

/** Antwortentwurf + Zusammenfassung: KI (falls eingerichtet und an), sonst Vorlage. */
export async function entwurfErstellen(
  tenantId: string,
  o: { art: "persoenlich" | "geschaeftlich"; von: string; name: string | null; betreff: string; text: string; anrede: "du" | "sie"; termin: TerminBezug | null; slots: { tag: string; uhrzeit: string }[]; unterschrift: string; kontext?: string; ki: boolean },
): Promise<{ zusammenfassung: string; entwurf: string; quelle: "ki" | "vorlage" }> {
  if (o.ki) {
    const ai = await getIntegration(tenantId, "anthropic").catch(() => null);
    if (ai?.apiKey) {
      const r = await askClaude(ai.apiKey, entwurfPrompt(o), { model: modelFor(ai, "creative"), task: "creative", maxTokens: 900, timeoutMs: 45_000 }).catch((e) => {
        console.error("[Persönliche Mail] KI-Entwurf:", e instanceof Error ? e.message : e);
        return null;
      });
      const j = r ? entwurfLesen(r.text) : null;
      if (j) return { zusammenfassung: j.zusammenfassung || zusammenfassungVorlage(o.text), entwurf: j.entwurf, quelle: "ki" };
    }
  }
  return { zusammenfassung: zusammenfassungVorlage(o.text), entwurf: entwurfVorlage({ anrede: o.anrede, name: o.name, adresse: o.von, termin: o.termin, slots: o.slots, unterschrift: o.unterschrift }), quelle: "vorlage" };
}

const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/**
 * Persönliche Mail im Privatbereich ablegen (neuer Verlauf oder Antwort in einem bestehenden), Termin-Bezug prüfen,
 * Entwurf vorbereiten und den Inhaber benachrichtigen. Ohne Inhaber mit vollem Privat-Zugang: nichts (null).
 */
export async function persoenlichErfassen(
  tenantId: string,
  mailboxId: string | null,
  m: EingangMail,
  stufe: "persoenlich" | "unsicher",
  einstufung: Einstufung | null,
): Promise<"new" | "duplicate" | null> {
  const session = await inhaberPrivatSitzung(tenantId);
  if (!session) return null;
  const adresse = klein(m.fromAddress);
  const alle = await loadEntries<NachrichtEintrag>(session, ["nachricht"]);
  if (alle.some((e) => e.data.verlauf?.some((v) => v.key === m.messageKey))) return "duplicate";
  const cfg = (await getSettings(tenantId)).posteingang;
  const heute = todayIso();
  const [mb] = mailboxId ? await db.select({ id: schema.mailboxes.id, address: schema.mailboxes.address, provider: schema.mailboxes.provider }).from(schema.mailboxes).where(and(eq(schema.mailboxes.tenantId, tenantId), eq(schema.mailboxes.id, mailboxId))) : [];
  const postfach = mb && mb.provider !== "upload" ? { id: mb.id, address: mb.address } : null;

  // Anrede: festgelegt > früherer eigener Schriftverkehr > aus der Mail > Sie.
  const kontakt = await kontaktLesen(tenantId, adresse);
  const frueher = alle.filter((e) => e.data.von === adresse).flatMap((e) => e.data.verlauf.filter((v) => v.richtung === "aus").map((v) => v.text));
  const anrede = anredeAus({ eingang: m.text, frueher, gemerkt: kontakt?.anrede ?? null });
  if (!kontakt) await kontaktSetzen(tenantId, adresse, { name: m.fromName, bezug: "persoenlich" });

  // Termin-Bezug: Absage → passenden Termin als „ausgefallen“ markieren (mit Rückgängig); alles andere nur vorschlagen.
  const termin = terminBezug(`${m.subject}\n${m.text}`, heute);
  const termine = await loadEntries<TerminDaten>(session, ["termin"]);
  let terminId: string | null = null;
  let terminGeaendert: NachrichtEintrag["terminGeaendert"] = null;
  if (termin) {
    const tag = termin.art === "vorschlag" ? null : termin.tag;
    const treffer = terminFinden(termine as { id: string; data: TerminDaten & { day: string } }[], { tag, name: m.fromName, adresse, heute });
    if (treffer) {
      terminId = treffer.id;
      if (termin.art === "absage" && treffer.data.status !== "ausgefallen") {
        const vorher = treffer.data.status ?? "geplant";
        const ok = await updateEntry(session, treffer.id, "termin", { status: "ausgefallen", notes: `${treffer.data.notes ? `${treffer.data.notes}\n` : ""}Abgesagt per Mail vom ${dmy(heute)} (${m.fromName ?? adresse}).`.slice(0, 4000) });
        if (ok) terminGeaendert = { vorher, titel: (treffer.data.title ?? "Termin").slice(0, 120), tag: treffer.data.day };
      }
    }
  }
  const slots = cfg.persoenlich.slots ? freieSlots(termine.filter((t) => t.data.status !== "ausgefallen" && t.data.day >= heute).map((t) => ({ day: t.data.day, time: t.data.time, to: t.data.to })), heute) : [];

  const vorhanden = threadFinden(alle, { adresse, betreff: m.subject, antwortAuf: m.antwortAuf ?? [] });
  const kontext = vorhanden ? vorhanden.data.verlauf.slice(-3).map((v) => `${v.richtung === "ein" ? "Eingang" : "Gesendet"} ${v.am.slice(0, 10)}: ${v.text.slice(0, 400)}`).join("\n") : undefined;
  // „persönlich?“ (unsicher, neuer Absender): Vorlage statt KI und kein Push – steht zum Einordnen in der Liste.
  const unsicher = stufe === "unsicher" && !vorhanden;
  const e = await entwurfErstellen(tenantId, { art: "persoenlich", von: adresse, name: m.fromName, betreff: m.subject, text: m.text, anrede, termin, slots, unterschrift: session.name || "", kontext, ki: !unsicher && cfg.persoenlich.kiEntwurf !== false });

  const ein: VerlaufEintrag = { richtung: "ein", key: m.messageKey, am: m.receivedAt.toISOString(), text: m.text.slice(0, 20_000), von: adresse, betreff: m.subject.slice(0, 300) };
  const status: NachrichtStatus = unsicher ? "unsicher" : "offen";
  const basis = {
    status,
    zusammenfassung: e.zusammenfassung,
    entwurf: e.entwurf,
    entwurfQuelle: e.quelle,
    anrede,
    termin,
    terminId,
    terminGeaendert,
    terminErledigt: null,
    spaeterBis: null,
    erinnertAm: null,
    zuletztAm: m.receivedAt.toISOString(),
  };
  let id: string;
  if (vorhanden) {
    const verlauf = [...vorhanden.data.verlauf, ein].sort((a, b) => a.am.localeCompare(b.am)).slice(-KEY_MAX);
    await updateEntry(session, vorhanden.id, "nachricht", { ...basis, verlauf, nachfassenAm: null, ...(postfach ? { postfachId: postfach.id, postfach: postfach.address } : {}), ...(vorhanden.data.name ? {} : { name: m.fromName }) });
    id = vorhanden.id;
  } else {
    const neu: NachrichtEintrag = { ...basis, von: adresse, name: m.fromName, betreff: m.subject.slice(0, 300), postfachId: postfach?.id ?? null, postfach: postfach?.address ?? null, verlauf: [ein], einstufung: einstufung ? { punkte: einstufung.punkte, gruende: einstufung.gruende } : null };
    id = await addEntry(session, "nachricht", neu as unknown as Record<string, unknown>);
  }
  if (!unsicher) await benachrichtigen(tenantId, session, id, { name: m.fromName ?? adresse, zusammenfassung: e.zusammenfassung, unsicher: false, terminGeaendert });
  return "new";
}

/** Push an den Inhaber (ohne Discord-Kanal) – wahlweise zusätzlich als Discord-Direktnachricht an ihn. */
async function benachrichtigen(tenantId: string, session: Session, id: string, o: { name: string; zusammenfassung: string; unsicher: boolean; terminGeaendert: NachrichtEintrag["terminGeaendert"] }) {
  const link = `/privat/nachrichten/${id}`;
  const satz = o.zusammenfassung.slice(0, 160);
  const termin = o.terminGeaendert ? ` · Termin ${dmy(o.terminGeaendert.tag)} als abgesagt markiert` : "";
  const { melden } = await import("@/lib/push/service");
  const r = await melden(
    tenantId,
    [session.userId],
    { titel: `${o.unsicher ? "✉️ Persönlich? " : "✉️ "}${o.name}`.slice(0, 120), text: `${satz}${termin} – Antwort prüfen`, link, art: "persoenlich", aktionen: [{ aktion: "pruefen", titel: "Antwort prüfen", link }] },
    { ohneDiscord: true },
  ).catch((e) => {
    console.error("[Persönliche Mail] Push:", e instanceof Error ? e.message : e);
    return null;
  });
  if (r?.ids.length) {
    const eintrag = await loadEntry<NachrichtEintrag & { meldungIds?: string[] }>(session, id);
    if (eintrag) await updateEntry(session, id, "nachricht", { meldungIds: [...(eintrag.data.meldungIds ?? []), ...r.ids].slice(-10) });
  }
  await discordDm(tenantId, `✉️ Persönliche Mail von ${o.name}: ${satz}${termin}\nAntwort prüfen: ${appUrl()}${link}`);
}

const appUrl = () => (process.env.APP_URL ?? "").replace(/\/$/, "");

/** Discord-Direktnachricht an Ludwig (Einstellung): nie in einen Kanal. Fehler nur ins Protokoll. */
export async function discordDm(tenantId: string, text: string): Promise<boolean> {
  const cfg = (await getSettings(tenantId)).posteingang.persoenlich;
  const ziel = (cfg.discordDmId ?? "").trim();
  if (!cfg.discordDm || !/^\d{15,22}$/.test(ziel)) return false;
  const token = ((await getIntegration(tenantId, "discord_va").catch(() => null)) as { botToken?: string } | null)?.botToken;
  if (!token) return false;
  try {
    const { discord } = await import("@/lib/va/discord");
    const dc = discord(token);
    const kanal = await dc.dmKanal(ziel);
    await dc.senden(kanal.id, text.slice(0, 1900));
    return true;
  } catch (e) {
    console.error("[Persönliche Mail] Discord-DM:", e instanceof Error ? e.message : e);
    return false;
  }
}

// --- Aktionen des Inhabers -------------------------------------------------------------------------------------

/** Push-Karten zur Nachricht als erledigt markieren (Gerät schließt sie beim Öffnen der Seite). */
async function meldungenErledigt(tenantId: string, e: Entry<NachrichtEintrag & { meldungIds?: string[] }>) {
  const ids = e.data.meldungIds ?? [];
  if (!ids.length) return;
  await db.update(schema.meldungen).set({ zustand: "erledigt" }).where(and(eq(schema.meldungen.tenantId, tenantId), inArray(schema.meldungen.id, ids)));
}

export type SendenErgebnis = { ok: true; von: string } | { ok: false; meldung: string };

/**
 * Antwort senden – nur auf Klick des Inhabers. Über das Postfach, in dem die Mail ankam (sonst Standard), im selben
 * Verlauf (In-Reply-To/References), Kopie landet im Gesendet-Ordner. Danach: beantwortet, Push-Karte weg.
 */
export async function nachrichtSenden(session: Session, id: string, text: string): Promise<SendenErgebnis> {
  const e = await loadEntry<NachrichtEintrag & { meldungIds?: string[] }>(session, id);
  if (!e || e.kind !== "nachricht" || e.userId !== session.userId) return { ok: false, meldung: "Nachricht nicht gefunden." };
  const body = text.replace(/\r\n/g, "\n").trim();
  if (!body) return { ok: false, meldung: "Der Antworttext ist leer." };
  const eingaenge = e.data.verlauf.filter((v) => v.richtung === "ein");
  const letzte = eingaenge[eingaenge.length - 1];
  const refs = e.data.verlauf.map((v) => v.key).filter((k) => k.startsWith("<")).slice(-10);
  const { senderMailboxes, sendMail } = await import("@/lib/mail/accounts");
  const { boxes } = await senderMailboxes(session.tenantId);
  const mailboxId = e.data.postfachId && boxes.some((b) => b.id === e.data.postfachId) ? e.data.postfachId : null;
  const messageId = `<${randomUUID()}@seller-system>`;
  const betreff = antwortBetreff(letzte?.betreff || e.data.betreff);
  let von: string;
  try {
    ({ from: von } = await sendMail(session.tenantId, { to: e.data.von, subject: betreff, text: body, inReplyTo: letzte?.key.startsWith("<") ? letzte.key : undefined, references: refs, messageId }, { mailboxId, fromName: session.name || undefined }));
  } catch (err) {
    return { ok: false, meldung: err instanceof Error ? err.message : String(err) };
  }
  const jetzt = new Date().toISOString();
  const aus: VerlaufEintrag = { richtung: "aus", key: messageId, am: jetzt, text: body.slice(0, 20_000), von, betreff };
  await updateEntry(session, id, "nachricht", { verlauf: [...e.data.verlauf, aus].slice(-KEY_MAX), status: "beantwortet", entwurf: "", beantwortetAm: jetzt, beantwortetVon: `${von}${session.name ? ` (${session.name})` : ""}`, spaeterBis: null, zuletztAm: jetzt });
  await gesehenMerken(session.tenantId, messageId, "privat_gesendet");
  await meldungenErledigt(session.tenantId, e);
  return { ok: true, von };
}

/** Entwurf speichern (Bearbeiten), ohne zu senden. */
export async function entwurfSpeichern(session: Session, id: string, text: string) {
  return updateEntry(session, id, "nachricht", { entwurf: text.replace(/\r\n/g, "\n").slice(0, 20_000) });
}

/** „Später“: Karte weg, Nachricht bleibt offen – Erinnerung nach 3 Stunden (einmal). */
export async function nachrichtSpaeter(session: Session, id: string, stunden = 3) {
  const e = await loadEntry<NachrichtEintrag & { meldungIds?: string[] }>(session, id);
  if (!e) return false;
  await meldungenErledigt(session.tenantId, e);
  return updateEntry(session, id, "nachricht", { spaeterBis: new Date(Date.now() + stunden * 3_600_000).toISOString(), erinnertAm: null });
}

/** Ohne Antwort erledigt. */
export async function nachrichtErledigt(session: Session, id: string) {
  const e = await loadEntry<NachrichtEintrag & { meldungIds?: string[] }>(session, id);
  if (!e) return false;
  await meldungenErledigt(session.tenantId, e);
  return updateEntry(session, id, "nachricht", { status: "erledigt", spaeterBis: null });
}

/** Entwurf neu erstellen (z. B. nach Ändern der Anrede). */
export async function entwurfNeu(session: Session, id: string, anrede?: "du" | "sie") {
  const e = await loadEntry<NachrichtEintrag>(session, id);
  if (!e) return false;
  const cfg = (await getSettings(session.tenantId)).posteingang;
  const ein = e.data.verlauf.filter((v) => v.richtung === "ein").pop();
  if (!ein) return false;
  const a = anrede ?? e.data.anrede;
  if (anrede) await kontaktSetzen(session.tenantId, e.data.von, { anrede }, session.userId);
  const heute = todayIso();
  const termine = cfg.persoenlich.slots ? await loadEntries<TerminDaten>(session, ["termin"]) : [];
  const slots = cfg.persoenlich.slots ? freieSlots(termine.filter((t) => t.data.status !== "ausgefallen" && t.data.day >= heute).map((t) => ({ day: t.data.day, time: t.data.time, to: t.data.to })), heute) : [];
  const r = await entwurfErstellen(session.tenantId, { art: "persoenlich", von: e.data.von, name: e.data.name, betreff: ein.betreff, text: ein.text, anrede: a, termin: e.data.termin, slots, unterschrift: session.name || "", ki: cfg.persoenlich.kiEntwurf !== false });
  return updateEntry(session, id, "nachricht", { anrede: a, entwurf: r.entwurf, entwurfQuelle: r.quelle, zusammenfassung: r.zusammenfassung || e.data.zusammenfassung });
}

/**
 * Einordnen (je Absender dauerhaft): persönlich → bleibt hier; geschäftlich → in den Posteingang (Eintrag hier wird
 * erledigt); ignorieren → künftig gar nicht mehr abholen.
 */
export async function nachrichtEinordnen(session: Session, id: string, art: "persoenlich" | "geschaeftlich" | "ignorieren"): Promise<{ ok: boolean; posteingang?: number }> {
  const e = await loadEntry<NachrichtEintrag & { meldungIds?: string[] }>(session, id);
  if (!e) return { ok: false };
  await kontaktSetzen(session.tenantId, e.data.von, { art, bezug: art === "persoenlich" ? "persoenlich" : art === "geschaeftlich" ? "sonst" : null }, session.userId);
  if (art === "persoenlich") {
    await updateEntry(session, id, "nachricht", { status: e.data.status === "unsicher" ? "offen" : e.data.status, einstufung: null });
    return { ok: true };
  }
  await meldungenErledigt(session.tenantId, e);
  let posteingang = 0;
  if (art === "geschaeftlich") {
    const { ingestMail } = await import("./service");
    for (const v of e.data.verlauf.filter((x) => x.richtung === "ein")) {
      const r = await ingestMail(session.tenantId, e.data.postfachId, { messageKey: v.key, fromAddress: e.data.von, fromName: e.data.name, subject: v.betreff, receivedAt: new Date(v.am), text: v.text, ordner: "Persönlich → geschäftlich" });
      if (r === "new") posteingang++;
    }
  }
  await updateEntry(session, id, "nachricht", { status: "erledigt", ignoriert: art === "ignorieren", entwurf: "", spaeterBis: null });
  return { ok: true, posteingang };
}

/**
 * Termin-Aktionen – immer erst auf Klick: Absage rückgängig, Verschiebung übernehmen, neuen/bestätigten Termin
 * eintragen, als ausgefallen markieren. Nichts wird gelöscht.
 */
export async function terminAktion(session: Session, id: string, aktion: "rueckgaengig" | "verschieben" | "eintragen" | "absagen"): Promise<{ ok: boolean; meldung: string }> {
  const e = await loadEntry<NachrichtEintrag>(session, id);
  if (!e) return { ok: false, meldung: "Nachricht nicht gefunden." };
  const t = e.data.termin;
  const termin = e.data.terminId ? await loadEntry<TerminDaten>(session, e.data.terminId) : null;
  const notiz = (alt: string | undefined, s: string) => `${alt ? `${alt}\n` : ""}${s}`.slice(0, 4000);
  if (aktion === "rueckgaengig") {
    if (!termin || !e.data.terminGeaendert) return { ok: false, meldung: "Nichts rückgängig zu machen." };
    await updateEntry(session, termin.id, "termin", { status: e.data.terminGeaendert.vorher, notes: notiz(termin.data.notes, `Absage zurückgenommen (${dmy(todayIso())}).`) });
    await updateEntry(session, id, "nachricht", { terminGeaendert: null, terminErledigt: "rueckgaengig" });
    return { ok: true, meldung: "Termin wieder auf „geplant“." };
  }
  if (aktion === "absagen") {
    if (!termin) return { ok: false, meldung: "Kein passender Termin gefunden." };
    await updateEntry(session, termin.id, "termin", { status: "ausgefallen", notes: notiz(termin.data.notes, `Abgesagt per Mail (${dmy(todayIso())}).`) });
    await updateEntry(session, id, "nachricht", { terminGeaendert: { vorher: termin.data.status ?? "geplant", titel: termin.data.title ?? "Termin", tag: termin.data.day }, terminErledigt: "abgesagt" });
    return { ok: true, meldung: "Termin als „ausgefallen“ markiert." };
  }
  if (aktion === "verschieben") {
    if (!termin || !t?.neuerTag) return { ok: false, meldung: "Kein Termin zum Verschieben." };
    await updateEntry(session, termin.id, "termin", { day: t.neuerTag, ...(t.neueUhrzeit ? { time: t.neueUhrzeit } : {}), status: "geplant", notes: notiz(termin.data.notes, `Verschoben vom ${dmy(termin.data.day)} laut Mail.`) });
    await updateEntry(session, id, "nachricht", { terminErledigt: "verschoben" });
    return { ok: true, meldung: `Termin auf ${dmy(t.neuerTag)} verschoben.` };
  }
  // eintragen: neuer Vorschlag bzw. bestätigter Termin ohne Gegenstück im Kalender.
  const tag = t?.art === "bestaetigung" ? t.tag : t?.neuerTag;
  const uhr = t?.art === "bestaetigung" ? t.uhrzeit : t?.neueUhrzeit;
  if (!tag) return { ok: false, meldung: "Kein Datum erkannt – bitte im Kalender eintragen." };
  const neu = { day: tag, ...(uhr ? { time: uhr } : {}), with: "privat", title: `Termin ${e.data.name ?? e.data.von}`.slice(0, 120), person: "beide", notes: `Aus Mail: ${e.data.betreff}`.slice(0, 4000), status: "geplant" };
  const tid = await addEntry(session, "termin", neu);
  await updateEntry(session, id, "nachricht", { terminId: tid, terminErledigt: "eingetragen" });
  return { ok: true, meldung: `Termin am ${dmy(tag)} eingetragen.` };
}

// --- Zählen, Erinnern ------------------------------------------------------------------------------------------

/** Offene persönliche Nachrichten (für Morgenbericht und Überblick nur die Anzahl). */
export async function offenePersoenliche(tenantId: string, nurFuer?: string): Promise<number> {
  const session = await inhaberPrivatSitzung(tenantId);
  if (!session || (nurFuer && session.userId !== nurFuer)) return 0;
  return (await loadEntries<NachrichtEintrag>(session, ["nachricht"])).filter((e) => e.data.status === "offen" || e.data.status === "unsicher").length;
}

/** „Später“ abgelaufen → einmal erinnern (Push, ohne Discord). */
export async function spaeterErinnern(tenantId: string): Promise<number> {
  const session = await inhaberPrivatSitzung(tenantId);
  if (!session) return 0;
  const jetzt = new Date().toISOString();
  const faellig = (await loadEntries<NachrichtEintrag>(session, ["nachricht"])).filter((e) => (e.data.status === "offen" || e.data.status === "unsicher") && e.data.spaeterBis && e.data.spaeterBis <= jetzt && !e.data.erinnertAm);
  for (const e of faellig) {
    await updateEntry(session, e.id, "nachricht", { erinnertAm: jetzt, spaeterBis: null });
    await benachrichtigen(tenantId, session, e.id, { name: e.data.name ?? e.data.von, zusammenfassung: `Erinnerung: ${e.data.zusammenfassung}`, unsicher: e.data.status === "unsicher", terminGeaendert: null });
  }
  // Ausgehende persönliche Mail ohne Antwort bis zum Nachfass-Tag → einmal erinnern (Push, nie Discord-Kanal).
  const heute = todayIso();
  const nachfassen = (await loadEntries<NachrichtEintrag>(session, ["nachricht"])).filter((e) => e.data.status === "ausgehend" && e.data.nachfassenAm && e.data.nachfassenAm <= heute);
  if (nachfassen.length) {
    const { melden } = await import("@/lib/push/service");
    for (const e of nachfassen) {
      await updateEntry(session, e.id, "nachricht", { nachfassenAm: null });
      await melden(tenantId, [session.userId], { titel: `Nachfassen: ${e.data.name ?? e.data.von}`.slice(0, 120), text: `Keine Antwort auf „${e.data.betreff.slice(0, 80)}“.`, link: `/privat/nachrichten/${e.id}`, art: "persoenlich" }, { ohneDiscord: true }).catch(() => null);
    }
  }
  return faellig.length + nachfassen.length;
}

// --- Gesehen (Abruf lädt nichts doppelt) – in gesehen.ts, hier weitergereicht ---------------------------------------
export { gesehenAufraeumen, gesehenMerken, unbekannt } from "./gesehen";
import { gesehenMerken } from "./gesehen";

export { adresseAus };
