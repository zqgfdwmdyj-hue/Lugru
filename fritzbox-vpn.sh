#!/usr/bin/env bash
# Verbindet den Server per WireGuard dauerhaft mit dem Heimnetz der FRITZ!Box, damit
# Home Assistant die FRITZ!DECT-Thermostate erreicht. Nur das Heimnetz läuft durch den
# Tunnel – der übrige Verkehr des Servers (Seller-System usw.) bleibt unverändert.
#
# Vorher in der FRITZ!Box: Internet → Freigaben → VPN (WireGuard) → Verbindung hinzufügen →
# „Einzelnes Gerät verbinden“ → Name „smarthome-server“ → Einstellungen herunterladen.
# Aufruf als root:  bash fritzbox-vpn.sh /pfad/zu/wg_config.conf
set -euo pipefail

QUELLE="${1:?Pfad zur WireGuard-Datei aus der FRITZ!Box fehlt}"
ZIEL=/etc/wireguard/fritzbox.conf

command -v wg-quick >/dev/null || { apt-get update -qq && apt-get install -y -qq wireguard-tools; }

# Address, DNS und AllowedIPs anpassen:
#  - DNS-Zeilen entfernen (der Server soll weiter seinen eigenen DNS nutzen)
#  - AllowedIPs nur Heimnetz (FRITZ!Box trägt sonst 0.0.0.0/0 ein = ALLER Verkehr nach Hause)
mkdir -p /etc/wireguard
awk '
  /^[[:space:]]*DNS[[:space:]]*=/ { next }
  /^[[:space:]]*AllowedIPs[[:space:]]*=/ {
    sub(/^[^=]*=[[:space:]]*/, "")
    n = split($0, teile, /[[:space:]]*,[[:space:]]*/)
    behalten = ""
    for (i = 1; i <= n; i++) {
      if (teile[i] == "0.0.0.0/0" || teile[i] == "::/0" || teile[i] == "") continue
      behalten = behalten (behalten == "" ? "" : ", ") teile[i]
    }
    if (behalten == "") { print "FEHLER: keine Heimnetz-Adressen in AllowedIPs" > "/dev/stderr"; exit 1 }
    print "AllowedIPs = " behalten
    next
  }
  { print }
' "$QUELLE" > "$ZIEL.neu"
chmod 600 "$ZIEL.neu"
mv "$ZIEL.neu" "$ZIEL"

NETZ="$(grep -m1 '^AllowedIPs' "$ZIEL" | cut -d= -f2 | cut -d, -f1 | tr -d ' ')"
if ip route show | grep -v ' dev fritzbox' | grep -q "^${NETZ%%/*}"; then
  echo "Achtung: Das Netz $NETZ ist auf dem Server schon geroutet – Konflikt möglich."
fi

systemctl enable --now wg-quick@fritzbox
systemctl restart wg-quick@fritzbox
sleep 3

FRITZ_IP="$(echo "${NETZ%%/*}" | awk -F. '{print $1"."$2"."$3".1"}')"
if ping -c 2 -W 3 "$FRITZ_IP" >/dev/null 2>&1; then
  echo "Verbunden. FRITZ!Box erreichbar unter $FRITZ_IP – diese Adresse in Home Assistant"
  echo "bei „AVM FRITZ!SmartHome“ als Host eintragen."
else
  echo "Tunnel gestartet, aber $FRITZ_IP antwortet nicht. Prüfen mit: wg show fritzbox"
  exit 1
fi
