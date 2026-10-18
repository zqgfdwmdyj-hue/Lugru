# GRULU in ChatGPT: gefunden werden und werben

Es gibt drei Wege, von kostenlos bis bezahlt. Stand: Oktober 2026. Bedingungen bitte direkt bei OpenAI prüfen.

## 1. Kostenlos in ChatGPT-Antworten auftauchen (schon eingebaut)

ChatGPT-Suche liest Webseiten über den Bot `OAI-SearchBot`. Die neue Seite hilft dabei mit:

- `robots.txt`: erlaubt ChatGPT-, GPT- und Such-Bots ausdrücklich.
- schema.org-Daten in `index.html`: Produkte mit Preis, Verfügbarkeit, Bild und Amazon-Link, dazu die FAQ.
- `llms.txt`: Kurzbeschreibung von GRULU für KI-Assistenten.
- Der Button „Frag ChatGPT nach GRULU“ öffnet ChatGPT mit einer passenden Frage.

Was das zusätzlich verstärkt: Bewertungen auf Amazon, Erwähnungen in Blogs, Elternforen und TikTok. ChatGPT empfiehlt bevorzugt, was an mehreren Stellen gut besprochen wird.

## 2. ChatGPT Shopping: Produkt-Feed einreichen (kostenlos)

ChatGPT zeigt Produktkarten zunehmend aus Händler-Feeds an. Ein Entwurf liegt unter `public/feed/products.jsonl`, nach dem Livegang erreichbar unter https://www.grulu-box.de/feed/products.jsonl.

1. Bei OpenAI als Händler anmelden: developers.openai.com/commerce
2. Die Feldnamen im Feed mit der aktuellen OpenAI-Feed-Spezifikation abgleichen. Der Entwurf folgt dem bekannten Aufbau, die Spezifikation ändert sich aber noch.
3. Direktkauf in ChatGPT (Instant Checkout) ist nur für freigegebene Partner möglich. Bis dahin führen die Produkte zu Amazon.

## 3. Bezahlte Anzeigen in ChatGPT (ChatGPT Ads)

Seit dem 24. August 2026 laufen ChatGPT Ads in Deutschland. Werbekunden können sie selbst buchen.

- Konto anlegen auf ads.openai.com. Dafür muss die Firma in Deutschland eingetragen sein, die Wittmann & Grunert GmbH passt also.
- Mindestbudget laut Agenturberichten: etwa 15 € pro Tag und Kampagne.
- Anzeigen erscheinen unter ChatGPT-Antworten, nur bei Free- und Go-Nutzern. **Nutzer unter 18 sehen keine Anzeigen.** Die Zielgruppe sind also Eltern, Großeltern und Paten, nicht Kinder.
- Es gibt ein Anzeigenformat, das Anzeigen automatisch aus dem Produkt-Feed erstellt. Dafür lohnt sich Schritt 2 zuerst.

### Vorschläge für den Start

Thema der Kampagne: Geschenkideen für Kinder, Schulstart, Mitbringsel, Reisen mit Kindern.

Anzeigentexte (kurz):

1. **Überraschung in der Box** – Bunte GRULU-Snackboxen mit Nerds oder Pop Rocks. Das Geschenk, über das sich Kinder wirklich freuen. Mit Prime schnell da.
2. **Mitbringsel gesucht?** – GRULU Probierboxen ab 14,99 €. Liebevoll gepackt, bunt und voller Überraschungen.
3. **Knister-Spaß für Entdecker** – Die Pop Rocks Probierbox von GRULU: Knallzucker in verschiedenen Sorten. Jetzt bei Amazon.

Hinweis: Bei Werbung für Süßigkeiten gilt, dass sie sich nicht direkt an Kinder richten darf. Die Texte oben sprechen deshalb Erwachsene an, die schenken.

Quellen: internetwarriors.de/en/blog/chatgpt-ads-deutschland, inpromptads.com/chatgpt-ads/germany, lengow.com/integrations/chatgpt. Das sind Agentur-Seiten, keine offiziellen OpenAI-Angaben.
