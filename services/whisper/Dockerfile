# Microservicio Whisper — faster-whisper en Python 3.11.
#
# Base con CUDA opcional. Sin GPU faster-whisper cae a CPU automáticamente,
# así que esta imagen sirve tanto a hosts con NVIDIA como sin ella.
#
# Volumen para cache de modelos (HF_HOME, en el home del usuario `shiro`) se
# monta desde el docker-compose para que la descarga sobreviva a recreaciones.
# El proceso corre sin root (usuario `shiro`, uid 10001).

# Base fijada por digest (2026-11-13): es la de la imagen que funciona hoy, para
# que una reconstrucción no cambie de base sin avisar. Para actualizarla, cambia
# el digest a propósito y prueba `docker compose build whisper`.
FROM nvidia/cuda:12.6.3-cudnn-runtime-ubuntu22.04@sha256:5f0d2d827f6436b3cb7468fd8acbdc8c1d41261614e579ae49afe6141da51133

# Dentro del contenedor el servicio tiene que escuchar en 0.0.0.0 para que el
# puerto publicado llegue; la frontera está en `ports:` de compose (loopback).
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/home/shiro/.cache/huggingface \
    WHISPER_HOST=0.0.0.0 \
    WHISPER_PORT=8765

# Python 3.11 + utilidades mínimas.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3-pip \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Asegurar que `python` y `pip` apunten a 3.11.
RUN update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1 \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1

WORKDIR /app

# En Debian/Ubuntu `ensurepip` está deshabilitado para el python del sistema,
# así que la vía limpia para 3.11 es un venv (el paquete python3.11-venv, ya
# instalado, lo habilita con su propio pip). Además aísla las deps del sistema.
# Con el PATH apuntando al venv, `python`/`pip`/`uvicorn` resuelven a 3.11 ahí.
RUN python3.11 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Las dependencias van primero para aprovechar la cache de capas.
COPY services/whisper/requirements.txt /app/requirements.txt
RUN pip install --upgrade pip \
    && pip install -r /app/requirements.txt

# Código.
COPY services/whisper /app/services/whisper

# Usuario sin root. El home y la caché de modelos son suyos; el código y el
# venv (propiedad de root, legibles por todos) no necesita escribirlos. El
# volumen de compose se monta sobre la caché y hereda este dueño al crearse.
RUN useradd --create-home --uid 10001 shiro \
    && mkdir -p /home/shiro/.cache/huggingface \
    && chown -R shiro:shiro /home/shiro
USER shiro

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD curl -fsS http://localhost:8765/health || exit 1

# `run()` usa `config.host` y `config.port` (WHISPER_HOST y WHISPER_PORT).
CMD ["python", "-m", "services.whisper.main"]
