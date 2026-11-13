"""Configuración del microservicio Whisper — vía variables de entorno.

Documentado en ADR 0019. Todos los valores tienen default sensato; en
producción se sobreescriben desde docker-compose.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

logger = logging.getLogger(__name__)


def _env(name: str, default: str) -> str:
    return os.getenv(name, default)


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


# Orígenes que pueden hablar con el servicio desde un navegador o webview:
# los mismos tres que acepta el bus del core-host (ADR 0027): la app Tauri y
# el servidor de desarrollo de Vite.
DEFAULT_ALLOWED_ORIGINS = (
    "http://tauri.localhost",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)


def _env_positive_int(name: str, default: int) -> int:
    """Como `_env_int`, pero un valor <= 0 vuelve al default (con aviso)."""
    value = _env_int(name, default)
    if value <= 0:
        logger.warning("%s=%s no es válido (debe ser > 0); uso %s", name, value, default)
        return default
    return value


def _env_list(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    # Se normaliza igual que el navegador envía el Origin: sin barra final y en
    # minúsculas; si no, un valor como "http://localhost:5173/" nunca coincidiría.
    items = tuple(item.strip().rstrip("/").lower() for item in raw.split(",") if item.strip())
    if not items:
        logger.warning("%s no contiene orígenes útiles: se rechazará todo Origin de navegador", name)
    return items


@dataclass(frozen=True)
class Config:
    """Configuración inmutable del servicio. Se construye una vez al arrancar."""

    # Modelo y dispositivo
    model: str
    device: str  # "auto" | "cuda" | "cpu"
    compute_type: str  # "auto" | "int8" | "float16" | "float32"
    language: str

    # Servidor
    host: str
    port: int

    # Transcripción
    # Cada cuántos ms re-transcribir el buffer y emitir un partial al cliente.
    # Más bajo = más reactivo, pero más CPU/GPU. 1500 ms es el equilibrio
    # documentado en el ADR 0019.
    partial_interval_ms: int

    # Sample rate esperado del audio crudo PCM Int16 LE mono que envía el
    # cliente. 16 kHz es lo que Whisper come nativamente; el cliente
    # convierte desde la frecuencia del micro (típicamente 44.1/48 kHz).
    sample_rate: int

    # Palabras clave que el decoder boostea para reducir el error en
    # nombres propios poco comunes (p. ej. "Shiro" → "Chiro"/"Ciro" en
    # modelos pequeños). String corto separado por espacios. Faster-
    # whisper ≥1.1.0; sesga sin filtrarse al output (a diferencia del
    # `initial_prompt`, que Whisper alucinaba como salida en chunks con
    # perplejidad alta).
    hotwords: str

    # Topes de la sesión (ADR 0019, enmienda de 2026-11-13).
    # Segundos máximos de audio por turno en /stt y por cuerpo en /transcribe.
    # Pasado el tope, /stt cierra con 1009 y /transcribe responde 413.
    max_audio_seconds: int
    # Segundos sin recibir nada del cliente antes de cerrar /stt con 1001.
    idle_timeout_s: int
    # Orígenes permitidos (CORS y WebSocket). Una conexión sin cabecera Origin
    # (un proceso local) se acepta: ese residuo lo cierra el token de ADR 0027.
    allowed_origins: tuple[str, ...]

    @property
    def max_audio_bytes(self) -> int:
        """Tope en bytes del audio PCM Int16 mono (2 bytes por muestra)."""
        return self.sample_rate * 2 * self.max_audio_seconds

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            model=_env("WHISPER_MODEL", "small"),
            device=_env("WHISPER_DEVICE", "auto"),
            compute_type=_env("WHISPER_COMPUTE_TYPE", "auto"),
            language=_env("WHISPER_LANGUAGE", "es"),
            host=_env("WHISPER_HOST", "127.0.0.1"),
            port=_env_int("WHISPER_PORT", 8765),
            partial_interval_ms=_env_int("WHISPER_PARTIAL_INTERVAL_MS", 1500),
            sample_rate=_env_positive_int("WHISPER_SAMPLE_RATE", 16000),
            hotwords=_env("WHISPER_HOTWORDS", ""),
            max_audio_seconds=_env_positive_int("WHISPER_MAX_AUDIO_SECONDS", 90),
            idle_timeout_s=_env_positive_int("WHISPER_IDLE_TIMEOUT_S", 15),
            allowed_origins=_env_list("WHISPER_ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS),
        )
