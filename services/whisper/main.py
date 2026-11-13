"""Microservicio STT — FastAPI + faster-whisper.

Endpoints:
  GET /health           — estado del servicio (modelo, dispositivo, idioma).
  WS  /stt              — sesión de transcripción.

Protocolo del WS (/stt) — el cliente desktop es quien habla aquí:
  Cliente envía:
    - Mensajes binarios: chunks de audio PCM Int16 LE mono al
      sample_rate configurado (default 16 kHz).
    - Mensajes texto JSON de control:
        {"type": "stop"} → fin de turno, emitir resultado final y cerrar.

  Servidor envía (JSON sobre el mismo WS):
    - {"type": "partial", "text": "..."}              — cada
      `partial_interval_ms` mientras se acumula audio.
    - {"type": "transcribed", "text": "...", "isFinal": true} — al
      recibir el stop. El cliente lo traduce a `user:message` (ver ADR
      0019, decisión 3 — el microservicio nunca habla con el core-host
      directamente).
    - {"type": "error", "message": "..."}             — cualquier fallo.

Coreografía:
  - El cliente abre el WS, manda chunks mientras el usuario habla.
  - El servidor emite partials periódicos.
  - Cuando el cliente suelta la tecla (o VAD detecta silencio), manda
    `{"type": "stop"}`.
  - El servidor responde con el `transcribed` final y cierra la conexión.

Topes (ADR 0019, enmienda de 2026-11-13): el buffer de audio no pasa de
`max_audio_seconds` (cierre 1009 en /stt, 413 en /transcribe), una sesión sin
tráfico `idle_timeout_s` se cierra con 1001 y un `Origin` ajeno se rechaza
antes de aceptar el WebSocket (1008).

Ver ADR 0019 para el detalle de la arquitectura.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .config import Config
from .transcriber import Transcriber, get_transcriber, set_transcriber

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("shiro-whisper")

config = Config.from_env()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info(
        "cargando modelo whisper %s (device=%s, compute_type=%s)",
        config.model,
        config.device,
        config.compute_type,
    )
    transcriber = await asyncio.to_thread(Transcriber, config)
    logger.info("modelo cargado en %.2fs (device resuelto: %s)", transcriber.load_time, transcriber.device)
    await asyncio.to_thread(transcriber.warmup)
    set_transcriber(transcriber)
    logger.info("microservicio listo en %s:%d", config.host, config.port)
    yield
    logger.info("apagando microservicio")


app = FastAPI(lifespan=lifespan, title="shiro-whisper")
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(config.allowed_origins),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
async def health() -> dict[str, Any]:
    transcriber = get_transcriber()
    if transcriber is None:
        return {"status": "loading", "model": config.model}
    return {
        "status": "ok",
        "model": config.model,
        "device": transcriber.device,
        "language": config.language,
        "sample_rate": config.sample_rate,
    }


@app.post("/transcribe")
async def transcribe_batch(request: Request) -> dict[str, Any]:
    """Transcripción batch de un buffer PCM Int16 LE mono completo.

    NO es el flujo principal del chat — ese va por WebSocket directo
    desde el cliente desktop (ver ADR 0019 decisión 3). Este endpoint
    existe para que el cliente TS `WhisperSTT` pueda implementar
    `ISTTModule.transcribe(request)` desde tests/CLI sin abrir un WS, y
    para diagnósticos manuales (`curl --data-binary @audio.pcm`).

    El idioma lo fija la config del servicio (`WHISPER_LANGUAGE`); no se
    parametriza por request en V1.

    El cuerpo no puede pasar de `max_audio_bytes`: se rechaza con 413 por la
    cabecera `Content-Length` y, como un cliente puede mentir u omitirla, también
    al leer el cuerpo por trozos.
    """
    max_bytes = config.max_audio_bytes
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > max_bytes:
        raise HTTPException(status_code=413, detail="audio demasiado largo")
    transcriber = get_transcriber()
    if transcriber is None:
        raise HTTPException(status_code=503, detail="modelo aún cargando")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > max_bytes:
            raise HTTPException(status_code=413, detail="audio demasiado largo")
    if not body:
        return {"text": "", "isFinal": True}
    text = await asyncio.to_thread(transcriber.transcribe_pcm, bytes(body))
    return {"text": text, "isFinal": True}


async def _emit_error(ws: WebSocket, message: str) -> None:
    try:
        await ws.send_text(json.dumps({"type": "error", "message": message}))
    except Exception:  # noqa: BLE001 — best-effort en disconnect
        pass


@app.websocket("/stt")
async def stt_endpoint(ws: WebSocket) -> None:
    # El Origin se comprueba ANTES de aceptar: un cierre previo al accept hace
    # que Starlette responda 403 al handshake. Sin cabecera (proceso local) se
    # acepta; eso lo cerrará el token de ADR 0027.
    origin = ws.headers.get("origin")
    if origin is not None and origin not in config.allowed_origins:
        logger.warning("conexión /stt rechazada por Origin no permitido: %s", origin)
        await ws.close(code=1008)
        return
    await ws.accept()
    transcriber = get_transcriber()
    if transcriber is None:
        await _emit_error(ws, "modelo aún cargando, reintenta en unos segundos")
        await ws.close(code=1013)  # "Try Again Later"
        return

    max_bytes = config.max_audio_bytes
    closed = False  # evita un segundo close() en el finally

    buffer = bytearray()
    last_partial = time.monotonic()
    partial_interval_s = config.partial_interval_ms / 1000.0
    last_partial_text = ""

    try:
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive(), timeout=config.idle_timeout_s)
            except asyncio.TimeoutError:
                await _emit_error(ws, "sesión inactiva")
                await ws.close(code=1001)  # "Going Away"
                closed = True
                break
            mtype = msg.get("type")
            if mtype == "websocket.disconnect":
                break
            # Chunks binarios: acumular en buffer.
            if msg.get("bytes"):
                buffer.extend(msg["bytes"])
                if len(buffer) > max_bytes:
                    await _emit_error(ws, "audio demasiado largo")
                    await ws.close(code=1009)  # "Message Too Big"
                    closed = True
                    break
                now = time.monotonic()
                if now - last_partial >= partial_interval_s and len(buffer) >= 2:
                    # Retranscribir todo el buffer en un thread para no
                    # bloquear el event loop. Si el modelo es lento (CPU
                    # con `medium`), perdemos un chunk de partials pero
                    # nunca el final.
                    snapshot = bytes(buffer)
                    text = await asyncio.to_thread(transcriber.transcribe_pcm, snapshot)
                    if text and text != last_partial_text:
                        last_partial_text = text
                        await ws.send_text(json.dumps({"type": "partial", "text": text}))
                    last_partial = now
                continue
            # Mensajes de texto: comandos de control.
            text_payload = msg.get("text")
            if not text_payload:
                continue
            try:
                cmd = json.loads(text_payload)
            except json.JSONDecodeError:
                await _emit_error(ws, "json de control inválido")
                continue
            if cmd.get("type") == "stop":
                # Transcribir buffer entero y emitir final.
                if buffer:
                    text = await asyncio.to_thread(transcriber.transcribe_pcm, bytes(buffer))
                else:
                    text = ""
                await ws.send_text(
                    json.dumps(
                        {
                            "type": "transcribed",
                            "text": text,
                            "isFinal": True,
                        }
                    )
                )
                break
    except WebSocketDisconnect:
        pass
    except Exception as err:  # noqa: BLE001 — última red de seguridad
        logger.exception("error en sesión STT")
        await _emit_error(ws, str(err))
    finally:
        if not closed:
            try:
                await ws.close()
            except Exception:  # noqa: BLE001
                pass


def run() -> None:
    """Entry point que `uvicorn services.whisper.main:app` no necesita,
    pero útil para ejecutar el módulo localmente: `python -m services.whisper.main`."""
    import uvicorn

    uvicorn.run(
        "services.whisper.main:app",
        host=config.host,
        port=config.port,
        log_level="info",
    )


if __name__ == "__main__":
    run()
