FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs galerie.mjs knowledge.md ./
COPY public ./public
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
