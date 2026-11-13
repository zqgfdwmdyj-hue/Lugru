"""B37 Instagram-Story (Hochformat 1080×1920): kurzer Text von Claude (nur bestätigte Fakten aus dem Kanalprofil),
Motiv aus der Kanal-Bibliothek (OpenAI, transparent) oder eigenes Lager-Foto, Layout aus Vorlagen, optional
Aufdeck-Animation mit Hand (5–15 s, MP4 ohne Ton), sonst Standbild (PNG). Regeln wie im Seller-System (keine
„kostenlose Zählung“, „all-in“ nur mit Aufzählung, keine Versicherungs-Aussagen, Werbekennzeichnung)."""

from __future__ import annotations

import io
import json
import re
import shutil
from typing import TYPE_CHECKING, Any

from PIL import Image, ImageDraw, ImageOps

from . import ki, medien
from . import whiteboard as wb
from .projekt import kurz_hash, schreiben_atomar

if TYPE_CHECKING:  # pragma: no cover
    from .schritte import Lauf

SB, SH = 1080, 1920
RAND = 70
ARTEN = {
    "preis": "Preis-Story: Preis je Artikel netto nennen; „all-in“ NUR zusammen mit der Aufzählung der enthaltenen Leistungen („Enthalten: …“); Karton getrennt nennen.",
    "leistung": "Leistungs-Story: eine Leistung mit den bestätigten Eckdaten (z. B. Lagerung, Mindestmenge, nur B2B).",
    "tipp": "Prep-Tipp: ein kurzer, praktischer Tipp für Amazon-Händler (FNSKU, Karton, Etiketten). Keine Rechts- oder Steuerberatung.",
    "einblick": "Einblick: kurzer Satz zum Bild aus dem Lager (eigenes Foto, keine Personen). Nichts erfinden, was auf dem Foto nicht sein kann.",
    "umfrage": "Frage/Umfrage: eine Frage an die Zuschauer mit 2–4 Antwortmöglichkeiten (der Sticker wird von Hand in der App gesetzt).",
    "cta": "Call-to-Action: Einladung zur Anfrage über den Hinweis/Link aus dem Kanalprofil.",
}
WERBUNG_ARTEN = {"preis", "leistung", "cta"}

STORY_SCHEMA = {
    "type": "object",
    "properties": {
        "ueberschrift": {"type": "string"},
        "text": {"type": "string"},
        "cta": {"type": "string"},
        "werbung": {"type": "boolean"},
        "motiv": {"type": "object", "properties": {"key": {"type": "string"}, "beschreibung": {"type": "string"}}, "required": ["key", "beschreibung"], "additionalProperties": False},
        "sticker": {"type": "object", "properties": {"art": {"type": "string", "enum": ["umfrage", "frage", "keine"]}, "frage": {"type": "string"}, "optionen": {"type": "array", "items": {"type": "string"}}}, "required": ["art", "frage", "optionen"], "additionalProperties": False},
    },
    "required": ["ueberschrift", "text", "cta", "werbung", "motiv", "sticker"],
    "additionalProperties": False,
}

# ---- Regeln (Spiegel der Prüfung im Seller-System – dort wird vor der Freigabe noch einmal geprüft) --------------------

_GRATIS = r"(?:kostenlos|kostenfrei|gratis|umsonst)"
_REGELN: list[tuple[re.Pattern[str], str]] = [
    (re.compile(rf"{_GRATIS}[^.!?\n]{{0,60}}z(?:ä|ae)hl|z(?:ä|ae)hl[a-zäöüß]*[^.!?\n]{{0,80}}{_GRATIS}", re.I), "keine „kostenlose Zählung“ – Mengenzählung ist optional zubuchbar"),
    (re.compile(r"(?:inklusive|inkl\.)\s+(?:der\s+|einer\s+)?[a-zäöüß]*z(?:ä|ae)hlung", re.I), "Zählung nie „inklusive“"),
    (re.compile(r"komplettpreis|pauschalpreis|alles\s+inklusive", re.I), "kein „Komplettpreis“/„alles inklusive“"),
    (re.compile(r"versicher|haftpflicht", re.I), "keine Aussagen zur Versicherung"),
    (re.compile(r"\b(garantiert|risikofrei|100\s?%\s?sicher)\b", re.I), "nichts Irreführendes"),
]


def story_regeln(text: str, art: str, werbung_an: bool, werbung: bool) -> list[str]:
    fehler = [t for r, t in _REGELN if r.search(text)]
    if re.search(r"all[\s-]?in(clusive)?\b", text, re.I) and not re.search(r"enthalten(?:\s+sind)?\s*:|enthält\s*:|leistungen\s*:", text, re.I):
        fehler.append("„all-in“ nur mit Aufzählung („Enthalten: …“)")
    if re.search(r"\d+([.,]\d{1,2})?\s?(€|eur\b|euro\b)", text, re.I) and not re.search(r"netto", text, re.I):
        fehler.append("Preise als netto kennzeichnen")
    if werbung_an and art in WERBUNG_ARTEN and not werbung:
        fehler.append("Werbekennzeichnung fehlt")
    return fehler


def _text(s: dict) -> str:
    st = s.get("sticker") or {}
    return "\n".join(x for x in [s.get("ueberschrift"), s.get("text"), s.get("cta"), st.get("frage") if st.get("art") != "keine" else None, *((st.get("optionen") or []) if st.get("art") != "keine" else [])] if x)


# ---- Text von Claude -------------------------------------------------------------------------------------------------


def _prompt(l: "Lauf", st: dict, korrektur: tuple[dict, list[str]] | None) -> str:
    ig = l.kanal.get("instagram") or {}
    art = st.get("inhaltsart") or "tipp"
    teile = [
        f"[video:story:{art}]",
        f"Du schreibst eine Instagram-Story (Hochformat) für den Kanal „{l.kanal['name']}“ (Sprache {l.kanal.get('sprache') or 'de'}).",
        f"Thema: {l.a['thema']}",
        f"Inhaltsart: {ARTEN.get(art, ARTEN['tipp'])}",
        "Bestätigte Fakten (NUR diese Angaben verwenden – keine Preise, Zahlen, Leistungen oder Eigenschaften erfinden; fehlt etwas, weglassen):\n"
        + ((ig.get("fakten") or "").strip() or "(keine Fakten eingetragen – dann keine Preise und keine Zahlen nennen)"),
        f"Hinweis/Link für den Schluss: {ig.get('hinweis')}" if ig.get("hinweis") else "",
        "Regeln: kurz (Überschrift höchstens 6 Wörter, Text 1–3 Sätze mit höchstens 35 Wörtern, CTA höchstens 8 Wörter oder leer). "
        "Nie „kostenlose Zählung“ (Mengenzählung ist optional zubuchbar). „all-in“ nur zusammen mit der Aufzählung „Enthalten: …“, kein „Komplettpreis“. "
        "Preise immer „netto“ und je Artikel. Keine Aussagen zur Versicherung der Ware. Keine fremden Marken oder Logos, keine Personen, "
        "keine Kundennamen, keine Heilversprechen, nichts Irreführendes, keine Rechts- oder Steuerberatung.",
        f"werbung = true bei Preis, Leistung und Call-to-Action{' (Werbekennzeichnung ist im Kanal eingeschaltet)' if ig.get('werbung', True) else ''}, sonst false.",
        "motiv: ein einzelnes Cartoon-Objekt als Symbol (key kurz, Kleinbuchstaben mit Bindestrich; beschreibung ohne Text, Schrift, Logos oder Personen)."
        + (" Es gibt ein eigenes Foto – das Motiv wird dann nicht gezeichnet, trotzdem ausfüllen." if st.get("fotoId") else ""),
        "sticker: bei Frage/Umfrage art „umfrage“ (2–4 kurze optionen) oder „frage“; sonst art „keine“, frage leer, optionen leer.",
        f"Anmerkung von Ludwig (umsetzen): {l.a['hinweis']}" if (l.a.get("hinweis") or "").strip() else "",
        f"Vorige Fassung (wurde verworfen – deutlich anders formulieren): {st.get('ueberschrift') or ''} – {st.get('text') or ''}" if st.get("text") else "",
    ]
    if korrektur:
        teile.append(f"Bisherige Fassung:\n{json.dumps(korrektur[0], ensure_ascii=False)}\nVerstöße – bitte korrigieren: {'; '.join(korrektur[1])}")
    return "\n\n".join(t for t in teile if t)


def _text_holen(l: "Lauf", st: dict) -> tuple[dict, list[str]]:
    ig = l.kanal.get("instagram") or {}
    werbung_an = ig.get("werbung", True)
    art = st.get("inhaltsart") or "tipp"
    # Vorige Fassung im Schlüssel: „Neu erzeugen“ liefert neuen Text, eine Wiederholung nach Fehler nutzt den bezahlten
    eingabe = [l.modell, l.a["thema"], art, ig.get("fakten"), ig.get("hinweis"), l.a.get("hinweis"), st.get("ueberschrift"), st.get("text"), bool(st.get("fotoId"))]
    pfad = l.p.pfad("story", f"text-{kurz_hash(json.dumps(eingabe, ensure_ascii=False))}.json")
    if pfad.exists():  # Wiederholung nach Fehler: kein zweites Mal bezahlen
        e = json.loads(pfad.read_text(encoding="utf-8"))
        return e["story"], e["regeln"]
    korrektur = None
    for _versuch in range(2):
        text, _ = ki.fragen(l.claude, l.modell, _prompt(l, st, korrektur), was="Story – Text", schema=STORY_SCHEMA, max_tokens=1200)
        s = ki.json_aus(text)
        regeln = story_regeln(_text(s), art, werbung_an, bool(s.get("werbung")))
        if not regeln:
            break
        korrektur = (s, regeln)
    schreiben_atomar(pfad, json.dumps({"story": s, "regeln": regeln}, ensure_ascii=False).encode("utf-8"))
    return s, regeln


# ---- Layout (Hochformat) ---------------------------------------------------------------------------------------------


def _farbe(hexwert: str | None, standard: tuple[int, int, int]) -> tuple[int, int, int]:
    m = re.fullmatch(r"#?([0-9a-fA-F]{6})", hexwert or "")
    return tuple(int(m.group(1)[i : i + 2], 16) for i in (0, 2, 4)) if m else standard  # type: ignore[return-value]


def _foto_ebene(daten: bytes, b: int, h: int) -> Image.Image:
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(daten))).convert("RGB")
    img = ImageOps.fit(img, (b, h), Image.LANCZOS)
    maske = Image.new("L", (b, h), 0)
    ImageDraw.Draw(maske).rounded_rectangle((0, 0, b - 1, h - 1), radius=36, fill=255)
    out = img.convert("RGBA")
    out.putalpha(maske)
    return out


def elemente(s: dict, motiv: Image.Image | None, foto: bool, farben: dict, werbung: bool, hinweis: str | None) -> tuple[Image.Image, list[wb.Element]]:
    """Grund und Elemente der Story in Aufdeck-Reihenfolge: Werbung → Überschrift → Bild → Text → CTA/Hinweis."""
    grund_f = _farbe(farben.get("grund"), (255, 255, 255))
    akzent = _farbe(farben.get("akzent"), wb.ROT)
    schrift = _farbe(farben.get("text"), wb.SCHWARZ)
    grund = Image.new("RGB", (SB, SH), grund_f)
    els: list[wb.Element] = []
    y = 90
    if werbung:
        t = wb._text_ebene("WERBUNG", 300, 60, (255, 255, 255), 44, zeilen=1)
        tag = Image.new("RGBA", (t.width + 36, t.height + 16), schrift + (255,))
        tag.alpha_composite(t, (18, 8))
        els.append(wb.Element("text", tag, (RAND, y)))
        y += tag.height + 30
    if (s.get("ueberschrift") or "").strip():
        t = wb._text_ebene(s["ueberschrift"].strip(), SB - 2 * RAND, 300, akzent, 120, zeilen=2)
        els.append(wb.Element("text", t, ((SB - t.width) // 2, y)))
        y += t.height + 40
    unten = SH - 110
    fuss: list[wb.Element] = []
    rest = " · ".join(x for x in [(s.get("cta") or "").strip(), (hinweis or "").strip()] if x)
    if rest:
        t = wb._text_ebene(rest, SB - 2 * RAND, 200, akzent, 64, zeilen=2)
        unten -= t.height
        fuss.append(wb.Element("text", t, ((SB - t.width) // 2, unten)))
        unten -= 40
    if (s.get("text") or "").strip():
        t = wb._text_ebene(s["text"].strip(), SB - 2 * RAND, 420, schrift, 72, zeilen=5)
        unten -= t.height
        fuss.insert(0, wb.Element("text", t, ((SB - t.width) // 2, unten)))
        unten -= 40
    st = s.get("sticker") or {}
    if st.get("art") in ("umfrage", "frage"):
        # Platz für den Instagram-Sticker (den setzt Ludwig in der App) – gestrichelter Rahmen
        hoehe = 260
        box = Image.new("RGBA", (SB - 2 * RAND, hoehe), (0, 0, 0, 0))
        d = ImageDraw.Draw(box)
        for x in range(0, box.width, 40):
            d.line((x, 2, x + 20, 2), fill=schrift + (160,), width=4)
            d.line((x, hoehe - 3, x + 20, hoehe - 3), fill=schrift + (160,), width=4)
        hinweis_t = wb._text_ebene("Platz für den Sticker", box.width - 40, 80, schrift + (160,), 44, zeilen=1)
        box.alpha_composite(hinweis_t, ((box.width - hinweis_t.width) // 2, (hoehe - hinweis_t.height) // 2))
        unten -= hoehe
        fuss.insert(0, wb.Element("text", box, (RAND, unten)))
        unten -= 30
    if motiv is not None:
        bereich = (RAND, y, SB - RAND, max(y + 200, unten))
        if foto:
            b, h = bereich[2] - bereich[0], bereich[3] - bereich[1]
            els.append(wb.Element("motiv", motiv.resize((b, h)) if motiv.size != (b, h) else motiv, (bereich[0], bereich[1])))
        else:
            els.append(wb._einpassen(motiv, bereich, 0.85))
    return grund, els + fuss


# ---- Schritt -----------------------------------------------------------------------------------------------------------


def story(l: "Lauf") -> tuple[dict, list[str]]:
    from .schritte import _motiv_holen, _motiv_prompt  # Bildanbieter wie bei den Whiteboard-Motiven

    st: dict[str, Any] = dict(l.a.get("story") or {})
    ig = l.kanal.get("instagram") or {}
    hinweise: list[str] = []
    s, regeln = _text_holen(l, st)
    if regeln:
        hinweise.append("Regel-Hinweise: " + "; ".join(regeln))
    # Bild: eigenes Foto (Einblick) oder Motiv aus der Bibliothek (einmal bezahlt, wiederverwendbar)
    motiv_bild: Image.Image | None = None
    key = wb.schluessel((s.get("motiv") or {}).get("key") or l.a["thema"])
    if st.get("fotoId"):
        daten = l.seller.foto_holen(st["fotoId"])
        motiv_bild = _foto_ebene(daten, SB - 2 * RAND, 900)
        key = f"foto-{st['fotoId'][:8]}"
    else:
        alt = st.get("motivKey")
        if alt and not alt.startswith("foto-") and not st.get("motivNeu") and l.bib.hat(alt):
            key = alt  # „Neu erzeugen“ ohne „Motiv neu“: Motiv bleibt (schon bezahlt)
        elif st.get("motivNeu"):
            marke = kurz_hash(json.dumps([alt, st.get("text")], ensure_ascii=False))
            if l.p.state.get("story_motiv_neu") != marke:  # nur einmal neu, auch bei Wiederholung nach Fehler
                for k in {key, alt}:
                    if k and l.bib.hat(k):
                        l.bib.entfernen(k)
                l.p.state["story_motiv_neu"] = marke
                l.p.speichern()
        if not l.bib.hat(key):
            beschreibung = ((s.get("motiv") or {}).get("beschreibung") or l.a["thema"])[:300]
            daten = _motiv_holen(l, _motiv_prompt(l, beschreibung), f"Story-Motiv „{key}“")
            if daten is None:
                hinweise.append(f"Bildanbieter hat Motiv „{key}“ abgelehnt – Ersatzmotiv.")
                key = "ersatz"
                daten = None if l.bib.hat(key) else (_motiv_holen(l, _motiv_prompt(l, "Eine Glühbirne als Symbol für eine gute Idee"), "Ersatzmotiv") or wb.ersatz_motiv())
            if daten and not l.bib.hat(key):
                l.bib.merken(key, wb.freistellen(daten), beschreibung)
        motiv_bild = l.bib.bild(key) if l.bib.hat(key) else None
    werbung = bool(s.get("werbung")) and ig.get("werbung", True)
    grund, els = elemente(s, motiv_bild, bool(st.get("fotoId")), ig.get("farben") or {}, werbung, ig.get("hinweis"))
    woerter = len(_text(s).split())
    dauer = max(5.0, min(15.0, 3.0 + woerter * 0.28 + len(els) * 0.6))
    ordner = l.p.pfad("story", "x").parent
    sticker = s.get("sticker") or {}
    ergebnis: dict[str, Any] = {
        "ueberschrift": s.get("ueberschrift"), "text": s.get("text"), "cta": s.get("cta"), "werbung": werbung, "motivKey": key,
        "sticker": {"art": sticker.get("art"), "frage": sticker.get("frage"), "optionen": sticker.get("optionen") or []} if sticker.get("art") in ("umfrage", "frage") else None,
    }
    plan, _k = wb.takt_plan([e.art for e in els], [None] * len(els), dauer, wb.draw_s(l.kanal.get("tempo")), [])
    fertig = wb.fertig_takt(grund, els, [e for e in plan if e.art != "hervorhebung"])
    vorschau = ordner / "story-vorschau.jpg"
    buf = io.BytesIO()
    fertig.convert("RGB").resize((540, 960), Image.LANCZOS).save(buf, "JPEG", quality=85)
    schreiben_atomar(vorschau, buf.getvalue())
    if ig.get("hand", True):
        bilder = ordner / "bilder"
        shutil.rmtree(bilder, ignore_errors=True)
        hand = wb.hand_vorbereiten(l.bib.bild("_hand") if l.bib.hat("_hand") else wb.hand_gezeichnet(), 420)
        liste, _ = wb.animation_takt(grund, els, plan, dauer, l.k.fps, hand, bilder, None)
        medien.clip_bilder(l.k.ffmpeg, bilder, liste, None, "../story.mp4", dauer, l.k.fps, zoom=0.03, anker=0.5, breite=SB, hoehe=SH)
        shutil.rmtree(bilder, ignore_errors=True)
        info = medien.video_info(l.k.ffprobe, ordner / "story.mp4")
        if (info["breite"], info["hoehe"]) != (SB, SH):
            raise RuntimeError(f"Story hat {info['breite']}×{info['hoehe']} statt {SB}×{SH}.")
        l.seller.datei_hochladen(l.id, "story_mp4", ordner / "story.mp4")
        ergebnis.update(format="mp4", dauerSek=round(dauer, 1))
    else:
        png = ordner / "story.png"
        buf = io.BytesIO()
        fertig.convert("RGB").save(buf, "PNG")
        schreiben_atomar(png, buf.getvalue())
        l.seller.datei_hochladen(l.id, "story_png", png)
        ergebnis.update(format="png", dauerSek=None)
    l.seller.datei_hochladen(l.id, "story_vorschau", vorschau)
    l.p.markieren("story")
    return {"story": ergebnis}, hinweise
