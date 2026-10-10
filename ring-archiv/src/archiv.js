// Reine Hilfsfunktionen des Ring-Archivs (ohne Netzwerk) – damit sie sich testen lassen.
import { readdir, rm, rmdir } from 'node:fs/promises'
import path from 'node:path'

const ZEITZONE = 'Europe/Berlin'

const ARTEN = {
  ding: 'klingel',
  motion: 'bewegung',
  on_demand: 'live',
  on_demand_link: 'live',
}

/** Kameranamen dateisystemtauglich machen: „Haustür Außen“ → „haustuer-aussen“. */
export function sicherName(name) {
  const ersetzt = String(name)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return ersetzt || 'kamera'
}

export function artName(kind) {
  return ARTEN[kind] ?? sicherName(kind ?? 'aufnahme')
}

/** Datum und Uhrzeit in deutscher Zeit zerlegen. */
export function ortszeit(datum) {
  const teile = Object.fromEntries(
    new Intl.DateTimeFormat('de-DE', {
      timeZone: ZEITZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(datum)
      .map((t) => [t.type, t.value]),
  )
  return teile
}

/** Ablage: <basis>/2026/10/10/14-03-22_haustuer_klingel_7312….mp4 */
export function dateiPfad(basis, event, kameraName) {
  const z = ortszeit(new Date(event.created_at))
  const datei = `${z.hour}-${z.minute}-${z.second}_${sicherName(kameraName)}_${artName(event.kind)}_${event.ding_id_str}.mp4`
  return path.join(basis, z.year, z.month, z.day, datei)
}

/** Ein Ereignis kann geladen werden, wenn Ring die Aufnahme fertig verarbeitet hat. */
export function istBereit(event, jetzt = Date.now()) {
  const alter = jetzt - new Date(event.created_at).getTime()
  return event.recording_status === 'ready' && alter > 60_000
}

/** Tagesordner löschen, die älter als <tage> sind. Gibt die gelöschten Ordner zurück. */
export async function alteLoeschen(basis, tage, jetzt = new Date()) {
  if (!tage || tage <= 0) return []
  const grenze = new Date(jetzt.getTime() - tage * 86_400_000)
  const g = ortszeit(grenze)
  const grenzSchluessel = `${g.year}${g.month}${g.day}`
  const geloescht = []

  for (const jahr of await ordner(basis)) {
    for (const monat of await ordner(path.join(basis, jahr))) {
      for (const tag of await ordner(path.join(basis, jahr, monat))) {
        if (`${jahr}${monat}${tag}` < grenzSchluessel) {
          const p = path.join(basis, jahr, monat, tag)
          await rm(p, { recursive: true, force: true })
          geloescht.push(p)
        }
      }
      await rmdir(path.join(basis, jahr, monat)).catch(() => {})
    }
    await rmdir(path.join(basis, jahr)).catch(() => {})
  }
  return geloescht
}

async function ordner(p) {
  try {
    const eintraege = await readdir(p, { withFileTypes: true })
    return eintraege.filter((e) => e.isDirectory() && /^\d+$/.test(e.name)).map((e) => e.name)
  } catch {
    return []
  }
}
