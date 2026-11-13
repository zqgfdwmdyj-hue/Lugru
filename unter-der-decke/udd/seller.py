"""Verbindung zum Seller-System: Lebenszeichen, Auftrag abholen, Schritte melden, Dateien hoch-/herunterladen.

Der Worker öffnet keine Ports – er fragt nur selbst an (Token im Kopf „Authorization: Bearer vw_…“).
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Callable

import requests

from . import VERSION, netz


class SellerFehler(Exception):
    def __init__(self, text: str, status: int | None = None):
        super().__init__(text)
        self.status = status


class Seller:
    def __init__(self, url: str, token: str):
        self.url = url.rstrip("/")
        self.token = token
        self.s = requests.Session()
        self.s.headers.update({"Authorization": f"Bearer {token}", "User-Agent": f"unter-der-decke/{VERSION}"})
        self.log: Callable[[str], None] = print

    # -- intern ---------------------------------------------------------------------------------------------------
    def _antwort(self, r: requests.Response) -> Any:
        try:
            daten = r.json()
        except ValueError:
            daten = {"fehler": r.text[:300]}
        if r.status_code == 401:
            raise SellerFehler("Worker-Token ungültig oder deaktiviert – bitte im Seller-System neu anlegen.", 401)
        if r.status_code >= 400:
            raise SellerFehler(str(daten.get("fehler") or daten.get("error") or f"HTTP {r.status_code}"), r.status_code)
        return daten

    def _anfrage(self, methode: str, pfad: str, versuche: int = 4, **kw: Any) -> Any:
        letzter: Exception | None = None
        for i in range(versuche):
            try:
                r = self.s.request(methode, f"{self.url}{pfad}", timeout=kw.pop("timeout", 60), **kw)
                if r.status_code in (502, 503, 504):
                    raise requests.ConnectionError(f"HTTP {r.status_code}")
                return self._antwort(r)
            except (requests.ConnectionError, requests.Timeout) as e:
                letzter = e
                time.sleep(min(30, 2 ** (i + 1)))
        raise SellerFehler(f"Seller-System nicht erreichbar: {letzter}")

    # -- Schnittstelle --------------------------------------------------------------------------------------------
    def melden(self, info: dict[str, Any]) -> dict[str, Any]:
        return self._anfrage("POST", "/api/video-worker/melden", json={"version": VERSION, **info}, versuche=1)

    def auftrag(self) -> dict[str, Any]:
        return self._anfrage("GET", "/api/video-worker/auftrag", versuche=1)

    def schritt(self, auftrag_id: str, schritt: str, status: str, *, fortschritt: dict | None = None, fehler: str | None = None, daten: dict | None = None, hinweise: list[str] | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"schritt": schritt, "status": status}
        if fortschritt is not None:
            body["fortschritt"] = fortschritt
        if fehler is not None:
            body["fehler"] = fehler[:1000]
        if daten is not None:
            body["daten"] = daten
        if hinweise:
            body["hinweise"] = hinweise[:20]
        return self._anfrage("POST", f"/api/video-worker/auftrag/{auftrag_id}/schritt", json=body)

    def datei_hochladen(self, auftrag_id: str, art: str, pfad: Path) -> dict[str, Any]:
        groesse = pfad.stat().st_size
        letzter: Exception | None = None
        for i in range(3):
            try:
                with pfad.open("rb") as f:
                    r = self.s.put(f"{self.url}/api/video-worker/auftrag/{auftrag_id}/datei/{art}", data=f, headers={"Content-Length": str(groesse), "Content-Type": "application/octet-stream"}, timeout=1800)
                return self._antwort(r)
            except (requests.ConnectionError, requests.Timeout) as e:
                letzter = e
                time.sleep(5 * (i + 1))
        raise SellerFehler(f"Upload {art} fehlgeschlagen: {letzter}")

    def datei_holen(self, auftrag_id: str, art: str, ziel: Path) -> bool:
        r = self.s.get(f"{self.url}/api/video-worker/auftrag/{auftrag_id}/datei/{art}", stream=True, timeout=1800)
        if r.status_code == 404:
            return False
        if r.status_code >= 400:
            self._antwort(r)
        teil = ziel.with_suffix(ziel.suffix + ".teil")
        with teil.open("wb") as f:
            for block in r.iter_content(1024 * 1024):
                f.write(block)
        teil.replace(ziel)
        return True

    def youtube_zugang(self, auftrag_id: str) -> dict[str, Any]:
        return self._anfrage("GET", f"/api/video-worker/auftrag/{auftrag_id}/youtube")

    def youtube_bestaetigen(self, auftrag_id: str, video_id: str) -> dict[str, Any]:
        return self._anfrage("POST", f"/api/video-worker/auftrag/{auftrag_id}/youtube", json={"videoId": video_id})

    def drive_zugang(self, auftrag_id: str) -> dict[str, Any]:
        return self._anfrage("GET", f"/api/video-worker/auftrag/{auftrag_id}/drive")

    def drive_melden(self, auftrag_id: str, art: str, file_id: str, groesse: int, link: str | None) -> dict[str, Any]:
        return self._anfrage("POST", f"/api/video-worker/auftrag/{auftrag_id}/datei/{art}", json={"drive": {"fileId": file_id, "groesse": groesse, "link": link}})

    def referenz_holen(self, kanal_id: str, nr: int) -> bytes:
        """Stil-Referenzbild eines Kanals (Whiteboard, B36.9)."""
        r = self.s.get(f"{self.url}/api/video-worker/referenz/{kanal_id}/{nr}", timeout=60)
        if r.status_code != 200:
            raise SellerFehler(f"Referenzbild {nr}: HTTP {r.status_code}", r.status_code)
        return r.content

    def foto_holen(self, foto_id: str) -> bytes:
        """Eigenes Foto aus der Foto-Bibliothek eines Instagram-Kanals (B37, Inhaltsart „Einblick“)."""
        r = self.s.get(f"{self.url}/api/video-worker/foto/{foto_id}", timeout=60)
        if r.status_code != 200:
            raise SellerFehler(f"Foto {foto_id[:8]}: HTTP {r.status_code}", r.status_code)
        return r.content

    def anbieter_datei(self, auftrag_id: str, anbieter: str, pfad: str, felder: dict[str, str], dateien: list[tuple[str, str, bytes, str]], timeout: float = 180, was: str | None = None) -> requests.Response:
        """Anbieter-Brücke mit Dateien (multipart, z. B. Bild mit Referenzbildern) – rohe Antwort.
        Gestreamt mit Zeitlimit; Abbruch, Zeitüberschreitung, 429 und 5xx bis zu 4 Mal wiederholt (2, 4, 8, 16 s)."""

        def einmal() -> requests.Response:
            r = self.s.post(f"{self.url}/api/video-worker/anbieter/{anbieter}/{pfad}", data=felder, files=[(feld, (name, daten, typ)) for feld, name, daten, typ in dateien], headers={"x-auftrag": auftrag_id}, timeout=(20, timeout), stream=True)
            return netz.lesen(netz.status_pruefen(r), timeout)

        return netz.mit_wiederholung(einmal, was or f"{anbieter} {pfad}", log=self.log)

    def anbieter(self, auftrag_id: str, anbieter: str, pfad: str, body: dict[str, Any], timeout: float = netz.TIMEOUT_S, was: str | None = None) -> requests.Response:
        """Anbieter-Brücke (ElevenLabs, OpenAI) – liefert die rohe Antwort (Status 2xx/4xx prüft der Aufrufer).
        Gestreamt mit Zeitlimit; Abbruch, Zeitüberschreitung, 429 und 5xx bis zu 4 Mal wiederholt (2, 4, 8, 16 s)."""

        def einmal() -> requests.Response:
            r = self.s.post(f"{self.url}/api/video-worker/anbieter/{anbieter}/{pfad}", json=body, headers={"x-auftrag": auftrag_id}, timeout=(20, timeout), stream=True)
            return netz.lesen(netz.status_pruefen(r), timeout)

        return netz.mit_wiederholung(einmal, was or f"{anbieter} {pfad}", log=self.log)
