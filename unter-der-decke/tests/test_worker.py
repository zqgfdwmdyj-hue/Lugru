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


def test_takt_plan_motive_beim_schluesselwort_und_kurze_zeichenzeit():
    text = "Erst kommt die Sanduhr, dann nach einer Weile der Wecker und zum Schluss das Glas."
    zeiten = wb.wortzeiten(text, _ausrichtung(text, 0.1))  # ~8,4 s Sprache
    arten = ["text", "motiv", "motiv", "motiv"]
    plan, k = wb.takt_plan(arten, [None, "Sanduhr", "Wecker", "Glas"], 9.0, wb.draw_s("normal"), zeiten)
    motive = [e for e in plan if e.art == "motiv"]
    assert [round(e.start, 1) for e in motive] == [round(text.index(w) * 0.1, 1) for w in ("Sanduhr", "Wecker", "Glas")]
    assert all(e.dauer == 2.0 for e in motive)  # Tempo „normal“: 2,0 s je Motiv, nicht auf die Szene gedehnt
    assert plan[0].art == "text" and plan[0].start == wb.WISCH_S  # Überschrift gleich zu Beginn
    assert k["maxPause"] <= wb.MAX_PAUSE and k["drawS"] == 2.0
    assert wb.draw_s("ruhig") == 2.5 and wb.draw_s("schnell") == 1.5 and wb.draw_s(None) == 2.0


def test_takt_plan_fuellt_luecken_mit_hervorhebungen_und_verteilt_ohne_wortzeiten():
    # 12 s Szene, nur zwei Motive ohne Wortzeiten → gleichmäßig verteilt, Lücken > 2,6 s mit Hervorhebungen gefüllt
    plan, k = wb.takt_plan(["motiv", "motiv"], [None, None], 12.0, 1.5, [])
    assert k["hervorhebungen"] >= 2 and k["maxPause"] <= wb.MAX_PAUSE
    hervor = [e for e in plan if e.art == "hervorhebung"]
    assert {e.form for e in hervor} <= {"kreis", "pfeil"} and all(e.index in (0, 1) for e in hervor)
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
