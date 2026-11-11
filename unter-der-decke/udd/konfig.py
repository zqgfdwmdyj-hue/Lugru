"""Einstellungen aus Umgebungsvariablen (siehe README). Keine Schlüssel hier – die liegen im Seller-System."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Konfig:
    seller_url: str
    token: str
    arbeitsordner: Path
    musikordner: Path
    poll_s: float
    min_frei_gb: float
    warn_frei_gb: float
    fps: int
    claude_modell: str
    aufbewahren_tage: int
    ffmpeg: str
    ffprobe: str


def laden() -> Konfig:
    seller = os.environ.get("SELLER_URL", "").rstrip("/")
    token = os.environ.get("WORKER_TOKEN", "").strip()
    if not seller or not token:
        raise SystemExit("SELLER_URL und WORKER_TOKEN fehlen (Token: Seller-System → Video → Worker → „Worker anlegen“).")
    if not token.startswith("vw_"):
        raise SystemExit("WORKER_TOKEN muss mit vw_ beginnen.")
    hier = Path(__file__).resolve().parent.parent
    return Konfig(
        seller_url=seller,
        token=token,
        arbeitsordner=Path(os.environ.get("ARBEITSORDNER", hier / "arbeit")).resolve(),
        musikordner=Path(os.environ.get("MUSIKORDNER", hier / "musik")).resolve(),
        poll_s=float(os.environ.get("VIDEO_POLL_S", "30")),
        min_frei_gb=float(os.environ.get("MIN_FREI_GB", "3")),
        warn_frei_gb=float(os.environ.get("WARN_FREI_GB", "5")),
        fps=int(os.environ.get("VIDEO_FPS", "25")),
        # leer = Modell aus dem Seller-System (Seite Video → Modell und Ablage)
        claude_modell=os.environ.get("CLAUDE_MODELL", "").strip(),
        aufbewahren_tage=int(os.environ.get("AUFBEWAHREN_TAGE", "14")),
        ffmpeg=os.environ.get("FFMPEG", "ffmpeg"),
        ffprobe=os.environ.get("FFPROBE", "ffprobe"),
    )
