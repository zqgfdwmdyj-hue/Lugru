"""Video-Worker (B36) – läuft auf dem Arbeits-PC und holt sich die Aufträge selbst beim Seller-System ab.

Start:  python worker.py          (Einstellungen über Umgebungsvariablen, siehe README.md)
Keine offenen Ports, keine Weiterleitung am Router: der Worker fragt alle ~30 s mit seinem Token nach.
"""

from __future__ import annotations

import signal
import sys
import threading
import time
from datetime import datetime

from udd import VERSION, clipbib
from udd.konfig import laden
from udd.projekt import aufraeumen, frei_gb
from udd.schritte import ausfuehren, system_info
from udd.seller import Seller, SellerFehler


def log(text: str) -> None:
    print(f"{datetime.now():%Y-%m-%d %H:%M:%S}  {text}", flush=True)


class Zustand:
    def __init__(self) -> None:
        self.laeuft: str | None = None
        self.aufgeraeumt: list[str] = []
        self.ende = threading.Event()


ORDNER_PRUEFEN_S = 300  # Clip-Ordner alle 5 Min. ansehen (oder sofort auf „Jetzt prüfen“ im Seller-System)


def lebenszeichen(k, seller: Seller, z: Zustand, info: dict) -> None:
    """Meldet sich regelmäßig (auch während eines langen Renders) und räumt freigegebene Projekte auf. Dazu der
    Selbsttest des Clip-Ordners: sieht der Worker die Videos/Fotos vom PC (Docker -v … eingehängt)?"""
    takt = max(1.0, min(30.0, k.poll_s))
    ordner: dict | None = None
    ordner_um = 0.0
    sofort = False
    while not z.ende.is_set():
        try:
            if sofort or ordner is None or time.time() - ordner_um > ORDNER_PRUEFEN_S:
                try:
                    ordner = clipbib.ordner_stand(k.clipordner)
                except Exception as e:  # Selbsttest darf nie das Lebenszeichen stören
                    ordner = {"zustand": "fehlt", "pfad": str(k.clipordner or ""), "quelle": None, "videos": 0, "fotos": 0, "andere": 0, "heic": 0, "beispiele": [f"Fehler: {e}"[:120]], "geprueft": int(time.time())}
                ordner_um = time.time()
                if sofort:
                    log(f"Clip-Ordner geprüft: {ordner['zustand']} – {ordner['videos']} Videos, {ordner['fotos']} Fotos")
            frei = frei_gb(k.arbeitsordner)
            a = seller.melden({**info, "freiGb": frei, "laeuft": z.laeuft, "aufgeraeumt": z.aufgeraeumt, "clipOrdner": ordner})
            sofort = bool(a.get("clipOrdnerPruefen"))
            z.aufgeraeumt = []
            weg = aufraeumen(k.arbeitsordner, a.get("aufraeumen") or [], k.aufbewahren_tage, z.laeuft)
            if weg:
                z.aufgeraeumt = weg
                log(f"Aufgeräumt: {len(weg)} Projekt(e)")
            if frei < k.warn_frei_gb:
                log(f"Achtung: nur {frei} GB frei (empfohlen mind. {k.warn_frei_gb:g} GB, unter {k.min_frei_gb:g} GB startet kein Lauf)")
        except SellerFehler as e:
            log(f"Lebenszeichen: {e}")
        except Exception as e:  # nie den Worker wegen des Lebenszeichens beenden
            log(f"Lebenszeichen-Fehler: {e}")
        z.ende.wait(takt)


def main() -> None:
    k = laden()
    seller = Seller(k.seller_url, k.token)
    info = system_info(k)
    if info["ffmpeg"] == "fehlt":
        sys.exit("ffmpeg nicht gefunden – bitte installieren (siehe README) oder FFMPEG=Pfad setzen.")
    log(f"Video-Worker {VERSION} · {info['os']} · Python {info['python']} · {info['ffmpeg']}")
    log(f"Seller-System: {k.seller_url} · Arbeitsordner: {k.arbeitsordner}")
    stand = clipbib.ordner_stand(k.clipordner)
    log(f"Clip-Ordner {k.clipordner}: " + {"ok": f"{stand['videos']} Videos, {stand['fotos']} Fotos", "leer": "leer – keine Videos/Fotos gefunden", "fehlt": "nicht vorhanden", "anonym": "NICHT mit dem PC verbunden (docker run ohne -v C:\\video\\clips:/clips)", "aus": "aus"}.get(stand["zustand"], stand["zustand"]))
    z = Zustand()

    def stopp(*_):
        log("Beenden …")
        z.ende.set()
        sys.exit(0)

    signal.signal(signal.SIGTERM, stopp)
    signal.signal(signal.SIGINT, stopp)
    threading.Thread(target=lebenszeichen, args=(k, seller, z, info), daemon=True).start()

    letzter_grund = ""
    while not z.ende.is_set():
        try:
            frei = frei_gb(k.arbeitsordner)
            if frei < k.min_frei_gb:
                grund = f"Zu wenig freier Speicher ({frei} GB < {k.min_frei_gb:g} GB) – kein Lauf"
            else:
                r = seller.auftrag()
                a = r.get("auftrag")
                grund = r.get("grund") or ""
                if a:
                    z.laeuft = a["id"]
                    try:
                        ausfuehren(k, seller, a, log)
                    finally:
                        z.laeuft = None
                    continue
            if grund and grund != letzter_grund:
                log(grund)
            letzter_grund = grund
        except SellerFehler as e:
            log(f"Seller-System: {e}")
            if e.status == 401:
                z.ende.wait(300)
        except Exception as e:
            log(f"Unerwarteter Fehler: {e}")
        z.ende.wait(k.poll_s)


if __name__ == "__main__":
    main()
