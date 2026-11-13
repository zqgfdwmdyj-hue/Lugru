"""Unit-Tests für den Worker (ohne Netz): Filter, state.json, Untertitel, Kapitel, Skriptprüfung, Bilder, ffmpeg-Clip."""

from __future__ import annotations

import json
import re
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
    ziel_kurz = [1450, 1750]
    assert skript_pruefen(szenen, quellen, ziel_kurz) == []
    # Standard fest 1.500–1.700 Wörter: 1.536 passen; 2.300–2.900 wären zu wenig
    assert skript_pruefen(szenen, quellen) == []
    assert any("2.300–2.900" in p for p in skript_pruefen(szenen, quellen, [2300, 2900]))
    # Studie ohne Quelle (auch außerhalb der Punkte) fällt auf
    mit_studie = [dict(szenen[0], text=text + " Eine Studie zeigt das.")] + szenen[1:]
    assert any("Studie ohne Quelle" in p and "1" in p for p in skript_pruefen(mit_studie, quellen))
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
    assert l.minuten() == "10–12 Minuten"  # Skriptlänge fest 1.500–1.700 Wörter
    assert l.vorlage_text("research") == ""
    assert "Zielgruppe" not in _lauf({"name": "Testkanal"}).kopf()
    v = _lauf({"name": "Testkanal"}, {"art": "vorlage", "text": "Hook. Then five reasons ..."})
    t = v.vorlage_text("script")
    assert "Nicht übersetzen" in t and "<vorlage>" in t and "five reasons" in t
    s = _lauf({"name": "Testkanal"}, {"art": "skript", "text": "Mein Skript ..."})
    assert "möglichst wörtlich" in s.vorlage_text("script")
    assert "Quellen" in s.vorlage_text("research")
    assert _lauf({"name": "K"}, laenge={"minuten": [12, 14]}).minuten() == "12–14 Minuten"


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
    kurz = "Ein kurzer Satz mit genau zwölf Wörtern für diese Szene im Test."
    szenen = [
        {"text": kurz, "layout": "3er", "motive": [{"key": "a", "beschreibung": "x"}] * 3, "liste": []},
        {"text": kurz, "layout": "4er", "motive": [{"key": "a", "beschreibung": "x"}], "liste": []},
        {"text": kurz, "layout": "figur-liste", "motive": [{"key": "f", "beschreibung": "y"}], "liste": ["eins"]},
    ]
    p = wb_pruefen(szenen, voll=False)
    assert len(p) == 2 and "Szene 2" in p[0] and "Szene 3" in p[1]
    # B36.10: zu lange Szenen und zu wenige Szenen bei voller Länge
    lang = [{**szenen[0], "text": " ".join(["Wort"] * 40)}] + [szenen[0]] * 10
    p = wb_pruefen(lang, voll=True)
    assert any("Szenen 1 sind zu lang" in x for x in p) and any("Nur 11 Szenen – Ziel 55–80" in x for x in p)
    assert not any("Nur" in x for x in wb_pruefen([szenen[0]] * 60, voll=True))
    s = [{"text": "Die Sanduhr läuft und der Mann wartet geduldig.", "ueberschrift": "eins zwei drei vier fünf sechs sieben", "balken": "", "kernaussage": "", "schritt": "Schritt 4: Arzt fragen", "liste": [], "motive": [{"key": "Blonder Mann", "beschreibung": "egal", "wort": "Mann"}, {"key": "Sanduhr", "beschreibung": "Sanduhr mit Gesicht", "wort": "Sanduhr"}, {"key": "Wolke", "beschreibung": "Wolke", "wort": "Regen"}]}]
    wb_aufbereiten(s, {"blonder-mann": "Mann um die 60, blond"})
    assert s[0]["ueberschrift"] == "eins zwei drei vier fünf sechs"
    assert s[0]["balken"] is None and s[0]["schrittText"] == "Schritt 4: Arzt fragen" and "schritt" not in s[0]
    assert s[0]["motive"][0] == {"key": "blonder-mann", "beschreibung": "Mann um die 60, blond", "wort": "Mann"}  # feste Figur
    assert s[0]["motive"][1]["key"] == "sanduhr" and "Sanduhr mit Gesicht" in s[0]["bildidee"]
    assert "wort" not in s[0]["motive"][2]  # Wort steht nicht im Text → gleichmäßig verteilt


# ---- B36.10 Tempo: Takt nach Wortzeiten, draw_s, Hervorhebungen, Prüfung -------------------------------------------


def _ausrichtung(text: str, sek_je_zeichen: float = 0.06) -> dict:
    zeichen = list(text)
    return {"characters": zeichen, "character_start_times_seconds": [i * sek_je_zeichen for i in range(len(zeichen))], "character_end_times_seconds": [(i + 1) * sek_je_zeichen for i in range(len(zeichen))]}


def test_wortzeiten_aus_elevenlabs_ausrichtung():
    text = "Die Sanduhr läuft, der Wecker klingelt."
    z = wb.wortzeiten(text, _ausrichtung(text))
    assert [w for w, _ in z] == ["die", "sanduhr", "laeuft", "der", "wecker", "klingelt"]
    assert z[1][1] == 4 * 0.06 and z[4][1] == text.index("Wecker") * 0.06
    assert wb.wortzeiten(text, None) == [] and wb.wortzeiten(text, {"characters": ["a"], "character_start_times_seconds": []}) == []


def test_takt_plan_motive_beim_schluesselwort_zeichnen_solange_gesprochen_wird():
    text = "Erst kommt die Sanduhr, dann nach einer Weile der Wecker und zum Schluss das Glas."
    zeiten = wb.wortzeiten(text, _ausrichtung(text, 0.1))  # ~8,4 s Sprache
    arten = ["text", "motiv", "motiv", "motiv"]
    plan, k = wb.takt_plan(arten, [None, "Sanduhr", "Wecker", "Glas"], 9.0, wb.draw_s("normal"), zeiten)
    motive = [e for e in plan if e.art == "motiv"]
    starts = [round(text.index(w) * 0.1, 1) for w in ("Sanduhr", "Wecker", "Glas")]
    assert [round(e.start, 1) for e in motive] == starts
    # Echtes Zeichnen: jedes Motiv wird gezeichnet, bis das nächste kommt (bzw. bis kurz vor Szenenende) – an die Sprache gekoppelt
    bis = starts[1:] + [9.0 - 0.25]
    erwartet = [round(min(wb.ZEICHNEN_MAX, max(wb.ZEICHNEN_MIN, (b - a) * wb.ZEICHNEN_ANTEIL)), 2) for a, b in zip(starts, bis)]
    assert [round(e.dauer, 2) for e in motive] == pytest.approx(erwartet, abs=0.06)
    assert motive[1].dauer > 2.0 and k["zeichnenS"] == pytest.approx(sum(e.dauer for e in motive) / 3, abs=0.01)
    assert plan[0].art == "text" and plan[0].start == wb.WISCH_S  # Überschrift gleich zu Beginn
    assert k["maxPause"] <= wb.MAX_PAUSE and k["drawS"] == 2.0
    assert wb.draw_s("ruhig") == 2.5 and wb.draw_s("schnell") == 1.5 and wb.draw_s(None) == 2.0


def test_takt_plan_fuellt_luecken_mit_hervorhebungen_und_verteilt_ohne_wortzeiten():
    # 12 s Szene, zwei Motive ohne Wortzeiten → gleichmäßig verteilt, je Motiv gezeichnet bis zum nächsten: kaum Stillstand
    plan, k = wb.takt_plan(["motiv", "motiv"], [None, None], 12.0, 1.5, [])
    assert k["maxPause"] <= 1.0 and all(e.dauer > 5 for e in plan if e.art == "motiv")
    # nur Texte (kurzer Pop): Lücken > 2,6 s werden mit Hervorhebungen gefüllt
    plan, k = wb.takt_plan(["text", "text"], [None, None], 12.0, 1.5, [])
    assert k["hervorhebungen"] >= 2 and k["maxPause"] <= wb.MAX_PAUSE
    hervor = [e for e in plan if e.art == "hervorhebung"]
    assert {e.form for e in hervor} <= {"unterstreichen"} and all(e.index in (0, 1) for e in hervor)
    starts = [e.start for e in plan]
    assert starts == sorted(starts)
    # Zu leere Szene (nur ein Text, sehr lang) → Pause bleibt über 3 s und wird gemeldet
    _p, k2 = wb.takt_plan(["text"], [None], 30.0, 2.0, [])
    sz = [{"nr": 7, "takt": k2}, {"nr": 8, "takt": k}]
    h = schritte.takt_hinweise(sz)
    assert any(x.startswith("Szene 7:") and "ohne neue Aktion" in x for x in h) and not any(x.startswith("Szene 8:") for x in h)
    assert any(x.startswith("Takt: 2 Szenen, Ø alle") for x in h)


def test_animation_takt_wisch_pop_hervorhebung_und_hand(tmp_path):
    grund = wb.hintergrund(None)
    vorher = Image.new("RGB", (wb.B, wb.H), (0, 0, 255))
    motiv = Image.new("RGBA", (300, 300), (250, 120, 0, 255))
    s = {"ueberschrift": "Teil eins", "motive": [{"key": "m", "wort": "Motiv"}], "layout": "figur-liste", "liste": []}
    els = wb.elemente(s, [motiv])
    plan, k = wb.takt_plan([e.art for e in els], wb.element_woerter(s, els), 8.0, 1.5, [])
    liste, fertig = wb.animation_takt(grund, els, plan, 8.0, 10, wb.hand_gezeichnet(), tmp_path, vorher)
    assert abs(sum(d for _n, d in liste) - 8.0) < 0.15
    erstes = Image.open(tmp_path / liste[0][0]).convert("RGB")
    assert erstes.getpixel((wb.B - 5, wb.H // 2))[2] > 200  # Wisch: rechts noch die vorige Szene (blau)
    # fertiges Bild enthält die Hervorhebung in Rot
    rot = sum(1 for x in range(0, wb.B, 7) for y in range(0, wb.H, 7) if fertig.getpixel((x, y)) == wb.ROT)
    assert k["hervorhebungen"] >= 1 and rot > 20


# ---- Robustheit (Nachtrag 12.11.): Wiederholung, Streaming mit Abbruch, Abschnitte mit Wiederaufnahme --------------

import http.server  # noqa: E402
import threading  # noqa: E402

from udd import netz, schritte  # noqa: E402
from udd.schritte import Ablage, abschnitt_ziele, abschnitte  # noqa: E402


def test_wiederholung_wartet_2_4_8_16_und_nennt_abschnitt():
    gewartet: list[float] = []
    versuche = {"n": 0}

    def immer_kaputt():
        versuche["n"] += 1
        raise netz.Voruebergehend("HTTP 529: overloaded", 529)

    with pytest.raises(netz.AufrufFehler) as e:
        netz.mit_wiederholung(immer_kaputt, "Skript – Punkt 3", schlafen=gewartet.append)
    assert versuche["n"] == 5 and gewartet == [2, 4, 8, 16]
    assert "Skript – Punkt 3" in str(e.value) and "5 Versuchen" in str(e.value)

    # beim dritten Versuch klappt es
    n = {"i": 0}

    def zweimal_kaputt():
        n["i"] += 1
        if n["i"] < 3:
            raise netz.Zeitueberschreitung("keine vollständige Antwort nach 120 s")
        return "ok"

    gewartet.clear()
    assert netz.mit_wiederholung(zweimal_kaputt, "x", schlafen=gewartet.append) == "ok" and gewartet == [2, 4]

    # 400 (z. B. falsche Anfrage) wird nicht wiederholt
    def falsch():
        raise netz.Voruebergehend.__base__("HTTP 400")  # gewöhnliche Exception

    with pytest.raises(Exception, match="HTTP 400"):
        netz.mit_wiederholung(falsch, "x", schlafen=gewartet.append)


def test_voruebergehend_erkennt_abbruch_429_5xx():
    import anthropic

    try:
        import httpx2 as hx
    except ImportError:  # pragma: no cover
        import httpx as hx
    assert netz.voruebergehend(hx.RemoteProtocolError("peer closed connection without sending complete message body (incomplete chunked read)"))
    assert netz.voruebergehend(hx.ReadTimeout("zu langsam"))
    req = hx.Request("POST", "https://example.invalid/v1/messages")
    assert netz.voruebergehend(anthropic.APIStatusError("overloaded", response=hx.Response(529, request=req), body=None))
    assert netz.voruebergehend(anthropic.APIStatusError("rate", response=hx.Response(429, request=req), body=None))
    assert not netz.voruebergehend(anthropic.APIStatusError("bad", response=hx.Response(400, request=req), body=None))
    assert not netz.voruebergehend(ValueError("kaputtes JSON"))


class _Server:
    """Kleiner Testserver: antwortet je Anfrage nach Plan („503“, „abbruch“ = Antwort mittendrin abbrechen, „ok“)."""

    def __init__(self, plan: list[str], ok_body: bytes, typ: str = "application/json"):
        self.plan, self.anfragen = list(plan), 0
        server = self

        class H(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a):  # noqa: D401
                pass

            def do_POST(self):  # noqa: N802
                self.rfile.read(int(self.headers.get("Content-Length") or 0))
                server.anfragen += 1
                art = server.plan.pop(0) if server.plan else "ok"
                if art == "503":
                    body = b'{"error":{"message":"busy"}}'
                    self.send_response(503)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                self.send_response(200)
                self.send_header("Content-Type", typ)
                self.send_header("Transfer-Encoding", "chunked")
                self.end_headers()
                teil = ok_body[: len(ok_body) // 3] if art == "abbruch" else ok_body
                self.wfile.write(f"{len(teil):X}\r\n".encode() + teil + b"\r\n")
                if art == "abbruch":  # Verbindung schließen ohne Abschluss-Chunk → „incomplete chunked read“
                    self.wfile.flush()
                    self.connection.shutdown(2)
                    self.close_connection = True
                    return
                self.wfile.write(b"0\r\n\r\n")

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def stop(self):
        self.httpd.shutdown()


def _sse(text: str) -> bytes:
    ev = lambda typ, d: f"event: {typ}\ndata: {json.dumps({'type': typ, **d})}\n\n"  # noqa: E731
    out = ev("message_start", {"message": {"id": "msg_test", "type": "message", "role": "assistant", "model": "claude-opus-5-5", "content": [], "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 10, "output_tokens": 1}}})
    out += ev("content_block_start", {"index": 0, "content_block": {"type": "text", "text": ""}})
    for k in range(0, len(text), 40):
        out += ev("content_block_delta", {"index": 0, "delta": {"type": "text_delta", "text": text[k : k + 40]}})
    out += ev("content_block_stop", {"index": 0})
    out += ev("message_delta", {"delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 50}})
    out += ev("message_stop", {})
    return out.encode()


def test_claude_stream_abbruch_wird_wiederholt(monkeypatch):
    """Genau der Fehler aus dem Betrieb: Verbindung bricht mitten im Stream ab → neuer Versuch, Ergebnis vollständig."""
    import anthropic

    from udd import ki

    monkeypatch.setattr(netz, "_FAKTOR", 0.0)
    antwort = json.dumps({"szenen": [{"text": "Hallo und willkommen. " * 20}]})
    srv = _Server(["abbruch", "503", "ok"], _sse(antwort), "text/event-stream")
    try:
        c = anthropic.Anthropic(api_key="test", base_url=srv.url, max_retries=0, timeout=10)
        text, _ = ki.fragen(c, "claude-opus-5-5", "[video:script:hook] Test", was="Skript – Hook", log=None)
        assert json.loads(text) == json.loads(antwort) and srv.anfragen == 3
        # dauerhaft kaputt → Fehler mit Abschnittsname
        srv.plan = ["abbruch"] * 5
        with pytest.raises(netz.AufrufFehler, match="Skript – Punkt 2.*incomplete chunked read"):
            ki.fragen(c, "claude-opus-5-5", "x", was="Skript – Punkt 2", log=None)
    finally:
        srv.stop()


def test_brücke_elevenlabs_abbruch_und_503_werden_wiederholt(monkeypatch):
    from udd.seller import Seller

    monkeypatch.setattr(netz, "_FAKTOR", 0.0)
    mp3 = b"ID3" + bytes(range(256)) * 40
    srv = _Server(["503", "abbruch", "ok"], mp3, "audio/mpeg")
    try:
        s = Seller(srv.url, "vw_test")
        s.log = lambda _t: None
        r = s.anbieter("00000000-0000-0000-0000-000000000000", "elevenlabs", "v1/text-to-speech/x", {"text": "Hallo"}, timeout=10, was="Sprache – Szene 1")
        assert r.status_code == 200 and r.content == mp3 and srv.anfragen == 3
    finally:
        srv.stop()


def test_abschnitt_ziele_ergeben_1500_bis_1700():
    for n in (5, 6, 7):
        z = abschnitt_ziele(n)
        assert list(z) == abschnitte(n)
        assert 1497 <= sum(a for a, _ in z.values()) <= 1503
        assert 1690 <= sum(b for _, b in z.values()) <= 1700


class _FakeLauf:
    """Nur was script() braucht – Claude-Aufrufe werden ersetzt."""

    def __init__(self, tmp: Path, punkte: int = 5, whiteboard: bool = False):
        self.p = Projekt(tmp, "testkanal", "auftrag-1")
        self.laenge = dict(schritte.LAENGE_STANDARD)
        self.kanal = {"name": "Testkanal", "figuren": []}
        self.a = {"thema": "Testthema", "hinweis": ""}
        self.modell, self.whiteboard, self.streng, self.vorlage = "claude-opus-5-5", whiteboard, False, None
        self.claude = object()
        self.fortschritte: list[tuple[int, int]] = []
        self.daten = {
            "gliederung": {"hook": "H", "angst": "A", "punkte": [{"titel": f"P{i}", "kern": "K", "quelle_ids": [f"Q{i}"]} for i in range(1, punkte + 1)], "fazit": "F", "cta": "C"},
            "quellen": [{"id": f"Q{i}", "titel": f"Teststudie {i}", "url": f"https://example.com/{i}"} for i in range(1, punkte + 1)],
        }

    kopf = Lauf.kopf
    eigenes_skript_woerter = Lauf.eigenes_skript_woerter
    woerter_ziel = Lauf.woerter_ziel
    vidiq = Lauf.vidiq
    anmerkung = Lauf.anmerkung
    vorlage_text = Lauf.vorlage_text
    minuten = Lauf.minuten

    def fortschritt(self, schritt, fertig, gesamt):
        self.fortschritte.append((fertig, gesamt))


def _antwort_fuer(prompt: str, faktor: float = 1.0) -> str:
    import re as _re

    name = _re.search(r"\[video:script:([\w-]+)\]", prompt).group(1)
    m = _re.search(r"Länge dieses Abschnitts: ca\. (\d+) Wörter", prompt)
    neu = _re.search(r"Bitte auf ca\. (\d+) Wörter", prompt)
    n = int(neu.group(1)) if neu else round(int(m.group(1)) * faktor)
    q = [f"Q{name.split('-')[1]}"] if name.startswith("punkt-") else []
    return json.dumps({"szenen": [{"text": " ".join(["wort"] * n), "bildidee": "Symbolbild", "einblendung": "", "quelle_ids": q}]})


def test_skript_abschnittsweise_mit_wiederaufnahme(tmp_path, monkeypatch):
    l = _FakeLauf(tmp_path)
    aufrufe: list[str] = []

    def fragen(_c, _m, prompt, *, was="", **_kw):
        aufrufe.append(was)
        if was == "Skript – Punkt 3":
            raise netz.AufrufFehler("Skript – Punkt 3: nach 5 Versuchen nicht geklappt (peer closed connection)")
        return _antwort_fuer(prompt), []

    monkeypatch.setattr(schritte.ki, "fragen", fragen)
    with pytest.raises(netz.AufrufFehler, match="Punkt 3"):
        schritte.script(l)
    assert aufrufe == ["Skript – Hook", "Skript – Fear Activation", "Skript – Punkt 1", "Skript – Punkt 2", "Skript – Punkt 3"]
    gespeichert = sorted(p.name for p in (l.p.ordner / "skript").rglob("*.json"))
    assert gespeichert == ["angst.json", "hook.json", "punkt-1.json", "punkt-2.json"]

    # Neuer Versuch: nur der fehlende Abschnitt und die danach werden geholt
    aufrufe.clear()
    monkeypatch.setattr(schritte.ki, "fragen", lambda _c, _m, prompt, *, was="", **_kw: (aufrufe.append(was), (_antwort_fuer(prompt), []))[1])
    daten, hinweise = schritte.script(l)
    assert aufrufe == ["Skript – Punkt 3", "Skript – Punkt 4", "Skript – Punkt 5", "Skript – Zusammenfassung", "Skript – Call-to-Action"]
    assert hinweise == [] and 1500 <= daten["woerter"] <= 1700
    assert [s["abschnitt"] for s in daten["skript"]] == abschnitte(5) and [s["nr"] for s in daten["skript"]] == list(range(1, 10))
    assert l.fortschritte[-1] == (9, 9)


def test_skript_endpruefung_bessert_nur_betroffene_abschnitte_nach(tmp_path, monkeypatch):
    l = _FakeLauf(tmp_path, punkte=6)
    aufrufe: list[str] = []

    def fragen(_c, _m, prompt, *, was="", **_kw):
        aufrufe.append(was)
        if "Überarbeitung:" in prompt:
            return _antwort_fuer(prompt), []
        # alle Abschnitte 25 % zu kurz, Punkt 2 nennt eine fremde Quelle
        text = _antwort_fuer(prompt, 0.75)
        if was == "Skript – Punkt 2":
            text = text.replace('"Q2"', '"Q99"')
        return text, []

    monkeypatch.setattr(schritte.ki, "fragen", fragen)
    daten, hinweise = schritte.script(l)
    erste = abschnitte(6)
    assert len(aufrufe) > len(erste)
    nachbesserung = aufrufe[len(erste) :]
    assert "Skript – Punkt 2" in nachbesserung and len(nachbesserung) <= 4  # Quelle + höchstens 3 für die Länge
    assert "Skript – Hook" not in nachbesserung
    assert hinweise == [] and 1500 <= daten["woerter"] <= 1700
    assert all(q != "Q99" for s in daten["skript"] for q in s["quelle_ids"])


def test_ablage_neue_eingabe_neuer_ordner(tmp_path):
    p = Projekt(tmp_path, "k", "a")
    a1, a2 = Ablage(p, "skript", "eingabe-1"), Ablage(p, "skript", "eingabe-2")
    a1.schreiben("hook", {"x": 1})
    assert a1.lesen("hook") == {"x": 1} and a2.lesen("hook") is None
    (a1.ordner / "angst.json").write_text("{halb", encoding="utf-8")
    assert a1.lesen("angst") is None  # kaputte Datei → neu holen


def test_neu_schreiben_verwirft_abschnitte_nach_fehler_nicht(tmp_path, monkeypatch):
    """„Skript neu schreiben“ (Schritt war fertig) → Abschnitte weg; „Schritt wiederholen“ nach Fehler → Abschnitte bleiben."""
    from udd.konfig import Konfig

    gemeldet: list[tuple[str, str]] = []

    class S:
        def schritt(self, _id, schritt, status, **_kw):
            gemeldet.append((schritt, status))
            return {"weiter": False, "status": "angehalten"}

        def referenz_holen(self, *_a):  # pragma: no cover
            return b""

    k = Konfig(seller_url="http://x", token="vw_x", arbeitsordner=tmp_path, musikordner=tmp_path, poll_s=1, min_frei_gb=0, warn_frei_gb=0, fps=2, claude_modell="", aufbewahren_tage=1, ffmpeg="ffmpeg", ffprobe="ffprobe")
    auftrag = {"id": "a1", "thema": "T", "schritt": "script", "kanal": {"slug": "k", "name": "K"}, "wiederholen": "script"}
    p = Projekt(tmp_path, "k", "a1")
    (p.ordner / "skript" / "h").mkdir(parents=True)
    (p.ordner / "skript" / "h" / "hook.json").write_text("{}", encoding="utf-8")
    # nach Fehler: Schritt nicht fertig → Abschnitte bleiben
    schritte.ausfuehren(k, S(), dict(auftrag), log=lambda _t: None)
    assert (p.ordner / "skript" / "h" / "hook.json").exists()
    # neu schreiben: Schritt war fertig → Abschnitte weg
    p.markieren("script", skript=[], woerter=0)
    schritte.ausfuehren(k, S(), dict(auftrag), log=lambda _t: None)
    assert not (p.ordner / "skript").exists()
    assert not Projekt(tmp_path, "k", "a1").erledigt("script")
    # „Im neuen Takt neu machen“ nach fertigem Upload: alte YouTube-ID wird verworfen (neues Video, neuer Upload) …
    p = Projekt(tmp_path, "k", "a1")
    p.state["youtube"] = {"id": "ytALT", "sitzung": "https://example.invalid/s"}
    p.markieren("script", skript=[], woerter=0)
    schritte.ausfuehren(k, S(), dict(auftrag), log=lambda _t: None)
    assert "youtube" not in Projekt(tmp_path, "k", "a1").state
    # … „Schritt wiederholen“ beim Upload behält die Sitzung (Fortsetzen statt doppelt hochladen)
    p = Projekt(tmp_path, "k", "a1")
    p.state["youtube"] = {"sitzung": "https://example.invalid/s"}
    p.speichern()
    schritte.ausfuehren(k, S(), {**auftrag, "schritt": "upload", "wiederholen": "upload"}, log=lambda _t: None)
    assert Projekt(tmp_path, "k", "a1").state["youtube"] == {"sitzung": "https://example.invalid/s"}


def test_eigenes_skript_wird_nie_verlaengert_nur_gekuerzt():
    kurz = _lauf({"name": "K"}, {"art": "skript", "text": " ".join(["Wort"] * 1200)})
    assert kurz.woerter_ziel() == [1080, 1260]  # Länge bleibt (−10 %/+5 %), kein Auffüllen auf 1.500
    assert kurz.minuten() == "7–9 Minuten"
    regel = kurz.vorlage_text("script")
    assert "1.200 Wörter – nicht verlängern" in regel and "kürze" not in regel
    lang = _lauf({"name": "K"}, {"art": "skript", "text": " ".join(["Wort"] * 2500)})
    assert lang.woerter_ziel() == [1500, 1700]  # zu lang → auf 1.500–1.700 kürzen
    assert "kürze es auf 1.500–1.700 Wörter" in lang.vorlage_text("script")
    passt = _lauf({"name": "K"}, {"art": "skript", "text": " ".join(["Wort"] * 1650)})
    assert passt.woerter_ziel() == [1485, 1700]
    # englische Vorlage (nur Muster) und ohne Vorlage: fest 1.500–1.700
    assert _lauf({"name": "K"}, {"art": "vorlage", "text": "Hook ..."}).woerter_ziel() == [1500, 1700]
    assert _lauf({"name": "K"}).woerter_ziel() == [1500, 1700]


def test_skript_aus_eigenem_kurzem_skript_ohne_auffuellen(tmp_path, monkeypatch):
    l = _FakeLauf(tmp_path)
    l.vorlage = {"art": "skript", "text": " ".join(["Wort"] * 1200)}
    prompts: list[str] = []

    def fragen(_c, _m, prompt, *, was="", **_kw):
        prompts.append(prompt)
        return _antwort_fuer(prompt), []

    monkeypatch.setattr(schritte.ki, "fragen", fragen)
    daten, hinweise = schritte.script(l)
    assert hinweise == [] and 1080 <= daten["woerter"] <= 1260
    assert "insgesamt 1.080–1.260 Wörter" in prompts[0] and "nicht verlängern" in prompts[0]


# ---- B37 Instagram-Story ----------------------------------------------------------------------------------------------


def test_story_regeln_wie_im_seller_system():
    from udd.story import story_regeln

    assert any("kostenlose" in f for f in story_regeln("Inklusive kostenloser Zählung jeder Einheit", "preis", True, True))
    assert any("all-in" in f for f in story_regeln("Prep all-in ab 0,59 € netto je Artikel", "preis", True, True))
    assert not story_regeln("Prep all-in ab 0,59 € netto je Artikel. Enthalten: Etikett, Polybeutel, Versandkarton-Packen.", "preis", True, True)
    assert any("netto" in f for f in story_regeln("Prep ab 0,59 € je Artikel", "preis", True, True))
    assert any("Versicherung" in f for f in story_regeln("Deine Ware ist bei uns voll versichert", "leistung", True, True))
    assert any("Werbekennzeichnung" in f for f in story_regeln("Wir labeln deine Ware", "leistung", True, False))
    assert not story_regeln("FNSKU immer auf die Einheit, nicht auf den Karton.", "tipp", True, False)


class _StorySeller:
    def __init__(self, foto: bytes | None = None):
        self.hochgeladen: dict[str, Path] = {}
        self.foto = foto

    def datei_hochladen(self, _id, art, pfad):
        self.hochgeladen[art] = Path(pfad)

    def foto_holen(self, _id):
        return self.foto


class _StoryLauf:
    def __init__(self, tmp: Path, story: dict, hand: bool = True, ffmpeg: str = "ffmpeg"):
        from udd import whiteboard as wb
        from udd.konfig import Konfig

        self.id = "story-1"
        self.p = Projekt(tmp, "testkanal-ig", self.id)
        self.bib = wb.Bibliothek(tmp / "testkanal-ig" / "motive")
        self.k = Konfig("http://example.invalid", "vw_x", tmp, tmp, 1, 1, 1, 2, "", 1, ffmpeg, shutil.which("ffprobe") or "ffprobe")
        self.kanal = {"name": "Testkanal", "slug": "testkanal-ig", "tempo": "schnell", "instagram": {"hand": hand, "werbung": True, "farben": {"grund": "#FFFFFF", "akzent": "#C81E1E", "text": "#181818"}, "hinweis": "Anfrage über example.com", "fakten": "Prep ab 0,59 € netto je Artikel"}}
        self.a = {"id": self.id, "thema": "Prep-Preis", "hinweis": "", "story": story}
        self.modell, self.claude = "claude-opus-5-5", object()
        self.seller = _StorySeller(_png(False, (90, 120, 160)))


def _story_antwort(key: str = "karton", text: str = "Prep ab 0,59 € netto je Artikel. Enthalten: Etikett und Polybeutel.") -> str:
    return json.dumps({"ueberschrift": "Prep zum Festpreis", "text": text, "cta": "Jetzt anfragen", "werbung": True, "motiv": {"key": key, "beschreibung": "Ein Versandkarton"}, "sticker": {"art": "keine", "frage": "", "optionen": []}})


@pytest.mark.skipif(not shutil.which("ffmpeg") or not shutil.which("ffprobe"), reason="ffmpeg fehlt")
def test_story_hochformat_mp4_mit_hand_und_png_ohne_hand(tmp_path, monkeypatch):
    from udd import schritte
    from udd import story as st

    aufrufe: list[str] = []
    bilder: list[str] = []
    monkeypatch.setattr(st.ki, "fragen", lambda _c, _m, prompt, *, was="", **_kw: (aufrufe.append(prompt), (_story_antwort(), []))[1])
    monkeypatch.setattr(schritte, "_motiv_holen", lambda _l, _p, was="": (bilder.append(was), _png())[1])
    l = _StoryLauf(tmp_path, {"inhaltsart": "preis"})
    daten, hinweise = st.story(l)
    s = daten["story"]
    assert s["format"] == "mp4" and 5 <= s["dauerSek"] <= 15 and s["werbung"] is True and s["motivKey"] == "karton"
    assert not hinweise and "[video:story:preis]" in aufrufe[0] and "Prep ab 0,59 € netto" in aufrufe[0]
    assert set(l.seller.hochgeladen) == {"story_mp4", "story_vorschau"}
    info = medien.video_info(l.k.ffprobe, l.seller.hochgeladen["story_mp4"])
    assert (info["breite"], info["hoehe"]) == (1080, 1920)
    assert Image.open(l.seller.hochgeladen["story_vorschau"]).size == (540, 960)
    # zweiter Lauf (Wiederholung nach Fehler): Text und Motiv nicht noch einmal bezahlt
    st.story(l)
    assert len(aufrufe) == 1 and len(bilder) == 1
    # ohne Hand: Standbild (PNG) 1080×1920
    l2 = _StoryLauf(tmp_path, {"inhaltsart": "preis"}, hand=False)
    l2.a["id"] = l2.id = "story-2"
    l2.p = Projekt(tmp_path, "testkanal-ig", "story-2")
    d2, _ = st.story(l2)
    assert d2["story"]["format"] == "png" and Image.open(l2.seller.hochgeladen["story_png"]).size == (1080, 1920)
    assert len(bilder) == 1  # Motiv „karton“ aus der Bibliothek


def test_story_neu_erzeugen_motiv_bleibt_oder_wird_einmal_neu(tmp_path, monkeypatch):
    from udd import schritte
    from udd import story as st

    aufrufe: list[str] = []
    bilder: list[str] = []
    monkeypatch.setattr(st.ki, "fragen", lambda _c, _m, prompt, *, was="", **_kw: (aufrufe.append(prompt), (_story_antwort("lupe", "FNSKU auf jede Einheit kleben."), []))[1])
    monkeypatch.setattr(schritte, "_motiv_holen", lambda _l, _p, was="": (bilder.append(was), _png())[1])
    vorher = {"inhaltsart": "tipp", "ueberschrift": "Alt", "text": "Alter Text", "motivKey": "karton"}
    l = _StoryLauf(tmp_path, dict(vorher), hand=False)
    l.bib.merken("karton", _png(), "Karton")
    d, _ = st.story(l)
    assert d["story"]["motivKey"] == "karton" and not bilder  # Motiv bleibt, kostet nichts
    assert "Vorige Fassung" in aufrufe[0] and "Alter Text" in aufrufe[0]
    # „Motiv neu“: genau einmal neu, auch wenn der Schritt danach wiederholt wird
    l.a["story"] = {**vorher, "motivNeu": True}
    d, _ = st.story(l)
    assert d["story"]["motivKey"] == "lupe" and len(bilder) == 1
    st.story(l)
    assert len(bilder) == 1


def test_story_eigenes_foto_ohne_bildanbieter(tmp_path, monkeypatch):
    from udd import schritte
    from udd import story as st

    monkeypatch.setattr(st.ki, "fragen", lambda *_a, **_kw: (_story_antwort("regal", "Blick ins Lager: sortierte Regale."), []))
    monkeypatch.setattr(schritte, "_motiv_holen", lambda *_a, **_kw: pytest.fail("Foto-Story darf kein Bild erzeugen"))
    l = _StoryLauf(tmp_path, {"inhaltsart": "einblick", "fotoId": "abcdef1234567890"}, hand=False)
    d, _ = st.story(l)
    assert d["story"]["motivKey"] == "foto-abcdef12"
    bild = Image.open(l.seller.hochgeladen["story_png"]).convert("RGB")
    assert bild.getpixel((540, 800)) != (255, 255, 255)  # Foto in der Mitte


def test_takt_plan_stillstand_am_szenenanfang_ohne_fertiges_element():
    # Figur-Liste: erstes Element ist ein Motiv, dessen Wort erst nach 4,6 s fällt – vorher steht nichts im Bild, das
    # hervorgehoben werden könnte → das Motiv kommt früher; Stillstand = Zeit ohne Bewegung (nicht Start-zu-Start)
    text = "Viele merken lange gar nichts davon und erst nach Monaten kommt die Figur mit Hut ins Spiel und erklärt es."
    zeiten = wb.wortzeiten(text, _ausrichtung(text, 0.07))
    plan, k = wb.takt_plan(["motiv", "text", "text", "text", "text"], ["Figur", None, None, None, None], 9.5, 1.5, zeiten)
    assert k["maxPause"] <= wb.MAX_PAUSE
    assert plan[0].art == "motiv" and plan[0].start < text.index("Figur") * 0.07
    luecken = wb.stillstand(plan, 9.5)
    assert all(g <= wb.MAX_PAUSE for g, _a, _b in luecken)
    assert wb.stillstand([], 2.0) == [(1.7, wb.WISCH_S, 2.0)]


def test_claude_abgeschnitten_einmal_mit_mehr_platz(monkeypatch):
    """Betrieb: „Recherche – Gliederung: Antwort von Claude abgeschnitten (max_tokens)“ – das Denken der aktuellen Modelle
    zählt zu max_tokens. Mindestens 16.000 Tokens Platz; abgeschnitten → einmal neu mit doppeltem Platz, dann Fehler."""
    from types import SimpleNamespace

    from udd import ki

    gesehen: list[int] = []
    plan = ["max_tokens", "end_turn"]

    def einmal(_c, _n, kw, _f):
        gesehen.append(kw["max_tokens"])
        stop = plan.pop(0) if plan else "max_tokens"
        return SimpleNamespace(stop_reason=stop, content=[SimpleNamespace(type="text", text='{"punkte": []}')])

    monkeypatch.setattr(ki, "_einmal", einmal)
    logs: list[str] = []
    text, _ = ki.fragen(None, "claude-opus-5-5", "x", was="Recherche – Gliederung", websuche=3, max_tokens=3000, log=logs.append)  # type: ignore[arg-type]
    assert text == '{"punkte": []}' and gesehen == [16000, 32000]
    assert "Recherche – Gliederung: Antwort abgeschnitten – neuer Versuch mit mehr Platz (32000 Tokens)" in logs
    gesehen.clear()
    with pytest.raises(RuntimeError, match=r"Recherche – Gliederung: Antwort von Claude abgeschnitten \(max_tokens 32000\)"):
        ki.fragen(None, "claude-opus-5-5", "x", was="Recherche – Gliederung", log=None)  # type: ignore[arg-type]
    assert gesehen == [16000, 32000]


# ---- Echtes Zeichnen, Hand mit Ankerpunkt, Sprechtempo, Probeszene (13.11.) ----------------------------------------

def test_vektorisieren_mittellinie_je_linie_ein_pfad():
    """Konturen → Mittellinien-Pfade: jede Linie genau einmal (potrace/vtracer lieferten zwei Umrisse je Linie)."""
    from PIL import ImageDraw

    from udd import strich

    img = Image.new("RGBA", (420, 320), (255, 255, 255, 255))
    d = ImageDraw.Draw(img)
    d.line((60, 250, 360, 250), fill=(20, 20, 20, 255), width=12)
    d.ellipse((130, 30, 290, 150), outline=(20, 20, 20, 255), width=10)
    daten = strich.vektorisieren(img)
    assert not daten["umriss"] and 1 <= len(daten["striche"]) <= 6
    laengen = [strich._laenge(s["p"]) for s in daten["striche"]]
    erwartet = 300 + 2 * 3.1416 * ((80**2 + 60**2) / 2) ** 0.5  # Linie + Ellipsenumfang
    assert 0.8 * erwartet < sum(laengen) < 1.2 * erwartet  # nicht doppelt
    gerade = max(daten["striche"], key=lambda s: abs(s["p"][-1][0] - s["p"][0][0]))
    assert abs(gerade["p"][0][1] - 250) < 4 and abs(abs(gerade["p"][-1][0] - gerade["p"][0][0]) - 300) < 20
    assert all(10 <= s["b"] <= 32 for s in daten["striche"])  # Pinsel deckt die Linienbreite
    # Motiv ohne Konturen: Umriss wird gezeichnet
    flaeche = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    ImageDraw.Draw(flaeche).rectangle((40, 40, 160, 160), fill=(240, 160, 30, 255))
    u = strich.vektorisieren(flaeche)
    assert u["umriss"] and sum(strich._laenge(s["p"]) for s in u["striche"]) > 380
    assert "<polyline" in strich.svg(daten) and strich.laden(json.dumps(daten)) == daten


def test_zeichner_strich_fuer_strich_dann_farbe_hand_am_endpunkt():
    from PIL import ImageDraw

    from udd import strich

    img = Image.new("RGBA", (300, 240), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle((20, 20, 280, 220), 20, fill=(240, 140, 20, 255), outline=(20, 20, 20, 255), width=10)
    z = strich.Zeichner(img, strich.vektorisieren(img), farbe_anteil=0.2)

    def orange(e, deckend=200):
        return sum(1 for p in e.getdata() if p[3] > deckend and p[0] > 200 and 100 < p[1] < 180 and p[2] < 60)

    def sichtbar(e):
        return sum(1 for p in e.getdata() if p[3] > 128)

    e1, s1 = z.zustand(0.15)
    e2, s2 = z.zustand(0.5)
    e3, s3 = z.zustand(0.9)
    e4, s4 = z.zustand(1.0)
    assert s1 and s2 and s3 is None and s4 is None  # Hand nur, solange Striche gezeichnet werden
    assert 0 < sichtbar(e1) < sichtbar(e2) and orange(e1) == 0 and orange(e2) == 0  # erst nur Konturen, keine Fläche
    assert orange(e3) == 0 < orange(e3, 60) and orange(e4) > 0  # Farbe wird danach eingeblendet (bei 90 % halb)
    assert list(e4.getdata()) == list(img.getdata())  # am Ende genau das Motiv
    # Stiftspitze liegt auf einer schon gezeichneten Kontur
    x, y = round(s2[0]), round(s2[1])
    nah = [e2.getpixel((min(299, max(0, x + dx)), min(239, max(0, y + dy))))[3] for dx in range(-6, 7) for dy in range(-6, 7)]
    assert max(nah) > 200


def test_hand_png_transparent_mit_stiftspitze_als_anker():
    # Ludwigs Hand (Foto, freigestellt): Stiftspitze unten links, Hand + Unterarm laufen nach rechts oben aus dem Bild
    h = wb.hand_laden(380)
    a = h.bild.getchannel("A")
    assert a.getextrema()[0] == 0 and a.getpixel((h.bild.width - 1, h.bild.height - 1)) == 0  # transparenter Hintergrund
    sx, sy = h.spitze
    assert sx < h.bild.width * 0.15 and sy > h.bild.height * 0.85  # Spitze unten links
    assert 360 < h.bild.height < 1100 and h.bild.width > 600  # Hand ≈ 380 px hoch, Unterarm läuft weiter
    rahmen = Image.new("RGBA", (1920, 1080), (255, 255, 255, 255))
    h.setzen(rahmen, 400, 900)
    dunkel = [rahmen.getpixel((400 + dx, 900 + dy)) for dx in range(-5, 6) for dy in range(-8, 3)]
    assert min(sum(p[:3]) for p in dunkel) < 200  # genau am Ankerpunkt sitzt die schwarze Stiftspitze
    box = Image.eval(rahmen.convert("L"), lambda v: 255 if v < 250 else 0).getbbox()
    assert box[3] - 900 < 25 and 400 - 160 < box[0] < 400 and box[2] > 1200  # Hand oberhalb der Spitze, Finger etwas links davon, Unterarm nach rechts
    haut = sum(1 for p in rahmen.convert("RGB").getdata() if p[0] - p[1] > 20 and p[1] - p[2] > 12 and 110 < p[0] < 240)
    assert haut > 20000  # echte Hautfarbe sichtbar


def test_animation_hand_folgt_dem_strich(tmp_path, monkeypatch):
    from PIL import ImageDraw

    from udd import strich

    motiv = Image.new("RGBA", (400, 300), (0, 0, 0, 0))
    ImageDraw.Draw(motiv).line((30, 150, 370, 150), fill=(20, 20, 20, 255), width=14)
    s = {"motive": [{"key": "m", "wort": None}], "layout": "figur-liste"}
    els = wb.elemente(s, [motiv], [strich.vektorisieren(motiv)])
    plan, _k = wb.takt_plan([e.art for e in els], [None], 4.0, 1.5, [])
    punkte = []
    monkeypatch.setattr(wb.Hand, "setzen", lambda self, r, x, y: punkte.append((x, y)))
    wb.animation_takt(wb.hintergrund(None), els, plan, 4.0, 10, wb.hand_laden(), tmp_path)
    el = els[0]
    assert len(punkte) >= 5
    # jede Handposition liegt auf der Linie (y = Mitte des Strichs), x wandert von links nach rechts
    f = el.ebene.width / 400
    assert all(abs(y - (el.pos[1] + 150 * f)) < 4 for _x, y in punkte)
    assert [x for x, _y in punkte] == sorted(x for x, _y in punkte)


class _Antwort:
    def __init__(self, daten: dict, status: int = 200):
        self.status_code, self._d = status, daten

    def json(self):
        return self._d


def _tts_antwort(text: str, tmp: Path, vorn: float = 0.4, sprechen: float = 2.0, hinten: float = 0.6) -> dict:
    import base64

    mp3 = tmp / f"tts-{abs(hash(text))}.mp3"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", f"{vorn + sprechen + hinten:.2f}", "-c:a", "libmp3lame", "-b:a", "64k", str(mp3)], check=True)
    zeichen = list(text)
    je = sprechen / len(zeichen)
    ausr = {"characters": zeichen, "character_start_times_seconds": [vorn + i * je for i in range(len(zeichen))], "character_end_times_seconds": [vorn + (i + 1) * je for i in range(len(zeichen))]}
    return {"audio_base64": base64.b64encode(mp3.read_bytes()).decode(), "alignment": ausr}


class _TtsSeller:
    def __init__(self, tmp: Path):
        self.tmp, self.koerper, self.hochgeladen, self.meldungen = tmp, [], {}, []

    def anbieter(self, _id, anbieter, pfad, koerper, **_kw):
        assert anbieter == "elevenlabs" and pfad.endswith("/with-timestamps?output_format=mp3_44100_128")
        self.koerper.append(koerper)
        return _Antwort(_tts_antwort(koerper["text"], self.tmp))

    def datei_hochladen(self, _id, art, pfad):
        self.hochgeladen[art] = Path(pfad)

    def schritt(self, *_a, **_kw):
        self.meldungen.append(_kw.get("fortschritt"))
        return {"weiter": True}


def _tts_lauf(tmp: Path, kanal: dict | None = None, skript: list | None = None, probe: dict | None = None):
    from udd import whiteboard as wbm
    from udd.konfig import Konfig

    l = Lauf.__new__(Lauf)
    l.id = "probe-1"
    l.k = Konfig("http://example.invalid", "vw_x", tmp, tmp, 1, 1, 1, 5, "", 1, "ffmpeg", shutil.which("ffprobe") or "ffprobe")
    l.kanal = {"name": "Testkanal", "slug": "testkanal", "stimmeId": "TESTSTIMME01", "stil": "whiteboard", "tempo": "normal", **(kanal or {})}
    l.whiteboard = True
    l.streng = False
    l.p = Projekt(tmp, "testkanal", l.id)
    l._bib = wbm.Bibliothek(tmp / "testkanal" / "motive")
    l.daten = {"skript": skript or []}
    l.a = {"id": l.id, "probe": probe}
    l.seller = _TtsSeller(tmp)
    return l


def test_sprache_mit_tempo_stille_gekuerzt_und_woerter_pro_minute(tmp_path):
    from udd import schritte as sch

    l = _tts_lauf(tmp_path)
    text = "Eine Vakuumpumpe saugt die Luft aus dem Beutel."
    k = sch._sprache_holen(l, 0, text)
    assert l.seller.koerper[-1]["voice_settings"] == {"speed": 1.1}  # Standard-Sprechtempo
    e = l.p.state["voice"][k]
    # 0,4 s Stille vorn und 0,6 s hinten → auf 0,05 / 0,08 s gekürzt: 2,0 + 0,13 s (± ein MP3-Rahmen)
    assert abs(e["dauer"] - 2.13) < 0.08
    zeiten = json.loads((l.p.ordner / e["zeiten"]).read_text())
    assert abs(zeiten[0][1] - sch.VOR_S) < 0.02  # Wortzeiten mitverschoben
    # gleiche Einstellung → nicht noch einmal bezahlt; anderes Tempo → neue Datei, auf 0,7–1,2 begrenzt
    assert sch._sprache_holen(l, 0, text) == k and len(l.seller.koerper) == 1
    l.kanal["sprechtempo"] = 1.5
    assert sch._sprache_holen(l, 0, text) != k and l.seller.koerper[-1]["voice_settings"] == {"speed": 1.2}
    assert sch.sprechtempo({"sprechtempo": "0,9"}) == 1.1 and sch.sprechtempo({"sprechtempo": 0.5}) == 0.7  # Text mit Komma → Standard
    # Pause zwischen zwei Szenen höchstens 0,3 s
    assert sch.NACH_S + sch.PAUSE_S + sch.VOR_S <= 0.3
    assert sch.woerter_pro_minute([{"text": "eins zwei drei vier fünf", "dauer": 2.0}]) == 150.0


def test_probeszene_20s_neue_technik_mit_hand(tmp_path):
    from udd import schritte as sch

    text = "Die Pumpe zieht die Luft aus dem Beutel und spart viel Platz im Karton bei jeder Sendung."
    skript = [{"nr": i, "text": f"Teil {i}: {text}", "ueberschrift": f"Teil {i}", "layout": "figur-liste", "motive": [{"key": "pumpe", "wort": "Pumpe"}]} for i in range(1, 9)]
    l = _tts_lauf(tmp_path, skript=skript, probe={"szene": 2})
    l.bib.merken("pumpe", wb.freistellen(_png(True, (60, 60, 60))), "Pumpe")
    d, _h = sch.probe(l)
    p = d["probe"]
    assert p["szenen"][0] == 2 and len(p["szenen"]) >= 2 and p["sprechtempo"] == 1.1
    assert p["dauerSek"] <= 20.0 and p["woerterProMin"] and p["woerterProMin"] > 135
    datei = l.seller.hochgeladen["probe"]
    info = medien.video_info(l.k.ffprobe, datei)
    assert (info["breite"], info["hoehe"]) == (1920, 1080) and info["dauer"] <= 20.2
    # Sprache wurde mit dem Kanal-Sprechtempo geholt und liegt für das spätere Neu-Rendern bereit
    assert all(k["voice_settings"]["speed"] == 1.1 for k in l.seller.koerper)
    assert len(l.p.state["voice"]) == len(p["szenen"])
    assert (l.bib.ordner / "pumpe.striche.json").exists() and (l.bib.ordner / "pumpe.svg").exists()


# ---- B36.11 Vollbild in Bewegung ---------------------------------------------------------------------------------------


def test_bewegt_anzahl_und_zeiten_beim_schluesselwort():
    from udd import bewegt

    assert bewegt.anzahl(28, 6) == 5 and bewegt.anzahl(20, 6) == 3 and bewegt.anzahl(4, 6) == 1 and bewegt.anzahl(80, 6) == 6
    assert bewegt.anzahl(6, 4) == 2 and bewegt.bild_sek({"bildSek": 20}) == 10 and bewegt.bild_sek({}) == 6
    wz = [("die", 0.0), ("uhr", 0.5), ("tickt", 1.0), ("hier", 2.0), ("das", 6.4), ("werk", 7.1), ("glas", 12.2)]
    z = bewegt.zeiten(18.0, 3, wz, ["Die", "Werk", "Glas"])
    assert z[0][0] == 0 and abs(z[1][0] - 7.1) < 0.01 and abs(z[2][0] - 12.2) < 0.01  # beim Schlüsselwort
    assert abs(sum(d for _s, d in z) - 18.0) < 0.01
    z2 = bewegt.zeiten(18.0, 3)  # ohne Wortzeiten gleichmäßig
    assert [round(s) for s, _d in z2] == [0, 6, 12]
    z3 = bewegt.zeiten(10.0, 3, wz, ["Die", "Uhr", "tickt"])  # zu früh → mindestens 2,5 s je Bild
    assert all(d >= bewegt.MIN_SEG - 0.01 for _s, d in z3)


def test_bewegt_clip_waehlen_lang_genug_1920_nicht_doppelt():
    from udd import bewegt

    videos = [
        {"id": 1, "duration": 3, "video_files": [{"link": "https://videos.pexels.com/1.mp4", "width": 1920, "height": 1080, "file_type": "video/mp4"}]},
        {"id": 2, "duration": 12, "video_files": [{"link": "https://videos.pexels.com/2a.mp4", "width": 960, "height": 540, "file_type": "video/mp4"}, {"link": "https://videos.pexels.com/2b.mp4", "width": 1920, "height": 1080, "file_type": "video/mp4"}, {"link": "https://videos.pexels.com/2c.mp4", "width": 3840, "height": 2160, "file_type": "video/mp4"}]},
        {"id": 3, "duration": 15, "video_files": [{"link": "https://videos.pexels.com/3.mp4", "width": 1080, "height": 1920, "file_type": "video/mp4"}]},  # Hochformat
    ]
    v, f = bewegt.clip_waehlen(videos, 6.5, set())
    assert v["id"] == 2 and f["link"].endswith("2b.mp4")  # lang genug, 1920 px statt 4K
    v, f = bewegt.clip_waehlen(videos, 6.5, {"2"})
    assert v["id"] == 1  # 2 schon benutzt, Hochformat nie
    assert bewegt.clip_waehlen(videos, 6.5, {"1", "2"}) is None


class _VbSeller(_TtsSeller):
    def __init__(self, tmp: Path, quellen: set[str] | None = None):
        super().__init__(tmp)
        self.bilder, self.suchen, self.quellen = [], [], {"pexels"} if quellen is None else quellen

    def anbieter(self, _id, anbieter, pfad, koerper, **_kw):
        if anbieter == "openai":
            import base64
            import io

            self.bilder.append(koerper["prompt"])
            buf = io.BytesIO()
            farbe = (len(self.bilder) * 40 % 255, 90, 160)
            Image.new("RGB", (1536, 1024), farbe).save(buf, "PNG")
            from PIL import ImageDraw

            img = Image.open(io.BytesIO(buf.getvalue()))
            ImageDraw.Draw(img).rectangle((300, 300, 900, 700), fill=(250, 250, 250))
            buf = io.BytesIO()
            img.save(buf, "PNG")
            return _Antwort({"data": [{"b64_json": base64.b64encode(buf.getvalue()).decode()}]})
        return super().anbieter(_id, anbieter, pfad, koerper, **_kw)

    def anbieter_holen(self, _id, anbieter, pfad, params, **_kw):
        self.suchen.append((anbieter, params["query"]))
        n = len(self.suchen)
        if anbieter == "pixabay":  # Format wie die Seller-Brücke es liefert (pixabayAlsVideos)
            assert pfad == "videos" and "key" not in params
            if "pixabay" not in self.quellen:
                return _Antwort({"error": {"message": "Pixabay-Schlüssel fehlt (Anbindungen → Pixabay)"}}, 424)
            hoch = " 2 " in params["query"]  # Szene 2: nur Hochformat → nicht brauchbar, weiter bei Pexels
            return _Antwort({"videos": [{"id": f"pixabay-{500 + n}", "quelle": "pixabay", "duration": 12, "url": f"https://pixabay.com/videos/id-{500 + n}/", "user": {"name": f"Pixafilmer {n}"}, "video_files": [{"link": f"https://cdn.pixabay.com/video/test/{500 + n}.mp4", "width": 1080 if hoch else 1920, "height": 1920 if hoch else 1080, "file_type": "video/mp4"}]}]})
        assert anbieter == "pexels" and pfad == "videos/search" and params["orientation"] == "landscape"
        if "pexels" not in self.quellen:
            return _Antwort({"error": {"message": "Pexels-Schlüssel fehlt (Anbindungen → Pexels)"}}, 424)
        return _Antwort({"videos": [{"id": 1000 + n, "duration": 10, "url": f"https://www.pexels.com/video/{1000 + n}/", "user": {"name": f"Testfilmer {n}"}, "video_files": [{"link": f"https://videos.pexels.com/{1000 + n}.mp4", "width": 1920, "height": 1080, "file_type": "video/mp4"}]}]})


def _vb_lauf(tmp: Path, monkeypatch, kanal: dict | None = None, quellen: set[str] | None = None, probe: dict | None = None):
    from udd import schritte as sch

    text = "Eine alte Uhr tickt leise. Das Werk ist sauber geölt, die Zeiger laufen ruhig über das Zifferblatt. So sieht ein guter Kauf aus."
    skript = [{"nr": i, "abschnitt": "punkt-1", "text": f"Teil {i}: {text}", "bildidee": f"Uhr auf dem Tisch {i}", "einblendung": "Kernaussage: Zustand zählt" if i == 1 else ""} for i in range(1, 6)]
    l = _tts_lauf(tmp, kanal={"stil": "vollbild", "bildSek": 6, "stockClips": True, **(kanal or {})}, skript=skript, probe=probe)
    l.whiteboard = False
    l.seller = _VbSeller(tmp, quellen)
    l._claude, l.modell = object(), "test"
    gefragt: list[str] = []

    def fragen(_c, _m, prompt, **_kw):
        gefragt.append(prompt)
        szenen = []
        for nr, n in re.findall(r"Szene (\d+) \(n=(\d+)", prompt):
            szenen.append({"nr": int(nr), "bilder": [{"art": "clip" if k % 2 else "bild", "idee": f"Uhr Detail {nr}.{k}", "suche": f"watch closeup {nr} {k}", "wort": ["Teil", "Werk", "Zeiger", "Kauf"][k % 4]} for k in range(int(n))]})
        return json.dumps({"szenen": szenen}), {}

    monkeypatch.setattr(sch.ki, "fragen", fragen)
    clip = tmp / "testclip.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=25", "-t", "3", "-pix_fmt", "yuv420p", str(clip)], check=True)
    geladen: list[str] = []
    monkeypatch.setattr(sch, "_clip_laden", lambda _l, url, ziel: (geladen.append(url), shutil.copy(clip, ziel)))
    return l, gefragt, geladen


def test_vollbild_probe_bilder_alle_6s_mit_kamerafahrt_und_pexels_clips(tmp_path, monkeypatch):
    from udd import schritte as sch

    l, gefragt, geladen = _vb_lauf(tmp_path, monkeypatch, probe={"szene": 1})
    # Sprechzeit je Szene 14 s → 2 Bilder/Clips je Szene (alle ~6–7 s)
    l.seller.anbieter = (lambda alt: lambda _id, a, p, k, **kw: _Antwort(_tts_antwort(k["text"], tmp_path, 0.3, 14.0, 0.4)) if a == "elevenlabs" else alt(_id, a, p, k, **kw))(l.seller.anbieter)
    d, h = sch.probe(l)
    p = d["probe"]
    assert p["szenen"][:2] == [1, 2] and p["bilder"] >= 1 and p["clips"] >= 1
    assert len(gefragt) == 1 and "[video:bildplan]" in gefragt[0] and "n=2" in gefragt[0]
    assert geladen and all("pexels.com" in u for u in geladen)
    # erstes Bild jeder Szene = bisherige Bildidee (schon bezahltes Szenenbild wird wiederverwendet)
    assert any("Uhr auf dem Tisch 1" in b for b in l.seller.bilder)
    datei = l.seller.hochgeladen["probe"]
    info = medien.video_info(l.k.ffprobe, datei)
    assert (info["breite"], info["hoehe"]) == (1920, 1080) and 19 <= info["dauer"] <= 20.2

    def bild(t: float) -> Image.Image:
        roh = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", str(datei), "-frames:v", "1", "-vf", "scale=192:108", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:"], capture_output=True, check=True).stdout
        return Image.frombytes("RGB", (192, 108), roh)

    from PIL import ImageChops, ImageStat

    # Kamerafahrt: innerhalb eines Bildes ändert sich das Bild laufend (kein Standbild mehr)
    a, b = bild(1.0), bild(3.5)
    assert sum(ImageStat.Stat(ImageChops.difference(a, b)).mean) > 3
    # Plan je Szene gespeichert: 2 Elemente, Start beim Schlüsselwort, Clip mit Nachweis
    s1 = l.daten["skript"][0]["bilder"]
    assert len(s1) == 2 and s1[0]["start"] == 0 and s1[1]["art"] == "clip" and s1[1]["start"] > 2.5
    assert sch.clip_nachweis(l, l.daten["skript"]).startswith("Videos: Pexels (pexels.com) – Testfilmer")
    # ohne Pixabay-Schlüssel: Pixabay einmal gefragt (424), danach nur noch Pexels
    assert [q for q, _s in l.seller.suchen].count("pixabay") == 1
    # noch einmal: Plan, Bilder und Clips kommen aus dem Projekt – nichts doppelt bezahlt
    n_bilder, n_such = len(l.seller.bilder), [q for q, _s in l.seller.suchen].count("pexels")
    sch.probe(l)
    assert len(gefragt) == 1 and len(l.seller.bilder) == n_bilder and [q for q, _s in l.seller.suchen].count("pexels") == n_such


def test_vollbild_ohne_pexels_schluessel_bilder_statt_clips(tmp_path, monkeypatch):
    from udd import schritte as sch

    l, _g, geladen = _vb_lauf(tmp_path, monkeypatch, quellen=set(), probe={"szene": 3})
    l.seller.anbieter = (lambda alt: lambda _id, a, p, k, **kw: _Antwort(_tts_antwort(k["text"], tmp_path, 0.3, 9.0, 0.4)) if a == "elevenlabs" else alt(_id, a, p, k, **kw))(l.seller.anbieter)
    d, h = sch.probe(l)
    assert d["probe"]["clips"] == 0 and d["probe"]["bilder"] >= 3 and not geladen
    assert any("Keine Clip-Quelle verbunden" in x and "Pixabay" in x for x in h)
    assert [q for q, _s in l.seller.suchen] == ["pixabay", "pexels"]  # je Quelle einmal gefragt, dann nicht mehr


def test_vollbild_clips_zuerst_von_pixabay_sonst_pexels(tmp_path, monkeypatch):
    """1.4.1: Pexels vergibt keine neuen Schlüssel – Pixabay ist erste Quelle; passt dort nichts (Szene 2: nur
    Hochformat), sucht der Worker bei Pexels weiter. Nachweis nennt beide Quellen getrennt."""
    from udd import schritte as sch

    l, _g, geladen = _vb_lauf(tmp_path, monkeypatch, quellen={"pixabay", "pexels"}, probe={"szene": 1})
    l.seller.anbieter = (lambda alt: lambda _id, a, p, k, **kw: _Antwort(_tts_antwort(k["text"], tmp_path, 0.3, 14.0, 0.4)) if a == "elevenlabs" else alt(_id, a, p, k, **kw))(l.seller.anbieter)
    d, _h = sch.probe(l)
    assert d["probe"]["clips"] >= 2
    s1, s2 = l.daten["skript"][0]["bilder"], l.daten["skript"][1]["bilder"]
    assert s1[1]["clip"].startswith("pixabay-") and not str(s2[1]["clip"]).startswith("pixabay-")
    assert any("cdn.pixabay.com" in u for u in geladen) and any("pexels.com" in u for u in geladen)
    assert l.p.state["stock"][s1[1]["clip"]]["quelle"] == "pixabay"
    n = sch.clip_nachweis(l, l.daten["skript"])
    assert n.startswith("Videos: Pixabay (pixabay.com) – Pixafilmer") and "; Pexels (pexels.com) – Testfilmer" in n
    # Szene 1 nur bei Pixabay gesucht, Szene 2 bei beiden
    assert [q for q, s in l.seller.suchen if s.startswith("watch closeup 1 ")] == ["pixabay"]
    assert [q for q, s in l.seller.suchen if s.startswith("watch closeup 2 ")] == ["pixabay", "pexels"]
    assert sch.CLIP_HOSTS[0] == "pixabay.com"
