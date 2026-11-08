FROM node:22-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
# Browser für die Automatik (sellerboard-Kostenimport, BQool-Upload, ArbitrageOne-Abruf) – Standard: mit.
# Braucht ~400 MB mehr im Abbild. Abschalten nur bei Platzmangel: MIT_BROWSER=0 in die .env neben docker-compose.yml.
# Fester Ablageort, damit der Browser unabhängig vom Benutzer gefunden wird; die Schicht wird nur neu gebaut, wenn
# sich package-lock.json ändert.
ARG MIT_BROWSER=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN if [ "$MIT_BROWSER" = "1" ]; then npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*; fi
# PDF-Umwandlung für den Etikettendruck (Seller-Central-Kartonlabels, FNSKU-Bögen): pdftoppm/pdftotext.
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*
COPY . .
# Ohne Typprüfung bauen: die braucht ~1,4 GB und passt nicht auf den 2-GB-Server (geprüft wird vor dem Hochladen).
RUN NEXT_SKIP_TYPECHECK=1 npm run build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
# Datenbank auf den neuesten Stand bringen, dann starten
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && npx next start -p 3000"]
