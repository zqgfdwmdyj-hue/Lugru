"""Bilder (Pillow) und Video (ffmpeg): Szenenbilder 1920×1080, Einblendungen, Thumbnail, Untertitel, Clips, Musik."""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

BREITE, HOEHE = 1920, 1080

_SCHRIFTEN = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "C:/Windows/Fonts/segoeuib.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
]


def schrift(groesse: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    eigene = os.environ.get("SCHRIFT")
    for p in ([eigene] if eigene else []) + _SCHRIFTEN:
        if p and Path(p).exists():
            return ImageFont.truetype(p, groesse)
    return ImageFont.load_default(size=groesse)


def _umbrechen(draw: ImageDraw.ImageDraw, text: str, font, max_breite: int) -> list[str]:
    zeilen: list[str] = []
    aktuell = ""
    for wort in text.split():
        probe = f"{aktuell} {wort}".strip()
        if draw.textlength(probe, font=font) <= max_breite or not aktuell:
            aktuell = probe
        else:
            zeilen.append(aktuell)
            aktuell = wort
    if aktuell:
        zeilen.append(aktuell)
    return zeilen


def fuellend(bild: Image.Image, breite: int, hoehe: int) -> Image.Image:
    """Auf Zielgröße skalieren und mittig zuschneiden (kein Rand, kein Verzerren)."""
    bild = bild.convert("RGB")
    f = max(breite / bild.width, hoehe / bild.height)
    neu = bild.resize((max(breite, round(bild.width * f)), max(hoehe, round(bild.height * f))), Image.LANCZOS)
    x, y = (neu.width - breite) // 2, (neu.height - hoehe) // 2
    return neu.crop((x, y, x + breite, y + hoehe))


def szenenbild(quelle: Path, einblendung: str | None, ziel: Path) -> None:
    """Bild 1920×1080, optional mit Einblendung (Kernaussage/Studie) als Band oben links – Untertitel bleiben unten frei."""
    bild = fuellend(Image.open(quelle), BREITE, HOEHE)
    if einblendung and einblendung.strip():
        d = ImageDraw.Draw(bild, "RGBA")
        f = schrift(46)
        zeilen = _umbrechen(d, einblendung.strip(), f, 1100)[:3]
        h = 30 + 62 * len(zeilen)
        d.rounded_rectangle((60, 60, 60 + 1180, 60 + h), radius=18, fill=(10, 14, 24, 200))
        for i, z in enumerate(zeilen):
            d.text((90, 75 + i * 62), z, font=f, fill=(255, 255, 255, 255))
    bild.save(ziel, "PNG")


def ersatzbild(text: str, ziel: Path, breite: int = 1536, hoehe: int = 1024) -> None:
    """Lokales Ersatzbild (wenn der Bildanbieter ablehnt): ruhiger Verlauf mit kurzem Stichwort, keine Personen."""
    bild = Image.new("RGB", (breite, hoehe))
    d = ImageDraw.Draw(bild)
    for y in range(hoehe):
        t = y / hoehe
        d.line([(0, y), (breite, y)], fill=(int(28 + 40 * t), int(42 + 30 * t), int(70 + 50 * t)))
    f = schrift(64)
    zeilen = _umbrechen(d, text.strip()[:80] or "…", f, breite - 240)[:3]
    for i, z in enumerate(zeilen):
        w = d.textlength(z, font=f)
        d.text(((breite - w) / 2, hoehe / 2 - 40 * len(zeilen) + i * 84), z, font=f, fill=(235, 238, 245))
    bild.save(ziel, "PNG")


def thumbnail(quelle: Path | None, text: str, ziel: Path) -> None:
    """Thumbnail 1280×720 mit höchstens 4 Wörtern, groß und kontrastreich."""
    woerter = text.split()[:4]
    if quelle and quelle.exists():
        bild = fuellend(Image.open(quelle), 1280, 720)
        bild = ImageEnhance.Brightness(bild.filter(ImageFilter.GaussianBlur(1))).enhance(0.55)
    else:
        bild = Image.new("RGB", (1280, 720), (24, 30, 48))
    d = ImageDraw.Draw(bild)
    groesse = 150
    while groesse > 60:
        f = schrift(groesse)
        zeilen = _umbrechen(d, " ".join(woerter).upper(), f, 1160)
        if len(zeilen) <= 2:
            break
        groesse -= 10
    hoehe_gesamt = len(zeilen) * (groesse + 10)
    y = (720 - hoehe_gesamt) // 2
    for z in zeilen:
        w = d.textlength(z, font=f)
        d.text(((1280 - w) / 2, y), z, font=f, fill=(255, 214, 0), stroke_width=8, stroke_fill=(0, 0, 0))
        y += groesse + 10
    bild.save(ziel, "PNG")


# ---- Untertitel ----------------------------------------------------------------------------------------------------


def untertitel_teile(text: str, dauer: float, max_woerter: int = 9) -> list[tuple[float, float, str]]:
    """Text in kurze Zeilen teilen und die Zeit nach Zeichenzahl verteilen (Sprache läuft gleichmäßig)."""
    saetze = [s.strip() for s in re.split(r"(?<=[.!?…])\s+", text.strip()) if s.strip()]
    teile: list[str] = []
    for s in saetze:
        w = s.split()
        while len(w) > max_woerter:
            teile.append(" ".join(w[:max_woerter]))
            w = w[max_woerter:]
        if w:
            teile.append(" ".join(w))
    if not teile:
        return []
    gesamt = sum(len(t) for t in teile)
    out: list[tuple[float, float, str]] = []
    t0 = 0.0
    for t in teile:
        d = dauer * len(t) / gesamt
        out.append((t0, t0 + d, t))
        t0 += d
    return out


def _zeit(s: float) -> str:
    ms = int(round(s * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    sek, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{sek:02d},{ms:03d}"


def srt(teile: list[tuple[float, float, str]], versatz: float = 0.0, start_nr: int = 1) -> str:
    return "".join(f"{start_nr + i}\n{_zeit(a + versatz)} --> {_zeit(e + versatz)}\n{t}\n\n" for i, (a, e, t) in enumerate(teile))


# ---- Kapitel -------------------------------------------------------------------------------------------------------


def kapitel(szenen: list[dict], titel_je_abschnitt: dict[str, str]) -> list[dict]:
    """Kapitel an Abschnittsgrenzen (YouTube: erstes bei 0:00, mind. 3, je mind. 10 s)."""
    out: list[dict] = []
    t = 0.0
    letzter = None
    for s in szenen:
        ab = s.get("abschnitt") or ""
        gruppe = {"hook": "intro", "angst": "intro", "cta": "zusammenfassung"}.get(ab, ab)
        if gruppe != letzter:
            name = titel_je_abschnitt.get(gruppe) or titel_je_abschnitt.get(ab) or ab.capitalize()
            # Ist das vorige Kapitel kürzer als 10 s, läuft es weiter (YouTube verlangt mind. 10 s je Kapitel).
            if not out or t - out[-1]["start"] >= 10:
                out.append({"start": int(t), "titel": name})
            letzter = gruppe
        t += float(s.get("dauer") or 0)
    if out:
        out[0]["start"] = 0
    return out if len(out) >= 3 else []


def kapitel_text(k: list[dict]) -> str:
    return "\n".join(f"{c['start'] // 60}:{c['start'] % 60:02d} {c['titel']}" for c in k)


# ---- ffmpeg --------------------------------------------------------------------------------------------------------


def _lauf(befehl: list[str], cwd: Path | None = None) -> None:
    r = subprocess.run(befehl, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg fehlgeschlagen: {r.stderr.strip()[-600:]}")


def dauer(ffprobe: str, datei: Path) -> float:
    r = subprocess.run([ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "json", str(datei)], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffprobe: {r.stderr.strip()[-300:]}")
    return float(json.loads(r.stdout)["format"]["duration"])


def video_info(ffprobe: str, datei: Path) -> dict:
    r = subprocess.run([ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", str(datei)], capture_output=True, text=True)
    d = json.loads(r.stdout or "{}")
    s = (d.get("streams") or [{}])[0]
    return {"breite": s.get("width"), "hoehe": s.get("height"), "dauer": float(d.get("format", {}).get("duration") or 0)}


_STIL = "FontName=DejaVu Sans,FontSize=13,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1.6,Shadow=0,MarginV=28,Alignment=2"


def clip(ffmpeg: str, ordner: Path, bild: str, ton: str, untertitel: str, ziel: str, laenge: float, fps: int) -> None:
    """Ein Szenen-Clip: Standbild + Sprache + eingebrannte Untertitel. Läuft im Szenenordner (relative Pfade –
    so gibt es unter Windows keine Probleme mit Laufwerksbuchstaben im Untertitel-Filter)."""
    _lauf(
        [
            ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
            "-loop", "1", "-framerate", str(fps), "-i", bild,
            "-i", ton,
            "-vf", f"subtitles={untertitel}:force_style='{_STIL}',format=yuv420p",
            "-af", "apad",
            "-t", f"{laenge:.3f}",
            "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-crf", "22", "-r", str(fps),
            "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2",
            "-movflags", "+faststart",
            ziel,
        ],
        cwd=ordner,
    )


def clip_bilder(ffmpeg: str, ordner: Path, bilder: list[tuple[str, float]], ton: str, ziel: str, laenge: float, fps: int) -> None:
    """Whiteboard-Clip (B36.9): Bildfolge mit Dauern (Aufdeck-Animation) + Sprache, ohne eingebrannte Untertitel.
    Läuft im Bildordner (relative Pfade)."""
    zeilen = ["ffconcat version 1.0"]
    for name, d in bilder:
        zeilen += [f"file '{name}'", f"duration {max(d, 1 / fps):.4f}"]
    zeilen.append(f"file '{bilder[-1][0]}'")
    (ordner / "bilder.txt").write_text("\n".join(zeilen) + "\n", encoding="utf-8")
    _lauf(
        [
            ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
            "-f", "concat", "-safe", "0", "-i", "bilder.txt",
            "-i", ton,
            "-vf", f"fps={fps},scale={BREITE}:{HOEHE},format=yuv420p",
            "-af", "apad",
            "-t", f"{laenge:.3f}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-r", str(fps),
            "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2",
            "-movflags", "+faststart",
            ziel,
        ],
        cwd=ordner,
    )


def zusammenfuegen(ffmpeg: str, ordner: Path, clips: list[str], ziel: str) -> None:
    liste = ordner / "liste.txt"
    liste.write_text("".join(f"file '{c}'\n" for c in clips), encoding="utf-8")
    _lauf([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "liste.txt", "-c", "copy", "-movflags", "+faststart", ziel], cwd=ordner)


def musik_unterlegen(ffmpeg: str, ffprobe: str, video: Path, musik: Path, ziel: Path, lautstaerke: float = 0.08) -> None:
    """Musik leise unter die Sprache (Schleife, am Ende ausblenden). Bild wird nur kopiert."""
    laenge = dauer(ffprobe, video)
    _lauf(
        [
            ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(video), "-stream_loop", "-1", "-i", str(musik),
            "-filter_complex", f"[1:a]volume={lautstaerke},afade=t=out:st={max(0, laenge - 3):.2f}:d=3[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]",
            "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(ziel),
        ]
    )
