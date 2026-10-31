#!/usr/bin/env bash
# update-github.sh — holt die neueste Lugru-Deals-Version von GitHub.
#
# Ein Befehl auf dem Server, im Ordner mit dem Programm:
#   curl -fsSL https://raw.githubusercontent.com/zqgfdwmdyj-hue/Lugru/main/lugru-deals/scripts/linux/update-github.sh | bash
# oder, wenn das Skript schon daliegt:  ./update-github.sh [Programmdatei]
#
# Lädt das passende Programm (amd64 oder arm64), prüft die Prüfsumme und
# ersetzt die Datei; die alte bleibt als *.previous liegen. Die Datenbank
# wird nicht angefasst. Danach das Programm neu starten.
set -euo pipefail

REPO="${LUGRU_REPO:-zqgfdwmdyj-hue/Lugru}"
case "$(uname -m)" in
  x86_64|amd64)  ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "Unbekannte Architektur: $(uname -m)" >&2; exit 1 ;;
esac
ZIEL="${1:-./lugru-deals-$ARCH}"
ASSET="lugru-deals-linux-$ARCH"

# Neuestes Release mit dem Tag-Präfix von Lugru Deals — im Repo liegen auch
# andere Projekte. GitHub liefert die neuesten zuerst.
TAG="$(curl -fsSL -H 'User-Agent: lugru-deals-update' "https://api.github.com/repos/$REPO/releases?per_page=50" |
  grep -o '"tag_name": *"lugru-deals-v[^"]*"' | head -n1 | sed 's/.*"\(lugru-deals-v[^"]*\)"/\1/')"
if [ -z "$TAG" ]; then echo "Auf GitHub gibt es noch kein Lugru-Deals-Release." >&2; exit 1; fi
VERSION="${TAG#lugru-deals-v}"
echo "Neueste Version: $VERSION ($ARCH)"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
BASIS="https://github.com/$REPO/releases/download/$TAG"
curl -fsSL -o "$TMP/$ASSET" "$BASIS/$ASSET"
curl -fsSL -o "$TMP/SHA256SUMS" "$BASIS/SHA256SUMS"
(cd "$TMP" && grep " $ASSET\$" SHA256SUMS | sha256sum -c --quiet -) || { echo "Prüfsumme stimmt nicht — nichts ersetzt." >&2; exit 1; }
chmod +x "$TMP/$ASSET"

if [ -f "$ZIEL" ]; then
  if cmp -s "$ZIEL" "$TMP/$ASSET"; then echo "Schon auf dem neuesten Stand: $ZIEL"; exit 0; fi
  cp -p "$ZIEL" "$ZIEL.previous"
fi
# Erst daneben ablegen, dann umbenennen: eine laufende Datei wird so nicht
# mitten im Schreiben ersetzt ("Text file busy").
cp "$TMP/$ASSET" "$ZIEL.neu" && mv -f "$ZIEL.neu" "$ZIEL"
echo "Ersetzt: $ZIEL  (vorherige Version: $ZIEL.previous)"
echo "Jetzt neu starten, z. B.:  pkill -f '$(basename "$ZIEL")'  und das Programm wie gewohnt wieder starten."
echo "Unten auf jeder Seite sollte dann „$VERSION“ stehen."
