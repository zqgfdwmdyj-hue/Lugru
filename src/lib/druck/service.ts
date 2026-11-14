import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { brotherRaster, mediumFuer, type DruckerModell, type Graubild, type Medium } from "./brother";
import { etikettPng, graubildZuPng, pngZuGraubild } from "./etiketten";
import { AGENT_VERSION_AKTUELL, abgelaufen, darfDrucken, PROTOKOLL_TAGE, pushFaellig, statusNachMeldung, tokenFormOk, VORLAGEN, WARTESCHLANGE_TAGE, type AgentKurz, type VorlageId } from "./logic";

// Druckagent: Gerätetoken (nur Prüfsumme), Heartbeat, Warteschlange (7 Tage) mit Abholung per langem Abfragen,
// Rückmeldung je Auftrag, Push nach 15 Minuten Warten, Druckprotokoll 90 Tage. Alles je Mandant.

const A = schema.druckAgenten;
const J = schema.druckAuftraege;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export type Agent = typeof A.$inferSelect;

/** Agent anlegen – der Token wird nur jetzt angezeigt. Umzug: die anderen aktiven Agenten werden deaktiviert. */
export async function agentAnlegen(tenantId: string, userId: string, name: string, o: { andereDeaktivieren?: boolean } = {}): Promise<{ id: string; token: string; deaktiviert: number }> {
  const token = `da_${randomBytes(32).toString("base64url")}`;
  let deaktiviert = 0;
  if (o.andereDeaktivieren) {
    const r = await db.update(A).set({ deaktiviertAm: new Date(), deaktiviertGrund: `Umzug auf „${name.trim().slice(0, 60)}“` }).where(and(eq(A.tenantId, tenantId), isNull(A.deaktiviertAm))).returning({ id: A.id });
    deaktiviert = r.length;
  }
  const [a] = await db.insert(A).values({ tenantId, name: name.trim().slice(0, 80) || "Druckagent", tokenHash: hash(token), tokenAnfang: token.slice(0, 7), angelegtVon: userId }).returning({ id: A.id });
  return { id: a.id, token, deaktiviert };
}

export async function agentWiderrufen(tenantId: string, id: string, grund = "widerrufen") {
  await db.update(A).set({ deaktiviertAm: new Date(), deaktiviertGrund: grund }).where(and(eq(A.tenantId, tenantId), eq(A.id, id), isNull(A.deaktiviertAm)));
}

export async function agentEinstellungenSetzen(tenantId: string, id: string, e: Agent["einstellungen"]) {
  await db.update(A).set({ einstellungen: e }).where(and(eq(A.tenantId, tenantId), eq(A.id, id)));
}

/** Agent zum Token (Bearer). Deaktivierte liefern { abgemeldet: true }. */
export async function agentPerToken(authorization: string | null): Promise<{ agent: Agent | null; abgemeldet: boolean }> {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!tokenFormOk(token)) return { agent: null, abgemeldet: false };
  const [a] = await db.select().from(A).where(eq(A.tokenHash, hash(token))).limit(1);
  if (!a) return { agent: null, abgemeldet: false };
  if (a.deaktiviertAm) return { agent: null, abgemeldet: true };
  return { agent: a, abgemeldet: false };
}

export type HeartbeatEingabe = { geraet?: string; os?: string; version?: string; systemStart?: string; letzterDruck?: string | null; drucker?: Agent["drucker"]; medien?: unknown[]; updates?: Agent["updates"] };

export async function heartbeat(a: Agent, b: HeartbeatEingabe) {
  const drucker = Array.isArray(b.drucker) ? b.drucker.slice(0, 10).map((d) => ({ name: String(d.name ?? "").slice(0, 60), modell: d.modell ? String(d.modell).slice(0, 30) : null, seriennummer: d.seriennummer ? String(d.seriennummer).slice(0, 40) : null, medienBreite: typeof d.medienBreite === "number" ? d.medienBreite : null, zustand: String(d.zustand ?? "unbekannt").slice(0, 20), fehler: Array.isArray(d.fehler) ? d.fehler.slice(0, 5).map((f) => String(f).slice(0, 80)) : [], shelly: !!d.shelly, autoAusAus: typeof d.autoAusAus === "boolean" ? d.autoAusAus : null })) : a.drucker;
  const updates = [...(Array.isArray(b.updates) ? b.updates : []), ...a.updates].slice(0, 20);
  const datum = (s: string | null | undefined) => (s && !Number.isNaN(Date.parse(s)) ? new Date(s) : null);
  await db
    .update(A)
    .set({ letzterKontakt: new Date(), geraet: b.geraet?.slice(0, 80) ?? a.geraet, os: b.os?.slice(0, 120) ?? a.os, version: b.version?.slice(0, 20) ?? a.version, systemStart: datum(b.systemStart) ?? a.systemStart, letzterDruck: datum(b.letzterDruck) ?? a.letzterDruck, drucker, medien: Array.isArray(b.medien) ? b.medien.slice(0, 20) : a.medien, updates, offlineGemeldetAm: null })
    .where(eq(A.id, a.id));
  return { ok: true, einstellungen: a.einstellungen, neueVersion: a.version && a.version !== AGENT_VERSION_AKTUELL ? AGENT_VERSION_AKTUELL : null };
}

// ---- Aufträge -------------------------------------------------------------------------------------------------------

export type AuftragEingabe = { vorlage: VorlageId; eingabe?: Record<string, string>; anzahl?: number; seite?: string | null; titel?: string; bilder?: Graubild[]; dateiId?: string | null; medium?: string };

/** Auftrag anlegen: Druckbild erzeugen (oder übergeben), in Brother-Raster umwandeln, in die Warteschlange stellen. */
export async function auftragAnlegen(session: Session, e: AuftragEingabe): Promise<{ id: string; seiten: number }> {
  const v = VORLAGEN[e.vorlage];
  if (!v) throw new Error("Vorlage unbekannt");
  if (!darfDrucken(session, e.vorlage)) throw new Error(`Keine Berechtigung für „${v.text}“`);
  const medium = mediumFuer(e.medium ?? v.medium) as Medium;
  for (const f of v.felder) if (f.pflicht && !String(e.eingabe?.[f.name] ?? "").trim()) throw new Error(`${f.text} fehlt`);
  const anzahl = Math.min(500, Math.max(1, Math.round(e.anzahl ?? 1)));
  const bilder = e.bilder?.length ? e.bilder : [await pngZuGraubild(await etikettPng(e.vorlage, e.eingabe ?? {}, medium), medium.punkteBreite, medium.punkteLaenge || null)];
  const daten = Buffer.from(brotherRaster(bilder, v.drucker, medium, { anzahl }));
  const vorschau = await graubildZuPng(bilder[0]);
  const titel = (e.titel ?? `${v.text}${e.eingabe?.fnsku ? ` ${e.eingabe.fnsku}` : e.eingabe?.retSku ? ` ${e.eingabe.retSku}` : e.eingabe?.fach ? ` ${e.eingabe.fach}` : ""}`).slice(0, 200);
  const [j] = await db
    .insert(J)
    .values({ tenantId: session.tenantId, vorlage: e.vorlage, titel, drucker: v.drucker, medium: medium.id, anzahl, seiten: bilder.length, seite: e.seite?.slice(0, 200) ?? null, erstelltVon: session.userId, daten, vorschau, sha256: createHash("sha256").update(daten).digest("hex"), eingabe: e.eingabe ?? {}, dateiId: e.dateiId ?? null })
    .returning({ id: J.id });
  return { id: j.id, seiten: bilder.length };
}

/** Vorschau (PNG) einer Vorlage ohne Auftrag. */
export async function vorschauPng(vorlage: VorlageId, eingabe: Record<string, string>): Promise<Buffer> {
  const v = VORLAGEN[vorlage];
  const medium = mediumFuer(v.medium) as Medium;
  return graubildZuPng(await pngZuGraubild(await etikettPng(vorlage, eingabe, medium), medium.punkteBreite, medium.punkteLaenge || null));
}

/** Nächsten Auftrag für diesen Agenten reservieren (wartet, oder abgeholt und seit 10 Min. ohne Rückmeldung). */
export async function auftragReservieren(a: Agent): Promise<typeof J.$inferSelect | null> {
  const modelle = a.drucker.map((d) => d.modell).filter((m): m is string => !!m);
  const r = await db.execute(sql`
    update druck_auftraege set status = 'abgeholt', agent_id = ${a.id}, abgeholt_am = now(), versuche = versuche + 1
    where id = (
      select id from druck_auftraege
      where tenant_id = ${a.tenantId}
        and (status = 'wartet' or (status = 'abgeholt' and abgeholt_am < now() - interval '10 minutes'))
        and created_at > now() - interval '${sql.raw(String(WARTESCHLANGE_TAGE))} days'
        ${modelle.length ? sql`and drucker in (${sql.join(modelle.map((m) => sql`${m}`), sql`, `)})` : sql``}
      order by created_at
      for update skip locked
      limit 1
    )
    returning id`);
  const id = (r.rows?.[0] as { id?: string } | undefined)?.id;
  if (!id) return null;
  const [j] = await db.select().from(J).where(eq(J.id, id));
  return j ?? null;
}

/** Langes Abfragen: bis zu `warten` Sekunden auf einen Auftrag warten (alle 1,5 s nachsehen). */
export async function auftragAbholen(a: Agent, wartenSek: number, signal?: AbortSignal) {
  const ende = Date.now() + Math.min(25, Math.max(0, wartenSek)) * 1000;
  for (;;) {
    const j = await auftragReservieren(a);
    if (j) return j;
    if (Date.now() >= ende || signal?.aborted) return null;
    await new Promise((ok) => setTimeout(ok, 1500));
  }
}

export async function auftragDaten(a: Agent, id: string): Promise<Buffer | null> {
  const [j] = await db.select({ daten: J.daten }).from(J).where(and(eq(J.tenantId, a.tenantId), eq(J.id, id), or(eq(J.agentId, a.id), isNull(J.agentId))));
  return j?.daten ?? null;
}

export async function auftragMelden(a: Agent, id: string, status: string, meldung: string | null) {
  const neu = statusNachMeldung(status);
  if (!neu) return false;
  const jetzt = new Date();
  const r = await db
    .update(J)
    .set({ status: neu, meldung: meldung?.slice(0, 300) ?? null, gedrucktAm: neu === "gedruckt" ? jetzt : null, ...(neu === "wartet" ? { agentId: null, abgeholtAm: null } : {}) })
    .where(and(eq(J.tenantId, a.tenantId), eq(J.id, id)))
    .returning({ id: J.id });
  if (neu === "gedruckt") await db.update(A).set({ letzterDruck: jetzt }).where(eq(A.id, a.id));
  return r.length > 0;
}

export async function erneutDrucken(session: Session, id: string): Promise<string | null> {
  const [j] = await db.select().from(J).where(and(eq(J.tenantId, session.tenantId), eq(J.id, id)));
  if (!j || !darfDrucken(session, j.vorlage as VorlageId)) return null;
  const [n] = await db
    .insert(J)
    .values({ tenantId: j.tenantId, vorlage: j.vorlage, titel: j.titel, drucker: j.drucker, medium: j.medium, anzahl: j.anzahl, seiten: j.seiten, seite: j.seite, erstelltVon: session.userId, daten: j.daten, vorschau: j.vorschau, sha256: j.sha256, eingabe: j.eingabe, erneutVon: j.id, dateiId: j.dateiId })
    .returning({ id: J.id });
  return n.id;
}

export async function auftragAbbrechen(session: Session, id: string) {
  await db.update(J).set({ status: "abgebrochen", meldung: "von Hand abgebrochen" }).where(and(eq(J.tenantId, session.tenantId), eq(J.id, id), inArray(J.status, ["wartet", "abgeholt"])));
}

const LISTE = { id: J.id, vorlage: J.vorlage, titel: J.titel, drucker: J.drucker, medium: J.medium, anzahl: J.anzahl, seiten: J.seiten, seite: J.seite, status: J.status, meldung: J.meldung, createdAt: J.createdAt, gedrucktAm: J.gedrucktAm, erneutVon: J.erneutVon, von: schema.users.name, vonMail: schema.users.email, agent: A.name };

/** Warteschlange (7 Tage) bzw. Protokoll (90 Tage). */
export async function auftraege(tenantId: string, tage: number = WARTESCHLANGE_TAGE, limit = 200) {
  return db
    .select(LISTE)
    .from(J)
    .leftJoin(schema.users, eq(schema.users.id, J.erstelltVon))
    .leftJoin(A, eq(A.id, J.agentId))
    .where(and(eq(J.tenantId, tenantId), gte(J.createdAt, new Date(Date.now() - tage * 86_400_000))))
    .orderBy(desc(J.createdAt))
    .limit(limit);
}

export async function auftragVorschau(tenantId: string, id: string): Promise<Buffer | null> {
  const [j] = await db.select({ v: J.vorschau }).from(J).where(and(eq(J.tenantId, tenantId), eq(J.id, id)));
  return j?.v ?? null;
}

export async function agenten(tenantId: string) {
  return db.select().from(A).where(eq(A.tenantId, tenantId)).orderBy(sql`${A.deaktiviertAm} is not null`, desc(A.createdAt));
}

export async function agentenKurz(tenantId: string): Promise<AgentKurz[]> {
  return (await db.select({ id: A.id, name: A.name, geraet: A.geraet, letzterKontakt: A.letzterKontakt, deaktiviertAm: A.deaktiviertAm, letzterDruck: A.letzterDruck, drucker: A.drucker }).from(A).where(and(eq(A.tenantId, tenantId), isNull(A.deaktiviertAm)))).map((a) => ({ ...a, drucker: a.drucker.map((d) => ({ name: d.name, modell: d.modell, zustand: d.zustand, fehler: d.fehler })) }));
}

/** Hintergrund (alle paar Minuten): Push für Aufträge, die länger als 15 Min. warten; nach 7 Tagen abgelaufen; Protokoll 90 Tage. */
export async function druckPruefen(tenantId: string, jetzt = new Date()): Promise<{ push: number; abgelaufen: number; geloescht: number }> {
  const offen = await db.select({ id: J.id, status: J.status, createdAt: J.createdAt, pushGemeldetAm: J.pushGemeldetAm, titel: J.titel, drucker: J.drucker }).from(J).where(and(eq(J.tenantId, tenantId), eq(J.status, "wartet")));
  const alt = offen.filter((j) => abgelaufen(j, jetzt));
  if (alt.length) await db.update(J).set({ status: "abgelaufen", meldung: `nach ${WARTESCHLANGE_TAGE} Tagen nicht gedruckt` }).where(inArray(J.id, alt.map((j) => j.id)));
  const faellig = offen.filter((j) => !abgelaufen(j, jetzt) && pushFaellig(j, jetzt));
  if (faellig.length) {
    const kurz = await agentenKurz(tenantId);
    const { druckerSymbol } = await import("./logic");
    const grund = druckerSymbol(kurz, faellig[0].drucker as DruckerModell, jetzt).text;
    const { inhaberPushen } = await import("@/lib/push/inhaber");
    await inhaberPushen(tenantId, { titel: `🖨️ ${faellig.length} Druckauftrag${faellig.length === 1 ? "" : "e"} wartet seit 15 Min.`, text: `${faellig.slice(0, 3).map((j) => j.titel).join(", ")} – ${grund}`, link: "/drucken" }, "druck").catch(() => undefined);
    await db.update(J).set({ pushGemeldetAm: jetzt }).where(inArray(J.id, faellig.map((j) => j.id)));
  }
  const weg = await db.delete(J).where(and(eq(J.tenantId, tenantId), lt(J.createdAt, new Date(jetzt.getTime() - PROTOKOLL_TAGE * 86_400_000)))).returning({ id: J.id });
  await db.delete(schema.druckDateien).where(and(eq(schema.druckDateien.tenantId, tenantId), lt(schema.druckDateien.createdAt, new Date(jetzt.getTime() - PROTOKOLL_TAGE * 86_400_000))));
  return { push: faellig.length, abgelaufen: alt.length, geloescht: weg.length };
}

/** Wartende Aufträge eines Druckers (für Symbol/Hinweis). */
export async function wartendeAnzahl(tenantId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(J).where(and(eq(J.tenantId, tenantId), inArray(J.status, ["wartet", "abgeholt"]), ne(J.vorlage, "")));
  return r?.n ?? 0;
}
