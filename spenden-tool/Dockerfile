FROM node:22-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=3100
EXPOSE 3100
# Datenbank auf den neuesten Stand bringen, dann starten
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && npx next start -p 3100"]
