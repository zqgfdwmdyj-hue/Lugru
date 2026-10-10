FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
# „anmelden“ als Befehl: docker compose run --rm ring-archiv anmelden
RUN printf '#!/bin/sh\nexec node /app/src/anmelden.js\n' > /usr/local/bin/anmelden && chmod +x /usr/local/bin/anmelden
USER node
CMD ["node", "src/index.js"]
