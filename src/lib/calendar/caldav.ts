// CalDAV-Client (RFC 4791) – getestet mit iCloud-Verhalten und Radicale.
// iCloud: https://caldav.icloud.com, Apple-ID + app-spezifisches Passwort.

import { find, findAll, parseMultistatus, textOf } from "./xml";

export type CalDavConfig = { server: string; username: string; password: string };
export type Calendar = { href: string; name: string; ctag: string | null; components: string[]; color: string | null };
export type RemoteEvent = { href: string; etag: string | null; ics: string };

export class CalDavError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export class CalDavClient {
  private readonly auth: string;
  constructor(private readonly cfg: CalDavConfig) {
    this.auth = "Basic " + Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
  }

  private abs(href: string, base = this.cfg.server) {
    return new URL(href, base).toString();
  }

  /** Anfrage mit Anmeldung; Weiterleitungen werden selbst verfolgt (sonst fiele die Anmeldung weg). */
  async request(method: string, url: string, opts: { body?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; text: string; headers: Headers; url: string }> {
    let target = url;
    for (let i = 0; i < 6; i++) {
      const res = await fetch(target, {
        method,
        redirect: "manual",
        headers: {
          Authorization: this.auth,
          ...(opts.body !== undefined ? { "Content-Type": method === "PUT" ? "text/calendar; charset=utf-8" : "application/xml; charset=utf-8" } : {}),
          ...opts.headers,
        },
        body: opts.body,
        signal: AbortSignal.timeout(30_000),
      });
      if ([301, 302, 307, 308].includes(res.status) && res.headers.get("location")) {
        target = new URL(res.headers.get("location")!, target).toString();
        continue;
      }
      const text = await res.text();
      if (res.status === 401) throw new CalDavError("Anmeldung abgelehnt – Apple-ID und app-spezifisches Passwort prüfen.", 401);
      return { status: res.status, text, headers: res.headers, url: target };
    }
    throw new CalDavError("Zu viele Weiterleitungen.", 310);
  }

  private async propfind(url: string, depth: 0 | 1, props: string) {
    const body = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/"><d:prop>${props}</d:prop></d:propfind>`;
    const r = await this.request("PROPFIND", url, { body, headers: { Depth: String(depth) } });
    if (r.status !== 207) throw new CalDavError(`Kalender-Server antwortet mit ${r.status}.`, r.status);
    return { responses: parseMultistatus(r.text), url: r.url };
  }

  /** Findet die Kalender-Sammlung des Benutzers (current-user-principal → calendar-home-set). */
  async homeSet(): Promise<string> {
    const p = await this.propfind(this.abs("/"), 0, "<d:current-user-principal/>");
    const principal = textOf(find(p.responses[0]?.props.get("current-user-principal") ?? { name: "", children: [], text: "" }, "href"));
    if (!principal) throw new CalDavError("Kalender-Konto nicht gefunden (kein current-user-principal).", 404);
    const principalUrl = this.abs(principal, p.url);
    const h = await this.propfind(principalUrl, 0, "<c:calendar-home-set/>");
    const home = textOf(find(h.responses[0]?.props.get("calendar-home-set") ?? { name: "", children: [], text: "" }, "href"));
    if (!home) throw new CalDavError("Keine Kalender-Sammlung gefunden (calendar-home-set).", 404);
    return this.abs(home, h.url);
  }

  async listCalendars(home?: string): Promise<{ home: string; calendars: Calendar[] }> {
    const h = home ?? (await this.homeSet());
    const r = await this.propfind(h, 1, "<d:displayname/><d:resourcetype/><cs:getctag/><c:supported-calendar-component-set/><ic:calendar-color/>");
    const calendars = r.responses
      .filter((x) => x.props.get("resourcetype") && find(x.props.get("resourcetype")!, "calendar"))
      .map((x) => {
        const comps = x.props.get("supported-calendar-component-set");
        // Leer heißt: der Server sagt nichts dazu – dann gilt alles als erlaubt.
        const components = comps ? findAll(comps, "comp").map((c) => (c.attrs?.name ?? "").toUpperCase()).filter(Boolean) : [];
        return {
          href: this.abs(x.href, r.url),
          name: textOf(x.props.get("displayname")) || x.href.split("/").filter(Boolean).pop() || "Kalender",
          ctag: textOf(x.props.get("getctag")) || null,
          components,
          color: textOf(x.props.get("calendar-color")) || null,
        };
      });
    return { home: h, calendars };
  }

  /** Legt einen Kalender an (MKCALENDAR) und liefert seine Adresse. */
  async createCalendar(home: string, name: string, color = "#0E6B5FFF"): Promise<string> {
    const href = this.abs(`seller-system-${Date.now().toString(36)}/`, home);
    const body = `<?xml version="1.0" encoding="utf-8"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ic="http://apple.com/ns/ical/"><d:set><d:prop><d:displayname>${escapeXml(name)}</d:displayname><ic:calendar-color>${color}</ic:calendar-color><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>`;
    const r = await this.request("MKCALENDAR", href, { body });
    if (r.status !== 201) throw new CalDavError(`Kalender „${name}" konnte nicht angelegt werden (${r.status}).`, r.status);
    return href;
  }

  /** Termine eines Kalenders, optional nur in einem Zeitraum; Serien werden wenn möglich vom Server aufgelöst. */
  async events(calendarHref: string, range?: { from: Date; to: Date }): Promise<RemoteEvent[]> {
    const tr = range ? `<c:time-range start="${icsTime(range.from)}" end="${icsTime(range.to)}"/>` : "";
    const query = (expand: boolean) =>
      `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data>${expand && range ? `<c:expand start="${icsTime(range.from)}" end="${icsTime(range.to)}"/>` : ""}</c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">${tr}</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
    let r = await this.request("REPORT", calendarHref, { body: query(true), headers: { Depth: "1" } });
    if (r.status !== 207 && range) r = await this.request("REPORT", calendarHref, { body: query(false), headers: { Depth: "1" } });
    if (r.status !== 207) throw new CalDavError(`Termine konnten nicht gelesen werden (${r.status}).`, r.status);
    return parseMultistatus(r.text)
      .filter((x) => x.props.get("calendar-data"))
      .map((x) => ({ href: this.abs(x.href, r.url), etag: textOf(x.props.get("getetag")) || null, ics: textOf(x.props.get("calendar-data")) }));
  }

  /** Schreibt einen Termin. `etag` = nur überschreiben, wenn unverändert; ohne = nur neu anlegen. */
  async put(href: string, ics: string, etag?: string | null): Promise<string | null> {
    const headers: Record<string, string> = etag ? { "If-Match": etag } : { "If-None-Match": "*" };
    let r = await this.request("PUT", href, { body: ics, headers });
    // 412: jemand hat den Termin inzwischen geändert (oder es gibt ihn schon) – dann trotzdem schreiben,
    // der Abgleich hat die Änderungen aus dem Kalender vorher schon übernommen.
    if (r.status === 412) r = await this.request("PUT", href, { body: ics });
    if (![200, 201, 204].includes(r.status)) throw new CalDavError(`Termin konnte nicht gespeichert werden (${r.status}).`, r.status);
    return r.headers.get("etag");
  }

  async remove(href: string): Promise<void> {
    const r = await this.request("DELETE", href);
    if (![200, 204, 404].includes(r.status)) throw new CalDavError(`Termin konnte nicht gelöscht werden (${r.status}).`, r.status);
  }
}

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function icsTime(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
