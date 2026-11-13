"""B36.12 Eigene Clip-Bibliothek: Videos im Ordner „clips“ am Worker-PC (CLIPORDNER, im Docker /clips).

- Unterordner mit dem Namen (Slug) eines Kanals = nur für diesen Kanal; alle anderen Dateien für alle Kanäle. Die Namen
  der übrigen Ordner zählen als Schlagwörter (z. B. clips/rolex/… → „rolex“).
- Jeder neue Clip wird einmal angesehen: 4 Standbilder → Claude beschreibt, was zu sehen ist, vergibt Schlagwörter,
  wählt das beste Bild (dort beginnt der Abschnitt) und sortiert Unbrauchbares aus (Wasserzeichen, Text, verwackelt).
- Kennung = Prüfsumme der Datei (Umbenennen/Verschieben kostet nichts). Ergebnis in arbeit/clipbibliothek/index.json.
- Beim Bebildern bekommt Claude die passenden Clips als Katalog und wählt gezielt je Satz; jeder Clip höchstens einmal je
  Video, selten benutzte zuerst.
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import time
from pathlib import Path
from typing import Any

from PIL import Image

ENDUNGEN = {".mp4", ".mov", ".m4v", ".webm", ".mkv"}
MIN_DAUER = 2.0
MIN_BREITE = 960
KATALOG_MAX = 40  # so viele Clips höchstens je Bildplan-Aufruf (die passendsten)
ANALYSE_JE_LAUF = 40  # so viele neue Clips höchstens je Video ansehen (Rest beim nächsten)

ANALYSE_SCHEMA = {
    "type": "object",
    "properties": {
        "beschreibung": {"type": "string"},
        "schlagwoerter": {"type": "array", "items": {"type": "string"}},
        "einstellung": {"type": "string", "enum": ["detail", "nah", "halbtotale", "totale", "luftbild"]},
        "brauchbar": {"type": "boolean"},
        "grund": {"type": "string"},
        "bestes_bild": {"type": "integer"},
    },
    "required": ["beschreibung", "schlagwoerter", "einstellung", "brauchbar", "grund", "bestes_bild"],
    "additionalProperties": False,
}


def slug(text: str) -> str:
    t = text.lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")[:80]


def scannen(ordner: Path, kanal_ordner: set[str]) -> list[dict[str, Any]]:
    """Alle Videodateien im Clip-Ordner (ohne versteckte Ordner/Dateien): relativer Pfad, Kanal (oder None), Ordner-Tags."""
    if not ordner.is_dir():
        return []
    aus: list[dict[str, Any]] = []
    for p in sorted(ordner.rglob("*")):
        if not p.is_file() or p.suffix.lower() not in ENDUNGEN:
            continue
        rel = p.relative_to(ordner)
        if any(t.startswith(".") for t in rel.parts):
            continue
        teile = list(rel.parts[:-1])
        kanal = slug(teile[0]) if teile and slug(teile[0]) in kanal_ordner else None
        tags = [slug(t).replace("-", " ") for t in teile if slug(t) not in kanal_ordner and slug(t) not in ("alle", "clips")]
        aus.append({"datei": p, "pfad": rel.as_posix(), "kanal": kanal, "tags": [t for t in tags if t]})
    return aus


def clip_id(p: Path) -> str:
    """Prüfsumme aus Größe + erstem und letztem MB – schnell auch bei großen Dateien, unabhängig vom Namen."""
    h = hashlib.sha1()
    groesse = p.stat().st_size
    h.update(str(groesse).encode())
    with open(p, "rb") as f:
        h.update(f.read(1024 * 1024))
        if groesse > 2 * 1024 * 1024:
            f.seek(-1024 * 1024, 2)
            h.update(f.read(1024 * 1024))
    return h.hexdigest()[:20]


def quelle_aus_name(name: str) -> tuple[str, str | None]:
    """Herkunft aus dem Dateinamen: „pexels-vorname-nachname-12345.mp4“ (Pexels-Download) → Pexels + Filmer;
    „…pixabay…“ → Pixabay; sonst eigener Clip (ohne Nennung)."""
    stamm = Path(name).stem
    n = stamm.lower()
    if n.startswith("pexels-"):
        teile = [t for t in stamm.split("-")[1:] if t and not t.isdigit() and not re.fullmatch(r"\d+p|uhd|hd|sd|\d+fps|\d+x\d+", t.lower())]
        filmer = " ".join(t[:1].upper() + t[1:] for t in teile)[:80] or None
        return "pexels", filmer
    if "pixabay" in n:
        return "pixabay", None
    return "eigen", None


def video_info(ffprobe: str, p: Path) -> dict[str, float]:
    r = subprocess.run([ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", str(p)], capture_output=True, text=True)
    try:
        d = json.loads(r.stdout or "{}")
        s = (d.get("streams") or [{}])[0]
        return {"dauer": float((d.get("format") or {}).get("duration") or 0), "breite": float(s.get("width") or 0), "hoehe": float(s.get("height") or 0)}
    except (ValueError, IndexError, TypeError):
        return {"dauer": 0.0, "breite": 0.0, "hoehe": 0.0}


def zeitpunkte(dauer: float) -> list[float]:
    return [round(max(0.0, dauer * f), 2) for f in (0.1, 0.35, 0.6, 0.85)]


def standbilder(ffmpeg: str, p: Path, dauer: float, ordner: Path) -> list[tuple[float, Path]]:
    """4 Standbilder (512 px breit, JPEG) an 10/35/60/85 % der Länge."""
    ordner.mkdir(parents=True, exist_ok=True)
    aus = []
    for i, t in enumerate(zeitpunkte(dauer)):
        ziel = ordner / f"bild{i + 1}.jpg"
        subprocess.run([ffmpeg, "-y", "-v", "error", "-ss", f"{t:.2f}", "-i", str(p), "-frames:v", "1", "-vf", "scale=512:-2", "-q:v", "5", str(ziel)], capture_output=True)
        if ziel.exists() and ziel.stat().st_size > 0:
            aus.append((t, ziel))
    return aus


def vorschau(bilder: list[Path], ziel: Path) -> None:
    """2×2-Raster (640×360) aus den Standbildern – für die Clip-Bibliothek im Seller-System."""
    raster = Image.new("RGB", (640, 360), (20, 20, 20))
    for i, b in enumerate(bilder[:4]):
        with Image.open(b) as im:
            im = im.convert("RGB")
            im.thumbnail((320, 180))
            raster.paste(im, ((i % 2) * 320 + (320 - im.width) // 2, (i // 2) * 180 + (180 - im.height) // 2))
    raster.save(ziel, "JPEG", quality=78)


def analyse_prompt(pfad: str, dauer: float, zeiten: list[float], tags: list[str], kanal: dict) -> str:
    return "\n".join(
        [
            "[video:clipanalyse]",
            f"Datei: {pfad} ({dauer:.1f} s). Ordner-Stichwörter: {', '.join(tags) or '–'}.",
            f"Kanal: {kanal.get('name') or ''} – Thema: {kanal.get('themenbereich') or ''}.",
            f"Die {len(zeiten)} Bilder stammen aus dem Clip bei " + ", ".join(f"{t:.1f} s" for t in zeiten) + ".",
            "Beschreibe auf Deutsch in einem Satz, was zu sehen ist (konkret: Gegenstände, Marke/Modell wenn eindeutig erkennbar, "
            "Handlung, Ort). Schlagwörter: 5–12, deutsch und englisch gemischt, klein geschrieben (z. B. „uhr“, „watch“, "
            "„rolex“, „zifferblatt“, „nahaufnahme“, „hand“). einstellung: detail/nah/halbtotale/totale/luftbild. "
            "brauchbar = false bei Wasserzeichen, eingeblendetem Text/Logo eines Anbieters, starkem Verwackeln, sehr dunkel "
            "oder unscharf – grund kurz nennen (sonst leer). bestes_bild = Nummer (1–4) des schönsten, ruhigsten Bildes.",
        ]
    )


STOPPWOERTER = {
    "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "und", "oder", "aber", "ist", "sind", "war",
    "hat", "haben", "mit", "von", "für", "auf", "aus", "bei", "zum", "zur", "als", "wie", "was", "wer", "sich", "sie", "wir", "ich",
    "man", "nicht", "auch", "noch", "nur", "mehr", "sehr", "dann", "denn", "wenn", "dass", "the", "and", "for", "with", "this", "that",
}


def _woerter(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-zäöüß0-9]{3,}", text.lower()) if w not in STOPPWOERTER}


def _passt(w: str, b: str) -> bool:
    """Wort aus dem Text ↔ Schlagwort: gleich oder gleicher Wortanfang (uhr/uhren, rolex/rolexuhr)."""
    return w == b or (min(len(w), len(b)) >= 3 and (b.startswith(w) or w.startswith(b)))


def katalog(eintraege: list[dict[str, Any]], text: str, grenze: int = KATALOG_MAX) -> list[dict[str, Any]]:
    """Die passendsten Clips zu einem Textabschnitt (Wort-Treffer in Schlagwörtern/Beschreibung), selten benutzte zuerst."""
    woerter = _woerter(text)

    def punkte(e: dict[str, Any]) -> float:
        bag = _woerter(" ".join([*(e.get("schlagwoerter") or []), e.get("beschreibung") or ""]))
        treffer = sum(1 for w in woerter if any(_passt(w, b) for b in bag))
        return treffer * 10 - min(5, int(e.get("benutzt") or 0))

    return sorted(eintraege, key=lambda e: (-punkte(e), e.get("pfad") or ""))[:grenze]


class Bibliothek:
    """Index der angesehenen Clips (arbeit/clipbibliothek/index.json)."""

    def __init__(self, ordner: Path):
        self.ordner = ordner
        self.datei = ordner / "index.json"
        try:
            self.clips: dict[str, dict[str, Any]] = json.loads(self.datei.read_text(encoding="utf-8")) if self.datei.exists() else {}
        except ValueError:
            self.clips = {}

    def speichern(self) -> None:
        self.ordner.mkdir(parents=True, exist_ok=True)
        tmp = self.datei.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.clips, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.datei)

    def benutzt(self, cid: str) -> None:
        e = self.clips.get(cid)
        if e:
            e["benutzt"] = int(e.get("benutzt") or 0) + 1
            e["zuletzt"] = int(time.time())
            self.speichern()


def wirksam(e: dict[str, Any], korrektur: dict[str, Any] | None) -> dict[str, Any] | None:
    """Eintrag mit den Korrekturen von Hand (Seller-System); None = gesperrt."""
    k = korrektur or {}
    if k.get("gesperrt"):
        return None
    return {**e, "schlagwoerter": k.get("schlagwoerter") or e.get("schlagwoerter") or [], "beschreibung": k.get("beschreibung") or e.get("beschreibung") or ""}
