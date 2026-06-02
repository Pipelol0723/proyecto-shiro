# Microservicio Whisper — faster-whisper en Python 3.11.
#
# Base con CUDA opcional. Sin GPU faster-whisper cae a CPU automáticamente,
# así que esta imagen sirve tanto a hosts con NVIDIA como sin ella.
#
# Volumen para cache de modelos (default ~/.cache/huggingface) se monta
# desde el docker-compose para que la descarga sobreviva a recreaciones.

FROM nvidia/cuda:12.6.3-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/root/.cache/huggingface

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

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD curl -fsS http://localhost:8765/health || exit 1

CMD ["python", "-m", "uvicorn", "services.whisper.main:app", "--host", "0.0.0.0", "--port", "8765"]
