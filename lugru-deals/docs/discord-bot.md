# Discord-Bot für die Reaktionen einrichten

Das Tool postet über einen Webhook. Ein Webhook kann nur schreiben und keine
Reaktionen lesen. Damit ✅ (gekauft) und ❌ (nicht mehr verfügbar) in Historie
und Statistik auftauchen, braucht es zusätzlich einen kleinen Bot. Er muss
nicht dauerhaft online sein: das Tool fragt bei Discord nach, bei Posts der
letzten 48 Stunden alle 2 Minuten, bei älteren (bis 30 Tage) alle 30 Minuten.

Du richtest ihn einmalig ein, das dauert etwa fünf Minuten.

## 1. Bot anlegen

1. <https://discord.com/developers/applications> öffnen und mit dem
   Discord-Konto anmelden, dem der Server gehört oder das dort Admin ist.
2. **New Application**, Name z. B. „Lugru Deals“, bestätigen.
3. Links auf **Bot**. Unter **Token** auf **Reset Token** und den Token
   kopieren. Er wird nur einmal angezeigt.
   - Den Token wie ein Passwort behandeln: wer ihn hat, kann als dieser Bot
     handeln.
   - Von den „Privileged Gateway Intents“ braucht das Tool nur einen, und
     nur fürs Einlesen alter Deals: **Message Content Intent** einschalten.
     Die anderen beiden bleiben aus.
4. Links auf **General Information** und die **Application ID** kopieren.

## 2. Bot auf den Server einladen

Diesen Link im Browser öffnen, vorher `APPLICATION_ID` durch die kopierte
Application ID ersetzen:

```
https://discord.com/oauth2/authorize?client_id=APPLICATION_ID&scope=bot&permissions=66624
```

Den Server auswählen und bestätigen. Die Zahl 66624 steht für genau drei
Rechte:

- **Kanäle ansehen**
- **Nachrichtenverlauf lesen**: damit liest der Bot die Reaktionen.
- **Reaktionen hinzufügen**: damit setzt er ✅ und ❌ unter neue Posts.

Sind die Deal-Channels privat, muss der Bot (bzw. seine Rolle) dort
zusätzlich freigeschaltet werden: Channel-Einstellungen → Berechtigungen →
Bot-Rolle hinzufügen → die drei Rechte oben erlauben.

## 3. Token im Tool eintragen

Im Tool unter **Einstellungen → Discord-Bot & Reaktionen**:

- **Bot-Token** einfügen
- Reaktion für „gekauft“ (Vorgabe ✅) und für „nicht mehr verfügbar“
  (Vorgabe ❌). Ein Server-Emoji wird in Discords Schreibweise eingetragen,
  z. B. `<:gekauft:123456789012345678>`. Die bekommst du in Discord, indem
  du `\:gekauft:` in ein Textfeld tippst und abschickst.
- **Beide Reaktionen nach dem Posten selbst setzen**: Der Bot setzt ✅ und ❌
  unter jeden neuen Post, damit jeder nur noch draufdrücken muss. Die
  Reaktion des Bots zählt beim Auswerten nicht mit.
- **Ausverkauft vorschlagen ab …**: Ab so vielen ❌ zeigt die Historie
  „wohl ausverkauft?“ beim Deal.
- **In B2B-Channels schon ab …**: eigene Schwelle für die B2B-Channels
  (Vorgabe 1 ❌). Welche Channels B2B sind, steht unter „Statistik: Gewinn
  mit Cart-Limit“.
- **Dann automatisch als ausverkauft markieren**: Das Tool markiert den Post
  selbst als ausverkauft. Das ändert den Post in Discord, darum ist es
  standardmäßig aus.

Speichern, dann unten auf **Jetzt abrufen**. Nach etwa einer Minute stehen die
Reaktionen in Historie und Statistik.

## Gut zu wissen

- Abgefragt werden die Posts der letzten 30 Tage, die mit dem Tool gesendet
  wurden. Von Hand gepostete Deals kennt das Tool nicht.
- Erscheint „kein Zugriff auf #channel“, fehlt dem Bot in diesem Channel eines
  der drei Rechte (siehe oben).
- Erscheint „Bot-Token wird von Discord abgelehnt“, wurde der Token
  zurückgesetzt oder falsch kopiert. In dem Fall im Entwicklerportal einen
  neuen Token erzeugen und eintragen.

## Alte Deals aus Discord einlesen

Unter **Historie → „📥 Alte Deals aus Discord einlesen“** liest der Bot den
Verlauf aller Channels, die im Tool eingetragen sind, und erkennt Posts im
gewohnten Aufbau (Titelzeile, EK, VK, „Gewinn: … / … % Marge“). Danach
kommt eine Vorschau; gespeichert wird erst nach dem Bestätigen. Übernommene
Deals tragen in der Historie das Etikett „aus Discord“, zählen in Statistik
und Werbebild mit, und ihre ✅/❌ werden wie bei neuen Posts abgeglichen.

Voraussetzung ist der **Message Content Intent** (siehe oben). Ohne ihn
liefert Discord dem Bot die Nachrichten ohne Text, und das Tool weist darauf
hin.
