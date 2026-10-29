"use client";

// Warteschlange der Station: Befehle und Fotos gehen nacheinander an den Server. Ist das Netz weg, bleiben sie im
// Browser (IndexedDB) und werden später hochgeladen – auch nach einem Neuladen der Seite. Video-Teile laufen in
// einer eigenen Schlange, damit große Stücke die Befehle nicht aufhalten.

export type Auftrag =
  | { typ: "befehl"; body: Record<string, unknown> }
  | { typ: "foto"; art: string; voll: Blob; klein: Blob | null; code: string | null; ersetzen: boolean; neu: boolean }
  | { typ: "video"; pruefung: string; teil: number; daten: Blob };

type Gespeichert = Auftrag & { id?: number; angelegt: number };

const DB = "retouren-station";
const VERSION = 1;

function oeffnen(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("auftraege")) d.createObjectStore("auftraege", { keyPath: "id", autoIncrement: true });
      if (!d.objectStoreNames.contains("video")) d.createObjectStore("video", { keyPath: "id", autoIncrement: true });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
  });
}

const speicher = (a: Auftrag) => (a.typ === "video" ? "video" : "auftraege");

async function ablegen(a: Auftrag): Promise<number | null> {
  const d = await oeffnen();
  if (!d) return null;
  return new Promise((resolve) => {
    const tx = d.transaction(speicher(a), "readwrite");
    const req = tx.objectStore(speicher(a)).add({ ...a, angelegt: Date.now() } satisfies Gespeichert);
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => resolve(null);
  });
}

async function entfernen(store: string, id: number | null) {
  if (id === null) return;
  const d = await oeffnen();
  if (!d) return;
  d.transaction(store, "readwrite").objectStore(store).delete(id);
}

async function alle(store: string): Promise<Gespeichert[]> {
  const d = await oeffnen();
  if (!d) return [];
  return new Promise((resolve) => {
    const req = d.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve((req.result as Gespeichert[]).sort((a, b) => (a.id ?? 0) - (b.id ?? 0)));
    req.onerror = () => resolve([]);
  });
}

export class NetzFehler extends Error {}

async function senden(a: Auftrag): Promise<unknown> {
  let res: Response;
  try {
    if (a.typ === "befehl") res = await fetch("/remissionen/station/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a.body) });
    else if (a.typ === "foto") {
      const fd = new FormData();
      fd.set("art", a.art);
      fd.set("voll", a.voll, "foto.jpg");
      if (a.klein) fd.set("klein", a.klein, "klein.jpg");
      if (a.code) fd.set("code", a.code);
      if (a.ersetzen) fd.set("ersetzen", "1");
      if (a.neu) fd.set("neu", "1");
      res = await fetch("/remissionen/station/api/foto", { method: "POST", body: fd });
    } else res = await fetch(`/remissionen/station/api/video?pruefung=${a.pruefung}&teil=${a.teil}`, { method: "POST", headers: { "Content-Type": a.daten.type || "video/webm" }, body: a.daten });
  } catch {
    throw new NetzFehler("Netz weg");
  }
  if (res.status >= 500 || res.status === 0) throw new NetzFehler(`Server ${res.status}`);
  const j = await res.json().catch(() => ({ fehler: res.redirected ? "Bitte neu anmelden." : `Antwort ${res.status}` }));
  const fehler = (j as { fehler?: string }).fehler;
  if (!res.ok || fehler) throw new Error(fehler ?? `Fehler ${res.status}`);
  return j;
}

/**
 * Eine Schlange: `hinzu` legt den Auftrag ab und sendet in Reihenfolge. `antwort` bekommt die Server-Antwort
 * (oder einen Fehler); `offen` meldet, wie viele noch warten.
 */
export class Schlange {
  private laeuft = false;
  private liste: { id: number | null; a: Auftrag }[] = [];
  constructor(
    private store: "auftraege" | "video",
    private antwort: (a: Auftrag, r: unknown, fehler: string | null) => void,
    private offen: (n: number, netzWeg: boolean) => void,
  ) {}

  /** Nach dem Laden: was beim letzten Mal nicht hochging, wieder einreihen. */
  async wiederaufnehmen() {
    for (const g of await alle(this.store)) this.liste.push({ id: g.id ?? null, a: g });
    this.offen(this.liste.length, false);
    void this.abarbeiten();
  }

  async hinzu(a: Auftrag) {
    const id = await ablegen(a);
    this.liste.push({ id, a });
    this.offen(this.liste.length, false);
    void this.abarbeiten();
  }

  private async abarbeiten() {
    if (this.laeuft) return;
    this.laeuft = true;
    let warte = 1000;
    while (this.liste.length) {
      const x = this.liste[0];
      try {
        const r = await senden(x.a);
        this.liste.shift();
        await entfernen(this.store, x.id);
        warte = 1000;
        this.offen(this.liste.length, false);
        this.antwort(x.a, r, null);
      } catch (e) {
        if (e instanceof NetzFehler) {
          this.offen(this.liste.length, true);
          await new Promise((r) => setTimeout(r, warte));
          warte = Math.min(warte * 2, 30_000);
          continue;
        }
        this.liste.shift();
        await entfernen(this.store, x.id);
        this.offen(this.liste.length, false);
        this.antwort(x.a, null, e instanceof Error ? e.message : String(e));
      }
    }
    this.laeuft = false;
  }

  get anzahl() {
    return this.liste.length;
  }
}
