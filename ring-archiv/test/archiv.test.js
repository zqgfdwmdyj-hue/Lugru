import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { alteLoeschen, artName, dateiPfad, istBereit, sicherName } from '../src/archiv.js'

test('sicherName ersetzt Umlaute und Sonderzeichen', () => {
  assert.equal(sicherName('Haustür Außen'), 'haustuer-aussen')
  assert.equal(sicherName('  !! '), 'kamera')
})

test('artName übersetzt Ring-Ereignisse', () => {
  assert.equal(artName('ding'), 'klingel')
  assert.equal(artName('motion'), 'bewegung')
  assert.equal(artName('on_demand'), 'live')
  assert.equal(artName('alarm_x'), 'alarm-x')
})

test('dateiPfad legt nach deutscher Ortszeit ab (Sommerzeit und Tageswechsel)', () => {
  const ev = { created_at: '2026-07-31T22:15:04Z', kind: 'ding', ding_id_str: '7312' }
  assert.equal(
    dateiPfad('/a', ev, 'Haustür'),
    path.join('/a', '2026', '08', '01', '00-15-04_haustuer_klingel_7312.mp4'),
  )
  const winter = { created_at: '2026-01-05T08:00:00Z', kind: 'motion', ding_id_str: '1' }
  assert.equal(
    dateiPfad('/a', winter, 'Garten'),
    path.join('/a', '2026', '01', '05', '09-00-00_garten_bewegung_1.mp4'),
  )
})

test('istBereit wartet auf fertige Verarbeitung', () => {
  const jetzt = Date.parse('2026-10-10T12:00:00Z')
  const alt = '2026-10-10T11:55:00Z'
  assert.equal(istBereit({ recording_status: 'ready', created_at: alt }, jetzt), true)
  assert.equal(istBereit({ recording_status: 'audio_ready', created_at: alt }, jetzt), false)
  assert.equal(
    istBereit({ recording_status: 'ready', created_at: '2026-10-10T11:59:30Z' }, jetzt),
    false,
  )
})

test('alteLoeschen entfernt nur Tagesordner jenseits der Aufbewahrung', async () => {
  const basis = await mkdtemp(path.join(tmpdir(), 'ring-'))
  for (const tag of ['2026/07/01', '2026/07/13', '2026/10/09']) {
    await mkdir(path.join(basis, tag), { recursive: true })
    await writeFile(path.join(basis, tag, 'x.mp4'), '')
  }
  const geloescht = await alteLoeschen(basis, 90, new Date('2026-10-10T12:00:00Z'))
  assert.deepEqual(geloescht, [path.join(basis, '2026/07/01')])
  assert.deepEqual(await readdir(path.join(basis, '2026/07')), ['13'])
  assert.deepEqual(await alteLoeschen(basis, 0), [])
})
