"""Test del endpoint `GET /health`.

Mockeamos el módulo `faster_whisper` para evitar descargar el modelo
de verdad — los tests solo verifican que el endpoint compone la
respuesta correcta según el estado del transcriber.
"""

from __future__ import annotations

import sys
from types import ModuleType
from unittest.mock import MagicMock

import pytest


@pytest.fixture
def fake_faster_whisper(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    """Inyecta un módulo `faster_whisper` falso antes de que se importe."""
    fake_model = MagicMock()
    fake_model.transcribe.return_value = (iter([]), MagicMock())
    fake_model.device = "cpu"

    class FakeWhisperModel:
        def __init__(self, *_args, **_kwargs) -> None:  # noqa: ANN002, ANN003
            self.device = "cpu"

        def transcribe(self, *_args, **_kwargs):  # noqa: ANN002, ANN003
            return iter([]), MagicMock()

    fake_module = ModuleType("faster_whisper")
    fake_module.WhisperModel = FakeWhisperModel  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "faster_whisper", fake_module)
    return MagicMock()


def test_health_loading_before_transcriber_set(monkeypatch: pytest.MonkeyPatch) -> None:
    """Antes de cargar el modelo, /health responde `status=loading`."""
    # Reset del singleton del transcriber.
    from services.whisper import transcriber as t_mod

    monkeypatch.setattr(t_mod, "_singleton", None)

    from fastapi.testclient import TestClient
    from services.whisper.main import app

    # TestClient NO ejecuta el lifespan a menos que usemos `with`. Aquí
    # queremos ver el estado "loading" — sin lifespan no se setea el
    # transcriber, así que el endpoint debe devolver `loading`.
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "loading"
    assert data["model"]  # cualquier modelo de la config, no vacío


def test_health_ok_when_transcriber_present(
    fake_faster_whisper: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Con el transcriber cargado, /health responde ok con metadata."""
    from services.whisper.config import Config
    from services.whisper.transcriber import Transcriber, set_transcriber

    transcriber = Transcriber(Config.from_env())
    set_transcriber(transcriber)

    from fastapi.testclient import TestClient
    from services.whisper.main import app

    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["device"] == "cpu"
    assert data["language"]
    assert data["sample_rate"] == 16000
