"""Tests del wrapper `Transcriber`.

Verifica que la config se propaga correctamente al modelo de
faster-whisper — en particular `hotwords`, que es la pieza nueva que
aporta valor para nombres propios poco comunes. Mockeamos
`faster_whisper.WhisperModel` para no descargar el modelo real.
"""

from __future__ import annotations

import sys
from dataclasses import replace
from types import ModuleType
from unittest.mock import MagicMock

import pytest

from services.whisper.config import Config


@pytest.fixture
def fake_whisper_model(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    """Inyecta un `faster_whisper.WhisperModel` falso y captura las llamadas
    a `transcribe()` para que los tests puedan inspeccionar los kwargs."""

    captured = MagicMock()
    captured.transcribe.return_value = (iter([]), MagicMock())
    captured.device = "cpu"

    class FakeWhisperModel:
        def __init__(self, *_args, **_kwargs) -> None:  # noqa: ANN002, ANN003
            # Imitamos la estructura real de faster-whisper: el `device`
            # vive en `self.model.device`, no en el wrapper. Así el test
            # del healthcheck también valida el camino real.
            self.model = MagicMock()
            self.model.device = "cpu"

        def transcribe(self, *args, **kwargs):  # noqa: ANN002, ANN003
            return captured.transcribe(*args, **kwargs)

    fake_module = ModuleType("faster_whisper")
    fake_module.WhisperModel = FakeWhisperModel  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "faster_whisper", fake_module)
    return captured


def _base_config(**overrides: object) -> Config:
    base = Config.from_env()
    return replace(base, **overrides)  # type: ignore[arg-type]


def test_hotwords_propagated_when_set(fake_whisper_model: MagicMock) -> None:
    """Si `config.hotwords` viene poblado, llega al modelo."""
    from services.whisper.transcriber import Transcriber

    transcriber = Transcriber(_base_config(hotwords="Shiro"))
    # Buffer mínimo no-vacío (>= 2 bytes para que no se descarte).
    transcriber.transcribe_pcm(b"\x00\x00" * 100)

    assert fake_whisper_model.transcribe.called
    _args, kwargs = fake_whisper_model.transcribe.call_args
    assert kwargs.get("hotwords") == "Shiro"


def test_hotwords_none_when_empty(fake_whisper_model: MagicMock) -> None:
    """Si `hotwords` es la cadena vacía, pasamos None — algunos
    decoders tratan "" como token vacío y degradan."""
    from services.whisper.transcriber import Transcriber

    transcriber = Transcriber(_base_config(hotwords=""))
    transcriber.transcribe_pcm(b"\x00\x00" * 100)

    assert fake_whisper_model.transcribe.called
    _args, kwargs = fake_whisper_model.transcribe.call_args
    assert kwargs.get("hotwords") is None


def test_language_and_beam_settings_respected(fake_whisper_model: MagicMock) -> None:
    """Los otros parámetros (language, beam_size, vad_filter) siguen
    propagándose tras añadir hotwords — sanity check de regresión."""
    from services.whisper.transcriber import Transcriber

    transcriber = Transcriber(_base_config(language="en"))
    transcriber.transcribe_pcm(b"\x00\x00" * 100)

    _args, kwargs = fake_whisper_model.transcribe.call_args
    assert kwargs.get("language") == "en"
    assert kwargs.get("beam_size") == 1
    assert kwargs.get("vad_filter") is True


def test_device_resolved_from_inner_model(fake_whisper_model: MagicMock) -> None:
    """El `device` lo leemos de `_model.model.device` (atributo real
    del ctranslate2 interno), no del wrapper. Regresión del bug que
    mostraba "auto" en el healthcheck en vez del device resuelto."""
    from services.whisper.transcriber import Transcriber

    transcriber = Transcriber(_base_config())
    # El fixture pone `cpu` en `model.device` — debe propagarse.
    assert transcriber.device == "cpu"
