"""Claude über die Anbieter-Brücke des Seller-Systems (Schlüssel bleibt dort, Kosten werden dort gezählt).

Jeder Aufruf wird gestreamt und hat ein Zeitlimit (KI_TIMEOUT_S, Standard 120 s; mit Websuche doppelt so lang, weil die
Suche selbst Zeit braucht). Verbindungsabbruch, Zeitüberschreitung, 429 und 5xx wiederholt netz.mit_wiederholung
(2, 4, 8, 16 s) – das SDK selbst wiederholt nichts, damit es keine doppelten Wartezeiten gibt.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any, Callable

import anthropic

try:  # das Anthropic-SDK ab 2.x nutzt „httpx2“, ältere Versionen „httpx“
    import httpx2 as httpx
except ImportError:  # pragma: no cover
    import httpx  # type: ignore[no-redef]

from . import netz


def client(seller_url: str, token: str, auftrag_id: str) -> anthropic.Anthropic:
    # Das SDK schickt den Worker-Token als x-api-key an die Brücke; die Brücke setzt den echten Schlüssel ein.
    return anthropic.Anthropic(
        api_key=token,
        base_url=f"{seller_url}/api/video-worker/anbieter/anthropic",
        default_headers={"x-auftrag": auftrag_id},
        max_retries=0,
        # read = höchstens so lange ohne neue Daten; die Gesamtfrist je Aufruf prüft _einmal
        timeout=httpx.Timeout(netz.TIMEOUT_S, connect=20.0),
    )


def text_aus(nachricht: Any) -> str:
    return "\n".join(b.text for b in nachricht.content if getattr(b, "type", "") == "text").strip()


def _einmal(c: anthropic.Anthropic, nachrichten: list[dict[str, Any]], kw: dict[str, Any], frist_s: float) -> Any:
    """Ein Aufruf als Stream; dauert er länger als frist_s, gilt er als Zeitüberschreitung (wird wiederholt)."""
    frist = time.monotonic() + frist_s
    with c.messages.stream(messages=nachrichten, **kw) as s:
        for _ in s:
            if time.monotonic() > frist:
                raise netz.Zeitueberschreitung(f"keine vollständige Antwort nach {int(frist_s)} s")
        nachricht = s.get_final_message()
    if nachricht.stop_reason is None:  # Stream endete ohne „message_stop“ – Antwort unvollständig, neu holen
        raise netz.Voruebergehend("Antwort unvollständig (Stream ohne Abschluss)")
    return nachricht


def fragen(
    c: anthropic.Anthropic,
    modell: str,
    prompt: str,
    *,
    was: str = "Claude",
    system: str | None = None,
    schema: dict | None = None,
    websuche: int = 0,
    max_tokens: int = 4000,
    effort: str = "medium",
    timeout_s: float | None = None,
    log: Callable[[str], None] | None = print,
) -> tuple[str, list[str]]:
    """Eine Anfrage (Streaming, Zeitlimit, Wiederholung), bei Websuche mit Fortsetzen nach „pause_turn“.
    Liefert Text und gefundene URLs. Fehler nennen „was“ (z. B. „Skript – Punkt 3“)."""
    nachrichten: list[dict[str, Any]] = [{"role": "user", "content": prompt}]
    kw: dict[str, Any] = {"model": modell, "max_tokens": max_tokens, "output_config": {"effort": effort}}
    if system:
        kw["system"] = system
    if schema:
        kw["output_config"]["format"] = {"type": "json_schema", "schema": schema}
    if websuche:
        kw["tools"] = [{"type": "web_search_20260209", "name": "web_search", "max_uses": websuche}]
    frist = timeout_s or (netz.TIMEOUT_S * 2 if websuche else netz.TIMEOUT_S)
    urls: list[str] = []
    texte: list[str] = []
    nachricht = None
    for _ in range(5):
        nachricht = netz.mit_wiederholung(lambda: _einmal(c, nachrichten, kw, frist), was, log=log)
        texte.append(text_aus(nachricht))
        for b in nachricht.content:
            if getattr(b, "type", "") == "web_search_tool_result" and isinstance(getattr(b, "content", None), list):
                urls.extend(getattr(r, "url", "") for r in b.content if getattr(r, "url", ""))
        if nachricht.stop_reason == "pause_turn":
            nachrichten.append({"role": "assistant", "content": nachricht.content})
            continue
        break
    if nachricht is None:
        raise RuntimeError(f"{was}: keine Antwort von Claude")
    if nachricht.stop_reason == "refusal":
        raise RuntimeError(f"{was}: Claude hat die Anfrage abgelehnt (Thema prüfen)")
    if nachricht.stop_reason == "max_tokens":
        raise RuntimeError(f"{was}: Antwort von Claude abgeschnitten (max_tokens)")
    return "\n".join(t for t in texte if t), urls


def json_aus(text: str) -> Any:
    """JSON aus einer Antwort lesen (auch mit ```json …``` oder Text drumherum)."""
    t = text.strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", t)
    if m:
        t = m.group(1).strip()
    try:
        return json.loads(t)
    except ValueError:
        a, e = t.find("{"), t.rfind("}")
        if a >= 0 and e > a:
            return json.loads(t[a : e + 1])
        raise
