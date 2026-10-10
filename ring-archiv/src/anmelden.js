// Einmalige Anmeldung bei Ring (E-Mail, Passwort, 2FA-Code) – speichert das Token für das Archiv.
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { RingRestClient } from 'ring-client-api/rest-client'

const DATEN_DIR = process.env.DATEN_DIR ?? '/data'
const rl = createInterface({ input: process.stdin, output: process.stdout })

const email = (await rl.question('Ring E-Mail: ')).trim()
const password = (await rl.question('Ring Passwort: ')).trim()
const client = new RingRestClient({ email, password })

let auth
try {
  auth = await client.getCurrentAuth()
} catch (e) {
  if (!client.promptFor2fa) throw e
  console.log(client.promptFor2fa)
  while (!auth) {
    const code = (await rl.question('Code aus SMS/E-Mail/App: ')).trim()
    auth = await client.getAuth(code).catch(() => console.log('Code falsch – bitte noch einmal.'))
  }
}
rl.close()

await mkdir(DATEN_DIR, { recursive: true })
await writeFile(path.join(DATEN_DIR, 'refresh-token'), auth.refresh_token, { mode: 0o600 })
console.log('Angemeldet. Token gespeichert – jetzt starten mit: docker compose up -d ring-archiv')
process.exit(0)
