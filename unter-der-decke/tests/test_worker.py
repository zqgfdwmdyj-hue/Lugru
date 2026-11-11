"""Unit-Tests für den Worker (ohne Netz): Filter, state.json, Untertitel, Kapitel, Skriptprüfung, Bilder, ffmpeg-Clip."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from udd import medien  # noqa: E402
from udd.filter import ERSATZ_BILDIDEE, bild_treffer, titel_treffer  # noqa: E402
from udd.ki import json_aus  # noqa: E402
from udd.projekt import Projekt, aufraeumen, kurz_hash  # noqa: E402
from udd.schritte import LAENGE_STANDARD, Lauf, skript_pruefen, woerter  # noqa: E402


def test_filter_titel_erlaubt_thema_sperrt_explizit():
    assert titel_treffer("Kein Sex mehr in der Beziehung? 5 Gründe") is None
    assert titel_treffer("Nackt im Urlaub") == "nackt"
    assert titel_treffer("Die Wahrheit über PORNO-Konsum") == "porno"


def test_filter_bild_streng_und_umlaute():
    assert bild_treffer("Zwei Kaffeetassen auf einem Tisch", streng=True) is None
    assert bild_treffer("Paar im Schlafzimmer", streng=False) is None
    assert bild_treffer("Paar im Schlafzimmer", streng=True) == "schlafzimmer"
    assert bild_treffer("zärtliche Berührung", streng=True) in ("beruehr", "zaertlich")
    assert bild_treffer("Frau in Unterwäsche", streng=False) == "unterwaesche"
    assert "keine Personen" in ERSATZ_BILDIDEE


def test_filter_gleiche_liste_wie_seller_system():
    daten = json.loads((Path(__file__).resolve().parent.parent / "filter.json").read_text(encoding="utf-8"))
    assert {"titel", "bild", "bild_streng", "ersatz_bildidee"} <= set(daten)


def test_state_json_ueberlebt_neustart(tmp_path: Path):
    p = Projekt(tmp_path, "testkanal", "11111111-1111-1111-1111-111111111111")
    (p.ordner / "voice").mkdir()
    (p.ordner / "voice" / "001.mp3").write_bytes(b"x")
    p.datei_merken("voice", "abc", "voice/001.mp3", dauer=3.2)
    p.markieren("research", gliederung={"punkte": []}, quellen=[])
    p2 = Projekt(tmp_path, "testkanal", "11111111-1111-1111-1111-111111111111")
    assert p2.erledigt("research")
    assert p2.datei_vorhanden("voice", "abc") is not None
    assert p2.datei_vorhanden("voice", "fehlt") is None
    # Datei weg → gilt nicht mehr als vorhanden (wird neu erzeugt)
    (p.ordner / "voice" / "001.mp3").unlink()
    assert p2.datei_vorhanden("voice", "abc") is None


def test_hash_haengt_am_inhalt():
    assert kurz_hash("stimme", "Text A") == kurz_hash("stimme", "Text A")
    assert kurz_hash("stimme", "Text A") != kurz_hash("stimme", "Text B")


def test_aufraeumen_freigegeben_und_alt(tmp_path: Path):
    for i in ("a" * 8, "b" * 8, "c" * 8):
        Projekt(tmp_path, "k", i).speichern()
    alt = tmp_path / "k" / ("c" * 8) / "state.json"
    t = time.time() - 20 * 86400
    import os

    os.utime(alt, (t, t))
    weg = aufraeumen(tmp_path, ["a" * 8, "unbekannt"], 14, laeuft="b" * 8)
    assert set(weg) == {"a" * 8, "c" * 8, "unbekannt"}
    assert (tmp_path / "k" / ("b" * 8)).exists()


def test_untertitel_teilen_und_srt():
    teile = medien.untertitel_teile("Das ist ein Satz. Und hier kommt ein zweiter, etwas längerer Satz mit vielen Wörtern darin!", 10.0, max_woerter=6)
    assert len(teile) >= 3
    assert teile[0][0] == 0.0 and abs(teile[-1][1] - 10.0) < 1e-6
    s = medien.srt(teile, versatz=61.5)
    assert s.startswith("1\n00:01:01,500 --> ")


def test_kapitel_youtube_regeln():
    szenen = [{"abschnitt": "hook", "dauer": 8}, {"abschnitt": "angst", "dauer": 20}] + [{"abschnitt": f"punkt-{i}", "dauer": 60} for i in range(1, 6)] + [{"abschnitt": "zusammenfassung", "dauer": 30}, {"abschnitt": "cta", "dauer": 5}]
    k = medien.kapitel(szenen, {"intro": "Intro", "punkt-1": "1. Stress", "zusammenfassung": "Zusammenfassung"})
    assert k[0] == {"start": 0, "titel": "Intro"}
    assert k[1]["titel"] == "1. Stress" and k[1]["start"] == 28
    assert k[-1]["titel"] == "Zusammenfassung"
    assert len(k) == 7
    assert medien.kapitel_text(k).splitlines()[1] == "0:28 1. Stress"


def test_skript_pruefen():
    quellen = [{"id": "Q1"}, {"id": "Q2"}]
    text = " ".join(["Wort"] * 64)
    szenen = [{"abschnitt": "hook", "text": text, "quelle_ids": []}] + [{"abschnitt": f"punkt-{i % 5 + 1}", "text": text, "quelle_ids": ["Q1"]} for i in range(23)]
    assert woerter(text) == 64
    ziel_kurz = [1450, 1750]  # Kanal mit 10–12 Min.
    assert skript_pruefen(szenen, quellen, ziel_kurz) == []
    # Standard 16–20 Min. (2.300–2.900 Wörter): 1.536 Wörter sind zu wenig
    assert any("2.300–2.900" in p for p in skript_pruefen(szenen, quellen))
    szenen[3]["quelle_ids"] = ["Q9"]
    assert any("Q9" in p for p in skript_pruefen(szenen, quellen, ziel_kurz))
    kurz = szenen[:5]
    probleme = skript_pruefen(kurz, quellen, ziel_kurz)
    assert any("Wörter" in p for p in probleme)


def _lauf(kanal: dict, vorlage: dict | None = None, laenge: dict | None = None) -> Lauf:
    l = Lauf.__new__(Lauf)
    l.kanal, l.streng = kanal, kanal.get("sicherheitsstufe") == "streng"
    l.laenge = {**LAENGE_STANDARD, **(laenge or {})}
    l.vorlage = vorlage
    return l


def test_zielgruppe_laenge_vorlage_im_prompt():
    l = _lauf({"name": "Testkanal", "sprache": "de", "zielgruppe": "Männer ab 55"})
    assert "Zielgruppe: Männer ab 55" in l.kopf()
    assert l.minuten() == "16–20 Minuten"
    assert l.vorlage_text("research") == ""
    assert "Zielgruppe" not in _lauf({"name": "Testkanal"}).kopf()
    v = _lauf({"name": "Testkanal"}, {"art": "vorlage", "text": "Hook. Then five reasons ..."})
    t = v.vorlage_text("script")
    assert "Nicht übersetzen" in t and "<vorlage>" in t and "five reasons" in t
    s = _lauf({"name": "Testkanal"}, {"art": "skript", "text": "Mein Skript ..."})
    assert "möglichst wörtlich" in s.vorlage_text("script")
    assert "Quellen" in s.vorlage_text("research")
    assert _lauf({"name": "K"}, laenge={"minuten": [10, 12]}).minuten() == "10–12 Minuten"


def test_json_aus_text_mit_codeblock():
    assert json_aus('Hier:\n```json\n{"a": 1}\n```') == {"a": 1}
    assert json_aus('Ergebnis {"b": [1, 2]} Ende') == {"b": [1, 2]}


def test_bilder_szenenbild_thumbnail_ersatz(tmp_path: Path):
    quelle = tmp_path / "q.png"
    Image.new("RGB", (1536, 1024), (40, 80, 120)).save(quelle)
    medien.szenenbild(quelle, "Studie 2016: 2.400 Paare", tmp_path / "s.png")
    assert Image.open(tmp_path / "s.png").size == (1920, 1080)
    medien.thumbnail(quelle, "Fünf Gründe die keiner kennt", tmp_path / "t.png")
    assert Image.open(tmp_path / "t.png").size == (1280, 720)
    medien.ersatzbild("Ruhiges Motiv", tmp_path / "e.png")
    assert Image.open(tmp_path / "e.png").size == (1536, 1024)


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg fehlt")
def test_clip_mit_untertiteln(tmp_path: Path):
    Image.new("RGB", (1920, 1080), (10, 10, 10)).save(tmp_path / "001.png")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "2", str(tmp_path / "t.mp3")], check=True)
    (tmp_path / "001.srt").write_text(medien.srt(medien.untertitel_teile("Hallo Welt. Zweiter Satz.", 2.0)), encoding="utf-8")
    medien.clip("ffmpeg", tmp_path, "001.png", "t.mp3", "001.srt", "001.mp4", 2.4, 5)
    medien.zusammenfuegen("ffmpeg", tmp_path, ["001.mp4", "001.mp4"], "gesamt.mp4")
    info = medien.video_info("ffprobe", tmp_path / "gesamt.mp4")
    assert (info["breite"], info["hoehe"]) == (1920, 1080)
    assert 4.3 <= info["dauer"] <= 5.4


# ---- B36.9 Whiteboard-Collage ---------------------------------------------------------------------------------------

import io  # noqa: E402

from PIL import Image as _Img, ImageDraw as _Draw  # noqa: E402

from udd import whiteboard as wb  # noqa: E402
from udd.schritte import wb_aufbereiten, wb_pruefen  # noqa: E402


def _png(weiss_hintergrund: bool = True, farbe=(240, 180, 40)) -> bytes:
    img = _Img.new("RGBA", (400, 400), (255, 255, 255, 255) if weiss_hintergrund else (0, 0, 0, 0))
    _Draw.Draw(img).ellipse((80, 80, 320, 320), fill=farbe + (255,), outline=(20, 20, 20, 255), width=12)
    b = io.BytesIO()
    img.save(b, "PNG")
    return b.getvalue()


def test_freistellen_weisser_hintergrund_wird_transparent():
    m = _Img.open(io.BytesIO(wb.freistellen(_png()))).convert("RGBA")
    assert m.size[0] < 400 and m.size[1] < 400  # auf den Inhalt zugeschnitten
    assert m.getpixel((0, 0))[3] == 0  # Ecke durchsichtig
    assert m.getpixel((m.width // 2, m.height // 2))[3] == 255  # Motiv bleibt
    # schon transparent: bleibt so
    m2 = _Img.open(io.BytesIO(wb.freistellen(_png(False)))).convert("RGBA")
    assert m2.getpixel((0, 0))[3] == 0


def test_bibliothek_merken_wiederverwenden_entfernen(tmp_path):
    bib = wb.Bibliothek(tmp_path / "motive")
    bib.merken("banane", wb.freistellen(_png()), "gelbe Banane")
    bib.merken("_hand", wb.freistellen(_png()), "Hand")
    assert bib.hat("banane") and bib.merkmal("banane")
    assert [x["key"] for x in wb.Bibliothek(tmp_path / "motive").liste()] == ["banane"]  # neu geladen, ohne „_hand“
    bib.entfernen("banane")
    assert not bib.hat("banane")


def test_schluessel_umlaute():
    assert wb.schluessel("Blonder Mann") == "blonder-mann"
    assert wb.schluessel("Größe & Maß") == "groesse-mass"


def test_anton_schrift_mit_umlauten():
    f = wb.anton(60)
    assert "Anton" in " ".join(f.getname())
    assert f.getmask("Ä").getbbox() is not None and f.getmask("ß").getbbox() is not None


def test_layout_und_elemente():
    assert wb.layout_wahl("3er", 4) == "4er" and wb.layout_wahl(None, 2) == "gegenueberstellung" and wb.layout_wahl("figur-liste", 1) == "figur-liste"
    assert len(wb.slots("5er", 5, (60, 200, 1860, 900))) == 5
    motiv = _Img.open(io.BytesIO(wb.freistellen(_png()))).convert("RGBA")
    s = {"layout": "4er", "balken": "Studie zeigt klaren Unterschied", "kernaussage": "Das ist normal", "motive": [{}] * 4}
    els = wb.elemente(s, [motiv] * 4)
    assert [e.art for e in els] == ["text", "motiv", "motiv", "motiv", "motiv", "text"]  # Balken → Motive → Kernaussage
    bild = wb.fertig(wb.hintergrund(None), els)
    assert bild.size == (1920, 1080)
    r, g, b = bild.getpixel((100, 50))  # roter Balken oben
    assert r > 190 and g < 70 and b < 70
    assert bild.getpixel((5, 600)) == (255, 255, 255)  # weißer Hintergrund
    # Kernaussage in Rot unten
    unten = [bild.getpixel((x, y)) for x in range(600, 1320, 4) for y in range(960, 1040, 4)]
    assert any(p[0] > 190 and p[1] < 70 for p in unten)
    # Liste + Schritt-Kasten bei figur-liste
    s2 = {"layout": "figur-liste", "ueberschrift": "Was hilft", "liste": ["Bewegung", "Schlaf"], "schrittText": "Schritt 4: Arzt fragen", "motive": [{}]}
    assert [e.art for e in wb.elemente(s2, [motiv])] == ["text", "motiv", "punkt", "punkt", "text"]


def test_hintergrund_blass_15_prozent():
    schwarz = _Img.new("RGB", (1920, 1080), (0, 0, 0))
    v = wb.hintergrund(schwarz).getpixel((10, 10))[0]
    assert 214 <= v <= 220  # 255 × 0,85


def test_animation_hand_folgt_und_dauer_stimmt(tmp_path):
    motiv = _Img.open(io.BytesIO(wb.freistellen(_png(farbe=(60, 120, 240))))).convert("RGBA")
    els = wb.elemente({"layout": "3er", "ueberschrift": "Teil eins", "motive": [{}] * 3}, [motiv] * 3)
    liste, fertig = wb.animation(wb.hintergrund(None), els, 5.0, 25, wb.hand_vorbereiten(wb.hand_gezeichnet()), tmp_path)
    assert abs(sum(d for _, d in liste) - 5.0) < 0.01
    assert len(liste) > 20
    # mitten im Aufdecken: Hand (Hautfarbe) im Bild; im fertigen Bild keine Hand mehr
    haut = lambda p: abs(p[0] - 247) < 14 and abs(p[1] - 205) < 16 and abs(p[2] - 170) < 18  # noqa: E731
    mitte = _Img.open(tmp_path / liste[len(liste) // 2][0]).convert("RGB").resize((480, 270))
    assert any(haut(mitte.getpixel((x, y))) for x in range(0, 480, 2) for y in range(0, 270, 2))
    klein = fertig.resize((480, 270))
    assert not any(haut(klein.getpixel((x, y))) for x in range(0, 480, 2) for y in range(0, 270, 2))


def test_uebersicht_raster(tmp_path):
    bilder = [(i, _Img.new("RGB", (1920, 1080), (255, 255, 255)), "banane, sanduhr") for i in range(1, 6)]
    wb.uebersicht(bilder, tmp_path / "u.jpg")
    u = _Img.open(tmp_path / "u.jpg")
    assert u.size == (4 * 480 + 50, 2 * (270 + 40) + 30)


def test_wb_pruefen_und_aufbereiten():
    szenen = [
        {"layout": "3er", "motive": [{"key": "a", "beschreibung": "x"}] * 3, "liste": []},
        {"layout": "4er", "motive": [{"key": "a", "beschreibung": "x"}], "liste": []},
        {"layout": "figur-liste", "motive": [{"key": "f", "beschreibung": "y"}], "liste": ["eins"]},
    ]
    p = wb_pruefen(szenen)
    assert len(p) == 2 and "Szene 2" in p[0] and "Szene 3" in p[1]
    s = [{"ueberschrift": "eins zwei drei vier fünf sechs sieben", "balken": "", "kernaussage": "", "schritt": "Schritt 4: Arzt fragen", "liste": [], "motive": [{"key": "Blonder Mann", "beschreibung": "egal"}, {"key": "Sanduhr", "beschreibung": "Sanduhr mit Gesicht"}]}]
    wb_aufbereiten(s, {"blonder-mann": "Mann um die 60, blond"})
    assert s[0]["ueberschrift"] == "eins zwei drei vier fünf sechs"
    assert s[0]["balken"] is None and s[0]["schrittText"] == "Schritt 4: Arzt fragen" and "schritt" not in s[0]
    assert s[0]["motive"][0] == {"key": "blonder-mann", "beschreibung": "Mann um die 60, blond"}  # feste Figur
    assert s[0]["motive"][1]["key"] == "sanduhr" and "Sanduhr mit Gesicht" in s[0]["bildidee"]
