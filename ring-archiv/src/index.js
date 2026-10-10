// Ring-Archiv: lädt alle Aufnahmen der Ring-Kameras regelmäßig aus der Ring-Cloud
// (Ring-Protect-Abo nötig) und legt sie dauerhaft im Ordner AUFNAHMEN_DIR ab.
import { createWriteStream } from 'node:fs'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { RingApi } from 'ring-client-api'
import { alteLoeschen, dateiPfad, istBereit } from './archiv.js'

const AUFNAHMEN_DIR = process.env.AUFNAHMEN_DIR ?? '/aufnahmen'
const DATEN_DIR = process.env.DATEN_DIR ?? '/data'
const TOKEN_DATEI = path.join(DATEN_DIR, 'refresh-token')
const INTERVALL_MIN = Number(process.env.INTERVALL_MINUTEN ?? 5)
const RUECKBLICK_TAGE = Number(process.env.RUECKBLICK_TAGE ?? 7)
const AUFBEWAHRUNG_TAGE = Number(process.env.AUFBEWAHRUNG_TAGE ?? 90)
const WEBHOOK_URL = process.env.HA_WEBHOOK_URL ?? ''
// Nach so vielen fehlgeschlagenen Durchläufen hintereinander gibt es eine Meldung (≈ 1 Stunde).
const FEHLER_SCHWELLE = Math.max(1, Math.round(60 / INTERVALL_MIN))

const log = (...a) => console.log(new Date().toISOString(), ...a)

async function ladeToken() {
  try {
    const t = (await readFile(TOKEN_DATEI, 'utf8')).trim()
    if (t) return t
  } catch {}
  const t = process.env.RING_REFRESH_TOKEN?.trim()
  if (!t) {
    console.error(
      'Kein Ring-Token. Einmalig anmelden mit:\n  docker compose run --rm ring-archiv anmelden',
    )
    process.exit(1)
  }
  return t
}

async function melden(nachricht) {
  log('Meldung an Home Assistant:', nachricht)
  if (!WEBHOOK_URL) return
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nachricht }),
    })
  } catch (e) {
    log('Home Assistant nicht erreichbar:', e.message)
  }
}

const existiert = (p) =>
  access(p).then(
    () => true,
    () => false,
  )

async function herunterladen(url, ziel) {
  await mkdir(path.dirname(ziel), { recursive: true })
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (HTTP ${res.status})`)
  const tmp = `${ziel}.tmp`
  try {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp))
    await rename(tmp, ziel)
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
}

async function kameraSichern(kamera) {
  const grenze = Date.now() - RUECKBLICK_TAGE * 86_400_000
  let neu = 0
  let schluessel
  for (let seite = 0; seite < 50; seite++) {
    const antwort = await kamera.getEvents({ limit: 50, pagination_key: schluessel })
    const events = antwort.events ?? []
    for (const ev of events) {
      if (new Date(ev.created_at).getTime() < grenze) return neu
      if (!istBereit(ev)) continue
      const ziel = dateiPfad(AUFNAHMEN_DIR, ev, kamera.name)
      if (await existiert(ziel)) continue
      try {
        const url = await kamera.getRecordingUrl(ev.ding_id_str)
        await herunterladen(url, ziel)
        neu++
        log(`Gespeichert: ${path.relative(AUFNAHMEN_DIR, ziel)}`)
      } catch (e) {
        log(`Aufnahme ${ev.ding_id_str} (${kamera.name}) übersprungen:`, e.message)
      }
    }
    schluessel = antwort.meta?.pagination_key
    if (!schluessel || events.length === 0) break
  }
  return neu
}

async function main() {
  await mkdir(DATEN_DIR, { recursive: true })
  await mkdir(AUFNAHMEN_DIR, { recursive: true })

  const ring = new RingApi({ refreshToken: await ladeToken() })
  // Ring tauscht das Token regelmäßig aus – das neue muss gespeichert werden,
  // sonst ist nach einem Neustart die Anmeldung weg.
  ring.onRefreshTokenUpdated.subscribe(async ({ newRefreshToken }) => {
    await writeFile(TOKEN_DATEI, newRefreshToken, { mode: 0o600 })
    log('Ring-Token erneuert und gespeichert.')
  })

  let fehlerInFolge = 0
  log(
    `Ring-Archiv läuft: alle ${INTERVALL_MIN} min, Rückblick ${RUECKBLICK_TAGE} Tage, ` +
      `Aufbewahrung ${AUFBEWAHRUNG_TAGE > 0 ? `${AUFBEWAHRUNG_TAGE} Tage` : 'unbegrenzt'}.`,
  )

  for (;;) {
    try {
      const kameras = await ring.getCameras()
      let neu = 0
      for (const k of kameras) neu += await kameraSichern(k)
      const geloescht = await alteLoeschen(AUFNAHMEN_DIR, AUFBEWAHRUNG_TAGE)
      if (neu || geloescht.length) {
        log(`${neu} neue Aufnahme(n), ${geloescht.length} alte Tagesordner gelöscht.`)
      }
      if (fehlerInFolge >= FEHLER_SCHWELLE) await melden('Ring-Archiv läuft wieder.')
      fehlerInFolge = 0
    } catch (e) {
      fehlerInFolge++
      log('Durchlauf fehlgeschlagen:', e.message)
      if (fehlerInFolge === FEHLER_SCHWELLE) {
        await melden(
          `Ring-Archiv: seit etwa einer Stunde keine Verbindung zu Ring (${e.message}). ` +
            'Ggf. neu anmelden: docker compose run --rm ring-archiv anmelden',
        )
      }
    }
    await new Promise((r) => setTimeout(r, INTERVALL_MIN * 60_000))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
