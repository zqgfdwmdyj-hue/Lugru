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

from . import ki, medien, netz
from . import whiteboard as wb
from .filter import ERSATZ_BILDIDEE, bild_treffer, titel_treffer
from .konfig import Konfig
from .projekt import Projekt, kurz_hash, schreiben_atomar
from .seller import Seller

REIHENFOLGE = ["research", "script", "voice", "visuals", "render", "package", "upload"]
MODELL_STANDARD = "claude-opus-5-5"
PAUSE_S = 0.4  # kurze Pause nach jeder Szene
PRIVAT = "private"  # Sichtbarkeit beim Upload – fest, im System nicht änderbar
ABSCHNITTE = ["hook", "angst"] + [f"punkt-{i}" for i in range(1, 8)] + ["zusammenfassung", "cta"]
# Skriptlänge fest für alle Kanäle: 1.500–1.700 Wörter (Entscheidung 12.11.; ≈ 10–12 Min. bei 145 Wörtern/Min.).
# Das Seller-System schickt dieselben Werte mit; diese hier gelten nur, falls sie fehlen (ältere Version).
SKRIPT_WOERTER = [1500, 1700]
LAENGE_STANDARD = {"minuten": [10, 12], "sekunden": [621, 703], "woerter": SKRIPT_WOERTER, "szenen": [15, 34], "szenenJePunkt": [2, 4]}
# Wörter, die eine Studie/Erhebung ankündigen – solche Szenen brauchen eine Quelle aus der Quellenliste
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
        text, _ = ki.fragen(l.claude, l.modell, prompt, was="Recherche – Gliederung", websuche=3, max_tokens=3000)
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
            text, urls = ki.fragen(l.claude, l.modell, prompt, was=f"Recherche – Quellen {abschnitt_name(name)}", websuche=3, max_tokens=3000)
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
                            "properties": {"key": {"type": "string"}, "beschreibung": {"type": "string"}},
                            "required": ["key", "beschreibung"],
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


def wb_pruefen(szenen: list[dict]) -> list[str]:
    """Whiteboard: je Szene 3–5 Motive (Figur + Liste: 1–2 Motive und 2–4 Stichpunkte)."""
    probleme: list[str] = []
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
        for m in (s.get("motive") or [])[:5]:
            key = wb.schluessel(m.get("key") or m.get("beschreibung") or "motiv")
            motive.append({"key": key, "beschreibung": figuren.get(key) or (m.get("beschreibung") or key).strip()[:300]})
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


def _korrekturen(fertig: dict[str, dict], namen: list[str], ziele: dict[str, tuple[int, int]], quellen: list[dict], ziel: list[int]) -> dict[str, str]:
    """Welche Abschnitte nachgebessert werden (nur diese werden neu geholt) – je Abschnitt eine kurze Anweisung."""
    ids = {q["id"] for q in quellen}
    aufgaben: dict[str, str] = {}
    for name in namen:
        sz = fertig[name]["szenen"]
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
        f"Länge dieses Abschnitts: ca. {(lo + hi) // 2} Wörter ({lo}–{hi}), aufgeteilt in Szenen mit je 50–100 Wörtern. Gesprochene Sprache, kurze Sätze, direkte Ansprache.",
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
    text, _ = ki.fragen(l.claude, l.modell, prompt, was=was, schema=schema, max_tokens=6000 if l.whiteboard else 4000)
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
        "- motive: {key, beschreibung}; key = kurzer Name in Kleinbuchstaben mit Bindestrich (z. B. „banane“, „sanduhr“); beschreibung = ein einzelnes Objekt bzw. eine Figur, Cartoon, OHNE Text, Schrift oder Zahlen.",
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
        aufgaben = _korrekturen(fertig, namen, ziele, quellen, w)
        if not aufgaben:
            break
        for name, anweisung in aufgaben.items():
            vorher = [fertig[x] for x in namen[: namen.index(name)]]
            e = _abschnitt_schreiben(l, name, ziele[name], g, quellen, figuren, vorher, ueberarbeiten=(fertig[name], anweisung))
            ab.schreiben(name, e)
            fertig[name] = e
    szenen = [dict(s) for name in namen for s in fertig[name]["szenen"]]
    probleme = skript_pruefen(szenen, quellen, w) + (wb_pruefen(szenen) if l.whiteboard else [])
    if l.whiteboard:
        wb_aufbereiten(szenen, figuren)
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
            r = l.seller.anbieter(l.id, "elevenlabs", f"v1/text-to-speech/{stimme}?output_format=mp3_44100_128", {"text": s["text"], "model_id": modell}, timeout=netz.TIMEOUT_S, was=f"Sprache – Szene {i + 1}")
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


# Bilder brauchen beim Anbieter oft länger als Text – Zeitlimit je Aufruf 180 s (statt 120 s)
BILD_TIMEOUT_S = max(netz.TIMEOUT_S, 180.0)


def _bild_holen(l: Lauf, prompt: str, was: str = "Bild") -> bytes | None:
    """Ein Bild bei OpenAI (gpt-image-1, 1536×1024, medium). None = vom Anbieter abgelehnt."""
    r = l.seller.anbieter(l.id, "openai", "v1/images/generations", {"model": "gpt-image-1", "prompt": prompt, "size": "1536x1024", "quality": "medium", "n": 1}, timeout=BILD_TIMEOUT_S, was=was)
    if r.status_code == 200:
        return base64.b64decode(r.json()["data"][0]["b64_json"])
    text = _fehlertext(r)
    if r.status_code == 400 and re.search(r"moderation|safety|content.?policy|rejected", text, re.I):
        return None
    raise RuntimeError(f"Bildanbieter: {text}")


# ---- 4b visuals im Stil Whiteboard-Collage (B36.9) -------------------------------------------------------------------

STANDARD_CLIPART = "Bunte Cartoon-Clipart mit kräftigen schwarzen Umrissen und flachen Farben, Comic-Gesichter, freundlich"
HAND_PROMPT = "Eine rechte Hand im Comic-Stil hält einen schwarzen Filzstift; die Stiftspitze zeigt nach oben links, die Hand kommt von unten rechts. Kräftige schwarze Umrisse, flache Farben"


def _motiv_prompt(l: Lauf, beschreibung: str) -> str:
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
        felder = {"model": "gpt-image-1", "prompt": prompt + " Zeichenstil genau wie in den Referenzbildern (nur den Stil übernehmen, nicht deren Inhalt).", "size": "1024x1024", "quality": q, "background": "transparent", "n": "1"}
        r = l.seller.anbieter_datei(l.id, "openai", "v1/images/edits", felder, [("image[]", name, daten, typ) for name, daten, typ in refs], timeout=BILD_TIMEOUT_S, was=was)
    else:
        r = l.seller.anbieter(l.id, "openai", "v1/images/generations", {"model": "gpt-image-1", "prompt": prompt, "size": "1024x1024", "quality": q, "background": "transparent", "n": 1}, timeout=BILD_TIMEOUT_S, was=was)
    if r.status_code == 200:
        return base64.b64decode(r.json()["data"][0]["b64_json"])
    text = _fehlertext(r)
    if r.status_code == 400 and re.search(r"moderation|safety|content.?policy|rejected", text, re.I):
        return None
    raise RuntimeError(f"Bildanbieter: {text}")


def _wb_hand(l: Lauf, hinweise: list[str]):
    """Hand mit Stift: einmal je Kanal erzeugt (Bibliothek „_hand“), sonst gezeichneter Ersatz."""
    if not l.bib.hat("_hand"):
        try:
            daten = _motiv_holen(l, _motiv_prompt(l, HAND_PROMPT), "Motiv „Hand mit Stift“")
        except RuntimeError as e:
            daten = None
            hinweise.append(f"Hand mit Stift nicht erzeugt ({e}) – gezeichnete Ersatz-Hand.")
        if daten:
            l.bib.merken("_hand", wb.freistellen(daten), "Hand mit Stift")
    return wb.hand_vorbereiten(l.bib.bild("_hand") if l.bib.hat("_hand") else wb.hand_gezeichnet())


def _wb_szenenbilder(l: Lauf, szenen: list[dict]) -> list:
    """Fertige Szenen (ohne Animation) der Reihe nach – jede mit der vorigen als blassem Hintergrund."""
    vorher = None
    fertige = []
    for s in szenen:
        motive = [l.bib.bild(m["key"]) for m in s.get("motive") or [] if l.bib.hat(m["key"])]
        bild = wb.fertig(wb.hintergrund(vorher), wb.elemente(s, motive))
        fertige.append(bild)
        vorher = bild
    return fertige


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
    hand = _wb_hand(l, hinweise)
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
    # Szenen-Übersicht für die Freigabe vor dem Render (B36.9.6)
    fertige = _wb_szenenbilder(l, szenen)
    ordner = l.p.pfad("szenen", "x").parent
    for i, b in enumerate(fertige, 1):
        b.save(ordner / f"{i:03d}.png")
    wb.uebersicht([(s.get("nr") or i, b, ", ".join(m["key"] for m in s.get("motive") or [])) for i, (s, b) in enumerate(zip(szenen, fertige), 1)], l.p.pfad("uebersicht.jpg"))
    l.seller.datei_hochladen(l.id, "uebersicht", l.p.pfad("uebersicht.jpg"))
    del hand
    l.p.markieren("visuals", hinweise=hinweise)
    return {"skript": _ohne_intern(szenen)}, hinweise


def visuals(l: Lauf) -> tuple[dict, list[str]]:
    if l.whiteboard:
        return visuals_wb(l)
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
            daten = _bild_holen(l, prompt, f"Bild – Szene {i + 1}")
            if daten is None:
                hinweise.append(f"Szene {i + 1}: Bildanbieter hat abgelehnt – Ersatzbild.")
                ersatz = True
                daten = _bild_holen(l, f"{stil}. {ERSATZ_BILDIDEE}. Symbolbild ohne Text.", f"Ersatzbild – Szene {i + 1}")
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


def _ton(l: Lauf, s: dict):
    stimme = (l.kanal.get("stimmeId") or "").strip()
    v = kurz_hash(stimme, "eleven_multilingual_v2", s["text"])
    return v, l.p.datei_vorhanden("voice", v)


def render_wb(l: Lauf) -> tuple[dict, list[str]]:
    """Whiteboard: je Szene Aufdeck-Animation mit Hand über dem blassen Vorgänger; Untertitel NICHT eingebrannt
    (gehen als YouTube-Untertitel mit dem Upload)."""
    video = l.p.pfad("video.mp4")
    szenen = l.daten.get("skript") or []
    clips = l.p.pfad("clips", "x").parent
    hinweise: list[str] = []
    hand = wb.hand_vorbereiten(l.bib.bild("_hand") if l.bib.hat("_hand") else wb.hand_gezeichnet())
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
        key = kurz_hash(vorher_key, v, inhalt, *[l.bib.merkmal(m["key"]) for m in s.get("motive") or []], str(l.k.fps), "wb1")
        grund = wb.hintergrund(vorher)
        els = wb.elemente(s, [l.bib.bild(m["key"]) for m in s.get("motive") or []])
        if l.p.state["clips"].get(name, {}).get("key") == key and (clips / f"{name}.mp4").exists():
            vorher = wb.fertig(grund, els)
        else:
            bilder_ordner = clips / f"b{name}"
            liste, vorher = wb.animation(grund, els, laenge, l.k.fps, hand, bilder_ordner)
            medien.clip_bilder(l.k.ffmpeg, bilder_ordner, liste, "../../" + ton.relative_to(l.p.ordner).as_posix(), f"../{name}.mp4", laenge, l.k.fps)
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
    return _render_abschluss(l, video, clips, namen, srt_gesamt, [], len(szenen))


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
        text, _u = ki.fragen(l.claude, l.modell, prompt, was="Paket (Titel, Beschreibung, Tags)", schema=PAKET_SCHEMA, max_tokens=4000, effort="low")
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
    if szenen and l.whiteboard:
        erstes_bild = l.p.pfad("szenen", "001.png") if l.p.pfad("szenen", "001.png").exists() else None
    elif szenen:
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
        # Schritt neu: diesen und alle späteren zurücksetzen – bezahlte Dateien bleiben (Hash), nur Geändertes kostet.
        # War der Schritt schon fertig („Neu recherchieren“, „Skript neu schreiben“), werden auch seine gespeicherten
        # Abschnitte verworfen. Nach einem Fehler („Schritt wiederholen“) bleiben sie: dann kommen nur die fehlenden neu.
        neu_schreiben = l.p.erledigt(wdh)
        for s in REIHENFOLGE[REIHENFOLGE.index(wdh) :]:
            if neu_schreiben and s in ABSCHNITT_ORDNER:
                shutil.rmtree(l.p.ordner / ABSCHNITT_ORDNER[s], ignore_errors=True)
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
