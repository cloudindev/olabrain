"""Groups LiveKit Agents metrics into one breakdown per agent turn.

LiveKit emits EOU, LLM and TTS metrics as separate events sharing a `speech_id`.
We merge them and publish a single `TurnBreakdown` once the turn has its TTS TTFB
and, for turns answering the user, its LLM TTFT. Turns without an LLM call (e.g. the
fixed greeting spoken with `session.say`) are published with the TTS data alone.
Realtime (speech-to-speech) models report one `RealtimeModelMetrics` per response.

`server_first_audio_ms` is measured, not estimated: from the user's end of speech (EOU
timestamp minus its delay) to the agent's first audio frame (state -> "speaking").
It includes the LLM time to a first full sentence, which EOT + TTFT + TTFB misses.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict, dataclass, field

from livekit.agents import metrics


def _ms(seconds: float | None) -> int | None:
    if seconds is None:
        return None
    return max(round(seconds * 1000), 0)


@dataclass
class TurnBreakdown:
    """Server-side view of one turn. All durations in milliseconds."""

    speech_id: str | None
    eot_ms: int | None = None
    transcription_ms: int | None = None
    first_token_ms: int | None = None
    tts_ttfb_ms: int | None = None
    server_first_audio_ms: int | None = None
    user_end_at: float | None = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    tts_characters: int = 0
    labels: dict[str, str] = field(default_factory=dict)

    @property
    def pipeline_sum_ms(self) -> int | None:
        """EOT + TTFT + TTFB: lower bound of the first audio (ignores first-sentence time)."""
        parts = (self.eot_ms, self.first_token_ms, self.tts_ttfb_ms)
        if any(p is None for p in parts):
            return None
        return sum(p for p in parts if p is not None)

    def to_payload(self) -> dict:
        data = asdict(self)
        data.pop("user_end_at")
        data["pipeline_sum_ms"] = self.pipeline_sum_ms
        return data


class TurnMetricsCollector:
    def __init__(self, on_turn: Callable[[TurnBreakdown], None]) -> None:
        self._on_turn = on_turn
        self._pending: dict[str, TurnBreakdown] = {}
        self._emitted: set[str] = set()
        self._last_user_end_at: float | None = None
        self._last_speaking_at: float | None = None

    def _turn(self, speech_id: str) -> TurnBreakdown:
        if speech_id not in self._pending:
            self._pending[speech_id] = TurnBreakdown(speech_id=speech_id)
        return self._pending[speech_id]

    def agent_started_speaking(self, at: float) -> None:
        """Wall-clock time (time.time()) of the agent's first audio frame of a reply."""
        self._last_speaking_at = at

    def collect(self, m: metrics.AgentMetrics) -> None:
        if isinstance(m, metrics.RealtimeModelMetrics):
            self._on_turn(
                TurnBreakdown(
                    speech_id=m.request_id,
                    first_token_ms=_ms(m.ttft) if m.ttft >= 0 else None,
                    prompt_tokens=m.input_tokens,
                    completion_tokens=m.output_tokens,
                    labels={"model": m.label},
                )
            )
            return

        speech_id = getattr(m, "speech_id", None)
        if not speech_id or speech_id in self._emitted:
            return

        turn = self._turn(speech_id)
        if isinstance(m, metrics.EOUMetrics):
            turn.eot_ms = _ms(m.end_of_utterance_delay)
            turn.transcription_ms = _ms(m.transcription_delay)
            if m.end_of_utterance_delay > 0:
                turn.user_end_at = m.timestamp - m.end_of_utterance_delay
                self._last_user_end_at = turn.user_end_at
        elif isinstance(m, metrics.LLMMetrics):
            # Tool calls produce extra LLM inferences in the same turn; the first one
            # is the one the user waits for.
            if turn.first_token_ms is None and not m.cancelled:
                turn.first_token_ms = _ms(m.ttft)
                turn.labels["llm"] = m.label
            turn.prompt_tokens += m.prompt_tokens
            turn.completion_tokens += m.completion_tokens
            self._maybe_emit(speech_id)
        elif isinstance(m, metrics.TTSMetrics):
            turn.tts_characters += m.characters_count
            if turn.tts_ttfb_ms is None and not m.cancelled:
                turn.tts_ttfb_ms = _ms(m.ttfb)
                turn.labels["tts"] = m.label
            self._maybe_emit(speech_id)

    def _maybe_emit(self, speech_id: str) -> None:
        turn = self._pending.get(speech_id)
        if turn is None or turn.tts_ttfb_ms is None:
            return
        answers_user = turn.eot_ms is not None
        if answers_user and turn.first_token_ms is None:
            return
        del self._pending[speech_id]
        self._emitted.add(speech_id)
        # The reply's first frame is the latest "speaking" after this turn's end of speech.
        if (
            turn.user_end_at is not None
            and self._last_speaking_at is not None
            and self._last_speaking_at > turn.user_end_at
        ):
            turn.server_first_audio_ms = _ms(self._last_speaking_at - turn.user_end_at)
        self._on_turn(turn)
