#!/bin/sh
# lugru-deals läuft als unprivilegierter Benutzer ("lugru"). Der Ordner
# /daten wird aber, wenn er auf dem Host noch nicht existiert, von Docker
# selbst als root:root angelegt ("docker run -v $PWD/daten:/daten ..." bei
# einem frischen Host-Verzeichnis) — der Container-Prozess könnte darin dann
# weder die Datenbank noch den Chart-Ordner anlegen (siehe README, Abschnitt
# Docker).
#
# Dieses Skript läuft deshalb selbst als root (siehe Dockerfile: kein USER
# vor dem ENTRYPOINT), übernimmt den Besitz von /daten und wechselt danach
# mit su-exec zu "lugru", bevor die eigentliche Anwendung startet. Der
# Anwendungsprozess selbst bleibt damit unprivilegiert.
set -eu

DATENVERZEICHNIS=/daten

if ! chown -R lugru:lugru "$DATENVERZEICHNIS" 2>/dev/null; then
    echo "Hinweis: Besitz von $DATENVERZEICHNIS konnte nicht auf den Benutzer 'lugru' geändert werden (zum Beispiel weil das Volume schreibgeschützt eingehängt ist). Starte trotzdem — falls 'lugru' dort nicht schreiben darf, meldet die Anwendung gleich einen Datenbankfehler." >&2
fi

exec su-exec lugru "$@"
