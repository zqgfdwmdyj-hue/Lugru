# Druckagent als Container (z. B. auf dem NAS oder Mini-PC):
#   docker build -t lugru-druckagent -f linux/Dockerfile .
#   docker run -d --restart=always --device /dev/usb/lp0 -v /pfad/config.json:/app/config.json:ro lugru-druckagent
FROM node:22-alpine
WORKDIR /app
COPY lugru-druckagent.mjs /app/
CMD ["node", "/app/lugru-druckagent.mjs"]
