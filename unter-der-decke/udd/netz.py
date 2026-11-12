"""Robuste Aufrufe an Claude, ElevenLabs und OpenAI (über die Anbieter-Brücke des Seller-Systems).

- Antworten werden gestreamt und mit Zeitlimit gelesen (Standard 120 s je Aufruf, KI_TIMEOUT_S).
- Bei Verbindungsabbruch, Zeitüberschreitung, 429 und 5xx wird bis zu 4 Mal wiederholt – Wartezeit 2, 4, 8, 16 s.
- Erst danach gilt der Aufruf als gescheitert; die Fehlermeldung nennt den Abschnitt (z. B. „Skript – Punkt 3“).
Andere Fehler (400, 401, Ablehnung) werden nicht wiederholt – sie würden beim nächsten Versuch genauso kommen.
"""

from __future__ import annotations

import http.client
import os
import socket
import time
from typing import Callable, TypeVar

import requests

WARTEN_S = (2, 4, 8, 16)
TIMEOUT_S = float(os.environ.get("KI_TIMEOUT_S", "120"))
# Nur für Tests: Wartezeiten verkürzen (0.01 = hundertmal schneller). Im Betrieb immer 1.
_FAKTOR = float(os.environ.get("WIEDERHOLEN_FAKTOR", "1"))

T = TypeVar("T")


class Voruebergehend(Exception):
    """Abgebrochene Antwort, 429 oder 5xx – darf wiederholt werden."""

    def __init__(self, text: str, status: int | None = None):
        super().__init__(text)
        self.status = status


class Zeitueberschreitung(Voruebergehend):
    pass


class AufrufFehler(RuntimeError):
    """Auch nach allen Wiederholungen nicht geklappt – Text nennt den Abschnitt."""


def voruebergehend(e: BaseException) -> bool:
    if isinstance(e, Voruebergehend):
        return True
    if isinstance(e, (requests.ConnectionError, requests.Timeout, requests.exceptions.ChunkedEncodingError, http.client.IncompleteRead, ConnectionError, TimeoutError, socket.timeout)):
        return True
    for modul in ("httpx2", "httpx"):  # das Anthropic-SDK ab 2.x nutzt „httpx2“
        try:
            m = __import__(modul)
        except ImportError:
            continue
        if isinstance(e, m.TransportError):  # u. a. „peer closed connection … (incomplete chunked read)“, ReadTimeout
            return True
    try:
        import anthropic

        if isinstance(e, anthropic.APIConnectionError):  # auch APITimeoutError
            return True
        if isinstance(e, anthropic.APIStatusError):
            return e.status_code == 429 or e.status_code >= 500
    except ImportError:  # pragma: no cover
        pass
    status = getattr(e, "status", None)
    return isinstance(status, int) and (status == 429 or status >= 500)


def kurz(e: BaseException) -> str:
    status = getattr(e, "status_code", None) or getattr(e, "status", None)
    text = str(e).strip().splitlines()[0][:200] if str(e).strip() else e.__class__.__name__
    return f"HTTP {status}: {text}" if isinstance(status, int) and str(status) not in text else text


def mit_wiederholung(fn: Callable[[], T], was: str, *, log: Callable[[str], None] | None = None, schlafen: Callable[[float], None] = time.sleep) -> T:
    """fn ausführen; vorübergehende Fehler bis zu 4 Mal wiederholen (2, 4, 8, 16 s), dann AufrufFehler mit „was“."""
    for versuch in range(len(WARTEN_S) + 1):
        try:
            return fn()
        except Exception as e:
            if not voruebergehend(e):
                raise
            if versuch == len(WARTEN_S):
                raise AufrufFehler(f"{was}: nach {versuch + 1} Versuchen nicht geklappt ({kurz(e)})") from e
            if log:
                log(f"{was}: {kurz(e)} – neuer Versuch in {WARTEN_S[versuch]} s")
            schlafen(WARTEN_S[versuch] * _FAKTOR)
    raise AssertionError("unerreichbar")  # pragma: no cover


def status_pruefen(r: requests.Response) -> requests.Response:
    """429 und 5xx als vorübergehend melden (wird wiederholt); alles andere entscheidet der Aufrufer."""
    if r.status_code == 429 or r.status_code >= 500:
        text = r.text[:200] if r.content else ""
        r.close()
        raise Voruebergehend(f"HTTP {r.status_code}{': ' + text if text else ''}", r.status_code)
    return r


def lesen(r: requests.Response, frist_s: float) -> requests.Response:
    """Antwort (stream=True) in Stücken lesen, höchstens frist_s Sekunden – danach Zeitüberschreitung (wird wiederholt).
    Bricht die Verbindung mitten in der Antwort ab, kommt ChunkedEncodingError (ebenfalls wiederholt)."""
    frist = time.monotonic() + frist_s
    teile: list[bytes] = []
    try:
        for block in r.iter_content(64 * 1024):
            teile.append(block)
            if time.monotonic() > frist:
                raise Zeitueberschreitung(f"keine vollständige Antwort nach {int(frist_s)} s")
    finally:
        r.close()
    # Inhalt wie bei einer normalen Antwort ablegen (r.content, r.json(), r.text funktionieren danach)
    r._content = b"".join(teile)  # noqa: SLF001
    r._content_consumed = True  # noqa: SLF001
    return r
