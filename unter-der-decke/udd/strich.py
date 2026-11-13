"""Echtes Zeichnen (Whiteboard): Motive vektorisieren und Strich für Strich animieren.

1. Vektorisieren (einmal je Motiv, Ergebnis in der Kanal-Bibliothek): Die Konturen (dunkle, ungesättigte Pixel) werden auf
   ihre Mittellinie verdünnt (Zhang-Suen) und zu Pfaden verbunden – je Linie EIN Pfad. potrace/vtracer liefern dagegen
   die Umrisse einer Linie (jede Linie doppelt, links und rechts) und taugen nicht zum Nachzeichnen. Pfade werden
   vereinfacht (Ramer-Douglas-Peucker) und in Zeichenreihenfolge gebracht (nächster Anfang zuerst, ggf. umgedreht).
   Hat ein Motiv keine dunklen Konturen, wird sein Umriss gezeichnet.
2. Animieren: Ein Pinsel in Linienbreite fährt die Pfade ab (wie stroke-dashoffset) und legt dabei die echten Linien des
   Motivs frei; zwischen zwei Pfaden hebt der Stift ab und fährt schneller weiter. Danach werden Farbe/Flächen kurz
   eingeblendet. Die Stiftspitze (für die Hand) ist immer der aktuelle Endpunkt des Strichs.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageDraw

VERSION = "s1"  # ändert sich der Algorithmus, werden die Pfade neu berechnet
ARBEIT = 512  # Rechengröße (längste Seite) für die Verdünnung
FARBE_S = 0.35  # Farbe/Flächen nach dem letzten Strich einblenden
FAHRT = 3.0  # Stift ohne Zeichnen ist so viel schneller


# ---- Vektorisieren -----------------------------------------------------------------------------------------------------


def tinte(img: Image.Image) -> np.ndarray:
    """Weiche Konturmaske 0..1: dunkle, ungesättigte, sichtbare Pixel (schwarze/graue Linien, nicht dunkelblaue Flächen)."""
    a = np.asarray(img.convert("RGBA"), dtype=np.float32)
    rgb, alpha = a[..., :3], a[..., 3] / 255.0
    hell = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    satt = rgb.max(axis=2) - rgb.min(axis=2)
    return alpha * np.clip((115.0 - hell) / 50.0, 0, 1) * np.clip((85.0 - satt) / 40.0, 0, 1)


def _nachbarn(b: np.ndarray) -> list[np.ndarray]:
    p = np.pad(b, 1)
    return [p[:-2, 1:-1], p[:-2, 2:], p[1:-1, 2:], p[2:, 2:], p[2:, 1:-1], p[2:, :-2], p[1:-1, :-2], p[:-2, :-2]]  # p2..p9


def verduennen(b: np.ndarray) -> np.ndarray:
    """Zhang-Suen-Verdünnung (Mittellinie, 1 Pixel breit), vektorisiert."""
    img = b.astype(np.uint8).copy()
    for _ in range(200):
        geaendert = False
        for schritt in (0, 1):
            p2, p3, p4, p5, p6, p7, p8, p9 = _nachbarn(img)
            summe = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
            folge = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
            wechsel = sum(((folge[i] == 0) & (folge[i + 1] == 1)).astype(np.uint8) for i in range(8))
            c1, c2 = (p2 * p4 * p6, p4 * p6 * p8) if schritt == 0 else (p2 * p4 * p8, p2 * p6 * p8)
            weg = (img == 1) & (summe >= 2) & (summe <= 6) & (wechsel == 1) & (c1 == 0) & (c2 == 0)
            if weg.any():
                img[weg] = 0
                geaendert = True
        if not geaendert:
            break
    return img.astype(bool)


def _abstand(b: np.ndarray) -> np.ndarray:
    """Abstand zum Rand in Pixeln (durch wiederholtes Erodieren) – daraus die Linienbreite je Mittellinien-Pixel."""
    d = np.zeros(b.shape, dtype=np.float32)
    akt = b.copy()
    k = 0
    while akt.any() and k < 80:
        k += 1
        d[akt] = k
        p = np.pad(akt, 1)
        akt = akt & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
    return d


def _rdp(pts: list[tuple[float, float]], eps: float) -> list[tuple[float, float]]:
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0]), np.array(pts[-1])
    ab = b - a
    n = math.hypot(*ab)
    arr = np.array(pts)
    rel = arr - a
    d = np.abs(ab[0] * rel[:, 1] - ab[1] * rel[:, 0]) / n if n > 1e-9 else np.hypot(rel[:, 0], rel[:, 1])
    i = int(np.argmax(d))
    if d[i] <= eps:
        return [pts[0], pts[-1]]
    return _rdp(pts[: i + 1], eps)[:-1] + _rdp(pts[i:], eps)


RICHTUNGEN = [(-1, 0), (0, 1), (1, 0), (0, -1), (-1, 1), (1, 1), (1, -1), (-1, -1)]  # gerade zuerst


def _pfade(skelett: np.ndarray) -> list[list[tuple[int, int]]]:
    """Mittellinien-Pixel zu Pfaden verbinden: von Endpunkten aus, dann übrige (geschlossene) Linien; bei Abzweigungen
    geradeaus bevorzugt. Liefert Punktlisten (x, y)."""
    pix = {(int(y), int(x)) for y, x in zip(*np.nonzero(skelett))}
    if not pix:
        return []

    def nb(p):
        return [(p[0] + dy, p[1] + dx) for dy, dx in RICHTUNGEN if (p[0] + dy, p[1] + dx) in pix]

    grad = {p: len(nb(p)) for p in pix}
    besucht: set[tuple[int, int]] = set()
    pfade: list[list[tuple[int, int]]] = []

    def gehen(start):
        pfad = [start]
        besucht.add(start)
        richtung = None
        akt = start
        while True:
            frei = [q for q in nb(akt) if q not in besucht]
            if not frei:
                # an eine schon gezeichnete Abzweigung anschließen (keine Lücke im Strich)
                zu = [q for q in nb(akt) if q in besucht and q != (pfad[-2] if len(pfad) > 1 else None) and grad[q] >= 3]
                if zu and len(pfad) > 1:
                    pfad.append(zu[0])
                return pfad
            if richtung is None:
                nxt = frei[0]
            else:
                nxt = max(frei, key=lambda q: (q[0] - akt[0]) * richtung[0] + (q[1] - akt[1]) * richtung[1])
            richtung = (nxt[0] - akt[0], nxt[1] - akt[1])
            besucht.add(nxt)
            pfad.append(nxt)
            akt = nxt

    for p in sorted((p for p in pix if grad[p] == 1), key=lambda p: (p[0] + p[1], p)):
        if p not in besucht:
            pfade.append(gehen(p))
    for p in sorted(pix, key=lambda p: (p[0] + p[1], p)):
        if p not in besucht:
            pf = gehen(p)
            # geschlossene Linie: zurück zum Anfang
            if len(pf) > 2 and max(abs(pf[-1][0] - p[0]), abs(pf[-1][1] - p[1])) <= 1:
                pf.append(p)
            pfade.append(pf)
    return [[(x, y) for y, x in pf] for pf in pfade]


def _laenge(pts) -> float:
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))


def _reihenfolge(striche: list[dict]) -> list[dict]:
    """Zeichenreihenfolge: oben links beginnen, dann immer der nächstgelegene Strichanfang (Strich ggf. umgedreht)."""
    rest = list(striche)
    if not rest:
        return []
    pos = (0.0, 0.0)
    out = []
    while rest:
        best, umd, dist = 0, False, float("inf")
        for i, s in enumerate(rest):
            for u, pt in ((False, s["p"][0]), (True, s["p"][-1])):
                d = math.hypot(pt[0] - pos[0], pt[1] - pos[1])
                if d < dist:
                    best, umd, dist = i, u, d
        s = rest.pop(best)
        if umd:
            s = {**s, "p": s["p"][::-1]}
        out.append(s)
        pos = tuple(s["p"][-1])
    return out


def vektorisieren(img: Image.Image) -> dict:
    """Pfade eines Motivs in Motiv-Pixeln: {"v", "w", "h", "striche": [{"p": [[x, y], …], "b": Pinselbreite}], "umriss"}.
    „umriss“ = true, wenn das Motiv keine Konturen hat und sein Umriss gezeichnet wird."""
    img = img.convert("RGBA")
    w, h = img.size
    f = min(1.0, ARBEIT / max(w, h))
    klein = img.resize((max(1, round(w * f)), max(1, round(h * f))), Image.LANCZOS) if f < 1 else img
    t = tinte(klein) > 0.5
    deckend = np.asarray(klein.getchannel("A")) > 128
    umriss = False
    if t.sum() < max(30, 0.003 * deckend.sum()):
        # keine dunklen Konturen: Umriss der Fläche zeichnen (3 px breit)
        innen = deckend.copy()
        for _ in range(3):
            p = np.pad(innen, 1)
            innen = innen & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
        t = deckend & ~innen
        umriss = True
    abst = _abstand(t)
    skel = verduennen(t)
    striche = []
    for pf in _pfade(skel):
        if len(pf) < 2 or _laenge(pf) < 4:
            continue
        dicke = sorted(float(2 * abst[y, x] - 1) for x, y in pf)
        b = float(dicke[min(len(dicke) - 1, int(len(dicke) * 0.9))] * 1.2 + 2.5)
        pts = _rdp([(float(x), float(y)) for x, y in pf], 0.7)
        striche.append({"p": [[round(x / f, 1), round(y / f, 1)] for x, y in pts], "b": round(b / f, 1)})
    return {"v": VERSION, "w": w, "h": h, "striche": _reihenfolge(striche), "umriss": umriss}


def svg(daten: dict) -> str:
    """Pfade als SVG (zum Ansehen/Prüfen; schwarze Striche in Pinselbreite)."""
    teile = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {daten["w"]} {daten["h"]}" fill="none" stroke="#181818" stroke-linecap="round" stroke-linejoin="round">']
    for s in daten["striche"]:
        teile.append(f'<polyline stroke-width="{s["b"]}" points="{" ".join(f"{x},{y}" for x, y in s["p"])}"/>')
    teile.append("</svg>")
    return "\n".join(teile)


def laden(text: str) -> dict | None:
    try:
        d = json.loads(text)
        return d if isinstance(d, dict) and d.get("v") == VERSION else None
    except ValueError:
        return None


# ---- Animieren ---------------------------------------------------------------------------------------------------------


@dataclass
class Zeichner:
    """Strich-für-Strich-Animation eines Motivs in seiner Bildgröße (Element-Ebene). zustand(p) liefert die Ebene beim
    Fortschritt p (0..1) und die Stiftspitze in Ebenen-Koordinaten (None, sobald nur noch Farbe eingeblendet wird)."""

    ebene: Image.Image
    daten: dict
    farbe_anteil: float = 0.15
    _maske: Image.Image = field(init=False)
    _tinte: Image.Image = field(init=False)
    _plan: list = field(init=False)
    _gesamt: float = field(init=False)
    _bis: float = field(init=False, default=0.0)

    def __post_init__(self) -> None:
        self.ebene = self.ebene.convert("RGBA")
        sx = self.ebene.width / max(1, self.daten["w"])
        sy = self.ebene.height / max(1, self.daten["h"])
        if self.daten.get("umriss"):
            # synthetischer schwarzer Umriss (Motiv ohne Konturen)
            maske = Image.new("L", self.ebene.size, 0)
            d = ImageDraw.Draw(maske)
            for s in self.daten["striche"]:
                d.line([(x * sx, y * sy) for x, y in s["p"]], fill=255, width=max(2, round(s["b"] * sx * 0.6)), joint="curve")
            self._tinte = Image.new("RGBA", self.ebene.size, (24, 24, 24, 0))
            self._tinte.putalpha(maske)
        else:
            weich = (tinte(self.ebene) * 255).astype(np.uint8)
            self._tinte = self.ebene.copy()
            self._tinte.putalpha(Image.fromarray(weich))
        self._maske = Image.new("L", self.ebene.size, 0)
        # Zeitplan: Strecken mit Stift (zeichnen) und ohne (Fahrt zum nächsten Anfang, schneller)
        self._plan = []
        pos = None
        t = 0.0
        for s in self.daten["striche"]:
            pts = [(x * sx, y * sy) for x, y in s["p"]]
            b = max(2.0, s["b"] * sx)
            if pos is not None:
                fahrt = math.hypot(pts[0][0] - pos[0], pts[0][1] - pos[1]) / FAHRT
                self._plan.append(("fahrt", t, t + fahrt, [pos, pts[0]], b))
                t += fahrt
            for a, c in zip(pts, pts[1:]):
                seg = math.hypot(c[0] - a[0], c[1] - a[1])
                self._plan.append(("strich", t, t + seg, [a, c], b))
                t += seg
            pos = pts[-1]
        self._gesamt = max(t, 1e-6)

    @property
    def laenge(self) -> float:
        return self._gesamt

    def _bis_strecke(self, ziel: float) -> tuple[float, float] | None:
        """Maske bis zur Strecke „ziel“ fortschreiben (nur neue Stücke) und die Stiftspitze liefern."""
        d = ImageDraw.Draw(self._maske)
        spitze = None
        for art, a, b, (p0, p1), breite in self._plan:
            if a > ziel:
                break
            q = 1.0 if b <= a else min(1.0, (ziel - a) / (b - a))
            pe = (p0[0] + (p1[0] - p0[0]) * q, p0[1] + (p1[1] - p0[1]) * q)
            spitze = pe
            if art == "strich" and b > self._bis:
                qa = 0.0 if b <= a else max(0.0, (self._bis - a) / (b - a))
                ps = (p0[0] + (p1[0] - p0[0]) * qa, p0[1] + (p1[1] - p0[1]) * qa)
                r = breite / 2
                d.line([ps, pe], fill=255, width=max(1, round(breite)))
                d.ellipse((pe[0] - r, pe[1] - r, pe[0] + r, pe[1] + r), fill=255)
                d.ellipse((ps[0] - r, ps[1] - r, ps[0] + r, ps[1] + r), fill=255)
        self._bis = max(self._bis, ziel)
        return spitze

    def zustand(self, p: float) -> tuple[Image.Image, tuple[float, float] | None]:
        p = max(0.0, min(1.0, p))
        fa = max(0.0, min(0.5, self.farbe_anteil))
        strich_p = 1.0 if fa >= 1 else min(1.0, p / (1 - fa))
        spitze = self._bis_strecke(strich_p * self._gesamt) if strich_p < 1 else None
        if strich_p >= 1 and self._bis < self._gesamt:
            self._bis_strecke(self._gesamt)
        sichtbar = self._tinte.copy()
        alpha = Image.fromarray((np.asarray(self._tinte.getchannel("A"), dtype=np.uint16) * np.asarray(self._maske, dtype=np.uint16) // 255).astype(np.uint8))
        sichtbar.putalpha(alpha)
        if strich_p < 1 or fa <= 0:
            return sichtbar, spitze
        c = min(1.0, (p - (1 - fa)) / fa) if fa > 0 else 1.0
        if c >= 1:
            return self.ebene.copy(), None
        farbe = self.ebene.copy()
        farbe.putalpha(farbe.getchannel("A").point(lambda v: round(v * c)))
        farbe.alpha_composite(sichtbar)
        return farbe, None
