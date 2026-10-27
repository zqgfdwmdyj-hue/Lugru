# Ablauftests (Browser)

Prüft die wichtigsten Abläufe im echten Browser gegen den laufenden Dev-Server – mit einer Test-KI, die feste
Antworten gibt (kein API-Schlüssel, keine Kosten).

Geprüft wird:

1. Vorder-/Rückseite abwechselnd hochladen → Rückseite wird Infofoto des richtigen Produkts
2. Ungerade Fotoanzahl im Paar-Modus → letztes Foto wird eigenes Produkt, mit Hinweis
3. Automatisch gelesenes MHD bestätigen („✓ MHD stimmt“) bzw. Datum korrigieren
4. Ergebnis erfassen („Ergebnisse“-Reiter) → neu laden → Statistik (Renner, Kennzahlen)
5. Verteilung kopieren → Preise/Packungen übernommen, Bestand/Ergebnis/MHD nicht
6. Packungs-/Kartonempfehlung gleich in Collage, Aushang und Messenger-Text

## Ausführen

```bash
# 1. Test-KI starten (Port 3999)
node e2e/mock-ai.cjs &

# 2. Dev-Server mit Test-KI starten (Datenbank aus .env)
ANTHROPIC_BASE_URL=http://localhost:3999 ANTHROPIC_API_KEY=test npm run dev &

# 3. Tests (Playwright muss installiert sein)
npm run e2e
```

Der Test legt die Verteilungen „E2E-Test“ und „E2E-Test Kopie“ (Januar 2026) an und löscht sie am Ende wieder samt der
dafür angelegten Produkte. Mit `E2E_KEEP=1` bleiben sie zum Nachsehen stehen. Andere Adresse: `E2E_BASE=http://…`.
Nur gegen eine Test- oder Entwicklungsdatenbank laufen lassen.
