# Home Assistant übergibt BUILD_FROM – das Add-on nutzt bewusst ein schlankes Node-Image.
ARG BUILD_FROM
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
CMD ["node", "src/index.js"]
