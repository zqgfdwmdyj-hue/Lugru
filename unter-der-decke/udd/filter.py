"""Filter für Bildideen und Titel – dieselbe Wortliste wie im Seller-System (filter.json, Wortanfang, Umlaute)."""

from __future__ import annotations

import json
import re
from pathlib import Path

_FILTER = json.loads((Path(__file__).resolve().parent.parent / "filter.json").read_text(encoding="utf-8"))
ERSATZ_BILDIDEE: str = _FILTER["ersatz_bildidee"]


def _norm(s: str) -> str:
    return s.lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")


def _trifft(text: str, woerter: list[str]) -> str | None:
    t = " " + re.sub(r"[^a-z0-9 ]+", " ", _norm(text)) + " "
    for w in woerter:
        if " " + _norm(w).strip() in t:
            return w
    return None


def titel_treffer(titel: str) -> str | None:
    """Expliziter Begriff im Titel/Thumbnail-Text? („Sex“ als Thema bleibt erlaubt.)"""
    return _trifft(titel, _FILTER["titel"])


def bild_treffer(idee: str, streng: bool) -> str | None:
    """Bildidee nicht erlaubt? (streng: zusätzlich Bett, Kuss, Berührung …)"""
    woerter = _FILTER["bild"] + (_FILTER["bild_streng"] if streng else [])
    return _trifft(idee, woerter)
