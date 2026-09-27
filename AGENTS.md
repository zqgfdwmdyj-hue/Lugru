# Hinweise für Coding-Agents

- Next.js 16: APIs weichen vom Trainingsstand ab (z. B. `proxy.ts` statt Middleware). Vor
  Änderungen an Next-spezifischem Code die Doku in `node_modules/next/dist/docs/` lesen.
- Jede Abfrage auf fachliche Tabellen filtert nach `tenant_id` der Sitzung
  (`requireSession()`), auch in Server Actions und Route Handlern.
- Oberfläche und Texte auf Deutsch.
- Keine echten Geschäftsdaten (Exporte, Rechnungen, SKUs mit echten Preisen) committen.
