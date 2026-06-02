"""Wrapper alrededor de faster-whisper.

Hace tres cosas que el endpoint WS necesita:

1. Carga el modelo y lo deja caliente (un transcript descartable en
   `warmup()` evita el cold-start del primer turno real).
2. Convierte el buffer crudo PCM Int16 LE @ sample_rate del cliente en
   `np.float32` normalizado, que es lo que `WhisperModel.transcribe`
   acepta directamente sin pasar por ffmpeg.
3. Propaga `hotwords` (cuando viene en la config) a cada llamada al
   modelo. Sesga el decoder hacia palabras concretas (nombres propios,
   jerga) sin filtrarse al output — la herramienta correcta para que
   "Shiro" deje de mapear a "Chiro"/"Ciro" en modelos pequeños.

Por qué `hotwords` y no `initial_prompt`: probamos `initial_prompt`
primero pero Whisper-small lo escupía como output cuando el audio era
ambiguo (perplejidad alta), inundando el `sttLive` con la frase del
prompt en vez de la transcripción real. `hotwords` (faster-whisper
≥1.1.0) sesga sin contaminar.

Faster-whisper no tiene true streaming: cada llamada a `transcribe()`
procesa el buffer entero. El endpoint emula partials retranscribiendo
todo el buffer cada `partial_interval_ms`; ineficiente pero suficiente
para una V1 y no requiere implementar VAD/chunking manual.
"""

from __future__ import annotations

import logging
import time
from typing import Optional

import numpy as np

from .config import Config

logger = logging.getLogger("shiro-whisper.transcriber")


class Transcriber:
    """Encapsula el `WhisperModel` con la config del servicio."""

    def __init__(self, config: Config) -> None:
        from faster_whisper import WhisperModel

        self.config = config
        t0 = time.monotonic()
        self._model = WhisperModel(
            config.model,
            device=config.device,
            compute_type=config.compute_type,
        )
        self.load_time = time.monotonic() - t0
        # `device` queda resuelto a "cuda"/"cpu" tras instanciar. En
        # faster-whisper el atributo vive en `_model.model.device` (el
        # ctranslate2 Whisper interno) — no en el wrapper. Bajamos al
        # fallback solo si por alguna razón el atributo no aparece.
        inner = getattr(self._model, "model", None)
        self.device: str = getattr(inner, "device", config.device)

    def warmup(self) -> None:
        """Transcribe ~250 ms de silencio para forzar la primera inferencia.

        El primer `transcribe()` paga cargar CUDA, alocar buffers, etc.
        Hacerlo al arranque evita que el primer cliente pague la
        latencia (varios segundos en GPU, hasta decenas en CPU).

        Sync a propósito: el llamador en `main.py` usa
        `asyncio.to_thread(transcriber.warmup)` que espera callable
        síncrono — si esto fuera `async def`, el coroutine se devolvería
        sin awaitarse y el warmup nunca correría (RuntimeWarning).
        """
        sample_count = int(self.config.sample_rate * 0.25)
        silence = np.zeros(sample_count, dtype=np.float32)
        self._transcribe_array(silence)
        logger.info("warm-up de Whisper completado")

    def transcribe_pcm(self, pcm_bytes: bytes) -> str:
        """Transcribe un buffer PCM Int16 LE @ sample_rate mono.

        Devuelve el texto concatenado de todos los segmentos. Bytes
        impares se descartan al borde — Int16 = 2 bytes, así que un
        número impar de bytes indicaría chunk corrupto.
        """
        if len(pcm_bytes) < 2:
            return ""
        # Asegurar paridad por seguridad: cortamos el último byte si sobra.
        if len(pcm_bytes) % 2 != 0:
            pcm_bytes = pcm_bytes[:-1]
        samples_i16 = np.frombuffer(pcm_bytes, dtype=np.int16)
        # int16 → float32 normalizado a [-1, 1], que es lo que Whisper espera.
        samples_f32 = samples_i16.astype(np.float32) / 32768.0
        return self._transcribe_array(samples_f32)

    def _transcribe_array(self, samples: np.ndarray) -> str:
        # `hotwords=""` puede ser tratado como token vacío por algunos
        # decoders. Pasamos None cuando no hay hotwords para que
        # faster-whisper aplique su comportamiento por defecto.
        hotwords = self.config.hotwords or None
        segments_iter, _info = self._model.transcribe(
            samples,
            language=self.config.language,
            vad_filter=True,
            beam_size=1,  # priorizar latencia sobre calidad marginal
            hotwords=hotwords,
        )
        # Concatenamos todos los segmentos. `Segment.text` ya incluye
        # leading space — al hacer join no doblamos espacios.
        parts: list[str] = []
        for segment in segments_iter:
            parts.append(segment.text)
        return "".join(parts).strip()


# Pequeño helper para que el endpoint pueda instanciar un único transcriber
# y compartirlo entre conexiones WS.
_singleton: Optional[Transcriber] = None


def get_transcriber() -> Optional[Transcriber]:
    return _singleton


def set_transcriber(t: Transcriber) -> None:
    global _singleton
    _singleton = t
