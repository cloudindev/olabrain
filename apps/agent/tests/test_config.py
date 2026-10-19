import json

import pytest

from brainagent_agent.config import InvalidLabConfig, load_lab_config

LAB_VARS = [
    "LAB_MODE",
    "LAB_STT_PROVIDER",
    "LAB_STT_MODEL",
    "LAB_STT_LANGUAGE",
    "LAB_TTS_PROVIDER",
    "LAB_TTS_MODEL",
    "LAB_TTS_VOICE_ID",
    "LAB_LLM_PROVIDER",
    "LAB_LLM_MODEL",
    "LAB_LLM_ROUTE",
    "LAB_REALTIME_MODEL",
    "LAB_REALTIME_VOICE",
    "LAB_MAX_SESSION_SECONDS",
    "LAB_PREEMPTIVE_GENERATION",
]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in LAB_VARS:
        monkeypatch.delenv(var, raising=False)


def test_defaults_without_env_or_metadata() -> None:
    cfg = load_lab_config(None)
    assert cfg.mode == "pipeline"
    assert cfg.stt.provider == "deepgram"
    assert cfg.stt.language == "es"
    assert cfg.llm.route == "direct"
    assert cfg.llm.model is None
    assert cfg.preemptive_generation is True


def test_env_defaults_apply_and_empty_values_are_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LAB_TTS_PROVIDER", "cartesia")
    monkeypatch.setenv("LAB_TTS_VOICE_ID", "voice-123")
    monkeypatch.setenv("LAB_LLM_MODEL", "")
    monkeypatch.setenv("LAB_MAX_SESSION_SECONDS", "120")
    cfg = load_lab_config(None)
    assert cfg.tts.provider == "cartesia"
    assert cfg.tts.voice_id == "voice-123"
    assert cfg.llm.model is None
    assert cfg.max_session_seconds == 120


def test_room_metadata_overrides_env_deeply(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LAB_TTS_PROVIDER", "cartesia")
    monkeypatch.setenv("LAB_TTS_VOICE_ID", "env-voice")
    metadata = json.dumps(
        {
            "conversation_id": "c-1",
            "tenant_id": "t-1",
            "tts": {"provider": "elevenlabs"},
            "llm": {"provider": "anthropic", "model": "some-model"},
        }
    )
    cfg = load_lab_config(metadata)
    assert cfg.conversation_id == "c-1"
    assert cfg.tenant_id == "t-1"
    assert cfg.tts.provider == "elevenlabs"
    # Untouched nested keys keep the env default.
    assert cfg.tts.voice_id == "env-voice"
    assert cfg.llm.provider == "anthropic"
    assert cfg.llm.model == "some-model"


@pytest.mark.parametrize(
    "metadata",
    [
        "not json",
        "[1, 2]",
        json.dumps({"tts": {"provider": "unknown"}}),
        json.dumps({"mode": "avatar"}),
        json.dumps({"max_session_seconds": 99999}),
    ],
)
def test_invalid_metadata_is_rejected(metadata: str) -> None:
    with pytest.raises(InvalidLabConfig):
        load_lab_config(metadata)
