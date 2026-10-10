# Smart-Home-Zentrale

**Home Assistant Green** bei dir zu Hause als Zentrale für alle Geräte, dazu das Add-on
**Ring-Archiv**, das jede Aufnahme der Ring-Kamera automatisch und dauerhaft auf dem
**UGREEN-NAS (DH2300)** speichert. Komplett getrennt vom Seller-System, kein Server nötig.

```
                     ┌────────────── Heimnetz (FRITZ!Box) ──────────────┐
Handy ── Tailscale ──►  Home Assistant Green ── FRITZ!DECT-Thermostate  │
(HA-App, Push)       │      │  └ Add-on Ring-Archiv ──SMB──► UGREEN DH2300│
                     │      │                                (Videos,    │
                     │      │                                 Backups)   │
                     └──────┼────────────────────────────────────────────┘
                            └── Internet ──► SwitchBot-Cloud (Hub Mini), Ring-Cloud
```

| Gerät | Anbindung |
|---|---|
| 2× SwitchBot Schloss (Gesichtserkennung / Tastenfeld) | Integration „SwitchBot Cloud“ über den Hub Mini (Matter) |
| 2× FRITZ!DECT Heizkörperthermostat | Integration „AVM FRITZ!SmartHome“ – direkt im Heimnetz |
| 2× FRITZ!DECT 440 als Raumfühler (neu) | in der FRITZ!Box dem Thermostat zuweisen, erscheinen automatisch |
| Ring Außenkamera | Integration „Ring“ (Live, Klingel, Bewegung) + Add-on **Ring-Archiv** |
| Anwesenheit | Integration „AVM FRITZ!Box Tools“ (Handy im WLAN = zu Hause) + HA-App |
| Später: Rauch-, Wasser-, Fenstersensoren | Zigbee/Thread über **Connect ZBT-2** am Green |

## Einkaufsliste

| Teil | ca. Preis | Wofür |
|---|---|---|
| Home Assistant Green | 179 € | die Zentrale |
| Home Assistant Connect ZBT-2 | 55 € | Funk für Zigbee/Thread-Sensoren (gleich mitkaufen) |
| 2× FRITZ!DECT 440 | je 50 € | Raumtemperatur für die Thermostate |
| Ring Protect (vorhanden) | – | Voraussetzung für das Ring-Archiv |

---

## Einrichtung (einmalig, ca. 1 Stunde)

### 1. Green anschließen
Netzwerkkabel an die FRITZ!Box, Strom an. Nach ca. 5 Minuten im Browser
`http://homeassistant.local:8123` öffnen (oder die IP aus der FRITZ!Box-Geräteliste) und
das Besitzer-Konto anlegen (Standort, Sprache Deutsch). In der FRITZ!Box dem Green unter
**Heimnetz → Netzwerk → Gerät bearbeiten** eine **feste IP** geben – dem NAS ebenso.
Den ZBT-2 per USB-Verlängerung (nicht direkt am Green) anstecken; er wird automatisch erkannt.

### 2. Geräte hinzufügen
**Einstellungen → Geräte & Dienste → Integration hinzufügen**:

- **AVM FRITZ!SmartHome** – Host `192.168.178.1`. Vorher in der FRITZ!Box unter
  **System → FRITZ!Box-Benutzer** einen Benutzer `homeassistant` mit den Rechten
  **„Smart Home“** anlegen.
- **AVM FRITZ!Box Tools** – gleicher Host; für den Benutzer zusätzlich das Recht
  **„FRITZ!Box Einstellungen“**. Liefert, welche Handys im WLAN sind (Anwesenheit).
- **SwitchBot Cloud** – Token und Secret: SwitchBot-App → Profil → Einstellungen →
  10× auf „App-Version“ tippen → **Entwickleroptionen**. Schlösser erscheinen als `lock.…`.
- **Ring** – E-Mail, Passwort, Bestätigungscode.

### 3. Regeln einspielen
1. **Einstellungen → Add-ons → Add-on-Store** → **File editor** installieren und starten.
2. Im File editor die Datei `configuration.yaml` öffnen und unter `default_config:` ergänzen
   (vorhandene Zeilen stehen lassen):
   ```yaml
   homeassistant:
     packages: !include_dir_named packages
   ```
3. Ordner `packages` anlegen, darin die Datei `sicherheit.yaml` mit dem Inhalt von
   [`homeassistant/packages/sicherheit.yaml`](homeassistant/packages/sicherheit.yaml).
4. **Entwicklerwerkzeuge → YAML → Konfiguration prüfen**, dann **Neu starten**.

### 4. NAS einbinden (UGREEN DH2300)
Auf dem NAS (UGOS):
1. Freigabe **„Ring-Aufnahmen“** anlegen (und gern eine zweite, **„HA-Backups“**).
2. Benutzer **`homeassistant`** anlegen, Schreibrecht nur auf diese Freigaben.
3. **SMB** einschalten (Systemsteuerung → Dateidienste).

In Home Assistant: **Einstellungen → System → Speicher → Netzwerkspeicher hinzufügen**:

| Feld | Ring-Aufnahmen | HA-Backups |
|---|---|---|
| Name | `Ring-Aufnahmen` | `HA-Backups` |
| Verwendung | **Medien** | **Backup** |
| Server | IP des NAS | IP des NAS |
| Protokoll | Samba/Windows (CIFS) | Samba/Windows (CIFS) |
| Freigabe | `Ring-Aufnahmen` | `HA-Backups` |
| Benutzer / Passwort | `homeassistant` / … | `homeassistant` / … |

Danach unter **Einstellungen → System → Backups** automatische Sicherungen auf `HA-Backups`
einschalten.

### 5. Add-on Ring-Archiv installieren
1. **Add-on-Store** → **Samba share** installieren, Passwort setzen, starten.
2. Auf dem PC im Explorer `\\homeassistant\addons` öffnen (Mac: Finder → Gehe zu →
   `smb://homeassistant/addons`).
3. Diesen Branch als ZIP von GitHub laden (**Code → Download ZIP**), entpacken und den Ordner
   `addons/ring-archiv` dorthin kopieren → `\\homeassistant\addons\ring-archiv`.
4. **Add-on-Store** → oben rechts ⋮ → **Nach Updates suchen** → unter **„Lokale Add-ons“**
   erscheint **Ring-Archiv** → **Installieren** (dauert einige Minuten).
5. Reiter **Konfiguration**: Ring E-Mail und Passwort eintragen → **Speichern** → Reiter
   **Info** → **Starten**. Ring schickt einen Bestätigungscode.
6. Code im Feld **Bestätigungscode** eintragen → **Speichern** → **Neu starten**.
   E-Mail, Passwort und Code werden danach automatisch aus den Einstellungen gelöscht.
7. Reiter **Protokoll**: „Gespeichert: 2026/10/10/14-03-22_haustuer_klingel_….mp4“.
   Beim ersten Mal werden die letzten 7 Tage nachgeladen, danach alle 5 Minuten die neuen.

Die Videos liegen auf dem NAS in `Ring-Aufnahmen/JJJJ/MM/TT/` und sind in Home Assistant
unter **Medien → Ring-Aufnahmen** abspielbar. Ist das NAS einmal nicht erreichbar, speichert
das Add-on **nichts** auf dem kleinen internen Speicher des Green, holt die Aufnahmen später
nach (7 Tage Rückblick) und meldet sich nach einer Stunde per Push.

### 6. Handy-App, Benachrichtigungen, Zugriff von unterwegs
1. **Home Assistant App** installieren und verbinden (zu Hause im WLAN).
2. **Entwicklerwerkzeuge → Aktionen** → nach `notify.mobile_app` suchen – der Name
   (z. B. `mobile_app_iphone_max`) ist das Ziel.
3. **Einstellungen → Geräte & Dienste → Helfer → „Benachrichtigungen an“** → Namen eintragen,
   mehrere durch Komma getrennt. Bis dahin landen Meldungen in der Seitenleiste.
4. **Einstellungen → Personen**: jeder Person ihr Handy aus der App **und** aus
   „FRITZ!Box Tools“ zuordnen – daraus ergibt sich „Jemand zu Hause“.
5. **Von unterwegs:** Add-on **Tailscale** installieren und anmelden, Tailscale-App aufs Handy,
   in der HA-App als externe Adresse `http://<tailscale-ip-des-green>:8123` eintragen.
   (Bequemer, aber kostenpflichtig: *Home Assistant Cloud* für ca. 7,50 €/Monat.)
   Push-Nachrichten kommen in jedem Fall auch ohne Tailscale an.

### 7. Raumfühler
Die **FRITZ!DECT 440** an der FRITZ!Box anmelden (DECT-Taste), dann unter
**Smart Home → Geräte → Thermostat bearbeiten → Temperatursensor** den 440 im selben Raum
wählen. Die Thermostate regeln dann nach der Raumtemperatur statt nach der Temperatur am
Heizkörper.

---

## Eingebaute Regeln (`homeassistant/packages/sicherheit.yaml`)

| Regel | Wann |
|---|---|
| Es hat geklingelt | jedes Klingeln an der Ring-Kamera |
| Bewegung, während niemand zu Hause ist | höchstens alle 2 Minuten |
| Tür geöffnet | immer, wenn niemand zu Hause ist; sonst nur mit Schalter „Bei jeder Türöffnung benachrichtigen“ – mit Knopf **„Abschließen“** |
| Schloss länger als 10 Minuten offen | mit Knopf **„Abschließen“** |
| Batterie fast leer | täglich 18 Uhr, alle Geräte unter 20 % |
| Heizung absenken, wenn alle weg sind | nach 30 Minuten Abwesenheit „Eco“, bei Rückkehr „Komfort“ (Schalter, standardmäßig aus) |
| Ring-Archiv gestört | wenn etwa eine Stunde lang nichts gespeichert werden konnte |

Die Regeln brauchen keine festen Gerätenamen – neue Schlösser, Thermostate oder Sensoren
werden automatisch berücksichtigt. Eigene Automationen einfach in der Oberfläche anlegen.

## Einstellungen des Add-ons (Reiter „Konfiguration“)

| Feld | Standard | Bedeutung |
|---|---|---|
| Ordner unter /media | `Ring-Aufnahmen` | Name des Netzwerkspeichers aus Schritt 4 |
| Nur auf dem NAS speichern | an | schützt den internen Speicher des Green |
| Aufbewahrung (Tage) | 365 | ältere Aufnahmen löschen (`0` = nie) |
| Abruf alle … Minuten | 5 | |
| Rückblick (Tage) | 7 | wie weit zurück nach fehlenden Aufnahmen gesucht wird |

**Update des Add-ons:** neuen Ordner `addons/ring-archiv` über die Samba-Freigabe
überschreiben, im Add-on-Store „Nach Updates suchen“ → Ring-Archiv → **Neu erstellen**.

## Nächste Ausbaustufen
1. Vernetzte **Rauchmelder** und **Wassermelder** (Waschmaschine, Heizung) – Zigbee über den ZBT-2.
2. **Tür-/Fensterkontakte** → Warnung beim Verlassen, Heizung bei offenem Fenster aus.
3. **Alarmanlage** in Home Assistant (scharf beim Abschließen, wenn alle weg sind) mit Sirene.
4. **USV** für FRITZ!Box, Green und Hub Mini.

## Datenschutz
Die Außenkamera darf nur das eigene Grundstück erfassen (keinen Gehweg, keine Nachbarn).
Aufnahmen werden nach der eingestellten Aufbewahrung automatisch gelöscht.

## Entwicklung
```bash
cd addons/ring-archiv && npm install && npm test
```
