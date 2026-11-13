"""Erzeugt grafik/hand.png (rechte Hand mit Filzstift, transparenter Hintergrund) und grafik/hand.json mit der
Stiftspitze als Ankerpunkt. Einmal ausführen: python grafik/hand_erzeugen.py – das Ergebnis liegt im Repository.
Eigene Hand verwenden: hand.png ersetzen (transparent, Stift zeigt nach oben links) und in hand.json die Pixel-Position
der Stiftspitze eintragen."""

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

K = 4  # Zeichnen in 4-facher Größe, dann verkleinern (glatte Kanten)
HAUT, HAUT_DUNKEL = (246, 206, 174, 255), (226, 176, 140, 255)
LINIE = (36, 28, 24, 255)
STIFT, KAPPE, SPITZE = (30, 30, 34, 255), (120, 124, 132, 255), (16, 16, 18, 255)
W = 14 * K // 4 * 3  # Umrisslinie

T = (40.0, 40.0)  # Stiftspitze (in Endgröße)
D = (math.cos(math.radians(40)), math.sin(math.radians(40)))  # Stift zeigt von der Spitze nach unten rechts
N = (-D[1], D[0])


def pt(u: float, v: float) -> tuple[float, float]:
    return ((T[0] + u * D[0] + v * N[0]) * K, (T[1] + u * D[1] + v * N[1]) * K)


def ellipse(u: float, v: float, lu: float, lv: float, dreh: float = 0.0, n: int = 72) -> list[tuple[float, float]]:
    c, s = math.cos(math.radians(dreh)), math.sin(math.radians(dreh))
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        x, y = lu / 2 * math.cos(a), lv / 2 * math.sin(a)
        out.append(pt(u + x * c - y * s, v + x * s + y * c))
    return out


def form(d: ImageDraw.ImageDraw, pts, farbe) -> None:
    d.polygon(pts, fill=farbe)
    d.line(pts + [pts[0]], fill=LINIE, width=W, joint="curve")


def main() -> None:
    gr = (520, 520)
    img = Image.new("RGBA", (gr[0] * K, gr[1] * K), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Stift zuerst (die Hand umgreift ihn): Spitze, Kappe, Schaft
    form(d, [pt(0, 0), pt(52, -17), pt(52, 17)], SPITZE)
    form(d, [pt(52, -21), pt(92, -23), pt(92, 23), pt(52, 21)], KAPPE)
    form(d, [pt(92, -23), pt(420, -23), pt(420, 23), pt(92, 23)], STIFT)
    # Arm/Handgelenk (läuft nach unten rechts aus dem Bild)
    form(d, [pt(360, -95), pt(700, -95), pt(700, 105), pt(360, 105)], HAUT)
    # Handrücken
    form(d, ellipse(370, 0, 300, 230, 8), HAUT)
    # Mittel-, Ring-, kleiner Finger eingerollt
    for u, v, l in ((300, 62, 120), (350, 92, 110), (400, 112, 96)):
        form(d, ellipse(u, v, l, 62, -25), HAUT_DUNKEL)
    # Daumen (links unter dem Stift) und Zeigefinger (oben auf dem Stift)
    form(d, ellipse(205, 40, 165, 64, -12), HAUT)
    form(d, ellipse(225, -36, 215, 62, 6), HAUT)
    d.line([pt(160, -40), pt(185, -44)], fill=LINIE, width=W // 2)  # Fingernagel angedeutet
    klein = img.resize(gr, Image.LANCZOS)
    box = klein.getchannel("A").getbbox()
    klein = klein.crop(box)
    ziel = Path(__file__).resolve().parent
    klein.save(ziel / "hand.png")
    spitze = [round(T[0] - box[0], 1), round(T[1] - box[1], 1)]
    (ziel / "hand.json").write_text(json.dumps({"spitze": spitze, "hinweis": "Pixel der Stiftspitze in hand.png"}, ensure_ascii=False) + "\n", encoding="utf-8")
    print("hand.png", klein.size, "Spitze", spitze)


if __name__ == "__main__":
    main()
