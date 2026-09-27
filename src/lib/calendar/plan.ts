// Abgleich-Plan zwischen System und Kalender – reine Logik, ohne Netz und Datenbank.
//
// Richtung Kalender → System (zuerst, damit Änderungen im Kalender gewinnen):
//   • Aufgabe im Kalender verschoben  → Fälligkeitsdatum übernehmen (und neuer Titel)
//   • Aufgabe im Kalender gelöscht    → Aufgabe abhaken
//   • neuer Termin im Kalender „Seller-System" → neue Aufgabe
//   • andere Termine verschoben/gelöscht → werden beim nächsten Schreiben wiederhergestellt
// Richtung System → Kalender:
//   • neue Fälligkeiten anlegen, geänderte überschreiben, erledigte entfernen

import { createHash } from "node:crypto";

export type StoredItem = { id: string; sourceKey: string; uid: string; href: string; etag: string | null; hash: string; date: string; title: string; taskId: string | null };
export type RemoteItem = { uid: string; href: string; etag: string | null; date: string; title: string; description: string | null };
export type DesiredItem = { key: string; title: string; date: string; description: string; link: string; category: string; taskId?: string; remind: boolean };

export function hashDesired(d: DesiredItem): string {
  return createHash("sha1").update(JSON.stringify([d.title, d.date, d.description, d.link, d.category, d.remind])).digest("hex");
}

/** Eindeutige UID je Mandant und Quelle – stabil, damit derselbe Termin nie doppelt entsteht. */
export function uidFor(tenantId: string, key: string): string {
  return `seller-${createHash("sha1").update(`${tenantId}|${key}`).digest("hex").slice(0, 24)}@seller-system`;
}

export type CalendarChanges = {
  deleted: StoredItem[];
  moved: { item: StoredItem; date: string; title: string }[];
  /** Termine, die jemand im Kalender verändert hat, die aber keine Aufgabe sind – beim Schreiben wiederherstellen. */
  reset: StoredItem[];
  created: RemoteItem[];
};

export function planCalendarChanges(stored: StoredItem[], remote: RemoteItem[]): CalendarChanges {
  const remoteByUid = new Map(remote.map((r) => [r.uid, r]));
  const storedUids = new Set(stored.map((s) => s.uid));
  const out: CalendarChanges = { deleted: [], moved: [], reset: [], created: [] };
  for (const s of stored) {
    const r = remoteByUid.get(s.uid);
    if (!r) {
      out.deleted.push(s);
      continue;
    }
    const titleChanged = r.title !== s.title;
    if (r.date === s.date && !titleChanged) continue;
    if (s.taskId) out.moved.push({ item: s, date: r.date, title: stripPrefix(r.title) });
    else out.reset.push(s);
  }
  for (const r of remote) if (!storedUids.has(r.uid)) out.created.push(r);
  return out;
}

/** „‼ " kennzeichnet kritische Aufgaben im Kalender – beim Zurücklesen weglassen. */
export const stripPrefix = (title: string) => title.replace(/^‼\s*/, "");

export type PushPlan = {
  create: DesiredItem[];
  update: { item: StoredItem; desired: DesiredItem }[];
  remove: StoredItem[];
};

export function planPush(stored: StoredItem[], desired: DesiredItem[]): PushPlan {
  const byKey = new Map(stored.map((s) => [s.sourceKey, s]));
  const wanted = new Set(desired.map((d) => d.key));
  const out: PushPlan = { create: [], update: [], remove: [] };
  for (const d of desired) {
    const s = byKey.get(d.key);
    if (!s) out.create.push(d);
    else if (s.hash !== hashDesired(d)) out.update.push({ item: s, desired: d });
  }
  for (const s of stored) if (!wanted.has(s.sourceKey)) out.remove.push(s);
  return out;
}
