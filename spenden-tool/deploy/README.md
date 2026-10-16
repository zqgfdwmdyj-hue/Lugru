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

## Eigene Domain mit HTTPS (z. B. lugrspende.de)

1. **DNS beim Domain-Anbieter** (z. B. All-Inkl/KAS, IONOS, Strato): zwei A-Einträge anlegen

   | Name | Typ | Wert |
   |---|---|---|
   | `@` (die Domain selbst) | A | `91.99.29.165` |
   | `www` | A | `91.99.29.165` |

   Vorhandene A- oder AAAA-Einträge auf eine Parkseite des Anbieters löschen. Prüfen: `getent hosts lugrspende.de`
   muss `91.99.29.165` zeigen (dauert je nach Anbieter einige Minuten bis Stunden).

2. **Auf dem Server** (als root), zuerst den neuen Stand holen, dann die Domain einrichten:

   ```bash
   bash /opt/spenden-tool/spenden-tool/deploy/update-server.sh
   bash /opt/spenden-tool/spenden-tool/deploy/domain-einrichten.sh lugrspende.de
   ```

Das Skript
- schreibt den Caddy-Eintrag für die Domain (`deploy/server/spenden.caddy`, mit `www`, falls es auf den Server zeigt),
- setzt in der `.env` des Spenden-Tools `APP_URL=https://lugrspende.de` und `PORT=127.0.0.1:3021` (Port 3021 ist
  danach von außen zu, ufw-Regel wird entfernt),
- bindet über `COMPOSE_FILE` in `/opt/seller-system/.env` die Datei `deploy/caddy-seller.yml` ein: Der vorhandene
  Caddy liest zusätzlich die Spenden-Domain und ist mit dem Netz des Spenden-Tools verbunden. Die Dateien des
  Seller-Tools bleiben unverändert, die alte `.env` wird vorher gesichert. Caddy wird einmal neu gestartet
  (wenige Sekunden), die Seller-App läuft weiter.
- holt das HTTPS-Zertifikat (Let's Encrypt, kostenlos, verlängert sich selbst) und prüft die Adresse.

In der Hetzner-Cloud-Firewall die Freigabe für TCP 3021 danach entfernen; 80 und 443 sind ohnehin offen.

Danach auf dem iPhone `https://lugrspende.de` in Safari öffnen → Teilen → „Zum Home-Bildschirm“.

**Hinweis:** Das Spenden-Tool nicht mit `docker compose down` stoppen, solange die Domain eingerichtet ist. Dabei
verschwindet sein Netz, und Caddy (also auch das Seller-Tool) startet nach einem Neustart des Servers erst wieder,
wenn das Spenden-Tool läuft. Für Updates immer `update-server.sh` nehmen.

**Rückgängig machen:** In `/opt/seller-system/.env` die Zeile `COMPOSE_FILE=…` entfernen bzw. die Sicherung
zurückkopieren, dann `cd /opt/seller-system && docker compose -f docker-compose.yml -f deploy/docker-compose.hetzner.yml up -d caddy`.
