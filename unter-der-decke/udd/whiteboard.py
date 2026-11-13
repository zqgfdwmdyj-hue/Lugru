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
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

from . import strich
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

    def striche(self, key: str) -> dict | None:
        """Pfade zum Nachzeichnen (strich.vektorisieren), einmal je Motiv berechnet und neben dem PNG gespeichert
        (<key>.striche.json, zum Ansehen <key>.svg). Neu, wenn sich das Motiv (Hash) oder der Algorithmus ändert."""
        if not self.hat(key):
            return None
        merk = self.merkmal(key)
        pfad = self.ordner / f"{key}.striche.json"
        if pfad.exists():
            d = strich.laden(pfad.read_text(encoding="utf-8"))
            if d and d.get("hash") == merk:
                return d
        d = strich.vektorisieren(self.bild(key))
        d["hash"] = merk
        schreiben_atomar(pfad, json.dumps(d, separators=(",", ":")).encode("utf-8"))
        schreiben_atomar(self.ordner / f"{key}.svg", strich.svg(d).encode("utf-8"))
        return d

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


GRAFIK = Path(__file__).resolve().parent.parent / "grafik"


@dataclass
class Hand:
    """Hand mit Stift; spitze = Pixel der Stiftspitze im Bild (Ankerpunkt: liegt immer genau auf dem Strich-Endpunkt)."""

    bild: Image.Image
    spitze: tuple[float, float]

    def setzen(self, rahmen: Image.Image, x: float, y: float) -> None:
        _einsetzen(rahmen, self.bild, round(x - self.spitze[0]), round(y - self.spitze[1]))


def hand_laden(hoehe: int = 380) -> Hand:
    """Feste Hand aus grafik/hand.png (Foto, freigestellt, transparenter Hintergrund) mit der Stiftspitze aus
    grafik/hand.json. „hoehe“ = Höhe der Hand von der Stiftspitze bis zum Handrücken („hand_hoehe“ in hand.json);
    der Unterarm darüber hinaus läuft aus dem Bild. Fehlt die Datei, die gezeichnete Ersatz-Hand (Spitze bei 10/10)."""
    try:
        meta = json.loads((GRAFIK / "hand.json").read_text(encoding="utf-8"))
        img = Image.open(GRAFIK / "hand.png").convert("RGBA")
        sx, sy = (float(v) for v in meta["spitze"])
        bezug = float(meta.get("hand_hoehe") or 0)
    except (OSError, ValueError, KeyError, TypeError):
        img, sx, sy, bezug = hand_gezeichnet(), 10.0, 10.0, 0.0
    box = img.getchannel("A").getbbox() or (0, 0, img.width, img.height)
    img = img.crop(box)
    sx, sy = sx - box[0], sy - box[1]
    f = hoehe / max(1.0, bezug or img.height)
    return Hand(img.resize((max(1, round(img.width * f)), max(1, round(img.height * f))), Image.LANCZOS), (sx * f, sy * f))


# ---- Layout ----------------------------------------------------------------------------------------------------------


@dataclass
class Element:
    art: str  # text | motiv | punkt
    ebene: Image.Image  # RGBA, nur der Bereich des Elements
    pos: tuple[int, int]
    striche: dict | None = field(default=None, repr=False)  # Motiv: Pfade zum Nachzeichnen (strich.vektorisieren)

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
    # Höhe nach Schriftmaßen: die letzte Zeile braucht Ober- und Unterlänge (sonst wird z. B. das „p“ abgeschnitten)
    auf, ab = f.getmetrics() if hasattr(f, "getmetrics") else (hz, 0)
    img = Image.new("RGBA", (breite, hz * (len(z) - 1) + max(hz, auf + ab) + 8), (0, 0, 0, 0))
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


def elemente(szene: dict, motive: list[Image.Image], striche: list[dict | None] | None = None) -> list[Element]:
    """Alle Elemente einer Szene in Aufdeck-Reihenfolge: Kopf (Überschrift, roter Balken) → Motive → Liste → Fuß
    (Kernaussage rot, Schritt im Kasten). striche: je Motiv die Pfade zum Nachzeichnen (sonst Aufdecken von links)."""
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
    for i, (m, box) in enumerate(zip(motive, boxen)):
        e = _einpassen(m, box)
        e.striche = striche[i] if striche and i < len(striche) else None
        els.append(e)
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


# ---- B36.10 Tempo: Takt nach Wortzeiten, kurze Zeichenzeit, dauernde Bewegung -----------------------------------------

# Zeichenzeit je Motiv nach Kanalprofil „Tempo“ (nicht mehr auf die Szenenlänge gedehnt)
TEMPO = {"ruhig": 2.5, "normal": 2.0, "schnell": 1.5}
MAX_PAUSE = 3.0  # höchstens so lange ohne neues Ereignis (Motiv, Beschriftung, Hervorhebung)
ZIEL_PAUSE = 2.6  # Lücken darüber werden mit Hervorhebungen gefüllt
WISCH_S = 0.3  # Szenenwechsel (Wisch)
POP_S = 0.35  # Text-Pop
PUNKT_S = 0.6
HERVOR_S = 0.6
HERVOR_MAX = 6  # Hervorhebungen je Szene
FORMEN = ("unterstreichen", "kreis", "pfeil")
# Echtes Zeichnen: Zeichendauer je Motiv an die Sprache gekoppelt – bis kurz vor dem nächsten Element bzw. dem Sprechende
ZEICHNEN_ANTEIL = 0.92
ZEICHNEN_MIN = 1.2
ZEICHNEN_MAX = 7.0


def draw_s(tempo: str | None) -> float:
    return TEMPO.get(tempo or "normal", TEMPO["normal"])


def _norm(w: str) -> str:
    t = w.lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        t = t.replace(a, b)
    return re.sub(r"[^a-z0-9]", "", t)


def wortzeiten(text: str, alignment: dict | None) -> list[tuple[str, float]]:
    """Startzeit je Wort aus der Zeichen-Ausrichtung von ElevenLabs (characters + character_start_times_seconds).
    Ohne Ausrichtung: leere Liste (dann gleichmäßig verteilt)."""
    if not alignment:
        return []
    zeichen = alignment.get("characters") or []
    starts = alignment.get("character_start_times_seconds") or []
    if not zeichen or len(zeichen) != len(starts):
        return []
    out: list[tuple[str, float]] = []
    akt, t0 = "", None
    for c, t in zip(zeichen, starts):
        if c.isspace():
            if akt:
                out.append((_norm(akt), float(t0 or 0)))
            akt, t0 = "", None
        else:
            if not akt:
                t0 = t
            akt += c
    if akt:
        out.append((_norm(akt), float(t0 or 0)))
    return [(w, t) for w, t in out if w]


def sprech_grenzen(alignment: dict | None) -> tuple[float, float] | None:
    """Anfang des ersten und Ende des letzten gesprochenen Zeichens (ElevenLabs-Ausrichtung) – zum Kürzen der Stille."""
    if not alignment:
        return None
    zeichen = alignment.get("characters") or []
    starts = alignment.get("character_start_times_seconds") or []
    enden = alignment.get("character_end_times_seconds") or []
    if not zeichen or len(zeichen) != len(starts):
        return None
    idx = [i for i, c in enumerate(zeichen) if not str(c).isspace()]
    if not idx:
        return None
    a, b = idx[0], idx[-1]
    ende = float(enden[b]) if len(enden) == len(zeichen) else float(starts[b]) + 0.12
    return float(starts[a]), max(float(starts[a]) + 0.1, ende)


@dataclass
class Ereignis:
    start: float
    art: str  # text | motiv | punkt | hervorhebung
    index: int  # Element (bei Hervorhebung: das hervorgehobene Element)
    dauer: float
    form: str | None = None  # unterstreichen | kreis | pfeil


def _dauer(art: str, ds: float) -> float:
    return {"text": POP_S, "punkt": PUNKT_S, "motiv": ds}.get(art, HERVOR_S)


def _zeichendauern(ereignisse: list[Ereignis], ende: float, dauer: float, ds: float) -> None:
    """Zeichendauer je Motiv an die Sprechdauer koppeln: das Motiv wird gezeichnet, solange darüber gesprochen wird –
    bis kurz vor dem nächsten Element (bzw. dem Sprechende der Szene). Mindestens das Tempo des Kanals (ds·0,6, nie unter
    ZEICHNEN_MIN), höchstens ZEICHNEN_MAX; immer innerhalb der Szene."""
    haupt = sorted((e for e in ereignisse if e.art != "hervorhebung"), key=lambda e: e.start)
    unten = max(ZEICHNEN_MIN, ds * 0.6)
    for k, e in enumerate(haupt):
        if e.art != "motiv":
            continue
        naechster = next((x.start for x in haupt[k + 1 :] if x.start > e.start + 0.05), ende)
        d = min(ZEICHNEN_MAX, max(unten, (naechster - e.start) * ZEICHNEN_ANTEIL))
        e.dauer = round(max(0.5, min(d, dauer - e.start - 0.05)), 3)


def takt_plan(arten: list[str], woerter: list[str | None], dauer: float, ds: float, zeiten: list[tuple[str, float]]) -> tuple[list[Ereignis], dict]:
    """Zeitplan einer Szene: jedes Element beginnt, wenn sein Schlüsselwort gesprochen wird (Wortzeiten), sonst gleichmäßig
    verteilt. Lücken über ZIEL_PAUSE werden mit Hervorhebungen (unterstreichen, einkreisen, Pfeil) gefüllt.
    Liefert Ereignisse und Kennzahlen {ereignisse, maxPause, mittel, hervorhebungen, drawS}."""
    n = len(arten)
    ende = max(dauer - 0.25, WISCH_S + 0.1)
    gewuenscht: list[float | None] = [None] * n
    pos = 0
    for i, w in enumerate(woerter):
        if not w or not zeiten:
            continue
        nw = _norm(w.split()[0]) if w.split() else ""
        for j in range(pos, len(zeiten)):
            if nw and (zeiten[j][0] == nw or (len(nw) >= 4 and zeiten[j][0].startswith(nw[:max(4, len(nw) - 2)]))):
                gewuenscht[i] = zeiten[j][1]
                pos = j + 1
                break
    # Kopf-Texte (Überschrift/Balken) gleich zu Beginn, wenn kein Wort zugeordnet ist
    if n and gewuenscht[0] is None and arten[0] == "text":
        gewuenscht[0] = WISCH_S
    # Lücken ohne Zeit gleichmäßig zwischen bekannte Nachbarn verteilen
    starts: list[float] = [0.0] * n
    i = 0
    while i < n:
        if gewuenscht[i] is not None:
            starts[i] = float(gewuenscht[i])
            i += 1
            continue
        j = i
        while j < n and gewuenscht[j] is None:
            j += 1
        links = starts[i - 1] if i > 0 else WISCH_S
        rechts = float(gewuenscht[j]) if j < n else ende
        m = j - i
        for k in range(m):
            # mit Vorgänger: zwischen beide Anker; am Szenenanfang: erstes Element gleich zu Beginn
            anteil = (k + 1) / (m + 1) if i > 0 else k / m
            starts[i + k] = links + (rechts - links) * anteil
        i = j
    # Reihenfolge halten, mindestens 0,5 s Abstand, nicht über das Szenenende
    for k in range(n):
        lo = WISCH_S if k == 0 else starts[k - 1] + 0.5
        starts[k] = min(max(starts[k], lo), max(lo, ende - 0.3))
    ereignisse = [Ereignis(round(s, 3), a, k, _dauer(a, ds)) for k, (s, a) in enumerate(zip(starts, arten))]
    _zeichendauern(ereignisse, ende, dauer, ds)
    # Lücken füllen: Stillstand = Zeit, in der nichts gezeichnet wird (nach dem Wisch, zwischen Ende und nächstem Start).
    # Hervorhebung bereits gezeichneter Elemente (Texte unterstreichen, Motive einkreisen/Pfeil); steht noch nichts im Bild
    # (Szenenanfang), kommt das nächste Element früher – lieber etwas vor seinem Wort als Stillstand.
    hervor = 0
    for _runde in range(HERVOR_MAX + n + 2):
        groesse, a, b = max(stillstand(ereignisse, dauer), default=(0.0, 0.0, 0.0))
        if groesse <= ZIEL_PAUSE:
            break
        fertige = [e for e in ereignisse if e.art != "hervorhebung" and e.start + e.dauer <= a + 1e-6]
        if not fertige:
            folgende = [e for e in ereignisse if e.art != "hervorhebung" and e.start >= b - 1e-6]
            if not folgende:
                break
            erstes = min(folgende, key=lambda e: e.start)
            erstes.start = round(a + min(1.0, groesse / 2), 3)
            _zeichendauern(ereignisse, ende, dauer, ds)
            continue
        if hervor >= HERVOR_MAX:
            break
        t = a + max(0.0, (groesse - HERVOR_S) / 2)
        ziel = fertige[hervor % len(fertige)]
        form = "unterstreichen" if ziel.art in ("text", "punkt") else FORMEN[1 + hervor % 2]
        ereignisse.append(Ereignis(round(t, 3), "hervorhebung", ziel.index, HERVOR_S, form))
        hervor += 1
    ereignisse.sort(key=lambda e: e.start)
    max_pause = max((g for g, _a, _b in stillstand(ereignisse, dauer)), default=0.0)
    motive = [e.dauer for e in ereignisse if e.art == "motiv"]
    kenn = {"ereignisse": len(ereignisse), "maxPause": round(max_pause, 2), "mittel": round(dauer / max(1, len(ereignisse)), 2), "hervorhebungen": hervor, "drawS": ds, "zeichnenS": round(sum(motive) / len(motive), 2) if motive else 0}
    return ereignisse, kenn


def stillstand(ereignisse: list[Ereignis], dauer: float) -> list[tuple[float, float, float]]:
    """Zeiträume ohne Bewegung (Länge, von, bis): weder Wisch (erste 0,3 s) noch ein laufendes Ereignis."""
    bewegt = sorted([(0.0, WISCH_S)] + [(e.start, min(dauer, e.start + e.dauer)) for e in ereignisse])
    out: list[tuple[float, float, float]] = []
    ende = 0.0
    for a, b in bewegt:
        if a > ende + 1e-6:
            out.append((round(a - ende, 3), ende, a))
        ende = max(ende, b)
    if dauer > ende + 1e-6:
        out.append((round(dauer - ende, 3), ende, dauer))
    return out


def _pop(e: Element, p: float) -> tuple[Image.Image, tuple[int, int]]:
    """Text-Pop: wächst von 60 % auf 100 % (leichtes Überschwingen) und wird dabei sichtbar."""
    s = 0.6 + 0.4 * p + 0.08 * math.sin(math.pi * p)
    w, h = max(1, round(e.ebene.width * s)), max(1, round(e.ebene.height * s))
    img = e.ebene.resize((w, h), Image.BILINEAR)
    if p < 1:
        a = img.getchannel("A").point(lambda v: round(v * min(1.0, 0.3 + p)))
        img.putalpha(a)
    cx, cy = e.pos[0] + e.ebene.width / 2, e.pos[1] + e.ebene.height / 2
    return img, (round(cx - w / 2), round(cy - h / 2))


def _hervorhebung(bild: Image.Image, e: Element, form: str, p: float) -> tuple[int, int]:
    """Zeichnet die Hervorhebung bis Fortschritt p ins Bild; liefert die Stiftspitze (für die Hand)."""
    d = ImageDraw.Draw(bild)
    x0, y0, x1, y1 = e.box
    farbe = ROT + (255,)
    if form == "unterstreichen":
        y = min(bild.height - 8, y1 + 6)
        xe = x0 + (x1 - x0) * p
        d.line((x0, y, xe, y), fill=farbe, width=9)
        return round(xe), y
    if form == "kreis":
        rand = 14
        box = (x0 - rand, y0 - rand, x1 + rand, y1 + rand)
        d.arc(box, start=-90, end=-90 + 360 * p, fill=farbe, width=8)
        winkel = math.radians(-90 + 360 * p)
        cx, cy, rx, ry = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2, (box[2] - box[0]) / 2, (box[3] - box[1]) / 2
        return round(cx + rx * math.cos(winkel)), round(cy + ry * math.sin(winkel))
    # Pfeil von unten links auf das Motiv
    sx, sy = x0 - 110, y1 + 70
    zx, zy = x0 + (x1 - x0) * 0.2, y1 - (y1 - y0) * 0.2
    ex, ey = sx + (zx - sx) * p, sy + (zy - sy) * p
    d.line((sx, sy, ex, ey), fill=farbe, width=9)
    if p >= 0.98:
        ang = math.atan2(zy - sy, zx - sx)
        for da in (2.6, -2.6):
            d.line((zx, zy, zx + 34 * math.cos(ang + da), zy + 34 * math.sin(ang + da)), fill=farbe, width=9)
    return round(ex), round(ey)


def _zeichnen(bild: Image.Image, e: Element, p: float) -> tuple[int, int]:
    breite = max(1, round(e.ebene.width * p))
    bild.alpha_composite(e.ebene.crop((0, 0, breite, e.ebene.height)), e.pos)
    return e.pos[0] + breite, round(e.pos[1] + e.ebene.height * 0.5)


def animation_takt(grund: Image.Image, els: list[Element], ereignisse: list[Ereignis], dauer: float, fps: int, hand: Hand | Image.Image | None, ordner: Path, vorher: Image.Image | None = None) -> tuple[list[tuple[str, float]], Image.Image]:
    """B36.10: Szene nach Zeitplan – Wisch vom vorigen Szenenbild (0,3 s), Motive Strich für Strich gezeichnet (Pfade aus
    strich.vektorisieren, danach Farbe kurz eingeblendet; ohne Pfade von links aufgedeckt), Texte mit Pop, Hervorhebungen
    (unterstreichen, einkreisen, Pfeil). Die Hand sitzt mit der Stiftspitze genau auf dem aktuellen Strich-Endpunkt.
    Mehrere Ereignisse dürfen sich überlappen. Nur bewegte Bilder werden einzeln gespeichert, Standbilder bekommen eine
    Dauer (ffmpeg concat); den sanften Zoom legt ffmpeg beim Clip darüber. Liefert (Bild, Dauer)-Liste und das fertige
    Szenenbild (mit Hervorhebungen)."""
    ordner.mkdir(parents=True, exist_ok=True)
    if isinstance(hand, Image.Image):  # alte Aufrufer: Spitze bei 4 %/4 %
        hand = Hand(hand, (hand.width * 0.04, hand.height * 0.04))
    zeichner: dict[int, strich.Zeichner] = {}
    schritt = 1 / max(1, fps)
    # Zeitpunkte mit Bewegung: Wisch + jedes Ereignis über seine Dauer
    aktiv: list[tuple[float, float]] = [(0.0, WISCH_S)] if vorher is not None else []
    aktiv += [(e.start, e.start + e.dauer) for e in ereignisse]
    zeiten: set[float] = {0.0}
    for a, b in aktiv:
        t = a
        while t < b - 1e-6:
            zeiten.add(round(t, 4))
            t += schritt
        zeiten.add(round(min(b, dauer), 4))
    zeitpunkte = sorted(z for z in zeiten if z < dauer)
    weiss = grund.convert("RGBA")
    vorher_rgba = vorher.convert("RGBA") if vorher is not None else None
    liste: list[tuple[str, float]] = []
    for k, t in enumerate(zeitpunkte):
        rahmen = weiss.copy()
        spitze = None
        # fertige Elemente / laufende Ereignisse in Startreihenfolge
        for e in ereignisse:
            if e.start > t:
                continue
            p = min(1.0, (t - e.start) / e.dauer) if e.dauer > 0 else 1.0
            el = els[e.index] if 0 <= e.index < len(els) else None
            if el is None:
                continue
            if e.art == "hervorhebung":
                pkt = _hervorhebung(rahmen, el, e.form or "kreis", p)
                if p < 1:
                    spitze = pkt
            elif e.art == "text" and p < 1:
                img, xy = _pop(el, p)
                _einsetzen(rahmen, img, *xy)
            elif p < 1 and e.art == "motiv" and el.striche and el.striche.get("striche"):
                z = zeichner.get(id(e))
                if z is None:
                    z = zeichner[id(e)] = strich.Zeichner(el.ebene, el.striche, farbe_anteil=min(0.4, strich.FARBE_S / max(0.5, e.dauer)))
                ebene, sp = z.zustand(p)
                rahmen.alpha_composite(ebene, el.pos)
                if sp is not None:
                    spitze = (el.pos[0] + sp[0], el.pos[1] + sp[1])
            elif p < 1:
                spitze = _zeichnen(rahmen, el, p)
            else:
                rahmen.alpha_composite(el.ebene, el.pos)
        if vorher_rgba is not None and t < WISCH_S:
            # Wisch: links schon die neue Szene, rechts noch die vorige, harte Kante mit kurzem Schatten
            bw, bh = rahmen.size
            kante = round(bw * t / WISCH_S)
            if kante < bw:
                rahmen.paste(vorher_rgba.crop((kante, 0, bw, bh)), (kante, 0))
        if hand is not None and spitze is not None:
            hand.setzen(rahmen, *spitze)
        d = (zeitpunkte[k + 1] if k + 1 < len(zeitpunkte) else dauer) - t
        name = f"{len(liste):05d}.jpg"
        rahmen.convert("RGB").save(ordner / name, quality=88)
        liste.append((name, max(d, 1 / fps)))
    return liste, fertig_takt(grund, els, ereignisse)


def fertig_takt(grund: Image.Image, els: list[Element], ereignisse: list[Ereignis]) -> Image.Image:
    """Fertiges Szenenbild nach dem Zeitplan: alle Elemente + Hervorhebungen (blasser Hintergrund der nächsten Szene)."""
    bild = grund.convert("RGBA")
    for e in ereignisse:
        el = els[e.index] if 0 <= e.index < len(els) else None
        if el is None:
            continue
        if e.art == "hervorhebung":
            _hervorhebung(bild, el, e.form or "kreis", 1.0)
        else:
            bild.alpha_composite(el.ebene, el.pos)
    return bild.convert("RGB")


def element_woerter(szene: dict, els: list[Element]) -> list[str | None]:
    """Schlüsselwort je Element (Aufdeck-Reihenfolge wie in elemente()): Motive aus motive[].wort, Texte ohne Wort
    (Kopftexte gleich zu Beginn, Fußtexte gleichmäßig verteilt)."""
    worte = [m.get("wort") for m in (szene.get("motive") or [])]
    out: list[str | None] = []
    mi = 0
    for e in els:
        if e.art == "motiv":
            out.append(worte[mi] if mi < len(worte) else None)
            mi += 1
        else:
            out.append(None)
    return out


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
