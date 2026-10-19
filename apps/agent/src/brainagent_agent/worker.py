"""LiveKit Agents worker for the /lab voice spike.

Run:  uv run python -m brainagent_agent.worker dev
apps/web dispatches this agent explicitly (agent_name = LIVEKIT_AGENT_NAME) and
passes the lab config as dispatch metadata.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time

from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    ErrorEvent,
    JobContext,
    JobProcess,
    MetricsCollectedEvent,
    TurnHandlingOptions,
    cli,
    inference,
)
from livekit.agents.worker import ServerEnvOption
from livekit.plugins import silero

from .config import InvalidLabConfig, LabConfig, load_lab_config
from .persona import LIA
from .providers import build_llm, build_realtime, build_stt, build_tts, describe
from .turn_metrics import TurnBreakdown, TurnMetricsCollector

# Monorepo root .env (apps/agent/src/brainagent_agent -> ../../../../.env), then local.
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", ".env"))
load_dotenv()

logger = logging.getLogger("brainagent.agent")

METRICS_TOPIC = "lab.metrics"
DEFAULT_AGENT_NAME = "brainagent-lab"


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()


# One warm process in dev too (LiveKit's dev default is 0, which adds seconds to every
# connection while a process spawns and loads the VAD).
server = AgentServer(
    setup_fnc=prewarm,
    num_idle_processes=ServerEnvOption(dev_default=1, prod_default=8),
)


def build_session(cfg: LabConfig, proc: JobProcess) -> tuple[AgentSession, Agent]:
    if cfg.mode == "realtime":
        model = build_realtime(cfg.realtime, LIA.instructions)
        return AgentSession(llm=model), Agent(instructions=LIA.instructions)

    session: AgentSession = AgentSession(
        vad=proc.userdata["vad"],
        stt=build_stt(cfg.stt),
        llm=build_llm(cfg.llm),
        tts=build_tts(cfg.tts),
        turn_handling=TurnHandlingOptions(
            # Local audio model: no audio leaves our infra for turn detection (the default
            # in dev mode would be LiveKit Inference, a cloud service).
            turn_detection=inference.TurnDetector(version="v1-mini"),
            # "vad" keeps barge-in local; the default "adaptive" mode streams audio to
            # LiveKit's cloud gateway.
            interruption={"enabled": True, "mode": "vad"},
            preemptive_generation={"enabled": cfg.preemptive_generation},
        ),
    )
    return session, Agent(instructions=LIA.instructions)


@server.rtc_session(agent_name=os.environ.get("LIVEKIT_AGENT_NAME") or DEFAULT_AGENT_NAME)
async def entrypoint(ctx: JobContext) -> None:
    try:
        cfg = load_lab_config(ctx.job.metadata)
    except InvalidLabConfig:
        logger.exception("invalid lab config, closing job")
        ctx.shutdown(reason="invalid lab config")
        return

    labels = describe(cfg)
    logger.info("starting lab session", extra={"labels": labels, "room": ctx.room.name})

    async def publish(payload: dict) -> None:
        try:
            await ctx.room.local_participant.publish_data(
                json.dumps(payload), reliable=True, topic=METRICS_TOPIC
            )
        except Exception:
            logger.exception("failed to publish lab metrics")

    try:
        session, agent = build_session(cfg, ctx.proc)
    except Exception as exc:
        # Usually a missing API key or an unknown provider: tell the lab UI instead of
        # leaving the user waiting for an agent that never speaks.
        logger.exception("could not build the voice session")
        await ctx.connect()
        await publish({"type": "error", "message": str(exc)})
        ctx.shutdown(reason="invalid provider configuration")
        return

    turn_index = 0
    background: set[asyncio.Task[None]] = set()

    def on_turn(turn: TurnBreakdown) -> None:
        nonlocal turn_index
        turn_index += 1
        payload = {
            "type": "turn",
            "turn": turn_index,
            "sentAt": time.time() * 1000,
            **turn.to_payload(),
            # After to_payload(): its per-turn labels must not drop the session labels.
            "labels": {**labels, **turn.labels},
        }
        task = asyncio.create_task(publish(payload))
        background.add(task)
        task.add_done_callback(background.discard)

    collector = TurnMetricsCollector(on_turn)

    @session.on("metrics_collected")
    def _on_metrics(ev: MetricsCollectedEvent) -> None:
        collector.collect(ev.metrics)

    @session.on("error")
    def _on_error(ev: ErrorEvent) -> None:
        # STT/LLM/TTS errors carry `recoverable`; only surface the ones that end the turn.
        if getattr(ev.error, "recoverable", False):
            return
        label = getattr(ev.error, "label", type(ev.source).__name__)
        detail = getattr(ev.error, "error", ev.error)
        task = asyncio.create_task(publish({"type": "error", "message": f"{label}: {detail}"}))
        background.add(task)
        task.add_done_callback(background.discard)

    await session.start(agent=agent, room=ctx.room)

    if cfg.mode == "realtime":
        session.generate_reply(instructions=f"Saluda diciendo exactamente: {LIA.greeting}")
    else:
        session.say(LIA.greeting)

    async def enforce_max_duration() -> None:
        await asyncio.sleep(cfg.max_session_seconds)
        logger.info("lab session reached max duration", extra={"room": ctx.room.name})
        handle = session.say(
            "Hemos llegado al límite de tiempo de esta prueba. Hasta pronto.",
            allow_interruptions=False,
        )
        await handle
        ctx.shutdown(reason="max session duration")

    limiter = asyncio.create_task(enforce_max_duration())
    ctx.add_shutdown_callback(lambda: _cancel(limiter))


async def _cancel(task: asyncio.Task[None]) -> None:
    task.cancel()


if __name__ == "__main__":
    cli.run_app(server)
