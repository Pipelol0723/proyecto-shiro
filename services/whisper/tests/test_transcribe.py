"""Test del endpoint `POST /transcribe` (batch).

Verifica que el endpoint:
- devuelve 503 si el modelo aún no cargó,
- maneja body vacío sin invocar el transcriber,
- delega en `Transcriber.transcribe_pcm` y devuelve `{text, isFinal: true}`.

Stub del transcriber: usamos un fake que registra las llamadas y
devuelve un texto fijo — los tests no dependen de faster-whisper real
ni del modelo descargado.
"""

from __future__ import annotations

import pytest


class _FakeTranscriber:
    """Stub mínimo de `Transcriber` para tests del endpoint batch."""

    def __init__(self, text: str = "hola mundo") -> None:
        self._text = text
        self.device = "cpu"
        self.calls: list[bytes] = []

    def transcribe_pcm(self, pcm: bytes) -> str:
        self.calls.append(pcm)
        return self._text


def test_transcribe_503_when_model_loading(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sin transcriber cargado, devuelve 503."""
    from services.whisper import transcriber as t_mod

    monkeypatch.setattr(t_mod, "_singleton", None)

    from fastapi.testclient import TestClient
    from services.whisper.main import app

    client = TestClient(app)
    response = client.post(
        "/transcribe",
        content=b"\x00\x00" * 8,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 503


def test_transcribe_empty_body_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    """Body vacío → no invoca el transcriber, devuelve text vacío."""
    from services.whisper import transcriber as t_mod

    fake = _FakeTranscriber()
    monkeypatch.setattr(t_mod, "_singleton", fake)

    from fastapi.testclient import TestClient
    from services.whisper.main import app

    client = TestClient(app)
    response = client.post(
        "/transcribe",
        content=b"",
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data == {"text": "", "isFinal": True}
    assert fake.calls == []  # no se invocó


def test_transcribe_delegates_to_transcriber(monkeypatch: pytest.MonkeyPatch) -> None:
    """Con body, llama a transcribe_pcm y devuelve su texto."""
    from services.whisper import transcriber as t_mod

    fake = _FakeTranscriber(text="ya estoy aquí")
    monkeypatch.setattr(t_mod, "_singleton", fake)

    from fastapi.testclient import TestClient
    from services.whisper.main import app

    client = TestClient(app)
    pcm = b"\x01\x00" * 100
    response = client.post(
        "/transcribe",
        content=pcm,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data == {"text": "ya estoy aquí", "isFinal": True}
    assert len(fake.calls) == 1
    assert fake.calls[0] == pcm
