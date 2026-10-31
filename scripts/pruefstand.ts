// Erzeugt PRUEFSTAND.md: je Reiter der geprüfte Ablauf, das erwartete und das tatsächliche Ergebnis (aus dem letzten
// Lauf der Ablaufprüfungen, test-results/ergebnis.json), Live-Prüfungen und was noch offen ist – getrennt nach
// automatisch / live / noch nicht geprüft.
//
//   npx playwright test && npx tsx scripts/pruefstand.ts      (oder: npm run e2e && npm run pruefstand)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { NAV, SUBPAGES } from "../src/lib/nav";
import { ALLE_SEITEN, PRUEFSTAND, type Ablauf, type Reiter } from "../e2e/pruefstand";

type Result = { status: string; duration: number; error?: { message?: string } };
type TestRun = { projectName: string; status: string; results: Result[] };
type Spec = { title: string; file: string; tests: TestRun[] };
type Suite = { title: string; file: string; specs?: Spec[]; suites?: Suite[] };
type Report = { suites: Suite[]; stats: { startTime: string; duration: number; expected: number; unexpected: number; flaky: number; skipped: number } };

const PFAD = "test-results/ergebnis.json";
const report: Report | null = existsSync(PFAD) ? JSON.parse(readFileSync(PFAD, "utf8")) : null;

// Alle Prüfungen flach: „datei › Gruppe › Titel“ je Gerät
type Lauf = { key: string; file: string; title: string; projekt: string; status: "bestanden" | "fehlgeschlagen" | "übersprungen" | "wackelig"; fehler?: string; dauer: number };
const laeufe: Lauf[] = [];
function walk(s: Suite, pfad: string[]) {
  for (const sp of s.specs ?? []) {
    const title = [...pfad, sp.title].filter(Boolean).join(" › ");
    for (const t of sp.tests) {
      const last = t.results.at(-1);
      const status = t.status === "expected" ? "bestanden" : t.status === "flaky" ? "wackelig" : t.status === "skipped" ? "übersprungen" : "fehlgeschlagen";
      const fehler = last?.error?.message?.replace(/\u001b\[[0-9;]*m/g, "").split("\n").find((l) => l.trim())?.trim();
      laeufe.push({ key: `${sp.file} › ${title}`, file: sp.file, title, projekt: t.projectName, status, fehler, dauer: t.results.reduce((a, r) => a + r.duration, 0) });
    }
  }
  for (const c of s.suites ?? []) walk(c, [...pfad, c.title]);
}
for (const s of report?.suites ?? []) walk(s, []);

const benutzt = new Set<string>();
function treffer(ref: string) {
  const [datei, titel] = ref.split(" › ");
  const t = laeufe.filter((l) => l.file.endsWith(datei) && l.title.includes(titel) && l.status !== "übersprungen");
  t.forEach((l) => benutzt.add(l.key));
  return t;
}
type Bewertung = { zeichen: "✓" | "✕" | "○"; text: string };
function bewerte(a: Ablauf): Bewertung {
  const t = a.tests.flatMap(treffer);
  if (!t.length) return { zeichen: "○", text: "im letzten Lauf nicht gelaufen" };
  const geraete = [...new Set(t.map((x) => x.projekt))].join(" + ");
  const kaputt = t.filter((x) => x.status === "fehlgeschlagen");
  if (kaputt.length) return { zeichen: "✕", text: `fehlgeschlagen (${kaputt.map((k) => k.projekt).join(", ")}): ${(kaputt[0].fehler ?? "").slice(0, 160)}` };
  const wackelig = t.some((x) => x.status === "wackelig");
  return { zeichen: "✓", text: `bestanden (${geraete})${wackelig ? " – erst im zweiten Versuch" : ""}` };
}
const zelle = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const datum = (iso: string) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

// Reiter aus der Navigation (Unterseiten als eigene Reiter) + Einträge ohne eigenen Menüpunkt
type Zeile = { bereich: string; name: string; pfad: string; r: Reiter };
const zeilen: Zeile[] = [];
const gesehen = new Set<string>();
for (const s of NAV) {
  for (const i of s.items) {
    const pfade = [{ name: i.label, pfad: i.href }, ...(SUBPAGES[i.href] ?? []).filter((x) => x.href !== i.href).map((x) => ({ name: `${i.label} › ${x.label}`, pfad: x.href }))];
    for (const p of pfade) {
      if (p.pfad.includes("#") || gesehen.has(p.pfad)) continue;
      gesehen.add(p.pfad);
      zeilen.push({ bereich: s.label, name: p.name, pfad: p.pfad, r: PRUEFSTAND[p.pfad] ?? {} });
    }
  }
}
for (const [k, r] of Object.entries(PRUEFSTAND)) if (!gesehen.has(k)) zeilen.push({ bereich: "Übergreifend", name: k, pfad: k.startsWith("/") ? k : "", r });

const allgemein = bewerte(ALLE_SEITEN);
const out: string[] = [];
const st = report?.stats;
out.push("# Prüfstand je Reiter", "");
out.push(
  st
    ? `Letzter Lauf der Ablaufprüfungen: **${datum(st.startTime)}** · ${st.expected} bestanden · ${st.unexpected} fehlgeschlagen · ${st.flaky} erst im zweiten Versuch · Dauer ${Math.round(st.duration / 1000)} s. Testumgebung mit erfundenen Daten, keine echten Dienste.`
    : "Noch kein Lauf gefunden (test-results/ergebnis.json fehlt) – erst `npm run e2e` ausführen.",
  "",
);
out.push("Erzeugt mit `npm run pruefstand` aus `e2e/pruefstand.ts` (Abläufe, Live-Prüfungen) und dem letzten Lauf. Nicht von Hand bearbeiten.", "");
out.push("Zeichen: ✓ automatisch bestanden · ✕ automatisch fehlgeschlagen · ○ im letzten Lauf nicht gelaufen · 👁 live geprüft · – noch nicht geprüft", "");

// 1) Übersicht
out.push("## Übersicht", "", "| Bereich | Reiter | Automatisch | Live | Noch offen |", "|---|---|---|---|---|");
for (const z of zeilen) {
  const ab = (z.r.abläufe ?? []).map(bewerte);
  const auto = ab.length ? `${ab.every((b) => b.zeichen === "✓") ? "✓" : ab.some((b) => b.zeichen === "✕") ? "✕" : "○"} ${ab.filter((b) => b.zeichen === "✓").length}/${ab.length} Abläufe` : z.pfad ? `${allgemein.zeichen} nur Oberfläche` : "–";
  const live = (z.r.live ?? []).length ? `👁 ${(z.r.live ?? []).map((l) => l.status).join(", ")}` : "–";
  const offen = (z.r.offen ?? []).length || (!ab.length && z.pfad) ? `${(z.r.offen ?? []).length || "Funktionen"}${(z.r.offen ?? []).length ? "" : " ungeprüft"}` : "–";
  out.push(`| ${z.bereich} | ${zelle(z.name)}${z.pfad ? ` \`${z.pfad}\`` : ""} | ${auto} | ${live} | ${offen} |`);
}
out.push("");

// 2) Je Reiter
out.push("## Je Reiter", "");
out.push(`Für **jede** Seite der Navigation gilt zusätzlich (Desktop und Handy): ${ALLE_SEITEN.ablauf}. Ergebnis: ${allgemein.zeichen} ${allgemein.text}.`, "");
for (const z of zeilen) {
  const ab = z.r.abläufe ?? [];
  if (!ab.length && !(z.r.live ?? []).length && !(z.r.offen ?? []).length) continue;
  out.push(`### ${z.bereich} › ${z.name}${z.pfad ? ` (\`${z.pfad}\`)` : ""}`, "");
  if (ab.length) {
    out.push("| Ablauf | Erwartet | Tatsächlich (automatisch) | Prüfung |", "|---|---|---|---|");
    for (const a of ab) {
      const b = bewerte(a);
      out.push(`| ${zelle(a.ablauf)} | ${zelle(a.erwartet)} | ${b.zeichen} ${zelle(b.text)} | ${a.tests.map((t) => `\`${t.split(" › ")[0]}\``).join(", ")} |`);
    }
    out.push("");
  } else if (z.pfad) out.push("Funktionen noch nicht automatisch geprüft – nur Seite + Oberfläche.", "");
  for (const l of z.r.live ?? []) out.push(`- 👁 Live (${l.datum}, ${l.wer}): ${l.ablauf} – ${l.ergebnis}`);
  for (const o of z.r.offen ?? []) out.push(`- – Offen: ${o}`);
  if ((z.r.live ?? []).length || (z.r.offen ?? []).length) out.push("");
}

// 3) Getrennt nach Art
const ohne = zeilen.filter((z) => z.pfad && !(z.r.abläufe ?? []).length);
out.push("## Getrennt: automatisch · live · noch nicht geprüft", "");
const autoAb = zeilen.flatMap((z) => (z.r.abläufe ?? []).map((a) => ({ z, a, b: bewerte(a) })));
out.push(`**Automatisch** (${autoAb.length} Abläufe + Oberfläche auf ${zeilen.filter((z) => z.pfad).length} Seiten): ${autoAb.filter((x) => x.b.zeichen === "✓").length} bestanden, ${autoAb.filter((x) => x.b.zeichen === "✕").length} fehlgeschlagen, ${autoAb.filter((x) => x.b.zeichen === "○").length} nicht gelaufen.`, "");
for (const x of autoAb.filter((x) => x.b.zeichen !== "✓")) out.push(`- ${x.b.zeichen} ${x.z.name}: ${x.a.ablauf} – ${x.b.text}`);
out.push("", "**Live geprüft:**", "");
const live = zeilen.flatMap((z) => (z.r.live ?? []).map((l) => ({ z, l })));
out.push(...(live.length ? live.map(({ z, l }) => `- ${z.name}: ${l.ablauf} (${l.datum}, ${l.wer}) – ${l.ergebnis}`) : ["- noch keine"]));
out.push("", `**Noch nicht geprüft** (Funktionen ohne Ablaufprüfung, ${ohne.length} Reiter – die Seiten selbst laufen in der Oberflächen-Prüfung mit):`, "");
out.push(ohne.map((z) => `${z.name} (\`${z.pfad}\`)`).join(" · "), "");
const offen = zeilen.flatMap((z) => (z.r.offen ?? []).map((o) => `- ${z.name}: ${o}`));
if (offen.length) out.push("", "**Bekannte offene Punkte:**", "", ...offen);

// 4) Prüfungen ohne Zuordnung (damit nichts verloren geht)
treffer(ALLE_SEITEN.tests[0]);
const frei = [...new Set(laeufe.filter((l) => l.status !== "übersprungen" && !benutzt.has(l.key)).map((l) => l.key))];
if (frei.length) out.push("", "## Prüfungen ohne Zuordnung zu einem Reiter", "", ...frei.map((k) => `- ${k} – bitte in e2e/pruefstand.ts eintragen`));

writeFileSync("PRUEFSTAND.md", `${out.join("\n").replace(/\n{3,}/g, "\n\n")}\n`);
console.log(`PRUEFSTAND.md geschrieben: ${zeilen.length} Reiter, ${autoAb.length} Abläufe, ${live.length} Live-Prüfungen, ${ohne.length} Reiter ohne Ablaufprüfung${frei.length ? `, ${frei.length} Prüfungen ohne Zuordnung` : ""}.`);
const fehlgeschlagen = autoAb.some((x) => x.b.zeichen === "✕");
process.exitCode = fehlgeschlagen ? 1 : 0;
