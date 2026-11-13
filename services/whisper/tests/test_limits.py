"""Tests de los topes del servicio Whisper (P-06b).

Cubren: tope de audio en `/stt` (1009) y en `/transcribe` (413), cierre por
inactividad (1001), filtro de `Origin` antes del `accept` y host por defecto.

El transcriber es un fake y `main.config` se sustituye por una copia con topes
pequeños: ningún test carga el modelo real ni depende de tiempos largos.
"""

from __future__ import annotations

import dataclasses
import threading
from typing import Any, Callable, Iterator

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from services.whisper.config import Config


class _FakeTranscriber:
    def __init__(self, text: str = "hola mundo") -> None:
        self._text = text
        self.device = "cpu"
        self.calls: list[bytes] = []

    def transcribe_pcm(self, pcm: bytes) -> str:
        self.calls.append(pcm)
        return self._text


@pytest.fixture()
def fake(monkeypatch: pytest.MonkeyPatch) -> _FakeTranscriber:
    from services.whisper import transcriber as t_mod

    fake = _FakeTranscriber()
    monkeypatch.setattr(t_mod, "_singleton", fake)
    return fake


@pytest.fixture()
def small_limits(monkeypatch: pytest.MonkeyPatch) -> Config:
    """Config con tope de 1 s de audio (32 000 bytes) y 1 s de inactividad."""
    from services.whisper import main

    cfg = dataclasses.replace(main.config, max_audio_seconds=1, idle_timeout_s=1)
    monkeypatch.setattr(main, "config", cfg)
    return cfg


def _run_with_deadline(fn: Callable[[], Any], seconds: float, message: str) -> Any:
    """Ejecuta `fn` en un hilo; si no acaba a tiempo, falla en vez de colgarse."""
    result: dict[str, Any] = {}

    def target() -> None:
        try:
            result["value"] = fn()
        except BaseException as err:  # noqa: BLE001
            result["error"] = err

    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    thread.join(timeout=seconds)
    if thread.is_alive():
        pytest.fail(message)
    if "error" in result:
        raise result["error"]
    return result.get("value")


def _read_until_close(ws: Any) -> int:
    """Lee mensajes hasta el cierre del servidor y devuelve su código."""
    while True:
        try:
            msg = ws.receive()
        except WebSocketDisconnect as err:
            return err.code
        if msg.get("type") == "websocket.close":
            return int(msg.get("code", 1000))


def test_stt_closes_1009_when_buffer_exceeds_cap(
    fake: _FakeTranscriber, small_limits: Config
) -> None:
    from services.whisper.main import app

    def session() -> int:
        client = TestClient(app)
        with client.websocket_connect("/stt") as ws:
            for _ in range(6):  # 48 000 bytes > 32 000
                ws.send_bytes(b"\0" * 8000)
            return _read_until_close(ws)

    code = _run_with_deadline(session, 5, "no cerró con 1009 en 5 s")
    assert code == 1009


def test_stt_sends_error_before_closing_on_cap(
    fake: _FakeTranscriber, small_limits: Config
) -> None:
    from services.whisper.main import app

    def session() -> str:
        client = TestClient(app)
        with client.websocket_connect("/stt") as ws:
            for _ in range(6):
                ws.send_bytes(b"\0" * 8000)
            return ws.receive_text()

    payload = _run_with_deadline(session, 5, "no llegó el mensaje de error en 5 s")
    assert '"type": "error"' in payload


def test_stt_closes_1001_when_idle(fake: _FakeTranscriber, small_limits: Config) -> None:
    from services.whisper.main import app

    def session() -> int:
        client = TestClient(app)
        with client.websocket_connect("/stt") as ws:
            return _read_until_close(ws)

    code = _run_with_deadline(session, 6, "no cerró por inactividad en 6 s")
    assert code == 1001


def test_transcribe_413_when_body_exceeds_cap(
    fake: _FakeTranscriber, small_limits: Config
) -> None:
    from services.whisper.main import app

    client = TestClient(app)
    response = client.post(
        "/transcribe",
        content=b"\0" * (small_limits.max_audio_bytes + 1),
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 413
    assert fake.calls == []


def test_transcribe_413_without_content_length(
    fake: _FakeTranscriber, small_limits: Config
) -> None:
    """Un cliente que omite o miente en Content-Length también se corta."""
    from services.whisper.main import app

    def body() -> Iterator[bytes]:
        chunk = b"\0" * 8000
        for _ in range(6):
            yield chunk

    client = TestClient(app)
    response = client.post(
        "/transcribe",
        content=body(),
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 413
    assert fake.calls == []


def test_transcribe_accepts_body_at_cap(fake: _FakeTranscriber, small_limits: Config) -> None:
    from services.whisper.main import app

    client = TestClient(app)
    response = client.post(
        "/transcribe",
        content=b"\0" * small_limits.max_audio_bytes,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 200
    assert response.json() == {"text": "hola mundo", "isFinal": True}


def test_stt_rejects_foreign_origin(fake: _FakeTranscriber) -> None:
    from services.whisper.main import app

    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as info:
        with client.websocket_connect("/stt", headers={"origin": "https://evil.example"}):
            pass
    assert info.value.code == 1008


def test_stt_accepts_tauri_origin(fake: _FakeTranscriber) -> None:
    from services.whisper.main import app

    client = TestClient(app)
    with client.websocket_connect("/stt", headers={"origin": "http://tauri.localhost"}) as ws:
        ws.send_bytes(b"\0\0" * 10)
        ws.send_text('{"type": "stop"}')
        data = ws.receive_json()
    assert data["type"] == "transcribed"
    assert data["text"] == "hola mundo"


def test_stt_accepts_connection_without_origin(fake: _FakeTranscriber) -> None:
    """Sin cabecera Origin (proceso local, ping del core-host) se acepta."""
    from services.whisper.main import app

    client = TestClient(app)
    with client.websocket_connect("/stt") as ws:
        ws.send_text('{"type": "stop"}')
        data = ws.receive_json()
    assert data["type"] == "transcribed"


def test_cors_blocks_foreign_origin_on_http(fake: _FakeTranscriber) -> None:
    from services.whisper.main import app

    client = TestClient(app)
    ok = client.get("/health", headers={"Origin": "http://localhost:5173"})
    bad = client.get("/health", headers={"Origin": "https://evil.example"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "access-control-allow-origin" not in bad.headers


def test_config_default_host_is_loopback(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "WHISPER_HOST",
        "WHISPER_MAX_AUDIO_SECONDS",
        "WHISPER_IDLE_TIMEOUT_S",
        "WHISPER_ALLOWED_ORIGINS",
    ):
        monkeypatch.delenv(name, raising=False)
    cfg = Config.from_env()
    assert cfg.host == "127.0.0.1"
    assert cfg.max_audio_seconds == 90
    assert cfg.idle_timeout_s == 15
    assert cfg.max_audio_bytes == 16000 * 2 * 90
    assert set(cfg.allowed_origins) == {
        "http://tauri.localhost",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    }


def test_config_allowed_origins_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WHISPER_ALLOWED_ORIGINS", "http://a.test, http://b.test ,")
    cfg = Config.from_env()
    assert cfg.allowed_origins == ("http://a.test", "http://b.test")
