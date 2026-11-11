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
