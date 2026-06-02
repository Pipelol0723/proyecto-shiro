"""Tests de `Config.from_env` — verifica defaults y overrides."""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator

from services.whisper.config import Config


@contextmanager
def env(**kwargs: str | None) -> Iterator[None]:
    """Context manager que setea/quita env vars y restaura al salir."""
    previous: dict[str, str | None] = {}
    try:
        for key, value in kwargs.items():
            previous[key] = os.environ.get(key)
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_defaults_when_no_env() -> None:
    with env(
        WHISPER_MODEL=None,
        WHISPER_DEVICE=None,
        WHISPER_COMPUTE_TYPE=None,
        WHISPER_LANGUAGE=None,
        WHISPER_HOST=None,
        WHISPER_PORT=None,
        WHISPER_PARTIAL_INTERVAL_MS=None,
        WHISPER_SAMPLE_RATE=None,
        WHISPER_HOTWORDS=None,
    ):
        cfg = Config.from_env()
    assert cfg.model == "small"
    assert cfg.device == "auto"
    assert cfg.compute_type == "auto"
    assert cfg.language == "es"
    assert cfg.host == "0.0.0.0"
    assert cfg.port == 8765
    assert cfg.partial_interval_ms == 1500
    assert cfg.sample_rate == 16000
    # Default vacío: el microservicio es neutral si se ejecuta standalone.
    # El docker-compose del proyecto inyecta las hotwords del personaje.
    assert cfg.hotwords == ""


def test_env_overrides_apply() -> None:
    with env(
        WHISPER_MODEL="large-v3",
        WHISPER_DEVICE="cuda",
        WHISPER_COMPUTE_TYPE="float16",
        WHISPER_LANGUAGE="en",
        WHISPER_PORT="9999",
        WHISPER_PARTIAL_INTERVAL_MS="500",
        WHISPER_HOTWORDS="Aiko sensei",
    ):
        cfg = Config.from_env()
    assert cfg.model == "large-v3"
    assert cfg.device == "cuda"
    assert cfg.compute_type == "float16"
    assert cfg.language == "en"
    assert cfg.port == 9999
    assert cfg.partial_interval_ms == 500
    assert cfg.hotwords == "Aiko sensei"


def test_invalid_int_falls_back_to_default() -> None:
    with env(
        WHISPER_PORT="not-a-number",
        WHISPER_PARTIAL_INTERVAL_MS="",
    ):
        cfg = Config.from_env()
    assert cfg.port == 8765  # vuelve al default
    assert cfg.partial_interval_ms == 1500
