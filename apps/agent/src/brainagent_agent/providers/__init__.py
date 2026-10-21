"""Provider adapters: every STT/TTS/LLM/realtime model is built from config.

Adding a provider = one builder function + one registry entry. The rest of the
worker only sees LiveKit's `stt.STT`, `tts.TTS`, `llm.LLM` and `llm.RealtimeModel`.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from typing import Any

from livekit.agents import llm, stt, tts

from ..config import LabConfig, LLMConfig, RealtimeConfig, STTConfig, TTSConfig


class ProviderConfigError(ValueError):
    pass


def _opt(**kwargs: Any) -> dict[str, Any]:
    """Drops unset values so the plugin keeps its own default."""
    return {k: v for k, v in kwargs.items() if v not in (None, "")}


def _env(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None


def _vertex_enabled() -> bool:
    return (_env("GOOGLE_GENAI_USE_VERTEXAI") or "false").lower() in ("1", "true", "yes")


def _google_kwargs() -> dict[str, Any]:
    if _vertex_enabled():
        return _opt(
            vertexai=True,
            project=_env("GOOGLE_CLOUD_PROJECT"),
            location=_env("GOOGLE_CLOUD_LOCATION"),
        )
    return _opt(api_key=_env("GOOGLE_API_KEY"))


# --- STT ---------------------------------------------------------------------


def _deepgram_stt(cfg: STTConfig) -> stt.STT:
    from livekit.plugins import deepgram

    return deepgram.STT(
        **_opt(
            model=cfg.model,
            language=cfg.language,
            api_key=_env("DEEPGRAM_API_KEY"),
            base_url=_env("DEEPGRAM_BASE_URL"),
        )
    )


STT_PROVIDERS: dict[str, Callable[[STTConfig], stt.STT]] = {
    "deepgram": _deepgram_stt,
}

# --- TTS ---------------------------------------------------------------------


def _elevenlabs_tts(cfg: TTSConfig) -> tts.TTS:
    from livekit.plugins import elevenlabs

    return elevenlabs.TTS(
        **_opt(
            voice_id=cfg.voice_id,
            model=cfg.model,
            language=cfg.language,
            api_key=_env("ELEVEN_API_KEY"),
        )
    )


def _cartesia_tts(cfg: TTSConfig) -> tts.TTS:
    from livekit.plugins import cartesia

    return cartesia.TTS(
        **_opt(
            voice=cfg.voice_id,
            model=cfg.model,
            language=cfg.language,
            api_key=_env("CARTESIA_API_KEY"),
        )
    )


TTS_PROVIDERS: dict[str, Callable[[TTSConfig], tts.TTS]] = {
    "elevenlabs": _elevenlabs_tts,
    "cartesia": _cartesia_tts,
}

# --- LLM ---------------------------------------------------------------------


def _google_llm(cfg: LLMConfig) -> llm.LLM:
    from livekit.plugins import google

    return google.LLM(**_opt(model=cfg.model), **_google_kwargs())


def _openai_llm(cfg: LLMConfig) -> llm.LLM:
    from livekit.plugins import openai

    return openai.LLM(**_opt(model=cfg.model, api_key=_env("OPENAI_API_KEY")))


def _anthropic_llm(cfg: LLMConfig) -> llm.LLM:
    from livekit.plugins import anthropic

    return anthropic.LLM(**_opt(model=cfg.model, api_key=_env("ANTHROPIC_API_KEY")))


def _litellm_llm(cfg: LLMConfig) -> llm.LLM:
    """LiteLLM proxy speaks the OpenAI API; the model is "<provider>/<model>"."""
    from livekit.plugins import openai

    base_url = _env("LITELLM_BASE_URL")
    if not base_url:
        raise ProviderConfigError("LAB_LLM_ROUTE=litellm requires LITELLM_BASE_URL")
    if not cfg.model:
        raise ProviderConfigError("LAB_LLM_ROUTE=litellm requires an explicit LLM model")
    return openai.LLM(
        model=cfg.model,
        base_url=base_url.rstrip("/") + "/v1",
        api_key=_env("LITELLM_MASTER_KEY") or "unused",
    )


LLM_PROVIDERS: dict[str, Callable[[LLMConfig], llm.LLM]] = {
    "google": _google_llm,
    "openai": _openai_llm,
    "anthropic": _anthropic_llm,
}

# --- Realtime (speech-to-speech) ---------------------------------------------


def _gemini_live(cfg: RealtimeConfig, instructions: str) -> llm.RealtimeModel:
    from google.genai import types
    from livekit.plugins import google

    detection = types.AutomaticActivityDetection(
        start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_HIGH
        if cfg.start_sensitivity == "high"
        else types.StartSensitivity.START_SENSITIVITY_LOW,
        end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_HIGH
        if cfg.end_sensitivity == "high"
        else types.EndSensitivity.END_SENSITIVITY_LOW,
        silence_duration_ms=cfg.silence_ms,
        prefix_padding_ms=cfg.prefix_padding_ms,
    )
    return google.realtime.RealtimeModel(
        instructions=instructions,
        realtime_input_config=types.RealtimeInputConfig(automatic_activity_detection=detection),
        **_opt(model=cfg.model, voice=cfg.voice, language=cfg.language),
        **_google_kwargs(),
    )


# --- Public builders ---------------------------------------------------------


def _lookup(registry: dict[str, Callable[..., Any]], kind: str, name: str) -> Callable[..., Any]:
    try:
        return registry[name]
    except KeyError as exc:
        known = ", ".join(sorted(registry))
        raise ProviderConfigError(f"unknown {kind} provider '{name}' (known: {known})") from exc


def build_stt(cfg: STTConfig) -> stt.STT:
    return _lookup(STT_PROVIDERS, "STT", cfg.provider)(cfg)


def build_tts(cfg: TTSConfig) -> tts.TTS:
    return _lookup(TTS_PROVIDERS, "TTS", cfg.provider)(cfg)


def build_llm(cfg: LLMConfig) -> llm.LLM:
    if cfg.route == "litellm":
        return _litellm_llm(cfg)
    return _lookup(LLM_PROVIDERS, "LLM", cfg.provider)(cfg)


def build_realtime(cfg: RealtimeConfig, instructions: str) -> llm.RealtimeModel:
    return _gemini_live(cfg, instructions)


def describe(cfg: LabConfig) -> dict[str, str]:
    """Short labels for the lab UI and turn_metrics rows."""
    if cfg.mode == "realtime":
        return {"mode": "realtime", "llm": f"gemini-live:{cfg.realtime.model or 'default'}"}
    return {
        "mode": "pipeline",
        "stt": f"{cfg.stt.provider}:{cfg.stt.model or 'default'}",
        "llm": f"{cfg.llm.route}:{cfg.llm.provider}:{cfg.llm.model or 'default'}",
        "tts": f"{cfg.tts.provider}:{cfg.tts.model or 'default'}",
    }
