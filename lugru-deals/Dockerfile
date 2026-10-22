FROM golang:1.25-alpine AS bau
WORKDIR /quelle
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# CGO_ENABLED=0 ist Pflicht: der SQLite-Treiber ist reines Go, und nur so
# entsteht ein Binary ohne Fremdbibliotheken.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /lugru-deals ./cmd/lugru-deals

FROM alpine:3.20
# su-exec führt den Privilegienwechsel im Entrypoint durch — der Container
# startet als root (siehe unten), damit er den Besitz von /daten übernehmen
# kann, aber die Anwendung selbst läuft danach unprivilegiert als "lugru".
RUN apk add --no-cache ca-certificates su-exec && adduser -D -u 10001 lugru
COPY --from=bau /lugru-deals /usr/local/bin/lugru-deals
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
WORKDIR /daten
ENV LUGRU_ADRESSE=0.0.0.0:8080 \
    LUGRU_DB=/daten/deals.db \
    LUGRU_CHARTS=/daten/charts \
    LUGRU_BROWSER=0
EXPOSE 8080
VOLUME ["/daten"]
# Bewusst kein USER hier: der Container muss als root starten, damit der
# Entrypoint den Besitz von /daten übernehmen kann — das Verzeichnis gehört
# root:root, wenn Docker es beim ersten "docker run -v" auf dem Host erst
# anlegt. Der Entrypoint wechselt selbst zu "lugru", bevor lugru-deals läuft
# (siehe entrypoint.sh).
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["lugru-deals"]
