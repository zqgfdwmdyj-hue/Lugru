FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs ./
COPY lib ./lib
COPY public ./public
ENV NODE_ENV=production PORT=3030 DATA_DIR=/daten
RUN mkdir -p /daten && chown node:node /daten
EXPOSE 3030
USER node
CMD ["node", "server.mjs"]
