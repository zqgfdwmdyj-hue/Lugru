"""Stil „Whiteboard-Collage“ (B36.9): weißer Hintergrund, 3–5 Cartoon-Motive je Szene (einzeln erzeugt, aus der
Kanal-Bibliothek wiederverwendet), Texte in fester Schrift (Anton, nie vom Bildmodell), Aufdeck-Animation mit Hand,
vorige Szene als blasser Hintergrund (15 %). Reine Bildlogik mit Pillow – Anbieter-Aufrufe macht schritte.py.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

from .projekt import schreiben_atomar

B, H = 1920, 1080
WEISS = (255, 255, 255)
SCHWARZ = (24, 24, 24)
ROT = (214, 40, 40)
ORANGE = (238, 108, 20)
BLASS = 0.15  # Anteil der vorigen Szene im Hintergrund
RAND = 60
LAYOUTS = ("3er", "4er", "5er", "figur-liste", "gegenueberstellung")
SCHRIFT = Path(__file__).resolve().parent.parent / "schriften" / "Anton-Regular.ttf"
# Dauer der Aufdeck-Animation je Element (Sekunden), Pause dazwischen
DAUER = {"text": 0.45, "motiv": 0.75, "punkt": 0.35}
PAUSE = 0.12

_schriften: dict[int, ImageFont.FreeTypeFont | ImageFont.ImageFont] = {}


def anton(groesse: int):
    """Feste Schrift für alle Texte (fett, schmal, mit Umlauten). Fehlt die Datei, die Ersatzschrift des Workers."""
    if groesse not in _schriften:
        try:
            _schriften[groesse] = ImageFont.truetype(str(SCHRIFT), groesse)
        except OSError:
            from . import medien

            _schriften[groesse] = medien.schrift(groesse)
    return _schriften[groesse]


def schluessel(text: str) -> str:
    """Bibliotheks-Schlüssel: klein, a–z/0–9/-, Umlaute ausgeschrieben."""
    t = text.lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        t = t.replace(a, b)
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")[:40] or "motiv"


# ---- Bibliothek (je Kanal, bleibt über alle Videos) ------------------------------------------------------------------


class Bibliothek:
    """Erzeugte Motive je Kanal (Kanalordner/motive): einmal bezahlt, immer wieder verwendet."""

    def __init__(self, ordner: Path):
        self.ordner = ordner
        ordner.mkdir(parents=True, exist_ok=True)
        self._index_pfad = ordner / "index.json"
        try:
            self.index: dict[str, dict] = json.loads(self._index_pfad.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.index = {}

    def _speichern(self) -> None:
        schreiben_atomar(self._index_pfad, json.dumps(self.index, ensure_ascii=False, indent=1).encode("utf-8"))

    def hat(self, key: str) -> bool:
        e = self.index.get(key)
        return bool(e) and (self.ordner / e["datei"]).exists()

    def bild(self, key: str) -> Image.Image:
        return Image.open(self.ordner / self.index[key]["datei"]).convert("RGBA")

    def merkmal(self, key: str) -> str:
        return (self.index.get(key) or {}).get("hash", "")

    def merken(self, key: str, png: bytes, beschreibung: str) -> None:
        datei = f"{key}.png"
        schreiben_atomar(self.ordner / datei, png)
        self.index[key] = {"datei": datei, "beschreibung": beschreibung[:300], "hash": hashlib.sha256(png).hexdigest()[:16]}
        self._speichern()

    def entfernen(self, key: str) -> None:
        e = self.index.pop(key, None)
        if e:
            (self.ordner / e["datei"]).unlink(missing_ok=True)
            self._speichern()

    def liste(self) -> list[dict[str, str]]:
        """Für den Skript-Prompt: wiederverwendbare Motive (ohne interne wie die Hand)."""
        return [{"key": k, "beschreibung": v.get("beschreibung", "")} for k, v in sorted(self.index.items()) if not k.startswith("_") and (self.ordner / v["datei"]).exists()]


# ---- Motive freistellen ----------------------------------------------------------------------------------------------


def freistellen(daten: bytes) -> bytes:
    """Motiv als PNG mit Transparenz, auf den Inhalt zugeschnitten. Liefert das Modell weißen statt transparenten
    Hintergrund, wird der mit den Ecken verbundene weiße Bereich durchsichtig."""
    img = Image.open(io.BytesIO(daten)).convert("RGBA")
    if img.getchannel("A").getextrema()[0] >= 250:
        rgb = img.convert("RGB")
        w, h = rgb.size
        arbeit = rgb.copy()
        marke = (255, 0, 255)
        for xy in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
            if min(arbeit.getpixel(xy)) > 225:
                ImageDraw.floodfill(arbeit, xy, marke, thresh=40)
        diff = ImageChops.difference(arbeit, Image.new("RGB", (w, h), marke)).convert("L")
        img.putalpha(diff.point(lambda v: 255 if v > 8 else 0))
    box = img.getchannel("A").point(lambda v: 255 if v > 16 else 0).getbbox()
    if box:
        img = img.crop(box)
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


def ersatz_motiv() -> bytes:
    """Lokales Ersatzmotiv (Glühbirne), wenn das Bildmodell ablehnt und auch das Ersatzmotiv nicht erzeugt."""
    img = Image.new("RGBA", (420, 520), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((40, 20, 380, 360), fill=(255, 214, 64, 255), outline=SCHWARZ, width=12)
    d.rectangle((140, 350, 280, 470), fill=(180, 180, 180, 255), outline=SCHWARZ, width=12)
    for y in (385, 420):
        d.line((140, y, 280, y), fill=SCHWARZ, width=8)
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


def hand_gezeichnet() -> Image.Image:
    """Ersatz-Hand mit Stift (Spitze oben links bei 4 %/4 %), falls keine Hand erzeugt werden konnte."""
    img = Image.new("RGBA", (360, 400), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.polygon([(10, 10), (40, 18), (190, 168), (168, 190), (18, 40)], fill=SCHWARZ)  # Stift
    d.polygon([(10, 10), (40, 18), (18, 40)], fill=(90, 90, 90))  # Spitze
    d.ellipse((150, 150, 340, 390), fill=(247, 205, 170, 255), outline=SCHWARZ, width=8)  # Hand
    d.ellipse((120, 175, 200, 255), fill=(247, 205, 170, 255), outline=SCHWARZ, width=8)  # Daumen
    return img


def hand_vorbereiten(img: Image.Image, hoehe: int = 380) -> Image.Image:
    img = img.convert("RGBA")
    box = img.getchannel("A").getbbox()
    if box:
        img = img.crop(box)
    f = hoehe / max(1, img.height)
    return img.resize((max(1, round(img.width * f)), hoehe), Image.LANCZOS)


# ---- Layout ----------------------------------------------------------------------------------------------------------


@dataclass
class Element:
    art: str  # text | motiv | punkt
    ebene: Image.Image  # RGBA, nur der Bereich des Elements
    pos: tuple[int, int]

    @property
    def box(self) -> tuple[int, int, int, int]:
        return (self.pos[0], self.pos[1], self.pos[0] + self.ebene.width, self.pos[1] + self.ebene.height)


def _passend(text: str, max_b: int, max_h: int, start: int, minimum: int = 28, zeilen: int = 2):
    """Größte Schrift, mit der der Text in höchstens `zeilen` Zeilen in max_b × max_h passt."""
    probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    for g in range(start, minimum - 1, -4):
        f = anton(g)
        z: list[str] = []
        akt = ""
        for w in text.split():
            p = f"{akt} {w}".strip()
            if probe.textlength(p, font=f) <= max_b or not akt:
                akt = p
            else:
                z.append(akt)
                akt = w
        if akt:
            z.append(akt)
        hz = round(g * 1.18)
        if len(z) <= zeilen and hz * len(z) <= max_h and all(probe.textlength(x, font=f) <= max_b for x in z):
            return f, z, hz
    f = anton(minimum)
    return f, [text], round(minimum * 1.18)


def _text_ebene(text: str, max_b: int, max_h: int, farbe, start: int, zeilen: int = 2, ausrichtung: str = "mitte") -> Image.Image:
    f, z, hz = _passend(text, max_b, max_h, start, zeilen=zeilen)
    probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    breite = max(int(probe.textlength(x, font=f)) for x in z) + 8
    img = Image.new("RGBA", (breite, hz * len(z) + 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i, x in enumerate(z):
        w = probe.textlength(x, font=f)
        xx = (breite - w) / 2 if ausrichtung == "mitte" else 4
        d.text((xx, 4 + i * hz), x, font=f, fill=farbe)
    return img


def _balken(text: str, breite: int = B - 2 * RAND) -> Image.Image:
    """Aussagesatz im roten Balken mit weißer Schrift."""
    hoehe = 112
    img = Image.new("RGBA", (breite, hoehe), ROT + (255,))
    t = _text_ebene(text, breite - 80, hoehe - 20, WEISS, 76, zeilen=1)
    img.alpha_composite(t, ((breite - t.width) // 2, (hoehe - t.height) // 2))
    return img


def _schritt_kasten(text: str, max_b: int) -> Image.Image:
    """Schritt im schwarz umrandeten Kasten („Schritt 4: …“)."""
    t = _text_ebene(text, max_b - 60, 100, SCHWARZ, 64, zeilen=1)
    img = Image.new("RGBA", (t.width + 56, t.height + 36), WEISS + (255,))
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, img.width - 1, img.height - 1), outline=SCHWARZ, width=7)
    img.alpha_composite(t, (28, 18))
    return img


def _einpassen(motiv: Image.Image, box: tuple[int, int, int, int], fuellung: float = 0.9) -> Element:
    x0, y0, x1, y1 = box
    bw, bh = (x1 - x0) * fuellung, (y1 - y0) * fuellung
    f = min(bw / max(1, motiv.width), bh / max(1, motiv.height))
    m = motiv.resize((max(1, round(motiv.width * f)), max(1, round(motiv.height * f))), Image.LANCZOS)
    return Element("motiv", m, (round(x0 + (x1 - x0 - m.width) / 2), round(y0 + (y1 - y0 - m.height) / 2)))


def layout_wahl(layout: str | None, n: int) -> str:
    if layout in LAYOUTS:
        if layout == "3er" and n != 3 or layout == "4er" and n != 4 or layout == "5er" and n != 5:
            return {3: "3er", 4: "4er", 5: "5er"}.get(n, "gegenueberstellung" if n <= 2 else "5er")
        return layout
    return {1: "figur-liste", 2: "gegenueberstellung", 3: "3er", 4: "4er"}.get(n, "5er")


def slots(layout: str, n: int, bereich: tuple[int, int, int, int]) -> list[tuple[int, int, int, int]]:
    """Feste Raster-Vorlagen für die Motive im freien Bereich (zwischen Kopf- und Fußtexten)."""
    x0, y0, x1, y1 = bereich
    w, h = x1 - x0, y1 - y0

    def reihe(anzahl: int, ya: int, yb: int, xa: int = x0, xb: int = x1) -> list[tuple[int, int, int, int]]:
        sw = (xb - xa) / max(1, anzahl)
        return [(round(xa + i * sw), ya, round(xa + (i + 1) * sw), yb) for i in range(anzahl)]

    if layout == "3er":
        return reihe(3, y0, y1)
    if layout == "4er":
        return reihe(2, y0, y0 + h // 2) + reihe(2, y0 + h // 2, y1) if h >= 560 else reihe(4, y0, y1)
    if layout == "5er":
        return reihe(3, y0, y0 + h // 2) + reihe(2, y0 + h // 2, y1, x0 + w // 6, x1 - w // 6)
    if layout == "figur-liste":
        haupt = [(x0, y0, x0 + round(w * 0.4), y1)]
        rest = reihe(n - 1, y0 + round(h * 0.68), y1, x0 + round(w * 0.45), x1) if n > 1 else []
        return haupt + rest
    # gegenueberstellung: zwei große Motive links/rechts, weitere klein in der Mitte übereinander
    links, rechts = (x0, y0, x0 + round(w * 0.42), y1), (x1 - round(w * 0.42), y0, x1, y1)
    mitte = [(x0 + round(w * 0.42), round(y0 + i * h / max(1, n - 2)), x1 - round(w * 0.42), round(y0 + (i + 1) * h / max(1, n - 2))) for i in range(max(0, n - 2))]
    return [links, rechts] + mitte


def elemente(szene: dict, motive: list[Image.Image]) -> list[Element]:
    """Alle Elemente einer Szene in Aufdeck-Reihenfolge: Kopf (Überschrift, roter Balken) → Motive → Liste → Fuß
    (Kernaussage rot, Schritt im Kasten)."""
    els: list[Element] = []
    y = 34
    if (szene.get("ueberschrift") or "").strip():
        t = _text_ebene(szene["ueberschrift"].strip(), B - 2 * RAND, 130, SCHWARZ, 108, zeilen=1)
        els.append(Element("text", t, ((B - t.width) // 2, y)))
        y += t.height + 14
    if (szene.get("balken") or "").strip():
        t = _balken(szene["balken"].strip())
        els.append(Element("text", t, (RAND, y)))
        y += t.height + 22
    fuss: list[Element] = []
    unten = H - 36
    kern = (szene.get("kernaussage") or "").strip()
    schritt = (szene.get("schrittText") or szene.get("schritt") or "").strip()
    if schritt or kern:
        if schritt and kern:
            k = _schritt_kasten(schritt, B // 2 - RAND)
            t = _text_ebene(kern, B // 2 - RAND - 40, 140, ROT, 92)
            hoehe = max(k.height, t.height)
            fuss += [Element("text", k, (RAND, unten - hoehe + (hoehe - k.height) // 2)), Element("text", t, (B // 2 + 20 + (B // 2 - RAND - 20 - t.width) // 2, unten - hoehe + (hoehe - t.height) // 2))]
        elif schritt:
            k = _schritt_kasten(schritt, B - 2 * RAND)
            hoehe = k.height
            fuss.append(Element("text", k, ((B - k.width) // 2, unten - hoehe)))
        else:
            t = _text_ebene(kern, B - 2 * RAND, 150, ROT, 100)
            hoehe = t.height
            fuss.append(Element("text", t, ((B - t.width) // 2, unten - hoehe)))
        unten -= hoehe + 18
    bereich = (RAND, y + 6, B - RAND, unten - 6)
    lay = layout_wahl(szene.get("layout"), len(motive))
    boxen = slots(lay, len(motive), bereich)
    for m, box in zip(motive, boxen):
        els.append(_einpassen(m, box))
    liste = [x.strip() for x in (szene.get("liste") or []) if str(x).strip()][:4]
    if lay == "figur-liste" and liste:
        x0 = bereich[0] + round((bereich[2] - bereich[0]) * 0.45)
        hoehe_liste = round((bereich[3] - bereich[1]) * (0.66 if len(motive) > 1 else 1.0))
        zh = max(60, min(130, hoehe_liste // max(1, len(liste))))
        for i, punkt in enumerate(liste):
            t = _text_ebene(punkt, bereich[2] - x0 - 70, zh - 10, SCHWARZ, min(84, zh - 16), zeilen=1, ausrichtung="links")
            img = Image.new("RGBA", (t.width + 70, max(t.height, 50)), (0, 0, 0, 0))
            d = ImageDraw.Draw(img)
            r = 15
            cy = img.height // 2
            d.ellipse((10, cy - r, 10 + 2 * r, cy + r), fill=ORANGE)
            img.alpha_composite(t, (60, (img.height - t.height) // 2))
            els.append(Element("punkt", img, (x0, bereich[1] + i * zh + (zh - img.height) // 2)))
    return els + fuss


def hintergrund(vorher: Image.Image | None) -> Image.Image:
    """Weiß; die vorige Szene bleibt mit 15 % als blasser Hintergrund stehen."""
    weiss = Image.new("RGB", (B, H), WEISS)
    return Image.blend(weiss, vorher.convert("RGB"), BLASS) if vorher is not None else weiss


def fertig(grund: Image.Image, els: list[Element]) -> Image.Image:
    bild = grund.convert("RGBA")
    for e in els:
        bild.alpha_composite(e.ebene, e.pos)
    return bild.convert("RGB")


def _einsetzen(bild: Image.Image, ebene: Image.Image, x: int, y: int) -> None:
    """alpha_composite, auch wenn die Ebene über den Rand hinausragt."""
    l, o = max(0, -x), max(0, -y)
    r, u = min(ebene.width, bild.width - x), min(ebene.height, bild.height - y)
    if r <= l or u <= o:
        return
    bild.alpha_composite(ebene.crop((l, o, r, u)), (x + l, y + o))


def animation(grund: Image.Image, els: list[Element], dauer: float, fps: int, hand: Image.Image | None, ordner: Path) -> tuple[list[tuple[str, float]], Image.Image]:
    """Aufdeck-Animation einer Szene: Elemente werden nacheinander von links nach rechts „aufgezeichnet“, die Hand mit
    Stift folgt der Kante. Nur die bewegten Bilder werden einzeln gespeichert; Standbilder bekommen eine Dauer
    (ffmpeg concat). Liefert (Bild, Dauer)-Liste und das fertige Szenenbild."""
    ordner.mkdir(parents=True, exist_ok=True)
    plan = [DAUER[e.art] for e in els]
    gesamt = sum(plan) + PAUSE * len(els) + 0.2
    faktor = min(1.0, (0.75 * dauer) / gesamt) if gesamt > 0 else 1.0
    liste: list[tuple[str, float]] = []
    bild = grund.convert("RGBA")
    zeit = 0.0

    def speichern(img: Image.Image, d: float) -> None:
        nonlocal zeit
        name = f"{len(liste):05d}.jpg"
        img.convert("RGB").save(ordner / name, quality=88)
        liste.append((name, d))
        zeit += d

    speichern(bild, max(1 / fps, 0.2 * faktor))
    for e, d in zip(els, plan):
        k = max(2, round(d * faktor * fps))
        for j in range(k):
            p = (j + 1) / k
            rahmen = bild.copy()
            breite = max(1, round(e.ebene.width * p))
            rahmen.alpha_composite(e.ebene.crop((0, 0, breite, e.ebene.height)), e.pos)
            if hand is not None and j < k - 1:
                spitze_x = e.pos[0] + breite
                spitze_y = e.pos[1] + e.ebene.height * (0.5 + 0.32 * math.sin(j * 1.7))
                _einsetzen(rahmen, hand, round(spitze_x - hand.width * 0.04), round(spitze_y - hand.height * 0.04))
            speichern(rahmen, 1 / fps)
        bild.alpha_composite(e.ebene, e.pos)
        speichern(bild, max(1 / fps, PAUSE * faktor))
    rest = dauer - zeit
    if rest > 0:
        name, d = liste[-1]
        liste[-1] = (name, d + rest)
    return liste, bild.convert("RGB")


def uebersicht(bilder: list[tuple[int, Image.Image, str]], ziel: Path, spalten: int = 4) -> None:
    """Szenen-Übersicht zur Freigabe: alle fertigen Szenen als Raster mit Nummer und Motiv-Schlüsseln."""
    tw, th, leiste = 480, 270, 40
    zeilen = max(1, math.ceil(len(bilder) / spalten))
    img = Image.new("RGB", (spalten * tw + (spalten + 1) * 10, zeilen * (th + leiste) + (zeilen + 1) * 10), (238, 238, 238))
    d = ImageDraw.Draw(img)
    f = anton(24)
    for i, (nr, b, text) in enumerate(bilder):
        x = 10 + (i % spalten) * (tw + 10)
        y = 10 + (i // spalten) * (th + leiste + 10)
        img.paste(b.convert("RGB").resize((tw, th), Image.LANCZOS), (x, y))
        d.rectangle((x, y, x + tw - 1, y + th - 1), outline=(180, 180, 180), width=1)
        d.text((x + 4, y + th + 6), f"Szene {nr}: {text}"[:60], font=f, fill=SCHWARZ)
    ziel.parent.mkdir(parents=True, exist_ok=True)
    tmp = io.BytesIO()
    img.save(tmp, "JPEG", quality=85)
    schreiben_atomar(ziel, tmp.getvalue())


def png_aus_b64(b64: str) -> bytes:
    return base64.b64decode(b64)
