import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { openPii } from "@/lib/pii";
import { beilageLint, beilageVollstaendig, ZIELGRUPPEN } from "./kampagne-logic";
import { datenschutzHinweis, type Absender, type AbverkaufEinstellungen } from "./logic";
import type { Brief } from "./pdf";

// Briefe für Serienbrief-PDF und Briefversand: Anschrift, Text, Datenschutzhinweis; QR-Code bei Kampagnen;
// AdelPrep-Beilage als eigenes Blatt (nur wenn je Brief gewählt, die Firmendaten vollständig sind und der Text die
// Prüfung besteht – sonst Hinweis statt Beilage). Kampagne „Lager & Logistik“: der ganze Brief kommt von der
// Logistik-Firma (eigener Absender und Datenschutzhinweis).

const A = schema.abverkaufAnschreiben;
const L = schema.abverkaufLeads;
const K = schema.abverkaufKampagnen;

export type BriefZeile = { a: typeof A.$inferSelect; l: typeof L.$inferSelect };
export type GebauterBrief = { anschreibenId: string; brief: Brief; adresse: { name: string; strasse: string; plz: string; ort: string; land: string }; hinweis: string | null };

export function adelprepAbsender(cfg: AbverkaufEinstellungen): Absender & { web: string } {
  const a = cfg.adelprep;
  return { name: a.firma, strasse: a.strasse, plz: a.plz, ort: a.ort, email: a.email, telefon: a.telefon, web: a.web };
}

/** Kann die Beilage beigelegt werden? Gründe, warum nicht (fehlende Angaben, Textprüfung). */
export function beilageProbleme(cfg: AbverkaufEinstellungen): string[] {
  return [...beilageVollstaendig(cfg.adelprep, cfg.adelprep.text).map((x) => `${x} fehlt`), ...beilageLint(cfg.adelprep.text, cfg.adelprep.bestaetigt).fehler];
}

export async function briefeBauen(tenantId: string, zeilen: BriefZeile[], cfg: AbverkaufEinstellungen, eigen: Absender): Promise<GebauterBrief[]> {
  const kIds = [...new Set(zeilen.map((z) => z.a.kampagneId).filter((x): x is string => !!x))];
  const kampagnen = kIds.length ? await db.select().from(K).where(and(eq(K.tenantId, tenantId), inArray(K.id, kIds))) : [];
  const probleme = beilageProbleme(cfg);
  const { qrPng } = await import("./pdf");
  const { appUrl } = await import("@/lib/oauth/state");
  const { publicUrl } = await import("@/lib/public-url");
  const basis = publicUrl() ?? appUrl();
  const out: GebauterBrief[] = [];
  for (const z of zeilen) {
    const k = kampagnen.find((x) => x.id === z.a.kampagneId) ?? null;
    const vonLogistik = k ? ZIELGRUPPEN[k.zielgruppe].absender === "adelprep" : false;
    const abs = vonLogistik ? adelprepAbsender(cfg) : eigen;
    const strasse = z.l.strasse ? openPii(z.l.strasse) : "";
    const anschrift = [z.l.firma, strasse, [z.l.plz, z.l.ort].filter(Boolean).join(" "), z.l.land !== "DE" ? z.l.land : ""].filter(Boolean);
    let hinweis: string | null = null;
    let beilage: Brief["beilage"] = null;
    if (z.a.adelprepBeilage && !vonLogistik) {
      if (probleme.length) hinweis = `Beilage nicht beigelegt: ${probleme.join("; ")}`;
      else {
        const la = adelprepAbsender(cfg);
        beilage = { absender: la, betreff: "Lager und FBA-Prep für Online-Händler", text: cfg.adelprep.text, impressum: cfg.adelprep.impressum, datenschutz: cfg.adelprep.datenschutz.trim() || datenschutzHinweis(la, { quelle: z.l.quelle, quelleDatum: z.l.quelleDatum, loeschenAm: z.l.loeschenAm }) };
      }
    }
    const url = k ? `${basis}/anfrage/${k.code}?b=${encodeURIComponent(z.a.code)}` : null;
    out.push({
      anschreibenId: z.a.id,
      hinweis,
      adresse: { name: z.l.firma, strasse, plz: z.l.plz ?? "", ort: z.l.ort ?? "", land: z.l.land || "DE" },
      brief: {
        anschrift,
        betreff: z.a.betreff,
        text: z.a.text,
        datenschutz: vonLogistik && cfg.adelprep.datenschutz.trim() ? cfg.adelprep.datenschutz : datenschutzHinweis(abs, { quelle: z.l.quelle, quelleDatum: z.l.quelleDatum, loeschenAm: z.l.loeschenAm }),
        code: z.a.code,
        qr: k && url ? { png: await qrPng(url), url, kampagne: k.code } : null,
        beilage,
        eigenerName: eigen.name || undefined,
        kopf: vonLogistik ? abs : null,
      },
    });
  }
  return out;
}

/** Absender des Briefkopfs je Zeile (Kampagne „Lager & Logistik“ → Logistik-Firma). */
export function kopfAbsender(cfg: AbverkaufEinstellungen, eigen: Absender, vonLogistik: boolean): Absender {
  return vonLogistik ? adelprepAbsender(cfg) : eigen;
}
