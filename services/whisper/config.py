"""Configuración del microservicio Whisper — vía variables de entorno.

Documentado en ADR 0019. Todos los valores tienen default sensato; en
producción se sobreescriben desde docker-compose.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


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

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            model=_env("WHISPER_MODEL", "small"),
            device=_env("WHISPER_DEVICE", "auto"),
            compute_type=_env("WHISPER_COMPUTE_TYPE", "auto"),
            language=_env("WHISPER_LANGUAGE", "es"),
            host=_env("WHISPER_HOST", "0.0.0.0"),
            port=_env_int("WHISPER_PORT", 8765),
            partial_interval_ms=_env_int("WHISPER_PARTIAL_INTERVAL_MS", 1500),
            sample_rate=_env_int("WHISPER_SAMPLE_RATE", 16000),
            hotwords=_env("WHISPER_HOTWORDS", ""),
        )
