import { describe, expect, it } from "vitest";
import { formatSeen, isOnline } from "@/lib/auth/last-seen";

// „Zuletzt angemeldet / aktiv“ in Einstellungen → Benutzer (Zeiten in deutscher Zeit).

describe("Zuletzt angemeldet", () => {
  const now = new Date("2026-10-22T12:30:00Z"); // 14:30 in Berlin
  it("lesbar: gerade eben, vor X Min., heute, gestern, Datum, noch nie", () => {
    expect(formatSeen(new Date("2026-10-22T12:28:00Z"), now)).toBe("gerade eben");
    expect(formatSeen(new Date("2026-10-22T12:18:00Z"), now)).toBe("vor 12 Min.");
    expect(formatSeen(new Date("2026-10-22T07:05:00Z"), now)).toBe("heute 09:05");
    expect(formatSeen(new Date("2026-10-21T20:40:00Z"), now)).toBe("gestern 22:40");
    expect(formatSeen(new Date("2026-10-12T06:00:00Z"), now)).toBe("12.10.2026 08:00");
    expect(formatSeen(null, now)).toBe("noch nie");
  });
  it("aktiv = in den letzten 10 Minuten", () => {
    expect(isOnline(new Date("2026-10-22T12:25:00Z"), now)).toBe(true);
    expect(isOnline(new Date("2026-10-22T12:15:00Z"), now)).toBe(false);
    expect(isOnline(null, now)).toBe(false);
  });
});
