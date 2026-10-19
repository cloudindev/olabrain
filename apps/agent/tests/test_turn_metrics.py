import time

from livekit.agents import metrics

from brainagent_agent.turn_metrics import TurnBreakdown, TurnMetricsCollector


def eou(speech_id: str, delay: float = 0.4, transcription: float = 0.2) -> metrics.EOUMetrics:
    return metrics.EOUMetrics(
        timestamp=time.time(),
        end_of_utterance_delay=delay,
        transcription_delay=transcription,
        on_user_turn_completed_delay=0.0,
        speech_id=speech_id,
    )


def llm_m(speech_id: str, ttft: float = 0.35, cancelled: bool = False) -> metrics.LLMMetrics:
    return metrics.LLMMetrics(
        label="google.LLM",
        request_id="r",
        timestamp=time.time(),
        duration=1.0,
        ttft=ttft,
        cancelled=cancelled,
        completion_tokens=20,
        prompt_tokens=100,
        prompt_cached_tokens=0,
        total_tokens=120,
        tokens_per_second=20.0,
        speech_id=speech_id,
    )


def tts_m(speech_id: str, ttfb: float = 0.15) -> metrics.TTSMetrics:
    return metrics.TTSMetrics(
        label="elevenlabs.TTS",
        request_id="r",
        timestamp=time.time(),
        ttfb=ttfb,
        duration=1.0,
        audio_duration=2.0,
        cancelled=False,
        characters_count=42,
        streamed=True,
        speech_id=speech_id,
    )


def collect(*events: metrics.AgentMetrics) -> list[TurnBreakdown]:
    out: list[TurnBreakdown] = []
    collector = TurnMetricsCollector(out.append)
    for event in events:
        collector.collect(event)
    return out


def test_full_pipeline_turn_is_merged_once() -> None:
    turns = collect(eou("s1"), llm_m("s1"), tts_m("s1"), tts_m("s1"))
    assert len(turns) == 1
    turn = turns[0]
    assert turn.eot_ms == 400
    assert turn.transcription_ms == 200
    assert turn.first_token_ms == 350
    assert turn.tts_ttfb_ms == 150
    assert turn.pipeline_sum_ms == 900
    assert turn.server_first_audio_ms is None  # no "speaking" event seen
    assert turn.prompt_tokens == 100
    assert turn.tts_characters == 42
    assert turn.labels == {"llm": "google.LLM", "tts": "elevenlabs.TTS"}


def test_user_turn_waits_for_llm_even_if_tts_arrives_first() -> None:
    out: list[TurnBreakdown] = []
    collector = TurnMetricsCollector(out.append)
    collector.collect(eou("s1"))
    collector.collect(tts_m("s1"))
    assert out == []
    collector.collect(llm_m("s1"))
    assert len(out) == 1
    assert out[0].pipeline_sum_ms == 900


def test_greeting_without_llm_is_emitted_with_tts_only() -> None:
    turns = collect(tts_m("greet"))
    assert len(turns) == 1
    assert turns[0].eot_ms is None
    assert turns[0].first_token_ms is None
    assert turns[0].pipeline_sum_ms is None


def test_cancelled_llm_inference_does_not_set_ttft() -> None:
    turns = collect(eou("s1"), llm_m("s1", ttft=0.1, cancelled=True), llm_m("s1"), tts_m("s1"))
    assert turns[0].first_token_ms == 350


def test_interleaved_turns_are_kept_apart() -> None:
    turns = collect(eou("a"), eou("b", delay=0.6), llm_m("b"), tts_m("b"), llm_m("a"), tts_m("a"))
    assert [t.speech_id for t in turns] == ["b", "a"]
    assert turns[0].eot_ms == 600


def test_metrics_without_speech_id_are_ignored() -> None:
    m = tts_m("x")
    m.speech_id = None
    assert collect(m) == []


def test_payload_includes_pipeline_sum_and_hides_wall_clock() -> None:
    payload = collect(eou("s1"), llm_m("s1"), tts_m("s1"))[0].to_payload()
    assert payload["pipeline_sum_ms"] == 900
    assert payload["speech_id"] == "s1"
    assert "user_end_at" not in payload


def test_server_first_audio_from_speaking_event() -> None:
    out: list[TurnBreakdown] = []
    collector = TurnMetricsCollector(out.append)
    e = eou("s1", delay=0.5)
    collector.collect(e)
    collector.collect(llm_m("s1"))
    # Agent starts playing 1.4 s after the user stopped talking.
    collector.agent_started_speaking(e.timestamp - 0.5 + 1.4)
    collector.collect(tts_m("s1"))
    assert out[0].server_first_audio_ms == 1400


def test_speaking_before_user_end_is_ignored() -> None:
    out: list[TurnBreakdown] = []
    collector = TurnMetricsCollector(out.append)
    e = eou("s1", delay=0.5)
    collector.agent_started_speaking(e.timestamp - 5)  # previous reply
    collector.collect(e)
    collector.collect(llm_m("s1"))
    collector.collect(tts_m("s1"))
    assert out[0].server_first_audio_ms is None
