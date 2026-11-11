"""Claude über die Anbieter-Brücke des Seller-Systems (Schlüssel bleibt dort, Kosten werden dort gezählt)."""

from __future__ import annotations

import json
import re
from typing import Any

import anthropic


def client(seller_url: str, token: str, auftrag_id: str) -> anthropic.Anthropic:
    # Das SDK schickt den Worker-Token als x-api-key an die Brücke; die Brücke setzt den echten Schlüssel ein.
    return anthropic.Anthropic(
        api_key=token,
        base_url=f"{seller_url}/api/video-worker/anbieter/anthropic",
        default_headers={"x-auftrag": auftrag_id},
        max_retries=2,
        timeout=900,
    )


def text_aus(nachricht: Any) -> str:
    return "\n".join(b.text for b in nachricht.content if getattr(b, "type", "") == "text").strip()


def fragen(c: anthropic.Anthropic, modell: str, prompt: str, *, system: str | None = None, schema: dict | None = None, websuche: int = 0, max_tokens: int = 16000, effort: str = "medium") -> tuple[str, list[str]]:
    """Eine Anfrage (Streaming), bei Websuche mit Fortsetzen nach „pause_turn“. Liefert Text und gefundene URLs."""
    nachrichten: list[dict[str, Any]] = [{"role": "user", "content": prompt}]
    kw: dict[str, Any] = {"model": modell, "max_tokens": max_tokens, "output_config": {"effort": effort}}
    if system:
        kw["system"] = system
    if schema:
        kw["output_config"]["format"] = {"type": "json_schema", "schema": schema}
    if websuche:
        kw["tools"] = [{"type": "web_search_20260209", "name": "web_search", "max_uses": websuche}]
    urls: list[str] = []
    texte: list[str] = []
    nachricht = None
    for _ in range(5):
        with c.messages.stream(messages=nachrichten, **kw) as s:
            nachricht = s.get_final_message()
        texte.append(text_aus(nachricht))
        for b in nachricht.content:
            if getattr(b, "type", "") == "web_search_tool_result" and isinstance(getattr(b, "content", None), list):
                urls.extend(getattr(r, "url", "") for r in b.content if getattr(r, "url", ""))
        if nachricht.stop_reason == "pause_turn":
            nachrichten.append({"role": "assistant", "content": nachricht.content})
            continue
        break
    if nachricht is None:
        raise RuntimeError("Keine Antwort von Claude")
    if nachricht.stop_reason == "refusal":
        raise RuntimeError("Claude hat die Anfrage abgelehnt (Thema prüfen)")
    if nachricht.stop_reason == "max_tokens":
        raise RuntimeError("Antwort von Claude abgeschnitten (max_tokens)")
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
