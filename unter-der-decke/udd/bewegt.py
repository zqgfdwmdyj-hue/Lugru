"""B36.11 Stil „Vollbild“ in Bewegung (Rückmeldung 13.11.: „eher ein Bilderwechsel als ein Video“).

Vorher: je Szene EIN Standbild für 20–30 s, ohne jede Bewegung. Jetzt:
- Bildwechsel alle ~6 s (Kanalprofil „Bildwechsel alle … s“): je Szene 1–6 Bilder bzw. Clips, jeweils beim Schlüsselwort.
- Jedes Bild mit Kamerafahrt (Ken Burns: hinein/heraus zoomen, schwenken; aus 4K gerechnet, damit es ruckelfrei läuft).
- Echte Videoclips (Pexels, Kanalprofil „Videoclips“) zwischen den Bildern.
- Weiche Übergänge zwischen allem, die Einblendung (Kernaussage/Studie) blendet weich ein, Untertitel wie bisher.
"""

from __future__ import annotations

import math
import subprocess
from pathlib import Path

BREITE, HOEHE = 1920, 1080
BILD_SEK = 6.0  # Standard: alle 6 s ein neues Bild (5–7 s gewünscht)
BILD_SEK_MIN, BILD_SEK_MAX = 4.0, 10.0
MIN_SEG = 2.5  # kürzer als 2,5 s wirkt hektisch
MAX_JE_SZENE = 6
UEBERGANG = 0.5  # Sekunden Überblendung
QUELLE_4K = (3840, 2160)  # Kamerafahrt aus 4K: Ganzzahl-Positionen werden zu Viertelpixeln → kein Ruckeln

VARIANTEN = ("rein", "links", "raus", "rechts", "rein_oben", "raus_unten")
UEBERGAENGE = ("fade", "smoothleft", "fade", "smoothright", "fade", "circlecrop")


def bild_sek(kanal: dict) -> float:
    try:
        v = float(kanal.get("bildSek") or BILD_SEK)
    except (TypeError, ValueError):
        v = BILD_SEK
    return min(BILD_SEK_MAX, max(BILD_SEK_MIN, v))


def anzahl(dauer: float, sek: float = BILD_SEK) -> int:
    """Wie viele Bilder/Clips eine Szene bekommt: etwa alle „sek“ Sekunden eines, mindestens 1, höchstens 6."""
    if dauer <= 0:
        return 1
    n = round(dauer / max(1.0, sek))
    n = min(n, int(dauer // MIN_SEG) or 1)
    return max(1, min(MAX_JE_SZENE, n))


def _norm(w: str) -> str:
    return "".join(c for c in w.lower() if c.isalnum())


def zeiten(dauer: float, n: int, wortzeiten: list[tuple[str, float]] | None = None, woerter: list[str | None] | None = None) -> list[tuple[float, float]]:
    """Start und Länge je Bild einer Szene. Bild 1 beginnt bei 0; jedes weitere beim Schlüsselwort („wort“ aus dem
    Bildplan, Zeit aus den ElevenLabs-Wortzeiten), sonst gleichmäßig. Jedes Stück mindestens 2,5 s."""
    n = max(1, n)
    gleich = [dauer * k / n for k in range(n)]
    starts = [0.0]
    wz = [(_norm(w), t) for w, t in (wortzeiten or [])]
    for k in range(1, n):
        frueh = starts[-1] + MIN_SEG
        spaet = dauer - MIN_SEG * (n - k)
        t = gleich[k]
        ziel = _norm((woerter or [None] * n)[k] or "") if woerter and k < len(woerter) else ""
        if ziel:
            for w, tw in wz:
                if w == ziel and tw >= frueh - 0.01:
                    t = tw
                    break
        starts.append(round(min(max(t, frueh), max(frueh, spaet)), 3))
    ende = starts[1:] + [dauer]
    return [(s, round(max(0.5, e - s), 3)) for s, e in zip(starts, ende)]


def kenburns(variante: str, frames: int) -> str:
    """zoompan-Ausdrücke (weich beschleunigt/abgebremst) für eine Kamerafahrt über `frames` Bilder."""
    f = max(1, frames - 1)
    p = f"(0.5-0.5*cos(PI*on/{f}))"  # 0 → 1, weich
    z_rein, z_raus = f"1+0.16*{p}", f"1.16-0.16*{p}"
    mitte_x, mitte_y = "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
    if variante == "raus":
        return f"z='{z_raus}':x='{mitte_x}':y='{mitte_y}'"
    if variante == "links":  # Schwenk von rechts nach links bei leichtem Zoom
        return f"z='1.14':x='(iw-iw/zoom)*(1-{p})':y='{mitte_y}'"
    if variante == "rechts":
        return f"z='1.14':x='(iw-iw/zoom)*{p}':y='{mitte_y}'"
    if variante == "rein_oben":
        return f"z='{z_rein}':x='{mitte_x}':y='(ih-ih/zoom)*0.25'"
    if variante == "raus_unten":
        return f"z='{z_raus}':x='{mitte_x}':y='(ih-ih/zoom)*0.75'"
    return f"z='{z_rein}':x='{mitte_x}':y='{mitte_y}'"


def _lauf(args: list[str], cwd: Path | None = None) -> None:
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg: {(r.stderr or r.stdout).strip()[-600:]}")


def _x264(fps: int) -> list[str]:
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-r", str(fps), "-pix_fmt", "yuv420p"]


def segment_bild(ffmpeg: str, bild: Path, ziel: Path, dauer: float, fps: int, variante: str) -> None:
    """Ein Bild als Clip mit Kamerafahrt (ohne Ton)."""
    frames = max(2, math.ceil(dauer * fps))
    w4, h4 = QUELLE_4K
    vf = (
        f"scale={w4}:{h4}:force_original_aspect_ratio=increase,crop={w4}:{h4},"
        f"zoompan={kenburns(variante, frames)}:d={frames}:s={BREITE}x{HOEHE}:fps={fps},setsar=1,format=yuv420p"
    )
    _lauf([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(bild), "-vf", vf, "-frames:v", str(frames), *_x264(fps), "-an", str(ziel)])


def segment_clip(ffmpeg: str, quelle: Path, ziel: Path, dauer: float, fps: int, start: float = 0.3) -> None:
    """Stock-Clip auf 1920×1080 zuschneiden (füllend), auf die Länge kürzen; zu kurze Clips laufen in Schleife."""
    vf = f"scale={BREITE}:{HOEHE}:force_original_aspect_ratio=increase,crop={BREITE}:{HOEHE},fps={fps},setsar=1,format=yuv420p"
    _lauf([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-stream_loop", "-1", "-ss", f"{start:.2f}", "-i", str(quelle), "-t", f"{dauer:.3f}", "-vf", vf, *_x264(fps), "-an", str(ziel)])


def szene(ffmpeg: str, ordner: Path, segmente: list[tuple[str, float]], band: str | None, ton: str, untertitel: str, stil: str, ziel: str, laenge: float, fps: int, nr: int = 0) -> None:
    """Fertiger Szenen-Clip: Stücke mit weichen Übergängen, darüber die Einblendung (blendet ein), Untertitel, Sprache.
    `segmente` = (Datei, geplante Länge); jedes Stück außer dem letzten ist UEBERGANG länger gerendert (Überlappung)."""
    args = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error"]
    for name, _d in segmente:
        args += ["-i", name]
    n = len(segmente)
    if band:
        args += ["-loop", "1", "-framerate", str(fps), "-t", f"{laenge:.3f}", "-i", band]
    args += ["-i", ton]
    teile = [f"[{i}:v]settb=AVTB,setpts=PTS-STARTPTS,fps={fps},format=yuv420p[s{i}]" for i in range(n)]
    letzt = "s0"
    versatz = 0.0
    for i in range(1, n):
        versatz += segmente[i - 1][1]
        art = UEBERGAENGE[(nr + i) % len(UEBERGAENGE)]
        teile.append(f"[{letzt}][s{i}]xfade=transition={art}:duration={UEBERGANG:.2f}:offset={versatz:.3f}[x{i}]")
        letzt = f"x{i}"
    if band:
        teile.append(f"[{n}:v]format=rgba,fade=t=in:st=0.35:d=0.5:alpha=1[band]")
        teile.append(f"[{letzt}][band]overlay=0:0:format=auto[vb]")
        letzt = "vb"
    teile.append(f"[{letzt}]subtitles={untertitel}:force_style='{stil}',format=yuv420p[v]")
    ton_idx = n + (1 if band else 0)
    args += [
        "-filter_complex", ";".join(teile), "-map", "[v]", "-map", f"{ton_idx}:a",
        "-af", "apad", "-t", f"{laenge:.3f}",
        *_x264(fps), "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2", "-movflags", "+faststart", ziel,
    ]
    _lauf(args, cwd=ordner)


# ---- Pexels: passenden Clip wählen ------------------------------------------------------------------------------------


def clip_waehlen(videos: list[dict], dauer: float, benutzt: set[str]) -> tuple[dict, dict] | None:
    """Aus einer Pexels-Suche das beste Video + die beste Datei: noch nicht im Video benutzt, mindestens so lang wie
    gebraucht (sonst das längste), Querformat, Datei mit 1920 px (sonst die nächstgrößere bis 2560, sonst ≥ 1280)."""
    beste: tuple[float, dict, dict] | None = None
    for v in videos:
        vid = str(v.get("id") or "")
        if not vid or vid in benutzt:
            continue
        dateien = [f for f in v.get("video_files") or [] if (f.get("file_type") or "video/mp4") == "video/mp4" and f.get("link") and (f.get("width") or 0) >= (f.get("height") or 0)]
        if not dateien:
            continue

        def guete(f: dict) -> float:
            w = f.get("width") or 0
            return 3 if w == 1920 else 2 if 1920 < w <= 2560 else 1 if w >= 1280 else 0

        datei = max(dateien, key=lambda f: (guete(f), -(abs((f.get("width") or 0) - 1920))))
        if guete(datei) == 0:
            continue
        lang = float(v.get("duration") or 0)
        punkte = guete(datei) * 10 + (5 if lang >= dauer + 0.5 else lang / max(1.0, dauer) * 4)
        if beste is None or punkte > beste[0]:
            beste = (punkte, v, datei)
    return (beste[1], beste[2]) if beste else None
