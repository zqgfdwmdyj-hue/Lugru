import "server-only";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { addDaysIso, todayIso } from "@/lib/dates";
import { retourenFaelle } from "@/lib/retouren-station/fall";
import { BEFUND_KURZ, ENTSCHEIDUNG_TEXT } from "@/lib/retouren-station/logic";
import { defineTool } from "../types";
import { abs, berlinDateTime, json } from "./common";

// Retouren-Station: geprüfte Kundenretoure aus Remissionen, offene Fälle und Fristen (für den Morgenbericht).

const datum = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum JJJJ-MM-TT");

export const retourenPruefungen = defineTool({
  name: "retouren_pruefungen",
  title: "Retouren-Station: Prüfungen & Fälle",
  description:
    "An der Retouren-Station geprüfte Kundenretouren aus Remissionen (Kamera + Sprache): je Artikel Datum, Produkt, LPN/Bestellung, Befund (OK, leer, falsches Produkt, benutzt, beschädigt, unvollständig), an den Kunden erstatteter Betrag, Frist und Link zum Fall-Paket (Text DE/EN, Fotos, ZIP). Dazu Summen: offene Fälle (Anzahl, €) und Fristen in den nächsten 7 Tagen. Standard: Fälle bereit, aber noch nicht eingereicht – für „Welche Retouren-Fälle muss ich heute einreichen?“.",
  area: "amazon",
  write: false,
  quelle: { text: "Retouren-Station (eigene Prüfung) + Kundenretouren-, Erstattungs- und Transaktionsbericht", importe: true },
  input: z.object({
    status: z.enum(["fall_bereit", "eingereicht", "abgeschlossen", "alle"]).default("fall_bereit").describe("fall_bereit = vorgeschlagen, nicht eingereicht"),
    von: datum.optional().describe("Geprüft ab (JJJJ-MM-TT)"),
    bis: datum.optional(),
    suche: z.string().trim().max(60).optional().describe("LPN, Bestellnummer, SKU oder Titel"),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const liste = await retourenFaelle(t, { status: i.status, von: i.von, bis: i.bis, suche: i.suche, limit: i.limit + 1 });
    const in7 = addDaysIso(todayIso(), 7);
    const [summe] = await db
      .select({ n: sql<number>`count(*)::int`, betrag: sql<number>`coalesce(sum(coalesce(c.expected_amount, x.erstattet_betrag)), 0)::float`, bald: sql<number>`count(*) filter (where c.deadline <= ${in7}::date)::int`, ueberfaellig: sql<number>`count(*) filter (where c.deadline < ${todayIso()}::date)::int` })
      .from(sql`retouren_positionen x left join claims c on c.id = x.anspruch_id`)
      .where(sql`x.tenant_id = ${t} and x.entscheidung = 'fall' and (c.status is null or c.status in ('detected','queued'))`);
    const P = schema.retourenPruefungen;
    const [letzte] = await db.select({ am: sql<Date | null>`max(${P.angelegtAm})` }).from(P).where(eq(P.tenantId, t));
    return json({
      summen: { offene_faelle: summe.n, offene_faelle_euro: Math.round(summe.betrag * 100) / 100, fristen_in_7_tagen: summe.bald, frist_abgelaufen: summe.ueberfaellig || undefined },
      anzahl: Math.min(liste.length, i.limit),
      eintraege: liste.slice(0, i.limit).map((f) => ({
        datum: berlinDateTime(f.datum),
        produkt: f.titel ?? undefined,
        lpn: f.lpn ?? undefined,
        bestellnummer: f.bestellnummer ?? undefined,
        befund: f.befund ? BEFUND_KURZ[f.befund as keyof typeof BEFUND_KURZ] : undefined,
        entscheidung: f.entscheidung ? ENTSCHEIDUNG_TEXT[f.entscheidung as keyof typeof ENTSCHEIDUNG_TEXT] : undefined,
        betrag: f.betrag,
        frist: f.frist ?? undefined,
        anspruch_status: f.status ?? undefined,
        fallnummer: f.fallnummer ?? undefined,
        ki_weicht_ab: f.ki_abweichung || undefined,
        link: abs(ctx, `/remissionen/pruefungen/fall/${f.positionId}`),
      })),
      hinweis: liste.length > i.limit ? `Nur die ersten ${i.limit}.` : !liste.length ? "Keine Einträge – an der Retouren-Station geprüfte Pakete erscheinen hier." : undefined,
      erklaerung: "Fall nur, wenn Befund ≠ OK, Kunde ≥ Schwelle erstattet (Einstellungen → Retouren-Station) und Amazon noch nicht gezahlt hat. Einreichen in Seller Central, danach Fallnummer im Fall-Paket eintragen (oder mit „anspruch_eingereicht“).",
      link: abs(ctx, `/remissionen/pruefungen${i.status === "fall_bereit" ? "" : `?ansicht=${i.status === "alle" ? "pakete" : i.status}`}`),
      datenstand: { quelle: "Retouren-Station + Amazon-Berichte (Kundenretouren, Erstattungen, Transaktionen)", stand: letzte?.am ? `zuletzt geprüft ${berlinDateTime(new Date(letzte.am))}` : "noch kein Paket geprüft", abgerufen: berlinDateTime(new Date()) ?? "" },
    });
  },
});

export const RETOUREN_STATION = [retourenPruefungen];
