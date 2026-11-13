"""Arbeitsordner je Auftrag mit state.json: was schon erledigt und bezahlt ist, wird nie doppelt erzeugt.

Ordner: <ARBEITSORDNER>/<kanal>/<auftrag-id>/  (voice/, bilder/, clips/, video.mp4, thumbnail.png …)
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import time
from pathlib import Path
from typing import Any


def schreiben_atomar(ziel: Path, daten: bytes) -> None:
    """Erst in eine Teildatei schreiben, dann umbenennen – ein Abbruch hinterlässt nie eine halbe Datei."""
    ziel.parent.mkdir(parents=True, exist_ok=True)
    teil = ziel.with_name(ziel.name + ".teil")
    with teil.open("wb") as f:
        f.write(daten)
        f.flush()
        os.fsync(f.fileno())
    teil.replace(ziel)


def kurz_hash(*teile: str) -> str:
    return hashlib.sha256("␟".join(teile).encode("utf-8")).hexdigest()[:12]


class Projekt:
    def __init__(self, basis: Path, kanal_slug: str, auftrag_id: str):
        self.ordner = basis / kanal_slug / auftrag_id
        self.ordner.mkdir(parents=True, exist_ok=True)
        self.state_pfad = self.ordner / "state.json"
        self.state: dict[str, Any] = {"auftrag": auftrag_id, "angelegt": time.time(), "schritte": {}, "voice": {}, "bilder": {}, "clips": {}, "stock": {}, "bildplan": {}, "pexels": {}, "clipsuche": {}}
        if self.state_pfad.exists():
            try:
                self.state.update(json.loads(self.state_pfad.read_text(encoding="utf-8")))
            except (ValueError, OSError):
                pass  # kaputte state.json: neu beginnen, vorhandene Dateien werden über den Hash wiedergefunden

    def speichern(self) -> None:
        schreiben_atomar(self.state_pfad, json.dumps(self.state, ensure_ascii=False, indent=1).encode("utf-8"))

    def pfad(self, *teile: str) -> Path:
        p = self.ordner.joinpath(*teile)
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    # Schritte
    def erledigt(self, schritt: str) -> bool:
        return bool(self.state["schritte"].get(schritt, {}).get("fertig"))

    def markieren(self, schritt: str, **extra: Any) -> None:
        self.state["schritte"][schritt] = {"fertig": True, "am": time.time(), **extra}
        self.speichern()

    def zuruecksetzen(self, schritt: str) -> None:
        self.state["schritte"].pop(schritt, None)
        self.speichern()

    # bezahlte Dateien je Szene (Schlüssel = Hash aus Inhalt → geänderte Szenen werden neu erzeugt, gleiche nicht)
    def datei_vorhanden(self, art: str, schluessel: str) -> Path | None:
        eintrag = self.state[art].get(schluessel)
        if eintrag and (self.ordner / eintrag["datei"]).exists():
            return self.ordner / eintrag["datei"]
        return None

    def datei_merken(self, art: str, schluessel: str, rel: str, **extra: Any) -> None:
        self.state[art][schluessel] = {"datei": rel, **extra}
        self.speichern()

    def zwischendateien_loeschen(self) -> None:
        """Nach dem Render: Clips und Einzelbilder weg (Sprache/Bilder bleiben bis zur Bestätigung)."""
        for name in ("clips", "frames"):
            shutil.rmtree(self.ordner / name, ignore_errors=True)
        self.state["clips"] = {}
        self.speichern()


def frei_gb(ordner: Path) -> float:
    ordner.mkdir(parents=True, exist_ok=True)
    return round(shutil.disk_usage(ordner).free / 1024**3, 1)


def aufraeumen(basis: Path, ids: list[str], aufbewahren_tage: int, laeuft: str | None) -> list[str]:
    """Freigegebene Aufträge löschen und alles, was älter als die Aufbewahrung ist. Liefert die gelöschten IDs."""
    weg: list[str] = []
    if not basis.exists():
        return weg
    grenze = time.time() - aufbewahren_tage * 86400
    for kanal in basis.iterdir():
        if not kanal.is_dir():
            continue
        for p in kanal.iterdir():
            if not p.is_dir() or p.name == laeuft:
                continue
            alt = (p / "state.json").exists() and (p / "state.json").stat().st_mtime < grenze
            if p.name in ids or alt:
                shutil.rmtree(p, ignore_errors=True)
                weg.append(p.name)
    # IDs, die es hier nie gab, gelten ebenfalls als aufgeräumt
    weg.extend(i for i in ids if i not in weg and i != laeuft)
    return weg
