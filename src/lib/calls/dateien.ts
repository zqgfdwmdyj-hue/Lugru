import { extractText, getDocumentProxy } from "unpdf";
import { leseZip } from "@/lib/zip-lesen";

// Call-Transkripte aus Dateien: Word (.docx), OpenDocument (.odt), PDF, Text/Markdown, Untertitel (.vtt/.srt) –
// einzeln oder als ZIP (z. B. Google-Drive-Ordner „Herunterladen“). Liefert nur Text, speichert nichts.

export const CALL_DATEI_ENDUNGEN = [".docx", ".odt", ".pdf", ".txt", ".md", ".vtt", ".srt", ".zip"] as const;
const MAX_DATEIEN = 200;

const entities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** Text aus einer Word-Datei (Absätze, Tabs, Zeilenumbrüche; gelöschte Änderungen und Feldbefehle ohne). */
export function docxText(daten: Uint8Array): string {
  const doc = leseZip(daten).find((e) => e.name === "word/document.xml");
  if (!doc) throw new Error("keine Word-Datei (.docx)");
  const xml = doc.daten.toString("utf8");
  return entities(
    xml
      .replace(/<w:del\b[\s\S]*?<\/w:del>/g, "")
      .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, "")
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:(?:br|cr)\b[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

/** Text aus einer OpenDocument-Textdatei (.odt). */
export function odtText(daten: Uint8Array): string {
  const doc = leseZip(daten).find((e) => e.name === "content.xml");
  if (!doc) throw new Error("keine OpenDocument-Datei (.odt)");
  return entities(
    doc.daten
      .toString("utf8")
      .replace(/<text:tab\/>/g, "\t")
      .replace(/<text:line-break\/>/g, "\n")
      .replace(/<text:s(?: text:c="(\d+)")?\/>/g, (_, c?: string) => " ".repeat(Math.min(Number(c ?? 1), 20)))
      .replace(/<\/text:(?:p|h)>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

/** Untertitel (Zoom/Meet .vtt, .srt): Zeitstempel und Nummern weg, „<v Name>“ → „Name: “, Wiederholungen zusammen. */
export function untertitelText(roh: string): string {
  const zeilen: string[] = [];
  for (const z of roh.replace(/\r\n?/g, "\n").split("\n")) {
    const t = z.trim();
    if (!t || t === "WEBVTT" || /^NOTE\b/.test(t) || /^\d+$/.test(t) || /-->/.test(t)) continue;
    const s = t.replace(/<v\s+([^>]+)>/g, "$1: ").replace(/<[^>]+>/g, "").trim();
    if (s && s !== zeilen[zeilen.length - 1]) zeilen.push(s);
  }
  return zeilen.join("\n");
}

/** Text-Datei: UTF-8, sonst Windows-1252 (ältere Exporte); BOM weg. */
export function textDatei(daten: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(daten).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(daten);
  }
}

async function pdfText(daten: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(daten));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

const endung = (name: string) => /\.[A-Za-z0-9]{2,4}$/.exec(name)?.[0].toLowerCase() ?? "";
const unwichtig = (name: string) => /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)|(^|\/)\._/.test(name);

export type CallDatei = { name: string; text: string; geaendert: string | null };

/**
 * Text aus hochgeladenen Dateien; ZIPs werden ausgepackt (eine Ebene). Nicht lesbare oder unbekannte Dateien
 * stehen in „fehler“ – der Rest wird trotzdem übernommen.
 */
export async function textAusCallDateien(dateien: { name: string; daten: Uint8Array; geaendert?: string | null }[]): Promise<{ dateien: CallDatei[]; fehler: string[] }> {
  const out: CallDatei[] = [];
  const fehler: string[] = [];
  const liste: { name: string; daten: Uint8Array; geaendert: string | null }[] = [];
  for (const d of dateien) {
    if (endung(d.name) === ".zip") {
      try {
        for (const e of leseZip(d.daten)) if (!unwichtig(e.name)) liste.push({ name: e.name, daten: e.daten, geaendert: e.geaendert });
      } catch (e) {
        fehler.push(`${d.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else liste.push({ name: d.name, daten: d.daten, geaendert: d.geaendert ?? null });
  }
  if (liste.length > MAX_DATEIEN) {
    fehler.push(`Zu viele Dateien (${liste.length}) – die ersten ${MAX_DATEIEN} werden übernommen.`);
    liste.length = MAX_DATEIEN;
  }
  for (const d of liste) {
    const name = d.name.replace(/^.*\//, "");
    const e = endung(name);
    try {
      let text: string;
      if (e === ".docx") text = docxText(d.daten);
      else if (e === ".odt") text = odtText(d.daten);
      else if (e === ".pdf") text = await pdfText(d.daten);
      else if (e === ".vtt" || e === ".srt") text = untertitelText(textDatei(d.daten));
      else if (e === ".txt" || e === ".md") text = textDatei(d.daten);
      else {
        fehler.push(`${name}: Dateiart nicht unterstützt (Word, PDF, Text, Untertitel oder ZIP)`);
        continue;
      }
      out.push({ name, text, geaendert: d.geaendert });
    } catch (err) {
      fehler.push(`${name}: nicht lesbar (${err instanceof Error ? err.message : String(err)})`.slice(0, 200));
    }
  }
  return { dateien: out, fehler };
}
