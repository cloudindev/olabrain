import pytest
from livekit.agents import llm, stt, tts

from brainagent_agent.config import LabConfig, LLMConfig, STTConfig, TTSConfig
from brainagent_agent.providers import (
    LLM_PROVIDERS,
    TTS_PROVIDERS,
    ProviderConfigError,
    build_llm,
    build_stt,
    build_tts,
    describe,
)


@pytest.fixture(autouse=True)
def fake_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in (
        "DEEPGRAM_API_KEY",
        "ELEVEN_API_KEY",
        "CARTESIA_API_KEY",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GOOGLE_API_KEY",
    ):
        monkeypatch.setenv(var, "test-key")
    monkeypatch.setenv("GOOGLE_GENAI_USE_VERTEXAI", "false")
    monkeypatch.delenv("DEEPGRAM_BASE_URL", raising=False)


def test_build_stt_deepgram() -> None:
    instance = build_stt(STTConfig(provider="deepgram", language="es"))
    assert isinstance(instance, stt.STT)


@pytest.mark.parametrize("provider", sorted(TTS_PROVIDERS))
def test_build_every_tts(provider: str) -> None:
    instance = build_tts(TTSConfig(provider=provider, voice_id="voice-1"))
    assert isinstance(instance, tts.TTS)


@pytest.mark.parametrize("provider", sorted(LLM_PROVIDERS))
def test_build_every_llm_direct(provider: str) -> None:
    instance = build_llm(LLMConfig(provider=provider, model="any-model"))
    assert isinstance(instance, llm.LLM)


def test_litellm_route_requires_base_url_and_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LITELLM_BASE_URL", raising=False)
    with pytest.raises(ProviderConfigError):
        build_llm(LLMConfig(route="litellm", model="openai/x"))

    monkeypatch.setenv("LITELLM_BASE_URL", "http://localhost:4000")
    with pytest.raises(ProviderConfigError):
        build_llm(LLMConfig(route="litellm", model=None))

    assert isinstance(build_llm(LLMConfig(route="litellm", model="openai/x")), llm.LLM)


def test_unknown_provider_is_a_config_error() -> None:
    cfg = STTConfig.model_construct(provider="nope", model=None, language="es")
    with pytest.raises(ProviderConfigError, match="unknown STT provider"):
        build_stt(cfg)


def test_describe_labels() -> None:
    labels = describe(LabConfig())
    assert labels["mode"] == "pipeline"
    assert labels["llm"].startswith("direct:")
    assert describe(LabConfig(mode="realtime"))["mode"] == "realtime"
