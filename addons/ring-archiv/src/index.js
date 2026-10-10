// Ring-Archiv (Home-Assistant-Add-on): lädt alle Aufnahmen der Ring-Kameras regelmäßig aus der
// Ring-Cloud (Ring-Protect-Abo nötig) und legt sie dauerhaft unter /media/<ordner> ab –
// gedacht für einen in Home Assistant eingebundenen Netzwerkspeicher (NAS).
import { createWriteStream } from 'node:fs'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { RingApi } from 'ring-client-api'
import { RingRestClient } from 'ring-client-api/rest-client'
import { alteLoeschen, dateiPfad, istBereit, zielPruefen } from './archiv.js'

const DATEN_DIR = process.env.DATEN_DIR ?? '/data'
const MEDIA_DIR = process.env.MEDIA_DIR ?? '/media'
const TOKEN_DATEI = path.join(DATEN_DIR, 'refresh-token')
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN ?? ''

const log = (...a) => console.log(new Date().toLocaleString('de-DE'), ...a)
const warte = (ms) => new Promise((r) => setTimeout(r, ms))
const existiert = (p) =>
  access(p).then(
    () => true,
    () => false,
  )

async function supervisor(pfad, body) {
  if (!SUPERVISOR_TOKEN) return
  const res = await fetch(`http://supervisor${pfad}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${SUPERVISOR_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Supervisor ${pfad}: HTTP ${res.status}`)
}

/** Meldung über das Skript „benachrichtigen“ (Paket sicherheit.yaml) an alle Handys. */
async function melden(nachricht) {
  log('Meldung:', nachricht)
  try {
    await supervisor('/core/api/services/script/benachrichtigen', { titel: 'Ring-Archiv', nachricht })
  } catch {
    // Skript fehlt → wenigstens in der Seitenleiste von Home Assistant anzeigen.
    await supervisor('/core/api/services/persistent_notification/create', {
      title: 'Ring-Archiv',
      message: nachricht,
    }).catch((e) => log('Home Assistant nicht erreichbar:', e.message))
  }
}

async function ladeOptionen() {
  return JSON.parse(await readFile(path.join(DATEN_DIR, 'options.json'), 'utf8'))
}

/** Feste Geräte-ID, damit Ring das Add-on über Neustarts hinweg wiedererkennt. */
async function systemId() {
  const datei = path.join(DATEN_DIR, 'system-id')
  try {
    return (await readFile(datei, 'utf8')).trim()
  } catch {
    const id = randomUUID()
    await writeFile(datei, id)
    return id
  }
}

async function speichereToken(token) {
  await writeFile(TOKEN_DATEI, token, { mode: 0o600 })
}

/**
 * Anmeldung in zwei Schritten über die Add-on-Einstellungen:
 * 1. E-Mail + Passwort eintragen, starten → Ring schickt einen Code.
 * 2. Code eintragen, speichern, neu starten → Token wird gespeichert, Zugangsdaten gelöscht.
 */
async function anmelden(opt) {
  try {
    const t = (await readFile(TOKEN_DATEI, 'utf8')).trim()
    if (t) return t
  } catch {}

  if (!opt.ring_email || !opt.ring_passwort) {
    log('Noch nicht angemeldet: Im Reiter „Konfiguration“ Ring E-Mail und Passwort eintragen, speichern, Add-on neu starten.')
    return null
  }
  const client = new RingRestClient({
    email: opt.ring_email,
    password: opt.ring_passwort,
    systemId: await systemId(),
  })
  try {
    await client.getAuth(opt.zwei_faktor_code?.trim() || undefined)
  } catch (e) {
    if (client.promptFor2fa) {
      await melden(
        opt.zwei_faktor_code
          ? 'Der Bestätigungscode war falsch oder abgelaufen. Feld „Bestätigungscode“ leeren, speichern und neu starten – Ring schickt dann einen neuen Code.'
          : 'Ring hat einen Bestätigungscode geschickt. Im Add-on unter „Konfiguration“ eintragen, speichern und das Add-on neu starten.',
      )
      return null
    }
    throw e
  }
  await speichereToken(client.refreshToken)
  log('Bei Ring angemeldet. Zugangsdaten werden aus den Einstellungen entfernt.')
  try {
    await supervisor('/addons/self/options', {
      options: { ...opt, ring_email: '', ring_passwort: '', zwei_faktor_code: '' },
    })
  } catch (e) {
    log('Konnte die Zugangsdaten nicht automatisch löschen – bitte von Hand leeren:', e.message)
  }
  return client.refreshToken
}

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

async function kameraSichern(kamera, ziel, rueckblickTage) {
  const grenze = Date.now() - rueckblickTage * 86_400_000
  let neu = 0
  let schluessel
  for (let seite = 0; seite < 50; seite++) {
    const antwort = await kamera.getEvents({ limit: 50, pagination_key: schluessel })
    const events = antwort.events ?? []
    for (const ev of events) {
      if (new Date(ev.created_at).getTime() < grenze) return neu
      if (!istBereit(ev)) continue
      const datei = dateiPfad(ziel, ev, kamera.name)
      if (await existiert(datei)) continue
      try {
        await herunterladen(await kamera.getRecordingUrl(ev.ding_id_str), datei)
        neu++
        log(`Gespeichert: ${path.relative(ziel, datei)}`)
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
  const opt = await ladeOptionen()
  const ziel = path.join(MEDIA_DIR, opt.ordner)
  const intervall = opt.intervall_minuten * 60_000
  // Nach etwa einer Stunde Fehlern in Folge gibt es eine Meldung.
  const schwelle = Math.max(1, Math.round(60 / opt.intervall_minuten))

  const token = await anmelden(opt).catch(async (e) => {
    await melden(`Anmeldung bei Ring fehlgeschlagen: ${e.message}`)
    return null
  })
  if (!token) {
    // Auf Eingabe warten – das Add-on läuft weiter, damit es nicht als abgestürzt gilt.
    for (;;) await warte(3_600_000)
  }

  const ring = new RingApi({ refreshToken: token, systemId: await systemId() })
  // Ring tauscht das Token regelmäßig aus – das neue muss gespeichert werden.
  ring.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) =>
    speichereToken(newRefreshToken).catch((e) => log('Token nicht gespeichert:', e.message)),
  )

  log(
    `Ring-Archiv läuft: Ziel ${ziel}, alle ${opt.intervall_minuten} min, ` +
      `Aufbewahrung ${opt.aufbewahrung_tage > 0 ? `${opt.aufbewahrung_tage} Tage` : 'unbegrenzt'}.`,
  )

  let fehlerInFolge = 0
  for (;;) {
    try {
      await zielPruefen(ziel, opt.nur_auf_nas, DATEN_DIR)
      let neu = 0
      for (const k of await ring.getCameras()) neu += await kameraSichern(k, ziel, opt.rueckblick_tage)
      const geloescht = await alteLoeschen(ziel, opt.aufbewahrung_tage)
      if (neu || geloescht.length) {
        log(`${neu} neue Aufnahme(n), ${geloescht.length} alte Tagesordner gelöscht.`)
      }
      if (fehlerInFolge >= schwelle) await melden('Läuft wieder – Aufnahmen werden gespeichert.')
      fehlerInFolge = 0
    } catch (e) {
      fehlerInFolge++
      log('Durchlauf fehlgeschlagen:', e.message)
      if (fehlerInFolge === schwelle) {
        await melden(`Seit etwa einer Stunde werden keine Aufnahmen gespeichert: ${e.message}`)
      }
    }
    await warte(intervall)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
