"""Die sieben Schritte: research → script → voice → visuals → render → package → upload.

Jeder Schritt ist einzeln startbar und wiederaufnehmbar: Ergebnisse stehen in state.json, bezahlte Dateien (Sprache,
Bilder) liegen mit Inhalts-Hash im Projektordner und werden nie doppelt erzeugt.
"""

from __future__ import annotations

import base64
import json
import os
import platform
import re
import shutil
import subprocess
from typing import Any, Callable

import requests

from . import bewegt, clipbib, ki, medien, netz
from . import whiteboard as wb
from .filter import ERSATZ_BILDIDEE, bild_treffer, titel_treffer
from .konfig import Konfig
from .projekt import Projekt, kurz_hash, schreiben_atomar
from .seller import Seller

REIHENFOLGE = ["research", "script", "voice", "visuals", "render", "package", "upload"]
MODELL_STANDARD = "claude-opus-5-5"
# Pause zwischen zwei Szenen: Stille vor/nach der Sprache wird auf VOR_S/NACH_S gekürzt, dazu PAUSE_S → höchstens 0,3 s
PAUSE_S = 0.15
VOR_S = 0.05
NACH_S = 0.08
PRIVAT = "private"  # Sichtbarkeit beim Upload – fest, im System nicht änderbar
ABSCHNITTE = ["hook", "angst"] + [f"punkt-{i}" for i in range(1, 8)] + ["zusammenfassung", "cta"]
# Skriptlänge fest für alle Kanäle: 1.500–1.700 Wörter (Entscheidung 12.11.; ≈ 10–12 Min. bei 145 Wörtern/Min.).
# Das Seller-System schickt dieselben Werte mit; diese hier gelten nur, falls sie fehlen (ältere Version).
SKRIPT_WOERTER = [1500, 1700]
LAENGE_STANDARD = {"minuten": [10, 12], "sekunden": [621, 703], "woerter": SKRIPT_WOERTER, "szenen": [15, 34], "szenenJePunkt": [2, 4]}
# Wörter, die eine Studie/Erhebung ankündigen – solche Szenen brauchen eine Quelle aus der Quellenliste
# B36.10 Whiteboard-Tempo: kurze Szenen (1–2 Sätze, 6–12 s Sprecherzeit) → bei 10–12 Min. 55–80 Szenen
WB_SZENEN = [55, 80]
WB_SZENE_WOERTER = (12, 28)
# sanfter Zoom über jede Szene (7 %), Anteil; 0 = aus
ZOOM = float(os.environ.get("VIDEO_ZOOM", "0.07"))
STUDIE = re.compile(r"\b(Studie|Studien|Untersuchung|Untersuchungen|Forscher\w*|Wissenschaftler\w*|Umfrage\w*|Befragung\w*|Meta-?[Aa]nalyse\w*|Erhebung\w*)\b")


def zahl(n: int) -> str:
    return f"{n:,}".replace(",", ".")


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
        self.laenge: dict[str, list[int]] = {**LAENGE_STANDARD, **(auftrag.get("laenge") or {})}
        self.vorlage: dict[str, str] | None = auftrag.get("vorlage") if (auftrag.get("vorlage") or {}).get("text") else None
        self.whiteboard = self.kanal.get("stil") == "whiteboard"
        self._bib: wb.Bibliothek | None = None
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
        if k.get("zielgruppe"):
            teile.append(
                f"Zielgruppe: {k['zielgruppe']} – Ansprache, Beispiele, Sorgen und Nutzen genau auf diese Gruppe ausrichten, nicht allgemein. "
                "Studien bevorzugen, die diese Gruppe (z. B. Altersgruppe) untersucht haben, und das im Text sagen."
            )
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

    @property
    def bib(self) -> wb.Bibliothek:
        """Motiv-Bibliothek des Kanals (Whiteboard): bleibt über alle Videos im Kanalordner."""
        if self._bib is None:
            self._bib = wb.Bibliothek(self.k.arbeitsordner / self.kanal["slug"] / "motive")
        return self._bib

    def referenzen(self) -> list[tuple[str, bytes, str]]:
        """Stil-Referenzbilder des Kanals (höchstens 4), im Kanalordner zwischengespeichert."""
        out: list[tuple[str, bytes, str]] = []
        ordner = self.k.arbeitsordner / self.kanal["slug"] / "referenz"
        for r in (self.kanal.get("referenzen") or [])[:4]:
            endung = {"image/jpeg": "jpg", "image/webp": "webp"}.get(r.get("typ") or "", "png")
            pfad = ordner / f"{r['nr']}-{r.get('hash', 'x')}.{endung}"
            if not pfad.exists():
                schreiben_atomar(pfad, self.seller.referenz_holen(self.kanal["id"], r["nr"]))
            out.append((pfad.name, pfad.read_bytes(), r.get("typ") or "image/png"))
        return out

    def eigenes_skript_woerter(self) -> int | None:
        """Wortzahl des eigenen Skripts (Vorlage-Art „skript“), sonst None."""
        if self.vorlage and self.vorlage.get("art") == "skript":
            return woerter(self.vorlage["text"])
        return None

    def woerter_ziel(self) -> list[int]:
        """Wortziel des Skripts: fest 1.500–1.700. Ein eigenes Skript wird nie verlängert (Entscheidung 13.11.): ist es
        kürzer als 1.700 Wörter, bleibt seine Länge (−10 %/+5 % Spielraum fürs Aufteilen); ist es länger, wird es auf
        1.500–1.700 gekürzt."""
        w = list(self.laenge["woerter"])
        n = self.eigenes_skript_woerter()
        if n is not None and n <= w[1]:
            return [max(50, round(n * 0.9)), min(w[1], round(n * 1.05))]
        return w

    def minuten(self) -> str:
        n = self.eigenes_skript_woerter()
        if n is not None and n <= self.laenge["woerter"][1]:
            lo, hi = self.woerter_ziel()
            return f"{max(1, round(lo / 145))}–{max(1, round(hi / 145))} Minuten"
        m = self.laenge["minuten"]
        return f"{m[0]}–{m[1]} Minuten"

    def vorlage_text(self, schritt: str) -> str:
        """Optionale Vorlage: englisches Erfolgsvideo (nur Muster) oder eigenes Skript (möglichst wörtlich)."""
        if not self.vorlage:
            return ""
        text = self.vorlage["text"]
        if self.vorlage.get("art") == "skript":
            if schritt == "research":
                regel = (
                    "Eigenes Skript von Ludwig (Grundlage des Videos): Leite die Gliederung aus diesem Skript ab und suche für seine Aussagen "
                    "belastbare Quellen. Findest du für eine Aussage keine Quelle, schreibe das in „kern“ des Punktes („ohne Quelle: …“)."
                )
            else:
                n = self.eigenes_skript_woerter() or 0
                laenge = (
                    f"Es hat {zahl(n)} Wörter – nicht verlängern, nichts auffüllen, keine neuen Absätze dazuerfinden."
                    if n <= self.laenge["woerter"][1]
                    else f"Es hat {zahl(n)} Wörter – kürze es auf {zahl(self.laenge['woerter'][0])}–{zahl(self.laenge['woerter'][1])} Wörter (Wiederholungen und Nebensätze zuerst, Kernaussagen behalten)."
                )
                regel = (
                    "Eigenes Skript von Ludwig: Übernimm es möglichst wörtlich (Deutsch), teile es in Szenen und ergänze bildidee, einblendung "
                    f"und quelle_ids. {laenge} Ändere sonst nur, was Quellenpflicht oder Sicherheitsstufe verlangen."
                )
        else:
            regel = (
                "Vorlage (z. B. englisches Transkript eines erfolgreichen Videos): Nutze sie NUR als Muster für Hook, Fear Activation, Aufbau, "
                "Spannungsbogen und Tempo. Nicht übersetzen, keine Sätze übernehmen, keine Zahlen oder Studien ungeprüft übernehmen – jede "
                "Aussage selbst mit gefundener Quelle belegen. Alles auf Zielgruppe und deutschsprachiges Publikum zuschneiden."
            )
        return f"{regel}\n<vorlage>\n{text}\n</vorlage>"

    def anmerkung(self) -> str:
        h = (self.a.get("hinweis") or "").strip()
        return f"Anmerkung von Ludwig (unbedingt umsetzen):\n{h}" if h else ""


# ---- Abschnitte: je Abschnitt ein kurzer Aufruf, sofort im Projektordner gespeichert --------------------------------


class Ablage:
    """Fertige Abschnitte als Dateien: <projekt>/<art>/<eingabe-hash>/<abschnitt>.json.

    Bricht ein Lauf ab, werden beim nächsten Versuch nur die fehlenden Abschnitte neu geholt. Ändert sich die Eingabe
    (Gliederung, Anmerkung, Vorlage, Modell …), entsteht ein neuer Ordner – alte Abschnitte werden dann nicht benutzt."""

    def __init__(self, p: Projekt, art: str, eingabe: str):
        self.ordner = p.ordner / art / kurz_hash(eingabe)

    def lesen(self, name: str) -> dict | None:
        pfad = self.ordner / f"{name}.json"
        try:
            return json.loads(pfad.read_text(encoding="utf-8")) if pfad.exists() else None
        except (ValueError, OSError):
            return None  # halbe/kaputte Datei: Abschnitt neu holen

    def schreiben(self, name: str, daten: dict) -> None:
        schreiben_atomar(self.ordner / f"{name}.json", json.dumps(daten, ensure_ascii=False, indent=1).encode("utf-8"))


# Ordner der gespeicherten Abschnitte je Schritt (Wiederaufnahme)
ABSCHNITT_ORDNER = {"research": "recherche", "script": "skript"}
ABSCHNITT_NAME = {"hook": "Hook", "angst": "Fear Activation", "zusammenfassung": "Zusammenfassung", "cta": "Call-to-Action", "gliederung": "Gliederung"}
# Anteil am Skript; die übrigen 70 % teilen sich die Punkte gleichmäßig
ANTEIL = {"hook": 0.07, "angst": 0.10, "zusammenfassung": 0.08, "cta": 0.05}


def abschnitt_name(a: str) -> str:
    return ABSCHNITT_NAME.get(a) or (f"Punkt {a.split('-', 1)[1]}" if a.startswith("punkt-") else a)


def abschnitte(n_punkte: int) -> list[str]:
    return ["hook", "angst"] + [f"punkt-{i}" for i in range(1, n_punkte + 1)] + ["zusammenfassung", "cta"]


def abschnitt_ziele(n_punkte: int, woerter_ziel: list[int] | None = None) -> dict[str, tuple[int, int]]:
    """Wörter je Abschnitt so, dass die Summe genau die Gesamtspanne ergibt (Standard 1.500–1.700)."""
    lo, hi = woerter_ziel or SKRIPT_WOERTER
    rest = (1 - sum(ANTEIL.values())) / max(1, n_punkte)
    return {a: (round(lo * ANTEIL.get(a, rest)), round(hi * ANTEIL.get(a, rest))) for a in abschnitte(n_punkte)}


def _url(u: str | None) -> str:
    return str(u or "").strip().rstrip("/").lower()


def _verbinden(*teile: str) -> str:
    return "\n\n".join(t for t in teile if t)


# ---- 1 research -----------------------------------------------------------------------------------------------------


def research(l: Lauf) -> tuple[dict, list[str]]:
    """Erst die Gliederung (kurz, mit kleiner Websuche), dann je Punkt die Quellen – jeder Teil ein eigener Aufruf."""
    if l.p.erledigt("research"):
        e = l.p.state["schritte"]["research"]
        return {"gliederung": e["gliederung"], "quellen": e["quellen"]}, e.get("hinweise", [])
    thema = l.a["thema"]
    ab = Ablage(l.p, "recherche", json.dumps([l.modell, thema, l.kopf(), l.vorlage_text("research"), l.vidiq(), l.anmerkung()], ensure_ascii=False))
    g = ab.lesen("gliederung")
    if not g:
        prompt = _verbinden(
            "[video:research:gliederung]",
            f"Du planst ein YouTube-Video ({l.minuten()}) mit konkretem Nutzen für die Zuschauer.",
            l.kopf(),
            f"Thema: {thema}",
            l.vorlage_text("research"),
            l.vidiq(),
            l.anmerkung(),
            "Aufgabe: Verschaffe dir mit einer kurzen Websuche einen Überblick über die Studienlage und erstelle NUR die Gliederung: "
            "Hook → Fear Activation (warum es den Zuschauer betrifft) → 5–7 Punkte → Zusammenfassung → Call-to-Action. "
            "Wähle Punkte, zu denen es belastbare Studien gibt – die Quellen je Punkt suchst du im nächsten Schritt.",
            'Antworte am Ende NUR mit JSON in diesem Format: {"hook": "…", "angst": "…", "punkte": [{"titel": "…", "kern": "…"}], "fazit": "…", "cta": "…"}',
        )
        text, _ = ki.fragen(l.claude, l.modell, prompt, was="Recherche – Gliederung", websuche=3)
        d = ki.json_aus(text)
        punkte = [{"titel": str(p["titel"]).strip(), "kern": str(p.get("kern") or "").strip()} for p in d.get("punkte", []) if isinstance(p, dict) and p.get("titel")]
        if not punkte:
            raise RuntimeError("Recherche – Gliederung: Antwort ohne Punkte")
        g = {"hook": d.get("hook"), "angst": d.get("angst"), "punkte": punkte, "fazit": d.get("fazit"), "cta": d.get("cta")}
        ab.schreiben("gliederung", g)
    gesamt = len(g["punkte"]) + 1
    l.fortschritt("research", 1, gesamt)
    for i, p in enumerate(g["punkte"], 1):
        name = f"punkt-{i}"
        if not ab.lesen(name):
            prompt = _verbinden(
                f"[video:research:{name}]",
                f"Recherche für ein YouTube-Video zum Thema „{thema}“.",
                l.kopf(),
                f"Gliederung (zur Einordnung):\n{json.dumps(g, ensure_ascii=False)}",
                f"Aufgabe: Suche im Web 1–3 belastbare Quellen NUR für Punkt {i} „{p['titel']}“ ({p['kern']}). "
                "Bevorzugt begutachtete Studien mit Jahr; Statistiken oder Fachartikel nur, wenn es keine passende Studie gibt.",
                "Regeln: Nur Quellen, die du in der Suche wirklich gefunden hast, mit URL. Keine erfundenen Studien, Autoren oder Zahlen. "
                "Findest du keine, gib eine leere Liste zurück und schreibe das in „kern“ („ohne Quelle: …“).",
                'Antworte am Ende NUR mit JSON in diesem Format: {"kern": "Kernaussage des Punktes mit den wichtigsten Zahlen", '
                '"quellen": [{"titel": "…", "url": "https://…", "jahr": 2021, "art": "Studie", "autoren": "…"}]}',
            )
            text, urls = ki.fragen(l.claude, l.modell, prompt, was=f"Recherche – Quellen {abschnitt_name(name)}", websuche=3)
            d = ki.json_aus(text)
            gefunden = {_url(u) for u in urls}
            quellen = [
                {"titel": str(q.get("titel") or q["url"]).strip(), "url": str(q["url"]).strip(), "jahr": q.get("jahr"), "art": q.get("art"), "autoren": q.get("autoren"), "gefunden": _url(q["url"]) in gefunden}
                for q in d.get("quellen", [])
                if isinstance(q, dict) and q.get("url")
            ]
            ab.schreiben(name, {"kern": str(d.get("kern") or "").strip(), "quellen": quellen, "suche": bool(urls)})
        l.fortschritt("research", i + 1, gesamt)
    # Zusammenführen: Quellen-IDs Q1, Q2 … in der Reihenfolge der Punkte, gleiche URL nur einmal
    quellen: list[dict] = []
    id_je_url: dict[str, str] = {}
    punkte: list[dict] = []
    hinweise: list[str] = []
    ohne_treffer: list[str] = []
    for i, p in enumerate(g["punkte"], 1):
        e = ab.lesen(f"punkt-{i}") or {"kern": "", "quellen": [], "suche": False}
        ids: list[str] = []
        for q in e["quellen"]:
            k = _url(q["url"])
            if k not in id_je_url:
                id_je_url[k] = f"Q{len(quellen) + 1}"
                quellen.append({"id": id_je_url[k], **{x: q.get(x) for x in ("titel", "url", "jahr", "art", "autoren", "gefunden")}})
                if e.get("suche") and not q.get("gefunden"):
                    ohne_treffer.append(id_je_url[k])
            if id_je_url[k] not in ids:
                ids.append(id_je_url[k])
        punkte.append({"titel": p["titel"], "kern": e.get("kern") or p["kern"], "quelle_ids": ids})
        if not ids:
            hinweise.append(f"Punkt {i} „{p['titel']}“ hat keine Quelle.")
    if not 5 <= len(punkte) <= 7:
        hinweise.insert(0, f"Gliederung hat {len(punkte)} Punkte (Ziel 5–7).")
    if ohne_treffer:
        hinweise.append(f"Quellen {', '.join(ohne_treffer)} stammen nicht direkt aus den Suchtreffern – bitte prüfen.")
    gliederung = {"hook": g.get("hook"), "angst": g.get("angst"), "punkte": punkte, "fazit": g.get("fazit"), "cta": g.get("cta")}
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


WB_SKRIPT_SCHEMA = {
    "type": "object",
    "properties": {
        "szenen": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "abschnitt": {"type": "string", "enum": ABSCHNITTE},
                    "text": {"type": "string"},
                    "quelle_ids": {"type": "array", "items": {"type": "string"}},
                    "layout": {"type": "string", "enum": list(wb.LAYOUTS)},
                    "ueberschrift": {"type": "string"},
                    "balken": {"type": "string"},
                    "kernaussage": {"type": "string"},
                    "schritt": {"type": "string"},
                    "liste": {"type": "array", "items": {"type": "string"}},
                    "motive": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"key": {"type": "string"}, "beschreibung": {"type": "string"}, "wort": {"type": "string"}},
                            "required": ["key", "beschreibung", "wort"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["abschnitt", "text", "quelle_ids", "layout", "ueberschrift", "balken", "kernaussage", "schritt", "liste", "motive"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["szenen"],
    "additionalProperties": False,
}


def _kurz(text: str, woerter_max: int) -> str:
    w = (text or "").split()
    return " ".join(w[:woerter_max])


def wb_pruefen(szenen: list[dict], voll: bool = True) -> list[str]:
    """Whiteboard: je Szene 3–5 Motive (Figur + Liste: 1–2 Motive und 2–4 Stichpunkte); B36.10: Szenen mit 1–2 Sätzen
    (höchstens ~30 Wörter) und bei voller Länge mindestens 55 Szenen."""
    probleme: list[str] = []
    lang = [i for i, s in enumerate(szenen, 1) if woerter(s["text"]) > WB_SZENE_WOERTER[1] + 4]
    if lang:
        probleme.append(f"Szenen {', '.join(map(str, lang[:8]))}{' …' if len(lang) > 8 else ''} sind zu lang (über {WB_SZENE_WOERTER[1] + 4} Wörter) – höchstens 2 Sätze je Szene.")
    if voll and len(szenen) < WB_SZENEN[0]:
        probleme.append(f"Nur {len(szenen)} Szenen – Ziel {WB_SZENEN[0]}–{WB_SZENEN[1]} (je 1–2 Sätze), sonst steht das Bild zu lange.")
    for i, s in enumerate(szenen, 1):
        n = len(s.get("motive") or [])
        if s.get("layout") == "figur-liste":
            if not 1 <= n <= 2 or not 2 <= len(s.get("liste") or []) <= 4:
                probleme.append(f"Szene {i} (figur-liste) braucht 1–2 Motive und 2–4 Stichpunkte.")
        elif not 2 <= n <= 5:
            probleme.append(f"Szene {i} hat {n} Motive – nötig sind 3–5 (Gegenüberstellung: 2–5).")
    return probleme[:8]


def wb_aufbereiten(szenen: list[dict], figuren: dict[str, str]) -> None:
    """Texte kürzen (Schrift setzt die Pipeline), Schlüssel vereinheitlichen, Anzeige-Felder füllen."""
    for s in szenen:
        s["ueberschrift"] = _kurz(s.get("ueberschrift", ""), 6) or None
        s["balken"] = _kurz(s.get("balken", ""), 10) or None
        s["kernaussage"] = _kurz(s.get("kernaussage", ""), 8) or None
        s["schrittText"] = _kurz(s.pop("schritt", "") or "", 7) or None
        s["liste"] = [_kurz(x, 5) for x in (s.get("liste") or []) if x.strip()][:4] or None
        motive = []
        im_text = {wb._norm(w) for w in s.get("text", "").split()}
        for m in (s.get("motive") or [])[:5]:
            key = wb.schluessel(m.get("key") or m.get("beschreibung") or "motiv")
            wort = (m.get("wort") or "").strip().split()[0] if (m.get("wort") or "").strip() else ""
            eintrag = {"key": key, "beschreibung": figuren.get(key) or (m.get("beschreibung") or key).strip()[:300]}
            if wort and wb._norm(wort) in im_text:
                eintrag["wort"] = wort.strip(".,;:!?„“\"'")
            motive.append(eintrag)
        s["motive"] = motive
        s["bildidee"] = "; ".join(m["beschreibung"] for m in motive)[:500]
        s["einblendung"] = s.get("ueberschrift") or s.get("balken")


def skript_pruefen(szenen: list[dict], quellen: list[dict], ziel: list[int] | None = None) -> list[str]:
    """Endprüfung des zusammengeführten Skripts: Wortzahl, 5–7 Punkte, jede Studie mit Quelle aus der Quellenliste."""
    ids = {q["id"] for q in quellen}
    probleme: list[str] = []
    n = sum(woerter(s["text"]) for s in szenen)
    lo, hi = ziel or SKRIPT_WOERTER
    if not lo <= n <= hi:
        probleme.append(f"Das Skript hat {zahl(n)} Wörter – nötig sind {zahl(lo)}–{zahl(hi)}.")
    punkte = sorted({s["abschnitt"] for s in szenen if s["abschnitt"].startswith("punkt-")})
    if not 5 <= len(punkte) <= 7:
        probleme.append(f"Das Skript hat {len(punkte)} Punkte – nötig sind 5–7.")
    fremd = sorted({q for s in szenen for q in s.get("quelle_ids", []) if q not in ids})
    if fremd:
        probleme.append(f"Quellen {', '.join(fremd)} stehen nicht in der Quellenliste.")
    ohne = [i + 1 for i, s in enumerate(szenen) if s["abschnitt"].startswith("punkt-") and not s.get("quelle_ids")]
    if ohne:
        probleme.append(f"Szenen {', '.join(map(str, ohne))} (Punkte) haben keine Quelle.")
    studie = [i + 1 for i, s in enumerate(szenen) if not s.get("quelle_ids") and STUDIE.search(s["text"]) and i + 1 not in ohne]
    if studie:
        probleme.append(f"Szenen {', '.join(map(str, studie))} nennen eine Studie ohne Quelle aus der Quellenliste.")
    return probleme


def _korrekturen(fertig: dict[str, dict], namen: list[str], ziele: dict[str, tuple[int, int]], quellen: list[dict], ziel: list[int], whiteboard: bool = False) -> dict[str, str]:
    """Welche Abschnitte nachgebessert werden (nur diese werden neu geholt) – je Abschnitt eine kurze Anweisung."""
    ids = {q["id"] for q in quellen}
    aufgaben: dict[str, str] = {}
    for name in namen:
        sz = fertig[name]["szenen"]
        if whiteboard and sum(1 for s in sz if woerter(s["text"]) > WB_SZENE_WOERTER[1] + 6) >= max(2, len(sz) // 3):
            aufgaben[name] = f"Teile den Abschnitt in kürzere Szenen mit je 1–2 Sätzen ({WB_SZENE_WOERTER[0]}–{WB_SZENE_WOERTER[1]} Wörter), Text sonst unverändert."
            continue
        fremd = sorted({q for s in sz for q in s.get("quelle_ids", []) if q not in ids})
        if fremd:
            aufgaben[name] = f"Die Quellen {', '.join(fremd)} gibt es nicht – nur IDs aus der Quellenliste verwenden."
        elif name.startswith("punkt-") and not all(s.get("quelle_ids") for s in sz):
            aufgaben[name] = "Jede Szene dieses Punktes braucht mindestens eine Quelle aus der Quellenliste (Studie im Text nennen, ID in quelle_ids)."
        elif any(not s.get("quelle_ids") and STUDIE.search(s["text"]) for s in sz):
            aufgaben[name] = "Eine Szene nennt eine Studie ohne Quelle: entweder die passende ID aus der Quellenliste in quelle_ids eintragen oder die Studie weglassen."
    n = sum(fertig[x]["woerter"] for x in namen)
    lo, hi = ziel
    if not lo <= n <= hi:
        mitte = (lo + hi) // 2
        def abweichung(x: str) -> float:
            z = sum(ziele[x]) / 2
            return (fertig[x]["woerter"] - z) / z
        # zu kurz: die Punkte mit dem größten Rückstand verlängern; zu lang: die längsten Abschnitte kürzen
        kandidaten = sorted([x for x in namen if x.startswith("punkt-")], key=abweichung) if n < lo else sorted(namen, key=abweichung, reverse=True)
        wahl = kandidaten[:3]
        je = (mitte - n) / max(1, len(wahl))
        for x in wahl:
            neu = max(40, round(fertig[x]["woerter"] + je))
            richtung = "verlängern" if je > 0 else "kürzen"
            text = f"Bitte auf ca. {neu} Wörter {richtung} (bisher {fertig[x]['woerter']}) – Inhalt und Quellen behalten" + (", mehr Erklärung und ein Alltagsbeispiel." if je > 0 else ", Wiederholungen streichen.")
            aufgaben[x] = (aufgaben[x] + " " + text) if x in aufgaben else text
    return aufgaben


def _abschnitt_schreiben(l: Lauf, name: str, ziel_abschnitt: tuple[int, int], g: dict, quellen: list[dict], figuren: dict[str, str], vorher: list[dict], ueberarbeiten: tuple[dict, str] | None = None) -> dict:
    """Einen Abschnitt schreiben (eigener, kurzer Aufruf). Mit „ueberarbeiten“ = (bisherige Fassung, Anweisung) nachbessern."""
    punkte = g.get("punkte") or []
    lo, hi = ziel_abschnitt
    w = l.woerter_ziel()
    if name.startswith("punkt-"):
        i = int(name.split("-", 1)[1])
        p = punkte[i - 1] if i <= len(punkte) else {"titel": name, "kern": "", "quelle_ids": []}
        aufgabe = f"Punkt {i} von {len(punkte)}: „{p['titel']}“ – {p.get('kern') or ''}. Quellen dazu: {', '.join(p.get('quelle_ids') or []) or 'keine'}."
        quellenregel = "Nenne die Studie im Text (z. B. „Eine Studie aus 2016 mit 2.400 Paaren zeigt …“) und trage ihre ID in quelle_ids ein. Nur IDs aus der Quellenliste, keine Studie ohne ID."
    else:
        aufgabe = {
            "hook": f"Hook – packender Einstieg in den ersten Sekunden, Neugier wecken, sagen, was das Video bringt. Grundlage: {g.get('hook') or ''}",
            "angst": f"Fear Activation – warum das Thema den Zuschauer persönlich betrifft und was passiert, wenn er es ignoriert. Grundlage: {g.get('angst') or ''}",
            "zusammenfassung": f"Zusammenfassung – die {len(punkte)} Punkte kurz bündeln. Grundlage: {g.get('fazit') or ''}",
            "cta": f"Call-to-Action – ehrlich und kurz zum Abonnieren und Kommentieren einladen. Grundlage: {g.get('cta') or ''}",
        }[name]
        quellenregel = "Hier keine neuen Studien. Erwähnst du doch eine Studie oder Zahl, dann nur mit ihrer ID aus der Quellenliste in quelle_ids."
    bisher = "\n\n".join(f"[{abschnitt_name(e['abschnitt'])}]\n" + "\n".join(s["text"] for s in e["szenen"]) for e in vorher)
    prompt = _verbinden(
        f"[video:script:{name}]",
        f"Du schreibst das Sprechskript für ein YouTube-Video ({l.minuten()}, insgesamt {zahl(w[0])}–{zahl(w[1])} Wörter) Abschnitt für Abschnitt.",
        l.kopf(),
        f"Thema: {l.a['thema']}",
        l.vorlage_text("script"),
        f"Freigegebene Gliederung:\n{json.dumps(g, ensure_ascii=False)}",
        f"Quellenliste (nur diese IDs verwenden):\n{json.dumps(quellen, ensure_ascii=False)}",
        l.vidiq(),
        l.anmerkung(),
        f"Bisher geschrieben (daran anschließen, nichts wiederholen):\n{bisher}" if bisher else "Das ist der erste Abschnitt des Videos.",
        f"Schreibe jetzt NUR den Abschnitt „{abschnitt_name(name)}“: {aufgabe}",
        (
            f"Länge dieses Abschnitts: ca. {(lo + hi) // 2} Wörter ({lo}–{hi}), aufgeteilt in kurze Szenen mit je 1–2 Sätzen "
            f"({WB_SZENE_WOERTER[0]}–{WB_SZENE_WOERTER[1]} Wörter, 6–12 Sekunden Sprechzeit), also etwa {max(2, round((lo + hi) / 2 / 21))} Szenen – "
            "im Video soll ständig etwas Neues passieren. Gesprochene Sprache, kurze Sätze, direkte Ansprache."
            if l.whiteboard
            else f"Länge dieses Abschnitts: ca. {(lo + hi) // 2} Wörter ({lo}–{hi}), aufgeteilt in Szenen mit je 50–100 Wörtern. Gesprochene Sprache, kurze Sätze, direkte Ansprache."
        ),
        quellenregel,
        _wb_regeln(l, figuren)
        if l.whiteboard
        else "bildidee: ruhiges Symbolbild, Illustration oder Infografik – keine erkennbaren realen Personen, keine Nacktheit, nichts Intimes"
        + (", kein Bett, kein Kuss, keine Berührung" if l.streng else "")
        + ". einblendung: kurzer Text fürs Bild (höchstens 8 Wörter, z. B. Studie + Jahr) oder leer.",
        (f"Bisherige Fassung dieses Abschnitts:\n{json.dumps(ueberarbeiten[0]['szenen'], ensure_ascii=False)}\n\nÜberarbeitung: {ueberarbeiten[1]}" if ueberarbeiten else ""),
    )
    schema = _ohne_abschnitt(WB_SKRIPT_SCHEMA if l.whiteboard else SKRIPT_SCHEMA)
    was = f"Skript – {abschnitt_name(name)}"
    text, _ = ki.fragen(l.claude, l.modell, prompt, was=was, schema=schema)
    szenen = [{**s, "abschnitt": name} for s in ki.json_aus(text).get("szenen", []) if str(s.get("text", "")).strip()]
    if not szenen:
        raise RuntimeError(f"{was}: Antwort ohne Text")
    return {"abschnitt": name, "szenen": szenen, "woerter": sum(woerter(s["text"]) for s in szenen)}


def _ohne_abschnitt(schema: dict) -> dict:
    """Schema einer Szene ohne Feld „abschnitt“ (das setzt der Worker je Aufruf selbst)."""
    item = json.loads(json.dumps(schema["properties"]["szenen"]["items"]))
    item["properties"].pop("abschnitt", None)
    item["required"] = [x for x in item["required"] if x != "abschnitt"]
    return {**schema, "properties": {"szenen": {"type": "array", "items": item}}}


def _wb_regeln(l: Lauf, figuren: dict[str, str]) -> str:
    bib = l.bib.liste()[:150]
    teile = [
        "STIL WHITEBOARD-COLLAGE: Jede Szene zeigt auf weißem Hintergrund 3–5 bunte Cartoon-Clipart-Motive (Figuren mit Comic-Gesicht, "
        "Alltagsgegenstände als Symbol: z. B. Banane, Kirsche, Sanduhr, Lineal, Wasserhahn), dazu kurze Texte, die das System selbst in fester Schrift setzt. "
        "Statt bildidee/einblendung lieferst du je Szene:",
        "- layout: „3er“, „4er“, „5er“ (so viele Motive), „figur-liste“ (eine Figur links + 2–4 Stichpunkte in liste) oder „gegenueberstellung“ (zwei Motive im Vergleich, optional bis zu 3 kleine dazu)",
        "- ueberschrift: fette Überschrift, höchstens 5 Wörter, oder leer",
        "- balken: Aussagesatz im roten Balken oben, höchstens 9 Wörter, oder leer",
        "- kernaussage: Kernaussage in Rot, höchstens 6 Wörter, oder leer",
        "- schritt: nur bei Anleitungen „Schritt N: …“, höchstens 6 Wörter, sonst leer",
        "- liste: nur bei figur-liste 2–4 Stichpunkte (je höchstens 4 Wörter), sonst leer",
        "- motive: {key, beschreibung, wort}; key = kurzer Name in Kleinbuchstaben mit Bindestrich (z. B. „banane“, „sanduhr“); beschreibung = ein einzelnes Objekt bzw. eine Figur, Cartoon, OHNE Text, Schrift oder Zahlen; "
        "wort = das Schlüsselwort aus dem Szenentext (genau so geschrieben wie dort), bei dem das Motiv erscheinen soll – die Motive in der Reihenfolge, in der ihre Wörter gesprochen werden.",
        "Szenen sind kurz (1–2 Sätze): Motive dürfen und sollen in den Folgeszenen wiederkehren (gleicher key) – höchstens 1–2 neue Motive je Szene, der Rest aus vorigen Szenen oder der Bibliothek.",
        "Nicht jede Szene braucht alle Texte – höchstens zwei Textelemente je Szene. Symbolik andeutend und humorvoll, niemals explizit, keine Nacktheit, keine erkennbaren realen Personen"
        + (", kein Bett, kein Kuss, keine Berührung." if l.streng else "."),
    ]
    if bib:
        teile.append("Bibliothek (schon gezeichnet, kostet nichts – mit genau diesem key wiederverwenden, wo es passt):\n" + "\n".join(f"- {x['key']}: {x['beschreibung']}" for x in bib))
    if figuren:
        teile.append("Feste Figuren (für Personen nur diese, mit genau diesem key):\n" + "\n".join(f"- {k}: {v}" for k, v in figuren.items()))
    return "\n".join(teile)


def script(l: Lauf) -> tuple[dict, list[str]]:
    """Abschnittsweise: Hook, Fear Activation, jeder Punkt einzeln, Zusammenfassung, CTA – jeder Abschnitt ein eigener
    Aufruf, sofort gespeichert. Danach zusammenführen, prüfen und nur die betroffenen Abschnitte nachbessern."""
    if l.p.erledigt("script"):
        e = l.p.state["schritte"]["script"]
        return {"skript": e["skript"], "woerter": e["woerter"]}, e.get("hinweise", [])
    quellen = l.daten.get("quellen") or []
    g = l.daten.get("gliederung") or {}
    w = l.woerter_ziel()
    figuren = {f["key"]: f["beschreibung"] for f in (l.kanal.get("figuren") or []) if f.get("key")}
    namen = abschnitte(len(g.get("punkte") or []))
    ziele = abschnitt_ziele(len(g.get("punkte") or []), w)
    eingabe = [l.modell, l.a["thema"], l.kopf(), l.vorlage_text("script"), g, quellen, l.vidiq(), l.anmerkung(), l.whiteboard, figuren, w, l.streng]
    ab = Ablage(l.p, "skript", json.dumps(eingabe, ensure_ascii=False))
    fertig: dict[str, dict] = {}
    for k, name in enumerate(namen, 1):
        e = ab.lesen(name)
        if not e:
            e = _abschnitt_schreiben(l, name, ziele[name], g, quellen, figuren, [fertig[x] for x in namen[: k - 1]])
            ab.schreiben(name, e)
        fertig[name] = e
        l.fortschritt("script", k, len(namen))
    # Endprüfung; höchstens zwei Runden Nachbesserung, jeweils nur der betroffenen Abschnitte
    for runde in range(2):
        aufgaben = _korrekturen(fertig, namen, ziele, quellen, w, l.whiteboard)
        if not aufgaben:
            break
        for name, anweisung in aufgaben.items():
            vorher = [fertig[x] for x in namen[: namen.index(name)]]
            e = _abschnitt_schreiben(l, name, ziele[name], g, quellen, figuren, vorher, ueberarbeiten=(fertig[name], anweisung))
            ab.schreiben(name, e)
            fertig[name] = e
    szenen = [dict(s) for name in namen for s in fertig[name]["szenen"]]
    probleme = skript_pruefen(szenen, quellen, w) + (wb_pruefen(szenen, voll=w[1] >= l.laenge["woerter"][0]) if l.whiteboard else [])
    if l.whiteboard:
        wb_aufbereiten(szenen, figuren)
    for i, s in enumerate(szenen, 1):
        s["nr"] = i
        s["einblendung"] = (s.get("einblendung") or "").strip() or None
    n = sum(woerter(s["text"]) for s in szenen)
    l.p.markieren("script", skript=szenen, woerter=n, hinweise=probleme)
    return {"skript": szenen, "woerter": n}, probleme


# ---- 3 voice -------------------------------------------------------------------------------------------------------


SPRACH_MODELL = "eleven_multilingual_v2"
TEMPO_STANDARD = 1.1  # ElevenLabs voice_settings.speed (0,7–1,2); 1,0 war beim ersten Video ≈ 95 Wörter/Min
WPM_ZIEL = (145, 155)
WPM_WARNUNG = 135


def sprechtempo(kanal: dict) -> float:
    """Sprechtempo aus dem Kanalprofil (ElevenLabs speed), auf 0,7–1,2 begrenzt; Standard 1,1."""
    roh = kanal.get("sprechtempo")
    try:
        v = float(roh) if roh is not None else TEMPO_STANDARD
    except (TypeError, ValueError):
        v = TEMPO_STANDARD
    return round(min(1.2, max(0.7, v)), 2)


def voice_key(l: Lauf, text: str) -> str:
    """Schlüssel der Sprachdatei einer Szene: Stimme, Modell, Text, Sprechtempo und Schnitt – ändert sich etwas davon,
    wird neu vertont, sonst wiederverwendet (nie doppelt bezahlt)."""
    stimme = (l.kanal.get("stimmeId") or "").strip()
    return kurz_hash(stimme, SPRACH_MODELL, text, f"tempo{sprechtempo(l.kanal):.2f}", "schnitt1")


def woerter_pro_minute(szenen: list[dict]) -> float | None:
    """Wörter je Minute über alle Szenen (Szenendauer inkl. Pause = Videolänge)."""
    sek = sum(float(s.get("dauer") or 0) for s in szenen)
    return round(sum(woerter(s.get("text") or "") for s in szenen) / sek * 60, 1) if sek > 0 else None


def _sprache_holen(l: Lauf, i: int, text: str) -> str:
    """Sprache einer Szene (einmal bezahlt): ElevenLabs mit Wortzeiten und Sprechtempo; die Stille vor und nach dem
    Gesprochenen wird gekürzt (Wortzeiten werden mitverschoben). Liefert den Schlüssel."""
    schluessel = voice_key(l, text)
    if l.p.datei_vorhanden("voice", schluessel):
        return schluessel
    stimme = (l.kanal.get("stimmeId") or "").strip()
    pfad = f"v1/text-to-speech/{stimme}/with-timestamps?output_format=mp3_44100_128"
    koerper = {"text": text, "model_id": SPRACH_MODELL, "voice_settings": {"speed": sprechtempo(l.kanal)}}
    r = l.seller.anbieter(l.id, "elevenlabs", pfad, koerper, timeout=netz.TIMEOUT_S, was=f"Sprache – Szene {i + 1}")
    if r.status_code != 200:
        raise RuntimeError(f"ElevenLabs (Szene {i + 1}): {_fehlertext(r)}")
    j = r.json()
    ausrichtung = j.get("alignment") or j.get("normalized_alignment")
    rel = f"voice/{i + 1:03d}-{schluessel}.mp3"
    roh = l.p.pfad(f"voice/{i + 1:03d}-{schluessel}.roh.mp3")
    schreiben_atomar(roh, base64.b64decode(j.get("audio_base64") or ""))
    grenzen = wb.sprech_grenzen(ausrichtung)
    versatz = 0.0
    if grenzen:
        versatz = max(0.0, grenzen[0] - VOR_S)
        medien.zuschneiden(l.k.ffmpeg, roh, l.p.pfad(rel), versatz, min(medien.dauer(l.k.ffprobe, roh), grenzen[1] + NACH_S))
        roh.unlink(missing_ok=True)
    else:
        roh.replace(l.p.pfad(rel))
    extra: dict[str, Any] = {}
    zeiten = wb.wortzeiten(text, ausrichtung)
    if zeiten:
        rel_z = f"voice/{i + 1:03d}-{schluessel}.json"
        schreiben_atomar(l.p.pfad(rel_z), json.dumps([(w, round(max(0.0, t - versatz), 3)) for w, t in zeiten]).encode("utf-8"))
        extra["zeiten"] = rel_z
    l.p.datei_merken("voice", schluessel, rel, dauer=round(medien.dauer(l.k.ffprobe, l.p.pfad(rel)), 3), **extra)
    return schluessel


def voice(l: Lauf) -> tuple[dict, list[str]]:
    szenen = l.daten.get("skript") or []
    if not (l.kanal.get("stimmeId") or "").strip():
        raise RuntimeError("Im Kanalprofil fehlt die Stimme (ElevenLabs-Voice-ID).")
    for i, s in enumerate(szenen):
        schluessel = _sprache_holen(l, i, s["text"])
        s["dauer"] = round(l.p.state["voice"][schluessel]["dauer"] + PAUSE_S, 3)
        s["_voice"] = schluessel
        l.fortschritt("voice", i + 1, len(szenen))
    gesamt = round(sum(s["dauer"] for s in szenen))
    wpm = woerter_pro_minute(szenen)
    hinweise = []
    if wpm is not None and wpm < WPM_WARNUNG:
        hinweise.append(f"Sprechtempo {wpm:.0f} Wörter/Min (Ziel {WPM_ZIEL[0]}–{WPM_ZIEL[1]}) – im Kanalprofil „Sprechtempo“ erhöhen.")
    l.p.markieren("voice", hinweise=hinweise)
    return {"skript": _ohne_intern(szenen), "dauerSek": gesamt, "woerterProMin": wpm}, hinweise


# ---- 4 visuals -----------------------------------------------------------------------------------------------------


# Bilder brauchen beim Anbieter oft länger als Text – Zeitlimit je Aufruf 180 s (statt 120 s)
BILD_TIMEOUT_S = max(netz.TIMEOUT_S, 180.0)
# Nur Vorgabe: Das Seller-System setzt das Bildmodell selbst (Seite Video → Modell und Ablage) und weicht aus, wenn es im
# OpenAI-Konto fehlt. gpt-image-1 hat OpenAI am 23.10.2026 abgeschaltet.
BILD_MODELL = "gpt-image-2.5-flare"


def _bild_holen(l: Lauf, prompt: str, was: str = "Bild") -> bytes | None:
    """Ein Bild bei OpenAI (Modell setzt das Seller-System, 1536×1024, medium). None = vom Anbieter abgelehnt."""
    r = l.seller.anbieter(l.id, "openai", "v1/images/generations", {"model": BILD_MODELL, "prompt": prompt, "size": "1536x1024", "quality": "medium", "n": 1}, timeout=BILD_TIMEOUT_S, was=was)
    if r.status_code == 200:
        return base64.b64decode(r.json()["data"][0]["b64_json"])
    text = _fehlertext(r)
    if r.status_code == 400 and re.search(r"moderation|safety|content.?policy|rejected", text, re.I):
        return None
    raise RuntimeError(f"Bildanbieter: {text}")


# ---- 4b visuals im Stil Whiteboard-Collage (B36.9) -------------------------------------------------------------------

STANDARD_CLIPART = "Bunte Cartoon-Clipart mit kräftigen schwarzen Umrissen und flachen Farben, Comic-Gesichter, freundlich"
# Echtes Zeichnen: Motive als Strichzeichnung, damit die Konturen sauber vektorisiert und nachgezeichnet werden können
STRICH_STIL = "Schwarze Strichzeichnung, klare geschlossene Konturen, gleichmäßige Linienstärke, weißer Hintergrund, keine Flächen, keine Füllfarben, keine Schattierung, keine Verläufe"


def motiv_strich(l: Lauf) -> bool:
    """Whiteboard-Motive als Strichzeichnung (Kanalprofil „Motive“, Standard) statt farbiger Clipart."""
    return bool(getattr(l, "whiteboard", False)) and (l.kanal.get("motivStil") or "strich") != "farbig"


def _motiv_prompt(l: Lauf, beschreibung: str) -> str:
    if motiv_strich(l):
        return (
            f"{STRICH_STIL}. Einzelnes Motiv: {beschreibung}. Nur dieses eine Motiv, mittig und ganz sichtbar. "
            "Keine Schrift, keine Buchstaben, keine Zahlen. Keine erkennbaren realen Personen, keine Nacktheit."
        )
    stil = (l.kanal.get("bildstil") or STANDARD_CLIPART).strip()
    return (
        f"{stil}. Einzelnes Motiv: {beschreibung}. Freigestellt auf transparentem Hintergrund, nur dieses eine Motiv, mittig und ganz sichtbar. "
        "Keine Schrift, keine Buchstaben, keine Zahlen. Keine erkennbaren realen Personen, keine Nacktheit."
    )


def _motiv_holen(l: Lauf, prompt: str, was: str = "Motiv") -> bytes | None:
    """Ein Motiv (1024×1024, transparent). Mit Stil-Referenzbildern über „edits“, sonst „generations“. None = abgelehnt."""
    q = l.kanal.get("bildQualitaet") or "medium"
    refs = l.referenzen()
    if refs:
        stil = " Figuren und Formen wie in den Referenzbildern, aber als schwarze Strichzeichnung ohne Flächen (nur den Stil übernehmen, nicht deren Inhalt)." if motiv_strich(l) else " Zeichenstil genau wie in den Referenzbildern (nur den Stil übernehmen, nicht deren Inhalt)."
        felder = {"model": BILD_MODELL, "prompt": prompt + stil, "size": "1024x1024", "quality": q, "background": "transparent", "n": "1"}
        r = l.seller.anbieter_datei(l.id, "openai", "v1/images/edits", felder, [("image[]", name, daten, typ) for name, daten, typ in refs], timeout=BILD_TIMEOUT_S, was=was)
    else:
        r = l.seller.anbieter(l.id, "openai", "v1/images/generations", {"model": BILD_MODELL, "prompt": prompt, "size": "1024x1024", "quality": q, "background": "transparent", "n": 1}, timeout=BILD_TIMEOUT_S, was=was)
    if r.status_code == 200:
        return base64.b64decode(r.json()["data"][0]["b64_json"])
    text = _fehlertext(r)
    if r.status_code == 400 and re.search(r"moderation|safety|content.?policy|rejected", text, re.I):
        return None
    raise RuntimeError(f"Bildanbieter: {text}")


def _striche(l: Lauf, s: dict) -> list:
    """Pfade zum Nachzeichnen je Motiv der Szene (einmal je Motiv vektorisiert, in der Bibliothek gespeichert)."""
    return [l.bib.striche(m["key"]) for m in s.get("motive") or [] if l.bib.hat(m["key"])]


def _wb_szenenbilder(l: Lauf, szenen: list[dict]) -> list:
    """Fertige Szenen (ohne Animation) der Reihe nach – jede mit der vorigen als blassem Hintergrund."""
    vorher = None
    fertige = []
    for s in szenen:
        motive = [l.bib.bild(m["key"]) for m in s.get("motive") or [] if l.bib.hat(m["key"])]
        els = wb.elemente(s, motive)
        plan, _k = _wb_takt(l, s, els)
        bild = wb.fertig_takt(wb.hintergrund(vorher), els, plan)
        fertige.append(bild)
        vorher = bild
    return fertige


def _wortzeiten(l: Lauf, s: dict) -> list[tuple[str, float]]:
    """Wortzeiten einer Szene aus der Sprache (B36.10), sonst leer → Ereignisse gleichmäßig verteilt."""
    e = l.p.state["voice"].get(voice_key(l, s["text"])) or {}
    if not e.get("zeiten") or not (l.p.ordner / e["zeiten"]).exists():
        return []
    try:
        return [(w, float(t)) for w, t in json.loads((l.p.ordner / e["zeiten"]).read_text(encoding="utf-8"))]
    except (OSError, ValueError, TypeError):
        return []


def _szenen_dauer(l: Lauf, s: dict) -> float:
    e = l.p.state["voice"].get(voice_key(l, s["text"])) or {}
    return float(e.get("dauer") or s.get("dauer") or 8.0) + PAUSE_S


def _wb_takt(l: Lauf, s: dict, els: list) -> tuple[list, dict]:
    """Zeitplan einer Whiteboard-Szene (B36.10) – gleich für Takt-Prüfung und Render."""
    return wb.takt_plan([e.art for e in els], wb.element_woerter(s, els), _szenen_dauer(l, s), wb.draw_s(l.kanal.get("tempo")), _wortzeiten(l, s))


def takt_hinweise(szenen: list[dict]) -> list[str]:
    """Prüfung vor dem Render: höchstens 3 s ohne neues Ereignis je Szene, Ø-Takt über das Video."""
    hinweise = [
        f"Szene {s.get('nr') or i}: {str(s['takt']['maxPause']).replace('.', ',')} s ohne neue Aktion – mehr Motive oder Hervorhebungen vorschlagen."
        for i, s in enumerate(szenen, 1)
        if (s.get("takt") or {}).get("maxPause", 0) > wb.MAX_PAUSE
    ]
    ereignisse = sum((s.get("takt") or {}).get("ereignisse", 0) for s in szenen)
    dauer = sum((s.get("takt") or {}).get("mittel", 0) * (s.get("takt") or {}).get("ereignisse", 0) for s in szenen)
    if ereignisse:
        laengste = max(szenen, key=lambda s: (s.get("takt") or {}).get("maxPause", 0))
        hinweise.append(
            f"Takt: {len(szenen)} Szenen, Ø alle {str(round(dauer / ereignisse, 1)).replace('.', ',')} s eine neue Aktion, längste Pause "
            f"{str((laengste.get('takt') or {}).get('maxPause', 0)).replace('.', ',')} s (Szene {laengste.get('nr')})."
        )
    return hinweise[:12]


def visuals_wb(l: Lauf) -> tuple[dict, list[str]]:
    szenen = l.daten.get("skript") or []
    hinweise: list[str] = []
    # Szenen-Übersicht: ausgewählte Motive verwerfen (je Runde nur einmal – nach Neustart nicht doppelt bezahlen)
    neu = [k for k in (l.a.get("neuMotive") or []) if not k.startswith("#")]
    runde = next((k for k in (l.a.get("neuMotive") or []) if k.startswith("#")), "")
    erledigt = l.p.state.setdefault("neu_runden", {})
    if neu and runde not in erledigt:
        for k in neu:
            l.bib.entfernen(k)
        erledigt[runde] = neu
        l.p.speichern()
    vorher = set(l.bib.index)
    figuren = {f["key"]: f["beschreibung"] for f in (l.kanal.get("figuren") or []) if f.get("key")}
    gesamt = sum(len(s.get("motive") or []) for s in szenen) or 1
    n = 0
    for s in szenen:
        for m in s.get("motive") or []:
            n += 1
            key = m["key"]
            beschreibung = figuren.get(key) or m.get("beschreibung") or key
            treffer = bild_treffer(beschreibung, l.streng)
            if treffer:
                hinweise.append(f"Szene {s.get('nr')}: Motiv „{key}“ enthielt „{treffer}“ – Ersatzmotiv.")
                key, beschreibung, m["ersatz"] = "ersatz", ERSATZ_BILDIDEE, True
            if not l.bib.hat(key):
                daten = _motiv_holen(l, _motiv_prompt(l, beschreibung), f"Motiv „{key}“ (Szene {s.get('nr')})")
                if daten is None:
                    hinweise.append(f"Szene {s.get('nr')}: Bildanbieter hat Motiv „{key}“ abgelehnt – Ersatzmotiv.")
                    key, m["ersatz"] = "ersatz", True
                    if not l.bib.hat(key):
                        daten = _motiv_holen(l, _motiv_prompt(l, ERSATZ_BILDIDEE), "Ersatzmotiv") or wb.ersatz_motiv()
                if daten and not l.bib.hat(key):
                    l.bib.merken(key, wb.freistellen(daten), beschreibung)
            m["key"] = key
            m["wiederverwendet"] = key in vorher
            l.fortschritt("visuals", n, gesamt)
    for s in szenen:
        s["ersatzbild"] = any(m.get("ersatz") for m in s.get("motive") or [])
        s["bildidee"] = "; ".join(m["beschreibung"] for m in s.get("motive") or [])[:500]
        # B36.10 Prüfung vor dem Render: Zeitplan je Szene (Wortzeiten, draw_s, Hervorhebungen) – höchstens 3 s Stillstand
        els = wb.elemente(s, [l.bib.bild(m["key"]) for m in s.get("motive") or [] if l.bib.hat(m["key"])])
        _plan, s["takt"] = _wb_takt(l, s, els)
    hinweise += takt_hinweise(szenen)
    # Szenen-Übersicht für die Freigabe vor dem Render (B36.9.6)
    fertige = _wb_szenenbilder(l, szenen)
    ordner = l.p.pfad("szenen", "x").parent
    for i, b in enumerate(fertige, 1):
        b.save(ordner / f"{i:03d}.png")
    wb.uebersicht([(s.get("nr") or i, b, ", ".join(m["key"] for m in s.get("motive") or [])) for i, (s, b) in enumerate(zip(szenen, fertige), 1)], l.p.pfad("uebersicht.jpg"))
    l.seller.datei_hochladen(l.id, "uebersicht", l.p.pfad("uebersicht.jpg"))
    l.p.markieren("visuals", hinweise=hinweise)
    return {"skript": _ohne_intern(szenen)}, hinweise


def _vb_stil(l: Lauf) -> str:
    return (l.kanal.get("bildstil") or "Moderne, ruhige Illustration in warmen Farben").strip()


def _vb_prompt(l: Lauf, idee: str) -> str:
    return f"{_vb_stil(l)}. {idee}. Symbolbild ohne Text und ohne Schrift, keine erkennbaren realen Personen, keine Nacktheit."


def _vb_bild(l: Lauf, idee: str, nr: str, einblendung: str, hinweise: list[str], wo: str) -> str:
    """Ein Symbolbild (bezahlt nur, wenn es den Prompt noch nicht gibt) → Schlüssel in state["bilder"]."""
    treffer = bild_treffer(idee, l.streng)
    if treffer:
        hinweise.append(f"{wo}: Bildidee enthielt „{treffer}“ – Ersatzmotiv verwendet.")
        idee = ERSATZ_BILDIDEE
    prompt = _vb_prompt(l, idee)
    schluessel = kurz_hash(prompt)
    if not l.p.datei_vorhanden("bilder", schluessel):
        ersatz = bool(treffer)
        daten = _bild_holen(l, prompt, f"Bild – {wo}")
        if daten is None:
            hinweise.append(f"{wo}: Bildanbieter hat abgelehnt – Ersatzbild.")
            ersatz = True
            daten = _bild_holen(l, f"{_vb_stil(l)}. {ERSATZ_BILDIDEE}. Symbolbild ohne Text.", f"Ersatzbild – {wo}")
        rel = f"bilder/{nr}-{schluessel}.png"
        if daten is None:
            medien.ersatzbild(einblendung, l.p.pfad(rel))
        else:
            schreiben_atomar(l.p.pfad(rel), daten)
        l.p.datei_merken("bilder", schluessel, rel, ersatz=ersatz)
    return schluessel


# ---- 4c Vollbild in Bewegung (B36.11): Bildplan, Bilder alle ~6 s, Stock-Clips (Pixabay/Pexels) ---------------------------------------

BILDPLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "szenen": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "nr": {"type": "integer"},
                    "bilder": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "art": {"type": "string", "enum": ["bild", "clip", "eigen"]},
                                "idee": {"type": "string"},
                                "suche": {"type": "string"},
                                "wort": {"type": "string"},
                                "eigen": {"type": "string"},
                            },
                            "required": ["art", "idee", "suche", "wort", "eigen"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["nr", "bilder"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["szenen"],
    "additionalProperties": False,
}
BILDPLAN_JE_AUFRUF = 25
CLIP_HOSTS = ("pixabay.com", "pexels.com", "vimeo.com", "vimeocdn.com")
# Clip-Quellen in Such-Reihenfolge (1.4.1: Pixabay zuerst – Pexels vergibt zeitweise keine neuen Schlüssel):
# (Name in der Brücke, Anzeigename, Domain für den Nachweis, Pfad, Parameter)
CLIP_QUELLEN = (
    ("pixabay", "Pixabay", "pixabay.com", "videos", {"per_page": 12}),
    ("pexels", "Pexels", "pexels.com", "videos/search", {"orientation": "landscape", "size": "medium", "per_page": 12}),
)


def stock_clips(l: Lauf) -> bool:
    return bool(l.kanal.get("stockClips"))


def _bp_key(l: Lauf, s: dict, n: int, eigene_fp: str = "") -> str:
    return kurz_hash(s["text"], s.get("bildidee") or "", str(n), "clips" if stock_clips(l) else "bilder", eigene_fp, "bp1" if not eigene_fp else "bp2")


def _bildplan_holen(l: Lauf, auftrag: list[tuple[int, dict, int]], eigene: list[dict] | None = None) -> tuple[dict[int, list[dict]], dict[str, str]]:
    """Claude plant je Szene n Bilder/Clips in Sprechreihenfolge (ein Aufruf je 25 Szenen, wenig Denkaufwand).
    B36.12: Mit eigener Clip-Bibliothek bekommt Claude die passendsten eigenen Clips als Katalog (Kennung E1, E2 …) und
    wählt sie gezielt zum gesprochenen Satz. Liefert Plan und Zuordnung Kennung → Clip-ID."""
    clips = stock_clips(l)
    kat = clipbib.katalog(eigene or [], " ".join(s["text"] for _i, s, _n in auftrag)) if clips and eigene else []
    marken = {f"E{k + 1}": e["id"] for k, e in enumerate(kat)}
    def zeile(i: int, s: dict, n: int) -> str:
        text = " ".join(s["text"].split())
        idee = f"  [bisherige Bildidee: {s['bildidee']}]" if s.get("bildidee") else ""
        return f"Szene {i + 1} (n={n}, {float(s.get('dauer') or 0):.0f} s): {text}{idee}"

    zeilen = [zeile(i, s, n) for i, s, n in auftrag]
    prompt = "\n\n".join(
        [
            "[video:bildplan]",
            "Plane die Bebilderung eines YouTube-Videos im Stil „Vollbild“. Damit es ein Video ist und keine Diashow, wechselt das Bild "
            "etwa alle 5–7 Sekunden. Liefere je Szene GENAU n Elemente in der Reihenfolge, in der gesprochen wird.",
            l.kopf(),
            "Je Element:\n"
            "- art: " + ("„clip“ für ein echtes gefilmtes Video aus einer Stock-Datenbank (wenn eine reale Szene passt: Gegenstände in Bewegung, "
            "Hände, Werkstatt, Stadt, Natur, Menschen von hinten/unscharf) – etwa jedes zweite bis dritte Element; „bild“ für abstrakte Aussagen, "
            "Zahlen, Vergleiche, Symbolik." if clips else "immer „bild“.") + "\n"
            "- idee: deutsche Bildidee für ein KI-Symbolbild (konkret, filmisch, abwechslungsreich: Totale, Nahaufnahme, Detail; keine Schrift, "
            "keine Logos/Marken, keine erkennbaren realen Personen, keine Nacktheit). Auch bei „clip“ ausfüllen (Ersatz, falls kein Clip passt).\n"
            "- suche: 2–4 englische Suchwörter für Stock-Videos (z. B. „watch mechanism closeup“). Auch bei „bild“ ausfüllen.\n"
            "- wort: ein Wort aus dem Szenentext, bei dem das Element erscheint (beim ersten Element das erste Wort der Szene).\n"
            "Das erste Element jeder Szene nimmt die bisherige Bildidee auf, wenn eine angegeben ist.",
            *(
                [
                    "Eigene Clips (Bibliothek des Kanals – echte Aufnahmen, haben Vorrang vor Stock-Clips und Bildern): Passt einer "
                    "inhaltlich wirklich zum gesprochenen Satz, nimm ihn: art „eigen“, eigen = Kennung (z. B. „E3“). Jede Kennung "
                    "höchstens einmal. Passt keiner, nicht erzwingen – dann „clip“ oder „bild“ und eigen leer. Selten benutzte bevorzugen.\n"
                    + "\n".join(_katalog_zeile(m, e) for m, e in zip(marken, kat))
                ]
                if kat
                else []
            ),
            "Szenen:\n" + "\n".join(zeilen),
        ]
    )
    text, _u = ki.fragen(l.claude, l.modell, prompt, was="Bildplan (Bilder und Clips je Szene)", schema=BILDPLAN_SCHEMA, effort="low")
    d = ki.json_aus(text)
    return {int(x.get("nr") or 0): [b for b in x.get("bilder") or [] if isinstance(b, dict)] for x in d.get("szenen") or [] if isinstance(x, dict)}, marken


def _katalog_zeile(marke: str, e: dict) -> str:
    """Eine Zeile der Liste „Eigene Clips“ im Bildplan: Kennung, (Foto), Beschreibung, Schlagwörter, Länge, Nutzung."""
    foto = e.get("art") == "foto"
    laenge = "Foto" if foto else f"{float(e.get('dauer') or 0):.0f} s"
    tags = ", ".join((e.get("schlagwoerter") or [])[:10])
    return f"{marke}: {'[Foto] ' if foto else ''}{e.get('beschreibung') or ''} [{tags}] {laenge}, {int(e.get('benutzt') or 0)}× benutzt"


def _bildplan(l: Lauf, auswahl: list[tuple[int, dict]], sek: float, eigene: list[dict] | None = None) -> dict[int, list[dict]]:
    """Bildplan je Szene (gemerkt im Projekt – ein Neustart kostet nichts). Fehlende Einträge werden aufgefüllt.
    Eigene Clips: jeder höchstens einmal je Video (auch über mehrere Aufrufe hinweg)."""
    plan: dict[int, list[dict]] = {}
    fehlen: list[tuple[int, dict, int]] = []
    eigene = eigene or []
    fp = kurz_hash(*sorted(e["id"] for e in eigene)) if eigene else ""
    vergeben: set[str] = set()
    for i, s in auswahl:
        n = bewegt.anzahl(float(s.get("dauer") or 0), sek)
        k = _bp_key(l, s, n, fp)
        if k in l.p.state["bildplan"]:
            plan[i] = l.p.state["bildplan"][k]
            vergeben.update(e.get("eigen_id") for e in plan[i] if e.get("eigen_id"))
        else:
            fehlen.append((i, s, n))
    for a in range(0, len(fehlen), BILDPLAN_JE_AUFRUF):
        teil = fehlen[a : a + BILDPLAN_JE_AUFRUF]
        antwort, marken = _bildplan_holen(l, teil, [e for e in eigene if e["id"] not in vergeben])
        for i, s, n in teil:
            elemente = (antwort.get(i + 1) or [])[:n]
            for k2, e in enumerate(elemente):  # Kennung → Clip-ID; doppelt oder unbekannt → Stock-Clip
                if e.get("art") == "eigen":
                    eid = marken.get(str(e.get("eigen") or "").strip().upper())
                    if eid and eid not in vergeben:
                        vergeben.add(eid)
                        elemente[k2] = {**e, "eigen_id": eid}
                    else:
                        elemente[k2] = {**e, "art": "clip"}
            idee0 = s.get("bildidee") or ""
            while len(elemente) < n:  # Claude lieferte zu wenige: Varianten der Bildidee
                k = len(elemente)
                elemente.append({"art": "bild", "idee": (idee0 or "ruhiges Symbolbild zum Thema") + (" – Detailaufnahme" if k % 2 else " – Totale"), "suche": "", "wort": ""})
            if idee0 and elemente[0].get("art") == "bild":
                elemente[0] = {**elemente[0], "idee": idee0}  # schon bezahltes Szenenbild wiederverwenden
            if not stock_clips(l):
                elemente = [{**e, "art": "bild"} for e in elemente]
            plan[i] = elemente
            l.p.state["bildplan"][_bp_key(l, s, n, fp)] = elemente
        l.p.speichern()
    return plan


def _clip_laden(l: Lauf, url: str, ziel) -> None:
    """Clip-Datei direkt vom Anbieter (CDN) laden – ohne Worker-Token, nur von erlaubten Hosts."""
    from urllib.parse import urlparse

    u = urlparse(url)
    host = (u.hostname or "").lower()
    erlaubt = any(host == h or host.endswith("." + h) for h in CLIP_HOSTS) and u.scheme == "https"
    if not (erlaubt or host in l.k.clip_hosts):
        raise RuntimeError(f"Clip-Adresse nicht erlaubt: {host}")
    tmp = ziel.with_suffix(".part")
    with requests.get(url, stream=True, timeout=(20, 120)) as r:
        if r.status_code != 200:
            raise RuntimeError(f"Clip-Download HTTP {r.status_code}")
        groesse = 0
        with open(tmp, "wb") as f:
            for block in r.iter_content(256 * 1024):
                groesse += len(block)
                if groesse > 250 * 1024**2:
                    raise RuntimeError("Clip größer als 250 MB")
                f.write(block)
    tmp.replace(ziel)


def _clip_treffer(l: Lauf, quelle: str, pfad: str, params: dict, suche: str, hinweise: list[str], wo: str, aus: set[str]) -> list[dict] | None:
    """Suchergebnis einer Quelle (im Projekt gemerkt – ein Neustart sucht nicht neu). None = Quelle hier nicht nutzbar."""
    cache = l.p.state.setdefault("clipsuche", {})
    k = f"{quelle}:{suche}"
    treffer = cache.get(k)
    if treffer is None and quelle == "pexels":
        treffer = (l.p.state.get("pexels") or {}).get(suche)  # Projekte von 1.4.0
    if treffer is not None:
        return treffer
    name = dict((q[0], q[1]) for q in CLIP_QUELLEN)[quelle]
    r = l.seller.anbieter_holen(l.id, quelle, pfad, {"query": suche, **params}, was=f"{name}-Suche – {wo}")
    if r.status_code == 424:  # Schlüssel fehlt: diese Quelle für den ganzen Lauf auslassen
        aus.add(quelle)
        return None
    if r.status_code != 200:
        hinweise.append(f"{wo}: {name}-Suche „{suche}“ fehlgeschlagen ({_fehlertext(r)}).")
        return None
    treffer = [
        {"id": str(v.get("id")), "quelle": quelle, "duration": v.get("duration"), "url": v.get("url"), "user": {"name": (v.get("user") or {}).get("name")}, "video_files": [{k2: f.get(k2) for k2 in ("link", "width", "height", "file_type")} for f in v.get("video_files") or []]}
        for v in (r.json().get("videos") or [])[:12]
    ]
    cache[k] = treffer
    l.p.speichern()
    return treffer


def _clip_holen(l: Lauf, suche: str, dauer: float, benutzt: set[str], hinweise: list[str], wo: str, aus: set[str] | None = None) -> str | None:
    """Passenden Stock-Clip suchen – erst Pixabay, dann Pexels (über die Brücke, die Schlüssel bleiben im Seller-System)
    – und laden. None = keiner passt. Ist keine Quelle verbunden, _OhneClips (alle Clips werden zu Bildern)."""
    aus = set() if aus is None else aus
    suche = re.sub(r"[^\w\s-]", " ", suche or "").strip()[:80]
    if not suche or bild_treffer(suche, l.streng):
        return None
    for quelle, _name, _domain, pfad, params in CLIP_QUELLEN:
        if quelle in aus:
            continue
        treffer = _clip_treffer(l, quelle, pfad, params, suche, hinweise, wo, aus)
        if not treffer:
            continue
        wahl = bewegt.clip_waehlen(treffer, dauer, benutzt)
        if not wahl:
            continue
        v, datei = wahl
        vid = str(v["id"])
        if not l.p.datei_vorhanden("stock", vid):
            rel = f"stock/{vid}.mp4"
            _clip_laden(l, datei["link"], l.p.pfad(rel))
            l.p.datei_merken("stock", vid, rel, dauer=float(v.get("duration") or 0), url=v.get("url") or "", fotograf=((v.get("user") or {}).get("name") or "")[:80], quelle=quelle)
        benutzt.add(vid)
        return vid
    if all(q[0] in aus for q in CLIP_QUELLEN):
        raise _OhneClips("weder Pixabay noch Pexels verbunden")
    return None


class _OhneClips(Exception):
    """Keine Clip-Quelle (Pixabay/Pexels) im Seller-System verbunden – alle Clips werden zu Bildern."""


# ---- B36.12 eigene Clip-Bibliothek (Ordner „clips“ am Worker-PC) ------------------------------------------------------


def _clipbib(l: Lauf) -> clipbib.Bibliothek:
    return clipbib.Bibliothek(l.k.arbeitsordner / "clipbibliothek")


def _clip_ansehen(l: Lauf, bib: clipbib.Bibliothek, cid: str, d: dict, hinweise: list[str]) -> dict | None:
    """Einen neuen Clip einmal ansehen: Technik prüfen, 4 Standbilder → Claude (Beschreibung, Schlagwörter, bestes Bild,
    brauchbar?), Vorschaubild fürs Seller-System. None = nicht geklappt (nächstes Mal neu)."""
    foto = d.get("art") == "foto"
    info = clipbib.foto_info(d["datei"]) if foto else clipbib.video_info(l.k.ffprobe, d["datei"])
    quelle, filmer = clipbib.quelle_aus_name(d["datei"].name)
    e: dict[str, Any] = {
        "id": cid, "art": "foto" if foto else "video", "pfad": d["pfad"], "kanal": d["kanal"], "tags": d["tags"], "dauer": round(info["dauer"], 2), "breite": int(info["breite"]), "hoehe": int(info["hoehe"]),
        "quelle": quelle, "filmer": filmer, "benutzt": 0, "zuletzt": None, "analysiert": True, "beschreibung": "", "schlagwoerter": list(d["tags"]),
        "einstellung": None, "brauchbar": True, "grund": "", "abschnitt": None,
    }
    if foto:
        technik = (
            "Datei nicht lesbar" if info["breite"] <= 0
            else "Hochformat" if info["hoehe"] > info["breite"]
            else f"Auflösung zu klein ({int(info['breite'])} px breit, mind. {clipbib.MIN_FOTO_BREITE})" if info["breite"] < clipbib.MIN_FOTO_BREITE
            else ""
        )
    else:
        technik = (
            "zu kurz (unter 2 s)" if info["dauer"] < clipbib.MIN_DAUER
            else "Hochformat" if info["hoehe"] > info["breite"]
            else f"Auflösung zu klein ({int(info['breite'])} px breit)" if info["breite"] < clipbib.MIN_BREITE
            else ""
        )
    ordner = bib.ordner / cid
    if foto:
        bilder = []
        try:
            clipbib.foto_vorschau(d["datei"], ordner / "vorschau.jpg")
            bilder = [(0.0, d["datei"])]  # das Foto selbst (wird nicht gelöscht)
        except Exception:
            pass
    else:
        bilder = clipbib.standbilder(l.k.ffmpeg, d["datei"], info["dauer"], ordner) if info["dauer"] > 0 else []
        if bilder:
            clipbib.vorschau([b for _t, b in bilder], ordner / "vorschau.jpg")
    if technik or not bilder:
        e.update(brauchbar=False, grund=technik or "Datei nicht lesbar")
    else:
        inhalt: list[dict[str, Any]] = [{"type": "text", "text": clipbib.analyse_prompt(d["pfad"], info["dauer"], [t for t, _b in bilder], d["tags"], l.kanal, foto=foto)}]
        bild_bytes = [clipbib.foto_jpeg(d["datei"], 1024)] if foto else [b.read_bytes() for _t, b in bilder]
        inhalt += [{"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.b64encode(x).decode()}} for x in bild_bytes]
        try:
            text, _u = ki.fragen(l.claude, l.modell, inhalt, was=f"Clip ansehen – {d['pfad']}", schema=clipbib.ANALYSE_SCHEMA, effort="low", max_tokens=2000)
            a = ki.json_aus(text)
        except Exception as x:  # ein Clip darf das Video nicht aufhalten
            hinweise.append(f"Clip-Bibliothek: {d['pfad']} konnte nicht angesehen werden ({x}) – nächstes Mal neu.")
            return None
        sw = [str(w).strip().lower()[:40] for w in a.get("schlagwoerter") or [] if str(w).strip()]
        best = min(max(int(a.get("bestes_bild") or 1), 1), len(bilder))
        start = round(max(0.0, bilder[best - 1][0] - 1.0), 2)
        ok = bool(a.get("brauchbar", True))
        e.update(
            beschreibung=str(a.get("beschreibung") or "").strip()[:600],
            schlagwoerter=list(dict.fromkeys([*d["tags"], *sw]))[:25],
            einstellung=a.get("einstellung"),
            brauchbar=ok,
            grund="" if ok else (str(a.get("grund") or "").strip()[:200] or "von Claude aussortiert"),
            abschnitt=None if foto else {"start": start, "dauer": round(max(0.5, info["dauer"] - start), 2)},
        )
    if not foto:
        for _t, b in bilder:
            b.unlink(missing_ok=True)
    bib.clips[cid] = e
    bib.speichern()
    return e


def _clipbib_melden(l: Lauf, bib: clipbib.Bibliothek, ids: list[str], vollstaendig: bool = True) -> None:
    """Abgleich mit dem Seller-System (nur Metadaten + Vorschaubilder – die Videos bleiben am PC). vollständig = alle
    Clips im Ordner (fehlende werden dort als „nicht mehr im Ordner“ markiert); sonst nur diese (z. B. Nutzung)."""
    felder = ("pfad", "kanal", "dauer", "breite", "hoehe", "beschreibung", "schlagwoerter", "einstellung", "brauchbar", "grund", "abschnitt", "quelle", "filmer", "benutzt", "zuletzt")
    clips = [{"id": cid, "art": bib.clips[cid].get("art") or "video", **{f: bib.clips[cid].get(f) for f in felder}} for cid in ids]
    try:
        r = l.seller.clips_melden(clips, vollstaendig=vollstaendig)
        for cid in r.get("vorschauFehlt") or []:
            v = bib.ordner / str(cid) / "vorschau.jpg"
            if cid in bib.clips and v.exists():
                l.seller.clip_vorschau(str(cid), v.read_bytes())
    except Exception as x:  # Abgleich ist Anzeige – das Video läuft weiter
        print(f"Clip-Bibliothek: Abgleich mit dem Seller-System fehlgeschlagen ({x})")


def _clipbib_vorbereiten(l: Lauf, hinweise: list[str]) -> list[dict]:
    """Clip-Ordner abgleichen: neue Clips ansehen (höchstens 40 je Video), Seller-System informieren. Liefert die für
    diesen Kanal nutzbaren Clips – mit den Korrekturen von Hand (gesperrt, Schlagwörter, Beschreibung)."""
    ordner = l.k.clipordner
    if not ordner or not ordner.is_dir():
        return []
    kanal_ordner = {clipbib.slug(x) for x in (l.a.get("kanalOrdner") or []) if x} | {str(l.kanal.get("slug") or "")}
    dateien = clipbib.scannen(ordner, kanal_ordner)
    if not dateien:
        return []
    bib = _clipbib(l)
    neu = offen = 0
    gesehen: list[str] = []
    for d in dateien:
        try:
            cid = clipbib.clip_id(d["datei"])
        except OSError:
            continue
        e = bib.clips.get(cid)
        if e and e.get("analysiert"):
            if (e.get("pfad"), e.get("kanal"), e.get("tags")) != (d["pfad"], d["kanal"], d["tags"]):  # verschoben/umbenannt
                e.update(pfad=d["pfad"], kanal=d["kanal"], tags=d["tags"], schlagwoerter=list(dict.fromkeys([*d["tags"], *(e.get("schlagwoerter") or [])]))[:25])
                bib.speichern()
            gesehen.append(cid)
            continue
        if cid in gesehen:
            continue  # gleiche Datei zweimal im Ordner
        if d["kanal"] and d["kanal"] != l.kanal.get("slug"):
            continue  # Ordner eines anderen Kanals: wird bei dessen Video angesehen (mit dessen Thema)
        if neu >= clipbib.ANALYSE_JE_LAUF:
            offen += 1
            continue
        neu += 1
        if _clip_ansehen(l, bib, cid, d, hinweise):
            gesehen.append(cid)
    if neu:
        hinweise.append(f"Clip-Bibliothek: {neu} neue Clips angesehen" + (f", {offen} weitere beim nächsten Video" if offen else "") + ".")
    _clipbib_melden(l, bib, list(dict.fromkeys(gesehen)))
    korr = l.a.get("clipKorrekturen") or {}
    aus: list[dict] = []
    for cid in dict.fromkeys(gesehen):
        e = bib.clips[cid]
        if not e.get("brauchbar") or (e.get("kanal") and e["kanal"] != l.kanal.get("slug")):
            continue
        w = clipbib.wirksam(e, korr.get(cid))
        if w:
            aus.append(w)
    return aus


def _eigen_holen(l: Lauf, e: dict, dauer: float) -> str | None:
    """Eigenen Clip vorbereiten: den besten Abschnitt in passender Länge als 1920×1080 ins Projekt schneiden."""
    if not l.k.clipordner:
        return None
    quelle = l.k.clipordner / str(e.get("pfad") or "")
    if not quelle.is_file():
        return None
    vid = f"eigen-{e['id']}"
    if l.p.datei_vorhanden("stock", vid):
        return vid
    gesamt = float(e.get("dauer") or 0)
    start = float((e.get("abschnitt") or {}).get("start") or 0)
    if start + dauer > gesamt:
        start = max(0.0, gesamt - dauer)
    laenge = max(0.5, min(gesamt - start, dauer + 1.0))
    rel = f"stock/{vid}.mp4"
    ziel = l.p.pfad(rel)
    ziel.parent.mkdir(parents=True, exist_ok=True)
    vf = f"scale={bewegt.BREITE}:{bewegt.HOEHE}:force_original_aspect_ratio=increase,crop={bewegt.BREITE}:{bewegt.HOEHE},setsar=1,format=yuv420p"
    r = subprocess.run([l.k.ffmpeg, "-y", "-v", "error", "-ss", f"{start:.2f}", "-i", str(quelle), "-t", f"{laenge:.2f}", "-vf", vf, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", str(ziel)], capture_output=True, text=True)
    if r.returncode != 0 or not ziel.exists():
        return None
    l.p.datei_merken("stock", vid, rel, dauer=laenge, url="", fotograf=e.get("filmer") or "", quelle=e.get("quelle") or "eigen")
    _clipbib(l).benutzt(e["id"])
    return vid


def _foto_holen(l: Lauf, e: dict) -> str | None:
    """Eigenes Foto als Bild ins Projekt (aufrecht, höchstens 2400 px breit) → Schlüssel in state["bilder"]; bekommt
    beim Rendern dieselbe Kamerafahrt wie die KI-Bilder."""
    if not l.k.clipordner:
        return None
    quelle = l.k.clipordner / str(e.get("pfad") or "")
    if not quelle.is_file():
        return None
    key = f"foto-{e['id']}"
    if not l.p.datei_vorhanden("bilder", key):
        rel = f"bilder/{key}.jpg"
        try:
            schreiben_atomar(l.p.pfad(rel), clipbib.foto_jpeg(quelle, 2400))
        except Exception:
            return None
        l.p.datei_merken("bilder", key, rel, ersatz=False, quelle=e.get("quelle") or "eigen", fotograf=e.get("filmer") or "")
        _clipbib(l).benutzt(e["id"])
    return key


def visuals(l: Lauf) -> tuple[dict, list[str]]:
    if l.whiteboard:
        return visuals_wb(l)
    szenen = l.daten.get("skript") or []
    hinweise: list[str] = []
    for s in szenen:  # Dauer kommt aus der Sprache (Schritt davor)
        v = l.p.state["voice"].get(voice_key(l, s["text"]))
        if v and not s.get("dauer"):
            s["dauer"] = round(float(v["dauer"]) + PAUSE_S, 3)
    n_bilder, n_clips = _vb_bebildern(l, list(enumerate(szenen)), hinweise)
    gesamt = sum(float(s.get("dauer") or 0) for s in szenen)
    if gesamt > 0:
        hinweise.append(f"Bebilderung: {n_bilder} Bilder und {n_clips} Clips für {gesamt / 60:.1f} Min. – im Schnitt alle {gesamt / max(1, n_bilder + n_clips):.1f} s ein neues Bild.")
    l.p.markieren("visuals", hinweise=hinweise)
    return {"skript": _ohne_intern(szenen)}, hinweise


def _vb_bebildern(l: Lauf, auswahl: list[tuple[int, dict]], hinweise: list[str]) -> tuple[int, int]:
    """Bildplan holen und je Szene die Bilder (bezahlt nur Neues) bzw. Stock-Clips (Pixabay/Pexels) besorgen → s["bilder"]."""
    sek = bewegt.bild_sek(l.kanal)
    clips_an = stock_clips(l)
    eigene = _clipbib_vorbereiten(l, hinweise) if clips_an else []
    eigen_nach_id = {e["id"]: e for e in eigene}
    plan = _bildplan(l, auswahl, sek, eigene)
    quellen_aus: set[str] = set()
    benutzt: set[str] = set()
    n_bilder = n_clips = n_eigen = 0
    eigen_genutzt: list[str] = []
    for i, s in auswahl:
        dauer = float(s.get("dauer") or 0) or 8.0
        elemente = plan.get(i) or [{"art": "bild", "idee": s.get("bildidee") or "", "suche": "", "wort": ""}]
        zeiten = bewegt.zeiten(dauer, len(elemente), _wortzeiten(l, s), [e.get("wort") for e in elemente])
        aus: list[dict] = []
        for k, (e, (start, laenge)) in enumerate(zip(elemente, zeiten)):
            wo = f"Szene {i + 1}.{k + 1}"
            eintrag = {"art": "bild", "idee": (e.get("idee") or s.get("bildidee") or "")[:300], "suche": (e.get("suche") or "")[:80], "wort": (e.get("wort") or "")[:40], "start": start, "dauer": laenge}
            if e.get("art") == "eigen" and e.get("eigen_id") in eigen_nach_id:  # eigene Clips auch ohne Pixabay/Pexels
                eigen = eigen_nach_id[e["eigen_id"]]
                if eigen.get("art") == "foto":  # eigenes Foto statt KI-Bild (mit Kamerafahrt)
                    key = _foto_holen(l, eigen)
                    if key:
                        eintrag.update(art="bild", key=key, eigen=True, foto=True, ersatz=False)
                        eigen_genutzt.append(eigen["id"])
                        n_bilder += 1
                        n_eigen += 1
                    else:
                        hinweise.append(f"{wo}: eigenes Foto nicht mehr im Ordner – KI-Bild statt dessen.")
                else:
                    vid = _eigen_holen(l, eigen, laenge + bewegt.UEBERGANG)
                    if vid:
                        eintrag.update(art="clip", clip=vid, eigen=True)
                        benutzt.add(vid)
                        eigen_genutzt.append(eigen["id"])
                        n_clips += 1
                        n_eigen += 1
                    else:
                        hinweise.append(f"{wo}: eigener Clip nicht mehr im Ordner – Stock-Clip/Bild statt dessen.")
            if e.get("art") in ("clip", "eigen") and clips_an and eintrag["art"] == "bild" and not eintrag.get("foto"):
                try:
                    vid = _clip_holen(l, e.get("suche") or "", laenge + bewegt.UEBERGANG, benutzt, hinweise, wo, quellen_aus)
                except _OhneClips as x:
                    hinweise.append(f"Keine Clip-Quelle verbunden ({x}) – Bilder statt Clips. Schlüssel unter Anbindungen → Pixabay eintragen.")
                    clips_an = False
                    vid = None
                if vid:
                    eintrag.update(art="clip", clip=vid)
                    n_clips += 1
            if eintrag["art"] == "bild" and not eintrag.get("foto"):
                eintrag["key"] = _vb_bild(l, eintrag["idee"], f"{i + 1:03d}-{k + 1}", s.get("einblendung") or "", hinweise, wo)
                eintrag["ersatz"] = bool(l.p.state["bilder"][eintrag["key"]].get("ersatz"))
                n_bilder += 1
            aus.append(eintrag)
        s["bilder"] = aus
        s["ersatzbild"] = any(x.get("ersatz") for x in aus)
        l.fortschritt("visuals", i + 1, len(l.daten.get("skript") or auswahl))
    if eigene:
        n_fotos = sum(1 for e in eigene if e["id"] in eigen_genutzt and e.get("art") == "foto")
        hinweise.append(f"Clip-Bibliothek: {n_eigen} eigene Clips/Fotos eingesetzt{f' (davon {n_fotos} Fotos)' if n_fotos else ''} (von {len(eigene)} passenden im Ordner).")
        bib = _clipbib(l)
        genutzt = [cid for cid in dict.fromkeys(eigen_genutzt) if cid in bib.clips]
        if genutzt:  # Nutzung („k× benutzt“) gleich im Seller-System zeigen
            _clipbib_melden(l, bib, genutzt, vollstaendig=False)
    return n_bilder, n_clips


# ---- 5 render ------------------------------------------------------------------------------------------------------


def _schluessel_szene(l: Lauf, s: dict) -> tuple[str, str]:
    v = voice_key(l, s["text"])
    stil = (l.kanal.get("bildstil") or "Moderne, ruhige Illustration in warmen Farben").strip()
    idee = ERSATZ_BILDIDEE if bild_treffer(s.get("bildidee") or "", l.streng) else (s.get("bildidee") or "")
    b = kurz_hash(f"{stil}. {idee}. Symbolbild ohne Text und ohne Schrift, keine erkennbaren realen Personen, keine Nacktheit.")
    return v, b


def _ton(l: Lauf, s: dict):
    v = voice_key(l, s["text"])
    return v, l.p.datei_vorhanden("voice", v)


def render_wb(l: Lauf) -> tuple[dict, list[str]]:
    """Whiteboard: je Szene Aufdeck-Animation mit Hand über dem blassen Vorgänger; Untertitel NICHT eingebrannt
    (gehen als YouTube-Untertitel mit dem Upload)."""
    video = l.p.pfad("video.mp4")
    szenen = l.daten.get("skript") or []
    clips = l.p.pfad("clips", "x").parent
    hinweise: list[str] = []
    hand = wb.hand_laden()
    namen: list[str] = []
    srt_gesamt: list[str] = []
    t, nr = 0.0, 1
    vorher = None
    vorher_key = ""
    for i, s in enumerate(szenen):
        v, ton = _ton(l, s)
        if not ton:
            raise RuntimeError(f"Szene {i + 1}: Sprache fehlt – bitte Schritt „Sprache“ wiederholen.")
        fehlend = [m["key"] for m in s.get("motive") or [] if not l.bib.hat(m["key"])]
        if fehlend:
            raise RuntimeError(f"Szene {i + 1}: Motiv(e) {', '.join(fehlend)} fehlen – bitte Schritt „Bilder“ wiederholen.")
        laenge = l.p.state["voice"][v]["dauer"] + PAUSE_S
        teile = medien.untertitel_teile(s["text"], laenge - PAUSE_S)
        srt_gesamt.append(medien.srt(teile, versatz=t, start_nr=nr))
        nr += len(teile)
        name = f"{i + 1:03d}"
        inhalt = json.dumps({k: s.get(k) for k in ("layout", "ueberschrift", "balken", "kernaussage", "schrittText", "liste")}, ensure_ascii=False, sort_keys=True)
        grund = wb.hintergrund(vorher)
        els = wb.elemente(s, [l.bib.bild(m["key"]) for m in s.get("motive") or []], _striche(l, s))
        plan, s["takt"] = _wb_takt(l, s, els)
        anker = (0.5, 0.35, 0.65)[i % 3]  # leichter Schwenk: Zoom mal mittig, mal nach links, mal nach rechts
        key = kurz_hash(vorher_key, v, inhalt, *[l.bib.merkmal(m["key"]) for m in s.get("motive") or []], str(l.k.fps), json.dumps([e.__dict__ for e in plan]), str(ZOOM), str(anker), "wb3-" + wb.strich.VERSION)
        if l.p.state["clips"].get(name, {}).get("key") == key and (clips / f"{name}.mp4").exists():
            vorher = wb.fertig_takt(grund, els, plan)
        else:
            bilder_ordner = clips / f"b{name}"
            liste, vorher = wb.animation_takt(grund, els, plan, laenge, l.k.fps, hand, bilder_ordner, vorher)
            medien.clip_bilder(l.k.ffmpeg, bilder_ordner, liste, "../../" + ton.relative_to(l.p.ordner).as_posix(), f"../{name}.mp4", laenge, l.k.fps, zoom=ZOOM, anker=anker)
            shutil.rmtree(bilder_ordner, ignore_errors=True)
            l.p.state["clips"][name] = {"key": key}
            l.p.speichern()
        vorher_key = key
        namen.append(f"{name}.mp4")
        t += laenge
        l.fortschritt("render", i + 1, len(szenen) + 1)
    return _render_abschluss(l, video, clips, namen, srt_gesamt, hinweise, len(szenen))


def _render_abschluss(l: Lauf, video, clips, namen: list[str], srt_gesamt: list[str], hinweise: list[str], anzahl: int) -> tuple[dict, list[str]]:
    medien.zusammenfuegen(l.k.ffmpeg, clips, namen, "gesamt.mp4")
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
    # Ziel-Dauer aus dem Wortziel (eigenes, kürzeres Skript → kürzeres Video ist richtig); Toleranz für Sprechtempo
    w_lo, w_hi = l.woerter_ziel()
    lo, hi = (l.laenge["sekunden"] if [w_lo, w_hi] == list(l.laenge["woerter"]) else (round(w_lo / 145 * 60 * 0.85), round(w_hi / 145 * 60 * 1.15)))
    if not lo <= dauer <= hi:
        hinweise.append(f"Video ist {dauer // 60}:{dauer % 60:02d} lang (Ziel {l.minuten().replace('Minuten', 'Min.')}).")
    l.p.zwischendateien_loeschen()
    l.fortschritt("render", anzahl + 1, anzahl + 1)
    l.p.markieren("render", dauer=dauer, hinweise=hinweise)
    return {"dauerSek": dauer}, hinweise


def render(l: Lauf) -> tuple[dict, list[str]]:
    video = l.p.pfad("video.mp4")
    if l.p.erledigt("render") and video.exists():
        e = l.p.state["schritte"]["render"]
        return {"dauerSek": e["dauer"]}, e.get("hinweise", [])
    if l.whiteboard:
        return render_wb(l)
    szenen = l.daten.get("skript") or []
    clips = l.p.pfad("clips", "x").parent
    namen: list[str] = []
    srt_gesamt: list[str] = []
    t = 0.0
    nr = 1
    for i, s in enumerate(szenen):
        v, ton = _ton(l, s)
        if not ton:
            raise RuntimeError(f"Szene {i + 1}: Sprache fehlt – bitte Schritt „Sprache“ wiederholen.")
        laenge = l.p.state["voice"][v]["dauer"] + PAUSE_S
        teile = medien.untertitel_teile(s["text"], laenge - PAUSE_S)
        srt_gesamt.append(medien.srt(teile, versatz=t, start_nr=nr))
        nr += len(teile)
        name = f"{i + 1:03d}"
        _vb_szene(l, i, s, clips, name, v, ton, laenge, teile)
        namen.append(f"{name}.mp4")
        t += laenge
        l.fortschritt("render", i + 1, len(szenen) + 1)
    return _render_abschluss(l, video, clips, namen, srt_gesamt, [], len(szenen))


def _vb_elemente(l: Lauf, s: dict) -> list[dict]:
    """Bilder/Clips einer Szene (Bildplan, B36.11). Skripte von vorher ohne Plan: das eine Szenenbild – dann
    wenigstens mit Kamerafahrt statt Standbild."""
    if s.get("bilder"):
        return s["bilder"]
    _v, b = _schluessel_szene(l, s)
    return [{"art": "bild", "key": b, "start": 0.0, "dauer": float(s.get("dauer") or 1)}]


def _vb_szene(l: Lauf, i: int, s: dict, ordner, name: str, v: str, ton, laenge: float, teile: list) -> None:
    """Szene im Stil Vollbild: je Bild/Clip ein Stück (Kamerafahrt bzw. zugeschnittener Clip), weich überblendet,
    Einblendung blendet ein, Untertitel eingebrannt. Gerechnete Stücke werden wiederverwendet (Schlüssel)."""
    els = _vb_elemente(l, s)
    summe = sum(max(0.5, float(e.get("dauer") or 0)) for e in els) or 1.0
    dauern = [max(0.5, float(e.get("dauer") or 0)) * laenge / summe for e in els]
    segmente: list[tuple[str, float]] = []
    keys: list[str] = []
    for k, (e, d) in enumerate(zip(els, dauern)):
        lang = d + (bewegt.UEBERGANG if k < len(els) - 1 else 0.0)
        datei = f"seg/{name}-{k + 1}.mp4"
        if e.get("art") == "clip" and e.get("clip"):
            quelle = l.p.datei_vorhanden("stock", str(e["clip"]))
            if not quelle:
                raise RuntimeError(f"Szene {i + 1}: Clip {e['clip']} fehlt – bitte Schritt „Bilder“ wiederholen.")
            key = kurz_hash("clip", str(e["clip"]), f"{lang:.3f}", str(l.k.fps), "s1")
        else:
            quelle = l.p.datei_vorhanden("bilder", str(e.get("key") or ""))
            if not quelle:
                raise RuntimeError(f"Szene {i + 1}: Bild fehlt – bitte Schritt „Bilder“ wiederholen.")
            variante = bewegt.VARIANTEN[(i * 2 + k) % len(bewegt.VARIANTEN)]
            key = kurz_hash("bild", str(e.get("key")), f"{lang:.3f}", variante, str(l.k.fps), "s1")
        ziel = ordner / datei
        if not (l.p.state["clips"].get(datei, {}).get("key") == key and ziel.exists()):
            ziel.parent.mkdir(parents=True, exist_ok=True)
            if e.get("art") == "clip" and e.get("clip"):
                bewegt.segment_clip(l.k.ffmpeg, quelle, ziel, lang, l.k.fps)
            else:
                bewegt.segment_bild(l.k.ffmpeg, quelle, ziel, lang, l.k.fps, variante)
            l.p.state["clips"][datei] = {"key": key}
        segmente.append((datei, d))
        keys.append(key)
    einbl = (s.get("einblendung") or "").strip()
    key = kurz_hash(v, *keys, einbl, f"{laenge:.3f}", str(l.k.fps), "vb1")
    if l.p.state["clips"].get(name, {}).get("key") == key and (ordner / f"{name}.mp4").exists():
        return
    band = None
    if einbl:
        band = f"{name}-band.png"
        medien.band_png(einbl, ordner / band)
    (ordner / f"{name}.srt").write_text(medien.srt(teile), encoding="utf-8")
    ton_rel = os.path.relpath(ton, ordner).replace(os.sep, "/")
    bewegt.szene(l.k.ffmpeg, ordner, segmente, band, ton_rel, f"{name}.srt", medien._STIL, f"{name}.mp4", laenge, l.k.fps, nr=i)
    l.p.state["clips"][name] = {"key": key}
    l.p.speichern()


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
        text, _u = ki.fragen(l.claude, l.modell, prompt, was="Paket (Titel, Beschreibung, Tags)", schema=PAKET_SCHEMA, effort="low")
        d = ki.json_aus(text)
        treffer = [t for t in d.get("titel", []) + [d.get("thumbnail_text", "")] if titel_treffer(t)]
        if not treffer:
            break
        prompt = basis + f"\n\nKorrektur: Diese Titel enthalten unpassende Begriffe und müssen ersetzt werden: {treffer}"
    return d


def clip_nachweis(l: Lauf, szenen: list[dict]) -> str:
    """Stock-Clips im Video: Nachweis je Quelle in der Beschreibung (Pixabay und Pexels verlangen es nicht, bitten aber
    darum), z. B. „Videos: Pixabay (pixabay.com) – A, B; Pexels (pexels.com) – C“."""
    namen: dict[str, list[str]] = {}
    arten: set[str] = set()
    for s in szenen:
        for e in s.get("bilder") or []:
            if e.get("art") == "clip" and e.get("clip"):
                info = l.p.state["stock"].get(str(e["clip"])) or {}
                quelle = info.get("quelle") or ("pixabay" if str(e["clip"]).startswith("pixabay-") else "pexels")
                art = "Videos"
            elif e.get("foto") and e.get("key"):  # B36.13 eigenes Foto, z. B. von Pexels geladen
                info = l.p.state["bilder"].get(str(e["key"])) or {}
                quelle = info.get("quelle") or "eigen"
                art = "Fotos"
            else:
                continue
            if quelle not in {q for q, *_rest in CLIP_QUELLEN}:
                continue  # eigene Aufnahme – keine Nennung
            arten.add(art)
            liste = namen.setdefault(quelle, [])
            f = info.get("fotograf") or ""
            if f and f not in liste:
                liste.append(f)
    teile = []
    for quelle, name, domain, _p, _par in CLIP_QUELLEN:
        if quelle in namen:
            n = namen[quelle]
            teile.append(f"{name} ({domain})" + (f" – {', '.join(n[:12])}" + (" u. a." if len(n) > 12 else "") if n else ""))
    titel = "Videos und Fotos" if len(arten) == 2 else (next(iter(arten)) if arten else "Videos")
    return f"{titel}: " + "; ".join(teile) if teile else ""


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
    nachweis = clip_nachweis(l, szenen)
    if nachweis:
        beschreibung += "\n\n" + nachweis
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
    if szenen and l.whiteboard:
        erstes_bild = l.p.pfad("szenen", "001.png") if l.p.pfad("szenen", "001.png").exists() else None
    elif szenen:
        erste = next((e for e in _vb_elemente(l, szenen[0]) if e.get("key")), None)
        erstes_bild = l.p.datei_vorhanden("bilder", erste["key"]) if erste else None
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
    z: dict | None = None
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
    if l.whiteboard and not yt.get("untertitel"):
        # B36.9.4: Untertitel nicht eingebrannt, sondern als YouTube-Untertitel (Spur „Deutsch“)
        srt = l.p.pfad("untertitel.srt")
        if not srt.exists():
            l.seller.datei_holen(l.id, "untertitel", srt)
        if srt.exists():
            z = z or l.seller.youtube_zugang(l.id)
            hinweis = _untertitel_hochladen(z, yt["id"], srt, l.kanal.get("sprache") or "de")
            if hinweis:
                hinweise.append(hinweis)
            else:
                yt["untertitel"] = True
                l.p.speichern()
    b = l.seller.youtube_bestaetigen(l.id, yt["id"])
    if not b.get("privat"):
        raise RuntimeError(f"Video ist NICHT privat (Sichtbarkeit: {b.get('sichtbarkeit')}) – sofort in YouTube Studio prüfen!")
    l.p.markieren("upload", youtube=yt["id"])
    return {}, hinweise


def _untertitel_hochladen(z: dict, video_id: str, srt, sprache: str) -> str | None:
    """captions.insert (multipart/related). Fehler → Hinweis statt Abbruch (das Video ist schon privat oben)."""
    grenze = "udd" + kurz_hash(video_id, str(srt.stat().st_size))
    meta = json.dumps({"snippet": {"videoId": video_id, "language": sprache, "name": "Deutsch" if sprache == "de" else sprache, "isDraft": False}})
    body = f"--{grenze}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta}\r\n--{grenze}\r\nContent-Type: application/octet-stream\r\n\r\n".encode("utf-8") + srt.read_bytes() + f"\r\n--{grenze}--\r\n".encode("utf-8")
    r = requests.post(f"{z['uploadBasis']}/youtube/v3/captions?uploadType=multipart&part=snippet", data=body, headers={"Authorization": f"Bearer {z['accessToken']}", "Content-Type": f"multipart/related; boundary={grenze}"}, timeout=120)
    if r.status_code in (200, 201):
        return None
    zusatz = " – YouTube im Kanalprofil neu verbinden (Recht für Untertitel fehlt)" if r.status_code in (401, 403) else ""
    return f"Untertitel nicht hochgeladen ({_fehlertext(r)}){zusatz}; untertitel.srt kann in YouTube Studio von Hand hochgeladen werden."


# ---- Probeszene (20 s) ------------------------------------------------------------------------------------------------

PROBE_S = 20.0


def probe(l: Lauf) -> tuple[dict, list[str]]:
    """Probeszene: ab Szene n so viele Szenen, bis etwa 20 s zusammen sind (höchstens 5), mit dem aktuellen Kanalprofil
    neu vertont (Sprechtempo, gekürzte Pausen – die Sprachdateien werden beim späteren Neu-Rendern wiederverwendet) und
    mit echtem Zeichnen und Hand gerendert. Ergebnis: probe.mp4 (≤ 20 s) auf dem Seller-System; das Video selbst bleibt."""
    szenen = l.daten.get("skript") or []
    if not szenen:
        raise RuntimeError("Kein Skript vorhanden.")
    if not (l.kanal.get("stimmeId") or "").strip():
        raise RuntimeError("Im Kanalprofil fehlt die Stimme (ElevenLabs-Voice-ID).")
    start = max(1, min(len(szenen), int((l.a.get("probe") or {}).get("szene") or 1)))
    ordner = l.p.pfad("probe", "x").parent
    shutil.rmtree(ordner, ignore_errors=True)
    ordner.mkdir(parents=True, exist_ok=True)
    if not l.whiteboard:
        return _probe_vollbild(l, szenen, start, ordner)
    hand = wb.hand_laden()
    hinweise: list[str] = []
    # blasser Hintergrund: fertiges Bild der Szene davor (wie im Video)
    vorher = None
    if start > 1:
        s0 = szenen[start - 2]
        if all(l.bib.hat(m["key"]) for m in s0.get("motive") or []):
            els0 = wb.elemente(s0, [l.bib.bild(m["key"]) for m in s0.get("motive") or []])
            vorher = wb.fertig_takt(wb.hintergrund(None), els0, _wb_takt(l, s0, els0)[0])
    namen: list[str] = []
    nummern: list[int] = []
    gesamt, w, striche = 0.0, 0, 0
    for i in range(start - 1, len(szenen)):
        s = szenen[i]
        fehlend = [m["key"] for m in s.get("motive") or [] if not l.bib.hat(m["key"])]
        if fehlend:
            raise RuntimeError(f"Szene {i + 1}: Motiv(e) {', '.join(fehlend)} fehlen in der Bibliothek – erst Schritt „Bilder“ ausführen.")
        v = _sprache_holen(l, i, s["text"])
        laenge = l.p.state["voice"][v]["dauer"] + PAUSE_S
        s["dauer"] = round(laenge, 3)
        pfade = _striche(l, s)
        striche += sum(len((d or {}).get("striche") or []) for d in pfade)
        els = wb.elemente(s, [l.bib.bild(m["key"]) for m in s.get("motive") or []], pfade)
        plan, _k = _wb_takt(l, s, els)
        name = f"{i + 1:03d}"
        bilder = ordner / f"b{name}"
        liste, vorher = wb.animation_takt(wb.hintergrund(vorher), els, plan, laenge, l.k.fps, hand, bilder, vorher)
        ton = l.p.datei_vorhanden("voice", v)
        medien.clip_bilder(l.k.ffmpeg, bilder, liste, "../../" + ton.relative_to(l.p.ordner).as_posix(), f"../{name}.mp4", laenge, l.k.fps, zoom=ZOOM, anker=(0.5, 0.35, 0.65)[i % 3])
        shutil.rmtree(bilder, ignore_errors=True)
        namen.append(f"{name}.mp4")
        nummern.append(i + 1)
        gesamt += laenge
        w += woerter(s["text"])
        l.fortschritt("probe", min(len(nummern), 5), 5)
        if gesamt >= PROBE_S - 1 or len(nummern) >= 5:
            break
    medien.zusammenfuegen(l.k.ffmpeg, ordner, namen, "probe-voll.mp4")
    dauer = min(gesamt, PROBE_S)
    medien.kuerzen(l.k.ffmpeg, ordner / "probe-voll.mp4", ordner / "probe.mp4", dauer)
    l.seller.datei_hochladen(l.id, "probe", ordner / "probe.mp4")
    wpm = round(w / gesamt * 60, 1) if gesamt > 0 else None
    if wpm is not None and wpm < WPM_WARNUNG:
        hinweise.append(f"Probeszene: {wpm:.0f} Wörter/Min (Ziel {WPM_ZIEL[0]}–{WPM_ZIEL[1]}) – Sprechtempo im Kanalprofil erhöhen.")
    for f in ordner.glob("*.mp4"):
        if f.name != "probe.mp4":
            f.unlink(missing_ok=True)
    l.p.speichern()
    return {"probe": {"szenen": nummern, "dauerSek": round(dauer, 1), "woerterProMin": wpm, "sprechtempo": sprechtempo(l.kanal), "striche": striche}}, hinweise


def _probe_vollbild(l: Lauf, szenen: list[dict], start: int, ordner) -> tuple[dict, list[str]]:
    """Probeszene im Stil Vollbild (B36.11): Szenen ab n neu vertonen (bis ~20 s), mit dem Bildplan bebildern
    (Bilder alle ~6 s, Clips), mit Kamerafahrt und Übergängen rendern. Bilder/Clips/Plan bleiben für das Neu-Rendern."""
    hinweise: list[str] = []
    auswahl: list[tuple[int, dict]] = []
    gesamt, w = 0.0, 0
    for i in range(start - 1, len(szenen)):
        s = szenen[i]
        v = _sprache_holen(l, i, s["text"])
        s["dauer"] = round(l.p.state["voice"][v]["dauer"] + PAUSE_S, 3)
        auswahl.append((i, s))
        gesamt += s["dauer"]
        w += woerter(s["text"])
        if gesamt >= PROBE_S - 1 or len(auswahl) >= 5:
            break
    n_bilder, n_clips = _vb_bebildern(l, auswahl, hinweise)
    namen: list[str] = []
    for k, (i, s) in enumerate(auswahl):
        v, ton = _ton(l, s)
        laenge = l.p.state["voice"][v]["dauer"] + PAUSE_S
        name = f"{i + 1:03d}"
        _vb_szene(l, i, s, ordner, name, v, ton, laenge, medien.untertitel_teile(s["text"], laenge - PAUSE_S))
        namen.append(f"{name}.mp4")
        l.fortschritt("probe", k + 1, len(auswahl))
    medien.zusammenfuegen(l.k.ffmpeg, ordner, namen, "probe-voll.mp4")
    dauer = min(gesamt, PROBE_S)
    medien.kuerzen(l.k.ffmpeg, ordner / "probe-voll.mp4", ordner / "probe.mp4", dauer)
    l.seller.datei_hochladen(l.id, "probe", ordner / "probe.mp4")
    wpm = round(w / gesamt * 60, 1) if gesamt > 0 else None
    if wpm is not None and wpm < WPM_WARNUNG:
        hinweise.append(f"Probeszene: {wpm:.0f} Wörter/Min (Ziel {WPM_ZIEL[0]}–{WPM_ZIEL[1]}) – Sprechtempo im Kanalprofil erhöhen.")
    for f in list(ordner.glob("*.mp4")) + list(ordner.glob("*.png")) + list(ordner.glob("*.srt")):
        if f.name != "probe.mp4":
            f.unlink(missing_ok=True)
    shutil.rmtree(ordner / "seg", ignore_errors=True)
    for k2 in [k2 for k2 in l.p.state["clips"] if k2.startswith("seg/")]:
        l.p.state["clips"].pop(k2, None)  # Probe-Stücke lagen im Probe-Ordner – nicht mit denen im Video verwechseln
    l.p.speichern()
    nummern = [i + 1 for i, _s in auswahl]
    return {"probe": {"szenen": nummern, "dauerSek": round(dauer, 1), "woerterProMin": wpm, "sprechtempo": sprechtempo(l.kanal), "bilder": n_bilder, "clips": n_clips}}, hinweise


# ---- Ablauf --------------------------------------------------------------------------------------------------------

def story(l: Lauf) -> tuple[dict, list[str]]:
    from . import story as st  # B37: Instagram-Story (eigenes Modul)

    return st.story(l)


SCHRITTE: dict[str, Callable[[Lauf], tuple[dict, list[str]]]] = {"research": research, "script": script, "voice": voice, "visuals": visuals, "render": render, "package": package, "upload": upload, "story": story, "probe": probe}


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
        # Schritt neu: diesen und alle späteren zurücksetzen – bezahlte Dateien bleiben (Hash), nur Geändertes kostet.
        # War der Schritt schon fertig („Neu recherchieren“, „Skript neu schreiben“), werden auch seine gespeicherten
        # Abschnitte verworfen. Nach einem Fehler („Schritt wiederholen“) bleiben sie: dann kommen nur die fehlenden neu.
        neu_schreiben = l.p.erledigt(wdh)
        for s in REIHENFOLGE[REIHENFOLGE.index(wdh) :]:
            if neu_schreiben and s in ABSCHNITT_ORDNER:
                shutil.rmtree(l.p.ordner / ABSCHNITT_ORDNER[s], ignore_errors=True)
            l.p.state["schritte"].pop(s, None)
        if neu_schreiben and wdh != "upload":
            # Neu ab einem früheren Schritt (z. B. „Im neuen Takt neu machen“): neues Video → neuer YouTube-Upload, nie die alte ID
            l.p.state.pop("youtube", None)
        l.p.speichern()
    elif wdh == "story":
        l.p.state["schritte"].pop("story", None)
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
