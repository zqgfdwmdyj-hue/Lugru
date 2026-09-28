# Hinweise für Coding-Agents

- Next.js 16: APIs weichen vom Trainingsstand ab (z. B. `proxy.ts` statt Middleware). Vor
  Änderungen an Next-spezifischem Code die Doku in `node_modules/next/dist/docs/` lesen.
- Jede Abfrage auf fachliche Tabellen filtert nach `tenant_id` der Sitzung
  (`requireSession()`), auch in Server Actions und Route Handlern.
- Oberfläche und Texte auf Deutsch.
- Keine echten Geschäftsdaten (Exporte, Rechnungen, SKUs mit echten Preisen) committen.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
