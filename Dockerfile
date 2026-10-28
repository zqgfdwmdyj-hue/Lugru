FROM node:22-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Ohne Typprüfung bauen: die braucht ~1,4 GB und passt nicht auf den 2-GB-Server (geprüft wird vor dem Hochladen).
RUN NEXT_SKIP_TYPECHECK=1 npm run build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
# Datenbank auf den neuesten Stand bringen, dann starten
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && npx next start -p 3000"]
