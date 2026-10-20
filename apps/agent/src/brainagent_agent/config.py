"""Lab session configuration.

Defaults come from the environment (`LAB_*`); each room can override them through
its metadata (JSON with the same shape as `LabConfig`, produced by apps/web).
Model and voice names are never hardcoded here.
"""

from __future__ import annotations

import json
import os
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

Mode = Literal["pipeline", "realtime"]
STTProviderName = Literal["deepgram"]
TTSProviderName = Literal["elevenlabs", "cartesia"]
LLMProviderName = Literal["google", "openai", "anthropic"]
LLMRoute = Literal["direct", "litellm"]


class STTConfig(BaseModel):
    provider: STTProviderName = "deepgram"
    model: str | None = None
    language: str = "es"


class TTSConfig(BaseModel):
    provider: TTSProviderName = "elevenlabs"
    model: str | None = None
    voice_id: str | None = None
    language: str = "es"


class LLMConfig(BaseModel):
    provider: LLMProviderName = "google"
    model: str | None = None
    route: LLMRoute = "direct"


class RealtimeConfig(BaseModel):
    model: str | None = None
    voice: str | None = None
    language: str = "es-ES"
    # True when the room metadata chose the voice (it then wins over the persona's).
    voice_overridden: bool = False


class LabConfig(BaseModel):
    """Everything the worker needs to build one voice session."""

    conversation_id: str | None = Field(default=None, alias="conversationId")
    # When set, the session runs this agent (persona, instructions, model, tools) instead
    # of the built-in lab persona.
    agent_id: str | None = Field(default=None, alias="agentId")
    # Who the agent is talking to (memory per contact).
    contact_id: str | None = Field(default=None, alias="contactId")
    tenant_id: str | None = Field(default=None, alias="tenantId")
    mode: Mode = "pipeline"
    stt: STTConfig = STTConfig()
    tts: TTSConfig = TTSConfig()
    llm: LLMConfig = LLMConfig()
    realtime: RealtimeConfig = RealtimeConfig()
    max_session_seconds: int = Field(default=600, alias="maxSessionSeconds", ge=30, le=3600)
    preemptive_generation: bool = Field(default=True, alias="preemptiveGeneration")
    # True when the room metadata chose a TTS voice (it then wins over the persona's voice).
    voice_overridden: bool = False
    # Also synthesize audio before the turn is confirmed (more TTS spend on false starts).
    preemptive_tts: bool = Field(default=True, alias="preemptiveTts")
    # Minimum silence before a turn can end (LiveKit default 0.5 s for this detector).
    min_endpointing_delay: float = Field(default=0.3, alias="minEndpointingDelay", ge=0.1, le=2.0)

    model_config = {"populate_by_name": True}


def _env(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None


def defaults_from_env() -> dict:
    """Builds the default config dict from LAB_* variables (empty values are ignored)."""
    raw: dict = {
        "mode": _env("LAB_MODE"),
        "stt": {
            "provider": _env("LAB_STT_PROVIDER"),
            "model": _env("LAB_STT_MODEL"),
            "language": _env("LAB_STT_LANGUAGE"),
        },
        "tts": {
            "provider": _env("LAB_TTS_PROVIDER"),
            "model": _env("LAB_TTS_MODEL"),
            "voice_id": _env("LAB_TTS_VOICE_ID"),
        },
        "llm": {
            "provider": _env("LAB_LLM_PROVIDER"),
            "model": _env("LAB_LLM_MODEL"),
            "route": _env("LAB_LLM_ROUTE"),
        },
        "realtime": {
            "model": _env("LAB_REALTIME_MODEL"),
            "voice": _env("LAB_REALTIME_VOICE"),
        },
        "max_session_seconds": _env("LAB_MAX_SESSION_SECONDS"),
        "preemptive_generation": _env("LAB_PREEMPTIVE_GENERATION"),
        "preemptive_tts": _env("LAB_PREEMPTIVE_TTS"),
        "min_endpointing_delay": _env("LAB_MIN_ENDPOINTING_DELAY"),
    }
    return _drop_none(raw)


def _drop_none(value: dict) -> dict:
    out: dict = {}
    for key, item in value.items():
        if isinstance(item, dict):
            nested = _drop_none(item)
            if nested:
                out[key] = nested
        elif item is not None:
            out[key] = item
    return out


def _deep_merge(base: dict, override: dict) -> dict:
    merged = dict(base)
    for key, item in override.items():
        if isinstance(item, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], item)
        elif item is not None:
            merged[key] = item
    return merged


class InvalidLabConfig(ValueError):
    pass


def load_lab_config(room_metadata: str | None) -> LabConfig:
    """Env defaults overlaid with the room metadata sent by apps/web."""
    override: dict = {}
    if room_metadata:
        try:
            parsed = json.loads(room_metadata)
        except json.JSONDecodeError as exc:
            raise InvalidLabConfig("room metadata is not valid JSON") from exc
        if not isinstance(parsed, dict):
            raise InvalidLabConfig("room metadata must be a JSON object")
        override = parsed
    try:
        cfg = LabConfig.model_validate(_deep_merge(defaults_from_env(), override))
        voice_set = isinstance(override.get("tts"), dict) and bool(override["tts"].get("voice_id"))
        rt_voice_set = isinstance(override.get("realtime"), dict) and bool(
            override["realtime"].get("voice")
        )
        return cfg.model_copy(
            update={
                "voice_overridden": voice_set,
                "realtime": cfg.realtime.model_copy(update={"voice_overridden": rt_voice_set}),
            }
        )
    except ValidationError as exc:
        raise InvalidLabConfig(str(exc)) from exc
