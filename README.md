# Smart-Home-Zentrale

Home Assistant als zentrale Oberfläche für alle Geräte, dazu ein **Ring-Archiv**, das jede
Aufnahme der Ring-Kamera automatisch und dauerhaft auf dem Server speichert.
Läuft auf demselben Server wie das Seller-System, ist aber **komplett davon getrennt**:
eigener Ordner (`/opt/smarthome`), eigene Container, eigener Port, keine gemeinsamen Daten.

| Gerät | Anbindung | Läuft über |
|---|---|---|
| 2× SwitchBot Schloss (Gesichtserkennung / Tastenfeld) | Integration „SwitchBot Cloud“ | SwitchBot Hub Mini (Matter) → SwitchBot-Cloud |
| 2× FRITZ!DECT Heizkörperthermostat | Integration „AVM FRITZ!SmartHome“ | WireGuard-Tunnel Server ↔ FRITZ!Box |
| (geplant) 2× FRITZ!DECT 440 als Raumfühler | in der FRITZ!Box dem Thermostat zuweisen | erscheint automatisch mit |
| Ring Außenkamera | Integration „Ring“ + **Ring-Archiv** | Ring-Cloud (Ring-Protect-Abo) |

```
Handy (Home-Assistant-App, Tailscale)
        │
        ▼
Server ─ Home Assistant :8123 ── WireGuard ──► FRITZ!Box ──► Thermostate, Raumfühler
       │                    └── Internet ───► SwitchBot-Cloud, Ring-Cloud
       └ Ring-Archiv ──► /opt/smarthome/aufnahmen/JJJJ/MM/TT/*.mp4
```

Home Assistant ist **nur über die private Adresse** (Tailscale) erreichbar, nicht offen im
Internet – wer die Oberfläche erreicht, kann die Türen öffnen.

---

## Einrichtung (einmalig, ca. 45 Minuten)

### 1. Installieren
Auf dem Server als root (die IP ist die Tailscale-Adresse des Servers, `tailscale ip -4`):

```bash
curl -fsSLO https://raw.githubusercontent.com/<name>/smarthome/main/install.sh
bash install.sh https://github.com/<name>/smarthome.git <tailscale-ip> 8123
```

Danach im Browser `http://<tailscale-ip>:8123` öffnen und das Besitzer-Konto anlegen
(Standort, Zeitzone Europe/Berlin, Sprache Deutsch).

### 2. FRITZ!Box: Heimnetz für den Server freigeben
1. FRITZ!Box-Oberfläche → **Internet → Freigaben → VPN (WireGuard)** → „Verbindung hinzufügen“
   → **„Einzelnes Gerät verbinden“** → Name `smarthome-server` → Einstellungen herunterladen
   (`wg_config.conf`).
2. Datei auf den Server kopieren und ausführen:
   ```bash
   scp wg_config.conf root@<server>:/root/
   bash /opt/smarthome/fritzbox-vpn.sh /root/wg_config.conf
   ```
   Das Skript leitet **nur** das Heimnetz durch den Tunnel, der übrige Verkehr des Servers bleibt
   unverändert. Am Ende zeigt es die FRITZ!Box-Adresse (meist `192.168.178.1`).
3. FRITZ!Box → **System → FRITZ!Box-Benutzer → Benutzer hinzufügen**: Name `homeassistant`,
   starkes Passwort, nur das Recht **„Smart Home“**.

> Hat der Anschluss keine eigene IPv4-Adresse (DS-Lite, z. B. bei Glasfaser/Kabel), klappt
> die Verbindung über IPv6 – der Server braucht dafür IPv6 (bei Hetzner Standard).

### 3. Geräte in Home Assistant hinzufügen
**Einstellungen → Geräte & Dienste → Integration hinzufügen**:

- **AVM FRITZ!SmartHome** – Host aus Schritt 2, Benutzer `homeassistant`.
  Thermostate erscheinen als `climate.…` (Temperatur, Batterie, Fenster-offen, Ventil).
- **SwitchBot Cloud** – Token und Secret: SwitchBot-App → Profil → Einstellungen →
  10× auf „App-Version“ tippen → **Entwickleroptionen**. Schlösser erscheinen als `lock.…`.
  (Der Hub Mini muss online sein; das Tastenfeld und die Gesichtserkennung funktionieren
  unverändert weiter, Home Assistant sieht dann „Tür auf/zu“ und die Batterie.)
- **Ring** – E-Mail, Passwort, 2FA-Code. Liefert Live-Bild, Klingel- und Bewegungsereignisse.

### 4. Ring-Archiv anmelden
```bash
cd /opt/smarthome
docker compose run --rm ring-archiv anmelden     # E-Mail, Passwort, 2FA-Code
docker compose restart ring-archiv
docker compose logs -f ring-archiv               # „Gespeichert: 2026/10/10/…“
```
Beim ersten Start werden die Aufnahmen der letzten 7 Tage nachgeladen, danach alle 5 Minuten
die neuen. Ablage: `/opt/smarthome/aufnahmen/2026/10/10/14-03-22_haustuer_klingel_<id>.mp4`.
In Home Assistant unter **Medien → ring** abspielbar.

### 5. Handy-App und Benachrichtigungen
1. Tailscale-App aufs Handy (gleiches Konto wie der Server) und die **Home Assistant App**
   installieren, Server-Adresse `http://<tailscale-ip>:8123`.
2. In Home Assistant: **Entwicklerwerkzeuge → Aktionen** → nach `notify.mobile_app` suchen –
   der Name (z. B. `mobile_app_iphone_max`) ist das Ziel.
3. **Einstellungen → Geräte & Dienste → Helfer → „Benachrichtigungen an“** → Namen eintragen,
   mehrere durch Komma getrennt. Bis dahin landen Meldungen in der Seitenleiste.
4. Unter **Einstellungen → Personen** jeder Person ihr Handy als Gerät zuordnen – daraus ergibt
   sich „Jemand zu Hause“.

---

## Was schon eingebaut ist (`homeassistant/packages/sicherheit.yaml`)

| Regel | Wann |
|---|---|
| Es hat geklingelt | jedes Klingeln an der Ring-Kamera |
| Bewegung, während niemand zu Hause ist | höchstens alle 2 Minuten |
| Tür geöffnet | immer, wenn niemand zu Hause ist; sonst nur mit Schalter „Bei jeder Türöffnung benachrichtigen“ – mit Knopf **„Abschließen“** |
| Schloss länger als 10 Minuten offen | mit Knopf **„Abschließen“** |
| Batterie fast leer | täglich 18 Uhr, alle Geräte unter 20 % |
| Heizung absenken, wenn alle weg sind | nach 30 Minuten Abwesenheit „Eco“, bei Rückkehr „Komfort“ (Schalter, standardmäßig aus) |
| Ring-Archiv gestört | wenn Ring etwa eine Stunde nicht erreichbar ist (z. B. Anmeldung abgelaufen) |

Die Regeln brauchen keine festen Gerätenamen – neue Schlösser, Thermostate oder Sensoren
werden automatisch berücksichtigt. Eigene Automationen in der Oberfläche anlegen; sie landen
in `automations.yaml` und werden bei Updates nicht überschrieben.

## Raumfühler für die Thermostate
Empfehlung: **2× FRITZ!DECT 440**. In der FRITZ!Box unter **Smart Home → Geräte → Thermostat
bearbeiten → „Temperaturfühler“** den 440 im selben Raum auswählen. Die Thermostate regeln
dann nach der Raumtemperatur statt nach der Temperatur am Heizkörper. Die 440 erscheinen
automatisch auch in Home Assistant (Temperatur, Batterie, 4 frei belegbare Tasten).

## Einstellungen (`/opt/smarthome/.env`)

| Wert | Standard | Bedeutung |
|---|---|---|
| `RING_AUFBEWAHRUNG_TAGE` | 90 | ältere Aufnahmen löschen (`0` = nie) |
| `RING_INTERVALL_MINUTEN` | 5 | wie oft nach neuen Aufnahmen gesucht wird |
| `RING_RUECKBLICK_TAGE` | 7 | wie weit zurück jedes Mal geprüft wird |

Nach Änderungen: `docker compose up -d`. Platzbedarf: grob 2–5 MB pro Aufnahme – Plattenplatz
prüfen mit `du -sh /opt/smarthome/aufnahmen` und `df -h`.

## Betrieb

```bash
cd /opt/smarthome
./update.sh                          # neuer Stand + neues Home-Assistant-Image
docker compose logs -f ring-archiv   # Ring-Archiv beobachten
docker compose ps
```

**Sicherung:** Wichtig sind `homeassistant/` (Konfiguration, Konten), `ring-daten/` (Ring-Token)
und `aufnahmen/`. Home Assistant kann zusätzlich unter **Einstellungen → System → Backups**
automatisch sichern.

## Nächste Ausbaustufen (Vorschläge)
1. Vernetzte Rauchmelder und Wassermelder (Waschmaschine, Heizung) – Zigbee oder Matter.
2. Tür-/Fensterkontakte → Warnung beim Verlassen, Heizung bei offenem Fenster aus.
3. Alarmanlage in Home Assistant (scharf beim Abschließen, wenn alle weg sind) mit Sirene.
4. USV für FRITZ!Box und Hub Mini.

> Zigbee-, Matter- und Bluetooth-Geräte brauchen Funk **vor Ort** – dafür später einen kleinen
> Rechner zu Hause (z. B. Home Assistant Green) oder einen Zigbee-Netzwerk-Koordinator an der
> FRITZ!Box ergänzen. Alles Bisherige funktioniert ohne Zusatzgerät.

## Datenschutz
Die Außenkamera darf nur das eigene Grundstück erfassen (keinen Gehweg, keine Nachbarn).
Aufnahmen werden nach `RING_AUFBEWAHRUNG_TAGE` automatisch gelöscht.
