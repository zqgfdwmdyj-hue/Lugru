# Video-Worker (B36): Python 3.12 + ffmpeg. Läuft auf dem Arbeits-PC (Docker Desktop) – nicht im Seller-Container.
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY filter.json worker.py ./
COPY udd ./udd

# Arbeitsdateien und Musik liegen außerhalb des Containers (Volumes), damit ein Neustart dort weitermacht.
ENV ARBEITSORDNER=/arbeit MUSIKORDNER=/musik PYTHONUNBUFFERED=1
VOLUME ["/arbeit", "/musik"]
RUN useradd -m worker && mkdir -p /arbeit /musik && chown worker /arbeit /musik
USER worker

CMD ["python", "worker.py"]
