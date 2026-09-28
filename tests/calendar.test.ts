import { describe, expect, it } from "vitest";
import { buildEvent, parseDateValue, parseEvents } from "@/lib/calendar/ics";
import { hashDesired, planCalendarChanges, planPush, uidFor, type DesiredItem, type StoredItem } from "@/lib/calendar/plan";
import { parseMultistatus } from "@/lib/calendar/xml";
import { expandCalendar } from "@/lib/calendar/recur";
import { parseFeedList } from "@/lib/calendar/feeds";
import { monthGrid, parseMonth, shiftMonth, spreadDays } from "@/lib/calendar/month";

const desired = (over: Partial<DesiredItem> = {}): DesiredItem => ({ key: "task:1", title: "Rechnung anfordern", date: "2026-10-02", description: "", link: "/", category: "Aufgabe", taskId: "t1", remind: true, ...over });
const stored = (over: Partial<StoredItem> = {}): StoredItem => ({ id: "s1", sourceKey: "task:1", uid: "u1", href: "/cal/u1.ics", etag: '"1"', hash: hashDesired(desired()), date: "2026-10-02", title: "Rechnung anfordern", taskId: "t1", ...over });

describe("iCalendar", () => {
  it("schreibt ganztägige Termine mit Erinnerung und liest sie zurück", () => {
    const ics = buildEvent({ uid: "x@y", title: "Frist: A-bis-Z; Bestellung 302-1, wichtig", date: "2026-10-02", description: "Zeile 1\nZeile 2", alarmAtMinute: 540 });
    expect(ics).toContain("DTSTART;VALUE=DATE:20261002");
    expect(ics).toContain("DTEND;VALUE=DATE:20261003");
    expect(ics).toContain("TRIGGER:PT540M");
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    const [e] = parseEvents(ics);
    expect(e).toMatchObject({ uid: "x@y", title: "Frist: A-bis-Z; Bestellung 302-1, wichtig", start: "2026-10-02", allDay: true, description: "Zeile 1\nZeile 2" });
  });

  it("rechnet Uhrzeiten mit Zeitzone, UTC und ohne Angabe richtig um", () => {
    expect(parseDateValue("20261002T090000", { TZID: "Europe/Berlin" })?.iso).toBe("2026-10-02T07:00:00.000Z");
    expect(parseDateValue("20261202T090000", { TZID: "Europe/Berlin" })?.iso).toBe("2026-12-02T08:00:00.000Z");
    expect(parseDateValue("20261002T090000Z", {})?.iso).toBe("2026-10-02T09:00:00.000Z");
    expect(parseDateValue("20261002T090000", { TZID: "America/New_York" })?.iso).toBe("2026-10-02T13:00:00.000Z");
    expect(parseDateValue("20261002", { VALUE: "DATE" })).toEqual({ iso: "2026-10-02", allDay: true });
  });

  it("liest Apple-Termine mit gefalteten Zeilen, Parametern in Anführungszeichen und Erinnerungen", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:ABC-123",
      'DTSTART;TZID="Europe/Berlin":20261005T143000',
      "DTEND;TZID=Europe/Berlin:20261005T153000",
      "SUMMARY:Steuerberater – Unterlagen",
      "  mitnehmen",
      "LOCATION:Hauptstr. 1\\, Berlin",
      "BEGIN:VALARM",
      "TRIGGER:-PT15M",
      "DESCRIPTION:Erinnerung",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const [e] = parseEvents(ics);
    expect(e).toMatchObject({ uid: "ABC-123", title: "Steuerberater – Unterlagen mitnehmen", start: "2026-10-05T12:30:00.000Z", allDay: false, location: "Hauptstr. 1, Berlin", description: null });
  });
});

describe("WebDAV-Antworten", () => {
  it("liest Multistatus mit verschiedenen Namensraum-Präfixen", () => {
    const xml = `<?xml version="1.0"?><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><response><href>/cal/a%20b.ics</href><propstat><prop><getetag>"e1"</getetag><C:calendar-data><![CDATA[BEGIN:VCALENDAR
END:VCALENDAR]]></C:calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat><propstat><prop><displayname/></prop><status>HTTP/1.1 404 Not Found</status></propstat></response></multistatus>`;
    const [r] = parseMultistatus(xml);
    expect(r.href).toBe("/cal/a b.ics");
    expect(r.props.has("getetag")).toBe(true);
    expect(r.props.has("displayname")).toBe(false);
  });
});

describe("Abgleich-Plan", () => {
  it("Kalender → System: verschoben, gelöscht, neu", () => {
    const s = [stored(), stored({ id: "s2", sourceKey: "ship:2026-10-02", uid: "u2", taskId: null, title: "Versand: 2 Sendungen" }), stored({ id: "s3", sourceKey: "task:3", uid: "u3", taskId: "t3" })];
    const remote = [
      { uid: "u1", href: "/cal/u1.ics", etag: '"2"', date: "2026-10-05", title: "‼ Rechnung anfordern", description: null },
      { uid: "u2", href: "/cal/u2.ics", etag: '"1"', date: "2026-10-09", title: "Versand: 2 Sendungen", description: null },
      { uid: "neu", href: "/cal/neu.ics", etag: '"1"', date: "2026-10-07", title: "Lager aufräumen", description: null },
    ];
    const c = planCalendarChanges(s, remote);
    expect(c.moved).toEqual([{ item: s[0], date: "2026-10-05", title: "Rechnung anfordern" }]);
    expect(c.reset.map((x) => x.uid)).toEqual(["u2"]); // Sammeltermin wird zurückgesetzt
    expect(c.deleted.map((x) => x.uid)).toEqual(["u3"]);
    expect(c.created.map((x) => x.uid)).toEqual(["neu"]);
  });

  it("System → Kalender: nur bei Änderung schreiben, Erledigtes entfernen", () => {
    const s = [stored(), stored({ id: "s2", sourceKey: "task:2", uid: "u2" })];
    const p = planPush(s, [desired(), desired({ key: "task:9", taskId: "t9" }), desired({ key: "task:2", date: "2026-10-03" })]);
    expect(p.create.map((d) => d.key)).toEqual(["task:9"]);
    expect(p.update.map((u) => u.item.sourceKey)).toEqual(["task:2"]);
    expect(p.remove).toEqual([]);
    expect(planPush(s, [desired()]).remove.map((x) => x.sourceKey)).toEqual(["task:2"]);
  });

  it("UIDs sind je Firma und Quelle stabil", () => {
    expect(uidFor("a", "task:1")).toBe(uidFor("a", "task:1"));
    expect(uidFor("a", "task:1")).not.toBe(uidFor("b", "task:1"));
    expect(uidFor("a", "task:1")).toMatch(/^seller-[0-9a-f]{24}@seller-system$/);
  });
});

describe("Monatsansicht", () => {
  it("baut das Raster von Montag bis Sonntag", () => {
    const g = monthGrid("2026-10"); // 1. Oktober 2026 ist ein Donnerstag
    expect(g[0]).toBe("2026-09-28");
    expect(g[g.length - 1]).toBe("2026-11-01");
    expect(g.length % 7).toBe(0);
    expect(monthGrid("2027-02")).toHaveLength(28); // Feb 2027 beginnt Montag, endet Sonntag
  });

  it("blättert über Jahresgrenzen und verteilt mehrtägige Termine", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(parseMonth("2026-13", "2026-09-28")).toBe("2026-09");
    expect(spreadDays("2026-09-30", "2026-10-03", "2026-09-28", "2026-11-01")).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(spreadDays("2026-09-20", "2026-09-30", "2026-09-28", "2026-11-01")).toEqual(["2026-09-28", "2026-09-29"]);
    expect(spreadDays("2026-10-05", null, "2026-09-28", "2026-11-01")).toEqual(["2026-10-05"]);
  });
});

describe("Serientermine", () => {
  const ics = (lines: string[]) => ["BEGIN:VCALENDAR", ...lines, "END:VCALENDAR"].join("\r\n");
  const range = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-11-01T00:00:00Z") };

  it("wöchentlich zur gleichen Ortszeit über die Zeitumstellung, mit Ausnahme und geändertem Termin", () => {
    const evs = parseEvents(ics([
      "BEGIN:VEVENT", "UID:jf", "SUMMARY:Jourfix", "DTSTART;TZID=Europe/Berlin:20260803T100000", "DTEND;TZID=Europe/Berlin:20260803T110000",
      "RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE;TZID=Europe/Berlin:20260914T100000", "END:VEVENT",
      "BEGIN:VEVENT", "UID:jf", "SUMMARY:Jourfix (verschoben)", "RECURRENCE-ID;TZID=Europe/Berlin:20260921T100000", "DTSTART;TZID=Europe/Berlin:20260922T150000", "DTEND;TZID=Europe/Berlin:20260922T160000", "END:VEVENT",
    ]));
    const out = expandCalendar(evs, range);
    const starts = out.map((o) => `${o.start} ${o.title}`);
    expect(starts).toContain("2026-09-07T08:00:00.000Z Jourfix");
    expect(starts).not.toContain("2026-09-14T08:00:00.000Z Jourfix"); // EXDATE
    expect(starts).not.toContain("2026-09-21T08:00:00.000Z Jourfix"); // ersetzt …
    expect(starts).toContain("2026-09-22T13:00:00.000Z Jourfix (verschoben)"); // … durch den geänderten
    expect(starts).toContain("2026-10-26T09:00:00.000Z Jourfix"); // nach der Zeitumstellung weiter 10 Uhr
    expect(out.filter((o) => o.title === "Jourfix")).toHaveLength(6); // 8 Montage − Ausnahme − verschobener
    expect(out.find((o) => o.start === "2026-09-07T08:00:00.000Z")?.end).toBe("2026-09-07T09:00:00.000Z");
  });

  it("jährliche Geburtstage, monatlich „letzter Freitag“, COUNT und UNTIL", () => {
    const evs = parseEvents(ics([
      "BEGIN:VEVENT", "UID:gb", "SUMMARY:Geburtstag Tini", "DTSTART;VALUE=DATE:19900916", "DTEND;VALUE=DATE:19900917", "RRULE:FREQ=YEARLY", "END:VEVENT",
      "BEGIN:VEVENT", "UID:lf", "SUMMARY:Abrechnung", "DTSTART;VALUE=DATE:20260130", "RRULE:FREQ=MONTHLY;BYDAY=-1FR", "END:VEVENT",
      "BEGIN:VEVENT", "UID:c", "SUMMARY:Kurs", "DTSTART;VALUE=DATE:20260901", "RRULE:FREQ=DAILY;INTERVAL=2;COUNT=3", "END:VEVENT",
      "BEGIN:VEVENT", "UID:u", "SUMMARY:Therapie", "DTSTART:20260904T120000Z", "RRULE:FREQ=WEEKLY;UNTIL=20260918T120000Z", "END:VEVENT",
    ]));
    const out = expandCalendar(evs, range);
    const of = (t: string) => out.filter((o) => o.title === t).map((o) => o.start);
    expect(of("Geburtstag Tini")).toEqual(["2026-09-16"]);
    expect(of("Abrechnung")).toEqual(["2026-09-25", "2026-10-30"]);
    expect(of("Kurs")).toEqual(["2026-09-01", "2026-09-03", "2026-09-05"]);
    expect(of("Therapie")).toEqual(["2026-09-04T12:00:00.000Z", "2026-09-11T12:00:00.000Z", "2026-09-18T12:00:00.000Z"]);
  });
});

describe("Kalender per Link", () => {
  it("liest die Liste mit und ohne Namen, webcal wird https", () => {
    const f = parseFeedList("Familie | webcal://calendar.google.com/x/basic.ics\n\n# Kommentar\nhttps://outlook.office365.com/owa/calendar/y/calendar.ics\nkein Link");
    expect(f).toEqual([
      { name: "Familie", url: "https://calendar.google.com/x/basic.ics", color: "#F59E0B" },
      { name: null, url: "https://outlook.office365.com/owa/calendar/y/calendar.ics", color: "#8B5CF6" },
    ]);
  });
});
