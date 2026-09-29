# Spenden-Tool auf dem Hetzner-Server (Test auf Port 3021)

Das Spenden-Tool läuft auf demselben Server wie das Seller-Tool, ist aber vollständig getrennt:

| | Seller-Tool | Spenden-Tool |
|---|---|---|
| Ordner | `/opt/seller-system` | `/opt/spenden-tool` (Code), App in `/opt/spenden-tool/spenden-tool` |
| Docker-Projekt | `seller-system` | `spenden-tool` (eigene Container, eigenes Netz) |
| Datenbank | Volume `seller-system_dbdata` | Volume `spenden-tool_spendendata` |
| Erreichbar | Caddy auf 80/443 | direkt auf Port **3021** (HTTP) |

## Einrichten (einmalig, als root auf dem Server)

Solange der Pull Request noch nicht in `main` ist, den Branch `spenden-verteilung` angeben:

```bash
# Skript über den vorhandenen Seller-Tool-Checkout holen (funktioniert auch bei privatem Repo)
git -C /opt/seller-system fetch origin spenden-verteilung
git -C /opt/seller-system show origin/spenden-verteilung:spenden-tool/deploy/install-server.sh > /tmp/install-spenden.sh
bash /tmp/install-spenden.sh 3021 spenden-verteilung
```

Das ändert nichts am Seller-Tool selbst: `fetch` lädt nur den Branch herunter, der laufende Stand bleibt unverändert.

Parameter: `[port] [branch] [repo-url]`. Standardmäßig wird die Repo-Adresse aus `/opt/seller-system` übernommen,
also mit denselben Git-Zugangsdaten. Nach dem Merge reicht `bash install-server.sh 3021`.

Am Ende gibt das Skript die Adresse aus (`http://91.99.29.165:3021`) und das erzeugte **Team-Passwort**. Es steht auch in
`/opt/spenden-tool/spenden-tool/.env`.

**Wichtig:** Falls in der Hetzner-Cloud-Konsole eine Firewall aktiv ist, dort eingehend **TCP 3021** freigeben
(`ufw` auf dem Server erledigt das Skript selbst).

## KI-Preisrecherche einschalten

In `/opt/spenden-tool/spenden-tool/.env` den Schlüssel eintragen (`ANTHROPIC_API_KEY=sk-ant-…`), dann:

```bash
cd /opt/spenden-tool/spenden-tool && docker compose up -d
```

## Update

```bash
bash /opt/spenden-tool/spenden-tool/deploy/update-server.sh
```

Das Skript sichert vorher die Datenbank (die letzten 5 Sicherungen bleiben erhalten), holt den neuen Stand und baut neu.
Nie `docker compose down -v` ausführen, denn `-v` löscht die Datenbank mit allen Fotos.

## Sicherungen

Der Container `backup` legt täglich `backups/spenden-JJJJ-MM-TT.dump` an und behält 14 Tage.
Zurückspielen:

```bash
cd /opt/spenden-tool/spenden-tool
docker compose exec -T db pg_restore -U spenden -d spenden --clean < backups/spenden-2026-10-01.dump
```

## Später: eigene Subdomain mit HTTPS

Die Test-Adresse läuft über unverschlüsseltes HTTP, das Passwort wird also im Klartext übertragen. Für den
Dauerbetrieb die Subdomain per DNS auf den Server zeigen lassen und im vorhandenen Caddy (Seller-Tool) einen
zweiten Block ergänzen, der auf `host.docker.internal:3021` oder die Server-IP weiterleitet. Anschließend in der
`.env` `APP_URL=https://spenden.…` setzen und Port 3021 in der Firewall wieder schließen.
