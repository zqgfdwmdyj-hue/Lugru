"""Die sieben Schritte: research → script → voice → visuals → render → package → upload.

Jeder Schritt ist einzeln startbar und wiederaufnehmbar: Ergebnisse stehen in state.json, bezahlte Dateien (Sprache,
Bilder) liegen mit Inhalts-Hash im Projektordner und werden nie doppelt erzeugt.
"""

from __future__ import annotations

import base64
import json
import platform
import re
import shutil
from typing import Any, Callable

import requests

from . import ki, medien
from .filter import ERSATZ_BILDIDEE, bild_treffer, titel_treffer
from .konfig import Konfig
from .projekt import Projekt, kurz_hash, schreiben_atomar
from .seller import Seller

REIHENFOLGE = ["research", "script", "voice", "visuals", "render", "package", "upload"]
MODELL_STANDARD = "claude-opus-5-5"
PAUSE_S = 0.4  # kurze Pause nach jeder Szene
PRIVAT = "private"  # Sichtbarkeit beim Upload – fest, im System nicht änderbar
ABSCHNITTE = ["hook", "angst"] + [f"punkt-{i}" for i in range(1, 8)] + ["zusammenfassung", "cta"]


class Abgebrochen(Exception):
    pass


def woerter(text: str) -> int:
    return len(re.findall(r"\b[\wÄÖÜäöüß'-]+\b", text))


class Lauf:
    def __init__(self, k: Konfig, seller: Seller, auftrag: dict[str, Any]):
        self.k = k
        self.seller = seller
        self.a = auftrag
        self.id: str = auftrag["id"]
        self.kanal: dict[str, Any] = auftrag["kanal"]
        self.daten: dict[str, Any] = dict(auftrag.get("daten") or {})
        self.streng = self.kanal.get("sicherheitsstufe") == "streng"
        # Modell: CLAUDE_MODELL am PC (falls gesetzt) vor der Einstellung im Seller-System
        self.modell: str = k.claude_modell or auftrag.get("modell") or MODELL_STANDARD
        self.p = Projekt(k.arbeitsordner, self.kanal["slug"], self.id)
        # Kanalprofil als Datei im Worker (zum Nachsehen; bearbeitet wird es im Seller-System)
        schreiben_atomar(k.arbeitsordner / self.kanal["slug"] / "kanal.json", json.dumps(self.kanal, ensure_ascii=False, indent=1).encode("utf-8"))
        self._claude = None

    @property
    def claude(self):
        if self._claude is None:
            self._claude = ki.client(self.k.seller_url, self.k.token, self.id)
        return self._claude

    def fortschritt(self, schritt: str, fertig: int, gesamt: int) -> None:
        r = self.seller.schritt(self.id, schritt, "laeuft", fortschritt={"fertig": fertig, "gesamt": gesamt})
        if not r.get("weiter", True):
            raise Abgebrochen(r.get("status") or "abgebrochen")

    def kopf(self) -> str:
        k = self.kanal
        teile = [f"Kanal: „{k['name']}“" + (f" ({k['handle']})" if k.get("handle") else ""), f"Sprache: {k.get('sprache') or 'de'}"]
        if k.get("themenbereich"):
            teile.append(f"Themenbereich: {k['themenbereich']}")
        if self.streng:
            teile.append("Sicherheitsstufe STRENG: sachlich und respektvoll, keine expliziten Begriffe, keine Beschreibung sexueller Handlungen, keine Nacktheit, nichts Reißerisches.")
        return "\n".join(teile)

    def vidiq(self) -> str:
        v = self.a.get("vidiq") or {}
        teile = []
        if v.get("keywords"):
            teile.append(f"Keywords/Ideen aus vidIQ (berücksichtigen, wo sie passen):\n{v['keywords']}")
        if v.get("titel"):
            teile.append(f"Titelvorschläge aus vidIQ (als Anregung):\n{v['titel']}")
        return "\n\n".join(teile)

    def anmerkung(self) -> str:
        h = (self.a.get("hinweis") or "").strip()
        return f"Anmerkung von Ludwig (unbedingt umsetzen):\n{h}" if h else ""


# ---- 1 research -----------------------------------------------------------------------------------------------------


def research(l: Lauf) -> tuple[dict, list[str]]:
    if l.p.erledigt("research"):
        e = l.p.state["schritte"]["research"]
        return {"gliederung": e["gliederung"], "quellen": e["quellen"]}, e.get("hinweise", [])
    prompt = "\n\n".join(
        x
        for x in [
            "[video:research]",
            "Du recherchierst für ein YouTube-Video (10–12 Minuten) mit konkretem Nutzen für die Zuschauer.",
            l.kopf(),
            f"Thema: {l.a['thema']}",
            l.vidiq(),
            l.anmerkung(),
            "Aufgabe: Suche im Web nach belastbaren Quellen (Studien, Fachartikel, Statistiken; bevorzugt begutachtete Studien mit Jahr) "
            "und erstelle die Gliederung: Hook → Fear Activation (warum es den Zuschauer betrifft) → 5–7 Punkte, jeder mit mindestens einer Studie → Zusammenfassung → Call-to-Action.",
            "Regeln: Keine Aussage ohne Quelle. Nur Quellen, die du in der Suche wirklich gefunden hast, mit URL. Keine erfundenen Studien, Autoren oder Zahlen.",
            'Antworte am Ende NUR mit JSON in diesem Format: {"hook": "…", "angst": "…", "punkte": [{"titel": "…", "kern": "…", "quelle_ids": ["Q1"]}], '
            '"fazit": "…", "cta": "…", "quellen": [{"id": "Q1", "titel": "…", "url": "https://…", "jahr": 2021, "art": "Studie", "autoren": "…"}]}',
        ]
        if x
    )
    text, urls = ki.fragen(l.claude, l.modell, prompt, websuche=8, max_tokens=16000)
    d = ki.json_aus(text)
    quellen = [q for q in d.get("quellen", []) if isinstance(q, dict) and q.get("id")]
    gefunden = {u.rstrip("/").lower() for u in urls}
    for q in quellen:
        q["gefunden"] = bool(q.get("url")) and str(q["url"]).rstrip("/").lower() in gefunden
    ids = {q["id"] for q in quellen}
    punkte = [p for p in d.get("punkte", []) if isinstance(p, dict) and p.get("titel")]
    hinweise: list[str] = []
    if not 5 <= len(punkte) <= 7:
        hinweise.append(f"Gliederung hat {len(punkte)} Punkte (Ziel 5–7).")
    for i, p in enumerate(punkte, 1):
        p["quelle_ids"] = [q for q in p.get("quelle_ids", []) if q in ids]
        if not p["quelle_ids"]:
            hinweise.append(f"Punkt {i} „{p['titel']}“ hat keine Quelle.")
    if urls:
        ohne = [q["id"] for q in quellen if not q["gefunden"]]
        if ohne:
            hinweise.append(f"Quellen {', '.join(ohne)} stammen nicht direkt aus den Suchtreffern – bitte prüfen.")
    gliederung = {"hook": d.get("hook"), "angst": d.get("angst"), "punkte": punkte, "fazit": d.get("fazit"), "cta": d.get("cta")}
    l.p.markieren("research", gliederung=gliederung, quellen=quellen, hinweise=hinweise)
    return {"gliederung": gliederung, "quellen": quellen}, hinweise


# ---- 2 script ------------------------------------------------------------------------------------------------------

SKRIPT_SCHEMA = {
    "type": "object",
    "properties": {
        "szenen": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "abschnitt": {"type": "string", "enum": ABSCHNITTE},
                    "text": {"type": "string"},
                    "bildidee": {"type": "string"},
                    "einblendung": {"type": "string"},
                    "quelle_ids": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["abschnitt", "text", "bildidee", "einblendung", "quelle_ids"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["szenen"],
    "additionalProperties": False,
}


def skript_pruefen(szenen: list[dict], quellen: list[dict]) -> list[str]:
    ids = {q["id"] for q in quellen}
    probleme: list[str] = []
    n = sum(woerter(s["text"]) for s in szenen)
    if not 1500 <= n <= 1700:
        probleme.append(f"Das Skript hat {n} Wörter – nötig sind 1.500–1.700.")
    punkte = sorted({s["abschnitt"] for s in szenen if s["abschnitt"].startswith("punkt-")})
    if not 5 <= len(punkte) <= 7:
        probleme.append(f"Das Skript hat {len(punkte)} Punkte – nötig sind 5–7.")
    fremd = sorted({q for s in szenen for q in s.get("quelle_ids", []) if q not in ids})
    if fremd:
        probleme.append(f"Quellen {', '.join(fremd)} stehen nicht in der Quellenliste.")
    ohne = [i + 1 for i, s in enumerate(szenen) if s["abschnitt"].startswith("punkt-") and not s.get("quelle_ids")]
    if ohne:
        probleme.append(f"Szenen {', '.join(map(str, ohne))} (Punkte) haben keine Quelle.")
    return probleme


def script(l: Lauf) -> tuple[dict, list[str]]:
    if l.p.erledigt("script"):
        e = l.p.state["schritte"]["script"]
        return {"skript": e["skript"], "woerter": e["woerter"]}, e.get("hinweise", [])
    quellen = l.daten.get("quellen") or []
    basis = "\n\n".join(
        x
        for x in [
            "[video:script]",
            "Schreibe das Sprechskript für ein YouTube-Video (10–12 Minuten Sprechzeit).",
            l.kopf(),
            f"Thema: {l.a['thema']}",
            f"Freigegebene Gliederung:\n{json.dumps(l.daten.get('gliederung'), ensure_ascii=False)}",
            f"Quellenliste (nur diese IDs verwenden):\n{json.dumps(quellen, ensure_ascii=False)}",
            l.vidiq(),
            l.anmerkung(),
            "Aufbau: hook → angst (Fear Activation) → punkt-1 … punkt-N (5–7 Punkte, je 2–4 Szenen) → zusammenfassung → cta.",
            "Länge: insgesamt 1.500–1.700 Wörter (zähle mit), 20–32 Szenen mit je 40–90 Wörtern. Gesprochene Sprache, kurze Sätze, direkte Ansprache.",
            "Jede Behauptung braucht eine Quelle: in den Punkt-Szenen die Studie im Text nennen (z. B. „Eine Studie aus 2016 mit 2.400 Paaren zeigt …“) und die ID in quelle_ids eintragen.",
            "bildidee: ruhiges Symbolbild, Illustration oder Infografik – keine erkennbaren realen Personen, keine Nacktheit, nichts Intimes"
            + (", kein Bett, kein Kuss, keine Berührung" if l.streng else "")
            + ". einblendung: kurzer Text fürs Bild (höchstens 8 Wörter, z. B. Studie + Jahr) oder leer.",
        ]
        if x
    )
    prompt = basis
    szenen: list[dict] = []
    probleme: list[str] = []
    for versuch in range(2):
        text, _ = ki.fragen(l.claude, l.modell, prompt, schema=SKRIPT_SCHEMA, max_tokens=24000)
        szenen = [s for s in ki.json_aus(text).get("szenen", []) if s.get("text", "").strip()]
        probleme = skript_pruefen(szenen, quellen)
        if not probleme:
            break
        prompt = basis + "\n\nKorrektur zum ersten Entwurf: " + " ".join(probleme) + " Bitte das ganze Skript neu und korrekt liefern."
    for i, s in enumerate(szenen, 1):
        s["nr"] = i
        s["einblendung"] = (s.get("einblendung") or "").strip() or None
    n = sum(woerter(s["text"]) for s in szenen)
    l.p.markieren("script", skript=szenen, woerter=n, hinweise=probleme)
    return {"skript": szenen, "woerter": n}, probleme


# ---- 3 voice -------------------------------------------------------------------------------------------------------


def voice(l: Lauf) -> tuple[dict, list[str]]:
    szenen = l.daten.get("skript") or []
    stimme = (l.kanal.get("stimmeId") or "").strip()
    if not stimme:
        raise RuntimeError("Im Kanalprofil fehlt die Stimme (ElevenLabs-Voice-ID).")
    modell = "eleven_multilingual_v2"
    for i, s in enumerate(szenen):
        schluessel = kurz_hash(stimme, modell, s["text"])
        datei = l.p.datei_vorhanden("voice", schluessel)
        if not datei:
            r = l.seller.anbieter(l.id, "elevenlabs", f"v1/text-to-speech/{stimme}?output_format=mp3_44100_128", {"text": s["text"], "model_id": modell}, timeout=240)
            if r.status_code != 200:
                raise RuntimeError(f"ElevenLabs (Szene {i + 1}): {_fehlertext(r)}")
            rel = f"voice/{i + 1:03d}-{schluessel}.mp3"
            schreiben_atomar(l.p.pfad(rel), r.content)
            l.p.datei_merken("voice", schluessel, rel, dauer=round(medien.dauer(l.k.ffprobe, l.p.pfad(rel)), 3))
        s["dauer"] = round(l.p.state["voice"][schluessel]["dauer"] + PAUSE_S, 3)
        s["_voice"] = schluessel
        l.fortschritt("voice", i + 1, len(szenen))
    gesamt = round(sum(s["dauer"] for s in szenen))
    l.p.markieren("voice")
    return {"skript": _ohne_intern(szenen), "dauerSek": gesamt}, []


# ---- 4 visuals -----------------------------------------------------------------------------------------------------


def _bild_holen(l: Lauf, prompt: str) -> bytes | None:
    """Ein Bild bei OpenAI (gpt-image-1, 1536×1024, medium). None = vom Anbieter abgelehnt."""
    r = l.seller.anbieter(l.id, "openai", "v1/images/generations", {"model": "gpt-image-1", "prompt": prompt, "size": "1536x1024", "quality": "medium", "n": 1}, timeout=300)
    if r.status_code == 200:
        return base64.b64decode(r.json()["data"][0]["b64_json"])
    text = _fehlertext(r)
    if r.status_code == 400 and re.search(r"moderation|safety|content.?policy|rejected", text, re.I):
        return None
    raise RuntimeError(f"Bildanbieter: {text}")


def visuals(l: Lauf) -> tuple[dict, list[str]]:
    szenen = l.daten.get("skript") or []
    stil = (l.kanal.get("bildstil") or "Moderne, ruhige Illustration in warmen Farben").strip()
    hinweise: list[str] = []
    for i, s in enumerate(szenen):
        idee = s.get("bildidee") or ""
        treffer = bild_treffer(idee, l.streng)
        if treffer:
            hinweise.append(f"Szene {i + 1}: Bildidee enthielt „{treffer}“ – Ersatzmotiv verwendet.")
            idee = ERSATZ_BILDIDEE
        prompt = f"{stil}. {idee}. Symbolbild ohne Text und ohne Schrift, keine erkennbaren realen Personen, keine Nacktheit."
        schluessel = kurz_hash(prompt)
        ersatz = bool(treffer)
        if not l.p.datei_vorhanden("bilder", schluessel):
            daten = _bild_holen(l, prompt)
            if daten is None:
                hinweise.append(f"Szene {i + 1}: Bildanbieter hat abgelehnt – Ersatzbild.")
                ersatz = True
                daten = _bild_holen(l, f"{stil}. {ERSATZ_BILDIDEE}. Symbolbild ohne Text.")
            rel = f"bilder/{i + 1:03d}-{schluessel}.png"
            if daten is None:
                medien.ersatzbild(s.get("einblendung") or "", l.p.pfad(rel))
            else:
                schreiben_atomar(l.p.pfad(rel), daten)
            l.p.datei_merken("bilder", schluessel, rel, ersatz=ersatz)
        s["ersatzbild"] = bool(l.p.state["bilder"][schluessel].get("ersatz"))
        s["_bild"] = schluessel
        l.fortschritt("visuals", i + 1, len(szenen))
    l.p.markieren("visuals", hinweise=hinweise)
    return {"skript": _ohne_intern(szenen)}, hinweise


# ---- 5 render ------------------------------------------------------------------------------------------------------


def _schluessel_szene(l: Lauf, s: dict) -> tuple[str, str]:
    stimme = (l.kanal.get("stimmeId") or "").strip()
    v = kurz_hash(stimme, "eleven_multilingual_v2", s["text"])
    stil = (l.kanal.get("bildstil") or "Moderne, ruhige Illustration in warmen Farben").strip()
    idee = ERSATZ_BILDIDEE if bild_treffer(s.get("bildidee") or "", l.streng) else (s.get("bildidee") or "")
    b = kurz_hash(f"{stil}. {idee}. Symbolbild ohne Text und ohne Schrift, keine erkennbaren realen Personen, keine Nacktheit.")
    return v, b


def render(l: Lauf) -> tuple[dict, list[str]]:
    video = l.p.pfad("video.mp4")
    if l.p.erledigt("render") and video.exists():
        e = l.p.state["schritte"]["render"]
        return {"dauerSek": e["dauer"]}, e.get("hinweise", [])
    szenen = l.daten.get("skript") or []
    clips = l.p.pfad("clips", "x").parent
    namen: list[str] = []
    srt_gesamt: list[str] = []
    t = 0.0
    nr = 1
    for i, s in enumerate(szenen):
        v, b = _schluessel_szene(l, s)
        ton = l.p.datei_vorhanden("voice", v)
        bild = l.p.datei_vorhanden("bilder", b)
        if not ton or not bild:
            raise RuntimeError(f"Szene {i + 1}: Sprache oder Bild fehlt – bitte Schritt „Sprache“/„Bilder“ wiederholen.")
        laenge = l.p.state["voice"][v]["dauer"] + PAUSE_S
        teile = medien.untertitel_teile(s["text"], laenge - PAUSE_S)
        srt_gesamt.append(medien.srt(teile, versatz=t, start_nr=nr))
        nr += len(teile)
        name = f"{i + 1:03d}"
        key = kurz_hash(v, b, s.get("einblendung") or "", str(l.k.fps))
        if not (l.p.state["clips"].get(name, {}).get("key") == key and (clips / f"{name}.mp4").exists()):
            medien.szenenbild(bild, s.get("einblendung"), clips / f"{name}.png")
            (clips / f"{name}.srt").write_text(medien.srt(teile), encoding="utf-8")
            medien.clip(l.k.ffmpeg, clips, f"{name}.png", "../" + ton.relative_to(l.p.ordner).as_posix(), f"{name}.srt", f"{name}.mp4", laenge, l.k.fps)
            l.p.state["clips"][name] = {"key": key}
            l.p.speichern()
        namen.append(f"{name}.mp4")
        t += laenge
        l.fortschritt("render", i + 1, len(szenen) + 1)
    medien.zusammenfuegen(l.k.ffmpeg, clips, namen, "gesamt.mp4")
    hinweise: list[str] = []
    musik = (l.kanal.get("musik") or "").strip()
    if musik and (l.k.musikordner / musik).exists():
        medien.musik_unterlegen(l.k.ffmpeg, l.k.ffprobe, clips / "gesamt.mp4", l.k.musikordner / musik, l.p.pfad("video.teil.mp4"))
        l.p.pfad("video.teil.mp4").replace(video)
    else:
        if musik:
            hinweise.append(f"Musik „{musik}“ liegt nicht im Musikordner – Video ohne Musik.")
        shutil.move(str(clips / "gesamt.mp4"), video)
    schreiben_atomar(l.p.pfad("untertitel.srt"), "".join(srt_gesamt).encode("utf-8"))
    info = medien.video_info(l.k.ffprobe, video)
    if (info["breite"], info["hoehe"]) != (1920, 1080):
        raise RuntimeError(f"Video hat {info['breite']}×{info['hoehe']} statt 1920×1080.")
    dauer = round(info["dauer"])
    if not 600 <= dauer <= 720:
        hinweise.append(f"Video ist {dauer // 60}:{dauer % 60:02d} lang (Ziel 10–12 Min.).")
    l.p.zwischendateien_loeschen()
    l.fortschritt("render", len(szenen) + 1, len(szenen) + 1)
    l.p.markieren("render", dauer=dauer, hinweise=hinweise)
    return {"dauerSek": dauer}, hinweise


# ---- 6 package -----------------------------------------------------------------------------------------------------

PAKET_SCHEMA = {
    "type": "object",
    "properties": {
        "titel": {"type": "array", "items": {"type": "string"}},
        "beschreibung": {"type": "string"},
        "tags": {"type": "array", "items": {"type": "string"}},
        "thumbnail_text": {"type": "string"},
    },
    "required": ["titel", "beschreibung", "tags", "thumbnail_text"],
    "additionalProperties": False,
}


def _paket_erzeugen(l: Lauf) -> dict:
    szenen = l.daten.get("skript") or []
    basis = "\n\n".join(
        x
        for x in [
            "[video:package]",
            "Erstelle das Upload-Paket für ein fertiges YouTube-Video.",
            l.kopf(),
            f"Thema: {l.a['thema']}",
            f"Gliederung:\n{json.dumps(l.daten.get('gliederung'), ensure_ascii=False)}",
            "Skript (gekürzt):\n" + "\n".join(f"[{s['abschnitt']}] {s['text'][:220]}" for s in szenen),
            l.vidiq(),
            "Liefere: genau 5 Titelvarianten (höchstens 70 Zeichen, neugierig, ehrlich, kein Clickbait ohne Inhalt, keine expliziten Begriffe), "
            "eine Beschreibung (3–5 Absätze, ohne Kapitel und ohne Quellen – die hängt das System an), 12–20 Tags, "
            "und einen Thumbnail-Text mit höchstens 4 Wörtern.",
        ]
        if x
    )
    prompt = basis
    d: dict = {}
    for _ in range(2):
        text, _u = ki.fragen(l.claude, l.modell, prompt, schema=PAKET_SCHEMA, max_tokens=8000, effort="low")
        d = ki.json_aus(text)
        treffer = [t for t in d.get("titel", []) + [d.get("thumbnail_text", "")] if titel_treffer(t)]
        if not treffer:
            break
        prompt = basis + f"\n\nKorrektur: Diese Titel enthalten unpassende Begriffe und müssen ersetzt werden: {treffer}"
    return d


def package(l: Lauf) -> tuple[dict, list[str]]:
    szenen = l.daten.get("skript") or []
    gliederung = l.daten.get("gliederung") or {}
    quellen = l.daten.get("quellen") or []
    e = l.p.state["schritte"].get("package") or {}
    if l.p.erledigt("package") and e.get("paket"):
        # schon fertig (z. B. Neustart): nur noch fehlende Sicherungen nachholen, nichts neu erzeugen
        _dateien_sichern(l)
        return {"paket": e["paket"]}, e["paket"].get("warnungen") or []
    d = e.get("roh") or _paket_erzeugen(l)
    l.p.state["schritte"]["package"] = {**e, "roh": d}
    l.p.speichern()

    titel = [t.strip()[:100] for t in d.get("titel", []) if t.strip()][:5]
    warnungen = [f"Titel „{t}“ enthält „{titel_treffer(t)}“ – bitte ändern." for t in titel if titel_treffer(t)]
    if len(titel) < 5:
        warnungen.append(f"Nur {len(titel)} Titel erzeugt.")
    daumen = " ".join((d.get("thumbnail_text") or "").split()[:4])
    if titel_treffer(daumen):
        warnungen.append(f"Thumbnail-Text „{daumen}“ enthält „{titel_treffer(daumen)}“.")

    namen = {"intro": "Intro", "zusammenfassung": "Zusammenfassung"}
    for i, p in enumerate(gliederung.get("punkte") or [], 1):
        namen[f"punkt-{i}"] = f"{i}. {p.get('titel', '')}".strip()
    kap = medien.kapitel(szenen, namen)
    if not kap:
        warnungen.append("Zu wenige Abschnitte für YouTube-Kapitel (mind. 3 × 10 s).")
    q_text = "\n".join(f"- {q.get('titel', '')}" + (f" ({q['jahr']})" if q.get("jahr") else "") + (f" {q['url']}" if q.get("url") else "") for q in quellen)
    beschreibung = (d.get("beschreibung") or "").strip()
    if kap:
        beschreibung += "\n\nKapitel:\n" + medien.kapitel_text(kap)
    if q_text:
        beschreibung += "\n\nQuellen:\n" + q_text
    beschreibung = beschreibung[:4900]
    tags: list[str] = []
    laenge = 0
    for t in d.get("tags", []):
        t = re.sub(r"[<>]", "", t).strip()
        if t and t.lower() not in {x.lower() for x in tags} and laenge + len(t) + 1 <= 480:
            tags.append(t)
            laenge += len(t) + 1

    # Dateien erzeugen und ins Seller-System sichern (erst dann gilt das Paket als fertig)
    erstes_bild = None
    if szenen:
        _v, b = _schluessel_szene(l, szenen[0])
        erstes_bild = l.p.datei_vorhanden("bilder", b)
    medien.thumbnail(erstes_bild, daumen or l.a["thema"], l.p.pfad("thumbnail.png"))
    skript_txt = "\n\n".join(f"[{s['abschnitt']}] {s['text']}" + (f"\n(Quellen: {', '.join(s.get('quelle_ids') or [])})" if s.get("quelle_ids") else "") for s in szenen)
    schreiben_atomar(l.p.pfad("skript.txt"), f"{l.a['thema']}\n\n{skript_txt}\n".encode("utf-8"))
    schreiben_atomar(l.p.pfad("quellen.json"), json.dumps(quellen, ensure_ascii=False, indent=1).encode("utf-8"))
    video = l.p.pfad("video.mp4")
    if not video.exists():
        raise RuntimeError("video.mp4 fehlt – bitte Schritt „Render“ wiederholen.")
    _dateien_sichern(l)
    paket = {"titel": titel, "titelGewaehlt": 0, "beschreibung": beschreibung, "kapitel": kap, "tags": tags, "thumbnailText": daumen or None, "warnungen": warnungen}
    l.p.markieren("package", roh=d, paket=paket)
    return {"paket": paket}, warnungen



# ---- Dateien sichern: Google Drive (direkt) oder Seller-Server ------------------------------------------------------

DATEIEN = [("thumbnail", "thumbnail.png", "image/png"), ("skript", "skript.txt", "text/plain"), ("quellen", "quellen.json", "application/json"), ("untertitel", "untertitel.srt", "application/x-subrip"), ("mp4", "video.mp4", "video/mp4")]


def _drive_hochladen(z: dict, pfad, name: str, mime: str) -> tuple[str, str | None]:
    """Resumable Upload direkt nach Google Drive (Token vom Seller-System, nur drive.file)."""
    groesse = pfad.stat().st_size
    kopf = {"Authorization": f"Bearer {z['accessToken']}"}
    r = requests.post(z["uploadUrl"], json={"name": name, "parents": [z["ordnerId"]]}, headers={**kopf, "X-Upload-Content-Type": mime, "X-Upload-Content-Length": str(groesse)}, timeout=60)
    if r.status_code >= 400 or not r.headers.get("Location"):
        raise RuntimeError(f"Google Drive: Upload starten – {_fehlertext(r)}")
    with pfad.open("rb") as f:
        r = requests.put(r.headers["Location"], data=f, headers={**kopf, "Content-Type": mime, "Content-Length": str(groesse)}, timeout=7200)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"Google Drive: Upload – {_fehlertext(r)}")
    j = r.json()
    return j["id"], j.get("webViewLink")


def _dateien_sichern(l: Lauf) -> None:
    """Ablage „Drive“: alle Dateien direkt nach Drive, die kleinen zusätzlich ins Seller-System (Anzeige).
    Ablage „Server“: alles ins Seller-System. Bereits Gesichertes (gleiche Größe/Zeit) wird übersprungen."""
    hoch = l.p.state.setdefault("hochgeladen", {})
    z = l.seller.drive_zugang(l.id)
    drive = z.get("ablage") == "drive"
    for art, name, mime in DATEIEN:
        pfad = l.p.pfad(name)
        if not pfad.exists():
            continue
        merkmal = f"{pfad.stat().st_size}:{int(pfad.stat().st_mtime)}"
        if not (drive and art == "mp4") and hoch.get(art) != merkmal:
            l.seller.datei_hochladen(l.id, art, pfad)
            hoch[art] = merkmal
            l.p.speichern()
        if drive:
            d = hoch.get(f"drive:{art}") or {}
            if d.get("merkmal") != merkmal:
                file_id, link = _drive_hochladen(z, pfad, name, mime)
                d = {"merkmal": merkmal, "id": file_id, "link": link, "gemeldet": False}
                hoch[f"drive:{art}"] = d
                l.p.speichern()
            if not d.get("gemeldet"):
                l.seller.drive_melden(l.id, art, d["id"], pfad.stat().st_size, d.get("link"))
                d["gemeldet"] = True
                l.p.speichern()


def _video_holen(l: Lauf, video) -> None:
    """Für den YouTube-Upload: Video vom PC, sonst aus Google Drive bzw. dem Seller-System holen."""
    if video.exists():
        return
    drive_id = ((l.a.get("dateien") or {}).get("mp4") or {}).get("drive")
    if drive_id:
        z = l.seller.drive_zugang(l.id)
        if z.get("ablage") != "drive":
            raise RuntimeError("Video liegt in Google Drive, aber Drive ist nicht mehr verbunden.")
        r = requests.get(f"{z['apiBasis']}/files/{drive_id}?alt=media&supportsAllDrives=true", headers={"Authorization": f"Bearer {z['accessToken']}"}, stream=True, timeout=7200)
        if r.status_code != 200:
            raise RuntimeError(f"Google Drive: Video holen – {_fehlertext(r)}")
        teil = video.with_name(video.name + ".teil")
        with teil.open("wb") as f:
            for block in r.iter_content(1024 * 1024):
                f.write(block)
        teil.replace(video)
        return
    if not l.seller.datei_holen(l.id, "mp4", video):
        raise RuntimeError("Video-Datei weder am PC noch im Seller-System gefunden.")

# ---- 7 upload (immer privat) -----------------------------------------------------------------------------------------


def upload(l: Lauf) -> tuple[dict, list[str]]:
    video = l.p.pfad("video.mp4")
    _video_holen(l, video)
    thumb = l.p.pfad("thumbnail.png")
    if not thumb.exists():
        l.seller.datei_holen(l.id, "thumbnail", thumb)
    paket = l.daten.get("paket") or {}
    titel_liste = paket.get("titel") or [l.a["thema"]]
    titel = titel_liste[min(len(titel_liste) - 1, max(0, int(paket.get("titelGewaehlt") or 0)))]
    hinweise: list[str] = []
    yt = l.p.state.setdefault("youtube", {})
    if not yt.get("id"):
        z = l.seller.youtube_zugang(l.id)
        kopf = {"Authorization": f"Bearer {z['accessToken']}"}
        groesse = video.stat().st_size
        if not yt.get("sitzung"):
            meta = {
                "snippet": {"title": titel[:100], "description": paket.get("beschreibung", "")[:5000], "tags": paket.get("tags", []), "categoryId": "27", "defaultLanguage": l.kanal.get("sprache") or "de", "defaultAudioLanguage": l.kanal.get("sprache") or "de"},
                "status": {"privacyStatus": PRIVAT, "selfDeclaredMadeForKids": False},
            }
            r = requests.post(f"{z['uploadBasis']}/youtube/v3/videos?uploadType=resumable&part=snippet,status", json=meta, headers={**kopf, "X-Upload-Content-Length": str(groesse), "X-Upload-Content-Type": "video/mp4"}, timeout=60)
            if r.status_code >= 400 or not r.headers.get("Location"):
                raise RuntimeError(f"YouTube-Upload starten: {_fehlertext(r)}")
            yt["sitzung"] = r.headers["Location"]
            l.p.speichern()
        start = 0
        # Fortsetzen nach Abbruch: fragen, was schon angekommen ist
        r = requests.put(yt["sitzung"], headers={**kopf, "Content-Range": f"bytes */{groesse}", "Content-Length": "0"}, timeout=60)
        if r.status_code in (200, 201):
            antwort = r.json()
        else:
            if r.status_code == 308 and r.headers.get("Range"):
                start = int(r.headers["Range"].split("-")[1]) + 1
            elif r.status_code == 404:
                yt.pop("sitzung", None)
                l.p.speichern()
                raise RuntimeError("Upload-Sitzung abgelaufen – bitte Schritt wiederholen.")
            with video.open("rb") as f:
                f.seek(start)
                r = requests.put(yt["sitzung"], data=f, headers={**kopf, "Content-Type": "video/mp4", "Content-Length": str(groesse - start), "Content-Range": f"bytes {start}-{groesse - 1}/{groesse}"}, timeout=7200)
            if r.status_code not in (200, 201):
                raise RuntimeError(f"YouTube-Upload: {_fehlertext(r)}")
            antwort = r.json()
        yt["id"] = antwort["id"]
        l.p.speichern()
        if thumb.exists():
            r = requests.post(f"{z['uploadBasis']}/youtube/v3/thumbnails/set?videoId={yt['id']}", data=thumb.read_bytes(), headers={**kopf, "Content-Type": "image/png"}, timeout=120)
            if r.status_code >= 400:
                hinweise.append(f"Thumbnail nicht gesetzt ({_fehlertext(r)}) – in YouTube Studio von Hand hochladen.")
    b = l.seller.youtube_bestaetigen(l.id, yt["id"])
    if not b.get("privat"):
        raise RuntimeError(f"Video ist NICHT privat (Sichtbarkeit: {b.get('sichtbarkeit')}) – sofort in YouTube Studio prüfen!")
    l.p.markieren("upload", youtube=yt["id"])
    return {}, hinweise


# ---- Ablauf --------------------------------------------------------------------------------------------------------

SCHRITTE: dict[str, Callable[[Lauf], tuple[dict, list[str]]]] = {"research": research, "script": script, "voice": voice, "visuals": visuals, "render": render, "package": package, "upload": upload}


def _ohne_intern(szenen: list[dict]) -> list[dict]:
    return [{k: v for k, v in s.items() if not k.startswith("_")} for s in szenen]


def _fehlertext(r: requests.Response) -> str:
    try:
        d = r.json()
        e = d.get("error") if isinstance(d, dict) else None
        if isinstance(e, dict):
            return f"HTTP {r.status_code}: {e.get('message') or e.get('code')}"
        if isinstance(d, dict) and d.get("detail"):
            det = d["detail"]
            return f"HTTP {r.status_code}: {det.get('message') if isinstance(det, dict) else det}"
        if isinstance(d, dict) and d.get("fehler"):
            return f"HTTP {r.status_code}: {d['fehler']}"
    except ValueError:
        pass
    return f"HTTP {r.status_code}: {r.text[:200]}"


def ausfuehren(k: Konfig, seller: Seller, auftrag: dict[str, Any], log: Callable[[str], None] = print) -> None:
    """Auftrag ab seinem aktuellen Schritt abarbeiten, bis eine Freigabe ansteht, er fertig ist oder ein Fehler kommt."""
    l = Lauf(k, seller, auftrag)
    wdh = auftrag.get("wiederholen")
    if wdh in REIHENFOLGE:
        # Schritt neu: diesen und alle späteren zurücksetzen – bezahlte Dateien bleiben (Hash), nur Geändertes kostet
        for s in REIHENFOLGE[REIHENFOLGE.index(wdh) :]:
            l.p.state["schritte"].pop(s, None)
        l.p.speichern()
    schritt: str | None = auftrag["schritt"]
    while schritt:
        log(f"Auftrag {l.id[:8]}: {schritt} …")
        r = seller.schritt(l.id, schritt, "laeuft")
        if not r.get("weiter", True):
            log(f"Auftrag {l.id[:8]}: {r.get('status')} – angehalten")
            return
        try:
            daten, hinweise = SCHRITTE[schritt](l)
        except Abgebrochen as e:
            log(f"Auftrag {l.id[:8]}: {e} – angehalten")
            return
        except Exception as e:  # Fehler melden, der Schritt kann auf der Seite wiederholt werden
            log(f"Auftrag {l.id[:8]}: Fehler in {schritt}: {e}")
            seller.schritt(l.id, schritt, "fehler", fehler=str(e) or e.__class__.__name__)
            return
        r = seller.schritt(l.id, schritt, "fertig", daten=daten, hinweise=hinweise)
        l.daten.update({k2: v for k2, v in daten.items() if k2 in ("gliederung", "quellen", "skript", "paket")})
        if r.get("freigabe"):
            log(f"Auftrag {l.id[:8]}: wartet auf Freigabe „{r['freigabe']}“")
        schritt = r.get("naechster") if r.get("weiter") else None
    log(f"Auftrag {l.id[:8]}: Lauf beendet")


def system_info(k: Konfig) -> dict[str, str]:
    import subprocess
    import sys

    try:
        ff = subprocess.run([k.ffmpeg, "-version"], capture_output=True, text=True, timeout=10).stdout.splitlines()[0][:80]
    except (OSError, IndexError, subprocess.TimeoutExpired):
        ff = "fehlt"
    return {"os": f"{platform.system()} {platform.release()}"[:80], "python": sys.version.split()[0], "ffmpeg": ff}
